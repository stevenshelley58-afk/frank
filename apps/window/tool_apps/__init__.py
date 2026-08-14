"""Shared, declarative contract for Frank tool mini-apps.

Frank owns discovery and presentation; Hermes owns execution.  The public
surface in this package is deliberately data-oriented so it can be used by
the Window process, tests, or a future Hermes transport without coupling them.
"""

from .contracts import (
    MANIFEST_SCHEMA,
    GRAPH_SCHEMA,
    PIPELINE_SCHEMA,
    SETTING_SCHEMA,
    ContractError,
    SettingRevisionStore,
    discover_tool_apps,
    validate_manifest,
    validate_pipeline,
)
from .home_manifest import discover_tool_homes, validate_home_manifest
from .canonical import canonical_json, canonical_sha256

__all__ = [
    "ContractError",
    "canonical_json",
    "canonical_sha256",
    "MANIFEST_SCHEMA",
    "GRAPH_SCHEMA",
    "PIPELINE_SCHEMA",
    "SETTING_SCHEMA",
    "SettingRevisionStore",
    "discover_tool_apps",
    "discover_tool_homes",
    "validate_manifest",
    "validate_pipeline",
    "validate_home_manifest",
]
