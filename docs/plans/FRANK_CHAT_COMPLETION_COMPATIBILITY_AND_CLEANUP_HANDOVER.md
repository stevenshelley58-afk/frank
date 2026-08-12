# Frank Chat Completion, Compatibility, Production, and Cleanup Handover

Status: reviewed execution handover on `codex/chat-completion-handover-v3`

Created: 2026-08-12

Canonical starting commit: `b5b338b1589454596130b30364f70d55cf34f644`

Current production: accepted release `fead0c4b9e3cae60038b54f999a5066d165f8a2b` on the original VPS `76.13.209.160`

Chat preview: `https://preview.frank.fail/wave2-conversation-composer-v1/`

## 1. Objective and finish line

Finish the new Frank chat system completely, prove that it does not break or block the other Frank work already in progress, deploy the complete chat system to the original production VPS, and then remove every superseded **chat-specific** code path, document, process, flow, preview, service definition, credential, and owned runtime artifact that is proven obsolete.

This plan does not build or merge Dashboard, Lake, Night Watch, Channels, or unrelated Frank features. Those workstreams remain independently owned. This plan must, however, prove that their frozen/current packets can integrate cleanly after the chat release.

The chat feature is complete only when all of these are true on the same exact production release:

- every reachable chat input uses one shared rich composer;
- files, images, and directory trees can be selected, pasted, dragged, resumed, scanned, materialized, read by agents, and downloaded safely;
- Fastify and the kernel broker own execution, state, routing, events, cancellation, recovery, attempts, usage, and receipts;
- Next is an authenticated proxy only and has no canonical chat state or model execution;
- Goose is the default harness, Hermes is browser/research-only, Letta is manual-only, and DeepSeek is a model-gateway upstream rather than a harness;
- `Auto`, `Deep`, `Vision`, and `Image` select capable routes truthfully;
- direct OpenAI/Gemini routes are preferred only when configured and usable, with Concentrate as the recorded fallback;
- the exact candidate passes the full protected chat acceptance matrix and downstream compatibility gates;
- the exact accepted artifacts are deployed with rollback armed;
- legacy chat paths are absent from active source and operator-controlled runtime systems;
- a production acceptance receipt and chat cleanup receipt are complete.

Do not call the feature live because code, CI, a preview, or a disposable canary passed. The finish line is authenticated production acceptance on the exact deployed SHA and digests.

## 2. Explicit scope boundaries

### In scope

- rich composer UI and all reachable chat call sites;
- attachment authorization, tus upload, SeaweedFS storage, scanning, extraction, materialization, source references, and authenticated downloads;
- Fastify chat-turn API, SSE resume, cancellation, restart recovery, and receipts;
- kernel `HarnessBroker` execution and Goose bridge;
- LiteLLM model-gateway configuration and stable aliases; the Frank Model Broker alone owns cross-provider, account, and model fallback. LiteLLM may retry only the exact signed `RouteLease`, and gateway-native fallback stays disabled;
- Hermes isolation and Letta manual-only behavior required by chat;
- chat-specific production Compose, Caddy, configuration, migrations `0011` through `0013`, release evidence, rollout, rollback, and acceptance;
- deletion of superseded chat/harness/upload implementations and active runtime artifacts;
- dry-run integration proofs for all current downstream work.

### Out of scope

- implementing or merging Dashboard migration `0014`;
- implementing or merging Night Watch migration `0015` or enabling Night Watch live mode;
- building Lake/OpenFGA product features;
- changing Graphify product behavior;
- deleting another workstream's source, documentation, branch, preview, worktree, migration, service, bucket, image, or evidence;
- rewriting the repository's Git history;
- broad repository, Docker, VPS, cache, or documentation cleanup unrelated to chat.

If a downstream packet is incompatible, fix the chat side when the shared contract belongs to chat. Otherwise, record an exact rebase instruction for the downstream owner. Do not silently take over another workstream.

## 3. Current authoritative state

### Merged chat foundation

