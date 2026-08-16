"""Truthful read-only home projection for Outreach runtime state."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import datetime
import re
from typing import Any


SNAPSHOT_SCHEMA = "schema://frank.tool-home-snapshot/v1"
TOOL_ID = "outreach"
_ALLOWED_STATE_KEYS = frozenset({"connections", "commands", "outcomes", "receipts"})
_CONNECTION_CAPABILITIES = (
    "campaign-management", "segment-management", "outbound-delivery",
)
_ACTIONS = frozenset({
    "list-build", "sequence-plan", "draft-create", "approval-request",
    "policy-check", "suppression-check", "delivery-request",
    "action-receipt-ref", "reply-classify",
})
_COMMAND_STATES = frozenset({
    "queued", "running", "awaiting_approval", "blocked", "completed", "failed",
})
_OUTCOME_STATES = frozenset({"requested", "blocked", "accepted", "completed", "failed"})
_RECEIPT_KINDS = frozenset({
    "approval", "legal-basis", "policy", "project-suppression",
    "global-suppression", "quiet-hours", "idempotency",
    "connection-capability", "connection-action", "delivery",
})
_RECEIPT_STATES = frozenset({"recorded", "pass", "approved", "blocked", "failed"})
_DELIVERY_GATE_KINDS = frozenset({
    "approval", "legal-basis", "policy", "project-suppression",
    "global-suppression", "quiet-hours", "idempotency", "connection-capability",
})
_ATTENTION_STATES = frozenset({"awaiting_approval", "blocked", "failed"})
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$")
_OPAQUE_SUFFIX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]{0,223}$")
_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
_PRIVATE_VALUE = re.compile(
    r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|bearer\s+[a-z0-9._~+/=-]{12,}|"
    r"(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+|api[_-]?key[_-][a-z0-9]+|"
    r"gh[pousr]_[a-z0-9]+|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|"
    r"-----begin [a-z ]+-----)",
    re.IGNORECASE,
)
_PRIVATE_SCHEME = re.compile(r"^(?:openbao|vault|secret|file)://", re.IGNORECASE)
_MAX_ITEMS = 20

OVERVIEW = {
    "name": "Outreach",
    "blurb": "Plan policy-gated outreach with approvals, suppression, and delivery records.",
    "version": "0.1.1",
    "scopes": ["global", "profile", "project", "workspace", "session"],
    "capabilities": [
        "list-planning", "sequence-intent", "approval-workflow", "suppression",
        "action-receipt-reference",
    ],
    "adjustable_settings": [
        "approvals_and_suppression", "connection", "filters", "personalized_draft",
        "reply_classification", "scoring", "sequence", "sources",
    ],
    "pipeline_id": "policy-gated-outbound",
    "pipeline_version": "1.0.0",
}


def _safe_ref(value: Any, path: str, prefix: str | None = None) -> str:
    if (
        not isinstance(value, str)
        or not _SAFE_REF.fullmatch(value)
        or ".." in value
        or _PRIVATE_VALUE.search(value)
        or _PRIVATE_SCHEME.search(value)
    ):
        raise ValueError(f"{path} must be a safe non-secret reference")
    if prefix is None:
        if ":" in value or "/" in value:
            raise ValueError(f"{path} must be an opaque identifier, not a URL or scheme")
    else:
        suffix = value[len(prefix):] if value.startswith(prefix) else ""
        if value.count("://") != 1 or not _OPAQUE_SUFFIX.fullmatch(suffix):
            raise ValueError(f"{path} must use {prefix} with a non-empty opaque ID")
    return value


def _timestamp(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _TIMESTAMP.fullmatch(value):
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone")
    return value


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _sequence(value: Any, path: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise TypeError(f"{path} must be a sequence")
    return value


def _section(status: str, summary: str, items: list[dict[str, Any]], total: int | None = None) -> dict[str, Any]:
    return {
        "status": status,
        "summary": summary,
        "count": len(items) if total is None else total,
        "items": items[-_MAX_ITEMS:],
    }


def _connection_snapshot(value: Any = ()) -> dict[str, Any]:
    connections = _sequence(value, "runtime_state.connections")
    by_capability: dict[str, dict[str, Any]] = {}
    for index, connection in enumerate(connections):
        path = f"runtime_state.connections[{index}]"
        if not isinstance(connection, Mapping) or set(connection) != {"capability", "status", "connection_id"}:
            raise ValueError(f"{path} must contain capability, status, and connection_id")
        capability = connection["capability"]
        if capability not in _CONNECTION_CAPABILITIES or capability in by_capability:
            raise ValueError(f"{path}.capability is unsupported or duplicated")
        status = connection["status"]
        if status not in {"verified", "attention", "unavailable"}:
            raise ValueError(f"{path}.status is unsupported")
        connection_id = connection["connection_id"]
        if connection_id is not None:
            connection_id = _safe_ref(connection_id, f"{path}.connection_id")
        if status == "verified" and connection_id is None:
            raise ValueError(f"{path}.connection_id is required for verified coverage")
        by_capability[capability] = {
            "capability": capability,
            "status": status,
            "connection_id": connection_id,
        }

    items = [
        by_capability.get(capability, {
            "capability": capability, "status": "unavailable", "connection_id": None,
        })
        for capability in _CONNECTION_CAPABILITIES
    ]
    recorded = sum(item["connection_id"] is not None for item in items)
    verified = sum(item["status"] == "verified" for item in items)
    attention = len(items) - verified
    explicitly_attention = any(item["status"] == "attention" for item in items)
    status = "ready" if not attention else ("attention" if recorded or explicitly_attention else "unavailable")
    summary = (
        "All required connection capabilities are verified."
        if status == "ready"
        else "Some required connection capabilities need attention."
        if status == "attention"
        else "Connection coverage is not recorded in this Tool runtime state."
    )
    return {
        "status": status,
        "summary": summary,
        "total": len(items),
        "recorded": recorded,
        "verified": verified,
        "attention": attention,
        "items": items,
    }


def _command_projection(value: Any, index: int) -> dict[str, Any]:
    path = f"runtime_state.commands[{index}]"
    expected = {
        "command_id", "action", "status", "project_id", "updated_at",
        "prospect_release_ref", "trace_ref",
    }
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{path} must contain exactly the package command snapshot fields")
    if value["action"] not in _ACTIONS or value["status"] not in _COMMAND_STATES:
        raise ValueError(f"{path} contains an unsupported action or status")
    return {
        "command_id": _safe_ref(value["command_id"], f"{path}.command_id"),
        "action": value["action"],
        "status": value["status"],
        "project_id": _safe_ref(value["project_id"], f"{path}.project_id"),
        "prospect_release_ref": _safe_ref(
            value["prospect_release_ref"], f"{path}.prospect_release_ref", "release://prospect/"
        ),
        "trace_ref": _safe_ref(value["trace_ref"], f"{path}.trace_ref", "trace://outreach/"),
        "updated_at": _timestamp(value["updated_at"], f"{path}.updated_at"),
    }


def _outcome_projection(value: Any, index: int) -> tuple[dict[str, Any], dict[str, Any]]:
    path = f"runtime_state.outcomes[{index}]"
    expected = {"request_id", "command_id", "status", "action_receipt_ref", "recorded_at"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{path} must contain exactly the package outcome snapshot fields")
    if value["status"] not in _OUTCOME_STATES:
        raise ValueError(f"{path}.status is unsupported")
    receipt_ref = _safe_ref(value["action_receipt_ref"], f"{path}.action_receipt_ref", "receipt://")
    recorded_at = _timestamp(value["recorded_at"], f"{path}.recorded_at")
    output = {
        "request_id": _safe_ref(value["request_id"], f"{path}.request_id"),
        "command_id": _safe_ref(value["command_id"], f"{path}.command_id"),
        "status": value["status"],
        "action_receipt_ref": receipt_ref,
        "recorded_at": recorded_at,
    }
    receipt = {
        "kind": "connection-action",
        "command_id": output["command_id"],
        "receipt_ref": receipt_ref,
        "status": "recorded" if value["status"] not in _ATTENTION_STATES else value["status"],
        "recorded_at": recorded_at,
    }
    return output, receipt


def _receipt_projection(value: Any, index: int) -> dict[str, Any]:
    path = f"runtime_state.receipts[{index}]"
    expected = {"command_id", "kind", "receipt_ref", "status", "recorded_at"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{path} must contain exactly command_id, kind, receipt_ref, status, and recorded_at")
    if value["kind"] not in _RECEIPT_KINDS or value["status"] not in _RECEIPT_STATES:
        raise ValueError(f"{path} contains an unsupported receipt kind or status")
    return {
        "command_id": _safe_ref(value["command_id"], f"{path}.command_id"),
        "kind": value["kind"],
        "receipt_ref": _safe_ref(value["receipt_ref"], f"{path}.receipt_ref", "receipt://"),
        "status": value["status"],
        "recorded_at": _timestamp(value["recorded_at"], f"{path}.recorded_at"),
    }


def build_home_snapshot(runtime_state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Project authorized Outreach state without resolving prospects or sending mail."""
    if runtime_state is None:
        unavailable = _section("unavailable", "Runtime state is not connected.", [])
        return {
            "schema": SNAPSHOT_SCHEMA,
            "tool_id": TOOL_ID,
            "status": "unavailable",
            "summary": "Outreach runtime state is unavailable.",
            "overview": deepcopy(OVERVIEW),
            "connections": _connection_snapshot(),
            "current_work": dict(unavailable),
            "outputs": dict(unavailable),
            "receipts": dict(unavailable),
            "source_truth": "runtime",
        }
    if not isinstance(runtime_state, Mapping):
        raise TypeError("runtime_state must be a mapping or None")
    unknown = set(runtime_state) - _ALLOWED_STATE_KEYS
    if unknown:
        raise ValueError(f"runtime_state contains unsupported fields: {sorted(unknown)}")

    raw_connections = _sequence(runtime_state.get("connections", ()), "runtime_state.connections")
    connections = _connection_snapshot(raw_connections)
    commands = _sequence(runtime_state.get("commands", ()), "runtime_state.commands")
    work_items = [_command_projection(value, index) for index, value in enumerate(commands)]
    commands_by_id: dict[str, dict[str, Any]] = {}
    for item in work_items:
        if item["command_id"] in commands_by_id:
            raise ValueError("runtime_state.commands must not contain duplicate command_id values")
        commands_by_id[item["command_id"]] = item
    outcomes = _sequence(runtime_state.get("outcomes", ()), "runtime_state.outcomes")
    output_items: list[dict[str, Any]] = []
    receipt_items: list[dict[str, Any]] = []
    for index, outcome in enumerate(outcomes):
        output, receipt = _outcome_projection(outcome, index)
        command = commands_by_id.get(output["command_id"])
        if command is None:
            raise ValueError(f"runtime_state.outcomes[{index}] references an unknown command_id")
        if command["action"] != "delivery-request":
            raise ValueError(f"runtime_state.outcomes[{index}] must reference a delivery-request command")
        if _instant(output["recorded_at"]) < _instant(command["updated_at"]):
            raise ValueError(f"runtime_state.outcomes[{index}] predates its delivery-request command")
        output_items.append(output)
        receipt_items.append(receipt)
    earliest_successful_outcome_at: dict[str, datetime] = {}
    for output in output_items:
        if output["status"] not in {"accepted", "completed"}:
            continue
        recorded_at = _instant(output["recorded_at"])
        current = earliest_successful_outcome_at.get(output["command_id"])
        if current is None or recorded_at < current:
            earliest_successful_outcome_at[output["command_id"]] = recorded_at
    raw_receipts = _sequence(runtime_state.get("receipts", ()), "runtime_state.receipts")
    receipt_items.extend(
        _receipt_projection(value, index) for index, value in enumerate(raw_receipts)
    )
    for index, receipt in enumerate(receipt_items):
        command = commands_by_id.get(receipt["command_id"])
        if command is None:
            raise ValueError(f"runtime receipt {index} references an unknown command_id")
        if command["action"] != "delivery-request":
            raise ValueError(f"runtime receipt {index} must reference a delivery-request command")
        if _instant(receipt["recorded_at"]) < _instant(command["updated_at"]):
            raise ValueError(f"runtime receipt {index} predates its delivery-request command")
        successful_outcome_at = earliest_successful_outcome_at.get(receipt["command_id"])
        if (
            receipt["kind"] in _DELIVERY_GATE_KINDS
            and successful_outcome_at is not None
            and _instant(receipt["recorded_at"]) > successful_outcome_at
        ):
            raise ValueError(
                f"runtime receipt {index} postdates the earliest accepted or completed "
                "delivery outcome"
            )

    receipts_by_command: dict[str, set[str]] = {}
    for receipt in receipt_items:
        gate_passed = (
            receipt["status"] == "approved"
            if receipt["kind"] == "approval"
            else receipt["status"] == "pass"
        )
        if receipt["kind"] in _DELIVERY_GATE_KINDS and gate_passed:
            receipts_by_command.setdefault(receipt["command_id"], set()).add(receipt["kind"])
    successful_outcome_commands = set(earliest_successful_outcome_at)
    incomplete_delivery_commands: set[str] = set()
    for item in work_items:
        if item["action"] != "delivery-request":
            continue
        missing = sorted(_DELIVERY_GATE_KINDS - receipts_by_command.get(item["command_id"], set()))
        action_receipt_recorded = item["command_id"] in successful_outcome_commands
        action_receipt_ready = item["status"] != "completed" or action_receipt_recorded
        item["gate_receipts_complete"] = not missing and connections["status"] == "ready"
        item["action_receipt_recorded"] = action_receipt_recorded
        item["missing_gate_receipts"] = missing
        if not item["gate_receipts_complete"] or not action_receipt_ready:
            incomplete_delivery_commands.add(item["command_id"])

    connection_attention = (
        bool(raw_connections) or bool(work_items or output_items or receipt_items)
    ) and connections["status"] != "ready"
    state_attention = any(item["status"] in _ATTENTION_STATES for item in work_items + output_items + receipt_items)
    attention = connection_attention or state_attention or bool(incomplete_delivery_commands)
    has_state = bool(work_items or output_items or receipt_items)
    status = "attention" if attention else ("ready" if has_state else "empty")
    summary = (
        "Outreach work, delivery gates, or required connection coverage needs attention."
        if attention
        else "Runtime commands, outcomes, or receipts are recorded."
        if has_state
        else "Runtime is connected; no outreach work is recorded."
    )
    return {
        "schema": SNAPSHOT_SCHEMA,
        "tool_id": TOOL_ID,
        "status": status,
        "summary": summary,
        "overview": deepcopy(OVERVIEW),
        "connections": connections,
        "current_work": _section(
            "attention" if work_items and (connection_attention or incomplete_delivery_commands or any(item["status"] in _ATTENTION_STATES for item in work_items)) else ("ready" if work_items else "empty"),
            f"{len(work_items)} outreach command{'s' if len(work_items) != 1 else ''} recorded.",
            work_items,
            len(commands),
        ),
        "outputs": _section(
            "attention" if any(item["status"] in _ATTENTION_STATES for item in output_items) else ("ready" if output_items else "empty"),
            f"{len(output_items)} delivery-request outcome{'s' if len(output_items) != 1 else ''} recorded.",
            output_items,
            len(outcomes),
        ),
        "receipts": _section(
            "attention" if any(item["status"] in _ATTENTION_STATES for item in receipt_items) else ("ready" if receipt_items else "empty"),
            f"{len(receipt_items)} policy/action receipt reference{'s' if len(receipt_items) != 1 else ''} available.",
            receipt_items,
        ),
        "source_truth": "runtime",
    }
