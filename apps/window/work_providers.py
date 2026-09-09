"""Work widget providers: read-model projections for entity homes and the Hub.

Providers are read-only; they never mutate Hermes state and never store a
second copy of task or job truth. Registration follows the existing
``home_providers`` snapshot contract so each widget failure stays isolated to
its own card. Hub Overnight/Waiting/Running bodies are computed here too and
served through ``work_api`` for the existing Hub slide renderers, so the Hub
and entity homes share one read model. The integration owner (Session 1)
imports this module once and extends the central widget catalogue with
``WORK_WIDGET_MANIFESTS``.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

import home_providers
from home_providers import ProviderContext, internal_link, snapshot

import work_state

DATA_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
_CURSOR_FILE = Path(os.environ.get("WORK_CURSOR_FILE", str(DATA_DIR / "work-view-cursor.json")))
MAX_ROWS = 8
BATCH_LIMIT = 50

_task_service_factory = None
_routine_service_factory = None


def configure_services(task_service_factory, routine_service_factory) -> None:
    """Integration wiring (Session 1): callables returning configured services."""
    global _task_service_factory, _routine_service_factory
    _task_service_factory = task_service_factory
    _routine_service_factory = routine_service_factory


def _tasks():
    if _task_service_factory is None:
        return None
    try:
        return _task_service_factory()
    except Exception:
        return None


def _routines():
    if _routine_service_factory is None:
        return None
    try:
        return _routine_service_factory()
    except Exception:
        return None


def _unavailable(reason: str, ctx: ProviderContext | None = None, links=None) -> dict:
    return snapshot("unavailable", reason, {"reason": reason[:160]}, links or [],
                    now=int(ctx.now) if ctx else int(time.time()))


class PresentationCursor:
    """Tiny presentation-only acknowledgement cursor for the Hub.

    Explicitly separated from Hermes truth: losing or resetting this file can
    never lose work — it only changes what the Overnight summary highlights.
    """

    def __init__(self, path: Path = _CURSOR_FILE):
        self.path = Path(path)
        self._lock = threading.RLock()

    def acknowledged_before(self) -> int:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return 0
        value = data.get("acknowledged_at") if isinstance(data, dict) else None
        return int(value) if isinstance(value, (int, float)) else 0

    def acknowledge(self, at: int | None = None) -> int:
        moment = int(at or time.time())
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
            temp.write_text(json.dumps({"acknowledged_at": moment}), encoding="utf-8")
            temp.replace(self.path)
        return moment


def _collect_all_tasks(projects: list[dict] | None) -> list[dict] | None:
    """Read-only task rows across every enabled project (bounded)."""
    service = _tasks()
    if service is None:
        return None
    rows: list[dict] = []
    for project in projects or []:
        try:
            result = service.list_tasks(str(project.get("id")), limit=BATCH_LIMIT)
        except Exception:
            continue  # one project's failure cannot hide the others
        rows.extend(result.get("tasks") or [])
    return rows


# ---------------------------------------------------------------------------
# Hub projection bodies (shared by Hub endpoints and entity-home providers)
# ---------------------------------------------------------------------------


def hub_overnight(projects: list[dict] | None) -> dict:
    service = _tasks()
    routines = _routines()
    if service is None or routines is None:
        return {"status": "unavailable", "summary": "Work summaries are not configured yet.", "data": {}}
    rows = _collect_all_tasks(projects)
    if rows is None:
        return {"status": "unavailable", "summary": "Work summaries are unavailable.", "data": {}}
    since = PresentationCursor().acknowledged_before()
    completed = [row for row in rows if row["group"] == "completed"
                 and int(row.get("updated_at") or 0) > since]
    ran = [{"id": row["id"], "title": row["title"], "finished_at": row.get("updated_at"),
            "result": row.get("run_label") or row["label"]} for row in completed[:MAX_ROWS]]
    scheduled = []
    for project in projects or []:
        try:
            schedule = routines.list_routines(str(project.get("id")))
        except Exception:
            continue
        for item in schedule.get("routines") or []:
            if int(item.get("last_run_at") or 0) > since or item.get("next_run_at"):
                scheduled.append({
                    "project_id": str(project.get("id")), "id": item["id"], "name": item["name"],
                    "last_status": item.get("last_status"), "next_run_at": item.get("next_run_at"),
                })
    scheduled = sorted(scheduled, key=lambda item: str(item.get("next_run_at") or ""))[:MAX_ROWS]
    body = {"since": since, "completed": ran, "completed_count": len(completed),
            "scheduled_activity": scheduled}
    if not ran and not scheduled:
        return {"status": "empty", "summary": "Nothing completed or scheduled since your last visit.",
                "data": body}
    return {"status": "ready",
            "summary": f"{len(completed)} completed item{'' if len(completed) == 1 else 's'} since your last visit.",
            "data": body}


def hub_waiting(projects: list[dict] | None) -> dict:
    rows = _collect_all_tasks(projects)
    if rows is None:
        return {"status": "unavailable", "summary": "Work summaries are not configured yet.", "data": {}}
    waiting = [row for row in rows if row["group"] == "waiting"]
    body_rows = [{"id": row["id"], "title": row["title"], "native_state": row["native_state"],
                  "label": row["label"]} for row in waiting[:MAX_ROWS]]
    body = {"rows": body_rows, "count": len(waiting)}
    if not waiting:
        return {"status": "empty", "summary": "Nothing is waiting on you.", "data": body}
    approvals = sum(1 for row in waiting if row["native_state"] == "review")
    summary = f"{len(waiting)} item{'' if len(waiting) == 1 else 's'} waiting"
    if approvals:
        summary += f"; {approvals} review request{'' if approvals == 1 else 's'}."
    return {"status": "ready", "summary": summary, "data": body}


def hub_running(projects: list[dict] | None) -> dict:
    rows = _collect_all_tasks(projects)
    if rows is None:
        return {"status": "unavailable", "summary": "Work summaries are not configured yet.", "data": {}}
    running = [row for row in rows if row["group"] == "running"]
    body_rows = [{"id": row["id"], "title": row["title"], "run_state": row.get("run_state", ""),
                  "label": row["label"]} for row in running[:MAX_ROWS]]
    body = {"rows": body_rows, "count": len(running)}
    if not running:
        return {"status": "empty", "summary": "Nothing is running.", "data": body}
    return {"status": "ready", "summary": f"{len(running)} active item{'' if len(running) == 1 else 's'}.",
            "data": body}


def enabled_projects(project_loader) -> list[dict]:
    return [item for item in (project_loader() or [])
            if isinstance(item, dict) and item.get("id")
            and not item.get("disabled") and not item.get("quarantined")
            and item.get("workspace_id")]


# ---------------------------------------------------------------------------
# Entity-home project work widget (snapshot contract)
# ---------------------------------------------------------------------------


def _project_work(ctx: ProviderContext) -> dict:
    service = _tasks()
    routines = _routines()
    if service is None or routines is None:
        return _unavailable("Work providers are not configured yet.", ctx,
                            [internal_link("Open Hub", view="hub")])
    if ctx.kind != "project":
        return _unavailable("Work is available on project homes.", ctx)
    try:
        listing = service.list_tasks(ctx.entity_id, limit=BATCH_LIMIT)
        schedule = routines.list_routines(ctx.entity_id)
    except Exception as error:
        return _unavailable(f"Work summaries are unavailable: {str(error)[:140]}", ctx)
    rows = listing.get("tasks") or []
    counts = work_state.summarize(rows)
    active = next((row for row in rows if row["group"] == "running"), None)
    waiting = [row for row in rows if row["group"] == "waiting"]
    completed_recent = [row for row in rows if row["group"] == "completed"][:3]
    with_next = [item for item in (schedule.get("routines") or []) if item.get("next_run_at")]
    next_routine = min(with_next, key=lambda item: str(item.get("next_run_at")), default=None)
    return snapshot(
        "ready",
        f"{counts.get('running', 0)} running · {counts.get('waiting', 0)} waiting",
        {
            "running_count": counts.get("running", 0),
            "waiting_count": counts.get("waiting", 0),
            "queued_count": counts.get("queued", 0),
            "completed_count": counts.get("completed", 0),
            "active": {"id": active["id"], "title": active["title"],
                       "run_state": active.get("run_state", "")} if active else None,
            "waiting_rows": [{"id": row["id"], "title": row["title"],
                              "native_state": row["native_state"]} for row in waiting[:MAX_ROWS]],
            "completed_rows": [{"id": row["id"], "title": row["title"]} for row in completed_recent],
            "next_routine": ({"id": next_routine["id"], "name": next_routine["name"],
                              "next_run_at": next_routine["next_run_at"]} if next_routine else None),
            "routine_count": len(schedule.get("routines") or []),
        },
        [
            internal_link("Inspect all work", view="project"),
            internal_link("Open Hub", view="hub"),
        ],
        now=ctx.now,
    )


home_providers.register("project-work")(_project_work)

WORK_WIDGET_MANIFESTS = [
    {
        "id": "project-work", "version": "1.0.0", "title": "Project work",
        "description": "Durable Hermes tasks and routines for this project.",
        "schema_source": "docs/contracts/FRANK_HERMES_V021_CONTRACT.md",
        "source_truth": "hermes",
        "surfaces": ["project"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.work",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "work-overnight", "version": "1.0.0", "title": "Overnight",
        "description": "Hub slide read model: completed work and scheduled activity "
                       "since the last acknowledged visit.",
        "schema_source": "docs/contracts/FRANK_HERMES_V021_CONTRACT.md",
        "source_truth": "hermes",
        "surfaces": ["hub"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.work",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "work-waiting", "version": "1.0.0", "title": "Waiting",
        "description": "Hub slide read model: blocked tasks, review requests, pending approvals.",
        "schema_source": "docs/contracts/FRANK_HERMES_V021_CONTRACT.md",
        "source_truth": "hermes",
        "surfaces": ["hub"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.work",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "work-running", "version": "1.0.0", "title": "Running",
        "description": "Hub slide read model: current tasks, runs, and subagents.",
        "schema_source": "docs/contracts/FRANK_HERMES_V021_CONTRACT.md",
        "source_truth": "hermes",
        "surfaces": ["hub"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.work",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
    },
]