- PR `#73` merged normally.
- Exact `main`: `b5b338b1589454596130b30364f70d55cf34f644`.
- Main verify: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556679044` — passed.
- Main secret scan: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556679032` — passed.
- Signed release-artifacts run: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556797961` — passed.
- Evidence artifact: `release-evidence-b5b338b1589454596130b30364f70d55cf34f644`, artifact ID `9126444110`, SHA-256 `0a11d59de482b2dab348a0d9f14e80b75571282feae476e9aaf4ce2d185b0ac0`.
- These artifacts are evidence only. They are not production-accepted and must not be deployed after any later source/configuration change.

### Chat implementation evidence

- Rich composer source packet: `7b73909393911a329e1167b23cb5b5d9e2f18d81`.
- Live Fastify/kernel backend source packet: `7e9f00e3590d32cffc23a7f3e6b80477935d09fd`.
- Integrated pre-merge chat packet: `6ba8c1839458672aad80608a451884942466d239`.
- Integrated verify: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556403956` — passed.
- Integrated secret scan: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556403909` — passed.
- Private protocol canary evidence: `/srv/frank/evidence/wave1-canary-c541370`.
- Canary receipt manifest SHA-256: `485d9ba9fe12ca4fb719af4c0f1249238e67be5b65694f8d65944f0c73bc62f5`.
- EICAR receipt SHA-256: `69e0c2e7d77a1ce170454bfd98235116a42066de9272d8cd8beabb81a58ef65d`.
- Cleanup receipt SHA-256: `d6b3ae253e28393d2ea94ef347c88896ddb4e24c8d6b2292b21a64f19e641236`.
- Empty residue SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Sealed evidence manifest SHA-256: `7f38f20b99b82500e5f50a1c787b1406399b6a28cb0dfb3ef6e3716375568d5c`.

### Chat migrations

- `0011_harness_gateway.sql`: `470c0ea6e318442858929ce511c581244963955a74e18b2e394372d517e327ad`.
- `0012_chat_turn_event.sql`: `31cb9a0d24a329af580075b54e6751618dc1ea0dfaa61997992da33b01e5e189`.
- `0013_attachment.sql`: `c28cfa100a62a1448a2b5300b3708de0f0828028f8ded3589cf9afdb531e1fc2`.
- `0011` is the sole owner of `room_id_cell_uidx`.
- A disposable PostgreSQL 17 proof applied `0000` through `0013`, verified the migration ledger and constraints, and left zero residue.

### Downstream compatibility anchors

Previous coordination receipts named these packet tips:

- Dashboard API and reserved `0014`: `db20ce85eab8e3f50a03d547ab338cb039d98282`.
- Dashboard UI: `d852e87176d707423f4f245da3b2b54f8c3465f6`.
- Dashboard Lake: `7a965c23bbfb41ff776a8b80522db80397dc8d46`.
- Night Watch combined packet: `2e8544fd80eb569284e5b0d7f33cf68f30eed59e`.
- Night Watch handover: `cd666d3859e0309d75120966672256ab4020d579`.
- Accepted Graphify production/base behavior: `fead0c4b9e3cae60038b54f999a5066d165f8a2b`.

At this plan revision, `git ls-remote` no longer returned the previously published Dashboard or Night Watch handover branches, and the local object store no longer contained those packet objects. Therefore the listed packet SHAs are historical coordination anchors, not executable inputs.

Phase 0C must obtain the **current accepted replacement full SHA, remote ref, merge-base, and commit range from each originating workstream**, then prove all objects resolve from a fresh clone. If an owner confirms the historical SHA is still authoritative, the owner must republish that exact complete range before compatibility testing. If the owner supplies a superseding SHA, record the replacement and never consume the historical packet. Chat integration and production are blocked until the Dashboard/Lake, Night Watch, Graphify, and every other hot-file workstream used by the compatibility gate has a fresh-clone-resolvable current input.

Every downstream SHA is the tip of a complete commit range, not a single commit to cherry-pick. Compatibility workers replay the full accepted range from its recorded merge-base.

## 4. Non-negotiable execution rules

1. Use `gpt-5.6-terra` at low reasoning for implementation workers. The coordinator plans, assigns, reviews, integrates, and releases; the coordinator does not author feature code.
2. Use one isolated worktree and one `codex/` branch per worker.
3. Run no more than three workers plus the coordinator at once.
4. Read the repository `AGENTS.md` and this whole plan before acting.
5. No localhost testing. Before feature edits, update the existing public chat preview or create the next version through `/srv/frank/infra/preview-deploy.sh`. Backends remain private.
6. Production stays unchanged until Phase 6.
7. Use only the original VPS `76.13.209.160`; do not provision a new host or change DNS.
8. Migrations `0011` through `0013` are immutable unless a P0 data-safety defect requires a reviewed replacement before they ever reach production. This plan creates no `0014+` migration.
9. PostgreSQL is canonical. Valkey is cache, fanout, cooldown, rate-limit, and coordination state only.
10. SeaweedFS, tusd, ClamAV, LiteLLM, Goose, Hermes, and Letta remain private. Caddy exposes only Frank's authenticated routes and the tightly gated tus upload path.
11. The API never receives the tusd staging identity. The tusd, promoter, and downloader identities remain distinct and scoped.
12. Do not invent balances, model names, request IDs, costs, provider usage, provenance, or acceptance evidence.
13. Only P0/P1 findings block a phase. Record P2 findings without reopening the accelerated scope.
14. Do not merge, edit, delete, rename, reset, or clean another workstream's branch or worktree.
15. No broad deletion, global prune, history rewrite, or archive of obsolete chat source. Deletion requires exact proof and applies only to chat-owned targets.

## 5. Shared-file ownership and parallelism

These hot files have one serial owner during integration. Parallel lane workers may not edit them:

- `adapters/storage/postgres/migrations/meta/_journal.json`
- `adapters/storage/postgres/src/schema/index.ts`
- `packages/contracts/src/index.ts`
- `apps/api/src/main.ts`
- `apps/api/src/server.ts`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/components/shell/frank-shell.tsx`
- `apps/web/src/components/shell/composer-bar.tsx`
- `infra/production/docker-compose.app.yml`
- `infra/production/docker-compose.harness.yml`
- `docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md`

