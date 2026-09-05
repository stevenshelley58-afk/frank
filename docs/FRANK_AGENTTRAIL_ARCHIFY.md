# Frank implementation monitors

Frank has two optional read-only implementation monitors. They are overlays for the internal app; Hermes events remain the only template-run truth.

## Archify

The pinned Archify source is recorded as a submodule at `b36d79fdbc3aec3728744341485a7e79f03c0071`. The checked-in typed IR is `apps/window/archify/ad-template-process.json` and the served artifact is generated from it with the real CLI:

```bash
node apps/window/vendor/archify/archify/bin/archify.mjs validate architecture apps/window/archify/ad-template-process.json --json
node apps/window/vendor/archify/archify/bin/archify.mjs deliver architecture apps/window/archify/ad-template-process.json apps/window/archify/ad-template-process.html --json
```

Frank reports the artifact only when the pinned CLI can validate the typed IR and the self-contained HTML exists. It does not expose Archify control routes.

## AgentTrail

The pinned AgentTrail source is recorded as a submodule at `5b97cf3cef548a0c668731e7f569fa36c14832f2`. Production runs the read-only
`frank-agenttrail` Compose sidecar. Its `/workspace` mount is selected by
`FRANK_AGENTTRAIL_REPO` (default `/projects/only-process-hermes`) and it shares
the Window network namespace without publishing a host port. For an explicit
local observer used during diagnosis, choose the real implementation checkout:

```bash
node apps/window/vendor/agenttrail/bin/agenttrail.mjs /projects/frank --port 5340 --no-open
```

Frank proxies the live read-only `/summary` endpoint from `AGENTTRAIL_URL` (default `http://127.0.0.1:5340`). If the observer is unavailable, Frank says so; it never fabricates activity or proxies setup, spawn, hook, or control endpoints.
