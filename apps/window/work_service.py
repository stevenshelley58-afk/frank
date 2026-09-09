"""Frank work service: typed task and routine operations over Hermes truth.

Frank owns presentation, scope, and control. Durable task execution lives in
Hermes Kanban; schedules fire only by Hermes's supervised gateway daemon. This
module holds no second task store: the operation ledger below records
Frank-side mutation intent/uncertainty only, never task state. Task operations
run through the injected Kanban adapter port (Session 2's frozen adapter);
workspace resolution runs through the injected private resolver (Session 5);
exclusive workspace leases run through the injected lease service (Session 5).
All three fail closed when unavailable.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

import work_cron
import work_state


class WorkError(RuntimeError):
    """Base error carrying an HTTP-ish status for API mapping."""

    def __init__(self, message: str, status: int = 400, code: str = "work_error"):
        super().__init__(message)
        self.status = status
        self.code = code


class ProjectScopeError(WorkError):
    def __init__(self, message: str, status: int = 403, code: str = "project_scope"):
        super().__init__(message, status=status, code=code)


class NotFoundError(WorkError):
    def __init__(self, message: str = "work item not found"):
        super().__init__(message, status=404, code="not_found")


class ConflictError(WorkError):
    def __init__(self, message: str, code: str = "conflict"):
        super().__init__(message, status=409, code=code)


class UnavailableError(WorkError):
    def __init__(self, message: str):
        super().__init__(message, status=503, code="unavailable")


class MutationUncertain(WorkError):
    """A mutation was sent but its outcome is unknown until reconciled."""

    def __init__(self, message: str, operation_id: str):
        super().__init__(message, status=502, code="mutation_uncertain")
        self.operation_id = operation_id


SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
OPERATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
TITLE_LIMIT = 200
BODY_LIMIT = 8000
PAGE_LIMIT = 50
EVENT_PAGE = 200
DEFAULT_LEASE_TTL = 900


def require_id(value: object, label: str, pattern=TASK_ID) -> str:
    text = str(value or "").strip()
    if not pattern.fullmatch(text):
        raise WorkError(f"invalid {label}", status=400, code="invalid_id")
    return text


def require_plain_text(value: object, label: str, limit: int, *, required: bool = False) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()[:limit]
    if required and not text:
        raise WorkError(f"{label} is required", status=400, code="invalid_field")
    return text


# ---------------------------------------------------------------------------
# Ports (bound to Session 2's adapter and Session 5's services at integration)
# ---------------------------------------------------------------------------


class KanbanPort(Protocol):
    """Frozen operation surface backed by Session 2's Hermes adapter."""

    def create_task(self, payload: dict) -> dict: ...

    def get_task(self, task_id: str) -> dict | None: ...

    def list_tasks(self, filters: dict) -> list[dict]: ...

    def update_task(self, task_id: str, updates: dict) -> dict: ...

    def comment(self, task_id: str, text: str) -> dict: ...

    def attach(self, task_id: str, attachment: dict) -> dict: ...

    def ready(self, task_id: str) -> dict: ...

    def start_task(self, task_id: str) -> dict: ...

    def block(self, task_id: str, reason: str, detail: str) -> dict: ...

    def unblock(self, task_id: str) -> dict: ...

    def request_review(self, task_id: str) -> dict: ...

    def request_changes(self, task_id: str, detail: str) -> dict: ...

    def retry_task(self, task_id: str, prior_attempt_id: str | None) -> dict: ...

    def complete(self, task_id: str) -> dict: ...

    def archive(self, task_id: str) -> dict: ...

    def terminate_run(self, run_id: str) -> dict: ...

    def task_events(self, task_id: str, cursor: int, limit: int) -> dict: ...

    def task_runs(self, task_id: str) -> list[dict]: ...

    def provision_board(self, binding_id: str, default_workdir: str) -> dict: ...

    def verify_board(self, slug: str, default_workdir: str) -> dict: ...


class LeasePort(Protocol):
    def acquire(self, workspace_id: str, operation_id: str, ttl_seconds: int) -> dict: ...

    def heartbeat(self, workspace_id: str, operation_id: str) -> dict: ...

    def release(self, workspace_id: str, operation_id: str) -> dict: ...


class ResolverPort(Protocol):
    def resolve(self, workspace_id: str) -> dict: ...


