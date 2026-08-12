# Frank Complete Build, Production Cutover, and Legacy Eradication Handover

Status: committed execution handover on `origin/codex/chat-completion-handover`
Created: 2026-08-12
Canonical starting commit: `b5b338b1589454596130b30364f70d55cf34f644`
Merged change: PR `#73` from `codex/chat-release-candidate`
Current production: accepted Graphify release `fead0c4b9e3cae60038b54f999a5066d165f8a2b` on the original VPS `76.13.209.160`
Public preview: `https://preview.frank.fail/wave2-conversation-composer-v1/`
Production policy: **do not deploy the new Frank build until every product phase in this plan is complete and the protected full-stack acceptance suite is green.**

## 1. Objective

Finish the whole Frank application, validate it as one system, make one controlled production cutover on the original VPS, and then remove every superseded code path, document, process, flow, branch, preview, container, image, release directory, and owned working copy that is proven obsolete.

This is not a chat-only release. Chat is the first completed product slice, but the final production gate also requires:

- the complete rich chat experience;
- the API-owned durable harness and model gateway;
- Dashboard and Lake integration;
- Night Watch and Hermes browser-research integration;
- Graphify regression safety;
- the rest of Frank's reachable UI and API surfaces;
- one canonical set of current documentation and runbooks;
- proof-based deletion of all superseded implementations and operational flows.

No partial candidate is called "live." No phase may claim completion from code or CI alone when the phase requires hosted runtime evidence.

## 2. Non-negotiable rules

1. Use `gpt-5.6-terra` at low reasoning for implementation workers. The coordinator plans, assigns, reviews, integrates, and releases; the coordinator does not write feature code.
2. Use one isolated worktree and one `codex/` branch per worker. Never let two workers edit the same hot file.
3. Read the repository `AGENTS.md` before taking any action.
4. Before feature edits in every buildable phase/topic, deploy a secret-free hosted skeleton through `/srv/frank/infra/preview-deploy.sh`, record its public `preview.frank.fail/<topic>-vN/` URL, and update that URL throughout implementation. Candidate backends remain private; a static preview may use bounded fixtures while protected full-stack acceptance runs against the private candidate. Localhost and PR pages are not review surfaces. Every buildable phase receipt must include its preview URL.
5. Production stays on the currently accepted release until Phase 9.
6. Do not deploy to a new host and do not change DNS.
7. Do not apply a migration until its disposable PostgreSQL proof is green and its ordered predecessor is on main.
8. Do not create migrations outside the reserved order:
   - Harness: `0011` through `0013` only.
   - Dashboard: `0014_project_dashboard.sql` only.
   - Night Watch: `0015_night_watch.sql` only.
   - No `0016+` without a new coordination record.
9. PostgreSQL is canonical. Valkey is cache, cooldown, rate-limit, and event-fanout state only.
10. SeaweedFS is private. The API never receives the tusd staging credential. Attachment and Lake identities must mutually deny each other's buckets.
11. Do not invent provider balances, costs, model names, request IDs, attestations, or canary results.
12. Only P0 and P1 findings block a phase. Record P2 findings in the phase receipt; do not reopen them during accelerated integration.
13. The final cleanup deletes obsolete content. It does not archive copies of obsolete source or documentation. A deletion manifest may retain paths, hashes, and reasons, but not deleted content.
14. Never use a global prune, broad glob, unresolved environment variable, or recursive deletion against a workspace root, home directory, Docker root, or `/srv/frank` root.
15. Every destructive target must have an exact resolved path or object ID, ownership proof, reachability/reference proof, and a pre-delete recheck.

## 3. Known-good evidence at handover

### 3.1 Main and chat candidate

- PR `#73` is merged normally.
- Exact merged main: `b5b338b1589454596130b30364f70d55cf34f644`.
- Post-merge verify: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556679044` — passed.
- Post-merge secret scan: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556679032` — passed.
- Release artifacts run: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556797961` — passed.
- Release evidence artifact: `release-evidence-b5b338b1589454596130b30364f70d55cf34f644`, artifact ID `9126444110`, SHA-256 `0a11d59de482b2dab348a0d9f14e80b75571282feae476e9aaf4ce2d185b0ac0`, expiry `2026-11-10T02:25:07Z`.
- The stop boundary was confirmed without VPS access or any production mutation, migration, deployment, image switch, cleanup, or DNS action.

### 3.2 Chat and attachment evidence

- Final integrated chat candidate before merge: `6ba8c1839458672aad80608a451884942466d239`.
- Final rich composer implementation: `7b73909393911a329e1167b23cb5b5d9e2f18d81`.
- Final live backend implementation: `7e9f00e3590d32cffc23a7f3e6b80477935d09fd`.
- Combined hosted verify: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556403956` — passed.
- Combined secret scan: `https://github.com/stevenshelley58-afk/frank/actions/runs/31556403909` — passed.
- Private six-service canary implementation: `c541370f461bc661cfd9e55f66f2eeefe5d1d118`.
- Private canary evidence: `/srv/frank/evidence/wave1-canary-c541370`.
- Canary receipt manifest hash: `485d9ba9fe12ca4fb719af4c0f1249238e67be5b65694f8d65944f0c73bc62f5`.
- EICAR receipt hash: `69e0c2e7d77a1ce170454bfd98235116a42066de9272d8cd8beabb81a58ef65d`.
- Cleanup receipt hash: `d6b3ae253e28393d2ea94ef347c88896ddb4e24c8d6b2292b21a64f19e641236`.
- Empty residue proof hash: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Sealed evidence commit: `2854e88dc274c36b91380d40dc83761a638d8ac4`.
- Sealed manifest hash: `7f38f20b99b82500e5f50a1c787b1406399b6a28cb0dfb3ef6e3716375568d5c`.
- Upstream OCI provenance is recorded honestly as an approved, hash-bound exception where upstream attestations were unavailable. It is not recorded as verified.

