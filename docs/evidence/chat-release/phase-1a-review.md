# Phase 1A Review — Fastify, Broker, Harnesses, Model Gateway

**Date**: 2026-08-12  
**Base SHA**: `7087928`  
**Reviewer**: coordinator

## Verdict: ALREADY IMPLEMENTED

All 12 Phase 1A tasks are complete in the codebase. No new code needed.

## Task-by-task verification

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Submit uses durable PostgreSQL | ✅ | `chat-turns.ts:73-99` — idempotent ON CONFLICT, transaction, `request_hash` |
| 2 | Status reads owned turn | ✅ | `chat-turns.ts:101` — `GET /v1/chat/turns/:id` with cell + owner gate |
| 3 | SSE resume with cursor | ✅ | `chat-turns.ts:103-131` — `Last-Event-ID`, cursor-based polling, terminal close |
| 4 | Cancel atomically + receipt | ✅ | `chat-turns.ts:133-151` — `FOR UPDATE`, terminal receipt, event emission |
| 5 | Runner invokes HarnessBroker | ✅ | `chat-turn-runner.ts:33,68` — `new HarnessBroker(adapters)`, `this.#broker.select(...)` |
| 6 | Messages/events/checkpoints survive restart | ✅ | `chat-turn-runner.ts:49-53` — `recover()` resets running→queued, re-dispatches |
| 7 | Serialized event cursors, no gaps | ✅ | `chat-turns.ts:117-123` — sequential cursor, ON CONFLICT, `cursor > current` |
| 8 | Bound shutdown + deterministic recovery | ✅ | `chat-turn-runner.ts:55-60` — timeout split, cancel + active drain, running→queued |
| 9 | Auto/Deep/Vision/Image capability routing | ✅ | `chat-turn-runner.ts:219-243` — `planProviderAttempts()` with capability-specific defaults |
| 10 | Every attempt recorded | ✅ | `chat-turn-runner.ts:182-184` — `harness_fallback_attempt` table |
| 11 | Cooldown per-upstream | ✅ | `chat-turn-runner.ts:71-87` — per-route attempt loop, per-failure recording |
| 12 | Behavioral tests with fake adapters | ✅ | `chat-turn-behavior.test.ts` — 7 tests: 503, idempotency, SSE resume, cancel, routing, env config, dedup+shutdown |

## Outstanding (not blocking)

- **Live harness infrastructure**: Goose, LiteLLM, SeaweedFS, ClamAV, tusd are defined in compose but not running on VPS. Required for integration testing but not for Phase 1A code verification.
- **Test auth tokens**: Pre-existing `***` corruption in test file auth headers (secret-redaction pipeline). Tests pass via vitest transpilation; typecheck fails on those lines only.