Workers that need a hot-file change return a semantic patch description and tests. The coordinator reviews the requested deltas and assigns them to the serial hot-file integration worker.

The coordinator still does not author feature code. After parallel lane acceptance, assign one **serial hot-file integration worker** to implement the reviewed semantic deltas in these files, regenerate outputs, and add tests. The coordinator reviews that worker's diff and owns merge/release decisions. No parallel worker may run while the hot-file worker edits these paths.

### Dependency graph

```text
Phase 0: freeze and inventory
    |
Phase 1A API/runtime ----+
Phase 1B attachments ----+--> Phase 2 combined chat candidate
Phase 1C web composer ---+
                              |
Phase 3A Dashboard dry-run ---+
Phase 3B Night Watch dry-run -+--> Phase 4 protected acceptance
Phase 3C Graphify/other work --+
                                      |
Phase 5 chat-only cleanup and rebuild
                                      |
Phase 6 exact-artifact production cutover
                                      |
Phase 7 production acceptance
                                      |
Phase 8 chat-owned runtime/worktree cleanup and downstream handoff
```

## 6. Phase 0 — Freeze, preview, and build the chat gap register

Mode: three read-only workers in parallel, then coordinator integration.

### Worker 0A — chat requirements and reachable inputs

1. Enumerate every chat requirement and acceptance scenario in `docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` and the requirements registry.
2. Enumerate every reachable conversational input, including room chat, shell composer, central chat, workbench/explorer chat-like commands, tidy flows, and dynamic routes.
3. Trace each input to the shared composer, BFF, Fastify route, turn store, runner, broker, adapter, and receipt.
4. Mark each row `implemented`, `missing`, `duplicate`, `legacy`, or `unverified`.
5. Include exact file/symbol, route, test, preview path, and protected runtime evidence.

Output: `docs/evidence/chat-release/chat-requirements-register.json`.

