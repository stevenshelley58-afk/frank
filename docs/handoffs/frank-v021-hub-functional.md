# Frank v0.21 — Hub Functional Handoff (`codex/frank-v021-hub-functional`)

Owner: Frank Hub workstream (independent Frank-domain owner for the release gate).
Status: implementation complete on the READY interface contract; real-backend canary
evidence is pending the adapter checkpoint (see "Waiting on").

## 1. Ready contract SHA

- Contract: `docs/contracts/FRANK_HERMES_V021_CONTRACT.md` v1.0.0,
  `INTERFACE_CONTRACT_STATUS: READY`
- Immutable READY commit: `2139353037fe544ca4306c521492846cf2b03c98`
  (tag `frank-v021-contract-ready-v1.0.0`)
- Contract branch tip merged forward without rewriting history:
  `087d7ee41a8b44d740d69511f50dfc0e0bb50879` (machine-readable S1 handoff; contract
  unchanged). Merge commit on this branch: `606a6a7d…` (`60a6a7d`).
- Pre-flight evidence commit in ancestry: `6a975ae`.
- Adapter gate: `codex/frank-v021-adapter-base` / `ADAPTER_STATUS: READY` had **not**
  been published at handoff time. No real-backend canary receipt is claimed.

## 2. Worktree / branch

- VPS worktree: `/projects/frank-hub-functional` (created from the exact READY commit;
  `/projects/frank` was never modified in place).
- Branch: `codex/frank-v021-hub-functional` — pushed to origin; not merged, not deployed.

Commits:
1. `a83bdda` feat(hub): make every Hub control real on the v021 interface contract
2. `60a6a7d` merge: forward contract branch tip 087d7ee

## 3. Files

New modules (all plain ES modules, mount/dispose interfaces, no frameworks):
- `apps/window/web/js/chat/api.js` — single browser↔Frank seam; routes, non-GET JSON
  mutations, turn identity (`Idempotency-Key` + `turn_id`), upload/detach, STT, VPS attach.
- `apps/window/web/js/chat/events.js` — normalized Frank envelope handling; legacy frame
  mapping; unknown/malformed retention; `EventDeduper` (exactly-once); `highestSeq` watermark.
- `apps/window/web/js/chat/render.js` — shared escape/markdown helpers (verbatim behavior
  from the old app.js section).
- `apps/window/web/js/chat/activity-timeline.js` — versioned renderer registry
  (`REGISTRY_VERSION = "1"`), redacted raw view, `<details class="thinking-stream">` DOM.
- `apps/window/web/js/chat/turn-stream.js` — one-turn state machine, blocking-input forms,
  retry, reconcile, stop identity.
- `apps/window/web/js/chat/attachment-controller.js` — pick/drag/paste/staging, measured
  limit, progress/cancel/retry, snapshot notices, detach.
- `apps/window/web/js/chat/dictation-controller.js` — MediaRecorder state machine.
- `apps/window/web/js/chat/model-selector.js` — Hermes-projected models, accepted-runtime
  paint, unavailable-cache honesty.

Modified:
- `apps/window/web/js/app.js` — chat section rewired to the modules; Explorer gained the
  typed drag payload + attach action; Ad Studio run path preserved via `attachmentPayload`.
- `apps/window/web/index.html` — one new button in the existing shared `#ctx` context menu
  (`Attach to chat`). Nothing else changed; Hub DOM/order untouched.
- `apps/window/web/app.css` — Hub-only functional states (`.activity-row`,
  `.input-request`, …) using existing tokens only; no design-system changes.
- `apps/window/tests/test_ui_contract.py` — 4 source-contract expectations updated to the
  new module seams (behavior preserved); all other expectations unchanged.

Tests:
- `apps/window/tests/chat_v021.test.mjs` — 34 node tests.

## 4. Central import/wiring patch for Session 1

Session 1 owns central imports/routes. To wire this branch into the integration
candidate, no index/route registration changes are required (all imports are static
relative imports inside `app.js`). The only wiring-relevant facts:

1. New browser files served statically: `web/js/chat/*.js` (no build step, same as
   existing modules). If a CSP allowlist exists, add the directory.
