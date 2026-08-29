# Frank implementation monitors

Frank exposes two read-only implementation monitors in the internal Ad Studio
lifecycle view.

## Archify

ARCHIFY_ARTIFACT must point at the self-contained HTML artifact produced by
the pinned Archify CLI:

1. archify validate <typed-ir.json>
2. archify deliver <typed-ir.json> --output <artifact.html>

Frank does not invent a diagram or render a link to the Archify repository. The
/api/ad-studio/architecture endpoint reports unavailable until that actual
validated artifact exists, and /api/ad-studio/architecture/artifact serves
only that configured file.

## AgentTrail

AGENTTRAIL_BOARD points to the local AgentTrail board JSON (normally
/vps/agenttrail/board.json). The /api/ad-studio/implementation-activity
endpoint reads that file without writing, spawning, setup, hooks, or proxying
AgentTrail control endpoints. If the board is absent or invalid, Frank shows
that fact instead of fabricating activity.

AgentTrail is implementation activity only. Hermes events remain the
authoritative template-run ledger.


Pinned source revisions:
- Archify: b36d79fdbc3aec3728744341485a7e79f03c0071
- AgentTrail: 5b97cf3cef548a0c668731e7f569fa36c14832f2

The host deployment must install AgentTrail from its pinned revision, bind its
observer to loopback (127.0.0.1), and point AGENTTRAIL_BOARD at its read-only
board for the three implementation repositories. Frank does not expose
AgentTrail control routes.
