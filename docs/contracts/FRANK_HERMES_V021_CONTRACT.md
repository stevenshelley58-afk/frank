# FRANK ↔ HERMES v0.21 INTERFACE CONTRACT

`INTERFACE_CONTRACT_STATUS: READY`

Contract version: 1.0.0 · Issued: 2026-09-03T12:00Z · Owner: Session 1
(integration/release). Immutable once tagged; corrections are new versions/SHAs
(never amend). Feature branches merge contract revisions forward without
rewriting history.

Provenance: this contract lives on `codex/frank-v021-contract`, created at the
reviewed preflight tip `6a975aead077b742bcbe590ac0609d9cdb5aa648`
(`codex/frank-v021-preflight`), same Git object, no cherry-pick. Full safe
preflight ancestry: production reconciliation (`8b2c8b2` merge), test repairs,
Phase A/B evidence, backup tooling.

## 0. Upstream identity and compatibility commits

| Item | Value |
| --- | --- |
| Upstream repository | https://github.com/NousResearch/hermes-agent.git |
| Pinned release tag | `v2026.8.31` (v0.21.0) |
| Full release commit | `29112bef099274229cadff79cdff7bf7b99c4b77` |
| Legacy dirty runtime | v0.20.1 at `/home/hermes/.hermes/hermes-agent`, branch `codex/ad-studio-release-path-recovery`, nominal `ed1554a2fee7478f3085d307f376ef9cc5e2113c` + uncommitted functional diff |
| Recovered legacy diff | clean branch `codex/frank-v021-tool-runs-recovery` @ `350511412c…` (byte-identical, hashes in `docs/evidence/frank-v021/PRODUCTION_BASELINE.md` §4) — evidence only, **not** deployed |
| Compatibility patch | **None required** (see §2). Upstream v0.21 supplies a superset of the Ad Studio lifecycle |
| Rollback debris disposition | 8 `*.rollback-*` files in the dirty checkout: hashed in `/secure/frank-v021/raw/hermes-rollback-debris.sha256`; never copied, never deployed; left in place untouched until the old runtime is retired |

## 1. Runtime topology (production target)

One Frank, one profile named `default`, one Hermes v0.21 installation, one
Hindsight service, one canonical skills tree after cutover, authoritative files
only on the VPS. User-launched VPS Codex is a separate executor, not an
orchestration owner.

```
Browser ── same-origin ──► Frank (apps/window, Docker)
                             │
                             ├─ Bearer HERMES_API_KEY ─► Hermes gateway API Server (host, loopback via private bridge) :8642-class
                             ├─ X-Hermes-Session-Token (only if serve path needed; NOT used by current Frank)
                             └─ socket proxy ─► Hindsight (loopback :9177 equivalent)
```

`DESKTOP_BACKEND_CONTRACT`: Frank never impersonates `HERMES_DESKTOP`; the
serve dashboard stays gated (`auth_required:false` on `/api/status`,
`dashboard.public_url` null). The browser never receives any Hermes
credential, session token, WebSocket query token, bank name, host path, or
native board slug.

## 2. Endpoint / auth / health matrix (probed live — see `docs/evidence/frank-v021/HERMES_V021_PROBES.md`)

