"""Normalization of native Hermes events into the contracted Frank envelope.

Contract §3: every event is mapped exactly once into

    {"seq", "native_event", "derived_label", "run_id", "session_id",
     "timestamp", "payload", "frank_origin": false}

with the frozen ``derived_label`` set:

    terminal_error | provider_error | approval_required | tool_progress |
    assistant_message | reasoning_delta | todo_updated | subagent_lifecycle |
    unknown

Unknown native events are retained verbatim under ``unknown`` — never dropped,
never guessed.  Native and Frank-derived names stay separate.  Interim
``already_streamed`` chunks reconcile against finals by ``seq`` dedupe.
Payloads are redacted before this module ever sees persistence or fan-out.
"""
from __future__ import annotations

import time
from typing import Any, Iterable

DERIVED_LABELS = frozenset({
    "terminal_error",
    "provider_error",
    "approval_required",
    "tool_progress",
    "assistant_message",
    "reasoning_delta",
    "todo_updated",
    "subagent_lifecycle",
    "unknown",
})

# Frozen native-event -> derived_label table (prefix rules applied first).
_DERIVED_BY_EXACT = {
    "run.failed": "terminal_error",
    "run.cancelled": "terminal_error",
    "run.expired": "terminal_error",
    "run.provider_error": "provider_error",
    "run.approval_required": "approval_required",
    "approval.pending": "approval_required",
    "todo.updated": "todo_updated",
    "subagent.started": "subagent_lifecycle",
    "subagent.finished": "subagent_lifecycle",
}

_DERIVED_BY_PREFIX = (
    ("run.tool", "tool_progress"),
    ("tool.", "tool_progress"),
    ("message.assistant", "assistant_message"),
    ("assistant.", "assistant_message"),
    ("reasoning.", "reasoning_delta"),
    ("thinking.", "reasoning_delta"),
    ("subagent.", "subagent_lifecycle"),
)

_ALREADY_STREAMED_FLAG = "already_streamed"


def derived_label(native_event: str) -> str:
    if not isinstance(native_event, str) or not native_event:
        return "unknown"
    if native_event in _DERIVED_BY_EXACT:
        return _DERIVED_BY_EXACT[native_event]
    for prefix, label in _DERIVED_BY_PREFIX:
        if native_event.startswith(prefix):
            return label
    return "unknown"


def normalize(
    seq: int,
    native_event: str,
    payload: dict[str, Any],
    *,
    run_id: str = "",
    session_id: str = "",
    timestamp: float | None = None,
    frank_origin: bool = False,
) -> dict[str, Any]:
    if not isinstance(seq, int) or seq < 0:
        raise ValueError("seq must be a non-negative integer")
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    label = derived_label(native_event)
    return {
        "seq": seq,
        "native_event": native_event if isinstance(native_event, str) else str(native_event),
        "derived_label": label,
        "run_id": run_id,
        "session_id": session_id,
        "timestamp": time.time() if timestamp is None else timestamp,
        "payload": payload,
        "frank_origin": frank_origin,
    }


class SequenceTracker:
    """Exactly-once dedupe over native sequence numbers."""

    def __init__(self):
        self._seen: set[int] = set()

    def first_time(self, seq: int) -> bool:
        if seq in self._seen:
            return False
        self._seen.add(seq)
        return True

    def reconcile(self, events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        """Drop duplicates; reconcile interim ``already_streamed`` chunks.

        An interim chunk flagged ``already_streamed`` is superseded by a final
        event with the same ``seq`` (finals win); interim-only seqs stay
        visible exactly once.  Ordering by ``seq`` is preserved; gaps are left
        for the replay layer to mark, never filled.
        """
        kept: dict[int, dict[str, Any]] = {}
        for event in events:
            seq = event.get("seq")
            if not isinstance(seq, int) or seq < 0:
                continue
            payload = event.get("payload") or {}
            interim = bool(payload.get(_ALREADY_STREAMED_FLAG))
            existing = kept.get(seq)
            if existing is not None:
                existing_interim = bool((existing.get("payload") or {}).get(_ALREADY_STREAMED_FLAG))
                if existing_interim and not interim:
                    kept[seq] = event
                continue
            kept[seq] = event
        return [kept[seq] for seq in sorted(kept)]
