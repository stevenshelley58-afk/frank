# W2-1 packet (pre-staged — dispatch after Wave-1 PR merges / user go)

Goal: TASK W2-1 — Add the Hermes client. Create `packages/hermes-client/` (new workspace
package) with one exported async-generator `chat()`, and rewrite `apps/api/src/routes/chat-turns.ts`
so submitting a turn calls `chat()` and streams the result. Delete everything that referenced
the old runner. Do NOT store message text in Frank's DB — only turn id, profile, session key,
status, started, finished.

## Verified endpoint facts (AG-0 pre-flight 2026-08-13 — see .build/tasks/W2_PREFLIGHT.md)
- Hermes API server: `http://127.0.0.1:8642/v1` — OpenAI-compatible, Bearer auth.
- Config env for Frank: `HERMES_API_URL` (default http://127.0.0.1:8642), `HERMES_API_KEY`
  (from environment, never hardcoded; do not read Hermes' .env — the operator supplies it).
- `POST /v1/chat/completions` — `model` = profile name (`hub`, `blockwise`, ...) or
  `hermes-agent`; messages array; `stream: true`.
- **Profile routing**: `/p/<profile>/v1/chat/completions` — the plan's `profile` param.
- **Session scoping**: header `X-Hermes-Session-Key: <sessionKey>` — scopes Hermes memory
  per conversation (the plan's `sessionKey`).
- **Multi-turn**: `conversation` request param chains turns in one named conversation.
- **Responses API + SSE** (preferred for streaming + tool events): `POST /v1/responses`
  with `input`, `previous_response_id`/`conversation`, then `GET /v1/responses/{id}/runs/...`
  or the run-events SSE stream. Tool-call events come through the SSE — W2-2 needs them.
- The plan's `chat()` must yield `{type:'text'|'tool'|'done'|'error', content}` events —
  map SSE/text deltas to 'text', tool events to 'tool', terminal to 'done', failures to 'error'.
- Transport: `openai` npm package (Appendix A) pointed at HERMES_API_URL + HERMES_API_KEY.
  Read the request/response shape from https://hermes-agent.nousresearch.com/docs (API-server
  page) — do not guess.
- **Timeout/abort**: if the Hermes service is down or a request stalls, the endpoint must
  return a clear error quickly — never hang. Wire AbortSignal timeouts.

## Scope
- Allowed: `packages/hermes-client/**` (new), `apps/api/src/routes/chat*.ts`,
  `apps/api/src/services/chat-turn-events.ts` (only to adapt to the new turn shape),
  package.json workspace wiring for the new package.
- Coordinator-only files (do NOT edit; hot-file request): apps/api/src/main.ts,
  apps/api/src/server.ts, packages/contracts/src/index.ts,
  apps/web/src/components/shell/frank-shell.tsx, infra/docker-compose.dev.yml,
  pnpm-lock.yaml (hot-file request if the new package changes it), migration journal,
  docs/requirements/registry.json.
- If chat-turns.ts needs new route deps (e.g. the Hermes client config), wire via
  server.ts/main.ts → hot-file request with exact lines.

## Rules
- Node: `export PATH="/c/Users/steve/node22:$PATH"` before pnpm/npx (engines >=22.11 <23).
- Commit explicit paths only; never `git add -A`; never push/pull/rebase/merge.
- Full gate is AG-0's job; run targeted checks (`pnpm --filter @frank/hermes-client typecheck
  && pnpm --filter @frank/hermes-client test`, `pnpm --filter @frank/api typecheck`).
- Unit-test the client with a FAKE OpenAI-compatible server (no real network in tests).
- Commit format: W2-1: <one line> / Status / Done / Next / Files. Final: Status: complete.

## Done-when
- POST /v1/chat/turns streams a reply from Hermes (needs the gateway running — AG-0/user
  starts it; if the gateway is down, the endpoint must error clearly — test THAT with the
  gateway stopped).
- Frank's DB contains no message text (assert in a test).
- Killing Hermes (stopping the gateway) → clear error, not hang.
- typecheck + package tests green.

## Handoff
1) package surface (chat() signature) 2) chat-turns.ts rewrite summary 3) tests written
4) hot-file requests (if any) 5) targeted check results 6) commit hashes.