class AdapterUnavailable(RuntimeError):
    """Raised by a port when Hermes/adapter/lease is unreachable."""


# ---------------------------------------------------------------------------
# Operation ledger (write-ahead mutation intent; never task truth)
# ---------------------------------------------------------------------------


class OperationLedger:
    """Append-only record of Frank-side mutations.

    Statuses: ``pending`` (intent, pre-write), ``applied`` (Hermes confirmed),
    ``uncertain`` (sent but outcome unknown — reconcile by reading Hermes,
    never by blindly repeating), ``conflict`` (rejected as stale).
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()

    def _append(self, record: dict) -> None:
        record["at"] = int(time.time())
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    def begin(self, operation_id: str, kind: str, target: dict) -> None:
        self._append({"operation_id": operation_id, "kind": kind, "target": target, "status": "pending"})

    def applied(self, operation_id: str, detail: dict | None = None) -> None:
        self._append({"operation_id": operation_id, "status": "applied", "detail": detail or {}})

    def uncertain(self, operation_id: str, detail: str) -> None:
        self._append({"operation_id": operation_id, "status": "uncertain", "detail": {"reason": detail[:200]}})

    def conflict(self, operation_id: str, detail: str) -> None:
        self._append({"operation_id": operation_id, "status": "conflict", "detail": {"reason": detail[:200]}})

    def status(self, operation_id: str) -> str | None:
        """Latest status for an operation, or None when unknown."""
        found = None
        if not self.path.exists():
            return None
        with self._lock:
            try:
                lines = self.path.read_text(encoding="utf-8").splitlines()
            except OSError:
                return None
        for line in lines[-2000:]:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("operation_id") == operation_id and record.get("status"):
                found = str(record["status"])
        return found


# ---------------------------------------------------------------------------
# Project scope and board bindings
# ---------------------------------------------------------------------------


@dataclass
class BoardBinding:
    project_id: str
    binding_id: str
    workspace_id: str
    native_slug: str | None = None
    default_workdir: str | None = None
    quarantined: bool = False
    quarantine_reason: str = ""


class BindingStore:
    """Private registry of opaque board bindings (handles, never UI data).

    The mapping is registry data, not task state: task truth stays in Hermes.
    A native board slug never leaves the server.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()

    def _read(self) -> dict:
        if not self.path.exists():
            return {"version": 1, "bindings": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise UnavailableError("board binding registry is unavailable") from error
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("bindings"), dict):
            raise UnavailableError("board binding registry has an unsupported format")
        return data

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(self.path)

    def get(self, project_id: str) -> BoardBinding | None:
        with self._lock:
            record = self._read()["bindings"].get(project_id)
        if not isinstance(record, dict):
            return None
        return BoardBinding(
            project_id=project_id,
            binding_id=str(record.get("binding_id") or ""),
            workspace_id=str(record.get("workspace_id") or ""),
            native_slug=record.get("native_slug"),
            default_workdir=record.get("default_workdir"),
            quarantined=bool(record.get("quarantined")),
            quarantine_reason=str(record.get("quarantine_reason") or ""),
        )

    def save(self, binding: BoardBinding) -> None:
        with self._lock:
            data = self._read()
            data["bindings"][binding.project_id] = {
                "binding_id": binding.binding_id,
                "workspace_id": binding.workspace_id,
                "native_slug": binding.native_slug,
                "default_workdir": binding.default_workdir,
                "quarantined": binding.quarantined,
                "quarantine_reason": binding.quarantine_reason,
            }
            self._write(data)


def new_binding_id(project_id: str) -> str:
    """Opaque stable Frank handle; carries no slug or path material."""
    return f"wb-{uuid.uuid4().hex[:20]}"


# ---------------------------------------------------------------------------
# Task service
# ---------------------------------------------------------------------------


_PASSIVE_STATES = {"triage", "todo", "scheduled", "ready"}


def _field(row: dict, *names: str, default=None):
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    return default