### 3.3 Migration evidence

- `0011_harness_control_plane.sql`: `0e92bd3b3a8dcb9eb9ff474769e55632f65a0a4880cac94823f7e961d80a1b8d`.
- `0012_chat_turn_event.sql`: `af56221848894e95bcda02a9917b34093b108b7bd454a448033c7ba6e4556e3b`.
- `0013_attachment_object_lifecycle.sql`: `cccb94260bea2513b81ed588e2045bb583cf915ce02c61a2cb2d54189b34ad6d`.
- Disposable PostgreSQL proof applied `0000` through `0013` to an empty database, registered all 14 migrations, proved one `room_id_cell_uidx`, proved the required cross-cell foreign keys, and left zero residue.

### 3.4 Downstream frozen packets

- Dashboard API/`0014`: `db20ce85eab8e3f50a03d547ab338cb039d98282`.
- Dashboard UI: `d852e87176d707423f4f245da3b2b54f8c3465f6`.
- Dashboard Lake: `7a965c23bbfb41ff776a8b80522db80397dc8d46`.
- The Dashboard tips are durably published as `origin/codex/project-dashboard-api`, `origin/codex/project-dashboard-ui`, and `origin/codex/project-dashboard-lake`. Each tip represents its full commit range after merge-base `aa1b4c3fe30fe1e71c8bb7cceb3dacbc4fc0a74b`; never cherry-pick only the listed tip.
- Night Watch combined packet: `2e8544fd80eb569284e5b0d7f33cf68f30eed59e`.
- Night Watch execution handover: `origin/codex/night-watch-handover` at `cd666d3859e0309d75120966672256ab4020d579`, file `docs/plans/NIGHT_WATCH_PRODUCTION_HANDOVER.md`; its exact-head verify `31558124361` and secret scan `31558124429` passed.
- Night Watch component SHAs are recorded in the originating task; earlier Night Watch SHAs are superseded and must not be consumed.

## 4. Definition of complete

Frank is complete only when all of the following are true at the same exact production release SHA:

### Chat

- Every reachable conversational input uses the shared rich composer.
- Plus picker selects files and directories.
- Clipboard image/file paste works where the browser exposes items.
- Drag/drop preserves nested relative paths.
- Per-file limit is 2 GiB; per-message limits are 10 GiB and 10,000 files.
- Large manifests stay responsive and do not render 10,000 chips.
- Uploads resume after connection loss and browser restart.
- Only clean, materialized attachment IDs are submitted to a turn.
- Text, PDF, DOCX/structured documents, and images use bounded extractors; unsupported files remain downloadable and are labeled honestly.
- Malware, MIME spoofing, encrypted archives, path traversal, decompression bombs, and oversized expansion fail closed.
- Chat turns are submitted to Fastify, not executed in Next.
- SSE events resume without gaps or duplicates.
- Cancellation, restart recovery, fallback attempts, usage, and receipts are durable.
- `Auto`, `Deep`, `Vision`, and `Image` work as stable aliases.
- Goose is the default harness; Hermes is browser/research-only; Letta is manual-only.
- Direct OpenAI/Gemini routes are preferred only when configured and usable; Concentrate is the recorded fallback; DeepSeek is a gateway upstream, not a harness.

### Dashboard, Lake, Night Watch, and remaining Frank

- Dashboard API, UI, and Lake are integrated on `0014`, with OpenFGA restricted to Lake-local authorization.
- Lake identities cannot reach attachment buckets, and attachment identities cannot reach Lake buckets.
- Night Watch is integrated on `0015`, uses the canonical `SourceRef`, and submits Hermes browser-research jobs only through Frank's harness API.
- Graphify remains healthy with no duplicate/dangling graph regression.
- Tasks, Workbench, Repository Explorer, Memory, Room Files, Code Graph, Skills, Channels, Previews, and all other reachable navigation surfaces have an authenticated production smoke receipt.
- There is no hidden route or shell link to an incomplete or legacy implementation.

### Cleanup

