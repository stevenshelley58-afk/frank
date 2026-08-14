# W2-2 packet — chat UI → Hermes-backed turn stream

Goal: Point the chat UI at the W2-1 Hermes stream. Use `@assistant-ui/react` (MIT)
for bubbles / streaming / tool-call cards / markdown. Do NOT hand-roll those.

Branch: `rebuild/wave2` (already exists; stay on it). Do NOT push.

## F3-0
Already BLOCKED on `.build/STATE.md` ("W2 supersedes"). Do not stop for it.

## TRUST THIS MAP — do not re-explore the API

W2-1 landed. `POST /v1/chat/turns` now:

```
body (strict):
  conversation_id: uuid
  idempotency_key: string
  profile: string          // "hub" unless a project profile is selected
  session_key?: string     // defaults to conversation_id server-side
  message: string          // the user text; NEVER persisted

response: 200 text/event-stream
  event: turn   data: { turn_id, state, created_at, ... }   // first event
  event: text   data: { content: "<delta>" }
  event: tool   data: { content: "<json {name,call_id,arguments}>" }
  event: done   data: { content: "" }
  event: error  data: { content: "<reason>" }
```

Cancel: `POST /v1/chat/turns/:id/cancel` (JSON, unchanged).
Events poll `GET /v1/chat/turns/:id/events` is lifecycle-only (queued/running/terminal) — **not** the reply text. Do not poll it for tokens.

`@frank/hermes-client` `chat()` is server-side only. The browser talks to Frank.

## Existing files (exact)

- `apps/web/src/lib/chat-api.ts` — `submitChatTurn()` still does `res.json()` of the OLD contract. Rewrite it to consume the SSE (`ReadableStream` / `event: name\\ndata: ...`). Keep `cancelChatTurn`. Drop any assumption that the POST returns a JSON turn view — the turn view is the first SSE `turn` event.
- `apps/web/src/lib/chat-turn-input.ts` + `.test.ts` — still builds `{ content[], attachment_ids, requested_capability, requested_model_alias }` from `@frank/contracts`. That body **will 400**. Change the helper to emit `{ conversation_id, idempotency_key, profile, session_key, message }`. Do NOT edit `packages/contracts/**` (coordinator-only). Define the new input type locally in `chat-turn-input.ts`.
- `apps/web/src/components/shell/chat-thread.tsx` — hand-rolled bubbles. Replace the thread rendering with `@assistant-ui/react`. Keep the file (or a sibling under `apps/web/src/components/chat/`) as the assistant-ui host so frank-shell can keep importing a `<ChatThread …>`.
- `apps/web/src/components/shell/composer-bar.tsx` — existing composer. There is a repo guard: `pnpm --filter @frank/web` build runs `guard:chat-composers` (`tools/lint/no-standalone-chat-textareas.mjs`). Do NOT add a raw `<textarea>` chat box. Use assistant-ui's composer OR keep composer-bar if it already passes the guard.
- `apps/web/src/components/shell/frank-shell.tsx` — **COORDINATOR-ONLY**. `send()` (approx lines 241–287) still: builds old `chatTurnInput` → `submitChatTurn` JSON → polls `listChatTurnEvents` for `payload.text`. File a HOT-FILE REQUEST with the exact replacement `send()` that calls your new streaming helper. Do not edit frank-shell yourself.
- `apps/web/package.json` — add `@assistant-ui/react`. Also add it to `frank.mayDependOn` if that field exists; otherwise leave a note. Then `pnpm install` (lockfile change allowed).

## Profile / session

- Default profile: `"hub"`.
- `session_key`: use the conversation id (stable across reloads).
- Do not persist assistant/user message bodies via `appendMessage` / `/v1/chats/:id/messages` for the live transcript. Local React state during the turn is fine. Reload restore: if no Frank→Hermes history route exists yet, keep conversation list from `/v1/chats` but leave the thread empty-or-stub and file HOT-FILE REQUEST for `GET /v1/chat/sessions/:sessionKey/messages` (proxy). Do NOT write message text into Frank's DB to fake restore.

## Scope
ALLOWED: `apps/web/src/components/chat/**`, `apps/web/src/components/shell/chat-thread.tsx`, `apps/web/src/components/shell/composer-bar.tsx`, `apps/web/src/lib/chat-api.ts`, `apps/web/src/lib/chat-turn-input.ts`, `apps/web/src/lib/chat-turn-input.test.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `.build/tasks/W2-2.md` (claim + hot-file pad ONLY).

FORBIDDEN: `frank-shell.tsx`, `apps/api/src/main.ts`, `apps/api/src/server.ts`, `packages/contracts/**`, migration journal, registry, any other project, Hermes itself.

## Rules
- FIRST: `cd /c/Dev/Frank && git branch --show-current` must be `rebuild/wave2`.
- Node: `export PATH="/c/Users/steve/node22:$PATH"` before pnpm/npx.
- Explicit-path `git add` only. NEVER `git add -A` / `git add .` / `commit -am` / stash / pull / push / rebase / merge / checkout.
- Commit format:
  ```
  W2-2: <one line>

  Status: complete
  Done: ...
  Next: ...
  Files: ...
  ```
- Targeted verify only:
  `pnpm --filter @frank/web typecheck`
  `pnpm --filter @frank/web test`
- Windows CRLF — no `sed -i`. Never write token/auth literals.

## Done-when
- `submitChatTurn` consumes the W2-1 SSE (turn/text/tool/done/error).
- Tool events render (assistant-ui tool-call UI, not a raw JSON dump).
- chat-turn-input test updated for the new body; no old `content[]` wire.
- Hot-file request filed for frank-shell `send()`.
- web typecheck + web tests green.

## Handoff
1) streaming helper signature 2) assistant-ui integration summary 3) tests 4) hot-file requests 5) targeted check results 6) commit hashes
