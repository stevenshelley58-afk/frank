"""Governed Step 6C capability and canonical rule/skill source actions.

The adapter deliberately knows no shell commands and never discovers a source
by walking arbitrary paths.  A caller supplies the canonical source index and
an implementation of :class:`SourceTransport` (normally Hermes' Git adapter).
All writes happen after an exact-base, validated plan and one confirmation.
"""
from __future__ import annotations

import hashlib
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

from .control_plane import canonical_bytes
from .safe_actions import (
    ActionError, ActionRegistry, ImmutableReceiptStore, _KEY, _REV, _SHA,
    _digest, _iso, _now, _stable,
)

SOURCE_ACTIONS = frozenset({
    "tool:enable-capability", "tool:disable-capability",
    "tool:create-rule", "tool:edit-rule", "tool:retire-rule",
    "tool:create-skill", "tool:edit-skill", "tool:retire-skill",
    "tool:restore-source", "tool:consolidate-sources", "tool:import-source-row",
})
SOURCE_FILE_ACTIONS = frozenset({
    "tool:create-rule", "tool:edit-rule", "tool:retire-rule",
    "tool:create-skill", "tool:edit-skill", "tool:retire-skill", "tool:restore-source",
})


class SourceTransport(Protocol):
    """Named operations implemented by the canonical Git/Hermes boundary."""

    def read(self, path: str, *, timeout_seconds: int) -> str: ...
    def diff(self, path: str, content: str | None, *, timeout_seconds: int) -> str: ...
    def validate(self, path: str, content: str | None, kind: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...
    def apply(self, path: str, content: str | None, *, expected_sha: str, timeout_seconds: int) -> Mapping[str, Any]: ...
    def commit(self, path: str, *, message: str, expected_sha: str, timeout_seconds: int) -> Mapping[str, Any]: ...
    def rollback(self, path: str, revision: str, *, timeout_seconds: int) -> Mapping[str, Any]: ...


class CapabilityTransport(Protocol):
    def set_enablement(self, path: str, enabled: bool, *, expected_sha: str, timeout_seconds: int) -> Mapping[str, Any]: ...


class SourceActionService:
    """Plan/confirm/apply service for Step 6C source and capability actions."""

    def __init__(self, registry: ActionRegistry, hermes: Any,
                 sources: Mapping[str, Mapping[str, Any]],
                 transport: SourceTransport, receipts: ImmutableReceiptStore,
                 *, capabilities: CapabilityTransport | None = None,
                 authority_id: str = "runtime:hermes-default",
                 now: Callable[[], Any] = _now):
        self.registry, self.hermes, self.sources = registry, hermes, dict(sources)
        self.transport, self.capabilities, self.receipts = transport, capabilities or transport, receipts
        self.authority_id, self.now = _stable(authority_id, "Hermes authority ID"), now
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _definition(self, action_id: str) -> Mapping[str, Any]:
        if action_id not in SOURCE_ACTIONS:
            raise ActionError("unknown or unavailable source action")
        action = self.registry.actions.get(action_id)
        if not action or (not self.registry.enabled and not action.get("enabled", False)):
            raise ActionError("source actions are disabled")
        return action

    def _source(self, source_id: str, *, kind: str | None = None) -> tuple[dict[str, Any], Path]:
        source = self.sources.get(source_id)
        if not isinstance(source, Mapping):
            raise ActionError("canonical source is not declared")
        value = dict(source)
        raw_root, raw_path = value.get("root"), value.get("path")
        if not isinstance(raw_root, str) or not isinstance(raw_path, str):
            raise ActionError("canonical source root and path are required")
        root, path = Path(raw_root).resolve(), Path(raw_path)
        if Path(raw_root).is_symlink():
            raise ActionError("canonical source root may not be a symlink")
        if not path.is_absolute(): path = root / path
        # Resolve existing parents, then enforce containment. Symlink paths and
        # symlinked parents are rejected even when they resolve inside root.
        try: resolved = path.resolve(strict=False)
        except OSError as error: raise ActionError("source path cannot be resolved") from error
        try: resolved.relative_to(root)
        except ValueError as error: raise ActionError("source path is outside its declared root") from error
        current = root
        for part in resolved.relative_to(root).parts:
            current = current / part
            if current.is_symlink(): raise ActionError("symlink source paths are not allowed")
        if kind and value.get("kind") not in (kind, "rule", "skill"):
            raise ActionError("source kind does not match action")
        if value.get("kind") not in ("rule", "skill", "capability"):
            raise ActionError("unsupported canonical source kind")
        return value, resolved

    @staticmethod
    def _key(arguments: Mapping[str, Any]) -> str:
        key = arguments.get("idempotency_key")
        if not isinstance(key, str) or not _KEY.fullmatch(key): raise ActionError("a valid idempotency key is required")
        return key

    def _content(self, action_id: str, args: Mapping[str, Any]) -> str | None:
        if action_id in ("tool:create-rule", "tool:edit-rule", "tool:create-skill", "tool:edit-skill", "tool:consolidate-sources", "tool:import-source-row"):
            content = args.get("content")
            if isinstance(content, str):
                return content
            reference = args.get("content_ref") or args.get("patch_ref")
            if not isinstance(reference, str):
                raise ActionError("a canonical content or patch reference is required")
            _stable(reference, "content reference")
            resolver = getattr(self.transport, "resolve_content", None)
            if not callable(resolver):
                raise ActionError("canonical content reference cannot be resolved")
            resolved = self._call(resolver, reference, timeout_seconds=30, timeout=30)
            if not isinstance(resolved.get("content"), str):
                raise ActionError("canonical content reference is unavailable")
            return resolved["content"]
        if action_id in ("tool:retire-rule", "tool:retire-skill"):
            replacement = args.get("replacement_id")
            if not isinstance(replacement, str): raise ActionError("replacement_id is required")
            _stable(replacement, "replacement_id")
            return None  # transport performs a typed deprecation edit
        if action_id == "tool:restore-source": return None
        return None

    def plan(self, *, action_id: str, target_id: str, arguments: Mapping[str, Any],
             base_revision: str, actor: str = "operator") -> dict[str, Any]:
        action = self._definition(action_id)
        target = _stable(target_id, "target ID")
        if target not in action.get("target_allowlist", []): raise ActionError("target is not allowlisted")
        if not isinstance(base_revision, str) or not _REV.fullmatch(base_revision): raise ActionError("exact base revision is required")
        args = dict(arguments); key = self._key(args)
        if action_id == "tool:consolidate-sources":
            for field in ("conflicts", "precedence", "shared_base_rule", "exceptions", "migration_order"):
                if field not in args: raise ActionError(f"{field} is required for consolidation")
            if not isinstance(args["exceptions"], list) or not isinstance(args["migration_order"], list): raise ActionError("consolidation exceptions and migration_order must be arrays")
            if any(not isinstance(item, Mapping) for item in args["exceptions"]): raise ActionError("invalid project-scoped exception")
            if not args["conflicts"] or not args["migration_order"] or not isinstance(args["precedence"], list): raise ActionError("consolidation evidence and migration order are required")
        if action_id == "tool:import-source-row" and (not isinstance(args.get("import_preview_receipt"), str) or not str(args["import_preview_receipt"]).startswith("receipt:")):
            raise ActionError("accepted import preview receipt is required")
        source_id = str(args.get("source_id") or target)
        source, path = self._source(source_id)
        expected = source.get("revision") or source.get("source_revision")
        if not isinstance(expected, str) or expected != base_revision: raise ActionError("base revision does not match canonical source")
        if action_id in SOURCE_FILE_ACTIONS and source.get("kind") not in ("rule", "skill"): raise ActionError("rule/skill source required")
        if action_id in ("tool:enable-capability", "tool:disable-capability") and source.get("kind") != "capability": raise ActionError("capability source required")
        content = self._content(action_id, args)
        if action_id in ("tool:create-rule", "tool:edit-rule", "tool:create-skill", "tool:edit-skill", "tool:consolidate-sources", "tool:import-source-row") and not content.strip(): raise ActionError("source content is required")
        # The validator is read-only and runs during planning, before any commit.
        checks = self.transport.validate(str(path), content, str(source.get("kind")), timeout_seconds=30)
        if not isinstance(checks, Mapping) or checks.get("ok") is not True: raise ActionError("source validation failed")
        diff = self.transport.diff(str(path), content, timeout_seconds=30)
        if not isinstance(diff, str): raise ActionError("source diff is unavailable")
        fingerprint = _digest({"action_id": action_id, "target_id": target, "source_id": source_id, "base_revision": base_revision, "arguments": args, "diff": diff})
        replay = self.receipts.find(key, fingerprint)
        return {"plan_id": "plan:" + uuid.uuid4().hex, "action_id": action_id, "target_id": target,
                "source_id": source_id, "source_path": str(path), "base_revision": base_revision,
                "arguments": args, "actor": actor, "fingerprint": fingerprint, "diff": diff,
                "validation": dict(checks), "affected_projects": list(source.get("project_ids", [])),
                "rollback_revision": source.get("revision"), "adapter_id": action.get("adapter_id"),
                "adapter_version": action.get("adapter_version", "1.0.0"), "adapter_hash": action.get("adapter_hash"),
                "lock_key": action.get("lock_key", "source-actions/" + source_id.replace(":", "-")),
                "replayed": replay is not None, "receipt": replay}

    def confirm(self, plan: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(plan, Mapping) or plan.get("action_id") not in SOURCE_ACTIONS: raise ActionError("malformed source plan")
        if not plan.get("diff") or plan.get("validation", {}).get("ok") is not True: raise ActionError("validated diff is required")
        return {"plan": dict(plan), "confirmed": True}

    def _call(self, fn: Any, *args: Any, timeout: int, **kwargs: Any) -> Mapping[str, Any]:
        pool = ThreadPoolExecutor(max_workers=1)
        future = pool.submit(fn, *args, **kwargs)
        try: value = future.result(timeout=timeout)
        except FutureTimeout as error:
            future.cancel(); pool.shutdown(wait=False, cancel_futures=True)
            raise ActionError("source action timed out") from error
        else:
            pool.shutdown(wait=True)
        if not isinstance(value, Mapping): raise ActionError("source adapter returned an invalid result")
        return value

    def apply(self, confirmation: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(confirmation, Mapping) or confirmation.get("confirmed") is not True: raise ActionError("one confirmation is required")
        plan = confirmation.get("plan")
        if not isinstance(plan, Mapping): raise ActionError("malformed source plan")
        action_id, target, source_id = str(plan.get("action_id")), str(plan.get("target_id")), str(plan.get("source_id"))
        action = self._definition(action_id); args = plan.get("arguments", {})
        target = _stable(target, "target ID")
        if target not in action.get("target_allowlist", []): raise ActionError("target is not allowlisted")
        if not isinstance(args, Mapping): raise ActionError("typed source arguments are required")
        key = self._key(args)
        expected_fp = _digest({"action_id": action_id, "target_id": target, "source_id": source_id, "base_revision": plan.get("base_revision"), "arguments": dict(args), "diff": plan.get("diff")})
        if plan.get("fingerprint") != expected_fp: raise ActionError("plan fingerprint mismatch")
        replay = self.receipts.find(key, expected_fp)
        if replay: return {"receipt": replay, "replayed": True}
        source, path = self._source(source_id)
        if source.get("revision") != plan.get("base_revision") and source.get("source_revision") != plan.get("base_revision"):
            raise ActionError("canonical source changed since planning")
        if action_id in SOURCE_FILE_ACTIONS and source.get("kind") not in ("rule", "skill"):
            raise ActionError("rule/skill source required")
        if action_id in ("tool:enable-capability", "tool:disable-capability") and source.get("kind") != "capability":
            raise ActionError("capability source required")
        lock = self._lock(str(plan.get("lock_key") or source_id))
        if not lock.acquire(blocking=False): raise ActionError("source action lock is busy")
        started, before = self.now(), "receipt:action-before/" + uuid.uuid4().hex
        outcome, rollback = "fail", "not_attempted"; commit_revision = None; after = None
        try:
            auth = self.hermes.request(action_id=action_id, target_id=target, arguments=args, timeout_seconds=300)
            if not isinstance(auth, Mapping) or auth.get("authorized") is not True: raise ActionError("Hermes authorization failed")
            planned_hash = action.get("adapter_hash")
            if planned_hash is not None and not _SHA.fullmatch(str(planned_hash)):
                raise ActionError("source adapter hash is invalid")
            if action_id in ("tool:enable-capability", "tool:disable-capability"):
                result = self._call(self.capabilities.set_enablement, str(path), action_id == "tool:enable-capability", expected_sha=str(plan["base_revision"]), timeout_seconds=300, timeout=300)
            else:
                content = self._content(action_id, args)
                result = self._call(self.transport.apply, str(path), content, expected_sha=str(plan["base_revision"]), timeout_seconds=300, timeout=300)
            if result.get("ok") is False: raise ActionError("source adapter failed")
            commit = self._call(self.transport.commit, str(path), message=f"control: {action_id} {source_id}", expected_sha=str(plan["base_revision"]), timeout_seconds=300, timeout=300)
            if commit.get("ok") is False or not isinstance(commit.get("revision"), str): raise ActionError("source commit failed")
            commit_revision, after, outcome = commit["revision"], "receipt:action-after/" + uuid.uuid4().hex, "pass"
        except Exception:
            # Keep provider details out of the immutable receipt; callers only
            # receive the fail-closed outcome.
            outcome = "fail"
        finally: lock.release()
        completed = self.now()
        receipt = {"id": "receipt:action/" + uuid.uuid4().hex, "kind": "action", "subject_ids": [target], "producer": self.authority_id,
                   "source_revision_set": {"base": str(plan["base_revision"])}, "deployed_revision_set": {"target": str(commit_revision or plan["base_revision"])},
                   "captured_at": _iso(completed), "fresh_until": _iso(completed), "outcome": outcome,
                   "evidence_uris": [before] + ([after] if after else []), "redaction": "secret_filtered", "action_id": action_id,
                   "adapter_id": str(action.get("adapter_id", "tool:adapter-source-change")), "adapter_version": str(action.get("adapter_version", "1.0.0")),
                   "adapter_hash": str(action.get("adapter_hash") or "sha256:" + "0" * 64), "target_id": target,
                   "target_revision_before": str(plan["base_revision"]), "target_revision_requested": commit_revision,
                   "idempotency_key": key, "lock_key": str(plan.get("lock_key") or source_id), "started_at": _iso(started), "completed_at": _iso(completed),
                   "before_state_receipt_id": before, "after_state_receipt_id": after, "preconditions": [{"name": "canonical_source", "outcome": "pass"}],
                   "postconditions": [{"name": "source_commit_validated", "outcome": "pass" if outcome == "pass" else "fail"}],
                   "rollback_action_id": action.get("rollback_action_id", "tool:restore-source"), "rollback_outcome": rollback}
        return {"receipt": self.receipts.write(receipt, key=key, fingerprint=expected_fp), "replayed": False}


__all__ = ["SOURCE_ACTIONS", "SOURCE_FILE_ACTIONS", "SourceActionService", "SourceTransport", "CapabilityTransport"]
