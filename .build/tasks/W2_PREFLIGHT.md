# Wave 2 pre-flight — Hermes API server (verified 2026-08-13)

## What the plan assumes (W2-1)
`HERMES_API_URL=http://127.0.0.1:8642` — an OpenAI-compatible service. **Verified:**
Hermes exposes exactly this via its **API Server** gateway platform
(docs: /docs/user-guide/features/api-server).

## How to run it
1. `.env` (C:\Users\steve\AppData\Local\hermes\.env): `API_SERVER_ENABLED=true` +
   `API_SERVER_KEY=<key>` — **DONE by AG-0 2026-08-13** (random key generated).
2. Start the gateway (NOT running as of 2026-08-13):
   - `hermes gateway run` (foreground) — or
   - `hermes gateway install` (Windows Scheduled Task, auto-start on login).
3. Log line when up: `[API Server] API server listening on http://127.0.0.1:8642`.

## Endpoint facts (for W2-1 packet)
- Base: `http://127.0.0.1:8642/v1` — OpenAI-compatible. Auth: `Authorization: Bearer $API_SERVER_KEY`.
- `POST /v1/chat/completions` — standard shape; `model` = profile name or `hermes-agent`
  (default profile). `stream: true` supported.
- **Profile routing**: `/p/<profile>/v1/chat/completions` — the plan's `profile` param
  ("hub", "blockwise", ...) maps here. Profiles are Hermes profiles (see `hermes profile list`).
- **Session scoping**: header `X-Hermes-Session-Key: <sessionKey>` — scopes long-term
  memory per conversation — the plan's `sessionKey` maps here.
- **Multi-turn chaining**: `conversation` request param chains turns in one named
  conversation (alternative: `previous_response_id` on the Responses API).
- **Responses API + SSE**: `POST /v1/responses` + `run_events_sse` — exposes tool-call
  events; needed for W2-2's "tool calls visible in the transcript".
- `/v1/capabilities` — machine-readable feature flags (chat_completions, responses_api,
  run_submission, run_status, run_events_sse, run_stop).
- Killing Hermes → client must return a clear error, not hang (timeouts + abort).
- `GET /v1/models` advertises `hermes-agent` (or the profile name).

## Open decision (user)
Start the gateway as a scheduled task (auto-start) vs foreground when Wave 2 begins.
