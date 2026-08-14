"""Fail-closed validation for a tool-owned dashboard home manifest."""

from __future__ import annotations

import copy
from typing import Any

from .contracts import ContractError, _ID, _walk_safe

HOME_MANIFEST_FIELDS = (
    "id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities",
)
HOME_MANIFEST_FIELD_SET = frozenset(HOME_MANIFEST_FIELDS)


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
    _walk_safe(manifest, "home_manifest")
    return copy.deepcopy(manifest)