### Worker 0B — chat legacy candidates

1. Find static imports, dynamic imports, route reachability, stories, tests, scripts, and runtime traces for every old chat implementation.
2. Start with, but do not assume deletion of:
   - `apps/web/src/lib/harness-session.ts`;
   - `apps/web/src/lib/providers.ts`;
   - `apps/web/src/lib/goose-server.ts`;
   - `apps/web/src/lib/letta-server.ts`;
   - model-execution logic under `apps/web/src/app/api/chat/route.ts`;
   - process-local session, route, rate-limit, persona, and DeepSeek history maps;
   - direct DeepSeek-as-harness code;
   - duplicate composer, room, thread, frame, and text-only streaming variants;
   - legacy model aliases and compatibility flags.
3. Identify non-chat callers that must migrate before a file is deletable. In particular, check explorer/tidy callers before removing `goose-server.ts`.
4. Classify exact chat-specific docs, runbooks, Compose overlays, preview paths, and release processes that become obsolete.

Output: `docs/evidence/chat-release/chat-deletion-register.json`.

### Worker 0C — current-work compatibility inventory

1. Enumerate every registered worktree, remotely published active packet, integration-monitor handoff, reserved migration, and shared-file overlap.
2. At minimum cover Dashboard/API/UI/Lake, Night Watch, Graphify, Channels, Files/Folder work, Workbench, and any branch touching a chat hot file.
3. Ask each originating task/owner for its sole current accepted packet; reject superseded handoffs.
4. Verify the current packet's full SHA and complete range resolve from a fresh clone. A local object or abbreviated SHA is insufficient.
5. Record each packet's full SHA, remote ref, merge-base, commit range, changed files, migration range, storage identity/bucket ownership, contract imports, package dependencies, and shell registrations.
6. Record a supersession map from every historical anchor in Section 3 to the current accepted input.
7. Mark whether chat owns the shared contract or the downstream workstream owns it.
8. Do not change any packet.

Output: `docs/evidence/chat-release/ongoing-work-compatibility-register.json`.

### Coordinator integration and exit

1. Update `https://preview.frank.fail/wave2-conversation-composer-v1/` from the exact current chat head before feature edits.
2. Combine the registers into an exclusive path-ownership map for Phase 1.
3. Reject any missing chat requirement or unowned collision.

Exit criteria:

- every chat requirement and reachable input has an owner and acceptance test;
- every proposed deletion has a replacement and proof requirements;
- every current workstream has a compatibility row and fresh-clone-resolvable input;
- the current accepted input for Dashboard/Lake, Night Watch, Graphify, and every other hot-file workstream resolves from a fresh clone; missing owner input is a hard stop before Phase 3, not a waivable documentation gap;
- preview returns HTTP 200 and its asset hash is recorded;
- production is unchanged.

## 7. Phase 1 — Complete chat in three parallel lanes

Mode: three non-overlapping implementation workers, followed by coordinator integration.

### Lane 1A — Fastify, broker, harnesses, and model gateway

Owned files: chat-turn routes, stores, runner, provider planning, Goose `AgentHarnessAdapter` bridge, and focused tests. No web composer, attachment lifecycle, migration, production Compose, or downstream files.

Tasks:

1. Prove submit, status, SSE resume, and cancel use central authentication, cell scope, idempotency, and durable PostgreSQL records.
2. Prove the runner genuinely invokes kernel `HarnessBroker`.
3. Prove messages, events, checkpoints, attempts, terminal state, cancellation receipts, and usage/cost confidence survive restart.
4. Serialize event cursors and handle cancel/complete races without gaps or duplicates.
5. Bound shutdown and deterministic startup recovery.
6. Implement/verify `Auto`, `Deep`, `Vision`, and `Image` capability routing.
7. Record every selected, failed, cooled-down, and succeeded upstream attempt.
8. Make cooldown affect only the failing upstream.
9. Prefer configured healthy direct OpenAI/Gemini through Model Broker `RouteLease` records. On failure, return to the broker for a newly recorded Concentrate lease. LiteLLM must never switch provider, account, or model itself; keep DeepSeek behind the gateway.
10. Expose provider balance only from official endpoints; otherwise report Frank usage/budget and `provider balance unavailable`.
11. Keep Goose default, Hermes capability-isolated, and Letta manual-only.
12. Add behavioral tests with fake adapters and real route/store fixtures.

