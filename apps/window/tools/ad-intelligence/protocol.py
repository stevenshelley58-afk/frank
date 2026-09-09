"""Allowlisted Ad Radar actions/events for the shared Hermes adapter.

The shared Tool contract owns command/event envelopes and schemas. This module
only names the domain actions/events that the shared adapter may carry. Operation
groups are descriptive: every value is still validated against one flat allowlist
at the Frank/Hermes boundary.
"""

from types import MappingProxyType


LEGACY_ACTIONS = frozenset({
    "run", "retry", "approve-publish", "pause", "health",
})

LEGACY_EVENTS = frozenset({
    "run-started", "stage-completed", "run-quarantined", "publish-completed",
})

ACTIONS_BY_OPERATION = MappingProxyType({
    "setup": frozenset({
        "validate-settings", "activate-settings-revision", "test-connection",
    }),
    "live": frozenset({
        "run", "retry", "pause", "resume", "retry-stage", "cancel-run", "health",
    }),
    "library": frozenset({
        "recapture-creative", "reclassify", "recheck-media",
        "archive-creative", "restore-creative",
    }),
    "qa": frozenset({
        "quarantine-creative", "resolve-quarantine",
        "approve-creative", "reject-creative",
    }),
    "release": frozenset({
        "approve-publish", "verify-release", "supersede-release",
    }),
})

EVENTS_BY_OPERATION = MappingProxyType({
    "setup": frozenset({
        "settings-validation-completed", "settings-revision-activated",
        "connection-check-completed",
    }),
    "live": frozenset({
        "run-started", "run-paused", "run-resumed", "run-cancelled",
        "run-completed", "stage-started", "stage-completed",
        "stage-retry-scheduled", "stage-failed", "health-snapshot-recorded",
    }),
    "library": frozenset({
        "creative-observed", "advertiser-resolved", "evidence-captured",
        "creative-normalized", "creative-recapture-completed",
        "creative-reclassified", "creative-archived", "creative-restored",
    }),
    "qa": frozenset({
        "classification-completed", "media-qa-completed",
        "creative-quarantined", "creative-approved", "creative-rejected",
        "run-quarantined", "quarantine-resolved", "approval-requested",
        "approval-recorded",
    }),
    "release": frozenset({
        "publish-started", "publish-completed", "publish-failed",
        "release-verified", "release-superseded",
    }),
})

ALLOWED_ACTIONS = frozenset().union(*ACTIONS_BY_OPERATION.values())
ALLOWED_EVENTS = frozenset().union(*EVENTS_BY_OPERATION.values())

RECOVERY_ACTIONS = frozenset({
    "retry", "resume", "retry-stage", "recapture-creative", "reclassify",
    "recheck-media", "resolve-quarantine", "restore-creative",
    "verify-release", "supersede-release",
})


def validate_action(name: str) -> str:
    if not isinstance(name, str) or name not in ALLOWED_ACTIONS:
        raise ValueError(f"unsupported Ad Radar action: {name}")
    return name


def validate_event_name(name: str) -> str:
    if not isinstance(name, str) or name not in ALLOWED_EVENTS:
        raise ValueError(f"unsupported Ad Radar event: {name}")
    return name
