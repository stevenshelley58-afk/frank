"""Deterministic native Hermes work-state to Frank-friendly projection.

The native Kanban/run states are preserved verbatim in stored data; this module
only derives display groups and labels. Unknown native values are retained
under the explicit ``unknown`` group and never guessed. Frozen by tests in
``tests/test_work_state.py``.
"""
from __future__ import annotations

# Native Kanban task statuses (upstream v2026.8.31 kanban_db.VALID_STATUSES,
# frozen by contract FRANK_HERMES_V021_CONTRACT §7).
NATIVE_TASK_STATES = frozenset({
    "triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived",
})

# Native task-run states that may be observed on a task's active/last run.
NATIVE_RUN_STATES = frozenset({
    "starting", "running", "stopping", "succeeded", "failed", "cancelled",
})

TASK_GROUP = {
    "triage": "queued",
    "todo": "queued",
    "scheduled": "queued",
    "ready": "queued",
    "running": "running",
    "blocked": "waiting",
    "review": "waiting",
    "done": "completed",
    "archived": "archived",
}

TASK_LABEL = {
    "triage": "Planned",
    "todo": "Queued",
    "scheduled": "Scheduled",
    "ready": "Ready",
    "running": "Running",
    "blocked": "Waiting",
    "review": "Waiting for review",
    "done": "Completed",
    "archived": "Archived",
}

RUN_GROUP = {
    "starting": "transitional",
    "running": "running",
    "stopping": "transitional",
    "succeeded": "terminal",
    "failed": "terminal",
    "cancelled": "terminal",
}

RUN_LABEL = {
    "starting": "Starting",
    "running": "Running",
    "stopping": "Stopping",
    "succeeded": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled",
}

# Groups that count as passive (no worker may exist before an explicit start).
PASSIVE_GROUPS = frozenset({"queued"})
# Groups that count as active human attention states in Hub summaries.
WAITING_GROUPS = frozenset({"waiting"})

UNKNOWN_GROUP = "unknown"
UNKNOWN_LABEL = "Unknown"


def task_group(native_state: str) -> str:
    return TASK_GROUP.get(str(native_state or ""), UNKNOWN_GROUP)


def task_label(native_state: str) -> str:
    return TASK_LABEL.get(str(native_state or ""), UNKNOWN_LABEL)


def is_passive(native_state: str) -> bool:
    """True only for passive planned/queued states with no worker."""
    return task_group(native_state) in PASSIVE_GROUPS


def is_terminal(native_state: str) -> bool:
    return task_group(native_state) in {"completed", "archived"}


def run_group(native_run_state: str) -> str:
    return RUN_GROUP.get(str(native_run_state or ""), UNKNOWN_GROUP)


def run_label(native_run_state: str) -> str:
    return RUN_LABEL.get(str(native_run_state or ""), UNKNOWN_LABEL)


def project_task(native_task: dict) -> dict:
    """Project one native task row to the Frank read model.

    The native state is never collapsed: it is carried through verbatim and the
    friendly group/label are additive projections.
    """
    native_state = str(native_task.get("state") or "")
    row = dict(native_task)
    row["native_state"] = native_state
    row["group"] = task_group(native_state)
    row["label"] = task_label(native_state)
    row["hidden_by_default"] = row["group"] == "archived"
    run_state = str(native_task.get("run_state") or "")
    if run_state:
        row["run_group"] = run_group(run_state)
        row["run_label"] = run_label(run_state)
    return row


def summarize(rows: list[dict]) -> dict:
    """Compact truthful counts for widget snapshots. Never invents data."""
    counts = {group: 0 for group in ("queued", "running", "waiting", "completed", "archived")}
    counts[UNKNOWN_GROUP] = 0
    for row in rows:
        counts[row.get("group", UNKNOWN_GROUP)] = counts.get(row.get("group", UNKNOWN_GROUP), 0) + 1
    return counts