2. New server routes the modules call (server-side owners in parentheses):
   - `POST /api/chat/turn` (exists; adapter adds stable turn identity + `Idempotency-Key`)
   - `POST /api/chat/stop` (new — adapter)
   - `POST /api/chat/respond` (new — adapter; approval/clarify/sudo/secret with
     `request_id`, one-shot)
   - `POST /api/chat/steer` (new — adapter; only rendered if contract says supported)
   - `GET /api/chat/events?session_id=&after=` (new — adapter; durable replay; 404-tolerated)
   - `POST /api/chat/attachments/vps` (new — session 5 path/manifest service; typed
     `{root, path, kind}` payload, returns browser-safe DTO or refusal)
   - `POST /api/audio/transcribe` (new — adapter; `{data_url, mime_type?}`, silence =
     200 `{ok:true,transcript:""}`; `/api/audio/voice-config` is never called)
   Until a route exists the browser shows an honest notice and never fakes success.
3. Cache-bust: `index.html` still references `/js/app.js?v=20260831-batch-live-history-v1`
   (unchanged, so the frozen HTML baseline is preserved). Session 1 may bump the version
   string in its own wiring commit.

## 5. Test results (at commit `60a6a7d`)

- `node --check`: pass for every JS file under `web/js` (fail=0).
- `node --test tests/chat_v021.test.mjs tests/chat_stream.test.mjs`: 34 pass / 0 fail.
- `python -m unittest discover -s tests` (from `apps/window`): 397 tests.
  - Every failure/error is identical to the pristine contract-commit baseline
    (`2139353`) — verified by stashing my changes and re-running; 5 loader/contract
    errors (`test_control_plane_contract`, `test_control_plane_step2_acceptance` ×3,
    `test_ad_template_topology`) pre-exist at the contract base and are fixed in newer
    `main`/foundation work, not my scope.
  - 4 `test_ui_contract` expectations were updated because the approved plan moved chat
    behavior into `web/js/chat/` modules; behavioral assertions are preserved.
- Mocked-only: everything above. No real Hermes receipt is claimed yet.

## 6. Before/after baseline comparison

- Production container `frank-window` (127.0.0.1:18080) was diffed against the repo
  before any edit: served `index.html`/`app.js` matched `main` `49d75ad` byte-for-byte
  except the `?v=` cache-bust string. Baseline notes: `/root/frank-v021-baseline-notes.md`
  (DOM order, keyboard behavior, states, server surface).
- Preserved unchanged: Hub home screen (empty state + 3 widget slides), transcript,
  composer controls and order, session nav, keyboard send/newline, scroll pinning,
  error copy style, responsive layout, three-widget registry, Explorer layout/behavior
  (plus the granted attach action), shared context menu, media viewer.
- Changed behavior (all contract-driven): model list no longer falls back to a hardcoded
  list; mic uses Frank's transcription endpoint (no browser SpeechRecognition); stop
  sends the upstream run identity; attachments show the measured limit instead of
  silently truncating at 500; activity shows the full normalized event trail.

## 7. Browser evidence

- Pending: the authenticated browser journey at 1280×800 / 390×844 against the composed
  canary (frozen DOM order, computed styles, geometry, unmasked pixels) requires the
  adapter + foundation checkpoints. Not run; not claimed.
- Static verification done: `node --check` everywhere, node test suite, Python suite
  diffed against baseline.

## 8. Event-kind rendering table

