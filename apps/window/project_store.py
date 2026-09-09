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
        return {"schema": SCHEMA, "version": 1, "projects": [], "sessions": {}, "overrides": {}}

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
        # Older v1 registries do not have overrides; keep them readable.
        if "overrides" not in data:
            data["overrides"] = {}
        if not isinstance(data["overrides"], dict):
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

    def list_projects(self, *, include_archived: bool = True) -> list[dict]:
        with self._lock:
            data = self._read()
            merged = {str(item["id"]): deepcopy(item) for item in self.defaults}
            for item in data["projects"]:
                if isinstance(item, dict) and item.get("id") and str(item["id"]) not in merged:
                    merged[str(item["id"])] = deepcopy(item)
            for project_id, override in data["overrides"].items():
                if project_id in merged and isinstance(override, dict):
                    merged[project_id].update({
                        key: deepcopy(value) for key, value in override.items()
                        if key in {"name", "blurb", "live", "archived", "archived_at", "revision"}
                    })
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
                item["archived"] = bool(item.get("archived"))
                item["revision"] = int(item.get("revision") or 0)
                if include_archived or not item["archived"]:
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

    def update_project(self, project_id: str, changes: dict, *, expected_revision: int | None = None) -> dict:
        allowed = {"name", "blurb", "live", "archived", "archived_at"}
        if not project_id or set(changes) - allowed:
            raise ValueError("unsupported project update")
        with self._lock:
            data = self._read()
            custom = next((item for item in data["projects"] if isinstance(item, dict) and str(item.get("id")) == project_id), None)
            default = next((item for item in self.defaults if str(item.get("id")) == project_id), None)
            if custom is None and default is None:
                raise KeyError("project not found")
            target = custom if custom is not None else data["overrides"].setdefault(project_id, {})
            current_revision = int(target.get("revision") or 0)
            if expected_revision is not None and expected_revision != current_revision:
                raise ValueError("project was changed elsewhere; refresh and try again")
            target.update(deepcopy(changes))
            target["revision"] = current_revision + 1
            self._write(data)
        updated = self.get_project(project_id)
        if updated is None:
            raise KeyError("project not found")
        return updated