Exit: exact-head hosted checks pass; tests prove routing, fallback, receipts, cancel, restart, and shutdown; no Next execution; no P0/P1.

### Lane 1B — attachment storage, security, extraction, and sources

Owned files: attachment services, adapters, workers, routes, extractors, tests, and private canaries. No shared composer, chat runner, migration, production hot file, or downstream files.

Tasks:

1. Verify authorize, renew, gate, hook, status, cancel, cleanup, and authenticated Range download.
2. Bind capabilities to owner, cell, conversation, draft, size, expiry, and allowed metadata.
3. Enforce 2 GiB/file, 10 GiB/message, 10,000 files/message, 50 GiB pool, and real 30 GiB host-free refusal.
4. Keep tusd, promoter, and downloader identities distinct.
5. Prove 24-hour expiry, bounded cleanup, tusd 404 handling, and quota release.
6. Scan every completed upload before promotion.
7. Reject executables, encrypted archives, traversal, MIME mismatch, decompression bombs, and oversized expansion.
8. Complete bounded text/code, PDF, DOCX/structured, image/thumbnail/vision, and unsupported-format extractors.
9. Never expand archives automatically into context.
10. Use canonical source references rather than prompt bytes.
11. Re-run disposable protocol/EICAR/zero-residue canaries.

Exit: exact-head hosted and protocol/security/extraction evidence pass; identities remain scoped; no P0/P1.

### Lane 1C — shared rich composer, browser recovery, and BFF

Owned files: web composer components, upload/chat adapters, BFF proxy routes, runtime capability route, guard, tests, and preview. Package/lock changes stay isolated for coordinator reconciliation.

Tasks:

1. Use one shared composer in every reachable chat input.
2. Support plus-button file/directory pickers, clipboard items, mixed drag/drop, and nested relative paths.
3. Use Uppy/tus with exact server-returned headers and metadata.
4. Pause/resume across connection loss and browser restart.
5. Poll by `upload_id`; emit `attachment_id` only after clean materialization.
6. Render a compact/virtualized 10,000-file manifest.
7. Rotate draft IDs and clear the right manifest after success.
8. Submit canonical snake_case `ChatTurnInput` to `/v1/chat/turns`.
9. Relay Fastify SSE through an authenticated BFF without creating events or canonical state.
10. Hide attachments when runtime capability is off.
11. Run the standalone-textarea guard in the normal build.
12. Preserve model selectors and receipt cards, bound to durable records.
13. Test keyboard access, focus, removal, retry, errors, and large manifests.
14. Update the public preview after every accepted UI change.

Exit: frozen install, typecheck, all web tests, guarded build, secret scan, preview HTTP/assets, no standalone reachable textarea, no P0/P1.

## 8. Phase 2 — Integrate the completed chat candidate

Mode: serial coordinator plus one serial hot-file integration worker. The coordinator reviews and directs; the worker authors any required hot-file reconciliation.

1. Replay the three accepted lane ranges onto latest exact `main` once.
2. Preserve Graphify and unrelated work.
3. Regenerate shared indexes and `pnpm-lock.yaml`; never copy from an old base.
4. Reconcile only Section 5 hot files.
5. Confirm migrations exactly `0011` through `0013` and no `0014+`.
6. Compare actual changed files with manifests.
7. Run independent P0/P1 review.
8. Run hosted verify, secret scan, contracts, web build, and disposable PostgreSQL apply/restart/ledger proof.
9. Publish a protected combined candidate and update preview.

Exit: clean pushed branch, all checks, hashes/receipts, no downstream edits/merges, no P0/P1.

## 9. Phase 3 — Prove compatibility with current work

Mode: Worker 3A and Worker 3C may run in parallel. Worker 3B starts only after 3A publishes its exact disposable integrated head. All work uses disposable branches/namespaces and remains no-merge.

