"""Declarative assembly records for the shared graph workbench."""

from __future__ import annotations

from copy import deepcopy

# The capability is backed by the shared read-only Tool-pipeline workbench.
CAPABILITIES: list[str] = ["frank.graph.v1"]

WIDGET_MANIFEST = {
    "id": "entity-graph",
    "version": "1.0.0",
    "title": "Graph",
    "description": "Read-only Tool pipeline graph.",
    "surfaces": ["tool"],
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
    ],
    "produces": ["schema://frank.graph/v1"],
    "surfaces": ["tool"],
    "renderer": "graph-workbench",
}

RESERVED_ALIASES = {}


def production_registration_blueprint() -> dict:
    """Describe the assembled capability after its runtime dependencies exist."""
    return deepcopy({
        "capabilities": CAPABILITIES,
        "views": [],
        "widgets": [WIDGET_MANIFEST],
        "adapters": [TOOL_MANIFEST_ADAPTER],
        "aliases": RESERVED_ALIASES,
    })


def registration_blueprint() -> dict:
    """Return the live assembled registration consumed by Frank Window."""
    return production_registration_blueprint()