- No process-local chat router, duplicate provider registry, DeepSeek-direct harness, duplicate composer, stale handover, stale plan, obsolete deployment script, obsolete preview, orphan candidate container/image, or superseded worktree remains in operator-controlled active systems.
- The only retained documentation is current canonical product, contract, security, operations, and acceptance documentation.
- The deletion manifest contains only target metadata and proof, not archived obsolete content.
- Literal deletion from third-party caches or copies outside operator control is never claimed. Owned GitHub history and local/VPS copies follow the explicit history-eradication phase below.

## 5. Agent topology and dependency graph

Use at most three workers plus one coordinator. Workers use `gpt-5.6-terra` low unless a phase explicitly says review.

```text
Phase 0: stopped-state receipt
    |
Phase 1: completeness and deletion inventories (four read-only lanes)
    |
Phase 2: private full candidate environment
    |
Phase 3: chat gap closure (three lanes) -----------+
    |                                             |
Phase 4: Dashboard/Lake integration               |
    |                                             |
Phase 5: Night Watch integration                  |
    |                                             |
Phase 6: remaining Frank completion (parallel) <--+
    |
Phase 7: legacy deletion candidate (parallel catalog, serial deletion)
    |
Phase 8: full protected acceptance
    |
Phase 9: fresh signed release and atomic production cutover
    |
Phase 10: production acceptance and rollback closure
    |
Phase 11: owned-copy and history eradication
    |
Phase 12: final authority and erasure receipt
```

The coordinator is the only agent allowed to update these hot files during integration:

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

Before each parallel phase, the coordinator records an exclusive path-ownership manifest. Workers must not modify a listed hot file; they return the required semantic delta instead. The coordinator sequentially replays accepted worker commits and then alone regenerates or edits all hot files.

## 6. Phase-by-phase execution

### Phase 0 — Freeze the current boundary

Mode: serial, read-only except this handover commit.

Tasks:

1. Confirm main is exactly `b5b338b1589454596130b30364f70d55cf34f644` or record the newer reviewed replacement.
2. Confirm release-artifacts run `31556797961` remains terminal `completed/success`.
3. Do not retrigger it and do not deploy its images.
4. Record exact main verify, secret scan, release-artifact, manifest, image, SBOM, provenance, and artifact URLs/hashes.
5. Verify the original VPS still runs the previously accepted production release and that no migration, Compose switch, new container, Caddy change, DNS change, or cleanup occurred.
6. Verify there is no active release/deploy process on the VPS or workstation.
7. From a fresh clone, verify every frozen packet with `git cat-file -e <full-sha>^{commit}` and verify the exact Dashboard remote tips with `git ls-remote`. Record each packet's merge-base and full commit range. Do not delete any packet worktree until this gate passes.

Exit criteria:

- a stopped-state receipt names the exact main SHA and terminal workflow results;
- production is unchanged and healthy;
- zero release/deploy processes are active;
- this plan is committed and pushed on `codex/chat-completion-handover`.

### Phase 1 — Build an authoritative completion and deletion inventory

Mode: four read-only assignments in two waves, with no more than three workers running concurrently. Start A, B, and C; start D only after one slot finishes. No deletion.

Worker A — authoritative requirements and reachable product inventory:

- treat `docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` and `docs/requirements/registry.json` as the exhaustive scope, then add every discovered navigation item, public route, API route, background worker, scheduled process, and provider/harness;
- trace each to its current implementation and hosted acceptance test;
- absence from navigation is `missing`, not out of scope;
- give every row its requirement ID/section, implementation paths, hosted acceptance ID, evidence location, and `complete`, `missing`, `legacy`, `duplicate`, or `unreachable` status;
- output `product-surface-inventory.json`.

Worker B — chat and provider legacy inventory:

- identify all imports and dynamic reachability for process-local chat sessions, provider registries, Goose/Letta web clients, direct DeepSeek execution, legacy aliases, duplicate BFF paths, and duplicate composers;
- begin with these candidates, but prove each before labeling it deletable:
  - `apps/web/src/lib/harness-session.ts`
  - `apps/web/src/lib/providers.ts`
  - `apps/web/src/lib/goose-server.ts`
  - `apps/web/src/lib/letta-server.ts`
  - execution logic inside `apps/web/src/app/api/chat/route.ts`
  - old `ChatProvider` interfaces and process-local route/session/history maps;
- output `legacy-code-candidates.json` with callers, runtime traces, tests, and replacement paths.

Worker C — documentation/process inventory:

- classify every README, plan, handover, research note, runbook, preview procedure, release script, workflow, and Compose overlay as canonical, needed evidence, superseded, or user artifact;
- include tracked and untracked candidates, but do not delete any user artifact in this phase;
- specifically check stale Slice-0 claims, ADR counts, external delivery-plan links, duplicate Letta research, dated execution status, `HANDOVER*.md`, old preview metadata, and superseded release scripts;
- output `legacy-doc-process-candidates.json`.

Worker D — owned-copy inventory:

- enumerate registered worktrees, local branches, remote branches, tags, GitHub Actions artifacts/caches, GHCR images, VPS release directories, backups, previews, containers, images, networks, volumes, and generated temp paths;
- attribute owner, exact path/ID, active references, rollback dependency, byte size, and deletion eligibility;
- output `owned-copy-inventory.json`.