### Worker 3A — Dashboard and Lake dry-run

1. Start from exact combined chat candidate.
2. Replay full Dashboard API, UI, and Lake ranges in intended order without changing frozen branches.
3. Regenerate journal/schema/index/lock/shell files from the new base.
4. Prove `0014_project_dashboard.sql` is the only Dashboard migration and has no `room_id_cell_uidx`.
5. Prove chat and Dashboard dependencies and shell registrations coexist.
6. Prove Lake consumes object/source seams without upload lifecycle ownership.
7. Prove attachment/Lake identities mutually deny buckets.
8. Run hosted verify/build, PostgreSQL `0000`–`0014`, and permission tests.

Return a no-merge head, conflict manifest, receipts, and Dashboard-owner rebase instructions.

### Worker 3B — Night Watch dry-run

1. Start from Worker 3A's disposable integrated head.
2. Replay full Night Watch packet for compatibility only.
3. Canonical `SourceRef.version?: string` wins; normalize numeric legacy revisions at the boundary.
4. Preserve the typed Hermes browser-research job seam, server identity, bounded tools, and egress policy.
5. Prove no competing source type, harness API, storage/secrets/policy ownership, or shell registration.
6. Keep `0015_night_watch.sql` reserved and absent.
7. Regenerate disposable shared indexes and run hosted checks.

Return a no-merge head, receipts, and Night Watch-owner rebase instructions. Do not implement or enable Night Watch.

### Worker 3C — Graphify and every other current hot-file packet

1. Run Graphify refresh/idempotency, graph validity/bounds, UID, egress, Compose, and runbook regression tests.
2. For each Phase 0C packet touching a chat hot file, create a synthetic merge-tree or disposable rebase proof.
3. Prove chat does not take Channels, Files, Workbench, Dashboard, Lake, or Night Watch ownership.
4. Return exact conflict resolutions to downstream owners.
5. Do not modify or merge ongoing branches.

Exit: all current work has green compatibility receipts; future migration order stays `0011`–`0013`, `0014`, `0015`; no packet changed; no P0/P1.

## 10. Phase 4 — Protected pre-cleanup chat acceptance

Mode: one immutable candidate; suites may run in parallel with unique fixtures.

### Required scenarios

- Picker, paste, drag/drop, nested directories, removal, retry, cancel, 10,000-file responsiveness.
- 2 GiB/file, 10 GiB/message, pool/disk refusal, draft expiry, network/browser restart resume.
- EICAR, MIME spoof, traversal, executable, encrypted archive, decompression bomb, cross-owner/cell/conversation, and bucket denial.
- Text/code, PDF, DOCX, image vision, thumbnail, and unsupported-format behavior.
- Text and real attachment turns, source use, SSE resume, cancel race, web/API restart, route persistence, ordered tool/artifact/citation/approval/usage/error/terminal events.
- Auto/Deep/Vision/Image; one cheapest configured direct call; one controlled Concentrate fallback; Goose eligibility; Hermes isolation; Letta manual-only; model/request/token/cost/fallback/hash reconciliation; no invented balance.
- A failed direct `RouteLease` returns to the Model Broker, the replacement Concentrate lease is durably recorded, and LiteLLM performs no gateway-native cross-upstream fallback.
- Phase 3 dry-run suites, Graphify authenticated smoke, and unrelated route regression.

### Identity rule

- provision a protected pre-cleanup candidate from the exact Phase 2 source SHA and immutable digests;
- bind this proof to that exact source commit, image digests, config hashes, migrations, and sealed evidence;
- any source/generated/config/migration/image change invalidates acceptance;
- retain the candidate evidence through Phase 5 so cleanup can prove each replacement before deletion;
- this phase may sign only `CHAT_PRECLEANUP_ACCEPTED.receipt`; it cannot authorize production.

Exit: immutable receipts for every scenario, exact-artifact checks green, compatibility green, zero P0/P1, signed `CHAT_PRECLEANUP_ACCEPTED.receipt`. Production remains unchanged.

