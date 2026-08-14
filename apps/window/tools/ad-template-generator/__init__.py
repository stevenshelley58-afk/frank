"""Frank contract for the provider-owned Ad Template Generator tool.

This package is deliberately an adapter contract, not an image-generation
engine. Hermes owns execution, model selection, skills, and state.
"""

from .contract import (
    PIPELINE_STAGES,
    PIPELINE_GRAPH,
    ImmutableRelease,
    build_request,
    build_immutable_release,
    validate_package,
    validate_release,
    validate_trace,
)

__all__ = [
    "PIPELINE_STAGES",
    "PIPELINE_GRAPH",
    "ImmutableRelease",
    "build_request",
    "build_immutable_release",
    "validate_package",
    "validate_release",
    "validate_trace",
]
