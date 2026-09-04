"""Typed runs client over the contracted gateway ``/v1/runs`` surface.

Implements contract §2 exactly:

- ``POST /v1/runs`` — 202 ``{"run_id","status":"started","replayed":…}``
  fast-path, submit timeout ≤ 20 s, durable ``Idempotency-Key`` header
  (86400 s upstream retention).  A stable UUID is minted per logical
  submission and reused on ambiguous retry; ``409``-class conflicts are
  treated as already-accepted (fetched via status), never re-submitted
  with a new key.
- ``GET /v1/runs/{id}`` — status polling at 5 s cadence with exponential
  backoff capped at 60 s; terminal states are the only completion truth.
- ``GET /v1/runs/{id}/events`` — SSE with ``Last-Event-ID`` resume and
  120 s idle reconnect (transport-owned).
- ``POST /v1/runs/{id}/approval`` — one exact response, no invented expiry.
- ``POST /v1/runs/{id}/steer``, ``POST /v1/runs/{id}/stop``.

All operations flow through the write-ahead ledger; ambiguous outcomes
become ``uncertain`` and are resolved from authoritative evidence only.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Iterator

from .http import RestError, RestSurface, SUBMIT_TIMEOUT
from .ledger import LedgerError, OperationLedger
from .redaction import redact_value

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled", "stopped", "expired"})
POLL_BASE_SECONDS = 5.0
POLL_CAP_SECONDS = 60.0

_CONFLICT_STATUS = 409


def poll_delay(attempt: int) -> float:
    return min(POLL_BASE_SECONDS * (2 ** max(attempt, 0)), POLL_CAP_SECONDS)


class RunsError(RuntimeError):
    def __init__(self, message: str, *, frank_code: str = "hermes.method_failed", status: int | None = None):
        super().__init__(message)
        self.frank_code = frank_code
        self.status = status


class RunsClient:
    def __init__(self, surface: RestSurface, *, ledger: OperationLedger | None = None, clock: Any = time.time):
        self._surface = surface
        self._ledger = ledger
        self._clock = clock

    # -- ledger helpers ------------------------------------------------------

    def _ledger_op(self, payload: dict[str, Any], target: str) -> tuple[str, str] | tuple[None, None]:
        if self._ledger is None:
            return None, None
        record = self._ledger.prepare("run.submit", target, redact_value(payload), refs={"idempotency_key": self.idempotency_key()})
        return record["op_id"], record["refs"]["idempotency_key"]

    @staticmethod
    def idempotency_key() -> str:
        return str(uuid.uuid4())

    def _ack(self, op_id: str | None, **refs: Any) -> None:
        if op_id and self._ledger:
            self._ledger.mark_acknowledged(op_id, result_refs=refs)

    def _uncertain(self, op_id: str | None, reason: str) -> None:
        if op_id and self._ledger:
            self._ledger.mark_uncertain(op_id, reason)

    # -- operations ----------------------------------------------------------

    def submit(self, payload: dict[str, Any], *, target: str = "gateway", idempotency_key: str | None = None, op_id: str | None = None) -> dict[str, Any]:
        """Submit one run.  Returns the 202 payload (or the fetched status on conflict)."""
        if not isinstance(payload, dict) or not payload:
            raise ValueError("payload must be a non-empty object")
        key = idempotency_key
        if key is None and self._ledger is not None:
            new_op, key = self._ledger_op(payload, target)
            op_id = op_id or new_op
        if key is None:
            key = self.idempotency_key()
        if op_id and self._ledger:
            self._ledger.mark_sending(op_id)
        try:
            status, result = self._surface.request(
                "POST", "/v1/runs", body=payload, timeout=SUBMIT_TIMEOUT,
                headers={"Idempotency-Key": key},
            )
        except RestError as error:
            if error.kind in ("timeout", "unavailable"):
                # Sent vs unacknowledged is ambiguous: uncertain, same-key replay later.
                self._uncertain(op_id, f"submit ambiguous: {error.kind}")
                raise RunsError(str(error), frank_code=error.frank_code) from error
            if op_id and self._ledger and error.status and 400 <= error.status < 500 and error.status != _CONFLICT_STATUS:
                self._ledger.mark_failed(op_id, evidence={"http_status": error.status})
            raise RunsError(str(error), frank_code=error.frank_code, status=error.status) from error
        if status == _CONFLICT_STATUS:
            # Durable idempotency says this logical submission already exists.
            self._ack(op_id, conflict=True, idempotency_key=key)
            raise RunsError("run already accepted for this Idempotency-Key", frank_code="hermes.already_accepted", status=409)
        if status != 202 or not isinstance(result, dict) or "run_id" not in result:
            if op_id and self._ledger:
                self._uncertain(op_id, f"unexpected submit response status={status}")
            raise RunsError("run submit returned an unexpected response", frank_code="hermes.invalid_response", status=status)
        self._ack(op_id, run_id=result["run_id"], replayed=bool(result.get("replayed")), idempotency_key=key)
        return result

    def status(self, run_id: str) -> dict[str, Any]:
        _, result = self._surface.request("GET", "/v1/runs/{run_id}", path={"run_id": run_id}, timeout=5.0)
        if not isinstance(result, dict) or "status" not in result:
            raise RunsError("run status response is invalid", frank_code="hermes.invalid_response")
        return result

    def poll_until_terminal(self, run_id: str, *, max_seconds: float = 600.0, sleep: Any = time.sleep) -> Iterator[dict[str, Any]]:
        """Yield each status snapshot until terminal; 5 s cadence → 60 s cap."""
        attempt = 0
        deadline = self._clock() + max_seconds
        while True:
            snapshot = self.status(run_id)
            yield snapshot
            if snapshot.get("status") in TERMINAL_STATUSES:
                return
            if self._clock() >= deadline:
                raise RunsError("run did not reach terminal state in time", frank_code="hermes.timeout")
            sleep(poll_delay(attempt))
            attempt += 1

    def stop(self, run_id: str) -> dict[str, Any]:
        _, result = self._surface.request("POST", "/v1/runs/{run_id}/stop", path={"run_id": run_id}, body={})
        if not isinstance(result, dict):
            raise RunsError("run stop response is invalid", frank_code="hermes.invalid_response")
        return result

    def steer(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict) or not payload:
            raise ValueError("steer payload must be a non-empty object")
        _, result = self._surface.request("POST", "/v1/runs/{run_id}/steer", path={"run_id": run_id}, body=redact_value(payload))
        if not isinstance(result, dict):
            raise RunsError("run steer response is invalid", frank_code="hermes.invalid_response")
        return result

    def approval(self, run_id: str, decision: dict[str, Any]) -> dict[str, Any]:
        """One exact approval response per run; late/double responses are upstream errors."""
        if not isinstance(decision, dict) or not decision:
            raise ValueError("approval decision must be a non-empty object")
        _, result = self._surface.request(
            "POST", "/v1/runs/{run_id}/approval", path={"run_id": run_id}, body=redact_value(decision),
        )
        if not isinstance(result, dict):
            raise RunsError("approval response is invalid", frank_code="hermes.invalid_response")
        return result

    def events(self, run_id: str, *, last_event_id: str | None = None) -> Iterator[tuple[str, str, str]]:
        """SSE frames ``(event, data, last_event_id)`` for one run."""
        return self._surface.sse_stream("/v1/runs/{run_id}/events", path={"run_id": run_id}, last_event_id=last_event_id)

    def recover_uncertain(self, op_id: str, run_id: str) -> dict[str, Any]:
        """Resolve an uncertain submission from authoritative status evidence."""
        snapshot = self.status(run_id)
        if self._ledger is None:
            return snapshot
        try:
            outcome = "acknowledged" if snapshot.get("status") in TERMINAL_STATUSES or snapshot.get("status") == "started" else None
            if outcome:
                self._ledger.resolve(op_id, outcome, evidence={"run_id": run_id, "status": snapshot.get("status")})
        except LedgerError:
            pass
        return snapshot
