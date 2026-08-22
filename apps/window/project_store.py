"""Persistent Frank project registry and Hermes-session bindings.

Frank owns only safe project presentation metadata and the association between
one Hermes session and one project workspace. Hermes remains authoritative for
the session transcript, execution, tools, and memory.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import threading
from typing import Iterable


SCHEMA = "schema://frank.projects/v1"


class ProjectStoreError(RuntimeError):
    """Raised when the durable project registry cannot be read or written."""


class ProjectStore:
    def __init__(self, path: Path, defaults: Iterable[dict]):
        self.path = Path(path)
        self.defaults = tuple(deepcopy(list(defaults)))
        self._lock = threading.RLock()

    @staticmethod
    def _empty() -> dict:
        return {"schema": SCHEMA, "version": 1, "projects": [], "sessions": {}}

    def _read(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ProjectStoreError("Project registry is unavailable.") from error
        if (
            not isinstance(data, dict)
            or data.get("schema") != SCHEMA
            or data.get("version") != 1
            or not isinstance(data.get("projects"), list)
            or not isinstance(data.get("sessions"), dict)
        ):
            raise ProjectStoreError("Project registry has an unsupported format.")
        return data

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(self.path)
        except OSError as error:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
            raise ProjectStoreError("Project registry could not be saved.") from error

    def list_projects(self) -> list[dict]:
        with self._lock:
            data = self._read()
            merged = {str(item["id"]): deepcopy(item) for item in self.defaults}
            for item in data["projects"]:
                if isinstance(item, dict) and item.get("id") and str(item["id"]) not in merged:
                    merged[str(item["id"])] = deepcopy(item)
            sessions = data["sessions"]
            counts: dict[str, int] = {}
            latest: dict[str, str] = {}
            for session_id, binding in sessions.items():
                if not isinstance(binding, dict):
                    continue
                project_id = str(binding.get("project_id") or "")
                if not project_id:
                    continue
                counts[project_id] = counts.get(project_id, 0) + 1
                latest[project_id] = str(session_id)
            result = []
            for item in merged.values():
                project_id = str(item["id"])
                item["chat_count"] = counts.get(project_id, 0)
                item["default_chat_id"] = latest.get(project_id, "")
                result.append(item)
            return result

    def get_project(self, project_id: str) -> dict | None:
        return next((item for item in self.list_projects() if item.get("id") == project_id), None)

    def create_project(self, project: dict, session_id: str) -> dict:
        project_id = str(project.get("id") or "")
        if not project_id or not session_id:
            raise ValueError("project id and session id are required")
        with self._lock:
            data = self._read()
            known = {str(item.get("id")) for item in self.defaults}
            known.update(str(item.get("id")) for item in data["projects"] if isinstance(item, dict))
            if project_id in known:
                raise ValueError("project already exists")
            data["projects"].append(deepcopy(project))
            data["sessions"][session_id] = {"project_id": project_id}
            self._write(data)
        return deepcopy(project)

    def bind_session(self, project_id: str, session_id: str) -> None:
        if not self.get_project(project_id):
            raise KeyError("project not found")
        if not session_id:
            raise ValueError("session id is required")
        with self._lock:
            data = self._read()
            existing = data["sessions"].get(session_id)
            if isinstance(existing, dict) and existing.get("project_id") not in (None, "", project_id):
                raise ValueError("session is already bound to another project")
            data["sessions"][session_id] = {"project_id": project_id}
            self._write(data)

    def project_id_for_session(self, session_id: str) -> str:
        with self._lock:
            binding = self._read()["sessions"].get(session_id)
            return str(binding.get("project_id") or "") if isinstance(binding, dict) else ""

    def session_bindings(self) -> dict[str, str]:
        with self._lock:
            result = {}
            for session_id, binding in self._read()["sessions"].items():
                if isinstance(binding, dict) and binding.get("project_id"):
                    result[str(session_id)] = str(binding["project_id"])
            return result