| Normalized derived_label | Row |
|---|---|
| `assistant_message` (delta/final) | hidden from timeline; answer renders once in the bubble |
| `assistant_message` (complete) | "Run completed" (ok) |
| `assistant_message` (cancelled) | "Run cancelled" (muted) |
| `reasoning_delta` (delta/replace) | "Provider reasoning summary" (markdown, streaming) |
| `reasoning_delta` (status) | "Status: …" (muted, labelled status, not private reasoning) |
| `tool_progress` (started/progress/completed) | "Running/…/finished <tool>"; failure text only from completion fields; failed rows red |
| `approval_required` (request/restored) | blocking form row with exact `request_id`; restored pending items re-render |
| `approval_required` (received/resolved) | confirmation row; waiting state cleared |
| `approval_required` (expired) | only for clarify/sudo/secret native expiry; approval itself never expires |
| `todo_updated` | checklist rows (done/undone), replaced in place — never a task board |
| `subagent_lifecycle` | per-subagent rows (started/steered/stopped/finished/failed) |
| `terminal_error` / `provider_error` | red rows; terminal also fails the turn and offers retry |
| `unknown` (any unrecognized native event) | "Other Hermes activity" + collapsible redacted JSON |
| replay/reconnect notices | honest hydration/interrupted copy |

Redaction: secret-shaped keys → `[redacted]`; strings truncated at 240 chars; depth cap 6;
raw view is secondary and never receives raw HTML.

## 9. Limits (as implemented)

- Models: no local list; UI/schema-tested only; live execution sample deferred to the
  contract-capped canary (one model per authenticated provider/transport class).
- Local attachments: measured contract limit shown before upload (default 500, from the
  current server cap — adapter may change the number; the controller takes it via options);
  failed/aborted uploads are never sent; detach route called on chip removal/cancel.
- Folder uploads: labelled "uploaded snapshot" with capture time; never claimed live.
- VPS folders: live reference inside the current project; Hermes receives a capped listing;
  outside-workspace/refused selections render the server's refusal verbatim.
- STT: 25 MB decoded-audio limit enforced client-side before base64 (body overhead is not
  implied to be decoded size); 90 s hard cap; server-configured language only.

## 10. Accessibility results

- Keyboard: Enter/Shift+Enter composer; Escape cancels dictation and closes menus/viewer;
  Explorer rows are focusable with Arrow/Enter/Backspace/F5/Ctrl-C plus the new `A` attach
  key; context menu actions are real buttons.
- Names/roles: chips have per-item aria-labels; model menu items are `role="menuitem"`
  with `aria-pressed`; mic button toggles `aria-pressed` and label; blocking forms label
  their fields; sudo/secret use `type="password"`, `autocomplete="off"`, are cleared on
  submit and never re-rendered.
- Live region: `notify()` rows use the existing system-message style; dictation/notice
  copy is announced once per state change (no per-token announcements).
- Pending browser-level checks (focus-return assertions, screen-reader spool tests) run
  with the composed canary journey.

## 11. Known risks

1. Routes not yet implemented server-side (`/api/chat/stop|respond|steer|events`,
   `/api/chat/attachments/vps`, `/api/audio/transcribe`) surface honest "not available
   yet" notices; they cannot be exercised until the adapter/foundation merge.
2. `respondInput` one-shot binding and native expiry handling depend on the adapter's
   exact event payloads; fixtures follow §3 but live payloads may add fields (rendered
   as unknown rows rather than breaking).
3. Replay route 404-tolerance means reconnect reconciliation currently falls back to
   authoritative history; if the adapter ships paging limits, >500-message hydration
   needs the server paging loop (contract §3) — browser side is ready to page.
4. The 5 pre-existing Python failures at the contract base resolve in newer main; keep
   an eye on them at integration.

Rollback: the branch is additive on the contract commit; revert to `2139353` or delete
the branch. Remove steps: delete `web/js/chat/`, restore the previous `app.js`
(`git checkout 2139353 -- apps/window/web/js/app.js apps/window/web/index.html
apps/window/web/app.css`), drop the one `#ctx` button and the new CSS block.

## 12. Real integration cases only the release owner can run (after composing branches)

- One actual Hermes streamed answer + one real tool result through `POST /api/chat/turn`.
- Bounded model sample per provider/transport class with real credentials.
- Nested local folder sentinel + VPS folder sentinel through the real manifest service.
- Real STT round-trip (fixture STT is tested; real audio not run here).
- Authenticated browser journey at both viewports against the composed canary.
- Origin/Content-Type security negatives against the real server (browser tests assert
  the frontend always sends the contracted headers; server rejection is Session 1's gate).

None of the above are marked done. No mocked result is presented as real.
