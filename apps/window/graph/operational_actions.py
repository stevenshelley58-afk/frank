"""Typed Step 6B operational actions.

This module is deliberately transport neutral.  Canonical runbooks remain the
authority: callers inject a transport which exposes named operations, rather
than passing commands or shell fragments.  The service supplies the common
plan/confirm/apply, Hermes authorization, lock, timeout, idempotency and
receipt semantics.
"""
from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any, Callable, Mapping, Protocol

from .control_plane import canonical_bytes
from .safe_actions import ActionError, ActionRegistry, ImmutableReceiptStore, _iso, _now, _stable, _KEY, _REV, _SHA, _digest

OPERATIONAL_ACTIONS = frozenset({
    "tool:deploy-frank", "tool:rollback-frank", "tool:deploy-blockwise",
    "tool:rollback-blockwise", "tool:restart-service", "tool:run-job",
    "tool:retry-job", "tool:cancel-job", "tool:run-ad-template-builder",
    "tool:retry-ad-template-builder", "tool:cancel-ad-template-builder",
})
DEPLOYS = frozenset({"tool:deploy-frank", "tool:deploy-blockwise"})
ROLLBACKS = frozenset({"tool:rollback-frank", "tool:rollback-blockwise"})
JOB_RUNS = frozenset({"tool:run-job", "tool:run-ad-template-builder"})
JOB_RETRIES = frozenset({"tool:retry-job", "tool:retry-ad-template-builder"})
CANCELS = frozenset({"tool:cancel-job", "tool:cancel-ad-template-builder"})


