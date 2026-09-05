"""Unified Hermes tool/catalogue health projection and bounded Hub read tools.

Projects Hermes's live skills, toolsets, MCP servers and plugin health into
Frank's existing Tools/Connections catalogue using explicit source types and
authority. Same-named objects are never merged silently; configuration
secrets are never exposed; missing authentication/health is shown as
``attention`` rather than ready. Bounded read-only tools for Hub conversation
list projects and inspect one registry-authorized project's safe files,
selected map/knowledge section, selected approved skill, tool and
memory-source health — the same provider snapshots Frank renders, with
provenance and current revision, refusing hidden/secret paths and bulk
exports. Task/routine mutation tools belong to Session 4.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

CATALOGUE_SCHEMA = "schema://frank.connections-catalogue/v1"
HIDDEN_SEGMENTS = frozenset({".git", ".hermes", ".codex", ".frank-attachments", "node_modules", "uploads"})
MAX_LIST_FILES = 50
MAX_FILE_BYTES = 200_000
MAX_SKILL_CHARS = 20_000
_SENSITIVE_NAME = re.compile(r"(?i)(secret|credential|password|token|\.env$|\.pem$|\.key$|id_rsa)")


def _is_sensitive(name: str) -> bool:
    return bool(_SENSITIVE_NAME.search(name))


def _now(value: Any) -> str:
    return str(value or "")


def project_hermes_health(hermes_status: dict[str, Any]) -> dict[str, Any]:
    """Map one Hermes health/status payload onto explicit catalogue entries.

    ``hermes_status`` shape (from the maintained Hermes status endpoint):
    ``{"skills": [{"name", "source", "healthy", "authenticated"?}],
    "toolsets": [...], "mcp": [{"name", "healthy", "authenticated"?}], ...}`.
    Every entry keeps its source type and authority; unhealthy or
    unauthenticated entries are ``attention``, never ``ready``.
    """
    entries: list[dict[str, Any]] = []
    for group, source_type in (("skills", "hermes-skill"), ("toolsets", "hermes-toolset"), ("mcp", "hermes-mcp")):
        for item in hermes_status.get(group) or []:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            healthy = bool(item.get("healthy", False))
            authenticated = item.get("authenticated", True)
            state = "ready" if healthy and authenticated else "attention"
            entries.append(
                {
                    "id": f"{source_type}:{item['name']}",
                    "name": str(item["name"]),
                    "source_type": source_type,
                    "authority": "runtime-owned" if item.get("runtime_owned") else "operator",
                    "state": state,
                    "detail": "" if state == "ready" else ("authentication missing" if not authenticated else "health check failing"),
                    "checked_at": _now(item.get("checked_at")),
                }
            )
    return {"schema": CATALOGUE_SCHEMA, "entries": entries}


class HubReadTools:
    """Bounded read-only Hermes tools over the same provider snapshots."""

    def __init__(self, registry, roots, catalogue_provider, skills_provider, map_provider, memory_provider):
        self.registry = registry          # workspace registry (opaque ids)
        self.roots = roots                # RootCatalog
        self.catalogue_provider = catalogue_provider
        self.skills_provider = skills_provider
        self.map_provider = map_provider  # callable(workspace_id) -> map snapshot
        self.memory_provider = memory_provider  # callable(workspace_id) -> memory-source health

    def list_projects(self) -> dict[str, Any]:
        """Cross-project list: opaque ids and display names only."""
        return {
            "projects": [
                {"workspace_id": record.workspace_id, "project_id": record.project_id, "status": record.status}
                for record in self.registry.all_records()
                if record.status == "active"
            ],
            "count": sum(1 for r in self.registry.all_records() if r.status == "active"),
        }

    def list_project_files(self, workspace_id: str, rel: str = "") -> dict[str, Any]:
        """Bounded listing of one project's safe files beneath its live root."""
        record = self.registry.get_active(workspace_id)
        root = Path(record.host_path)
        if not record.host_path or not root.is_dir():
            return {"workspace_id": workspace_id, "entries": [], "count": 0}
        target = root / rel if rel else root
        entries = []
        try:
            resolved = target.resolve(strict=True)
            resolved.relative_to(root.resolve())
        except (OSError, ValueError):
            return {"workspace_id": workspace_id, "entries": [], "count": 0, "error": "path unavailable"}
        if any(part in HIDDEN_SEGMENTS for part in resolved.parts):
            return {"workspace_id": workspace_id, "entries": [], "count": 0, "error": "hidden path refused"}
        for child in sorted(resolved.iterdir(), key=lambda item: item.name):
            if child.name.startswith(".") or any(part in HIDDEN_SEGMENTS for part in child.parts):
                continue
            if child.is_file() and _is_sensitive(child.name):
                continue  # sensitive files are refused, never listed or read
            entries.append({"name": child.name, "kind": "folder" if child.is_dir() else "file"})
            if len(entries) >= MAX_LIST_FILES:
                break  # bounded: never a bulk export
        return {"workspace_id": workspace_id, "path": rel, "entries": entries, "count": len(entries)}

    def read_project_file(self, workspace_id: str, rel: str) -> dict[str, Any]:
        record = self.registry.get_active(workspace_id)
        root = Path(record.host_path)
        target = (root / rel).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            return {"error": "path escapes the project root"}
        if any(part in HIDDEN_SEGMENTS for part in target.parts) or target.name.startswith("."):
            return {"error": "hidden path refused"}
        if _is_sensitive(target.name):
            return {"error": "sensitive file refused"}
        if not target.is_file() or target.is_symlink():
            return {"error": "file unavailable"}
        text = target.read_text(encoding="utf-8", errors="replace")[:MAX_FILE_BYTES]
        return {"workspace_id": workspace_id, "path": rel, "revision_hint": str(target.stat().st_mtime), "text": text}

    def map_section(self, workspace_id: str) -> dict[str, Any]:
        snapshot = self.map_provider(workspace_id)
        return {"workspace_id": workspace_id, "snapshot": snapshot, "provenance": snapshot.get("envelope")}

    def skill_section(self, catalogue_root: str | Path, skill_path: str) -> dict[str, Any]:
        from infra.skills.provider import read_skill_source

        return read_skill_source(catalogue_root, skill_path)

    def tool_and_memory_health(self, workspace_id: str) -> dict[str, Any]:
        return {
            "workspace_id": workspace_id,
            "tools": self.catalogue_provider(workspace_id),
            "memory_sources": self.memory_provider(workspace_id),
        }
