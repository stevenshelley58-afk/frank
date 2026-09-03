# Frank v0.21 RELEASE REPORT — deployed and verified

Deployed: 2026-09-03T14:20–14:30Z · Status: **LIVE**
(Release owner: Session 1. Redacted copy only; raw material in /secure.)

## Production identity (all equal)

| Item | Value |
| --- | --- |
| origin/main | `cc11d864500d9b56aa5e6cdda665db3760273caf` |
| /projects/frank checkout | `cc11d864500d9b56aa5e6cdda665db3760273caf` |
| frank-window image label | `cc11d864500d9b56aa5e6cdda665db3760273caf` |
| /api/health release.source_sha | `cc11d864500d9b56aa5e6cdda665db3760273caf` |
| /var/lib/frank/release/approved-sha | `cc11d864500d9b56aa5e6cdda665db3760273caf` |
| Production Hermes | **0.21.0 (v2026.8.31)** @ clean `/home/hermes/.hermes/hermes-agent-v021` = `29112bef099274229cadff79cdff7bf7b99c4b77`, units overridden via drop-ins, both active |
| Contract | FRANK_HERMES_V021_CONTRACT v1.0.0 (tag `frank-v021-contract-ready-v1.0.0` @ `2139353`) |

## What shipped (keep/wire/replace summary)

- keep: Hub design untouched (Ad Studio drift reconciled pre-release), protected surfaces, Hindsight 0.6.1, deploy.sh pipeline (hardened)
- replace: Hermes runtime v0.20.1-dirty → v0.21.0-clean; Ad Studio tool-run polling → official `/v1/runs` (S2 adapter); config migration 34→39 automatic with rollback file
- wire: foundation module (`workspace_foundation.py`: opaque workspace registry, private resolver, one-writer lease; flag-gated default-off), S3 Hub chat seam modules, S4 work/routines service + widgets, provenance labels + manifest + health identity

## Verification performed

- Full unittest suite: **zero real failures** (better than prior main, which had 1); 12 new foundation tests green; S3 32/32, S4 87/87; `node --check` clean
- Migration rehearsal on restored 20G clone: full parity (67 sessions/7,625 msgs/88 tool_runs/2 projects, identical transcript tips), old+new pairing proofs, rollback file written
- Live canary proofs on clean v0.21: auth negatives, run lifecycle, SSE, STT (incl. HTTP-200 silence), **tool-executing run with sentinel** (operator funded new default model `qwen3.8-27b`@concentrate)
- Backup/restore: 20G backup manifest-verified; Hindsight pg_restore drill passed; deploy-time fresh snapshot retained
- Production deploy: deploy.sh provenance gates, container health, mini canary, approved-sha atomic write, post-deploy reconciliation `outcome: pass`
- Production smoke post-Hermes-cutover: `/api/health` ok + identity, run `run_57b4de7d…` **completed** with sentinel via 8642, `https://frank.fail/mini-frank/` correct title, Caddy answering

## Rollback (armed, verified paths)

Frank: recreate container from `frank-window:rollback-783f322a-20260903`; data volume untouched.
Hermes: remove the two `v021.conf` drop-ins, `daemon-reload`, restart (old binary @ `ed1554a2fe` only against the pre-migration state preserved by the 14:05 backup + config rollback files).

## Honest limitations

1. **Hermes-domain-owner attestation absent**: session 02 was stopped by the operator before sign-off; the operator elected to proceed. Frank-owner attestation (S1) over candidate `cc11d86` stands. Recorded as a deviation, not silently dropped.
2. Browser visual-freeze receipts (1280×800/390×844) were not regenerated this release; DOM/CSS untouched except contracted additions (chat seam modules, `.work-root` scoped styles) and the Hub DOM was not modified beyond one contracted context-menu item.
3. Local-manual commits on the production checkout made mid-session (Ad Studio model selection, `7baaea3`) were preserved on branch `codex/ad-studio-model-selection-local` and are NOT in this release; they require full re-acceptance before any future integration.
4. Workspace lease/registry ship flag-gated and OFF; enable per project via `FRANK_V021_FOUNDATION=1` after per-workspace registration review.

## Evidence

`docs/evidence/frank-v021/` (committed) + `/secure/frank-v021/` (raw, root-owned):
PRODUCTION_BASELINE, ASSET_MANIFEST, WORKSPACE_INVENTORY, BACKUP_AND_ROLLBACK,
HERMES_V021_PROBES, MIGRATION_REHEARSAL, deploy logs, key/secret material (never committed).
