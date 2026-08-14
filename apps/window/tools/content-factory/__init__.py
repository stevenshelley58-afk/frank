"""Reusable Content Factory contracts for Frank/Hermes integration.

This package deliberately contains no worker, model client, scheduler, or
publication side effects. Hermes owns execution; Frank can inspect these
contracts and forward the resulting commands/events.
"""

from .content_factory import (
    ARTIFACT_TAXONOMY,
    CHANNELS,
    CONTENT_FACTORY_MANIFEST,
    PROCESS_GRAPH,
    build_command,
    build_event,
    build_withdrawal_tombstone,
    public_release,
    validate_process_graph,
    validate_pack,
    validate_run_request,
)

__all__ = [
    "CONTENT_FACTORY_MANIFEST",
    "PROCESS_GRAPH",
    "CHANNELS",
    "ARTIFACT_TAXONOMY",
    "build_command",
    "build_event",
    "build_withdrawal_tombstone",
    "public_release",
    "validate_process_graph",
    "validate_pack",
    "validate_run_request",
]
