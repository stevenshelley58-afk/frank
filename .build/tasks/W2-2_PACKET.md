# W2-2 packet (pre-staged — dispatch after W2-1 lands)

Goal: TASK W2-2 — Point the chat UI at the Hermes-backed chat API.
Replace the chat UI with `assistant-ui/react` (npm, MIT). Do NOT build message bubbles,
streaming, tool-call rendering, or markdown yourself — the library does all of it.

## Context
- W2-1 delivers `POST /v1/chat/turns` streaming replies from Hermes (via packages/hermes-client).
- The chat always talks to the **`hub`** Hermes profile unless a project is selected, in which
  case it talks to that project's profile. The route/profile selection already exists in the
  turn API (profile + sessionKey params).
- Tool calls made by Hermes must be visible in the transcript (the turn stream carries
  'tool' events; render them with assistant-ui's tool-call UI).
- Reloading the page restores the conversation — read back from Hermes (same sessionKey →
  conversation chaining), NOT from Frank's DB.
- ⚠️ F-TRACK OVERLAP: the parallel F-board (`.build/STATE.md`) has **F3-0 chat** READY
  (owner: cowork). Before starting, check `.build/STATE.md` — if F3-0 is IN_PROGRESS or
  its branch has touched `apps/web/src/components/chat/**`, STOP and report back to AG-0
  instead of colliding. Our rebuild wins on architecture (Hermes-backed chat); coordinate,
  don't duplicate.

## Scope
- Allowed: `apps/web/src/components/chat/**`, `apps/web/src/lib/chat-api.ts` (adapt to the
  new stream shape), `apps/web/package.json` (add assistant-ui/react), apps/web app router
  bits that render the chat.
- Coordinator-only (hot-file request, exact lines): apps/web/src/components/shell/frank-shell.tsx,
  pnpm-lock.yaml (regen at gate), docs/requirements/registry.json.
- Node: `export PATH="/c/Users/steve/node22:$PATH"` before pnpm/npx.
- Never `git add -A`; never push; targeted checks only: `pnpm --filter @frank/web typecheck`
  + `pnpm --filter @frank/web test`; commit format W2-2.

## Done-when
- Typing a message produces a streamed reply.
- Hermes tool calls are visible in the transcript.
- Reloading restores the conversation (from Hermes via sessionKey).
- typecheck + web tests green.
