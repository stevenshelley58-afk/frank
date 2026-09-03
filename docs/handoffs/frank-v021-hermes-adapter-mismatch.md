# Frank v0.21 Hermes runtime adapter — interface-contract mismatch handoff

Owner: Hermes v0.21 runtime adapter session (Session 2, Prompt 2 of 5).
Branch: `codex/frank-v021-hermes-adapter`.

## Contract gate — PASSED

- Immutable READY interface contract: tag
  `frank-v021-contract-ready-v1.0.0` = commit
  `2139353037fe544ca4306c521492846cf2b03c98`; remote branch tip merged
  forward as `087d7ee41a8b44d740d69511f50dfc0e0bb50879` (adds only
  `HANDOFF_S1_TO_WORKSTREAMS.json`; contract doc + fixtures byte-identical,
  `git diff` empty across both paths). No history rewritten.
- Canonical fixture checksums recorded (Session 2 derives adapter-owned
  copies from these; canonical location untouched):
  see `docs/contracts/fixtures/*.sha256` recorded at merge time in commit
  history (`sha256sum` output preserved in `/tmp` receipt on the VPS worktree
  session and re-derived in tests).
- `INTERFACE_CONTRACT_STATUS: READY`, version 1.0.0, issued 2026-09-03T12:00Z.
- Canary allocation (Session 2): state root `/srv/frank-canaries/s2-hermes-v021`,
  API Server `127.0.0.1:18643`, rich serve `127.0.0.1:19121`; namespaces
  `steven-v021canary-*` / `v021canary-`.

## Mismatch report (gate rule 5) — mandated capabilities absent from READY contract v1.0.0

The adapter mandate requires the capabilities below. They are **not defined**
by contract v1.0.0, so they are **not implemented and not invented**. Each
needs a contract revision (new immutable version) or explicit S1 pointer to an
existing upstream surface.

1. **Rich-serve session lifecycle.** Create with `source:"frank"`, resume with
   `defer_history`/`omit_messages`, durable `stored_session_id`/`session_key`
   vs ephemeral runtime id, durable history hydration via
   `GET /api/sessions/{id}/messages?limit=500&offset=N&order=oldest`
   (`pagination.returned` loop). Contract §2–3 define only gateway
   `/v1/runs` + SSE; no session create/resume/history surface exists.
2. **`session.events.since` replay method** keyed by
   `(replay_epoch, runtime_session_id, Hermes sequence)`. Contract instead
   specifies SSE `Last-Event-ID` resume plus 512/64/epoch reconstruction from
   Hermes durable IDs + `previous_response_id` lineage — implemented as
   contracted; the sequence-keyed method needs a revision if required.
3. **Native event table.** The mandated minimum vocabulary
   (`message.start/delta/interim/complete`, `reasoning.*`, `thinking.delta`,
   `tool.start/progress/complete`, `approval.request/pending`,
   `clarify/sudo/secret request/expire`, `session.info/usage`, gateway /
   chat-subagent events) is absent. Contract §3 defines the normalized
   envelope, the frozen `derived_label` set, unknown-event retention, and
   `run.*` SSE frames only. There is **no native `approval.expire`** to
   implement (consistent), and clarify/sudo/secret input flows are absent
   entirely.
4. **Model selection flow.** `config.set` with `confirm_required` /
   `confirm_expense_model` / `deferred` semantics, reasoning-effort and
   `fast` session settings, cache-reset warning: absent. Contract provides
   `/v1/models` + `/v1/model_options` and error-on-conflict (implemented).
5. **Attachment RPCs.** `file.attach` exact `ref_text`, `image.detach` per
   native path, `@folder:` reference construction: §6 freezes caps/DTO/bind
   projection semantics but defines no RPC names/payloads.
6. **Job/routine RPC surface.** §7 freezes the inert-first two-phase pattern,
   `context_from:["self"]`, ledger and rollback semantics, but no create/
   read/update/pause/resume/run-now endpoints or payloads.
7. **Kanban argv enumeration.** §7 delegates automation to
   `hermes kanban … --json` ("exact argv contract in §7") but does not
   enumerate the argv verbs/flags, and headless REST is disabled upstream.
   Wrapper is built to accept only validated argv arrays; the verb allowlist
   must come from the upstream `--help` at canary runtime or an S1 revision.
8. **Subagent control.** Only run-level `/v1/runs/{id}/steer` is contracted;
   dedicated subagent list/stop methods are absent (kept separate from Kanban
   worker IDs and `todo.updated` per §4/§7).

## Contract supersessions adopted (contract wins over mandate text)

- v0.21 **does** provide durable native idempotency (`Idempotency-Key` on
  `/v1/runs`, 86400 s retention, `409` = already-accepted, same-key replay on
  ambiguity): the write-ahead ledger now journals and reuses the stable UUID
  per logical submission instead of treating submissions as non-idempotent.
- Kanban automation via `hermes kanban … --json` argv (no shell) is the
  contracted path (§7); headless plugin REST is disabled upstream.
- STT lives on the rich serve surface (`POST /api/audio/transcribe`); the
  path-aware bridge build-out + security negatives are Session 2's open gate
  (contract §10/§12) and will be built additively against the S2 canary serve.
- Leases: Session 5 service + Session 1 pre-executor gateway hook; adapter
  fails closed until that ancestry is available (handoff JSON: foundation tip
  published later, must-not-depend-on adapter).

## Interim state

Contracted-surface implementation proceeds on this branch behind Session 1's
default-off feature flags (`frank.v021_runs_api`, `frank.lease_gate`, …) with
the gateway/SSE/ledger/kanban-wrapper/STT-client pieces and tests; the
mismatched items above wait for a contract revision. No UI, no deployment, no
`/projects/frank` in-place edits, no direct Hermes state access.
