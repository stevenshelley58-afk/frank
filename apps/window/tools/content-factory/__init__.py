"""Reusable Content Factory contracts for Frank/Hermes integration.

This package deliberately contains no worker, model client, scheduler, or
publication side effects. Hermes owns execution; Frank can inspect these
contracts and forward the resulting commands/events.
"""

from .content_factory import (
    ARTIFACT_TAXONOMY,
    CHANNELS,
    CONTENT_FACTORY_MANIFEST,
    HOME_PROFILE,
    PROCESS_GRAPH,
    build_command,
    build_event,
    build_withdrawal_tombstone,
    public_release,
    home_profile,
    validate_process_graph,
    validate_pack,
    validate_run_request,
)
from .home_snapshot import build_home_snapshot

__all__ = [
    "CONTENT_FACTORY_MANIFEST",
    "HOME_PROFILE",
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
    "build_home_snapshot",
    "home_profile",
]
