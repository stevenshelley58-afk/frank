"""Declarative assembly records for the shared graph workbench."""

from __future__ import annotations

from copy import deepcopy

# This isolated branch deliberately advertises no live capability. Final
# assembly can publish frank.graph.v1 only after the endpoints, home provider,
# hosts, and renderer are registered together.
CAPABILITIES: list[str] = []

RESERVED_VIEW_REGISTRATIONS = [
    {"id": "graph", "host": "slot-graph", "renderer": "graph-workbench", "internal": True},
]

WIDGET_MANIFEST = {
    "id": "entity-graph",
    "version": "1.0.0",
    "title": "Graph",
    "description": "Read-only entity pipeline and settings graphs from registered providers.",
    "surfaces": ["project", "tool", "agent", "service"],
    "default_size": "wide",
    "allowed_sizes": ["medium", "wide"],
    "provider": "frank.graph",
    "freshness": "on_demand",
    "accepts_connection": False,
    "multiple": False,
}

TOOL_MANIFEST_ADAPTER = {
    "schema": "schema://frank.tool-manifest-adapter/v1",
    "id": "tool-manifest",
    "version": "1.0.0",
    "accepts": [
        "schema://frank.tool-app-manifest/v1",
        "schema://frank.tool-app-settings/v1",
        "OTLP/1.0",
    ],
    "produces": ["schema://frank.graph/v1"],
    "surfaces": ["graph", "project", "tool", "agent", "service"],
    "renderer": "graph-workbench",
}

RESERVED_ALIASES = {}


def registration_blueprint() -> dict:
    """Describe only isolated components that are truthful before assembly.

    Views, the home widget/provider, the public capability, and the legacy
    alias remain absent until the final runtime wires every dependency.
    """
    return deepcopy({
        "capabilities": CAPABILITIES,
        "views": [],
        "widgets": [],
        "adapters": [TOOL_MANIFEST_ADAPTER],
        "aliases": {},
    })
