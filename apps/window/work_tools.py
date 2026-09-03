"""Narrow authenticated Hub conversational tools for work and routines.

Session-1 registers these manifests through Hermes's approved tool/MCP
boundary. Handlers reuse the exact TaskService/RoutineService methods behind
the project widgets — the same Hermes task/job IDs, the same project scope,
the same operation ledger — so chat mutations and UI mutations share one path.
Reads are bounded; mutations require an explicit confirmation string and a
client operation id. There is no chat-only store and no duplicate mutation
path.
"""
from __future__ import annotations

from typing import Callable

import work_routines
import work_service

MAX_SUMMARY_ROWS = 10

_task_service_factory: Callable[[], work_service.TaskService] | None = None
_routine_service_factory: Callable[[], work_routines.RoutineService] | None = None


def configure_services(task_service_factory, routine_service_factory) -> None:
    global _task_service_factory, _routine_service_factory
    _task_service_factory = task_service_factory
    _routine_service_factory = routine_service_factory


def _tasks() -> work_service.TaskService:
    if _task_service_factory is None:
        raise work_service.UnavailableError("work tools are not configured")
    return _task_service_factory()


def _routines() -> work_routines.RoutineService:
    if _routine_service_factory is None:
        raise work_service.UnavailableError("work tools are not configured")
    return _routine_service_factory()


WORK_TOOLS = [
    {
        "id": "frank.work.summary",
        "version": "1.0.0",
        "description": "Bounded cross-project summary of running, waiting, and completed Hermes work.",
        "kind": "read",
        "arguments": {"project_id": {"type": "string", "required": False}},
    },
    {
        "id": "frank.work.inspect",
        "version": "1.0.0",
        "description": "Inspect one Hermes task's truthful detail for a project.",
        "kind": "read",
        "arguments": {"project_id": {"type": "string", "required": True},
                      "task_id": {"type": "string", "required": True}},
    },
    {
        "id": "frank.work.task_create",
        "version": "1.0.0",
        "description": "Create a passive-by-default Hermes task in one project.",
        "kind": "mutation",
        "arguments": {"project_id": {"type": "string", "required": True},
                      "title": {"type": "string", "required": True},
                      "body": {"type": "string", "required": False},
                      "operation_id": {"type": "string", "required": True},
                      "confirmation": {"type": "string", "required": True}},
    },
    {
        "id": "frank.work.task_start",
        "version": "1.0.0",
        "description": "Start (dispatch a worker for) one ready Hermes task.",
        "kind": "mutation",
        "arguments": {"project_id": {"type": "string", "required": True},
                      "task_id": {"type": "string", "required": True},
                      "operation_id": {"type": "string", "required": True},
                      "confirmation": {"type": "string", "required": True}},
    },
    {
        "id": "frank.work.routine_create",
        "version": "1.0.0",
        "description": "Create a real Hermes cron routine (inert-first two-phase).",
        "kind": "mutation",
        "arguments": {"project_id": {"type": "string", "required": True},
                      "name": {"type": "string", "required": True},
                      "schedule": {"type": "string", "required": True},
                      "prompt": {"type": "string", "required": False},
                      "operation_id": {"type": "string", "required": True},
                      "confirmation": {"type": "string", "required": True}},
    },
    {
        "id": "frank.work.routine_run_now",
        "version": "1.0.0",
        "description": "Run one existing Hermes routine now (leased, ledgered).",
        "kind": "mutation",
        "arguments": {"project_id": {"type": "string", "required": True},
                      "job_id": {"type": "string", "required": True},
                      "operation_id": {"type": "string", "required": True},
                      "confirmation": {"type": "string", "required": True}},
    },
]


def _require_confirmation(arguments: dict) -> None:
    if str(arguments.get("confirmation") or "").strip().lower() != "confirm":
        raise work_service.WorkError(
            "this mutation requires the explicit confirmation string 'confirm'",
            status=403, code="confirmation_required")


def dispatch(tool_id: str, arguments: dict) -> dict:
    """Execute one registered tool; unknown tools fail closed."""
    arguments = dict(arguments or {})
    if tool_id == "frank.work.summary":
        service = _tasks()
        project_id = str(arguments.get("project_id") or "")
        if project_id:
            listing = service.list_tasks(project_id, limit=MAX_SUMMARY_ROWS)
            return {"project_id": project_id, "tasks": listing.get("tasks") or []}
        raise work_service.WorkError(
            "cross-project summaries are read-model only; supply a project_id for tasks",
            status=400)
    if tool_id == "frank.work.inspect":
        service = _tasks()
        return service.task_detail(str(arguments.get("project_id") or ""),
                                   str(arguments.get("task_id") or ""))
    if tool_id == "frank.work.task_create":
        _require_confirmation(arguments)
        return _tasks().create_task(
            str(arguments.get("project_id") or ""),
            title=arguments.get("title"), body=arguments.get("body"),
            operation_id=arguments.get("operation_id"))
    if tool_id == "frank.work.task_start":
        _require_confirmation(arguments)
        return _tasks().start_task(str(arguments.get("project_id") or ""),
                                   str(arguments.get("task_id") or ""),
                                   arguments.get("operation_id"))
    if tool_id == "frank.work.routine_create":
        _require_confirmation(arguments)
        return _routines().create_routine(
            str(arguments.get("project_id") or ""),
            name=arguments.get("name"), prompt=arguments.get("prompt"),
            schedule=arguments.get("schedule"), operation_id=arguments.get("operation_id"))
    if tool_id == "frank.work.routine_run_now":
        _require_confirmation(arguments)
        return _routines().run_now(str(arguments.get("project_id") or ""),
                                   str(arguments.get("job_id") or ""),
                                   arguments.get("operation_id"))
    raise work_service.WorkError("unknown work tool", status=404, code="unknown_tool")