## 11. Phase 5 — Delete legacy chat paths and produce the final main release

Mode: parallel proof collection, then one serial cleanup owner. No production mutation.

### Every deletion requires

1. exact path/ID and chat ownership;
2. accepted replacement and receipt;
3. static/dynamic import and route trace;
4. story/test/build/script search;
5. downstream dry-run compatibility search;
6. rollback independence;
7. immediate pre-delete recheck.

### Eligible source/docs/process classes

- process-local chat execution/session/history/routing maps;
- duplicate provider registries and old chat-provider interfaces;
- direct DeepSeek-as-harness behavior;
- old Next execution/streaming after BFF cutover;
- obsolete Goose/Letta web clients only after non-chat callers migrate;
- duplicate composer/room/thread/frame inputs;
- old aliases, flags, adapters, tests, and stories tied only to deleted paths;
- chat-specific stale handovers, claims, plans, preview procedures, Compose overlays, probes, scripts, workflows, dependencies, and generated outputs.

Do not delete general Frank or another workstream's code/docs/artifacts. Do not archive obsolete chat source; retain only path/hash/reason/replacement metadata.

### Rebuild, merge, and exact-artifact acceptance

1. Regenerate indexes, lockfile, OpenAPI, and requirements registry.
2. Run formatting, dead-export/dynamic-route checks, hosted verify, secret scan, and build.
3. Rerun Phase 3 compatibility.
4. Merge the cleaned candidate normally through a reviewed PR.
5. Require exact-main hosted verify and secret scan.
6. Build fresh immutable cleaned images/evidence from the exact merged main SHA.
7. Provision a fresh protected candidate using those exact SHA/digests/config hashes.
8. Rerun the entire Phase 4 scenario matrix and Phase 3 compatibility matrix on those exact final-main artifacts.
9. Treat `CHAT_PRECLEANUP_ACCEPTED.receipt` as replacement/deletion evidence only; it is not a release authorization.
10. Sign `CHAT_CANDIDATE_ACCEPTED.receipt` only after the exact merged-main artifacts pass every protected scenario and compatibility check.

Exit: no superseded chat path in active source, no non-chat alteration, cleaned artifacts fully accepted/compatible, reviewed deletion receipt, no P0/P1.

## 12. Phase 6 — Atomic production cutover

Mode: serial release owner on original VPS only.

Preconditions: exact cleaned accepted candidate, fresh main CI/security/signing, migrations only through `0013`, green compatibility, healthy production, heavy lane idle.

1. Run signed pre/post-pull capacity gates and pull exact accepted digests.
2. Enter a bounded normal-user chat write fence while allowing only a named, isolated acceptance principal and fixture namespace; drain/checkpoint every pre-fence turn and upload.
3. Snapshot PostgreSQL, Caddy, Compose, configs, prior digests, workbench state, attachment metadata, and completeness marker.
4. Restore snapshot into isolated DB and verify ledger/marker.
5. Verify required encrypted off-cell copy.
6. Keep prior Compose/config/digests pinned.
7. Apply `0011`–`0013` through canonical runner.
8. Start private gateway/storage/upload/scanner, then accepted API/web.
9. Perform no-build switch on `76.13.209.160`; no DNS change.
10. Keep normal users fenced through Phase 7 production acceptance and rollback closure. The isolated acceptance principal may access only its fixture owner/cell/conversation/object namespace. If the product cannot tolerate that bounded fence, prove schema backward compatibility and a bounded recovery/RPO procedure in Phase 4 before cutover; otherwise do not deploy.

Rollback on any migration, health, auth, upload, scan, chat, SSE, receipt, model, persistence, Graphify, or compatibility failure. Restore DB when required, prior Compose/config/digests, verify prior state, then reopen writes. Record bounded loss; never claim zero without proof.

Exit: exact accepted SHA/digests in production, basic switch smoke green, no rollback condition, and the fence remains in place for Phase 7.

## 13. Phase 7 — Production acceptance

