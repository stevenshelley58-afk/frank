"""Allowlisted Ad Radar actions/events for the shared Hermes adapter.

The shared Tool contract owns command/event envelopes and schemas. This module
only names the domain actions/events that the shared adapter may carry.
"""

ALLOWED_ACTIONS = frozenset({
    "run", "retry", "approve-publish", "pause", "health",
})

ALLOWED_EVENTS = frozenset({
    "run-started", "stage-completed", "run-quarantined", "publish-completed",
})

def validate_action(name: str) -> str:
    if name not in ALLOWED_ACTIONS:
        raise ValueError(f"unsupported Ad Radar action: {name}")
    return name

def validate_event_name(name: str) -> str:
    if name not in ALLOWED_EVENTS:
        raise ValueError(f"unsupported Ad Radar event: {name}")
    return name
