# ADR-021: Letta Memory Harness for Central Room

Status: **Deployed (preview)** — `letta-v1.frank.fail`
Date: 2026-08-02
Deciders: Steven (product), Hermes (implementation)

## Context

Frank's Central room needs persistent memory — a per-room "session wiki" that grows
over time so Frank remembers who Steve is, what Blockwise does, and what Chase's Game
is. The existing Goose harness is stateless per-session; the memory layer (mem0)
recalls facts but doesn't maintain a structured, agent-self-authored wiki.

## Decision

Adopt **Letta 0.16.8** (Apache 2.0, ex-Berkeley MemGPT) as the memory harness for the
Central room, behind the existing `ChatProvider` interface in `providers.ts`. Letta
runs as a sidecar container (`frank-letta-server`) on the shared `frank` docker
network, backed by a durable external Postgres + pgvector (`frank-letta-db`).

### Architecture

```
frank-web ──→ providers.ts (resolveHarness)
                 │
                 ├─ gooseProvider  (Goose ACP, stateless)
                 └─ lettaProvider  (Letta REST, persistent memory)
                        │
                        └─ frank-letta-server:8283
                              │
                              └─ frank-letta-db (Postgres + pgvector, 49 tables)
```

- One Letta agent per room (`frank-central`), with `persona` + `session_wiki` blocks.
- The agent self-edits `session_wiki` via `memory_replace` / `memory_insert` tools.
- `roomRoutes.set('central', 'letta')` pins Central; other rooms stay on Auto (Goose).
- Hot-swappable: `setRoomRoute('central', 'goose')` reverts instantly.

### Model

`deepseek/deepseek-chat` (V3, non-thinking). V4 thinking models (deepseek-v4-flash/-pro)
break multi-turn through Letta — the agent loop doesn't echo `reasoning_content` back.

## Key Pitfalls Discovered

1. **Letta ignores external DB env vars.** The image bundles its own Postgres.
   Fix: set `LETTA_PG_URI` env + mount `~/.letta` + `CREATE EXTENSION vector` in DB.

2. **Streaming requires `User-Agent: letta-client/1.0.0`.** Without it, `streaming=true`
   422s with "only supported for SDK v1.0+ clients." See `letta/utils.py:is_1_0_sdk_version`.

3. **SSE format: `content` is top-level**, not `message.content`. The `assistant_message`
   event shape is `{"message_type":"assistant_message","content":"token"}`.

4. **`streaming: true` is required** in the POST body when `stream_tokens: true`.

5. **`/v1/agents/:id/blocks/` endpoint hangs** on this version. Query the `block` table
   in Postgres directly for debugging.

## Verification

| Test | Result |
|---|---|
| Turn 1: stream real tokens | ✅ "Got it, Steve..." |
| Turn 2: multi-turn recall | ✅ "Chase." |
| Wiki self-edit | ✅ Bullet added automatically |
| Restart persistence | ✅ Post-restart recall correct |
| External domain | ✅ `letta-v1.frank.fail` HTTP 200 |

## Files Changed

- `apps/web/src/lib/letta-server.ts` — NEW: Letta REST client (SSE streaming)
- `apps/web/src/lib/providers.ts` — Letta provider + Central pin
- `apps/web/src/app/api/chat/route.ts` — Provider-aware session creation

## Deployment

- Container: `frank-web-letta-v1` on `frank` network
- DNS: `*.frank.fail` wildcard → VPS (grey-cloud, Caddy TLS)
- Caddy: `letta-v1.frank.fail` → `frank-web-letta-v1:3001`
- Letta: `/frank/deployed/infra/letta/docker-compose.yml`

## Next Steps

- Promote to prod `frank.fail` when Steven approves
- Phase 2: dispatcher (traffic cop) for multi-room routing
- Evaluate sleep-time agents for background wiki consolidation
