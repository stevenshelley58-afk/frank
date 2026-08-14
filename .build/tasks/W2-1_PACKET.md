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

## Code map (AG-0 recon — trust this, do not re-explore)

- `apps/api/src/routes/chat-turns.ts` (159 lines) — still has local `ChatTurnRunner`
  interface and `deps.runner?.dispatch/cancel/available()`. Submit returns 202 after
  persisting `input` jsonb (currently includes message `content` text — STOP storing
  message text; store profile + sessionKey + status only). Events SSE already exists.
  Cancel still queries deleted `harness_fallback_attempt` — remove that.
- `apps/api/src/services/chat-turn-events.ts` (38 lines) — keep; used to append SSE events.
- `apps/api/src/server.ts` (HOT FILE) imports `ChatTurnRunner` and `chatTurnRunner?:`.
  File a HOT-FILE REQUEST with the exact replacement: drop runner, inject hermes-client
  config (`HERMES_API_URL`/`HERMES_API_KEY`) instead.
- `apps/api/src/test/harness.ts` also types `chatTurnRunner` — allowed if you must keep
  tests compiling; otherwise hot-file.
- `@frank/api` `frank.mayDependOn` is currently
  `['@frank/contracts','@frank/policy','@frank/identity','@frank/kernel','@frank/adapter-postgres']`.
  You MUST add `@frank/hermes-client` there AND as a workspace dep, or `deps:check` fails.
  `apps/api/package.json` is allowed for this task (workspace wiring).
- `pnpm-workspace.yaml` already includes `packages/*` — no edit needed.
- Package template: copy shape of `packages/policy/` (package.json + tsconfig extends
  `../../tsconfig.base.json` + vitest.config.ts + `src/index.ts`).
  `frank.layer: "packages"`. `openai` (npm, Apache, last release 2026-08-03, v7.x) is
  the allowed transport — depend on it ONLY inside hermes-client, never in apps/api.
- `pnpm-lock.yaml`: you MAY update it via `pnpm install` after adding the package
  (W2-1 exception). Include it in the same commit as package.json.
- Do NOT add a migration. Next free is 0016 and is leased by AG-0. Existing
  `chat_turn.input` jsonb can hold `{profile, sessionKey}` without message text.
- Do NOT restore Goose/HarnessBroker/F3-0. Wave 1 deleted that on purpose.
- Tests: fake HTTP server (Node `http.createServer` or undici MockAgent). No real
  network. Cover: stream text events; map tool events; timeout/abort when URL is
  dead (clear error, does not hang); DB persist assertion that stored input has
  no message text.
- Node: `export PATH="/c/Users/steve/node22:$PATH"` before every pnpm/npx.
- First command: `cd /c/Dev/Frank && git branch --show-current` (must be rebuild/wave2).

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