Coordinator integration:

- combine the four inventories into `docs/evidence/final-build/completeness-register.json` and `docs/evidence/final-build/deletion-register.json`;
- reject any deletion entry without an exact replacement and zero-reference proof.

Exit criteria:

- every reachable surface has an owner and acceptance test;
- every proposed deletion has exact evidence;
- unknown/unowned items remain blocked, not guessed.

### Phase 2 — Create the protected full candidate environment

Mode: three parallel workers, isolated services only.

Worker A — database candidate:

- create a disposable PostgreSQL 17 database from a sanitized production schema/data snapshot;
- apply all currently accepted migrations in order through `0015` after Phases 4 and 5 supply them;
- before those phases, apply only through `0013` and expose the environment for chat tests;
- verify migration ledger hashes, constraints, restart persistence, and rollback behavior;
- prove repeatability and zero-residue cleanup in a uniquely named rehearsal namespace before exposing the stable candidate;
- create a separate immutable shared candidate namespace after rehearsal and do not destroy, recreate, or clean it while any downstream phase is active. Upgrade it from `0013` to `0014` in Phase 4 and to `0015` in Phase 5. Clean it only after Phase 8 evidence is sealed.

Worker B — storage/security candidate:

- start isolated SeaweedFS, tusd, ClamAV, and scoped credentials;
- use unique project names, networks, volumes, bucket names, and secrets;
- provide attachment staging, canonical objects, object previews, and future Lake-only buckets;
- prove initial mutual denial and cleanup using generated candidate credentials.

Worker C — runtime candidate:

- start candidate API/web/LiteLLM/Goose/Letta/Graphify/Workbench services from exact immutable digests;
- keep services private with no public Caddy route;
- use the sealed evidence manifest and exact config hashes;
- record health, entrypoint/cmd, UID, network, and volume receipts.

Exit criteria:

- candidate is complete enough for authenticated end-to-end testing;
- no candidate service uses production DB, buckets, credentials, networks, volumes, or public routes;
- the rehearsal/test namespace has verified zero residue; the immutable shared candidate remains intact while downstream phases use it.

### Phase 3 — Close every rich-chat gap

Mode: three parallel implementation workers on non-overlapping ownership, followed by one integration review.

Worker A — API/harness/model routing:

- verify Fastify owns submit/status/events/resume/cancel;
- verify the runner genuinely invokes `HarnessBroker` and Goose bridge;
- implement any missing provider transport, cooldown, fallback, receipt, or restart recovery behavior;
- verify aliases `Auto`, `Deep`, `Vision`, and `Image` route by capability;
- verify direct OpenAI/Gemini preference uses only configured usable routes;
- verify Concentrate fallback is recorded per attempt;
- verify Hermes is browser/research-only and Letta is manual-only;
- add behavioral tests, never source-string-only tests.

Worker B — attachment lifecycle and extraction:

- verify authorize/renew/gate/hook/status/cancel/download contracts;
- prove 24-hour expiry and bounded cleanup attempts;
- prove 50 GiB pool and 30 GiB host-free refusal using real `statfs` measurement;
- implement or complete bounded text/code, PDF, DOCX/structured-document, and image extractors;
- add thumbnail/vision source references without embedding original bytes in prompts;
- add archive/MIME/path/decompression security cases.

Worker C — rich composer and BFF:

- prove all reachable chat inputs use the shared composer;
- verify plus picker, file/folder picker, paste, drag/drop, relative paths, pause/resume, browser restart recovery, compact manifest, draft rotation, and attachment cleanup;
- make Next chat routes authenticated proxies only;
- verify runtime capability detection hides unavailable attachment controls;
- keep the standalone-textarea guard in the normal build.

Integration review:

- run repository reachability searches, route tests, contract validation, TypeScript, web build, and protected browser acceptance;
- reject any path that still executes a model or maintains canonical session state in Next.

Exit criteria:

- all chat acceptance scenarios in Section 4 are green in the private candidate;
- no known P0/P1 remains;
- the public static preview reflects the final composer UI.

### Phase 4 — Integrate Dashboard and Lake on migration 0014

Mode: serial integration after Phase 3, with parallel read-only review and hosted permission testing.

Starting packets:

- Dashboard API/`0014`: `db20ce85eab8e3f50a03d547ab338cb039d98282`.
- Dashboard UI: `d852e87176d707423f4f245da3b2b54f8c3465f6`.
- Lake: `7a965c23bbfb41ff776a8b80522db80397dc8d46`.

Tasks:

1. Rebase once onto the exact accepted chat main.
2. Regenerate the journal, Drizzle schema exports, contract index, lockfile, and shell registration; never copy stale generated files.
3. Ensure `0014` contains no `room_id_cell_uidx`; `0011` remains sole owner.
4. Keep OpenFGA private and Lake-local. It consumes Frank identity; it does not become an authentication or harness-policy plane.
5. Add Lake worker/query credentials only to Lake buckets.
6. Prove writer/read success, cross-role denial, cross-cell denial, and attachment-bucket denial.
7. Prove attachment promoter/downloader/tusd identities cannot reach Lake buckets.
8. Run a live disposable PostgreSQL forward-apply/restart test through `0014`.

