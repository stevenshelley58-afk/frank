# Frank v0.21 Phase B — live canary probe receipts (redacted)

Canary: clean clone of upstream tag `v2026.8.31` = commit
`29112bef099274229cadff79cdff7bf7b99c4b77` (v0.21.0) at `/worktrees/hermes-v021`
(fresh clone; dirty production checkout untouched). Venv: Python 3.11.15 via uv,
base + `messaging` extra (`aiohttp==3.14.3`) + `faster-whisper==1.2.1` (matches
production). State root `/srv/frank-canaries/s1-hermes-v021` (Session-1
allocation), API Server `127.0.0.1:18642`, rich serve `127.0.0.1:19119`,
isolated credentials in `/secure/frank-v021/raw/` (never committed).
Config: production-derived provider/model sections; gateway replaced with an
isolated block (no channels); `kanban.auto_decompose:false`,
`kanban.auto_subscribe_on_create:false`, `memory.auto_retain:false` frozen.

## 1. Endpoint/auth matrix (probed live)

| Surface | Result |
| --- | --- |
| API Server `/v1/tool-runs` | **404** — the v0.20.1 Ad Studio endpoint is gone upstream |
| API Server `/v1/capabilities` | 200 with valid `Bearer API_SERVER_KEY`; 401 without; structured `gateway_auth_failed` with wrong key |
| API Server `/v1/models` | 200 → `["hermes-agent"]` virtual model |
| API Server `/v1/health` | 200 `{"status":"ok","platform":"hermes-agent","version":"0.21.0"}` — **compatible with Frank's existing canary** |
| Rich serve `/api/status` | `auth_required:false`, `dashboard.public_url:null` (contract precondition holds) |
| Rich serve `/api/audio/transcribe` | 401 unauthenticated; with `X-Hermes-Session-Token`: 200 `{"ok":true,"transcript":"","provider":null}` on a 440 Hz tone — silence returns success + empty transcript, not an error |
| Rich serve `/api/audio/voice-config` | 401 unauthenticated (auth-gated; must never reach the browser) |

## 2. v0.21 replaces `/v1/tool-runs` with an official runs API

`/v1/capabilities` features (authoritative, probed): `run_submission`,
`run_status`, `run_events_sse`, `run_stop`, `run_steer`,
`run_approval_response`, `tool_progress_events`, `approval_events`,
`session_resources`, `model_options`, `session_chat(+streaming)`,
`session_fork`, `session_model_lock`, `skills_api`, `chat_completions(+streaming)`,
`responses_api`, and **`runs_idempotency` = supported, durable,
retention 86400 s** (upstream closes the prompt-submit idempotency gap).

Live run probes (POST `/v1/runs`): all returned `202 {"run_id","status":"started","replayed":false}`;
`GET /v1/runs/{id}` exposes status/stage/error. Terminal `failed` state with
structured upstream error reproduced. Request body accepts `input`,
`instructions`, `previous_response_id`, `conversation_history`, `model`;
`Idempotency-Key` header with replay/conflict detection (code: `gateway/platforms/api_server_runs.py`).

**Migration path (contract decision):** no compatibility patch required —
Frank's existing transport (Bearer `HERMES_API_KEY` against the gateway API
Server on the Docker-gateway address) survives v0.21 with the new `/v1/*`
surface. Ad Studio moves from tool-run polling to `/v1/runs` + SSE + `approval`
+ `steer` + `stop`. The old dirty v0.20.1 `tool_run_api.py` is retired with
upstream; the recovered branch `codex/frank-v021-tool-runs-recovery` exists
only as evidence.

## 3. Live blockers / findings (must not be papered over)

1. **Provider billing:** every tool-capable provider in the production
   credential set returns `HTTP 402 Insufficient Balance` (venice non-default
   models, aoru, orcarouter, concentrate.ai). The only funded model
   (`custom:venice e2ee-qwen3-6-35b-a3b-uncensored-p`) is declared
   `supports_tools:false`. **Production is affected too:** the three latest
   Ad Studio runs in `state.db` (`2026-09-03 08:28`) are `failed` at stage
   `final-check`. Full live tool-execution acceptance requires the operator to
   fund one provider (or provision any tool-capable model).
2. **v0.21 sends tool definitions regardless of `model_overrides`
   `supports_tools:false`** — reproduced on `/v1/runs` and
   `/v1/chat/completions` (override tried under both `custom:venice` and
   `venice` provider keys). v0.20.1 production chat works with this model, so
   this is a behavioral difference to resolve with the Hermes owner (Session 2
   attestation) before cutover; Frank-side impact limited to tool-capable runs.
3. Serve session token: `HERMES_DASHBOARD_SESSION_TOKEN` env (or ephemeral
   random injected into SPA). Production `.env` does NOT set it; production
   Frank does not use the serve path today (it uses Bearer + API Server), so
   the bridge/serve cutover is additive, not blocking.

## 4. Canary allocations (Session 1 → workstreams)

| Session | State root | API Server | Rich serve | Notes |
| --- | --- | --- | --- | --- |
| S1 (owner) | `/srv/frank-canaries/s1-hermes-v021` | 127.0.0.1:18642 | 127.0.0.1:19119 | running |
| S2 | `/srv/frank-canaries/s2-hermes-v021` | 127.0.0.1:18643 | 127.0.0.1:19121 | unallocated |
| S3 | `/srv/frank-canaries/s3-hermes-v021` | 127.0.0.1:18644 | 127.0.0.1:19122 | unallocated |
| S4 | `/srv/frank-canaries/s4-hermes-v021` | 127.0.0.1:18645 | 127.0.0.1:19123 | unallocated |
| S5 | `/srv/frank-canaries/s5-hermes-v021` | 127.0.0.1:18646 | 127.0.0.1:19124 | unallocated |

All canaries: fresh HERMES_HOME (no copied jobs), credentials isolated per
instance, loopback binds only. Unique test namespaces (banks `steven-v021canary-*`,
Hermes session prefixes `v021canary-*`, boards prefixed `v021canary-`) to keep
canary artifacts disjoint from production state.
