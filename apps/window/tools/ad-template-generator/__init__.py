"""Frank contract for the provider-owned Ad Template Generator tool.

This package is deliberately an adapter contract, not an image-generation
engine. Hermes owns execution, model selection, skills, and state.
"""

from .contract import (
    HOME_PROFILE,
    PIPELINE_STAGES,
    PIPELINE_GRAPH,
    ImmutableRelease,
    build_request,
    build_immutable_release,
    validate_package,
    validate_release,
    validate_trace,
    home_profile,
)
from .home_snapshot import build_home_snapshot

__all__ = [
    "HOME_PROFILE",
    "PIPELINE_STAGES",
    "PIPELINE_GRAPH",
    "ImmutableRelease",
    "build_request",
    "build_immutable_release",
    "validate_package",
    "validate_release",
    "validate_trace",
    "build_home_snapshot",
    "home_profile",
]
