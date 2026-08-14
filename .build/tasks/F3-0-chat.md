# F3-0 — Chat: composer, attachments, execution

**Depends:** F0 (Frank deployed) · **Model:** cheap per lane · **Three parallel lanes, then serial integration**

Chat is merged on `main` at `b5b338b1` but never deployed or proven. This task finishes and proves it. Do not rebuild it.

**Architecture law:** Fastify + kernel broker own execution, state, routing, events, cancellation, recovery, attempts, usage and receipts. **Next is an authenticated proxy only** — it holds no canonical chat state and performs no model execution. Any Next-side execution found is deleted, not wrapped.

---

## Lane 1A — Fastify, broker, harnesses, model gateway

**Allowed:** chat-turn routes, stores, runner, provider planning, Goose `AgentHarnessAdapter` bridge, their tests
**Forbidden:** web composer, attachment lifecycle, migrations, production compose

### Requirements

1. `submit`, `status`, SSE `resume`, `cancel` — all use central auth, cell scope, idempotency, durable PostgreSQL records.
2. The runner genuinely invokes the kernel `HarnessBroker`. Prove it with a test that fails if the broker is bypassed.
3. Messages, events, checkpoints, attempts, terminal state, cancellation receipts and usage/cost survive a process restart. Test: kill mid-turn, restart, resume the stream, no gap and no duplicate.
4. Serialise event cursors. Handle the cancel/complete race — a turn that completes as cancel arrives must land in exactly one terminal state.
5. Bounded shutdown; deterministic startup recovery of in-flight turns.
6. Capability routing for `Auto`, `Deep`, `Vision`, `Image`. Each must select a route that can actually serve it — an `Image` request must never land on a text-only upstream.
7. Record **every** upstream attempt: selected, failed, cooled-down, succeeded.
8. Cooldown affects only the failing upstream, never a sibling.
9. **The Model Broker alone owns cross-provider fallback.** Prefer a configured healthy direct route via a signed `RouteLease`. On failure, return to the broker for a newly recorded fallback lease. The gateway may retry only the exact lease it was given; gateway-native cross-upstream fallback stays disabled. Test: kill the direct upstream, assert a second lease is recorded and the gateway performed no substitution of its own.
10. Report provider balance only from official endpoints. Otherwise report Frank's own usage/budget and the literal string `provider balance unavailable`. **Never invent a number.**
11. Goose is default. Hermes is browser/research-only and capability-isolated. Letta is manual-only. No harness is reachable as `Auto` except Goose.

**Done when:** routing, fallback, receipts, cancel, restart and shutdown all have passing behavioural tests using fake adapters against real route and store fixtures; no execution path exists in Next.

---

## Lane 1B — Attachments: storage, security, extraction

**Allowed:** attachment services, adapters, workers, routes, extractors, tests
**Forbidden:** composer, chat runner, migrations, production compose

### Limits — enforce exactly, never soften to pass a test

| Limit | Value |
|---|---|
| Per file | 2 GiB |
| Per message | 10 GiB |
| Files per message | 10,000 |
| Pool | 50 GiB |
| Host free-space refusal | 30 GiB remaining |
| Draft expiry | 24 hours |

### Requirements

1. Full lifecycle: authorize → renew → gate → hook → status → cancel → cleanup → authenticated Range download.
2. Capabilities bind to owner, cell, conversation, draft, size, expiry and allowed metadata. A capability from one conversation must fail in another.
3. **Three distinct identities: tusd, promoter, downloader.** The API never receives the tusd staging identity. Test cross-identity denial explicitly.
4. Expiry, bounded cleanup, tusd 404 handling, quota release on cancel.
5. **Scan every completed upload before promotion.** Nothing reaches canonical storage unscanned.
6. Reject: executables, encrypted archives, path traversal, MIME/magic-byte mismatch, decompression bombs, oversized expansion.
7. Extractors: bounded text/code, PDF, DOCX/structured, image + thumbnail + vision, and an explicit unsupported-format path.
8. **Never auto-expand an archive into context.**
9. Agents read attachments through canonical **source references**, never raw prompt bytes.
10. Re-run the protocol, EICAR and zero-residue canaries.

**Done when:** every limit refuses at the boundary; EICAR is caught before promotion; all three identities prove mutual denial; extraction produces source refs not bytes.

---

## Lane 1C — Shared composer and BFF

**Allowed:** web composer components, upload/chat adapters, BFF proxy routes, capability route, guard, tests, preview
**Forbidden:** Fastify internals, attachment services, migrations

### Requirements

1. **One shared composer in every reachable chat input.** Room chat, shell composer, central chat, workbench commands — all the same component.
2. Plus-button file **and directory** pickers, clipboard items, mixed drag/drop, nested relative paths preserved.
3. Uppy/tus using the exact server-returned headers and metadata.
4. Pause/resume across connection loss **and browser restart**.
5. Poll by `upload_id`. Emit `attachment_id` only after clean materialisation.
6. Virtualised manifest that stays responsive at 10,000 files.
7. Rotate draft IDs; clear the correct manifest after success.
8. Submit canonical snake_case `ChatTurnInput` to `/v1/chat/turns`.
9. BFF relays Fastify SSE authenticated — **it creates no events and no canonical state**.
10. Hide attachments when the runtime capability is off.
11. **Standalone-textarea guard runs in the normal build.** Any reachable textarea outside the shared composer fails the build.
12. Model selectors and receipt cards bind to durable records, never local state.

**Done when:** frozen install, typecheck, all web tests, guarded build and secret scan pass; the preview is updated and returns 200; no standalone reachable textarea exists.

---

## Integration (serial, coordinator + one hot-file worker)

1. Replay the three accepted lane ranges onto latest `main` once.
2. Regenerate shared indexes and `pnpm-lock.yaml` — never copy from an old base.
3. Reconcile only hot files.
4. Confirm migrations are exactly `0011`–`0013`; this task creates none.
5. Run hosted verify, secret scan, contracts, web build, and a disposable PostgreSQL apply/restart/ledger proof.

---

## Acceptance matrix — all must pass on one candidate

Picker · paste · drag/drop · nested directories · removal · retry · cancel · 10,000-file responsiveness · every size limit · pool and disk refusal · draft expiry · network and browser-restart resume · EICAR · MIME spoof · traversal · executable · encrypted archive · decompression bomb · cross-owner/cell/conversation denial · bucket denial · text/code, PDF, DOCX, image-vision, thumbnail and unsupported extraction · text and attachment turns · source use · SSE resume · cancel race · web and API restart persistence · ordered tool/artifact/citation/approval/usage/error/terminal events · Auto/Deep/Vision/Image routing · one cheapest direct call · one controlled fallback with both leases recorded · Goose eligibility · Hermes isolation · Letta manual-only · model/request/token/cost reconciliation · no invented balance.

## Legacy deletion — only after the matrix passes

Delete: process-local session/history/routing maps · duplicate provider registries · DeepSeek-as-harness code · Next execution and streaming after BFF cutover · duplicate composer/room/thread/frame variants · legacy aliases and compatibility flags.

**Check callers first.** `goose-server.ts` has explorer/tidy callers — migrate them before deleting, or the delete breaks an unrelated feature.