Run every mutating production acceptance scenario only through the named isolated acceptance principal. Prove normal-user writes remain denied and acceptance fixtures cannot collide with, read, modify, or escape into user data. Through that principal, run authenticated health, picker, text attachment, image, scan/promotion/source/use/Range download, SSE resume, cancel/receipt, cheapest direct call, controlled fallback, aliases, harness isolation, Letta health, web/API restart persistence, route/config persistence, Graphify regression, downstream contract availability, and quiescence.

Finalize `CHAT_PRODUCTION_ACCEPTED.receipt` only after every check. Keep rollback open until then.

After the final receipt is complete, delete or quarantine every acceptance fixture by exact ID, prove no fixture residue or user-data mutation, close rollback, and remove the normal-user chat write fence. If any acceptance check fails, restore the verified snapshot/prior services before removing the fence.

Exit: production runs exact accepted chat release; all receipts, digests, requests, migration/storage/scanner/compatibility evidence recorded; rollback closed only after acceptance.

## 14. Phase 8 — Chat-owned runtime cleanup and downstream handoff

Mode: destructive serial cleanup only after production acceptance.

Eligible only with fresh proof: superseded chat candidate containers/images/networks/volumes, obsolete chat previews, old chat release directories/caches, rotated chat credentials, superseded chat worktrees/branches, exact chat temp/patch/tar/report files, and stale chat helpers/processes.

Never use broad deletion or global prune. Never delete current/rollback, downstream packets, final evidence, active credentials, or unattributed objects. Record pre/post identity and references.

Publish downstream compatibility packet with production chat SHA/digests, migration/schema hashes, canonical contract hashes, hot-file manifest, storage ownership, Dashboard/Night Watch rebase instructions, Graphify/other-work receipts, production URL, acceptance receipt, and chat deletion receipt.

Exit: no obsolete chat-owned active artifact; downstream refs intact/reachable; fresh-clone rebase possible; production healthy; canonical docs supersede this handover.

## 15. Standard worker prompt

```text
Read C:\Dev\Frank\AGENTS.md and the complete Frank chat handover before acting.
Use gpt-5.6-terra low. Work only in the assigned isolated codex/ worktree.
Do not use localhost. Update the hosted preview before feature edits and use hosted CI/private candidates.
Do not edit shared hot files or another workstream unless explicitly assigned.
Do not create migration 0014+, merge Dashboard/Night Watch, change Graphify behavior, or deploy production.
Only P0/P1 block. Push and run every required hosted/runtime gate before returning.
Return exact SHA, changed-file manifest, preview/check URLs, evidence hashes, compatibility verdict,
P0/P1, and cleanup proof. Do not stop at a status update.
```

## 16. Worker receipt

```json
{
  "phase": "phase/lane",
  "base_sha": "full SHA",
  "head_sha": "full SHA or null",
  "branch": "branch or read-only",
  "changed_files": ["exact/path"],
  "hosted_preview": "https://preview.frank.fail/...",
  "hosted_checks": [{"url": "https://...", "result": "pass|fail"}],
  "runtime_evidence": [{"path_or_url": "...", "sha256": "..."}],
  "compatibility": [{"workstream": "...", "result": "pass|fail", "receipt": "..."}],
  "p0": [], "p1": [], "p2": [],
  "cleanup": {"targets": [], "zero_residue_proof": "hash or not-applicable"},
  "next_dependency": "exact phase/commit"
}
```

## 17. Coordinator protocol and automatic failures

The coordinator verifies full SHAs/commit ranges, merge-base, changed-file ownership, independent P0/P1 review, serial hot-file reconciliation, regenerated outputs, exact-head CI/security, and production freeze until exact-artifact acceptance.

Fail the plan if an agent completes or edits another workstream, merges `0014/0015`, leaves Next execution/canonical state, treats DeepSeek as a harness or Letta as Auto, invents evidence/costs/balances, sends upload bytes through Fastify, gives API staging credentials, exposes private services, skips preview-first, deploys different artifacts, deletes without compatibility/rollback proof, uses broad cleanup, or calls chat complete before authenticated production acceptance.