Exit criteria:

- Dashboard and Lake are complete in the protected candidate;
- permission tests are green;
- migration and shared-file regeneration receipts are attached to the PR.

### Phase 5 — Integrate Night Watch on migration 0015

Mode: serial after Dashboard, with two parallel implementation lanes that do not share files.

Starting packet:

- combined accepted packet `2e8544fd80eb569284e5b0d7f33cf68f30eed59e`.
- read and follow the detailed Night Watch handover at `cd666d3859e0309d75120966672256ab4020d579` in addition to this orchestration plan; if the plans appear to conflict, the stricter dependency, safety, shadow-runtime, and acceptance gate wins and the coordinator records the resolution before coding.

Lane A — contracts/migration/runtime:

- rebase once after the accepted Dashboard commit;
- canonical Harness `SourceRef` wins: `version?: string`; normalize legacy numeric values at the boundary;
- prepare the reviewed SQL body for the reserved `0015_night_watch.sql` migration without creating the migration file or editing shared migration metadata;
- return the required `0015` semantic index changes without editing `_journal.json`, schema/contract indexes, API entrypoints, lockfiles, or shell files;
- implement the provider-specific read-only snapshot schema with exact URI/version/file/hash;
- submit only `POST /v1/harness/jobs` with `harness=hermes` and `task_type=browser-research`;
- use server-injected owner/cell identity, bounded tools, and allowlisted/public egress.

Lane B — protected runtime/preview:

- exercise job submit, status, resumable events, cancellation, evidence refs, receipt refs, and source freshness;
- keep actions and mutable policy out of snapshot data;
- preserve the existing Night Watch preview until the final replacement is accepted.

Exit criteria:

- `0015` applies after `0014` in disposable PostgreSQL;
- Night Watch has no direct Hermes, storage, secret, receipt, or policy-plane access;
- the real bounded executor and every required specialist are implemented; queue-only Hermes is not called live;
- the integrated protected candidate is demonstrably off-by-default and shadow-capable;
- exact hosted release-candidate runtime evidence is green. Seven shadow nights and the staging-owner canary occur in Phase 8; Phase 9 deploys Night Watch `off`; live mode is enabled only after Phase 10 production acceptance.
- after Lane A is accepted, the coordinator creates the sole `0015_night_watch.sql`, regenerates the journal and shared indexes on the integrated Dashboard head, and runs the ordered migration proof.

### Phase 6 — Complete the remaining Frank application

Mode: three parallel product lanes, derived from Phase 1 inventory. No lane may edit another lane's files.

Lane A — operate surfaces:

- Research Pipeline, Tasks, Workbench, approvals/waiting work, Channels, and recurrence;
- validate authenticated creation, state transitions, restart recovery, and error paths.

Lane B — knowledge surfaces:

- Repository Explorer, Memory, Room Files, Code Graph, Skills, attachment source references, and cross-cell isolation;
- verify Graphify bounded responses and refresh idempotency.

Lane C — delivery and project tools:

- Previews, project dashboards, template anatomy, release controls, health/status surfaces, and any route found in Phase 1 without current acceptance evidence.

Coordinator:

- remove feature flags that expose unfinished surfaces;
- require every visible navigation item to have an authenticated hosted acceptance receipt;
- do not hide failures by removing navigation unless the feature is explicitly deleted from the product specification.

Exit criteria:

- every requirements-registry record is implemented and accepted, or explicitly removed/deferred by a current user-authorized canonical-specification change; hiding or omitting navigation never satisfies a requirement;
- completeness register has no `missing`, `legacy`, `duplicate`, or `unverified` reachable surface;
- full protected candidate remains green after restart.

### Phase 7 — Delete superseded code, docs, processes, and flows

Mode: parallel proof collection, then serial repository and isolated-candidate deletion by one cleanup owner. This phase starts only after Phases 3 through 6 are accepted. It must not mutate any serving or rollback asset.

Pre-delete requirements for each target:

1. exact path/object ID;
2. replacement path and accepted runtime receipt;
3. static import/reference search;
4. dynamic route/navigation trace;
5. story/test/build reference search;
6. production candidate trace showing zero use;
7. rollback no longer depends on it;
8. owner and reviewer agree it is superseded.

Code deletion classes:

- process-local chat execution and session maps;
- duplicate provider/model routing and direct DeepSeek harness behavior;
- obsolete Goose/Letta web execution clients after all non-chat callers are migrated;
- duplicate composer/room/thread/frame inputs;
- old BFF streaming/execution paths;
- stale route flags, compatibility aliases, temporary adapters, and shadow-mode code after the final canonical path is proven;
- unused schema/types/tests/stories tied only to deleted paths.

Documentation/process deletion classes:

- stale handovers and correction handovers;
- obsolete build plans, dated execution status files, superseded research claims, duplicate Letta sections, stale external paths, and obsolete ADR indexes;
- obsolete preview/deploy procedures and superseded release scripts/workflows;
- old generated registry outputs after the canonical registry is regenerated;
- do not archive content. Retain only a path/hash/reason deletion receipt.

