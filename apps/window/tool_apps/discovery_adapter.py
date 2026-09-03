"""Automatic tool/widget discovery adapter over the existing home manifests.

Production previously validated ``home.json`` manifests but never fed the
catalogue from that discovery path. This adapter converts every valid
tool-owned manifest into the existing versioned widget/entity-home catalogue
plus provider binding, without editing a central list per package and
without executing package code. One invalid manifest is quarantined with a
visible error/evidence record; it can never prevent Frank or other widgets
from loading.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .home_manifest import ContractError, discover_tool_homes, validate_home_manifest

CATALOGUE_SCHEMA = "schema://frank.tool-catalogue/v1"


def _manifest_checksum(home_file: Path) -> str:
    return hashlib.sha256(home_file.read_bytes()).hexdigest()[:32]


def _validated_home(directory: Path, root: Path) -> dict[str, Any]:
    """Per-package fail-closed validation: escape, symlink, schema, name match."""
    home_file = directory / "home.json"
    resolved_directory = directory.resolve(strict=True)
    resolved_directory.relative_to(root)
    if (directory / "manifest.json").is_symlink() or home_file.is_symlink():
        raise ContractError("tool manifest cannot be a symlink")
    home = validate_home_manifest(json.loads(home_file.read_text(encoding="utf-8")))
    if home["id"] != directory.name:
        raise ContractError("tool home id does not match directory")
    return home


def discover_catalogue(tools_root: str | Path) -> dict[str, Any]:
    """Discover manifests from the one approved tools root; quarantine bad ones.

    Unlike :func:`discover_tool_homes` (all-or-nothing, fail-closed), the
    catalogue adapter isolates each package: a single invalid manifest is
    recorded as quarantined evidence while valid widgets continue to load.
    Duplicate ids are quarantined the same way. No package code runs.
    """
    root = Path(tools_root)
    try:
        root = root.resolve(strict=True)
    except OSError as exc:
        raise ContractError("tool discovery root must be a directory") from exc
    if not root.is_dir():
        raise ContractError("tool discovery root must be a directory")
    widgets: list[dict[str, Any]] = []
    quarantined: list[dict[str, str]] = []
    seen_ids: dict[str, str] = {}
    for directory in sorted(root.iterdir(), key=lambda item: item.name):
        if not directory.is_dir() or directory.is_symlink():
            continue
        home_file = directory / "home.json"
        if not home_file.is_file():
            continue  # packages without home manifests are not widget sources
        try:
            home = _validated_home(directory, root)
        except (OSError, ValueError, json.JSONDecodeError, ContractError) as exc:
            quarantined.append({"id": directory.name, "reason": str(exc)})
            continue
        if home["id"] in seen_ids:
            quarantined.append({"id": home["id"], "reason": f"duplicate widget id (first seen: {seen_ids[home['id']]})"})
            continue
        seen_ids[home["id"]] = directory.name
        widgets.append(
            {
                "id": home["id"],
                "name": home["name"],
                "kind": home["kind"],
                "blurb": home["blurb"],
                "capabilities": home["capabilities"],
                "default_widget_ids": home["default_widget_ids"],
                "connection_capabilities": home["connection_capabilities"],
                "source_type": "tool-package",
                "source_path": directory.name,
                "revision": _manifest_checksum(home_file),
            }
        )
    return {"schema": CATALOGUE_SCHEMA, "widgets": widgets, "quarantined": quarantined}


def build_catalogue(Discovery_root: str | Path, builtins: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Merge built-in defaults with discovered tool widgets; builtins win on id."""
    discovery = discover_catalogue(Discovery_root)
    builtin_ids = {str(item.get("id")) for item in builtins or []}
    widgets = list(builtins or [])
    skipped = []
    for widget in discovery["widgets"]:
        if widget["id"] in builtin_ids:
            skipped.append({"id": widget["id"], "reason": "built-in default kept"})
            continue
        widgets.append(widget)
    quarantined = list(discovery["quarantined"]) + skipped
    return {
        "schema": CATALOGUE_SCHEMA,
        "widgets": widgets,
        "quarantined": quarantined,
        "counts": {"builtins": len(builtins or []), "tools": len(widgets) - len(builtins or [])},
    }
