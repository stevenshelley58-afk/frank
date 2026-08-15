"""Safe, transport-neutral Connections mutation and action-ledger contract.

Frank owns this narrow metadata boundary only. Hermes remains the sole brain,
provider executor, and source of provider receipts. The service is shared by
manual Window commands and the authenticated Hermes ingress.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Callable


SAFE_ACTIONS = {"discover", "verify", "sync"}
MUTATION_ACTIONS = {"create", "update", "revoke", "delete"}
DESTRUCTIVE_ACTIONS = {"revoke", "delete"}
ALL_ACTIONS = SAFE_ACTIONS | MUTATION_ACTIONS
PROVIDER_OUTCOMES = {
    "create": "created", "update": "updated", "verify": "verified",
    "sync": "synced", "revoke": "revoked", "delete": "deleted",
}
PROVIDER_FAILURE_CATEGORIES = {
    "auth", "configuration", "network", "not_found", "permission_denied",
    "rate_limited", "timeout", "unavailable", "validation", "unknown",
}
PROVIDER_FAILURE_CODE = re.compile(r"^[a-z][a-z0-9_.:-]{0,63}$")
ACTION_STATES = {"planned", "running", "waiting_for_provider", "completed", "failed", "awaiting_confirmation"}
PLAN_STATES = {"planned", "applying", "waiting_for_provider", "applied", "failed", "expired"}
SCHEMA = "schema://frank.connection-action/v1"
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
OPAQUE_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$")
SECRET_VALUE = re.compile(
    r"(?:\b(?:password|passphrase|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]|\bBearer\s+|\b(?:re|resend)_[A-Za-z0-9_-]{8,}\b|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b|\bwhsec_[A-Za-z0-9_-]{8,}\b|\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}\b)",
    re.I,
)
JWT_VALUE = re.compile(r"\b(?:eyJ[A-Za-z0-9_-]{4,}\.){2}[A-Za-z0-9_-]{4,}\b")
FORBIDDEN_KEY = re.compile(r"(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|card|iban|bank)", re.I)


class ContractError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def _now() -> int:
    return int(time.time())


def _contains_payment_data(text: str) -> bool:
    if re.search(r"\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b", text, re.I):
        return True
    for candidate in re.findall(r"(?<![A-Za-z0-9])(?:\d[ -]?){13,19}(?![A-Za-z0-9])", text):
        digits = re.sub(r"\D", "", candidate)
        if not 13 <= len(digits) <= 19:
            continue
        total = 0
        parity = len(digits) % 2
        for index, char in enumerate(digits):
            value = int(char)
            if index % 2 == parity:
                value = value * 2 - 9 if value * 2 > 9 else value * 2
            total += value
        if total % 10 == 0:
            return True
    return False


def _safe_scalar(value: object, label: str, *, opaque: bool = False, check_payment: bool = True) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ContractError(f"{label} must be text")
    text = " ".join(value.split())[:240]
    if SECRET_VALUE.search(text) or JWT_VALUE.search(text) or (check_payment and _contains_payment_data(text)):
        raise ContractError("sensitive values are not accepted")
    if opaque and text and not OPAQUE_VALUE.fullmatch(text):
        raise ContractError(f"invalid {label}")
    return text


def _safe_target(target: dict | None) -> dict:
    if not isinstance(target, dict):
        raise ContractError("target must be an object")
    allowed = {"provider", "connection_id", "consumer", "project", "environment"}
    if set(target) - allowed:
        raise ContractError("target contains unsupported fields")
    return {
        field: _safe_scalar(target.get(field), field, opaque=True, check_payment=field != "connection_id")
        for field in sorted(allowed)
    }


def _assert_safe_json(value: object, path: str = "body") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if FORBIDDEN_KEY.search(str(key)) and str(key) not in {"credential_ref", "connection_ref"}:
                raise ContractError("sensitive fields are not accepted")
            _assert_safe_json(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_safe_json(item, f"{path}[{index}]")
    elif isinstance(value, str):
        _safe_scalar(value, path)
    elif value is not None and not isinstance(value, (int, float, bool)):
        raise ContractError("request contains unsupported values")


def _safe_result(result: dict | None) -> dict:
    result = result if isinstance(result, dict) else {}
    allowed = {
        "connection_id", "provider", "status", "revision", "count", "matched", "changed",
        "removed", "verified_at", "action", "mode", "outcome", "pending", "reason",
        "provider_receipt", "local_metadata", "error_code", "error_category",
    }
    safe = {}
    for key in allowed:
        if key not in result:
            continue
        value = result[key]
        if isinstance(value, str):
            if key == "error_code" and not PROVIDER_FAILURE_CODE.fullmatch(value):
                raise ContractError("invalid provider error code")
            if key == "error_category" and value not in PROVIDER_FAILURE_CATEGORIES:
                raise ContractError("invalid provider error category")
            safe[key] = _safe_scalar(value, key, opaque=key in {"connection_id", "provider", "provider_receipt"}, check_payment=key not in {"connection_id", "provider_receipt"})
        elif isinstance(value, (int, float, bool)) or value is None:
            safe[key] = value
    return safe


def _validate_result(result: object) -> None:
    if not isinstance(result, dict):
        raise ContractError("result must be an object")
    allowed = {
        "connection_id", "provider", "status", "revision", "count", "matched", "changed",
        "removed", "verified_at", "action", "mode", "outcome", "pending", "reason",
        "provider_receipt", "local_metadata", "error_code", "error_category",
    }
    if set(result) - allowed:
        raise ContractError("result contains unsupported fields")
    for key, value in result.items():
        if isinstance(value, str):
            if key == "error_code" and not PROVIDER_FAILURE_CODE.fullmatch(value):
                raise ContractError("invalid result error code")
            if key == "error_category" and value not in PROVIDER_FAILURE_CATEGORIES:
                raise ContractError("invalid result error category")
            _safe_scalar(value, key, opaque=key in {"connection_id", "provider", "provider_receipt"}, check_payment=key not in {"connection_id", "provider_receipt"})
        elif not isinstance(value, (int, float, bool)) and value is not None:
            raise ContractError("result contains unsupported values")


def _redacted_error(value: object) -> str:
    text = " ".join(str(value or "").split())[:240]
    if SECRET_VALUE.search(text) or JWT_VALUE.search(text) or _contains_payment_data(text):
        return "Connection operation failed; sensitive details were redacted."
    return text or "Connection operation failed."


def _public_action(record: dict) -> dict:
    return {
        "schema": SCHEMA,
        "sequence": record["sequence"],
        "receipt_id": record["receipt_id"],
        "correlation_id": record["correlation_id"],
        "source": record["source"],
        "actor": record["actor"],
        "action": record["action"],
        "target": _safe_target(record["target"]),
        "state": record["state"],
        "progress": record["progress"],
        "result": _safe_result(record.get("result")),
        "started_at": record["started_at"],
        "updated_at": record["updated_at"],
        "completed_at": record.get("completed_at"),
        "error": _redacted_error(record.get("error")) if record.get("error") else "",
    }


class ActionLedger:
    """Strict append-only JSONL state. Corruption is a hard stop."""

    def __init__(self, path: Path, now: Callable[[], int] = _now):
        self.path, self.now, self.lock = path, now, threading.RLock()

    def _records(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            raise ContractError("connection ledger is unavailable", 503, "state_unavailable") from error
        records = []
        for index, line in enumerate(lines, 1):
            try:
                item = json.loads(line)
            except json.JSONDecodeError as error:
                raise ContractError("connection ledger is corrupt", 503, "state_corrupt") from error
            if not isinstance(item, dict) or item.get("schema") != SCHEMA:
                raise ContractError("connection ledger is corrupt", 503, "state_corrupt")
            if item.get("sequence") != index or item.get("action") not in ALL_ACTIONS or item.get("state") not in ACTION_STATES:
                raise ContractError("connection ledger contains unknown state", 503, "state_corrupt")
            if item.get("source") not in {"manual", "connections-agent"} or not isinstance(item.get("target"), dict):
                raise ContractError("connection ledger is corrupt", 503, "state_corrupt")
            try:
                _safe_target(item["target"])
                _validate_result(item.get("result", {}))
                _assert_safe_json(item.get("progress", {}))
                if not isinstance(item.get("error", ""), str) or SECRET_VALUE.search(item.get("error", "")) or JWT_VALUE.search(item.get("error", "")) or _contains_payment_data(item.get("error", "")):
                    raise ContractError("invalid ledger error")
            except ContractError as error:
                raise ContractError("connection ledger is corrupt", 503, "state_corrupt") from error
            records.append(item)
        return records

    def append(self, *, source: str, actor: str, action: str, target: dict, state: str,
               progress: dict | None = None, result: dict | None = None, error: str = "",
               correlation_id: str | None = None, idempotency_ref: str = "",
               fingerprint: str = "", started_at: int | None = None) -> dict:
        if source not in {"manual", "connections-agent"} or action not in ALL_ACTIONS or state not in ACTION_STATES:
            raise ContractError("invalid action contract")
        safe_target = _safe_target(target)
        safe_result = _safe_result(result)
        safe_progress = {"percent": int((progress or {}).get("percent", 100 if state == "completed" else 0)), "step": _safe_scalar((progress or {}).get("step", state), "progress step", opaque=True)}
        safe_error = _redacted_error(error) if error else ""
        now = self.now()
        with self.lock:
            records = self._records()
            record = {
                "schema": SCHEMA, "sequence": len(records) + 1,
                "receipt_id": f"rcpt-{uuid.uuid4().hex[:20]}",
                "correlation_id": correlation_id or f"corr-{uuid.uuid4().hex[:20]}",
                "source": source, "actor": _safe_scalar(str(actor or "unknown"), "actor", opaque=True, check_payment=False),
                "action": action, "target": safe_target, "state": state,
                "progress": safe_progress, "result": safe_result,
                "started_at": started_at or now, "updated_at": now,
                "completed_at": now if state == "completed" else None,
                "error": safe_error, "idempotency_ref": idempotency_ref, "fingerprint": fingerprint,
            }
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            except OSError as error:
                raise ContractError("connection ledger is unavailable", 503, "state_unavailable") from error
            return record

    def list(self, *, after: int = 0, limit: int = 50, latest: bool = False) -> list[dict]:
        with self.lock:
            records = [item for item in self._records() if item["sequence"] > after]
        if latest:
            records.sort(key=lambda item: item["sequence"], reverse=True)
        return [_public_action(item) for item in records[:max(1, min(limit, 200))]]

    def find_idempotency(self, reference: str, fingerprint: str) -> dict | None:
        if not reference:
            return None
        with self.lock:
            for record in reversed(self._records()):
                if record.get("idempotency_ref") == reference:
                    if record.get("fingerprint") != fingerprint:
                        raise ContractError("idempotency key was already used for another action", 409, "idempotency_conflict")
                    return record
        return None

    def find_correlation(self, correlation_id: str) -> dict | None:
        with self.lock:
            for record in reversed(self._records()):
                if record.get("correlation_id") == correlation_id:
                    return record
        return None

    def find_receipt(self, receipt_id: str) -> dict | None:
        with self.lock:
            for record in self._records():
                if record.get("receipt_id") == receipt_id:
                    return record
        return None

    def latest_by_correlation(self) -> list[dict]:
        with self.lock:
            latest: dict[str, dict] = {}
            for record in self._records():
                latest[record["correlation_id"]] = record
        return [_public_action(item) for item in latest.values()]


class PlanStore:
    """Strict normalized plan state with bounded lifecycle retention."""

    def __init__(self, path: Path, now: Callable[[], int] = _now, max_plans: int = 500):
        self.path, self.now, self.max_plans, self.lock = path, now, max_plans, threading.RLock()

    def _read(self) -> dict:
        if not self.path.exists():
            return {"version": 1, "plans": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ContractError("connection plans are corrupt", 503, "state_corrupt") from error
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("plans"), dict):
            raise ContractError("connection plans contain unknown state", 503, "state_corrupt")
        for plan in data["plans"].values():
            if (
                not isinstance(plan, dict)
                or plan.get("action") not in ALL_ACTIONS
                or plan.get("state") not in PLAN_STATES
                or plan.get("source") not in {"manual", "connections-agent"}
                or not isinstance(plan.get("plan_id"), str)
                or not isinstance(plan.get("expires_at"), int)
            ):
                raise ContractError("connection plans contain unknown state", 503, "state_corrupt")
            if not isinstance(plan.get("target"), dict) or not isinstance(plan.get("body"), dict):
                raise ContractError("connection plans are corrupt", 503, "state_corrupt")
            try:
                _safe_target(plan["target"])
                _assert_safe_json(plan["body"])
            except ContractError as error:
                raise ContractError("connection plans are corrupt", 503, "state_corrupt") from error
        return data

    def _write(self, data: dict) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
            temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(self.path)
        except OSError as error:
            raise ContractError("connection plans are unavailable", 503, "state_unavailable") from error

    def _purge(self, data: dict) -> None:
        now = self.now()
        expired = [
            key for key, plan in data["plans"].items()
            if plan.get("state") == "expired"
            or (plan.get("state") == "applied" and now > int(plan.get("expires_at", 0)) + 3600)
            or (plan.get("state") not in {"applying", "waiting_for_provider", "applied"} and int(plan.get("expires_at", 0)) < now)
        ]
        for key in expired:
            data["plans"].pop(key, None)
        if len(data["plans"]) > self.max_plans:
            ordered = sorted(data["plans"].items(), key=lambda pair: int(pair[1].get("created_at", 0)))
            for key, _ in ordered[:len(data["plans"]) - self.max_plans]:
                data["plans"].pop(key, None)

    def put(self, plan: dict) -> None:
        with self.lock:
            data = self._read()
            self._purge(data)
            data["plans"][plan["plan_id"]] = plan
            self._write(data)

    def get(self, plan_id: str) -> dict | None:
        with self.lock:
            data = self._read()
            plan = data["plans"].get(plan_id)
            return json.loads(json.dumps(plan)) if plan else None

    def delete(self, plan_id: str) -> None:
        """Remove a plan only while compensating an unsuccessful first append."""
        with self.lock:
            data = self._read()
            if plan_id in data["plans"]:
                data["plans"].pop(plan_id, None)
                self._write(data)


class ConnectionsMutationService:
    """Shared manual/agent mutation service with one process-wide transition lock."""

    def __init__(self, *, load_store: Callable[[], dict], save_store: Callable[[dict], None],
                 clean_connection: Callable[[dict, dict | None], dict], public_connection: Callable[[dict], dict],
                 normalize_plan: Callable[[str, dict, dict], tuple[dict, dict]], delete_allowed: Callable[[str], bool],
                 scope_change_allowed: Callable[[str], bool] | None = None, ledger_path: Path, plans_path: Path,
                 now: Callable[[], int] = _now, transition_lock: threading.RLock | None = None):
        self.load_store, self.save_store, self.clean_connection = load_store, save_store, clean_connection
        self.public_connection, self.normalize_plan, self.delete_allowed = public_connection, normalize_plan, delete_allowed
        self.scope_change_allowed, self.now = scope_change_allowed or (lambda _id: True), now
        self.lock = threading.RLock()
        self.transition_lock = transition_lock or threading.RLock()
        self.ledger, self.plans = ActionLedger(ledger_path, now), PlanStore(plans_path, now)

    @staticmethod
    def require_idempotency(key: str) -> str:
        if not isinstance(key, str) or not IDEMPOTENCY_KEY.fullmatch(key.strip()):
            raise ContractError("a valid idempotency key is required")
        return key.strip()

    @staticmethod
    def _ref(key: str) -> str:
        return hashlib.sha256(key.encode()).hexdigest()[:32]

    @staticmethod
    def _fingerprint(action: str, target: dict, body: dict, revision: int | None, receipt: str = "", outcome: str = "", error_code: str = "", error_category: str = "") -> str:
        value = {"action": action, "target": target, "body": body, "expected_revision": revision, "provider_receipt": receipt, "provider_outcome": outcome, "provider_error_code": error_code, "provider_error_category": error_category}
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @staticmethod
    def _public_plan(plan: dict, token: str = "") -> dict:
        result = {key: value for key, value in plan.items() if key not in {"body", "confirmation_hash", "fingerprint", "idempotency_ref", "provider_receipt"}}
        if token:
            result["confirmation_token"] = token
        return result

    def _provider_evidence(self, action: str, receipt: str, outcome: str, error_code: str = "", error_category: str = "") -> tuple[str, str, str, str]:
        receipt = _safe_scalar(receipt, "provider receipt", opaque=True)
        outcome = _safe_scalar(outcome, "provider outcome", opaque=True).lower()
        error_code = _safe_scalar(error_code, "provider error code", opaque=True, check_payment=False).lower()
        error_category = _safe_scalar(error_category, "provider error category", opaque=True, check_payment=False).lower()
        if not receipt:
            raise ContractError("validated Hermes provider receipt and outcome are required", 409, "provider_receipt_required")
        if outcome == "failed":
            if not error_code or not PROVIDER_FAILURE_CODE.fullmatch(error_code) or error_category not in PROVIDER_FAILURE_CATEGORIES:
                raise ContractError("provider failure requires an allowlisted error code and category", 409, "provider_failure_metadata_required")
            return receipt, outcome, error_code, error_category
        if error_code or error_category or outcome != PROVIDER_OUTCOMES.get(action):
            raise ContractError("validated Hermes provider receipt and outcome are required", 409, "provider_receipt_required")
        return receipt, outcome, "", ""

    def _pending_provider(self, *, source: str, actor: str, action: str, target: dict, correlation_id: str,
                          ref: str, fingerprint: str, started: int) -> dict:
        record = self.ledger.append(
            source=source, actor=actor, action=action, target=target, state="waiting_for_provider",
            progress={"percent": 25, "step": "waiting-for-hermes-provider-receipt"},
            result={"action": action, "mode": "provider_receipt_required", "pending": True, "reason": "Hermes provider execution is not registered"},
            correlation_id=correlation_id, idempotency_ref=ref, fingerprint=fingerprint, started_at=started,
        )
        return {"action": _public_action(record), "replayed": False, "connection": None, "pending": True}

    @staticmethod
    def _requires_provider_evidence(source: str, action: str) -> bool:
        # These operations change or attest provider-owned state. Agent-side
        # create/update/delete are also provider actions; manual delete remains
        # a local metadata removal after explicit confirmation.
        return action in {"verify", "sync", "revoke"} or (
            source == "connections-agent" and action in {"create", "update", "delete"}
        )

    def _reserve(self, *, source: str, actor: str, action: str, target: dict,
                 correlation_id: str | None, idempotency_ref: str, fingerprint: str,
                 started: int) -> dict:
        return self.ledger.append(
            source=source, actor=actor, action=action, target=target, state="running",
            progress={"percent": 10, "step": "reserved"},
            result={"action": action, "mode": "reserved", "pending": True,
                    "reason": "mutation reserved before local state change"},
            correlation_id=correlation_id, idempotency_ref=idempotency_ref,
            fingerprint=fingerprint, started_at=started,
        )

    def plan(self, *, action: str, source: str, actor: str, target: dict, body: dict | None,
              expected_revision: int | None, idempotency_key: str) -> dict:
        action = str(action or "").strip().lower()
        if action not in ALL_ACTIONS:
            raise ContractError("unsupported connections action")
        key = self.require_idempotency(idempotency_key)
        with self.lock, self.transition_lock:
            normalized_target, normalized_body = self.normalize_plan(action, target or {}, body or {})
            normalized_target = _safe_target(normalized_target)
            _assert_safe_json(normalized_body)
            if source == "manual" and action in {"create", "update"} and normalized_body.get("status") not in {None, "setup_needed", "connected"}:
                raise ContractError("manual metadata must remain setup_needed or connected", 409, "provider_result_required")
            fingerprint = self._fingerprint(action, normalized_target, normalized_body, expected_revision)
            ref = self._ref(key)
            replay = self.ledger.find_idempotency(ref, fingerprint)
            if replay:
                plan = self.plans.get(replay["correlation_id"])
                if not plan:
                    raise ContractError("connection plan state is corrupt", 503, "state_corrupt")
                return {"plan": self._public_plan(plan), "action": _public_action(replay), "replayed": True}
            now = self.now()
            destructive = action in DESTRUCTIVE_ACTIONS
            if destructive:
                connection_id = normalized_target.get("connection_id")
                current = next((item for item in self.load_store().get("connections", []) if item.get("id") == connection_id), None)
                if not current:
                    raise ContractError("connection not found", 404, "connection_not_found")
                if not isinstance(expected_revision, int):
                    raise ContractError("destructive plans require the current connection revision", 409, "revision_required")
                if int(current.get("revision", 1)) != expected_revision:
                    raise ContractError("connection changed; refresh and retry", 409, "revision_conflict")
            token = f"confirm-{secrets.token_urlsafe(18)}" if destructive else ""
            plan = {
                "plan_id": f"plan-{uuid.uuid4().hex[:20]}", "action": action, "source": source,
                "actor": _safe_scalar(actor, "actor", opaque=True), "target": normalized_target,
                "body": normalized_body, "expected_revision": expected_revision,
                "confirmation_required": destructive, "confirmation_hash": hashlib.sha256(token.encode()).hexdigest() if token else "",
                "confirmation_consumed": False, "created_at": now, "expires_at": now + 900,
                "state": "planned", "idempotency_ref": ref, "fingerprint": fingerprint,
            }
            self.plans.put(plan)
            try:
                action_record = self.ledger.append(
                    source=source, actor=actor, action=action, target=normalized_target,
                    state="awaiting_confirmation" if destructive else "planned",
                    progress={"percent": 0, "step": "awaiting-confirmation" if destructive else "ready"},
                    result={"action": action, "mode": "confirm" if destructive else ("local_metadata" if action == "discover" else "provider_receipt_required")},
                    correlation_id=plan["plan_id"], idempotency_ref=ref, fingerprint=fingerprint,
                )
            except ContractError:
                # Never leave an actionable plan without its authoritative
                # initial ledger record. A subsequent retry may safely reuse
                # the idempotency key and mint a fresh plan.
                try:
                    self.plans.delete(plan["plan_id"])
                except ContractError as cleanup_error:
                    raise ContractError("connection plan state is unavailable", 503, "state_unavailable") from cleanup_error
                raise
            return {"plan": self._public_plan(plan, token), "action": _public_action(action_record), "replayed": False}

    def apply_plan(self, *, plan_id: str, confirmation_token: str, idempotency_key: str,
                   expected_source: str | None = None, expected_connection_id: str | None = None,
                   provider_receipt: str = "", provider_outcome: str = "",
                   provider_error_code: str = "", provider_error_category: str = "",
                   authenticated_provider: bool = False, executor_actor: str | None = None) -> dict:
        key = self.require_idempotency(idempotency_key)
        with self.lock, self.transition_lock:
            plan = self.plans.get(str(plan_id or ""))
            if not plan:
                raise ContractError("connection plan not found", 404, "plan_not_found")
            if expected_source == "connections-agent" and plan["source"] not in {"manual", "connections-agent"}:
                raise ContractError("plan was not issued by the Hermes Connections Agent", 403, "plan_source_mismatch")
            if expected_source and expected_source != "connections-agent" and plan["source"] != expected_source:
                raise ContractError("plan source mismatch", 403, "plan_source_mismatch")
            if expected_connection_id and plan["target"].get("connection_id") != expected_connection_id:
                raise ContractError("plan target does not match connection", 409, "plan_target_mismatch")
            latest = self.ledger.find_correlation(plan["plan_id"])
            if plan["state"] == "applied":
                return {"action": _public_action(latest), "replayed": True, "connection": None}
            if latest and latest["state"] == "completed":
                return {"action": _public_action(latest), "replayed": True, "connection": None}
            if latest and latest["state"] == "running":
                return {"action": _public_action(latest), "replayed": True, "connection": None, "pending": True}
            if latest and latest["state"] == "failed" and plan["state"] == "failed":
                return {"action": _public_action(latest), "replayed": True, "connection": None}
            if int(plan["expires_at"]) < self.now():
                plan["state"] = "expired"
                self.plans.put(plan)
                raise ContractError("connection plan has expired", 409, "plan_expired")
            requires_provider = self._requires_provider_evidence(plan["source"], plan["action"])
            if plan["state"] == "waiting_for_provider" and not (authenticated_provider and provider_receipt and provider_outcome):
                if latest:
                    return {"action": _public_action(latest), "replayed": True, "connection": None, "pending": True}
            if plan["confirmation_required"] and not plan["confirmation_consumed"]:
                supplied = str(confirmation_token or "")
                if not supplied or not secrets.compare_digest(hashlib.sha256(supplied.encode()).hexdigest(), plan["confirmation_hash"]):
                    raise ContractError("explicit confirmation token required", 409, "confirmation_required")
            receipt = _safe_scalar(provider_receipt, "provider receipt", opaque=True) if provider_receipt else ""
            outcome = _safe_scalar(provider_outcome, "provider outcome", opaque=True).lower() if provider_outcome else ""
            error_code = str(provider_error_code or "")
            error_category = str(provider_error_category or "")
            fingerprint = self._fingerprint(plan["action"], plan["target"], plan["body"], plan.get("expected_revision"), receipt, outcome, error_code, error_category)
            ref = self._ref(key)
            replay = self.ledger.find_idempotency(ref, fingerprint)
            if replay:
                return {"action": _public_action(replay), "replayed": True, "connection": None, "pending": replay["state"] != "completed"}
            if requires_provider:
                if not authenticated_provider or (not receipt and not outcome):
                    pending = self._pending_provider(
                        source=plan["source"], actor=executor_actor or plan["actor"], action=plan["action"],
                        target=plan["target"], correlation_id=plan["plan_id"], ref=ref,
                        fingerprint=fingerprint, started=self.now(),
                    )
                    if plan["confirmation_required"] and not plan["confirmation_consumed"]:
                        plan["confirmation_consumed"] = True
                        plan["confirmation_hash"] = ""
                    plan["state"] = "waiting_for_provider"
                    self.plans.put(plan)
                    return pending
                try:
                    receipt, outcome, error_code, error_category = self._provider_evidence(plan["action"], receipt, outcome, error_code, error_category)
                except ContractError:
                    plan["state"] = "failed"
                    self.plans.put(plan)
                    raise
            started = self.now()
            actor = executor_actor or plan["actor"]
            self._reserve(
                source=plan["source"], actor=actor, action=plan["action"], target=plan["target"],
                correlation_id=plan["plan_id"], idempotency_ref=ref, fingerprint=fingerprint,
                started=started,
            )
            if plan["confirmation_required"] and not plan["confirmation_consumed"]:
                plan["confirmation_consumed"] = True
                plan["confirmation_hash"] = ""
            plan["state"] = "applying"
            self.plans.put(plan)
            try:
                result = self._execute_locked(
                    action=plan["action"], source=plan["source"], actor=actor, target=plan["target"],
                    body=plan["body"], expected_revision=plan.get("expected_revision"), idempotency_ref=ref,
                    fingerprint=fingerprint, correlation_id=plan["plan_id"], provider_receipt=receipt, provider_outcome=outcome,
                    provider_error_code=error_code, provider_error_category=error_category,
                )
            except ContractError:
                plan["state"] = "failed"
                self.plans.put(plan)
                raise
            plan["state"] = "failed" if result.get("provider_failed") else ("applied" if not result.get("pending") else "waiting_for_provider")
            self.plans.put(plan)
            return result

    def execute(self, *, action: str, source: str, actor: str, target: dict, body: dict | None,
                expected_revision: int | None, idempotency_key: str, confirmation_token: str = "") -> dict:
        key = self.require_idempotency(idempotency_key)
        action = str(action or "").strip().lower()
        if action not in ALL_ACTIONS:
            raise ContractError("unsupported connections action")
        with self.lock, self.transition_lock:
            normalized_target, normalized_body = self.normalize_plan(action, target or {}, body or {})
            normalized_target, normalized_body = _safe_target(normalized_target), normalized_body
            _assert_safe_json(normalized_body)
            fingerprint = self._fingerprint(action, normalized_target, normalized_body, expected_revision)
            ref = self._ref(key)
            replay = self.ledger.find_idempotency(ref, fingerprint)
            if replay:
                return {"action": _public_action(replay), "replayed": True, "connection": None,
                        "pending": replay["state"] in {"running", "waiting_for_provider", "planned", "awaiting_confirmation"}}
            if action in DESTRUCTIVE_ACTIONS and not confirmation_token:
                raise ContractError("explicit confirmation token required", 409, "confirmation_required")
            if self._requires_provider_evidence(source, action):
                raise ContractError("validated Hermes provider receipt and outcome are required", 409, "provider_receipt_required")
            started = self.now()
            reservation = self._reserve(source=source, actor=actor, action=action, target=normalized_target,
                          correlation_id=None, idempotency_ref=ref, fingerprint=fingerprint,
                          started=started)
            return self._execute_locked(action=action, source=source, actor=actor, target=normalized_target, body=normalized_body,
                                        expected_revision=expected_revision, idempotency_ref=ref, fingerprint=fingerprint,
                                        correlation_id=reservation["correlation_id"], provider_receipt="", provider_outcome="",
                                        provider_error_code="", provider_error_category="")

    def _execute_locked(self, *, action: str, source: str, actor: str, target: dict, body: dict,
                        expected_revision: int | None, idempotency_ref: str, fingerprint: str,
                        correlation_id: str | None, provider_receipt: str, provider_outcome: str,
                        provider_error_code: str, provider_error_category: str) -> dict:
        started = self.now()
        try:
            store = self.load_store()
            connections = store.setdefault("connections", [])
            connection_id = target.get("connection_id") or body.get("connection_id", "")
            current = next((item for item in connections if item.get("id") == connection_id), None) if connection_id else None
            if action in {"update", "delete", "revoke", "verify"} and not current:
                raise ContractError("connection not found", 404, "connection_not_found")
            if expected_revision is not None and current and int(current.get("revision", 1)) != int(expected_revision):
                raise ContractError("connection changed; refresh and retry", 409, "revision_conflict")
            result, public_item = {}, None
            if provider_outcome == "failed":
                failure_item = None
                if current and action in {"update", "verify", "sync", "revoke", "delete"}:
                    failure_body = {key: value for key, value in current.items() if key in {"provider", "name", "scope_kind", "scope_id", "status", "connection_ref", "credential_ref", "admin_url", "capabilities", "notes", "last_verified_at"}}
                    failure_body["status"] = "error"
                    failure_body["last_verified_at"] = ""
                    failure_item = self._clean(failure_body, current, source=source, action=action, provider_result=True)
                    failure_item["revision"] = int(current.get("revision", 1)) + 1
                    connections[connections.index(current)] = failure_item
                result = {"action": action, "mode": "provider_receipt", "outcome": "failed",
                          "provider_receipt": provider_receipt, "error_code": provider_error_code,
                          "error_category": provider_error_category}
                if failure_item:
                    result.update({"connection_id": failure_item["id"], "provider": failure_item["provider"],
                                   "status": "error", "revision": failure_item["revision"]})
                    public_item = self.public_connection(failure_item)
            elif action == "discover":
                result = {"action": "discover", "count": len(connections), "matched": len(connections), "mode": "local_metadata", "local_metadata": True}
            elif action == "create":
                item = self._clean(body, None, source=source, action=action)
                if any(item["name"].casefold() == x.get("name", "").casefold() and item["scope_kind"] == x.get("scope_kind") and item["scope_id"] == x.get("scope_id") for x in connections):
                    raise ContractError("this connection already exists in the selected scope", 409, "duplicate_connection")
                item["revision"] = 1
                connections.append(item)
                result = {"connection_id": item["id"], "provider": item["provider"], "status": item["status"], "revision": 1,
                          "mode": "provider_receipt" if provider_receipt else "local_metadata",
                          "outcome": provider_outcome, "provider_receipt": provider_receipt}
                public_item = self.public_connection(item)
            elif action == "update":
                item = self._clean(body, current, source=source, action=action)
                scope_changed = item.get("scope_kind") != current.get("scope_kind") or item.get("scope_id") != current.get("scope_id")
                if scope_changed and not self.scope_change_allowed(connection_id):
                    raise ContractError("cannot change connection scope while home widgets are bound; unbind it first", 409, "connection_in_use")
                item["revision"] = int(current.get("revision", 1)) + 1
                connections[connections.index(current)] = item
                result = {"connection_id": item["id"], "provider": item["provider"], "status": item["status"], "revision": item["revision"],
                          "mode": "provider_receipt" if provider_receipt else "local_metadata",
                          "outcome": provider_outcome, "provider_receipt": provider_receipt}
                public_item = self.public_connection(item)
            elif action == "verify":
                item = self._clean({"status": "verified", "last_verified_at": str(self.now())}, current, source=source, action=action)
                item["revision"] = int(current.get("revision", 1)) + 1
                connections[connections.index(current)] = item
                result = {"connection_id": item["id"], "provider": item["provider"], "status": "verified", "revision": item["revision"], "verified_at": item["last_verified_at"], "outcome": provider_outcome, "provider_receipt": provider_receipt}
                public_item = self.public_connection(item)
            elif action == "sync":
                result = {"action": "sync", "count": len(connections), "mode": "provider_receipt", "outcome": provider_outcome, "provider_receipt": provider_receipt}
            elif action == "revoke":
                item = self._clean({"status": "setup_needed", "last_verified_at": ""}, current, source=source, action=action)
                item["revision"] = int(current.get("revision", 1)) + 1
                connections[connections.index(current)] = item
                result = {"connection_id": item["id"], "provider": item["provider"], "status": "setup_needed", "revision": item["revision"], "outcome": "revoked", "provider_receipt": provider_receipt}
                public_item = self.public_connection(item)
            elif action == "delete":
                if not self.delete_allowed(connection_id):
                    raise ContractError("remove this connection from home widgets before deleting it", 409, "connection_in_use")
                connections[:] = [item for item in connections if item.get("id") != connection_id]
                result = {"connection_id": connection_id, "provider": current.get("provider"), "removed": True, "mode": "local_metadata" if source == "manual" else "provider_receipt", "outcome": provider_outcome or "" , "provider_receipt": provider_receipt}
            if action != "discover" or source == "manual":
                self.save_store(store)
        except ContractError as error:
            try:
                self.ledger.append(source=source, actor=actor, action=action, target=target, state="failed",
                                   progress={"percent": 100, "step": "failed"}, error=error.message,
                                   correlation_id=correlation_id, idempotency_ref=idempotency_ref,
                                   fingerprint=fingerprint, started_at=started)
            except ContractError:
                # The reserved event remains the latest known state. This is
                # intentionally conservative: a retry receives 202 instead
                # of repeating a possibly committed local mutation.
                pass
            raise ContractError(error.message, error.status, error.code) from error

        # Completion is deliberately outside the mutation error handler. If
        # this append fails, the running reservation remains authoritative and
        # the same request can only replay as pending.
        if provider_outcome == "failed":
            record = self.ledger.append(source=source, actor=actor, action=action, target=target, state="failed",
                                        progress={"percent": 100, "step": "provider-failed"}, result=result,
                                        error="provider action failed", correlation_id=correlation_id,
                                        idempotency_ref=idempotency_ref, fingerprint=fingerprint, started_at=started)
            return {"action": _public_action(record), "replayed": False, "connection": public_item, "provider_failed": True}
        record = self.ledger.append(source=source, actor=actor, action=action, target=target, state="completed",
                                    progress={"percent": 100, "step": "complete"}, result=result,
                                    correlation_id=correlation_id, idempotency_ref=idempotency_ref,
                                    fingerprint=fingerprint, started_at=started)
        return {"action": _public_action(record), "replayed": False, "connection": public_item}

    def _clean(self, body: dict, existing: dict | None, *, source: str, action: str, provider_result: bool = False) -> dict:
        try:
            item = self.clean_connection(body, existing)
            if not provider_result and source == "manual" and action in {"create", "update"}:
                if item.get("status") in {"verified", "error"}:
                    if action == "create" or "status" in body:
                        raise ContractError("provider-owned status requires a Hermes result", 409, "provider_result_required")
                elif item.get("status") not in {"setup_needed", "connected"}:
                    raise ContractError("manual metadata must remain setup_needed or connected", 409, "provider_result_required")
                if action == "update" and "status" in body and existing and existing.get("status") in {"verified", "error"}:
                    raise ContractError("provider-owned status cannot be changed by manual metadata", 409, "provider_result_required")
            return item
        except ContractError:
            raise
        except Exception as error:
            raise ContractError("connection metadata rejected") from error

    def activity(self, *, after: int = 0, limit: int = 50, latest: bool = False) -> list[dict]:
        return self.ledger.list(after=after, limit=limit, latest=latest)

    def attention(self, *, limit: int = 50) -> list[dict]:
        items = [item for item in self.ledger.latest_by_correlation()
                 if item["state"] in {"failed", "awaiting_confirmation", "waiting_for_provider", "running"}]
        return sorted(items, key=lambda item: item["sequence"], reverse=True)[:max(1, min(limit, 200))]

    def receipt(self, receipt_id: str) -> dict | None:
        record = self.ledger.find_receipt(receipt_id)
        return _public_action(record) if record else None
