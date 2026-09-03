"""KanbanPort backed by the pinned `hermes kanban --json` CLI on the host.

Frank runs containerized, so the CLI is not executable in-process. Calls go
through the narrowly authenticated host bridge (frank_kanban_bridge.py) which
runs the frozen argv contract as the `hermes` user and returns parsed JSON.
The bridge credential is runtime-only and never reaches the browser.

Every verb is validated on both sides against the contracted allowlist; no
shell interpolation exists anywhere in this path.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import work_service


class BridgeUnavailable(work_service.AdapterUnavailable):
    pass


_ALLOWED_VERBS = frozenset({
    "create", "show", "list", "comment", "attach", "promote", "assign",
    "dispatch", "block", "unblock", "request-review", "request-changes",
    "reclaim", "complete", "archive", "runs", "log", "boards",
})

# Private host fields that must never leave the server boundary (contract §4).
_PRIVATE_KEYS = frozenset({"db_path", "database", "sqlite_path"})


def _sanitize(value):
    """Recursively strip private host fields from CLI JSON."""
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items() if k not in _PRIVATE_KEYS}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    return value


class BridgeKanbanPort:
    """WorkService.KanbanPort implemented over the host CLI bridge."""

    def __init__(self, *, base_url: str, key_provider, slug_for=None,
                 timeout: float = 45.0):
        self._base_url = (base_url or "").rstrip("/")
        self._key_provider = key_provider
        self._slug_for = slug_for
        self._timeout = float(timeout)

    def _call(self, verb: str, args: list) -> dict:
        if verb not in _ALLOWED_VERBS:
            raise BridgeUnavailable(f"kanban verb {verb!r} is not contracted")
        if not self._base_url:
            raise BridgeUnavailable("kanban bridge is not configured")
        key = self._key_provider() if callable(self._key_provider) else self._key_provider
        if not key:
            raise BridgeUnavailable("kanban bridge credential is not configured")
        clean_args = [str(a) for a in args if a is not None and str(a) != ""]
        body = json.dumps({"verb": verb, "args": clean_args}).encode("utf-8")
        req = urllib.request.Request(
            self._base_url + "/kanban",
            data=body,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:300]
            raise BridgeUnavailable(f"kanban bridge returned HTTP {err.code}: {detail}") from err
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            raise BridgeUnavailable(f"kanban bridge unreachable: {err}") from err
        if not payload.get("ok"):
            raise BridgeUnavailable(str(payload.get("error") or "kanban bridge call failed"))
        return _sanitize(payload.get("data"))

    # -- WorkService.KanbanPort surface -----------------------------------

    def create_task(self, payload: dict) -> dict:
        args = [str(payload["title"])]
        if payload.get("body"):
            args += ["--body", str(payload["body"])]
        if payload.get("assignee"):
            args += ["--assignee", str(payload["assignee"])]
        workspace_path = payload.get("workspace_path")
        if payload.get("workspace_kind") == "dir" and workspace_path:
            args += ["--workspace", f"dir:{workspace_path}"]
        if payload.get("triage"):
            args.append("--triage")
        if payload.get("idempotency_key"):
            args += ["--idempotency-key", str(payload["idempotency_key"])]
        if payload.get("priority") is not None:
            args += ["--priority", str(payload["priority"])]
        return self._call("create", args + ["--json"])

    def get_task(self, task_id: str) -> dict | None:
        try:
            return self._call("show", [task_id, "--json"])
        except BridgeUnavailable as err:
            if "not found" in str(err).lower():
                return None
            raise

    def list_tasks(self, filters: dict) -> list[dict]:
        args = ["--json"]
        if filters.get("status"):
            args += ["--status", str(filters["status"])]
        if filters.get("assignee"):
            args += ["--assignee", str(filters["assignee"])]
        data = self._call("list", args)
        rows = data if isinstance(data, list) else data.get("tasks", []) if isinstance(data, dict) else []
        return [row for row in rows if isinstance(row, dict)]

    def update_task(self, task_id: str, updates: dict) -> dict:
        raise BridgeUnavailable(
            "human metadata update is not exposed by the pinned Kanban CLI; "
            "use comments or recreate the task"
        )

    def comment(self, task_id: str, text: str) -> dict:
        return self._call("comment", [task_id, text, "--json"])

    def attach(self, task_id: str, attachment: dict) -> dict:
        path = attachment.get("path") if isinstance(attachment, dict) else str(attachment)
        return self._call("attach", [task_id, str(path), "--json"])

    def ready(self, task_id: str) -> dict:
        return self._call("promote", [task_id, "marked ready from Frank", "--json"])

    def start_task(self, task_id: str) -> dict:
        self._call("assign", [task_id, "default", "--json"])
        self._call("dispatch", ["--json"])
        return self.get_task(task_id) or {}

    def block(self, task_id: str, reason: str, detail: str) -> dict:
        args = [task_id, "--kind", "needs_input", reason]
        if detail:
            args.append(detail)
        return self._call("block", args + ["--json"])

    def unblock(self, task_id: str) -> dict:
        return self._call("unblock", [task_id, "--json"])

    def request_review(self, task_id: str) -> dict:
        return self._call("request-review", [task_id, "--json"])

    def request_changes(self, task_id: str, detail: str) -> dict:
        return self._call("request-changes", [task_id, detail, "--json"])

    def retry_task(self, task_id: str, prior_attempt_id: str | None) -> dict:
        self._call("unblock", [task_id, "--json"])
        self._call("dispatch", ["--json"])
        return self.get_task(task_id) or {}

    def complete(self, task_id: str) -> dict:
        return self._call("complete", [task_id, "--json"])

    def archive(self, task_id: str) -> dict:
        return self._call("archive", [task_id, "--json"])

    def terminate_run(self, run_id: str) -> dict:
        raise BridgeUnavailable(
            "active run termination is not exposed by the pinned Kanban CLI; "
            "stop the worker process on the host, then `kanban reclaim <task>`"
        )

    def task_events(self, task_id: str, cursor: int, limit: int) -> dict:
        data = self._call("log", [task_id, "--json"])
        if isinstance(data, list):
            return {"events": data, "cursor": cursor + len(data)}
        return {"events": [], "cursor": cursor}

    def task_runs(self, task_id: str) -> list[dict]:
        data = self._call("runs", [task_id, "--json"])
        return [row for row in (data if isinstance(data, list) else []) if isinstance(row, dict)]

    def provision_board(self, binding_id: str, default_workdir: str) -> dict:
        slug = self._slug_for(binding_id) if self._slug_for else None
        if not slug:
            raise BridgeUnavailable("no private board slug is bound to this project")
        self._call("boards", ["create", slug, "--json"])
        self._call("boards", ["set-default-workdir", slug, default_workdir, "--json"])
        return self._call("boards", ["show", slug, "--json"])

    def verify_board(self, slug: str, default_workdir: str) -> dict:
        data = self._call("boards", ["show", slug, "--json"])
        if isinstance(data, dict) and default_workdir and data.get("default_workdir") not in (None, default_workdir):
            raise BridgeUnavailable(
                "board default_workdir mismatch; board is quarantined"
            )
        return data