| Surface | Auth | Health | Notes |
| --- | --- | --- | --- |
| Gateway API Server (Frank's existing transport; port `API_SERVER_PORT`, prod 8642/canary 18642) | `Authorization: Bearer <API_SERVER_KEY>` (`API_SERVER_KEY` env/file) | `GET /v1/health` → `{"status":"ok",…,"version":"0.21.0"}` | rich `hermes serve` is a **separate** endpoint with **separate** auth; no cross-use of credentials |
| `POST /v1/runs` | Bearer | 202 `{"run_id","status":"started","replayed":false}` | **replaces v0.20.1 `/v1/tool-runs` (404 in v0.21)** |
| `GET /v1/runs/{id}` | Bearer | terminal states + structured `error` | |
| `GET /v1/runs/{id}/events` (SSE) | Bearer | `event: run.*` frames, `: stream closed` terminator | `run.failed` fixture committed |
| `POST /v1/runs/{id}/approval`, `/steer`, `/stop` | Bearer | per `capabilities.json` | single approval response; no invented expiry |
| `POST /v1/chat/completions`, `/v1/responses` | Bearer | OpenAI-shaped | streaming supported |
| `GET /v1/models`, `/v1/model_options` | Bearer | virtual model `hermes-agent` + options | |
| `GET /v1/capabilities` | Bearer | authoritative feature matrix | committed fixture |
| Rich `hermes serve` `/api/*` (port 9119-class) | `X-Hermes-Session-Token` (server-side in-memory; core WS `/api/ws?token=…`; Kanban plugin WS separate query token) — both complete URLs are secrets, redacted everywhere | `/api/status`: `auth_required:false`, `dashboard.public_url:null` | Frank does **not** consume this path today; bridge build-out (Session 2) is additive |
| Kanban plugin REST `/api/plugins/kanban/*` | **session-token authenticated upstream in v0.21** (v0.20.1's unauth gap is fixed) | headless `serve` responds `{"error":"Headless backend (hermes serve): web UI disabled"}` | headless Kanban automation uses `hermes kanban … --json` (exact argv contract in §7); never `kanban.db` directly |
| Hindsight | loopback-only; Frank via socket proxy (`hindsight-frank-proxy`) | `/v1/health` etc. | deployed 0.6.1; plugin manifest requires client ≥0.6.1 — satisfied |

**Timeouts:** run submit ≤20 s (202 fast-path), status poll 5 s cadence with
exponential backoff to 60 s, SSE idle 120 s reconnect via `Last-Event-ID`
resume, STT ≤90 s hard, transcribe body ≤ 25 MiB post-decode (§6).

**Idempotency:** prompt submit and cron trigger have **no native
Frank-level idempotency**; upstream v0.21 adds **durable `Idempotency-Key`**
on `/v1/runs` (86400 s retention, replay/conflict detection) — Frank MUST send
a stable UUID per logical submission and treat `409`-class conflicts as
already-accepted. Ambiguous crashes (sent vs unacknowledged) are resolved by
replaying with the **same** key, never blind re-submission.

## 3. Versioned schemas

Canonical JSON payloads (redacted fixtures in `fixtures/`):
`capabilities.json`, `run-submit.json`, `run-status-failed.json`,
`api-server-health.json`, `serve-status.json` (path/ID-redacted),
`stt-silence-response.json`, `tool-runs-404.txt` (negative fixture).

Normalized Frank event envelope (all consumers):

```json
{
  "seq": 42,
  "native_event": "run.failed",
  "derived_label": "terminal_error | provider_error | approval_required | tool_progress | assistant_message | reasoning_delta | todo_updated | subagent_lifecycle | unknown",
  "run_id": "…", "session_id": "…", "timestamp": 0,
  "payload": {},
  "frank_origin": false
}
```

Rules: unknown native events are retained verbatim under `derived_label:
"unknown"` (never dropped, never guessed); native and Frank-derived names stay
separate; every event is mapped exactly once or carries an explicit
filtered/truncated receipt; interim `already_streamed` chunks reconcile against
finals by `seq` dedupe. Replay windows: 512 events / 64 sessions /
process-epoch restart → authoritative reconstruction from Hermes (durable IDs
+ `previous_response_id` lineage), never from Frank-local memory alone.

## 4. Scopes and registry

- One profile `default`; all sessions owned by it. Chat subagents are
  ephemeral internal work (`subagent_lifecycle`), never visible identities,
  never joined to Kanban worker IDs or `todo.updated`.
- Opaque `workspace_id` (UUIDv4, minted by Frank registry migration) → private
  resolver map `{host_path, hermes_path, container_path}` (Session 5 module;
  Session 1 central registration in `project_store.py`).
- `memory_scope` = immutable legacy-derived value (`steven-<slug>` /
  `steven-unassigned`), migrated verbatim, never re-derived from new IDs.
- `board_binding_id` = opaque Frank handle ↔ private native Hermes board slug
  mapping; no slug crosses to the browser. Current native boards: none
  (`board_slug` NULL in `projects.db`); creation is a tested later step.
- Known mismatches to fix inside the migration (evidence:
  `docs/evidence/frank-v021/WORKSPACE_INVENTORY.md`): Hermes stored
  `primary_path` `/srv/projects/*` is stale (real: `/projects/<slug>`);
  container names diverge from host names (blockwise case is data, not code).

## 5. Workspace-execution lease (one writer per `workspace_id`)

Single lease service (Session 5 module + Session 1 authoritative-verifier
wiring): acquisition points = Hub prompt before tool-capable execution, Kanban
worker dispatch, cron gateway dispatch, supported Codex VPS launch. A real
pre-executor Kanban/cron gateway hook gates ready/due work **before** workspace
entry, fails closed when the lease service is unavailable, and reconstructs
authoritative owner/run state after restart. Semantics: queue/refuse/cancel,
heartbeat ≤ TTL/3, terminal release, TTL-plus-authoritative-process stale
reclaim (liveness verified against real processes, never time alone), native
max-in-progress alignment. Guarding only Frank's start API is insufficient.
If a live end-to-end lease proof is not achieved before cutover, mutating
task/routine execution stays disabled via feature flag.

## 6. Attachments, STT, and paths

- Browser-safe attachment DTO: `{id, name, size, mime, project_ref}` only.
  Private resolver maps DTO → host/container/Hermes paths server-side.
- `/data/uploads` in container ↔ `/srv/frank/data/window/uploads` on host.
- Whole per-project-root read-only `.frank-attachments` bind projection (or
  explicit broker fallback), `file.attach` returns exact `ref_text`; image/PDF
  detach via per-native-path `image.detach`; hard caps: image 25 MB, PDF
  50 MB/25 pages (`pdftoppm`), generic file cap and memory-pressure boundaries
  per Phase F matrix. `@folder:` maps to canonical workspaces only (never
  slug-constructed). Traversal/symlink/outside-workspace are negative tests.
- STT: `POST /api/audio/transcribe` `{data_url, mime_type?}` on the serve
  surface, ≤25 MiB post-decode, Frank HTTP body allowance ≥ 4/3 base64
  expansion + JSON overhead; response `{ok,transcript,provider}`; silence =
  HTTP 200 `{ok:true,transcript:""}` (fixture committed), composer unchanged,
  not an error; language config server-side (`stt.language: en`); immediate
  temp cleanup; sanitized errors; `/api/audio/voice-config` never reaches the
  browser. Provider: configured provider, else bundled `faster-whisper`
  (`base`, matches production). Browser sends audio only to Frank same-origin.
- No Hermes secret in the browser. Centralized strict same-origin mutation
  guard on every new browser state change: allowlisted `Origin`, exact
  `Content-Type` per endpoint, missing/null/cross-site → 403; server-to-server
  bridge callbacks carry their own credential (separate from browser auth).

## 7. Kanban / routines (passive-first)

Create payload frozen: `triage:true`, `workspace_kind:"dir"`,
server-resolved `workspace_path` (from resolver), assignee `default`,
stable native `idempotency_key`; `kanban.auto_decompose:false`,
`kanban.auto_subscribe_on_create:false`; prove no worker before explicit
start. Headless REST is disabled upstream → automation via documented safe
`hermes kanban … --json` argv (no shell interpolation) or bridge-authenticated
plugin routes if serve-mode Kanban is contracted later. Event drain: cursor
resume, >200 backlog, no gap/duplicate; worker IDs never joined to chat
subagents or `todo.updated`.
Routines: inert-first two-phase update (POST inert far-future → validate
allowlisted advanced fields → PUT activate), `context_from:["self"]`,
operation ledger, failed-phase rollback, no execution/delivery between POST
and PUT (proven). Notepad UI only behind a contracted, tested shim.

## 8. Memory policy

`auto_retain:false` frozen; memory admission only through Session 5's
supported-API Hindsight adapter (explicit user-confirmed or policy-qualified
admission, synchronous recall preserved, `observation,world,experience`
labels, 2,048-token recall ceiling, bank template `steven-{workspace}`
preserved, `steven-unassigned` fallback). Never patch vendor source, never run
a second memory service. Global promotion is explicit and idempotent;
project isolation and correction-precedence tests are Phase F gates. Deployed
Hindsight 0.6.1 stays; version/config parity verified after every restore.

## 9. Skills and Codex

Runtime-owned skills excluded from the canonical tree; same-name shadow
rejection; staged `/srv/skills` cutover to one checksum-identical approved
tree consumed by fresh Hermes and VPS Codex; least-privilege per-project
ACL/group/umask/Git ownership; sequential leased two-way edits
(Hermes↔Codex) with simultaneous-start exclusion; newly registered projects
exposed with no authoritative local copy.

## 10. Canary allocations and ownership map

Canary endpoints/state roots (unique per session; single profile `default`
inside each instance):

| Session | State root | API Server | Rich serve |
| --- | --- | --- | --- |
| S1 | `/srv/frank-canaries/s1-hermes-v021` | 127.0.0.1:18642 | 127.0.0.1:19119 |
| S2 | `/srv/frank-canaries/s2-hermes-v021` | 127.0.0.1:18643 | 127.0.0.1:19121 |
| S3 | `/srv/frank-canaries/s3-hermes-v021` | 127.0.0.1:18644 | 127.0.0.1:19122 |
| S4 | `/srv/frank-canaries/s4-hermes-v021` | 127.0.0.1:18645 | 127.0.0.1:19123 |
| S5 | `/srv/frank-canaries/s5-hermes-v021` | 127.0.0.1:18646 | 127.0.0.1:19124 |

Namespaces: banks `steven-v021canary-*`, session/board prefixes
`v021canary-`. All canary jobs paused; outbound notifications, provider
writes and destructive tools blocked.

Protected design/file ownership (edit rights):

| Area | Owner |
| --- | --- |
| `docs/contracts/`, shared schemas/fixtures, registry migration, central wiring, deploy/CI/flags, evidence refs | Session 1 only |
| Hermes adapter (`codex/frank-v021-hermes-adapter`): adapter module, transport, event mapping | Session 2 |
| Hub functional widgets/controls (`…-hub-functional`): web/js modules, homes | Session 3 |
| Work routines (`…-work-routines`): routines module, cron client | Session 4 |
| Shared estate (`…-shared-estate`): resolver, lease, admission adapter | Session 5 |
| Hub shell/tokens/Ad Studio visual design | FROZEN (nobody) |

Feature flags (default off until READY): `frank.v021_runs_api`,
`frank.lease_gate`, `frank.memory_admission`, `frank.skills_cutover`,
`frank.codex_executor`. Rollback behavior per flag: off → exact legacy path.

## 11. Migration, rollback pairing, and test commands

- Migration: quiesce writes → full-state backup (script committed:
  `apps/window/scripts/frank_v021_full_backup.sh`; drill PASSED
  2026-09-03T11:01Z) → restore into new versioned root → run v0.21 migration
  there → inventory/count/sentinel parity (sessions/transcripts + compression
  lineage, cron history, notepad/config, Kanban boards/tasks/runs/attachments,
  Hindsight banks/sources) → switch traffic. **Old binary ↔ old/restored root
  only; new binary ↔ migrated clone only. Never cross.**
- Tests: `python -m unittest discover -s tests` (apps/window),
  `node --check` every JS file, `node --test tests/*.mjs`, container build
  from exact SHA, contract fixtures replay (`fixtures/`), authenticated
  browser journeys 1280×800 + 390×844, production smoke per runbook.

## 12. Cutover readiness ledger (honest state)

Proven live: protocol surface (auth, submit/status/SSE/terminal, capabilities,
models, health), STT contract incl. silence behavior, serve gating, Kanban
plugin auth posture, Hindsight compatibility/restore, backup/restore, design
freeze receipts, Ad Studio reconciliation.
Pending before **release** (not protocol feasibility): live tool-executing
golden runs (blocked by provider billing — `HTTP 402` on every tool-capable
provider; production Ad Studio runs show the same `failed: final-check`
today), v0.21 `supports_tools:false` override behavior decision (Hermes-owner
sign-off), bridge build-out + negatives, lease live proof, migration
rehearsal on the restored clone, full Phase F matrix. These gate
`RELEASE_STATUS: READY`, not this contract; per rules, `NOT_READY` would
apply only to a protocol/feasibility blocker, which did not occur.