class TaskService:
    def __init__(self, *, project_loader: Callable[[], list[dict]], bindings: BindingStore,
                 kanban: KanbanPort, leases: LeasePort | None, resolver: ResolverPort,
                 ledger: OperationLedger, now: Callable[[], int] = time.time):
        self._projects = project_loader
        self._bindings = bindings
        self._kanban = kanban
        self._leases = leases
        self._resolver = resolver
        self._ledger = ledger
        self._now = now

    # -- scope ---------------------------------------------------------------

    def project(self, project_id: str) -> dict:
        pid = require_id(project_id, "project id", SAFE_ID)
        project = next((item for item in (self._projects() or []) if str(item.get("id")) == pid), None)
        if not project:
            raise ProjectScopeError("unknown project", status=404)
        if project.get("disabled") or project.get("quarantined"):
            raise ProjectScopeError("project is not enabled for work", status=403)
        workspace_id = str(project.get("workspace_id") or "")
        if not workspace_id:
            raise ProjectScopeError("project workspace binding is not migrated yet", status=409,
                                    code="workspace_not_migrated")
        return project

    def _binding(self, project: dict) -> BoardBinding:
        binding = self._bindings.get(str(project["id"]))
        if binding and binding.quarantined:
            raise ProjectScopeError(
                f"project board binding is quarantined: {binding.quarantine_reason or 'mismatch'}",
                status=409, code="binding_quarantined")
        return binding  # type: ignore[return-value]

    def ensure_board(self, project: dict) -> BoardBinding:
        """Idempotently provision/verify the project's private board binding."""
        workspace_id = str(project["workspace_id"])
        binding = self._binding(project)
        resolved = self._resolve_workspace(workspace_id)
        default_workdir = str(resolved.get("workspace_path") or "")
        if not default_workdir:
            raise UnavailableError("workspace resolver returned no canonical path")
        if binding is None:
            binding = BoardBinding(
                project_id=str(project["id"]), binding_id=new_binding_id(str(project["id"])),
                workspace_id=workspace_id, default_workdir=default_workdir)
            self._bindings.save(binding)
        if binding.workspace_id != workspace_id:
            raise ProjectScopeError("board binding does not match the project workspace", status=409)
        try:
            if binding.native_slug:
                verified = self._kanban.verify_board(binding.native_slug, default_workdir)
                if not verified.get("ok"):
                    binding.quarantined = True
                    binding.quarantine_reason = str(verified.get("reason") or "board verification failed")
                    self._bindings.save(binding)
                    raise ProjectScopeError(binding.quarantine_reason, status=409, code="binding_quarantined")
                return binding
            provisioned = self._kanban.provision_board(binding.binding_id, default_workdir)
        except AdapterUnavailable as error:
            raise UnavailableError(f"board service unavailable: {str(error)[:160]}") from None
        slug = str(provisioned.get("slug") or "")
        if not slug:
            raise UnavailableError("board provisioning returned no native board")
        binding.native_slug = slug
        binding.default_workdir = default_workdir
        self._bindings.save(binding)
        return binding

    def _resolve_workspace(self, workspace_id: str) -> dict:
        try:
            resolved = self._resolver.resolve(workspace_id)
        except Exception as error:
            raise UnavailableError(f"workspace resolver unavailable: {str(error)[:160]}") from None
        if not isinstance(resolved, dict) or not resolved.get("workspace_path"):
            raise UnavailableError("workspace resolver returned no mapping")
        return resolved

    # -- projection ----------------------------------------------------------

    def project_row(self, row: dict) -> dict:
        projected = work_state.project_task({
            "id": str(_field(row, "id", default="")),
            "title": str(_field(row, "title", default="")),
            "body": str(_field(row, "body", default=""))[:BODY_LIMIT],
            "state": str(_field(row, "state", "status", default="")),
            "run_state": str(_field(row, "run_state", default="")),
            "assignee": _field(row, "assignee", default=""),
            "priority": _field(row, "priority", default=""),
            "updated_at": _field(row, "updated_at", default=0),
            "created_at": _field(row, "created_at", default=0),
            "triage": bool(row.get("triage")),
            "attempt_id": _field(row, "attempt_id", default=""),
            "run_id": _field(row, "run_id", default=""),
            "revision": _field(row, "revision", default=None),
        })
        return projected

    def _owned_task(self, project: dict, task_id: str) -> dict:
        tid = require_id(task_id, "task id")
        binding = self._binding(project)
        if binding is None or not binding.native_slug:
            raise NotFoundError("project board is not provisioned")
        try:
            row = self._kanban.get_task(tid)
        except Exception as error:
            raise UnavailableError(f"task service unavailable: {str(error)[:160]}") from None
        if not isinstance(row, dict) or not row:
            raise NotFoundError("task not found")
        row_board = str(_field(row, "board", default=""))
        if row_board and row_board != binding.native_slug:
            raise ProjectScopeError("task belongs to another board", status=403, code="wrong_board")
        row_project = str(_field(row, "project_id", default=""))
        if row_project and row_project != str(project["id"]):
            raise ProjectScopeError("task belongs to another project", status=403, code="wrong_project")
        return row

    # -- operations ----------------------------------------------------------

    def list_tasks(self, project_id: str, *, group: str | None = None, search: str | None = None,
                   updated_since: int | None = None, include_archived: bool = False,
                   limit: int = PAGE_LIMIT, before: str | None = None) -> dict:
        project = self.project(project_id)
        limit = max(1, min(int(limit), PAGE_LIMIT))
        filters = {"board": str(self.ensure_board(project).native_slug), "limit": limit + 1}
        if before:
            filters["before"] = require_id(before, "pagination cursor")
        if updated_since:
            filters["updated_since"] = int(updated_since)
        try:
            rows = self._kanban.list_tasks(filters)
        except Exception as error:
            raise UnavailableError(f"task service unavailable: {str(error)[:160]}") from None
        projected = [self.project_row(row) for row in rows if isinstance(row, dict)]
        if group:
            projected = [row for row in projected if row["group"] == group]
        if not include_archived:
            projected = [row for row in projected if not row["hidden_by_default"]]
        if search:
            needle = str(search).strip().lower()
            projected = [row for row in projected
                         if needle in row["title"].lower() or needle in row["body"].lower()]
        next_cursor = ""
        if len(projected) > limit:
            projected = projected[:limit]
            next_cursor = str(projected[-1]["id"]) if projected else ""
        return {"tasks": projected, "next_cursor": next_cursor, "generated_at": self._now()}

    def _require_board_slug(self, project: dict) -> str:
        binding = self._binding(project)
        if binding is None or not binding.native_slug:
            raise NotFoundError("project board is not provisioned")
        return str(binding.native_slug)

    def create_task(self, project_id: str, *, title: object, body: object = "",
                    priority: object = None, skills: Iterable[object] | None = None,
                    attachment_ids: Iterable[object] | None = None,
                    operation_id: object) -> dict:
        project = self.project(project_id)
        op_id = require_id(operation_id, "operation id", OPERATION_ID)
        clean_title = require_plain_text(title, "title", TITLE_LIMIT, required=True)
        clean_body = str(body or "").strip()[:BODY_LIMIT]
        clean_skills = [require_id(item, "skill id", SAFE_ID) for item in (skills or [])][:16]
        clean_attachments = [require_id(item, "attachment id") for item in (attachment_ids or [])][:16]
        binding = self.ensure_board(project)
        resolved = self._resolve_workspace(str(project["workspace_id"]))
        payload = {
            # Frozen create payload (contract §7). The resolver supplies the
            # canonical workspace path; the caller can never supply a path.
            "title": clean_title,
            "body": clean_body,
            "assignee": "default",
            "triage": True,
            "workspace_kind": "dir",
            "workspace_path": str(resolved["workspace_path"]),
            "board": binding.native_slug,
            "project_id": str(project["id"]),
            "idempotency_key": op_id,
        }
        if priority is not None:
            payload["priority"] = require_plain_text(priority, "priority", 40)
        if clean_skills:
            payload["skills"] = clean_skills
        if clean_attachments:
            payload["attachment_ids"] = clean_attachments
        prior = self._ledger.status(op_id)
        if prior == "applied":
            raise ConflictError("this operation id was already applied", code="duplicate_operation")
        if prior == "uncertain":
            raise MutationUncertain(
                "a prior attempt of this operation is uncertain; reconcile before retrying", op_id)
        self._ledger.begin(op_id, "task.create", {"project_id": str(project["id"]), "title": clean_title})
        try:
            created = self._kanban.create_task(payload)
        except Exception as error:
            self._ledger.uncertain(op_id, f"adapter unavailable: {str(error)[:140]}")
            raise MutationUncertain(f"task create is uncertain: {str(error)[:140]}", op_id) from None
        row = created.get("task") if isinstance(created, dict) else None
        if not isinstance(row, dict) or not row:
            self._ledger.uncertain(op_id, "create response lacked a task row")
            raise MutationUncertain("task create is uncertain: empty response", op_id)
        task_id = str(_field(row, "id", default=""))
        if not task_id:
            self._ledger.uncertain(op_id, "create response lacked a task id")
            raise MutationUncertain("task create is uncertain: no task id", op_id)
        self._ledger.applied(op_id, {"task_id": task_id})
        # R1: the passive/no-worker verification runs only here, immediately
        # after creation — never after start/block/update/review mutations.
        verified = self._verify_passive(project, task_id)
        return verified

    def _verify_passive(self, project: dict, task_id: str) -> dict:
        row = self._owned_task(project, task_id)
        projected = self.project_row(row)
        if projected["native_state"] not in _PASSIVE_STATES or bool(row.get("triage")) is not True:
            raise WorkError(
                f"created task is not passive (native state {projected['native_state'] or 'unknown'})",
                status=502, code="create_not_passive")
        worker = _field(row, "worker", "worker_id", default="")
        if worker:
            raise WorkError("created task already has a worker", status=502, code="create_has_worker")
        return projected

    def get_task(self, project_id: str, task_id: str) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        return self.project_row(row)

    def task_detail(self, project_id: str, task_id: str) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        detail = self.project_row(row)
        detail["comments"] = [item for item in (row.get("comments") or []) if isinstance(item, dict)][-50:]
        detail["attachments"] = [
            {"id": item.get("id"), "name": item.get("name"), "mime": item.get("mime"), "size": item.get("size")}
            for item in (row.get("attachments") or []) if isinstance(item, dict)
        ][-50:]
        detail["attempts"] = [item for item in (row.get("attempts") or []) if isinstance(item, dict)][-20:]
        detail["dependencies"] = [str(item) for item in (row.get("parents") or row.get("dependencies") or [])][:20]
        try:
            detail["runs"] = [item for item in self._kanban.task_runs(str(row["id"])) if isinstance(item, dict)][-20:]
        except Exception as error:
            detail["runs"] = []
            detail["runs_unavailable"] = str(error)[:160]
        return detail

    def _mutate(self, project: dict, op_kind: str, task_id: str, mutation: Callable[[], dict],
                operation_id: str | None = None) -> dict:
        """Run one mutation with ledger coverage and post-read reconciliation."""
        op_id = require_id(operation_id, "operation id", OPERATION_ID) if operation_id else f"op-{uuid.uuid4().hex}"
        prior = self._ledger.status(op_id)
        if prior == "applied":
            raise ConflictError("this operation id was already applied", code="duplicate_operation")
        if prior == "uncertain":
            raise MutationUncertain("a prior attempt of this operation is uncertain; reconcile by reading the task", op_id)
        self._ledger.begin(op_id, op_kind, {"task_id": task_id})
        try:
            result = mutation()
        except Exception as error:
            self._ledger.uncertain(op_id, f"adapter unavailable: {str(error)[:140]}")
            raise MutationUncertain(f"{op_kind} is uncertain: {str(error)[:140]}", op_id) from None
        self._ledger.applied(op_id, {"task_id": task_id})
        row = self._owned_task(project, task_id)
        projected = self.project_row(row)
        return {"operation_id": op_id, "task": projected, "result": result if isinstance(result, dict) else {}}

    def update_task(self, project_id: str, task_id: str, *, title: object = None,
                    body: object = None, priority: object = None,
                    expected_revision: object = None, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        if row.get("state") not in {"triage", "todo", "scheduled", "ready", "blocked"}:
            raise ConflictError("task metadata can change only while it is not running or reviewing")
        updates: dict[str, Any] = {}
        if title is not None:
            updates["title"] = require_plain_text(title, "title", TITLE_LIMIT, required=True)
        if body is not None:
            updates["body"] = str(body).strip()[:BODY_LIMIT]
        if priority is not None:
            updates["priority"] = require_plain_text(priority, "priority", 40)
        if not updates:
            raise WorkError("no permitted metadata changes were supplied", status=400)
        native_revision = _field(row, "revision", default=None)
        if expected_revision is not None and native_revision is not None:
            if str(expected_revision) != str(native_revision):
                self._ledger.conflict(f"upd-{uuid.uuid4().hex}", "stale update")
                raise ConflictError("task changed since it was read; reload and retry", code="stale_revision")
        return self._mutate(
            project, "task.update", str(row["id"]),
            lambda: self._kanban.update_task(str(row["id"]), updates), operation_id)

    def _lease_or_fail(self, project: dict, op_kind: str) -> str:
        """Acquire the exclusive workspace lease; fail closed on any trouble."""
        if self._leases is None:
            raise UnavailableError("workspace lease service is not configured")
        op_id = f"lease-{uuid.uuid4().hex}"
        try:
            result = self._leases.acquire(str(project["workspace_id"]), op_id, DEFAULT_LEASE_TTL)
        except Exception as error:  # port exceptions are adapter-defined; fail closed
            raise UnavailableError(f"workspace lease unavailable: {str(error)[:160]}") from None
        if not result.get("granted"):
            raise ConflictError(
                "the project workspace is busy; the request stays queued", code="workspace_busy")
        return op_id

    def start_task(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        if str(_field(row, "state", "status", default="")) != "ready":
            raise ConflictError("only a ready task can start")
        lease_op = self._lease_or_fail(project, "task.start")
        try:
            outcome = self._mutate(project, "task.start", str(row["id"]),
                                   lambda: self._kanban.start_task(str(row["id"])), operation_id)
        finally:
            try:
                self._leases.release(str(project["workspace_id"]), lease_op)
            except Exception:
                pass  # lease TTL/expiry and the gateway hook remain the guards
        return outcome

    def mark_ready(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        if str(_field(row, "state", "status", default="")) not in {"triage", "todo", "scheduled"}:
            raise ConflictError("only a triaged task can be marked ready")
        return self._mutate(project, "task.ready", str(row["id"]),
                            lambda: self._kanban.ready(str(row["id"])), operation_id)

    def comment(self, project_id: str, task_id: str, text: object, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        clean = require_plain_text(text, "comment", 2000, required=True)
        return self._mutate(project, "task.comment", str(row["id"]),
                            lambda: self._kanban.comment(str(row["id"]), clean), operation_id)

    def attach(self, project_id: str, task_id: str, attachment_id: object,
               operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        aid = require_id(attachment_id, "attachment id")
        return self._mutate(project, "task.attach", str(row["id"]),
                            lambda: self._kanban.attach(str(row["id"]), {"id": aid}), operation_id)

    def block(self, project_id: str, task_id: str, reason: object, detail: object = "",
              operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        clean_reason = require_plain_text(reason, "reason", 80, required=True)
        clean_detail = require_plain_text(detail, "detail", 2000)
        return self._mutate(project, "task.block", str(row["id"]),
                            lambda: self._kanban.block(str(row["id"]), clean_reason, clean_detail), operation_id)

    def unblock(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        if str(_field(row, "state", "status", default="")) != "blocked":
            raise ConflictError("only a blocked task can be unblocked")
        return self._mutate(project, "task.unblock", str(row["id"]),
                            lambda: self._kanban.unblock(str(row["id"])), operation_id)

    def request_review(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        if str(_field(row, "state", "status", default="")) != "running":
            raise ConflictError("only a running task can request review")
        return self._mutate(project, "task.review", str(row["id"]),
                            lambda: self._kanban.request_review(str(row["id"])), operation_id)

    def request_changes(self, project_id: str, task_id: str, detail: object,
                        operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        if str(_field(row, "state", "status", default="")) != "review":
            raise ConflictError("only a task in review can receive change requests")
        clean = require_plain_text(detail, "detail", 2000, required=True)
        return self._mutate(project, "task.changes", str(row["id"]),
                            lambda: self._kanban.request_changes(str(row["id"]), clean), operation_id)

    def retry_task(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        state = str(_field(row, "state", "status", default=""))
        if state not in {"done", "failed", "cancelled"} and str(row.get("run_state") or "") not in {"failed", "cancelled"}:
            raise ConflictError("only a failed, cancelled, or completed task can retry")
        prior_attempt = str(_field(row, "attempt_id", default="") or "")
        lease_op = self._lease_or_fail(project, "task.retry")
        try:
            outcome = self._mutate(
                project, "task.retry", str(row["id"]),
                lambda: self._kanban.retry_task(str(row["id"]), prior_attempt or None), operation_id)
        finally:
            try:
                self._leases.release(str(project["workspace_id"]), lease_op)
            except Exception:
                pass
        return outcome

    def complete_task(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        state = str(_field(row, "state", "status", default=""))
        if work_state.task_group(state) not in {"waiting", "running"} and state != "review":
            raise ConflictError("only a running or reviewing task can complete")
        evidence_present = bool(row.get("attachments") or row.get("evidence") or row.get("attempts"))
        if not evidence_present:
            raise ConflictError("required evidence is missing; a task cannot complete without it",
                                code="evidence_missing")
        return self._mutate(project, "task.complete", str(row["id"]),
                            lambda: self._kanban.complete(str(row["id"])), operation_id)

    def archive_task(self, project_id: str, task_id: str, operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        return self._mutate(project, "task.archive", str(row["id"]),
                            lambda: self._kanban.archive(str(row["id"])), operation_id)

    def terminate_run(self, project_id: str, task_id: str, run_id: object,
                      operation_id: str | None = None) -> dict:
        project = self.project(project_id)
        row = self._owned_task(project, task_id)
        rid = require_id(run_id, "run id")
        active_run = str(_field(row, "run_id", default="") or "")
        known_runs = {str(item.get("id") or "") for item in (row.get("runs") or []) if isinstance(item, dict)}
        if active_run != rid and rid not in known_runs:
            raise ProjectScopeError("run does not belong to this task", status=403, code="wrong_run")
        outcome = self._mutate(project, "task.terminate", str(row["id"]),
                               lambda: self._kanban.terminate_run(rid), operation_id)
        refreshed = self._owned_task(project, task_id)
        run_state = str(_field(refreshed, "run_state", default=""))
        # Stop remains stopping until Hermes confirms the process exited.
        if run_state in {"running", "stopping", "starting"}:
            outcome["result"]["termination"] = "stopping"
            outcome["result"]["run_state"] = run_state
        else:
            outcome["result"]["termination"] = run_state or "confirmed"
        return outcome

    def task_events(self, project_id: str, task_id: str, cursor: int, limit: int = EVENT_PAGE) -> dict:
        """One bounded page of native task events, projected to the envelope."""
        project = self.project(project_id)
        self._owned_task(project, task_id)
        cursor = max(0, int(cursor))
        limit = max(1, min(int(limit), EVENT_PAGE))
        try:
            page = self._kanban.task_events(task_id, cursor, limit)
        except Exception as error:
            raise UnavailableError(f"task events unavailable: {str(error)[:160]}") from None
        events = [normalize_event(item) for item in (page.get("events") or []) if isinstance(item, dict)]
        return {"events": events, "cursor": int(page.get("cursor") or cursor),
                "complete": bool(page.get("complete", len(events) < limit))}

    def drain_events(self, project_id: str, task_id: str, cursor: int) -> dict:
        """Drain full backlog in EVENT_PAGE pages; persist the cursor only
        after projection. Live wait is the caller's concern after this."""
        events: list[dict] = []
        current = max(0, int(cursor))
        while True:
            page = self.task_events(project_id, task_id, current, EVENT_PAGE)
            events.extend(page["events"])
            current = page["cursor"]
            if page["complete"] or not page["events"]:
                break
        return {"events": events, "cursor": current}


def normalize_event(raw: dict) -> dict:
    """Map one native event into the contract §3 envelope, exactly once.

    Unknown native events are retained verbatim under ``derived_label:
    "unknown"`` — never dropped, never guessed.
    """
    native = str(raw.get("native_event") or raw.get("event") or raw.get("kind") or "")
    mapping = {
        "task.created": "tool_progress",
        "task.updated": "tool_progress",
        "task.completed": "terminal_event",
        "task.blocked": "tool_progress",
        "task.review": "tool_progress",
        "run.started": "tool_progress",
        "run.progress": "tool_progress",
        "run.completed": "terminal_event",
        "run.failed": "terminal_error",
        "run.cancelled": "terminal_event",
        "worker.heartbeat": "tool_progress",
        "todo.updated": "todo_updated",
        "subagent.started": "subagent_lifecycle",
        "subagent.finished": "subagent_lifecycle",
    }
    return {
        "seq": raw.get("seq") if isinstance(raw.get("seq"), int) else 0,
        "native_event": native,
        "derived_label": mapping.get(native, "unknown"),
        "run_id": str(raw.get("run_id") or ""),
        "session_id": str(raw.get("session_id") or ""),
        "timestamp": raw.get("timestamp") if isinstance(raw.get("timestamp"), (int, float)) else 0,
        "payload": raw.get("payload") if isinstance(raw.get("payload"), dict) else {},
        "frank_origin": False,
    }