class OperationalTransport(Protocol):
    def deploy(self, target_id: str, revision: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...
    def rollback(self, target_id: str, revision: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...
    def restart(self, service_id: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...
    def run_job(self, job_type: str, target_id: str, arguments: Mapping[str, Any], *, timeout_seconds: int) -> Mapping[str, Any]: ...
    def cancel_job(self, run_id: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...
    def inspect(self, target_id: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...


class OperationalHooks(Protocol):
    def after_operation(self, target_id: str, result: Mapping[str, Any]) -> Mapping[str, Any]: ...


class OperationalActionService:
    """Execute only declared Step 6B actions through a named transport."""

    def __init__(self, registry: ActionRegistry, hermes: Any, transports: Mapping[str, OperationalTransport], receipts: ImmutableReceiptStore, *, hooks: OperationalHooks | None = None, authority_id: str = "runtime:hermes-default", now: Callable[[], Any] = _now):
        self.registry, self.hermes, self.transports, self.receipts = registry, hermes, dict(transports), receipts
        self.hooks, self.authority_id, self.now = hooks, _stable(authority_id, "Hermes authority ID"), now
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _definition(self, action_id: str) -> dict[str, Any]:
        if action_id not in OPERATIONAL_ACTIONS:
            raise ActionError("unknown or unavailable operational action")
        # ActionRegistry's Step 6A resolver intentionally exposes only its two
        # report-only actions.  Step 6B reads the same validated definitions,
        # with its own explicit allowlist and feature flag.
        action = self.registry.actions.get(action_id)
        if action is None or (not self.registry.enabled and not action.get("enabled", False)):
            raise ActionError("operational actions are disabled")
        return action

    @staticmethod
    def _args(action_id: str, arguments: Mapping[str, Any], definition: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(arguments, Mapping):
            raise ActionError("typed action arguments are required")
        result = dict(arguments)
        if not isinstance(result.get("idempotency_key"), str) or not _KEY.fullmatch(result["idempotency_key"]):
            raise ActionError("a valid idempotency key is required")
        if action_id in DEPLOYS | ROLLBACKS:
            field = "commit" if action_id in DEPLOYS else "prior_revision"
            if not isinstance(result.get(field), str) or not _REV.fullmatch(result[field]):
                raise ActionError("an exact release revision is required")
        if action_id in JOB_RUNS and not isinstance(result.get("job_type" if action_id == "tool:run-job" else "template_id"), str):
            raise ActionError("job type or template ID is required")
        if action_id == "tool:restart-service" and not isinstance(result.get("service_id"), str):
            raise ActionError("service_id is required")
        if action_id in JOB_RETRIES:
            for field in ("parent_run_id", "failed_action_receipt_id"):
                if not isinstance(result.get(field), str):
                    raise ActionError(f"{field} is required")
                _stable(result[field], field)
        if action_id in CANCELS:
            value = result.get("run_id")
            if not isinstance(value, str):
                raise ActionError("run_id is required")
            _stable(value, "run_id")
        if definition is not None:
            declared = definition.get("arguments", {})
            if not isinstance(declared, Mapping) or set(result) - set(declared):
                raise ActionError("action arguments are not declared")
            for field, value in result.items():
                spec = declared.get(field)
                if not isinstance(spec, Mapping):
                    raise ActionError(f"argument {field} is not declared")
                kind = spec.get("type")
                if kind == "enum" and value not in spec.get("values", []):
                    raise ActionError(f"argument {field} is not allowlisted")
                if kind == "stable_id":
                    _stable(value, field)
                elif kind == "revision" and (not isinstance(value, str) or not _REV.fullmatch(value)):
                    raise ActionError(f"argument {field} is not an exact revision")
                elif kind == "idempotency_key" and (not isinstance(value, str) or not _KEY.fullmatch(value)):
                    raise ActionError("a valid idempotency key is required")
        return result

    def plan(self, *, action_id: str, target_id: str, arguments: Mapping[str, Any], base_revision: str | None = None, actor: str = "operator") -> dict[str, Any]:
        action = self._definition(action_id)
        target = _stable(target_id, "target ID")
        if target not in action["target_allowlist"]:
            raise ActionError("target is not allowlisted")
        args = self._args(action_id, arguments, action)
        fingerprint = _digest({"action_id": action_id, "target_id": target, "arguments": args, "base_revision": base_revision})
        replay = self.receipts.find(args["idempotency_key"], fingerprint)
        transport = self.transports.get(action["adapter_id"])
        if transport is None:
            raise ActionError("operational adapter is unavailable")
        if not _SHA.fullmatch(str(action.get("adapter_hash") or "")):
            raise ActionError("operational adapter hash is unavailable")
        return {"plan_id": "plan:" + uuid.uuid4().hex, "action_id": action_id, "target_id": target, "arguments": args, "base_revision": base_revision, "actor": actor, "fingerprint": fingerprint, "lock_key": action.get("lock_key", target), "adapter_id": action["adapter_id"], "adapter_version": action.get("adapter_version"), "adapter_hash": action.get("adapter_hash"), "rollback_action_id": action.get("rollback_action_id"), "requested_revision": args.get("commit") or args.get("prior_revision"), "confirmation_summary": {"action": action_id, "target": target, "revision": args.get("commit") or args.get("prior_revision"), "rollback": action.get("rollback_action_id")}, "replayed": replay is not None, "receipt": replay}

    def confirm(self, plan: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(plan, Mapping) or plan.get("action_id") not in OPERATIONAL_ACTIONS:
            raise ActionError("malformed operational plan")
        return {"plan": dict(plan), "confirmed": True}

    def _call(self, fn: Callable[..., Mapping[str, Any]], *args: Any, timeout: int, **kwargs: Any) -> Mapping[str, Any]:
        pool = ThreadPoolExecutor(max_workers=1)
        future = pool.submit(fn, *args, **kwargs)
        try:
            value = future.result(timeout=timeout)
        except FutureTimeout as error:
            future.cancel()
            pool.shutdown(wait=False, cancel_futures=True)
            raise ActionError("operational action timed out") from error
        else:
            pool.shutdown(wait=True)
        if not isinstance(value, Mapping):
            raise ActionError("operational adapter returned an invalid result")
        return value

    def apply(self, confirmation: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(confirmation, Mapping) or confirmation.get("confirmed") is not True:
            raise ActionError("one confirmation is required")
        plan = confirmation.get("plan")
        if not isinstance(plan, Mapping):
            raise ActionError("malformed operational plan")
        action_id, target = str(plan.get("action_id")), str(plan.get("target_id"))
        action = self._definition(action_id)
        target = _stable(target, "target ID")
        if target not in action.get("target_allowlist", []):
            raise ActionError("target is not allowlisted")
        args = self._args(action_id, plan.get("arguments", {}), action)
        if action_id == "tool:restart-service" and args.get("service_id") != target:
            raise ActionError("service target does not match service_id")
        if plan.get("adapter_id") != action.get("adapter_id") or plan.get("adapter_version") != action.get("adapter_version") or plan.get("adapter_hash") != action.get("adapter_hash"):
            raise ActionError("action adapter metadata does not match the definition")
        if plan.get("fingerprint") != _digest({"action_id": action_id, "target_id": target, "arguments": args, "base_revision": plan.get("base_revision")}):
            raise ActionError("plan fingerprint mismatch")
        replay = self.receipts.find(args["idempotency_key"], str(plan["fingerprint"]))
        if replay:
            return {"receipt": replay, "replayed": True}
        lock_key = str(plan.get("lock_key") or target)
        lock = self._lock(lock_key)
        if not lock.acquire(blocking=False):
            raise ActionError("action lock is busy")
        transport = self.transports.get(action["adapter_id"])
        if transport is None:
            lock.release(); raise ActionError("operational adapter is unavailable")
        timeout = max(1, min(3600, int(action.get("timeout_seconds", 1800))))
        started = self.now(); before_id = "receipt:action-before/" + uuid.uuid4().hex
        outcome, rollback_outcome, after_id = "fail", "not_attempted", None
        try:
            inspection = self._call(transport.inspect, target, timeout_seconds=min(timeout, 30), timeout=min(timeout, 30))
            if inspection.get("hermes_available") is False:
                raise ActionError("Hermes is unavailable")
            authorization = self.hermes.request(action_id=action_id, target_id=target, arguments=args, timeout_seconds=timeout)
            if not isinstance(authorization, Mapping) or authorization.get("authorized") is not True:
                raise ActionError("Hermes authorization failed")
            if plan.get("base_revision") is not None and inspection.get("revision") not in (None, plan["base_revision"]):
                raise ActionError("stale target revision")
            if inspection.get("dirty") is True:
                raise ActionError("target checkout is dirty")
            if action_id in DEPLOYS:
                result = self._call(transport.deploy, target, args["commit"], timeout_seconds=timeout, timeout=timeout)
            elif action_id in ROLLBACKS:
                result = self._call(transport.rollback, target, args["prior_revision"], timeout_seconds=timeout, timeout=timeout)
            elif action_id == "tool:restart-service":
                result = self._call(transport.restart, target, timeout_seconds=timeout, timeout=timeout)
            elif action_id in JOB_RUNS | JOB_RETRIES:
                job_type = args.get("job_type") or args.get("template_id")
                result = self._call(transport.run_job, job_type, target, args, timeout_seconds=timeout, timeout=timeout)
            else:
                result = self._call(transport.cancel_job, args["run_id"], timeout_seconds=timeout, timeout=timeout)
            if result.get("ok") is False:
                raise ActionError("operational adapter failed")
            if (action_id in DEPLOYS | ROLLBACKS | frozenset({"tool:restart-service"})
                    and (result.get("health") is False or result.get("health_checked") is False)):
                if action_id in DEPLOYS and plan.get("base_revision"):
                    try:
                        rollback = self._call(transport.rollback, target, plan["base_revision"], timeout_seconds=timeout, timeout=timeout)
                        rollback_outcome = "succeeded" if rollback.get("ok", True) else "failed"
                    except ActionError:
                        rollback_outcome = "failed"
                    outcome = "partial" if rollback_outcome == "succeeded" else "fail"
                raise ActionError("post-action health check failed")
            if action_id in DEPLOYS | ROLLBACKS | frozenset({"tool:restart-service"}):
                after = self._call(transport.inspect, target, timeout_seconds=min(timeout, 30), timeout=min(timeout, 30))
                if after.get("health") is not True:
                    raise ActionError("after-action health check failed")
            elif "terminal_state_recorded" in action.get("postconditions", ()) and result.get("terminal_state_recorded") is not True:
                raise ActionError("terminal job state was not recorded")
            after_id = "receipt:action-after/" + uuid.uuid4().hex
            if self.hooks:
                self.hooks.after_operation(target, result)
            outcome = "pass"
        except Exception:
            if outcome != "partial": outcome = "fail"
        finally:
            lock.release()
        completed = self.now()
        receipt = {"id": "receipt:action/" + uuid.uuid4().hex, "kind": "action", "subject_ids": [target], "producer": self.authority_id, "source_revision_set": {"base": str(plan.get("base_revision") or "unknown")}, "deployed_revision_set": {"target": str(args.get("commit") or args.get("prior_revision") or "unknown")}, "captured_at": _iso(completed), "fresh_until": _iso(completed), "outcome": outcome, "evidence_uris": [before_id] + ([after_id] if after_id else []), "redaction": "secret_filtered", "action_id": action_id, "adapter_id": action["adapter_id"], "adapter_version": str(plan.get("adapter_version") or action.get("adapter_version") or "1.0.0"), "adapter_hash": str(plan.get("adapter_hash") or action.get("adapter_hash") or "sha256:" + "0" * 64), "target_id": target, "target_revision_before": plan.get("base_revision"), "target_revision_requested": args.get("commit") or args.get("prior_revision"), "idempotency_key": args["idempotency_key"], "lock_key": lock_key, "started_at": _iso(started), "completed_at": _iso(completed), "before_state_receipt_id": before_id, "after_state_receipt_id": after_id, "preconditions": [{"name": "target_declared", "outcome": "pass"}], "postconditions": [{"name": "health_checked", "outcome": "pass" if outcome == "pass" else "fail"}], "rollback_action_id": action.get("rollback_action_id"), "rollback_outcome": rollback_outcome}
        return {"receipt": self.receipts.write(receipt, key=args["idempotency_key"], fingerprint=str(plan["fingerprint"])), "replayed": False}


__all__ = ["OPERATIONAL_ACTIONS", "OperationalActionService", "OperationalTransport"]