Infrastructure deletion classes:

- delete only Compose overlays, services, credentials, buckets, routes, scripts, previews, containers, images, networks, volumes, and caches proven to belong exclusively to the Phase 2 disposable candidate/rehearsal namespace;
- do not mutate the serving Compose project, production database, production or rollback buckets/credentials, Caddy, release directories, backups, current/rollback images or volumes, GitHub refs/artifacts/packages, registered worktrees, or accepted previews;
- active-system and owned external-copy deletion occurs only in Phase 11 after `PRODUCTION_ACCEPTED.receipt`;
- never touch a foreign or unattributed Docker object.

Repository hygiene:

- run formatting, generated-file regeneration, dependency pruning, dead-export analysis, dynamic-route scans, secret scan, and full verify;
- ensure no TODO, compatibility flag, or comments claim a removed path still exists;
- update the canonical product specification and runbook to describe only the surviving architecture.

Exit criteria:

- the candidate contains no proven obsolete implementation or documentation;
- all builds/tests and the full protected acceptance suite remain green;
- deletion register has a receipt for every removed target and no archived content.

Clean-root release repository gate:

1. Generate a clean-root repository from an exact manifest of the retained source and documentation after the Phase 7 deletion commit. Do not copy `.git`, obsolete content, uncontrolled working-tree files, or deletion targets.
2. Recreate CI, rulesets, environments, integrations, secret names, signing, and deployment metadata from reviewed configuration records.
3. Publish the clean-root repository under a temporary private release name and prove a fresh clone has every frozen/current packet still required for acceptance.
4. Treat the clean-root genesis commit as the final release SHA. Build, sign, and test Phase 8 artifacts from that commit only.
5. Keep the old canonical repository read-only but available until Phase 10 production acceptance; do not delete or rename either repository during Phase 8 or Phase 9.
6. If any source or retained-documentation change is required after clean-root creation, discard the temporary clean-root repository, apply and accept the correction in the Phase 7 source tree, and generate a new single-commit clean root. Never append corrective source commits to the clean-root repository.

### Phase 8 — Full protected acceptance

Mode: serial release candidate; browser, API, storage, security, and restart tests may execute in parallel against the same immutable candidate, but no test mutates shared fixtures without a unique namespace.

Required suites:

1. Chat interaction: picker, paste, drag/drop, nested directories, thumbnails, removal, retry, cancel.
2. Upload boundaries: 2 GiB, 10 GiB, 10,000 files, insufficient disk, pool exhaustion, draft expiry.
3. Resume: network loss, browser restart, API restart, tusd restart.
4. Security: EICAR, MIME spoof, path traversal, encrypted archive, decompression bomb, cross-owner, cross-cell, attachment/Lake mutual denial.
5. Extraction: text/code, PDF, DOCX, image vision, unsupported format labeling.
6. Chat runtime: submit, SSE disconnect/resume, cancellation race, restart recovery, tool/artifact/citation/approval events.
7. Routing: Auto, Deep, Vision, Image; direct credential use; quota/auth/cooldown fallback to Concentrate; attempt and receipt reconciliation.
8. Harnesses: Goose default, Hermes browser task, Letta manual-only and truthful health.
9. Dashboard/Lake: complete UI/API flow and authorization matrix.
10. Night Watch: scheduled job, source check, snapshot, evidence, receipt, cancel/resume.
11. Graphify: refresh, bounded graph, no duplicate/dangling/self edges, UID and egress policy.
12. Remaining Frank: every item in the completeness register.
13. Upgrade/rollback: candidate/current/rollback promotion without state loss.
14. Quiescence: no restarts, stuck jobs, queued leakage, duplicate events, or unexpected publications during the observation window.
15. Night Watch: complete the seven shadow nights and staging-owner canary required by `NIGHT_WATCH_PRODUCTION_HANDOVER.md`; retain immutable receipts and keep live mode disabled.

Artifact identity rule:

- after the final integration/cleanup merge and clean release build, provision a fresh protected candidate using the exact main SHA, image digests, configuration hashes, migration set, and manifest intended for production;
- run this complete matrix against those exact artifacts and bind `FULL_CANDIDATE_ACCEPTED.receipt` to them;
- any subsequent source, generated file, configuration, migration, manifest, or image change invalidates the receipt and returns execution to this phase;
- cleanup rehearsal uses a separate namespace; retain the accepted candidate until cutover or rollback preparation is complete.

Exit criteria:

- every scenario has an immutable release SHA, timestamp, request IDs, receipt paths, and expected/actual result;
- zero P0/P1;
- the rehearsal/test namespace has verified zero residue; the immutable accepted candidate remains intact until production cutover or rollback preparation no longer requires it;
- coordinator signs `FULL_CANDIDATE_ACCEPTED.receipt`.

### Phase 9 — Produce a fresh clean release and cut over production

Mode: serial release owner only.

