"""Entity-aware default home blueprints for Frank Window.

Blueprints describe which registered widgets belong on a new home. They do not
contain provider data and they are never written to the user layout store.
"""
from __future__ import annotations

import copy
import re


KIND_DEFAULT_WIDGET_IDS: dict[str, tuple[str, ...]] = {
    "project": (
        "project-signal",
        "accounts-summary",
        "connections-summary",
        "repository-pulse",
        "project-attention",
        "project-activity",
        "project-quick-paths",
    ),
    "tool": (
        "entity-overview",
        "provider-coverage",
        "hermes-status",
    ),
    "agent": (
        "entity-overview",
        "hermes-status",
        "hermes-session",
        "provider-coverage",
    ),
    "service": (
        "entity-overview",
        "connections-summary",
        "provider-coverage",
    ),
}


PROJECT_HOME_BLUEPRINT_VERSION = 2
PROJECT_DEFAULT_WIDGET_IDS = KIND_DEFAULT_WIDGET_IDS["project"]
PROJECT_DEFAULT_WIDGET_LAYOUTS: dict[str, dict[str, int]] = {
    "project-signal": {"x": 0, "y": 0, "w": 4, "h": 2},
    "accounts-summary": {"x": 4, "y": 0, "w": 2, "h": 2},
    "connections-summary": {"x": 6, "y": 0, "w": 2, "h": 2},
    "repository-pulse": {"x": 8, "y": 0, "w": 4, "h": 2},
    "project-attention": {"x": 0, "y": 2, "w": 5, "h": 3},
    "project-activity": {"x": 5, "y": 2, "w": 4, "h": 3},
    "project-quick-paths": {"x": 9, "y": 2, "w": 3, "h": 3},
}


ENTITY_DEFAULT_WIDGET_IDS: dict[str, tuple[str, ...]] = {
    "tool:connections": (
        "connections-summary",
        "provider-catalog",
        "connection-attention",
        "provider-coverage",
    ),
    "tool:accounts": (
        "entity-overview",
        "accounts-summary",
        "provider-coverage",
        "hermes-status",
    ),
    "tool:widget-builder": (
        "entity-overview",
        "widget-catalog",
        "provider-coverage",
    ),
    "tool:campaigns": (
        "entity-overview",
        "connections-summary",
        "provider-coverage",
    ),
    "tool:ad-templates": (
        "entity-overview",
        "connection-attention",
        "provider-coverage",
    ),
    "agent:hermes": (
        "entity-overview",
        "hermes-status",
        "hermes-session",
        "provider-coverage",
    ),
    "service:umami": (
        "entity-overview",
        "connections-summary",
        "connection-attention",
        "provider-coverage",
    ),
    "service:activepieces": (
        "entity-overview",
        "connections-summary",
        "provider-coverage",
    ),
    "service:frank-window": (
        "entity-overview",
        "connections-summary",
        "hermes-status",
    ),
}


ENTITY_DEFAULT_WIDGET_SIZES: dict[str, dict[str, str]] = {
    "tool:connections": {
        "connections-summary": "wide",
        "provider-catalog": "wide",
        "connection-attention": "medium",
        "provider-coverage": "medium",
    },
}


_BUILTIN_ENTITY_MANIFESTS: dict[str, dict] = {
    "tool:connections": {
        "id": "connections",
        "name": "Connections",
        "kind": "tool",
        "blurb": "Recorded provider metadata, setup state, and capability coverage.",
        "capabilities": ["connections.read", "connections.setup"],
        "connection_capabilities": ["connections.read", "connections.setup"],
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["tool:connections"]),
    },
    "tool:accounts": {
        "id": "accounts",
        "name": "Accounts",
        "kind": "tool",
        "blurb": "Customer and service-account directory metadata.",
        "capabilities": ["accounts.read", "accounts.directory"],
        "connection_capabilities": [],
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["tool:accounts"]),
    },
    "tool:widget-builder": {
        "id": "widget-builder",
        "name": "Widget Builder",
        "kind": "tool",
        "blurb": "Safe reusable display widget catalog and home placement.",
        "capabilities": ["widgets.read", "widgets.edit"],
        "connection_capabilities": [],
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["tool:widget-builder"]),
    },
    "tool:campaigns": {
        "id": "campaigns",
        "name": "Campaigns",
        "kind": "tool",
        "blurb": "Campaign and audience control surface backed by provider state.",
        "capabilities": ["campaigns.read", "campaigns.setup"],
        "connection_capabilities": ["campaigns.read", "campaigns.setup"],
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["tool:campaigns"]),
    },
    "tool:ad-templates": {
        "id": "ad-templates",
        "name": "Ad templates",
        "kind": "tool",
        "blurb": "Ad template setup surface; no template provider is connected in Frank.",
        "capabilities": ["ad_templates.read", "ad_templates.setup"],
        "connection_capabilities": ["ad_templates.read", "ad_templates.setup"],
        "setup_only": True,
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["tool:ad-templates"]),
    },
    "agent:hermes": {
        "id": "hermes",
        "name": "Hermes",
        "kind": "agent",
        "blurb": "The sole brain for reasoning, tools, memory, and execution.",
        "capabilities": ["sessions.read", "work.read"],
        "connection_capabilities": [],
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["agent:hermes"]),
    },
    "service:umami": {
        "id": "umami",
        "name": "Umami Analytics",
        "kind": "service",
        "blurb": "Analytics provider state is shown only when a real adapter is connected.",
        "capabilities": ["analytics.read"],
        "connection_capabilities": ["analytics.read"],
        "setup_only": True,
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["service:umami"]),
    },
    "service:activepieces": {
        "id": "activepieces",
        "name": "Activepieces",
        "kind": "service",
        "blurb": "Open connector runtime; setup and status remain provider-owned.",
        "capabilities": ["workflow.status", "connector.setup"],
        "connection_capabilities": ["workflow.status", "connector.setup"],
        "setup_only": True,
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["service:activepieces"]),
    },
    "service:frank-window": {
        "id": "frank-window",
        "name": "Frank Window",
        "kind": "service",
        "blurb": "The display-only Window surface for Frank.",
        "capabilities": ["window.health", "homes.read"],
        "connection_capabilities": [],
        "default_widgets": list(ENTITY_DEFAULT_WIDGET_IDS["service:frank-window"]),
    },
}


_PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
_PROFILE_KINDS = {"tool", "agent", "service"}
_PROFILE_FIELDS = {
    "id", "name", "kind", "blurb", "capabilities", "default_widget_ids",
    "connection_capabilities", "setup_only", "default_widgets",
}
_REGISTERED_ENTITY_PROFILES: dict[str, dict] = {}


def register_entity_profile(manifest: dict) -> dict:
    """Validate and register one declarative non-project home profile.

    The registry stores and returns deep copies. ``default_widgets`` is retained
    as a compatibility input/output alias for the original built-in manifests;
    new manifests should use ``default_widget_ids``.
    """
    if not isinstance(manifest, dict):
        raise TypeError("entity profile must be an object")
    unknown = set(manifest) - _PROFILE_FIELDS
    if unknown:
        raise ValueError(f"entity profile contains unsupported fields: {sorted(unknown)}")
    required = {"id", "name", "kind", "blurb", "capabilities", "connection_capabilities"}
    missing = required - set(manifest)
    if missing:
        raise ValueError(f"entity profile is missing fields: {sorted(missing)}")
    profile_id = manifest["id"]
    if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
        raise ValueError("entity profile id is invalid")
    if not isinstance(manifest["name"], str) or not manifest["name"].strip():
        raise ValueError("entity profile name is invalid")
    if manifest["kind"] not in _PROFILE_KINDS:
        raise ValueError("entity profile kind is invalid")
    if not isinstance(manifest["blurb"], str):
        raise TypeError("entity profile blurb must be text")
    for field in ("capabilities", "connection_capabilities"):
        values = manifest[field]
        if not isinstance(values, list) or any(not isinstance(item, str) or not item.strip() for item in values):
            raise TypeError(f"entity profile {field} must be a list of non-empty strings")
    has_ids = "default_widget_ids" in manifest
    has_compat = "default_widgets" in manifest
    if has_ids and has_compat:
        raise ValueError("provide default_widget_ids or default_widgets, not both")
    widget_ids = manifest.get("default_widget_ids", manifest.get("default_widgets", []))
    if not isinstance(widget_ids, list) or any(not isinstance(item, str) or not item.strip() for item in widget_ids):
        raise TypeError("entity profile default widget ids must be a list of non-empty strings")
    if len(set(widget_ids)) != len(widget_ids):
        raise ValueError("entity profile default widget ids must be unique")
    setup_only = manifest.get("setup_only", False)
    if not isinstance(setup_only, bool):
        raise TypeError("entity profile setup_only must be boolean")
    normalized = copy.deepcopy(manifest)
    normalized["default_widget_ids"] = list(widget_ids)
    normalized["default_widgets"] = list(widget_ids)
    normalized["setup_only"] = setup_only
    registry_key = f"{manifest['kind']}:{profile_id}"
    if registry_key in _REGISTERED_ENTITY_PROFILES:
        raise ValueError(f"entity profile is already registered: {registry_key}")
    _REGISTERED_ENTITY_PROFILES[registry_key] = normalized
    return copy.deepcopy(normalized)


for _builtin_manifest in _BUILTIN_ENTITY_MANIFESTS.values():
    register_entity_profile(_builtin_manifest)

API_ENTITY_PROFILES = _REGISTERED_ENTITY_PROFILES


def default_widget_ids(kind: str, entity_id: str, profile: dict | None = None) -> list[str]:
    """Return a copy of the profile-owned blueprint, then safe fallbacks."""
    if kind == "project":
        return list(PROJECT_DEFAULT_WIDGET_IDS)
    declared = None
    if isinstance(profile, dict):
        declared = profile.get("default_widget_ids", profile.get("default_widgets"))
    if isinstance(declared, list) and declared:
        return [str(widget_id) for widget_id in declared]
    return list(ENTITY_DEFAULT_WIDGET_IDS.get(f"{kind}:{entity_id}", KIND_DEFAULT_WIDGET_IDS.get(kind, ())))


def default_widget_layout(kind: str, widget_id: str) -> dict[str, int] | None:
    """Return a copy of the default responsive-grid placement for project widgets."""
    if kind != "project":
        return None
    layout = PROJECT_DEFAULT_WIDGET_LAYOUTS.get(widget_id)
    return dict(layout) if layout else None


def default_widget_size(kind: str, entity_id: str, widget_id: str, fallback: str) -> str:
    """Return an entity-specific default size without changing the widget contract."""
    return ENTITY_DEFAULT_WIDGET_SIZES.get(f"{kind}:{entity_id}", {}).get(widget_id, fallback)


def api_entity_profile(kind: str, entity_id: str) -> dict | None:
    """Return a copy so a caller cannot mutate the profile registry."""
    profile = _REGISTERED_ENTITY_PROFILES.get(f"{kind}:{entity_id}")
    return copy.deepcopy(profile) if profile else None
