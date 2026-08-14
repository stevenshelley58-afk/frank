"""Isolated shared graph/trace contract implementation.

The package is deliberately not imported by ``server.py`` yet. The final
assembly lane can register its blueprint and copy the declarative records into
Frank's shared registries after rebasing onto the accepted main runtime.
"""

from .contract import (
    CAPABILITY,
    GRAPH_SCHEMA,
    MANIFEST_SCHEMA,
    TRACE_SCHEMA,
    GraphContractError,
    normalize_manifest,
)

__all__ = [
    "CAPABILITY",
    "GRAPH_SCHEMA",
    "MANIFEST_SCHEMA",
    "TRACE_SCHEMA",
    "GraphContractError",
    "normalize_manifest",
]
