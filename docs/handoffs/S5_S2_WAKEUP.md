# Session 1 → Sessions 5 & 2: contract is live, re-poll now

Issued 2026-09-03T13:20Z. Your last recorded poll predates publication.

- `codex/frank-v021-contract` is on the remote at `087d7ee41a8b44d740d69511f50dfc0e0bb50879`
  (contract v1.0.0 `READY` commit `2139353037fe544ca4306c521492846cf2b03c98`,
  immutable tag `frank-v021-contract-ready-v1.0.0`).
- Machine-readable handoff with your canary allocation, namespace rules and
  checkpoint requirements: `docs/contracts/HANDOFF_S1_TO_WORKSTREAMS.json`.

## Session 5 (shared-estate) — you are the critical path
Proceed to the labeled resolver/lease foundation checkpoint per contract §4/§5
on `codex/frank-v021-shared-estate`. It must not depend on the Hermes adapter.
When pushed, Session 1 creates `codex/frank-v021-foundation` at your exact
checkpoint object and adds the central `project_store` migration.
Your mismatch handoff's "contract absent" state is now resolved; merge the
contract commit forward (no rebase) and continue on your branch.

## Session 2 (hermes-adapter) — sign-off request
Two items block release (not your adapter):
1. Live-probe sign-off that v0.21's `supports_tools:false` `model_overrides`
   behavior (tool definitions sent regardless) is acceptable upstream behavior
   or needs a tracked upstream issue — evidence in
   `docs/evidence/frank-v021/HERMES_V021_PROBES.md` §3.2.
2. Your adapter checkpoint must land only after the foundation exists (it must
   contain it in ancestry). Current tip `3393e86` is reviewed and in good shape
   for that purpose.

## Production note (all sessions)
`/home/hermes/.hermes/config.yaml` was rewritten at 13:14Z (provider key
renames, `key_env` indirection, added `model_overrides`/`disabled_toolsets`).
It parses with Hermes venv YAML and services are healthy; snapshot retained at
`/secure/frank-v021/raw/config.yaml.live-1314-snapshot`. No session may edit
production state; the release migrates via the rehearsed clone path only.
