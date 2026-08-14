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
from .home_manifest import validate_home_manifest

__all__ = [
    "ContractError",
    "MANIFEST_SCHEMA",
    "GRAPH_SCHEMA",
    "PIPELINE_SCHEMA",
    "SETTING_SCHEMA",
    "SettingRevisionStore",
    "discover_tool_apps",
    "validate_manifest",
    "validate_pipeline",
    "validate_home_manifest",
]
