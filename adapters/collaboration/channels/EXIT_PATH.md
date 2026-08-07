# CH-07 — Adapter exit path: migrating off the CopilotKit Channels SDK

**Status:** Documented exit path (master plan §8E CH-07).
**Decision:** M1/M12 — the SDK is pinned (`@copilotkit/channels@0.7.3`) and its
internal lifecycle seam (`channel["ɵruntime"]`) is touched in at most one file
inside the adapter package. This document is the pre-written exit plan if the
SDK's pre-1.0 churn (risk: "Channels SDK API churn", severity High) forces a
move to a direct [grammY](https://grammy.dev/) implementation.

## Why an exit path exists

The Channels SDK is pre-1.0 and has already shipped breaking changes between
0.6.x and 0.7.x. Frank's integration is deliberately narrow: Telegram
**notify + approve only** (M2), long-polling (M1). That surface is small
enough that a direct grammY client is a bounded, well-understood replacement.
The exit path is documented *now* so a forced migration is a mechanical swap,
not an architecture project.

## What the architecture already isolates (the swap boundary)

Everything above the transport already speaks Frank-owned types, so replacing
the SDK touches only the adapter package:

| Layer | Depends on SDK? | Migration impact |
|---|---|---|
| `ChannelPort` (contracts) | No — Frank-owned | None |
| `DecisionRegistrationRecord`, card rendering | No — Frank-owned | None |
| `TelegramChannelAdapter` | Yes — `StateStore`, `MemoryStore` types | Replace StateStore usage |
| `TelegramTransport` (Bot API) | No — already direct `fetch` | None (grammY can reuse it) |
| `channels-listener` (tap handler, push loop) | No — HTTP + Frank types | None |

**Key fact:** the production transport (`HttpTelegramTransport`) is already a
direct Bot-API `fetch` client — the SDK is used only for the `StateStore`
interface and (in CH-00's spike) the `ɵruntime` lifecycle seam.

## Migration steps (when triggered)

1. **Add grammY** to `adapters/collaboration/channels` (`npm i grammy`).
2. **Replace the transport:** implement `TelegramTransport` over grammY's
   `Bot.api` (sendMessage, editMessageText, answerCallbackQuery, getUpdates).
   The interface is already minimal; this is a ~40-line adapter.
3. **Replace the lifecycle:** use grammY's `bot.start()` long-polling loop
   instead of `channel["ɵruntime"].start()`. This removes the *only* `ɵruntime`
   reference.
4. **Keep `PostgresStateStore`:** it implements the SDK's `StateStore`
   interface, but Frank only uses `kv` and `list`. Either keep implementing
   the interface (harmless) or narrow to a Frank-owned interface — the adapter
   code uses only `kv.get/set/delete` and `list.append/range`.
5. **Delete the SDK dependency** from `package.json` and the `ɵruntime` file.

## What does NOT change

- The `ChannelPort` contract and all Frank-owned types.
- The listener's tap handler, push loop, and Frank API client.
- The Postgres StateStore schema and data (registrations survive the swap).
- The command-envelope resolution path (taps → `/v1/work/{id}/commands/...`).

## Trigger conditions (do not migrate speculatively)

Migrate only when one of these is true:

- The SDK ships a breaking change that the pinned version cannot absorb.
- The SDK is abandoned (no releases for 6+ months) and a CVE is filed.
- The `ɵruntime` seam is removed and no compatible replacement lands.

Until then, the pinned SDK + direct Bot-API transport is the correct path, and
the upgrade smoke test (CH-07) detects lifecycle breakage on every upgrade
attempt.
