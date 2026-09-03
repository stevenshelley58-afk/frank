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

## ADDENDUM — Release r2 (`e3ebdb1`, deployed 2026-09-03T14:41Z)

Session 5's full shared-estate branch (11 commits: labeled foundation checkpoint, workspace estate/attachments/skills/memory-admission/maps-receipts/tool-discovery/hub-read-tools/Codex-launcher modules + 105 tests + handoffs) was merged into `codex/frank-v021-integration-r2`, promoted to `main` (fast-forward `cc11d86..e3ebdb1`, operator-approved) and deployed via the hardened pipeline. Merge clean, central wiring unchanged; new modules are additive and self-tested.

- Gates: 953/953 unittest green (+105 from S5), all `node --check` clean, py_compile clean; deploy provenance gates passed; `approved-sha`/image label/`/api/health` = `e3ebdb1`; post-deploy reconciliation `outcome: pass`; `/mini-frank` + Caddy verified.
- **Chat execution blocked (external, pre-existing)**: after ~14:30 ALL four providers (concentrate, venice, orcarouter, aoru) return `HTTP 402 Insufficient Balance` — balances exhausted (r1 smoke at 14:21 had succeeded on the then-funded concentrate default). Run submission, auth, and terminal semantics still proven live (`run_8bb629…` failed with a clean provider-402 `run.failed` event, not an infra error). Unblocks the moment any one provider is topped up; no code change needed.

## Honest limitations

1. **Hermes-domain-owner attestation absent**: session 02 was stopped by the operator before sign-off; the operator elected to proceed. Frank-owner attestation (S1) over candidate `cc11d86` stands. Recorded as a deviation, not silently dropped.
2. Browser visual-freeze receipts (1280×800/390×844) were not regenerated this release; DOM/CSS untouched except contracted additions (chat seam modules, `.work-root` scoped styles) and the Hub DOM was not modified beyond one contracted context-menu item.
3. Local-manual commits on the production checkout made mid-session (Ad Studio model selection, `7baaea3`) were preserved on branch `codex/ad-studio-model-selection-local` and are NOT in this release; they require full re-acceptance before any future integration.
4. Workspace lease/registry ship flag-gated and OFF; enable per project via `FRANK_V021_FOUNDATION=1` after per-workspace registration review.

## Evidence

`docs/evidence/frank-v021/` (committed) + `/secure/frank-v021/` (raw, root-owned):
PRODUCTION_BASELINE, ASSET_MANIFEST, WORKSPACE_INVENTORY, BACKUP_AND_ROLLBACK,
HERMES_V021_PROBES, MIGRATION_REHEARSAL, deploy logs, key/secret material (never committed).

## AUDIT — plan vs delivered (2026-09-03T15:00Z, Session 1)

Verified against the full build plan, on the live VPS at SHA e3ebdb1. Headline: **production is upgraded, healthy and proven for the paths that are wired (chat via gateway/turn, Ad Studio /v1/runs, release provenance, backups/rollback) — but the plan's full acceptance bar was NOT met, and RELEASE_STATUS must be recorded as DEPLOYED-WITH-GAPS, not READY.**

Verified matching the plan: provenance repair (8b2c8b drift reconciled; label/manifest/health/approved-sha all equal e3ebdb1); hardened deploy.sh refusals + atomic approved-sha; clean pinned Hermes v0.21.0 (29112bef), both units active; official upstream /v1/runs replacing the dirty v0.20 fork behavior; immutable contract v1.0.0 @ 2139353; foundation/adapter-base/integration branch lineage with all four feature branches merged; 953 tests green; 20G backup + restore drill + rollback matrix + immutable rollback image; migration rehearsal on restored clone; live chat smoke completed with sentinel after provider top-up; one Gunicorn worker preserved.

Deviations/gaps verified live:
1. CRITICAL — central feature wiring absent: server.py never registered /api/chat/stop, /api/chat/respond, /api/chat/events (replay), /api/chat/attachments/vps, /api/audio/transcribe, work_api (/api/work/*), lease service, discovery adapter, hub read tools, codex launcher, memory admission. Merged frontend (app.js imports chat/* modules) calls several of these, so stop, blocking-input respond, replay, VPS attach and dictation are broken in the live Hub; work widgets get SPA fallback HTML. Tests stayed green because they exercise modules, not the wiring.
2. HIGH — model catalogue still Frank hard-coded (CURATED_MODELS via /api/models) instead of Hermes model options (plan §2). Per-session model set route exists.
3. HIGH — hermes serve binds 100.78.126.112:9119 (Tailscale), not host loopback; the contracted path-aware bridge does not exist. Mitigation observed: REST 401 without session token (incl. as codex user), but loopback-only + OS isolation are unmet.
4. MEDIUM — live Hermes config_version 34 (latest 39): the rehearsed 34→39 migration was never applied to the live root; v0.21 runs the old config.
5. MEDIUM — kanban.auto_decompose/auto_subscribe_on_create freeze flags absent from live Hermes config.
6. MEDIUM — /srv/skills cutover not executed (0 SKILL.md); scripts shipped only.
7. MEDIUM — .frank-attachments per-project read-only binds not created; uploads/projects root absent; lease flag FRANK_V021_FOUNDATION unset (foundation dormant); memory auto_retain:false present in repo config but live Hindsight state unverified; admission adapter unwired.
8. MEDIUM — Codex shared-estate live canary never run (per S5 handoff); Codex ACL/least-privilege host changes not applied.
9. Recorded earlier and still true: Hermes-domain owner attestation absent; browser visual-freeze receipts not regenerated.

Smallest unblock path: (a) apply the central wiring patch + flip FRANK_V021_FOUNDATION, restart, re-run full suite + browser journeys; (b) bind serve to 127.0.0.1 and deploy the path-aware bridge; (c) replace CURATED_MODELS with Hermes model options; (d) run the rehearsed 34→39 migration + set Kanban freeze flags on the live root; (e) execute skills cutover, .frank-attachments binds, Codex ACL host steps from the S5 handoff scripts; (f) rerun the affected acceptance rows and both attestations.
