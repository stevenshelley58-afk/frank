"""Frank work API: browser-facing routes for project tasks and routines.

Every browser mutation passes the strict same-origin guard before any body is
parsed or any operation executes. Project scope is enforced server-side from
the migrated registry; the browser can never supply a workspace path, board
slug, profile, or native ID binding. Server-to-server callers (Hub
conversational tools) use the same service methods through their separate
service credential.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path

from flask import Blueprint, abort, jsonify, request

import work_cron
import work_providers
import work_routines
import work_service

api = Blueprint("work_api", __name__)

DEFAULT_ALLOWED_ORIGINS = (
    "https://frank.fail",
    "http://localhost", "http://localhost:5000", "http://127.0.0.1", "http://127.0.0.1:5000",
)

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
DATA_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
_ledger = work_service.OperationLedger(
    Path(os.environ.get("WORK_LEDGER_FILE", str(DATA_DIR / "work-operations.jsonl"))))
_bindings = work_service.BindingStore(
    Path(os.environ.get("WORK_BINDINGS_FILE", str(DATA_DIR / "work-board-bindings.json"))))
_project_loader = None
_kanban = None
_leases = None
_resolver = None
_cron = None
_scripts_root = os.environ.get("HERMES_SCRIPTS_ROOT", "")


def configure(*, project_loader, kanban, resolver, leases, cron_client: work_cron.CronClient) -> None:
    """Integration wiring (Session 1). Ports bind to the frozen adapter and
    the foundation resolver/lease service; nothing here substitutes for them."""
    global _project_loader, _kanban, _leases, _resolver, _cron
    _project_loader = project_loader
    _kanban = kanban
    _leases = leases
    _resolver = resolver
    _cron = cron_client
    work_providers.configure_services(
        lambda: _task_service(), lambda: _routine_service())


def _wired():
    if not all((_project_loader, _kanban, _resolver)):
        abort(503, description="work service is not configured")
    return _project_loader


def _task_service() -> work_service.TaskService:
    _wired()
    return work_service.TaskService(
        project_loader=_project_loader, bindings=_bindings, kanban=_kanban,
        leases=_leases, resolver=_resolver, ledger=_ledger)


def _routine_service() -> work_routines.RoutineService:
    if _cron is None:
        abort(503, description="work service is not configured")
    return work_routines.RoutineService(
        cron=_cron, project_loader=_project_loader, resolver=_resolver,
        leases=_leases, ledger=_ledger, scripts_root=_scripts_root)


def strict_same_origin() -> None:
    """Centralized strict same-origin guard for browser mutations.

    Missing/null Origin (non-browser or explicit cross-site), non-allowlisted
    origins, and wrong content types fail closed with 403/415 before the body
    is parsed. Hoisted app-wide by the integration patch; this blueprint's
    mutation routes always call it first.
    """
    origin = (request.headers.get("Origin") or "").strip().rstrip("/")
    allowed = {
        item.strip().rstrip("/") for item in os.environ.get(
            "FRANK_WORK_ALLOWED_ORIGINS", ",".join(DEFAULT_ALLOWED_ORIGINS)
        ).split(",") if item.strip()
    }
    if not origin or origin not in allowed:
        abort(403, description="cross-site mutation refused")
    content_type = (request.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        abort(415, description="mutation requires application/json")


def _body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        abort(400, description="request body must be a JSON object")
    return body


def _error_response(error: work_service.WorkError):
    response = jsonify({"error": str(error), "code": error.code})
    response.status_code = error.status
    response.headers["Cache-Control"] = "no-store"
    return response


@api.errorhandler(work_service.WorkError)
def _work_error(error: work_service.WorkError):
    return _error_response(error)


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


@api.get("/api/work/tasks")
def tasks_list():
    service = _task_service()
    result = service.list_tasks(
        request.args.get("project_id", ""),
        group=request.args.get("group") or None,
        search=request.args.get("q") or None,
        updated_since=request.args.get("updated_since", type=int),
        include_archived=request.args.get("include_archived") == "true",
        limit=request.args.get("limit", type=int) or work_service.PAGE_LIMIT,
    )
    return jsonify(result)


@api.post("/api/work/tasks")
def tasks_create():
    strict_same_origin()
    body = _body()
    result = _task_service().create_task(
        str(body.get("project_id") or ""),
        title=body.get("title"), body=body.get("body"), priority=body.get("priority"),
        skills=body.get("skills"), attachment_ids=body.get("attachment_ids"),
        operation_id=body.get("operation_id"),
    )
    return jsonify(result), 201


@api.get("/api/work/tasks/<task_id>")
def task_get(task_id: str):
    service = _task_service()
    project_id = request.args.get("project_id", "")
    if request.args.get("detail") == "true":
        return jsonify(service.task_detail(project_id, task_id))
    return jsonify(service.get_task(project_id, task_id))


@api.get("/api/work/tasks/<task_id>/events")
def task_events(task_id: str):
    service = _task_service()
    cursor = request.args.get("cursor", type=int) or 0
    return jsonify(service.task_events(
        request.args.get("project_id", ""), task_id, cursor,
        request.args.get("limit", type=int) or work_service.EVENT_PAGE))


@api.patch("/api/work/tasks/<task_id>")
def task_update(task_id: str):
    strict_same_origin()
    body = _body()
    result = _task_service().update_task(
        str(body.get("project_id") or ""), task_id,
        title=body.get("title"), body=body.get("body"), priority=body.get("priority"),
        expected_revision=body.get("expected_revision"), operation_id=body.get("operation_id"))
    return jsonify(result)


@api.post("/api/work/tasks/<task_id>/actions/<action>")
def task_action(task_id: str, action: str):
    strict_same_origin()
    body = _body()
    service = _task_service()
    project_id = str(body.get("project_id") or "")
    task_id_clean = work_service.require_id(task_id, "task id")
    handler = {
        "ready": lambda: service.mark_ready(project_id, task_id_clean, body.get("operation_id")),
        "start": lambda: service.start_task(project_id, task_id_clean, body.get("operation_id")),
        "comment": lambda: service.comment(project_id, task_id_clean, body.get("text"), body.get("operation_id")),
        "attach": lambda: service.attach(project_id, task_id_clean, body.get("attachment_id"), body.get("operation_id")),
        "block": lambda: service.block(project_id, task_id_clean, body.get("reason"), body.get("detail"), body.get("operation_id")),
        "unblock": lambda: service.unblock(project_id, task_id_clean, body.get("operation_id")),
        "review": lambda: service.request_review(project_id, task_id_clean, body.get("operation_id")),
        "changes": lambda: service.request_changes(project_id, task_id_clean, body.get("detail"), body.get("operation_id")),
        "retry": lambda: service.retry_task(project_id, task_id_clean, body.get("operation_id")),
        "complete": lambda: service.complete_task(project_id, task_id_clean, body.get("operation_id")),
        "archive": lambda: service.archive_task(project_id, task_id_clean, body.get("operation_id")),
        "terminate": lambda: service.terminate_run(project_id, task_id_clean, body.get("run_id"), body.get("operation_id")),
    }.get(action)
    if handler is None:
        abort(404, description="unknown task action")
    return jsonify(handler())


# ---------------------------------------------------------------------------
# Routines
# ---------------------------------------------------------------------------


@api.get("/api/work/routines")
def routines_list():
    return jsonify(_routine_service().list_routines(request.args.get("project_id", "")))


@api.post("/api/work/routines/preview")
def routines_preview():
    strict_same_origin()
    body = _body()
    return jsonify(_routine_service().preview(
        str(body.get("project_id") or ""), schedule=body.get("schedule")))


@api.post("/api/work/routines")
def routines_create():
    strict_same_origin()
    body = _body()
    result = _routine_service().create_routine(
        str(body.get("project_id") or ""),
        name=body.get("name"), prompt=body.get("prompt"), script=body.get("script"),
        schedule=body.get("schedule"), skills=body.get("skills"), model=body.get("model"),
        provider=body.get("provider"), continuity=body.get("continuity"),
        deliver=body.get("deliver"), enabled_toolsets=body.get("enabled_toolsets"),
        monitor_url=body.get("monitor_url"), operation_id=body.get("operation_id"))
    return jsonify(result), 201


@api.get("/api/work/routines/<job_id>")
def routine_get(job_id: str):
    service = _routine_service()
    return jsonify(service.get_routine(request.args.get("project_id", ""), job_id))


@api.patch("/api/work/routines/<job_id>")
def routine_update(job_id: str):
    strict_same_origin()
    body = _body()
    result = _routine_service().update_routine(
        str(body.get("project_id") or ""), job_id,
        schedule=body.get("schedule"), prompt=body.get("prompt"), name=body.get("name"),
        skills=body.get("skills"), model=body.get("model"), provider=body.get("provider"),
        continuity=body.get("continuity"), deliver=body.get("deliver"),
        enabled_toolsets=body.get("enabled_toolsets"), monitor_url=body.get("monitor_url"))
    return jsonify(result)


@api.post("/api/work/routines/<job_id>/actions/<action>")
def routine_action(job_id: str, action: str):
    strict_same_origin()
    body = _body()
    service = _routine_service()
    project_id = str(body.get("project_id") or "")
    if action == "pause":
        return jsonify(service.pause(project_id, job_id))
    if action == "resume":
        return jsonify(service.resume(project_id, job_id))
    if action == "run-now":
        return jsonify(service.run_now(project_id, job_id, body.get("operation_id")))
    abort(404, description="unknown routine action")


@api.delete("/api/work/routines/<job_id>")
def routine_delete(job_id: str):
    strict_same_origin()
    body = _body()
    return jsonify(_routine_service().delete_routine(
        str(body.get("project_id") or ""), job_id, confirm=body.get("confirm")))


@api.get("/api/work/gateway")
def gateway_health():
    return jsonify(_routine_service().gateway_health())


# ---------------------------------------------------------------------------
# Hub projections (Overnight / Waiting / Running read models)
# ---------------------------------------------------------------------------


def _hub_body(compute) -> dict:
    _wired()
    projects = work_providers.enabled_projects(_project_loader)
    body = compute(projects)
    return jsonify({
        "schema": "schema://frank.widget-snapshot/v1",
        "status": body["status"], "summary": body["summary"], "data": body["data"],
        "links": [], "generated_at": int(time.time()), "source_truth": "hermes",
    })


@api.get("/api/work/hub/overnight")
def hub_overnight():
    return _hub_body(work_providers.hub_overnight)


@api.get("/api/work/hub/waiting")
def hub_waiting():
    return _hub_body(work_providers.hub_waiting)


@api.get("/api/work/hub/running")
def hub_running():
    return _hub_body(work_providers.hub_running)


@api.post("/api/work/hub/acknowledge")
def hub_acknowledge():
    strict_same_origin()
    _body()
    moment = work_providers.PresentationCursor().acknowledge()
    return jsonify({"acknowledged_at": moment})
