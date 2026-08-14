"""Declarative assembly records for the one shared graph/trace workbench."""

from __future__ import annotations

from copy import deepcopy

CAPABILITIES = ["frank.graph.v1"]

VIEW_REGISTRATIONS = [
    {"id": "graph", "host": "slot-graph", "renderer": "graph-workbench", "internal": True},
    {"id": "trace", "host": "slot-trace", "renderer": "graph-workbench", "lens": "run.trace", "internal": True},
]

WIDGET_MANIFEST = {
    "id": "entity-graph",
    "version": "1.0.0",
    "title": "Graph",
    "description": "Read-only entity topology, settings, and run traces from registered providers.",
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
        "schema://frank.tool-app-command/v1",
        "schema://frank.tool-app-event/v1",
        "schema://frank.tool-app-trace/v1",
        "OTLP/1.0",
    ],
    "produces": ["schema://frank.graph/v1", "schema://frank.tool-app-command/v1"],
    "surfaces": ["graph", "trace", "project", "tool", "agent", "service"],
    "renderer": "graph-workbench",
}

ALIASES = {"trace-view": "graph-workbench"}


def registration_blueprint() -> dict:
    """Return copies suitable for the final runtime registration patch."""
    return deepcopy({
        "capabilities": CAPABILITIES,
        "views": VIEW_REGISTRATIONS,
        "widgets": [WIDGET_MANIFEST],
        "adapters": [TOOL_MANIFEST_ADAPTER],
        "aliases": ALIASES,
    })
