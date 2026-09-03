"""Atomic workspace-execution lease for the shared estate (Session 5).

One active mutating lease per ``workspace_id``. The lease lives under the
existing Window operational-data root, runs inside Frank, and adds no
scheduler or control-plane daemon. Storage is cross-process safe via
``flock`` plus atomic record replacement. Every record stores only the
workspace id, executor kind/id, owning session/task/job/run ids, a random
generation, and acquired/heartbeat/expiry times.

Stale leases are never reclaimed on wall-clock TTL alone: reclaim requires
TTL expiry plus an injected authoritative owner verifier that confirms the
owning process/run is really gone. Verifier outages fail closed. Reads
(inspect) never require a lease.
"""
from __future__ import annotations

import fcntl
import json
import os
import random
import time
import uuid
from pathlib import Path
from typing import Callable

from .schemas import (
    EXECUTOR_KINDS,
    LEASE_STATES,
    WORKSPACE_LEASE_SCHEMA,
    LeaseEvent,
    LeaseGrant,
    LeaseOwner,
    LeaseRecord,
    QueuedRequest,
)

DEFAULT_TTL_SECONDS = 300.0
DEFAULT_MAX_QUEUE = 8
DEFAULT_HEARTBEAT_MAX = DEFAULT_TTL_SECONDS / 3.0
MAX_EVENT_HISTORY = 50


class LeaseError(RuntimeError):
    """Base lease error."""


class LeaseUnavailable(LeaseError):
    """The lease store is unavailable or corrupt; fail closed."""


class LeaseRefused(LeaseError):
    """The request cannot be granted now (queue full or reconciling)."""


class StaleGeneration(LeaseError):
    """The presented generation does not match the active lease."""


