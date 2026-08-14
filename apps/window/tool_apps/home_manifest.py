"""Fail-closed validation for a tool-owned dashboard home manifest."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from .contracts import ContractError, _ID, _walk_safe

HOME_MANIFEST_FIELDS = (
    "id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities",
)
HOME_MANIFEST_FIELD_SET = frozenset(HOME_MANIFEST_FIELDS)
_CAPABILITY_ID = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")


def validate_home_manifest(manifest: Any) -> dict[str, Any]:
    if not isinstance(manifest, dict) or set(manifest) != HOME_MANIFEST_FIELD_SET:
        raise ContractError("tool home manifest must contain exactly the required fields")
    if not isinstance(manifest["id"], str) or not _ID.fullmatch(manifest["id"]):
        raise ContractError("home manifest id must be a safe kebab-case identifier")
    if not isinstance(manifest["name"], str) or not manifest["name"].strip():
        raise ContractError("home manifest name is required")
    if manifest["kind"] != "tool":
        raise ContractError("home manifest kind must be tool")
    if not isinstance(manifest["blurb"], str) or not manifest["blurb"].strip():
        raise ContractError("home manifest blurb is required")
    for field in ("capabilities", "default_widget_ids", "connection_capabilities"):
        values = manifest[field]
        if not isinstance(values, list) or any(not isinstance(item, str) or not item.strip() for item in values):
            raise ContractError(f"home manifest {field} must be a list of strings")
        if len(set(values)) != len(values):
            raise ContractError(f"home manifest {field} cannot contain duplicates")
        pattern = _ID if field == "default_widget_ids" else _CAPABILITY_ID
        if any(not pattern.fullmatch(item) for item in values):
            raise ContractError(f"home manifest {field} must contain safe identifiers")
    _walk_safe(manifest, "home_manifest")
    return copy.deepcopy(manifest)


def discover_tool_homes(tools_root: str | Path) -> list[dict[str, Any]]:
    """Load one exact non-executable home manifest for every Tool package."""
    root = Path(tools_root)
    if not root.is_dir():
        raise ContractError("tool discovery root must be a directory")
    homes = []
    for directory in sorted(root.iterdir(), key=lambda item: item.name):
        if not directory.is_dir() or not _ID.fullmatch(directory.name):
            continue
        if not (directory / "manifest.json").is_file():
            continue
        home_file = directory / "home.json"
        if not home_file.is_file():
            raise ContractError(f"tool app {directory.name} is missing home.json")
        try:
            home = validate_home_manifest(json.loads(home_file.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, ContractError) as exc:
            raise ContractError(f"invalid tool home {directory.name}: {exc}") from exc
        if home["id"] != directory.name:
            raise ContractError(f"tool home id does not match directory: {directory.name}")
        homes.append(home)
    return homes
