"""Narrow ``hermes kanban … --json`` subprocess wrapper (contract §7).

Headless Kanban REST is disabled upstream, so automation goes through the
documented safe argv form: an argv **array** (never a shell string), a fixed
executable path with a fixed minimal environment, validated board/task
identifiers, bounded output and wall time, and JSON-only parsing.

The verb allowlist is injected, not invented: contract v1.0.0 delegates the
"exact argv contract" to §7 without enumerating it (see the mismatch report),
so no verb is accepted until it is configured from the upstream ``--help``
evidence or a contract revision.  The frozen task-create payload
(``triage:true``, ``workspace_kind:"dir"``, resolver-resolved
``workspace_path``, assignee ``default``, stable ``idempotency_key``,
``kanban.auto_decompose:false``, ``kanban.auto_subscribe_on_create:false``)
is validated here.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any

MAX_OUTPUT_BYTES = 4 * 1024 * 1024
DEFAULT_TIMEOUT = 30.0

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_FLAG = re.compile(r"^--[a-z][a-z0-9-]{0,63}$")

_FROZEN_CREATE_DEFAULTS = {
    "triage": True,
    "workspace_kind": "dir",
    "assignee": "default",
    "kanban.auto_decompose": False,
    "kanban.auto_subscribe_on_create": False,
}


class KanbanError(RuntimeError):
    def __init__(self, message: str, *, frank_code: str = "hermes.kanban_failed"):
        super().__init__(message)
        self.frank_code = frank_code


def _fixed_environment() -> dict[str, str]:
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LC_ALL": "C.UTF-8",
        "HOME": os.environ.get("HERMES_HOME", "/home/hermes"),
    }
    return env


def validate_id(raw: Any, kind: str) -> str:
    if not isinstance(raw, str) or not _SAFE_ID.fullmatch(raw):
        raise KanbanError(f"{kind} id is unsafe", frank_code="hermes.invalid_params")
    return raw


def frozen_create_payload(*, title: str, workspace_path: str, idempotency_key: str, resolve_path: Any) -> dict[str, Any]:
    """Build the §7-frozen task-create payload; ``workspace_path`` must be resolver-resolved."""
    if not isinstance(title, str) or not title.strip():
        raise KanbanError("task title is required", frank_code="hermes.invalid_params")
    resolved = resolve_path(workspace_path) if callable(resolve_path) else workspace_path
    if not isinstance(resolved, str) or not resolved.startswith("/") or ".." in resolved.split("/"):
        raise KanbanError("workspace_path must be a resolved absolute workspace path", frank_code="hermes.invalid_params")
    if not isinstance(idempotency_key, str) or not _SAFE_ID.fullmatch(idempotency_key):
        raise KanbanError("idempotency_key must be a stable safe identifier", frank_code="hermes.invalid_params")
    payload = dict(_FROZEN_CREATE_DEFAULTS)
    payload.update({"title": title.strip(), "workspace_path": resolved, "idempotency_key": idempotency_key})
    return payload


class KanbanCli:
    def __init__(self, *, executable: str, allowed_verbs: frozenset[str] | set[str], timeout: float = DEFAULT_TIMEOUT, runner: Any = None):
        if not executable or os.sep in executable and not executable.startswith("/"):
            raise ValueError("executable must be a fixed path")
        if not allowed_verbs:
            # Honest default: the argv contract is not yet enumerated (mismatch report).
            raise ValueError("allowed_verbs must be supplied from contracted evidence; nothing is invented here")
        self._executable = executable
        self._allowed_verbs = frozenset(allowed_verbs)
        self._timeout = timeout
        self._runner = runner or subprocess.run

    def run(self, verb: str, args: list[str] | None = None, *, timeout: float | None = None) -> Any:
        verb = validate_id(verb, "verb")
        if verb not in self._allowed_verbs:
            raise KanbanError(f"kanban verb {verb!r} is not allowlisted by contract evidence", frank_code="hermes.forbidden_endpoint")
        safe_args: list[str] = []
        for item in (args or []):
            if item.startswith("--"):
                if not _FLAG.fullmatch(item):
                    raise KanbanError("flag is unsafe", frank_code="hermes.invalid_params")
                safe_args.append(item)
            else:
                safe_args.append(validate_id(item, "argument"))
        argv = [self._executable, "kanban", verb, *safe_args, "--json"]
        try:
            completed = self._runner(
                argv,
                capture_output=True,
                timeout=self._timeout if timeout is None else timeout,
                env=_fixed_environment(),
                shell=False,
            )
        except subprocess.TimeoutExpired as error:
            raise KanbanError(f"kanban invocation exceeded {timeout or self._timeout}s", frank_code="hermes.timeout") from error
        except OSError as error:
            raise KanbanError(f"kanban executable unavailable: {error.strerror}") from error
        raw = completed.stdout[:MAX_OUTPUT_BYTES]
        if completed.returncode != 0:
            detail = completed.stderr[:200].decode(errors="replace")
            raise KanbanError(f"kanban command failed: {detail}")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as error:
            raise KanbanError("kanban output is not valid JSON", frank_code="hermes.invalid_response") from error

    def create_task(self, payload: dict[str, Any], *, resolve_path: Any = None) -> Any:
        if "create" not in self._allowed_verbs:
            raise KanbanError("kanban create is not allowlisted by contract evidence")
        validated = frozen_create_payload(
            title=payload.get("title", ""),
            workspace_path=payload.get("workspace_path", ""),
            idempotency_key=payload.get("idempotency_key", ""),
            resolve_path=resolve_path,
        )
        # The payload blob is server-constructed and size-bounded; only the
        # other argv items require identifier validation.
        blob = json.dumps(validated)
        if len(blob) > 16384:
            raise KanbanError("task payload exceeds the 16 KiB argv bound", frank_code="hermes.invalid_params")
        argv = [self._executable, "kanban", "create", "--payload", blob, "--json"]
        try:
            completed = self._runner(
                argv, capture_output=True, timeout=self._timeout, env=_fixed_environment(), shell=False,
            )
        except subprocess.TimeoutExpired as error:
            raise KanbanError(f"kanban invocation exceeded {self._timeout}s", frank_code="hermes.timeout") from error
        except OSError as error:
            raise KanbanError(f"kanban executable unavailable: {error.strerror}") from error
        if completed.returncode != 0:
            raise KanbanError(f"kanban command failed: {completed.stderr[:200].decode(errors='replace')}")
        try:
            return json.loads(completed.stdout[:MAX_OUTPUT_BYTES])
        except json.JSONDecodeError as error:
            raise KanbanError("kanban output is not valid JSON", frank_code="hermes.invalid_response") from error