class WorkspaceLease:
    def __init__(
        self,
        root: Path,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        max_queue: int = DEFAULT_MAX_QUEUE,
        verifier: Callable[[LeaseOwner], bool] | None = None,
        clock: Callable[[], float] = time.time,
        generation_factory: Callable[[], str] | None = None,
    ):
        self.root = Path(root)
        self.ttl_seconds = float(ttl_seconds)
        self.max_queue = int(max_queue)
        self.verifier = verifier
        self.clock = clock
        self._generation = generation_factory or (lambda: str(uuid.uuid4()))

    # -- storage ---------------------------------------------------------

    def _record_path(self, workspace_id: str) -> Path:
        safe = "".join(ch for ch in workspace_id if ch.isalnum() or ch == "-")
        if not safe or safe != workspace_id or len(safe) > 80:
            raise LeaseRefused("invalid workspace id")
        return self.root / "leases" / f"{safe}.json"

    def _lock_path(self, workspace_id: str) -> Path:
        return self.root / "locks" / f"{workspace_id}.lock"

    def _load_record(self, workspace_id: str) -> LeaseRecord:
        path = self._record_path(workspace_id)
        if not path.exists():
            return LeaseRecord(workspace_id=workspace_id, state="released")
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if (
                not isinstance(raw, dict)
                or raw.get("schema") != WORKSPACE_LEASE_SCHEMA
                or raw.get("workspace_id") != workspace_id
                or raw.get("state") not in LEASE_STATES
            ):
                raise ValueError("unsupported record")
            grant = None
            if isinstance(raw.get("grant"), dict):
                owner = LeaseOwner.from_dict(raw["grant"].get("owner"))
                if owner is None:
                    raise ValueError("bad owner")
                grant = LeaseGrant(
                    workspace_id=workspace_id,
                    generation=str(raw["grant"].get("generation") or ""),
                    owner=owner,
                    acquired_at=float(raw["grant"].get("acquired_at") or 0.0),
                    heartbeat_at=float(raw["grant"].get("heartbeat_at") or 0.0),
                    expires_at=float(raw["grant"].get("expires_at") or 0.0),
                )
            queue = []
            for item in raw.get("queue") or []:
                owner = LeaseOwner.from_dict(item.get("owner")) if isinstance(item, dict) else None
                if owner is None:
                    raise ValueError("bad queue entry")
                queue.append(
                    QueuedRequest(
                        generation=str(item.get("generation") or ""),
                        owner=owner,
                        enqueued_at=float(item.get("enqueued_at") or 0.0),
                    )
                )
            events = []
            for item in (raw.get("events") or [])[-MAX_EVENT_HISTORY:]:
                if isinstance(item, dict):
                    events.append(
                        LeaseEvent(
                            at=float(item.get("at") or 0.0),
                            action=str(item.get("action") or ""),
                            generation=str(item.get("generation") or ""),
                            detail=str(item.get("detail") or ""),
                        )
                    )
            return LeaseRecord(
                workspace_id=workspace_id,
                state=str(raw["state"]),
                grant=grant,
                queue=queue,
                events=events,
            )
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise LeaseUnavailable("lease storage is corrupt; failing closed") from error

    def _save_record(self, record: LeaseRecord) -> None:
        path = self._record_path(workspace_id=record.workspace_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock_path(record.workspace_id).parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        payload = {"schema": WORKSPACE_LEASE_SCHEMA, **record.to_dict()}
        try:
            temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temp.replace(path)
        except OSError as error:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
            raise LeaseUnavailable("lease storage write failed") from error

    def _event(self, record: LeaseRecord, action: str, generation: str = "", detail: str = "") -> None:
        record.events.append(LeaseEvent(at=self.clock(), action=action, generation=generation, detail=detail))
        record.events = record.events[-MAX_EVENT_HISTORY:]

    # -- atomic section ---------------------------------------------------

    def _expired(self, grant: LeaseGrant, now: float) -> bool:
        return now >= grant.expires_at

    def _verifier_alive(self, owner: LeaseOwner) -> bool:
        if self.verifier is None:
            raise LeaseUnavailable("no authoritative owner verifier is configured")
        try:
            return bool(self.verifier(owner))
        except Exception as error:  # verifier outage must fail closed
            raise LeaseUnavailable("authoritative owner verifier is unavailable") from error

    def _try_promote(self, record: LeaseRecord, now: float) -> bool:
        """Grant the head of the fair queue if the workspace is free."""
        if record.state == "active" and record.grant is not None:
            if not self._expired(record.grant, now):
                return False
        if not record.queue:
            return False
        head = record.queue.pop(0)
        record.grant = LeaseGrant(
            workspace_id=record.workspace_id,
            generation=head.generation,
            owner=head.owner,
            acquired_at=now,
            heartbeat_at=now,
            expires_at=now + self.ttl_seconds,
        )
        record.state = "active"
        self._event(record, "granted_from_queue", head.generation, head.owner.executor_kind)
        return True

    def acquire(
        self,
        workspace_id: str,
        owner: LeaseOwner,
        *,
        max_wait_seconds: float = 0.0,
    ) -> LeaseGrant:
        """Atomically acquire the lease or queue fairly behind the holder.

        The lock is held only for short atomic sections, never while
        sleeping. With ``max_wait_seconds=0`` the request is refused
        immediately and leaves no queued entry. With a positive wait the
        queued entry is promoted fairly (FIFO) or cancelled with an
        explicit error on deadline. An expired grant is promoted only
        after the authoritative verifier confirms the owner is gone.
        """
        if owner.executor_kind not in EXECUTOR_KINDS or not owner.executor_id:
            raise LeaseRefused("executor kind and id are required")
        now = self.clock()
        deadline = now + max(0.0, float(max_wait_seconds))
        lock_fd = self._open_lock(workspace_id)
        try:
            record = self._load_record(workspace_id)
            if record.state == "reconciling":
                raise LeaseRefused("workspace is reconciling after restart; failing closed")
            active = record.grant if record.state == "active" and record.grant else None
            if active is not None and self._expired(active, now):
                self._reclaim_if_authoritative(record, active, now)
                active = record.grant if record.state == "active" and record.grant else None
            if active is None:
                generation = self._generation()
                record.grant = LeaseGrant(
                    workspace_id=workspace_id,
                    generation=generation,
                    owner=owner,
                    acquired_at=now,
                    heartbeat_at=now,
                    expires_at=now + self.ttl_seconds,
                )
                record.state = "active"
                self._event(record, "acquired", generation, owner.executor_kind)
                self._save_record(record)
                return record.grant
            if len(record.queue) >= self.max_queue:
                raise LeaseRefused("lease queue is full")
            if deadline <= now:
                raise LeaseRefused("workspace is busy; request refused")
            generation = self._generation()
            record.queue.append(QueuedRequest(generation=generation, owner=owner, enqueued_at=now))
            self._event(record, "queued", generation, owner.executor_kind)
            self._save_record(record)
        finally:
            os.close(lock_fd)
        while self.clock() < deadline:
            time.sleep(0.05)
            lock_fd = self._open_lock(workspace_id)
            try:
                record = self._load_record(workspace_id)
                now = self.clock()
                if record.state == "active" and record.grant and record.grant.generation == generation:
                    return record.grant
                if record.state == "reconciling":
                    raise LeaseRefused("workspace is reconciling after restart; failing closed")
                active = record.grant if record.state == "active" and record.grant else None
                if active is not None and self._expired(active, now):
                    self._reclaim_if_authoritative(record, active, now)
                    self._save_record(record)
                    if (
                        record.state == "active"
                        and record.grant
                        and record.grant.generation == generation
                    ):
                        return record.grant  # verified reclaim promoted this waiter
                    active = record.grant if record.state == "active" and record.grant else None
                if active is None and record.queue and record.queue[0].generation == generation:
                    self._try_promote(record, now)
                    self._save_record(record)
                    if record.grant and record.grant.generation == generation:
                        return record.grant
            finally:
                os.close(lock_fd)
        lock_fd = self._open_lock(workspace_id)
        try:
            record = self._load_record(workspace_id)
            record.queue = [item for item in record.queue if item.generation != generation]
            self._event(record, "cancel_timed_out", generation)
            self._save_record(record)
        finally:
            os.close(lock_fd)
        raise LeaseRefused("workspace is busy; queued request timed out")

    def _open_lock(self, workspace_id: str) -> int:
        try:
            self._lock_path(workspace_id).parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self._lock_path(workspace_id), os.O_CREAT | os.O_RDWR, 0o600)
            fcntl.flock(fd, fcntl.LOCK_EX)
            return fd
        except OSError as error:
            raise LeaseUnavailable("lease lock is unavailable") from error

    def _reclaim_if_authoritative(self, record: LeaseRecord, active: LeaseGrant, now: float) -> None:
        """Reclaim an expired lease only with verified owner death."""
        alive = self._verifier_alive(active.owner)
        if alive:
            self._event(record, "expired_owner_alive", active.generation)
            record.grant.heartbeat_at = now
            record.grant.expires_at = now + self.ttl_seconds
            return
        self._event(record, "reclaimed_verified_dead", active.generation)
        record.state = "released"
        record.grant = None
        self._try_promote(record, now)

    def heartbeat(self, workspace_id: str, generation: str) -> LeaseGrant:
        lock_fd = self._open_lock(workspace_id)
        try:
            record = self._load_record(workspace_id)
            now = self.clock()
            if record.state != "active" or record.grant is None:
                raise StaleGeneration("no active lease for this workspace")
            if record.grant.generation != generation:
                raise StaleGeneration("stale lease generation")
            record.grant.heartbeat_at = now
            record.grant.expires_at = now + self.ttl_seconds
            self._save_record(record)
            return record.grant
        finally:
            os.close(lock_fd)

    def release(self, workspace_id: str, generation: str) -> dict:
        lock_fd = self._open_lock(workspace_id)
        try:
            record = self._load_record(workspace_id)
            now = self.clock()
            if record.state != "active" or record.grant is None:
                raise StaleGeneration("no active lease to release")
            if record.grant.generation != generation:
                raise StaleGeneration("stale lease generation")
            record.grant = None
            record.state = "released"
            self._event(record, "released", generation)
            promoted = self._try_promote(record, now)
            self._save_record(record)
            return {"released": generation, "promoted": promoted}
        finally:
            os.close(lock_fd)

    def cancel_queued(self, workspace_id: str, generation: str) -> dict:
        lock_fd = self._open_lock(workspace_id)
        try:
            record = self._load_record(workspace_id)
            before = len(record.queue)
            record.queue = [item for item in record.queue if item.generation != generation]
            if len(record.queue) == before:
                if record.state == "active" and record.grant and record.grant.generation == generation:
                    raise LeaseRefused("lease is already active; use release")
                raise LeaseRefused("no queued request for this generation")
            self._event(record, "cancelled_queued", generation)
            self._save_record(record)
            return {"cancelled": generation}
        finally:
            os.close(lock_fd)

    def inspect(self, workspace_id: str) -> dict:
        """Read-only inspection; never requires a lease or the lock."""
        record = self._load_record(workspace_id)
        return record.to_dict()

    def reconcile(self, workspace_id: str) -> dict:
        """Resolve a reconciling record using the authoritative verifier."""
        lock_fd = self._open_lock(workspace_id)
        try:
            record = self._load_record(workspace_id)
            now = self.clock()
            if record.state != "reconciling":
                return {"state": record.state, "resolved": False}
            grant = record.grant
            if grant is None:
                record.state = "released"
                self._event(record, "reconciled_no_grant")
                self._save_record(record)
                self._try_promote(record, now)
                self._save_record(record)
                return {"state": "released", "resolved": True}
            alive = self._verifier_alive(grant.owner)
            if alive:
                grant.heartbeat_at = now
                grant.expires_at = now + self.ttl_seconds
                record.state = "active"
                self._event(record, "reconciled_owner_alive", grant.generation)
            else:
                record.state = "released"
                record.grant = None
                self._event(record, "reconciled_owner_dead", grant.generation)
                self._try_promote(record, now)
            self._save_record(record)
            return {"state": record.state, "resolved": True}
        finally:
            os.close(lock_fd)

    def recover_all(self) -> list[str]:
        """On Frank restart: mark every non-terminal record reconciling."""
        reconciled = []
        leases_dir = self.root / "leases"
        if not leases_dir.is_dir():
            return reconciled
        for path in sorted(leases_dir.glob("*.json")):
            workspace_id = path.stem
            try:
                record = self._load_record(workspace_id)
            except LeaseUnavailable:
                reconciled.append(workspace_id)
                continue
            if record.state in {"active", "queued"}:
                lock_fd = self._open_lock(workspace_id)
                try:
                    record.state = "reconciling"
                    self._event(record, "restart_reconciling")
                    self._save_record(record)
                finally:
                    os.close(lock_fd)
                reconciled.append(workspace_id)
        return reconciled