1. Cut over only the exact clean-root SHA/digests already accepted and signed in Phase 8. PR #73 artifacts are not deployable after later integration or cleanup changes.
2. Run the signed pre-pull and post-pull capacity gates on the original VPS.
3. Enter a bounded write fence and drain in-flight jobs before the final database snapshot.
4. Create a complete rollback snapshot containing database, Caddy, Compose, configuration hashes, prior image references, workbench state, and a completeness marker.
5. Verify the snapshot by restoring it into an isolated database and checking its completeness marker and migration ledger.
6. Create and verify an encrypted off-cell copy if the release runbook requires it.
7. Keep the previous Compose/configuration and image digests pinned.
8. Apply migrations in exact order through `0015`, start the private harness/storage/scanner services, deploy Night Watch explicitly `off`, and perform the exact no-build switch on `76.13.209.160`.
9. Keep the write fence until deep acceptance succeeds. On rollback, stop new services; restore the verified database snapshot when schema compatibility requires it; restore prior Compose/configuration and exact digests; verify state and authentication; then reopen writes.
10. Record the maximum bounded write-loss window; never claim zero state loss without proof.
11. Do not change DNS.

Automatic rollback conditions:

- any migration failure;
- any unhealthy required service;
- public live/ready/auth failure;
- chat attachment or real turn failure;
- Dashboard, Lake, Night Watch, Graphify, or remaining-surface acceptance failure;
- receipt/model mismatch;
- storage authorization failure;
- scanner failure;
- state persistence failure after restart.

Exit criteria:

- production runs the exact fresh cleaned SHA and digests;
- basic and deep authenticated acceptance is green;
- no rollback condition fired.

### Phase 10 — Production acceptance and rollback closure

Mode: serial acceptance owner, with parallel read-only observers.

1. Repeat the full acceptance matrix using production-authenticated routes and bounded real provider calls.
2. Run one real attachment turn using a small text file and image.
3. Run one direct-provider turn and one controlled fallback turn if the corresponding credentials are configured.
4. If provider balance endpoints are unavailable, record `provider balance unavailable`; use Frank-metered usage and configured budgets.
5. Restart web and API; prove routes, conversation, attachment, events, receipts, Dashboard state, Night Watch state, and Graphify state persist.
6. Observe a quiescence window with zero unexpected restarts, jobs, errors, or duplicate events.
7. Write a draft pre-live acceptance record with SHA, digests, URLs, request IDs, storage/scanner receipts, migration ledger, and rollback pointer. It is not `PRODUCTION_ACCEPTED.receipt` and does not close rollback.
8. Enable Night Watch live mode through its reviewed promotion control and run the live-mode acceptance/quiescence checks from `NIGHT_WATCH_PRODUCTION_HANDOVER.md`. Any failure keeps Phase 10 incomplete, disables Night Watch, and invokes the documented rollback without weakening the rest of Frank's acceptance boundary.
9. Only after the Night Watch live checks and every other production check pass, finalize `PRODUCTION_ACCEPTED.receipt` and close rollback.

Exit criteria:

- `https://frank.fail/` is authenticated and healthy on the exact final SHA;
- all product acceptance scenarios pass;
- rollback is closed only after the receipt is complete.

### Phase 11 — Eradicate owned obsolete copies and history

Mode: serial and destructive. Start only after Phase 10 production acceptance and a fresh read-only inventory recheck.

Reapply every Phase 7 pre-delete requirement immediately before every deletion. Hard-deny deletion of the canonical repository/default branch, final production SHA/digests, current Compose/configuration, final acceptance evidence, required recovery backup, active credentials, and every unattributed object. For each target, record exact resolved identity, pre-delete state, deletion result, post-delete absence check, and recovery/retention classification. Abort only that target if its identity or references changed; never broaden the deletion expression.

Active-system eradication:

- delete exact superseded VPS release directories, candidate directories, previews, containers, images, networks, volumes, and obsolete config files;
- delete obsolete local registered worktrees and their branches only after confirming their commits are merged or explicitly superseded;
- delete superseded remote branches, tags, Actions artifacts/caches, GHCR images, and release artifacts;
- delete obsolete local temp/patch/tar files and generated preview directories after exact ownership proof;
- remove stale deployment hooks and background processes;
- rotate credentials that belonged only to deleted flows.

Owned-history eradication for the literal "do not save old code/docs" requirement:

The clean-root repository must be created **before Phase 8**, after Phase 7 repository cleanup. Create it from an exact manifest of the final retained source tree and current documentation, excluding `.git`, obsolete paths, and uncontrolled working-tree files. Configure and verify its CI, rulesets, environments, integrations, secrets, signing, and deployment metadata. Its genesis commit becomes the only final release SHA; build the Phase 8 candidate and Phase 9 production images from that exact commit. Do not create another source commit during repository rename.

After Phase 10 acceptance:

1. Freeze the old GitHub repository; delete its branches, tags, releases, packages, artifacts, and caches; then delete the old repository.
2. Rename the already-accepted clean-root repository to the canonical Frank repository and update trusted remotes/deploy metadata without changing source.
3. Replace local and VPS clones with clean-root clones after verifying exact remote identity and accepted commit.
4. Delete the old local `.git` object store, registered superseded worktrees, and old VPS repository clone by exact resolved path.
5. Re-run the owned-copy inventory and prove no actively accessible operator-controlled copy contains a deleted path or old Git object.

Important truth boundary:

- Deleting/recreating the owned repository is required for best-effort active removal of old Git history and PR diffs.
- It cannot prove immediate backend erasure or erasure from restorable provider state, third-party forks, caches, backups, screenshots, or systems outside operator control. The final receipt must state this limitation and must not claim universal erasure.

Exit criteria:

- no obsolete content remains in operator-controlled active source, Git history, VPS, workstation, GitHub repository, GHCR, previews, or release storage;
- the clean canonical repository and production remain healthy;
- the deletion manifest contains metadata only.

### Phase 12 — Final authority receipt

Mode: serial, documentation-only.

Retain exactly these authority classes:

- current product specification;
- current contract/schema references;
- current security and storage boundaries;
- current operations/release/rollback runbook;
- current architecture decisions that still apply;
- final production acceptance receipt;
- final deletion/erasure receipt containing path/hash/reason metadata only.

Delete superseded planning and handover documents after their tasks are incorporated into the canonical documents. This handover itself is deleted after Phase 12 is complete and the canonical final runbook contains all surviving instructions.

Exit criteria:

- no contradictory authority remains;
- documentation describes the deployed system exactly;
- final receipt links the production URL, exact SHA/digests, acceptance evidence, cleanup evidence, and the stated erasure limitation.

## 7. Standard worker protocol

Every worker receives this header verbatim:

```text
Read C:\Dev\Frank\AGENTS.md and the full handover plan before acting.
Use gpt-5.6-terra low. Work only in the assigned isolated worktree and branch.
Do not use localhost. Push changes and use hosted CI/private candidate tests.
Do not edit shared hot files unless the assignment explicitly grants ownership.
Do not touch Dashboard, Night Watch, migrations, production, or cleanup targets outside your phase.
Only P0/P1 block. Do not claim success without exact SHA, changed-file manifest,
hosted URLs, hashes, and cleanup/residue proof. Continue until the phase exit criteria
are met or a genuinely external blocker is demonstrated with exact evidence.
```

Every worker returns this receipt shape:

```json
{
  "phase": "number/name",
  "base_sha": "full SHA",
  "head_sha": "full SHA or null for read-only",
  "branch": "branch or read-only",
  "changed_files": ["exact/path"],
  "hosted_checks": [{"url": "https://...", "result": "pass|fail"}],
  "runtime_evidence": [{"path_or_url": "...", "sha256": "..."}],
  "p0": [],
  "p1": [],
  "p2": [],
  "cleanup": {"targets": [], "zero_residue_proof": "hash or not-applicable"},
  "next_dependency": "exact phase/commit"
}
```

## 8. Coordinator integration protocol

1. Accept only full SHAs, never abbreviated handoffs.
2. Confirm each worker branch has the declared merge-base.
3. Compare the actual changed-file list with the worker manifest.
4. Reject scope creep and shared-file edits outside ownership.
5. Run an independent P0/P1 review on the exact head.
6. Merge in dependency order only.
7. Regenerate shared indexes and lockfiles after replay; never copy them from an old base.
8. Require exact-head hosted verify and secret scan after every integration merge.
9. Update the completeness/deletion registers after each accepted phase.
10. Never treat a preview, branch, isolated canary, or green unit test as production acceptance.

## 9. Plan mutation protocol

If new facts require changing this plan:

1. Stop only the affected phase; independent lanes may continue.
2. Record the failing invariant and evidence.
3. Add or split the smallest possible step.
4. Preserve migration reservations and shared-file ownership.
5. Re-run dependency analysis.
6. Commit the plan change on a dedicated branch and obtain one independent review.
7. Do not create competing handover files. This file remains the single execution plan until Phase 12 deletes it.

## 10. Anti-patterns that automatically fail the handover

- deploying PR #73 merely because its CI is green;
- calling chat complete while Dashboard, Night Watch, or another reachable Frank surface is unfinished;
- allowing Next to execute models or hold canonical chat state;
- treating DeepSeek as a harness;
- making Letta Auto-eligible;
- displaying invented provider credit balances or costs;
- uploading file bytes through Fastify body parsing;
- giving the API the tusd staging credential;
- exposing SeaweedFS, tusd, ClamAV, LiteLLM, Hermes, Letta, or OpenFGA publicly;
- duplicating object stores or identity authorities;
- merging `0014` or `0015` out of order;
- copying stale migration journals, schema indexes, contract indexes, lockfiles, or shell files across bases;
- deleting a path because it "looks old" without static, dynamic, hosted, and rollback proof;
- retaining obsolete source in an archive after the deletion phase;
- using global Docker prune or deleting unattributed volumes/images;
- claiming universal erasure outside systems under operator control;
- stopping after a code fix without running its hosted/runtime gate;
- accepting a status update as a completion receipt.
