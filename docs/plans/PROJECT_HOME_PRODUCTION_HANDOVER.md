# Frank Project Home, Modular Widgets and Lakehouse — Production Completion Handover

**Status:** execution-ready handover; no partial production release permitted

**Plan base:** `b5b338b1589454596130b30364f70d55cf34f644`

**Target production:** the existing Frank cell on `76.13.209.160`

**Public completion condition:** the complete project-home system, chat platform, widget runtime, Night Watch provider, lakehouse, legacy retirement and production acceptance all pass together
**Audience:** implementation agents with no prior conversation context

## 1. Mission

Finish Frank as one production system in which every project has a shared, live, modular home dashboard inside the existing chat shell. The dashboard must show the most useful project facts and actions without creating parallel state stores, schedulers, memories, attachment systems, graph extractors or connector control planes.

This is not a preview-only delivery. The task finishes only when the exact reviewed release is live on the existing production VPS, authenticated acceptance passes, the old superseded runtime is removed from the active system, and a signed production receipt identifies the running images and database state.

The final system must include:

- One project home per durable Frank room.
- One shared published layout per project; Steven is the only layout editor in v1.
- Modular, self-contained widgets with versioned manifests, isolated failures, validated configuration and live freshness.
- Durable layout revisions, optimistic concurrency and restart persistence.
- One resumable dashboard event stream per dashboard.
- Server-issued actions with permission, confirmation, idempotency and receipt enforcement.
- Default widgets for project status, live application, approvals, running work, chats, todos, Git state, CodeGraph, receipts, Night Watch and data health.
- PostgreSQL for operational truth.
- SeaweedFS for canonical objects and immutable source payloads.
- Apache Iceberg and Lakekeeper for long-term history.
- DuckDB for bounded historical queries.
- Frank memory as a rebuildable projection, never a second canonical data store.
- The already-built rich chat, attachment, model-broker and Graphify capabilities integrated rather than duplicated.
- Complete removal of superseded active code, docs, services, flows, schedules, images, preview artifacts and configuration after replacements pass.

## 2. Non-negotiable rules

Every agent must apply these rules before touching a file.

1. Do not promote any partial release to production.
2. Do not edit the user-owned checkout at `C:\Dev\Frank`. Use a dedicated worktree and `codex/` branch.
3. Do not overwrite another agent's worktree or branch.
4. One agent owns each shared hot file at a time.
5. Do not create another project entity. A project profile is one-to-one with the durable room.
6. Do not create another attachment/object lifecycle. Consume `schema://frank.object-manifest/v1` by `object_id`, digest and `source_ref` only.
7. Do not create another CodeGraph extractor. Consume the production Graphify/CodeGraph APIs.
8. Do not create another scheduler. Use the canonical Frank work queue now and the existing Temporal seam when it lands.
9. Do not create another memory authority. PostgreSQL/object storage remain canonical; semantic and graph memories are projections.
10. Do not let widgets call connectors, object storage or Iceberg directly.
11. Do not expose arbitrary DuckDB SQL, S3 credentials, connector credentials or action policy fields to the browser.
12. Do not add remote JavaScript widgets in v1. All widgets are compiled, registered Frank modules.
13. Do not accept a green unit test as production evidence. Hosted integration, authenticated browser acceptance and restart persistence are mandatory.
14. Do not weaken a safety limit to make a gate pass.
15. Do not rewrite published Git history, delete canonical user data, or remove signed evidence under this plan. “Remove old code completely” means it must be absent from the active tree, deployed services, process managers, flows, schedules, images, preview sites and current documentation. A history purge requires a separately enumerated target because it invalidates release hashes and recovery evidence.
16. Do not delete a legacy target until its replacement is green, its consumers are migrated, a dependency scan returns zero live references, and the deletion manifest identifies its recovery consequence.

## 3. Authoritative checkpoint

### 3.1 Accepted production base

Graphify is accepted in production at:

- Commit: `fead0c4b9e3cae60038b54f999a5066d165f8a2b`
- Production host: `76.13.209.160`
- Acceptance receipt: `/srv/frank/release-evidence/20260811T223058Z/PRODUCTION_ACCEPTED.receipt`
- Receipt SHA-256: `90eeb23a8b98cf0adabc1abc585adafe07f27ba3286bd540359d6be045f08df6`

Graphify must remain functional through every later release. Never replace its project IDs, graph refresh workflow, safety bounds or BFF routes.

### 3.2 Merged chat/harness checkpoint

The rich chat, attachment, gateway and broker candidate is merged on main at:

- Main: `b5b338b1589454596130b30364f70d55cf34f644`
- Merge: PR #73 from `codex/chat-release-candidate`
- Candidate source head: `6ba8c1839458672aad80608a451884942466d239`

At handover time, production was deliberately not switched to this main. The next executor must first read the chat release handover produced by the chat task and accept its post-merge CI, security scan, signatures and receipt. A failed or missing chat gate blocks every later phase; remediation must land on main and receive the same evidence before Phase 1. Do not rebuild or duplicate the chat work.

### 3.3 Frozen Dashboard packets

These packets are implementation inputs, not branches to merge blindly:

| Packet | Frozen head | Evidence summary |
|---|---|---|
| Widget contracts and migration 0014 | `80f91f7fe3f325a3ed47039a8c8e730e9b42c961` | contract validator green; provisional migration; no room composite-index DDL |
| Dashboard API/actions/SSE | `db20ce85eab8e3f50a03d547ab338cb039d98282` | hosted API typecheck; live PostgreSQL 366/366; permission suite 4/4 |
| Project-home UI | `d852e87176d707423f4f245da3b2b54f8c3465f6` | hosted web typecheck/build; focused tests; independent review GO |
| Lakehouse | `7a965c23bbfb41ff776a8b80522db80397dc8d46` | hosted full data path and cross-role/project/bucket denials GO |

Dashboard migration facts:

- Filename: `0014_project_dashboard.sql`
- SHA-256: `831946bfcc3db4e082a8764f0ecc897341e8731f916cf2f5c416695ffb27180a`
- Harness migration `0011` is the sole owner of `room_id_cell_uidx`.
- The final rebased `0014` must contain zero `CREATE ... room_id_cell_uidx` statements.

### 3.4 Frozen Night Watch packet

Only these Night Watch SHAs are authoritative:

- Contracts: `3e03b3c501f6e3359b016b08349a7e692e6edee6`
- Core: `28fc0c1edcd55dd7c89a385e23fa6d04f80097b8`
- Sources: `22dda8c050ae36453dbb15915797deffae0f679b`
- Evaluation: `69eab184c9ca417e314649e9015e38b39f31f7ae`
- Workflow: `569ffe6f6b8e61d4d393ba2ce749f63049f2853b`
- Combined verification head: `2e8544fd80eb569284e5b0d7f33cf68f30eed59e`
- Preview: `https://preview.frank.fail/night-watch-v1/`
- Production handover branch: `codex/night-watch-handover`
- Production handover commit: `cd666d3859e0309d75120966672256ab4020d579`
- Production handover file: `docs/plans/NIGHT_WATCH_PRODUCTION_HANDOVER.md`

Night Watch owns its provider-specific read-only `snapshot.data` schema. Dashboard owns the generic snapshot envelope and `availableActions`. Night Watch must not add `available_commands`, mutable action targets, action policy, another widget registry or shell edits. Its only migration is `0015_night_watch.sql`.

### 3.5 Canonical source reference

Harness canonical `SourceRef` wins:

```ts
type SourceRef = {
  kind: string;
  id: string;
  version?: string;
};
```

Legacy numeric versions may be accepted only at an input boundary and normalized to strings. Do not define a second `SourceRef` type.

## 4. Execution topology

Use a maximum of six implementation agents plus one release manager. More agents increase shared-file conflicts.

| Lane | Recommended model | Responsibility | Shared files it may own |
|---|---|---|---|
| R0 — release manager | strongest model, high reasoning | contracts, sequencing, reviews, integration, production decision | migration journal, contract index, schema index, lockfile, production manifests |
| A — contracts/database | cheap coding model; strongest review | rebase 0014, schema registry, validators, migrations | contracts index, schema index, migration journal while leased |
| B — API/live actions | medium model | project APIs, snapshots, actions, SSE, provider adapters | API routes/services only after A freezes contracts |
| C — project-home UI | cheap coding model | shell integration, responsive grid, editor, gallery, widget rendering | web shell and web package/lockfile while leased |
| D — lakehouse/storage | medium/strong model | Lakekeeper, Iceberg, DuckDB, worker, storage policy additions | lake directories; shared Seaweed policy only during its leased integration window |
| E — widgets/providers | cheap models, one per non-overlapping widget group | default widgets and provider adapters | widget-specific directories only |
| F — Night Watch | medium model | 0015, provider data, registry hookup | Night Watch files; migration journal only after Dashboard freeze |
| G — adversarial review/release | strongest model, high reasoning | P0/P1 review, security, deletion audit, production proof | no implementation files |

Parallelism rule: agents may run together only when their changed-file manifests have no overlap and neither consumes the other’s unfinished contract. If two lanes need the same index, manifest, migration journal, shell or lockfile, serialize them.

## 5. Phase 0 — Freeze, inventory and establish the integration base

### Agent brief

You are the release manager. Do not implement features. Establish one exact source base and prove what is already merged, what is frozen on branches, what is deployed and what remains active.

### Tasks

1. Read this file completely.
2. Read the chat task’s final handover and post-merge verification receipt.
3. Confirm `origin/main` contains `b5b338b1` or a direct reviewed successor.
4. List all worktrees and record each branch, HEAD, dirty state, purpose and owner.
5. Record exact production container IDs, image digests, health and public authenticated smoke before any change.
6. Inventory migrations `0000` through `0013`; recompute hashes and compare with the accepted Harness handoff.
7. Inventory the Dashboard and Night Watch frozen branches listed above.
8. Create an integration branch `codex/project-home-production-integration` from exact accepted main.
9. Deploy or update the public no-private-data skeleton at the existing project-dashboard preview URL before any feature edit; record its HTTP result and visible unavailable-data state.
10. Require each later build lane to update that same preview or its explicitly named live-backed preview before its first feature commit.
11. Create `docs/plans/PROJECT_HOME_EXECUTION_STATUS.md` with current phase, owner, branch, HEAD, changed-file lease, gate and result.
12. Create `docs/plans/PROJECT_HOME_MERGE_MANIFEST.md` listing every packet, source SHA, destination order and expected conflict hotspots.
13. Do not promote production.

### Verification

- Main ancestry proves Graphify and PR #73 are present.
- No source worktree is dirty except explicitly recorded user-owned work.
- No migration number above `0013` exists on integration base.
- Production baseline smoke is green and captured.
- The integration branch has no feature changes.

### Exit criteria

- Exact base SHA frozen.
- Chat post-merge CI, security, signatures and receipt accepted; no “recorded blocker” is permitted.
- Public preview deployed and exercised before feature work.
- Status and merge manifest committed.
- All shared-file leases empty.
- Production untouched.

## 6. Phase 1 — Reconcile project, widget and persistence contracts

### Dependencies

Phase 0 only. This phase is serial and owns every contract/migration hotspot.

### Agent brief

Reconstruct the accepted Dashboard contract packet on the current main. Do not cherry-pick shared indexes blindly. Harness canonical contracts and source references win. The output is the sole contract that every later lane consumes.

### Tasks

1. Create a worktree from the integration base and a branch `codex/project-home-contracts-integrated`.
2. Update the hosted project-dashboard preview with the contract/API-unavailable skeleton before the first feature commit and record the URL.
3. Compare frozen contract head `80f91f7...` against current main file by file.
4. Port the project-profile, widget manifest, layout, snapshot, event, action descriptor, action command and validation contracts.
5. Define two widget-manifest views: a browser-safe public manifest and a server-only binding containing permissions, capabilities, classifications, provider bindings, target rules and action policy. The public schema must not contain the server-only fields.
6. Replace any structural `SourceRef` with the canonical Harness exported type.
7. Preserve Harness object-manifest exports and chat/harness contracts in `packages/contracts/src/index.ts`.
8. Rebuild schema exports rather than accepting conflict markers by preference.
9. Regenerate `0014_project_dashboard.sql` after the current Drizzle schema is correct.
10. Ensure `0014` depends on but does not create `room_id_cell_uidx`.
11. Ensure the migration journal contains contiguous accepted entries `0000`–`0014` exactly once.
12. Retain: project profile, dashboard, immutable published revision, widget instance, placement, action descriptor/challenge/invocation/receipt and audit/outbox bindings.
13. Add an idempotent backfill that creates exactly one project profile, project-home dashboard and published capability-aware default layout for every eligible durable room; preserve existing room IDs, names, tints and icons.
14. Validate: maximum 25 widgets, responsive `compact`/`medium`/`wide` placements, project/cell/room/dashboard/surface identity, tombstones, immutable publication, optimistic versions and fail-closed action confirmation.
15. Add negative tests for cross-cell identities, malformed layouts, invalid widget count, action spoofing and wrong source reference versions.
16. Update execution status and merge manifest.

### Required hosted gates

- Contract TypeScript build.
- JSON Schema registry validates every schema and example.
- Disposable PostgreSQL 17 applies migrations `0000`–`0014` from empty state.
- Migration rerun is a no-op.
- `room_id_cell_uidx` exists once and only once, owned by `0011`.
- Every foreign key resolves.
- Backfill count reconciliation proves every eligible room has one profile, one project-home dashboard and one published layout, with zero duplicate or orphan rows; rerun changes zero rows.
- Contract and built-output scans prove server-only manifest fields cannot enter browser schemas or bundles.
- Rollback rehearsal restores the pre-0014 snapshot.
- Container, volume and temporary-file cleanup returns zero residue.

### Exit criteria

- One reviewed contract commit.
- Exact 0014 SHA-256 published.
- Full changed-file manifest published.
- Independent P0/P1 review GO.
- Contract branch frozen; later agents import it without modification.

## 7. Phase 2 — Dashboard API, actions and resumable live events

### Dependencies

Phase 1 accepted. May run in parallel with Phase 3 and Phase 4 after the frozen contract commit is available.

### Agent brief

Port the accepted API packet to the current contract. Use Frank’s existing auth, cell, capability, BFF, audit and outbox boundaries. Do not invent in-memory persistence or a second action executor.

### Required routes

- `GET /v1/projects`
- `GET /v1/projects/:projectId`
- `GET /v1/projects/:projectId/dashboard?surface=project-home`
- `PUT /v1/projects/:projectId/dashboard`
- `POST /v1/projects/:projectId/dashboard/reset`
- `GET /v1/widgets`
- `GET /v1/projects/:projectId/widgets/:instanceId`
- `POST /v1/actions`
- `GET /v1/actions/:actionId`
- `GET /v1/dashboard/events?project_id=...`

### Tasks

1. Port frozen head `db20ce85...` by semantic diff.
2. Update the hosted API preview before the first feature commit and record the URL/response.
3. Validate project, dashboard, cell, room, surface and widget-instance identities separately on every route.
4. Expose ETags and require `If-Match` for layout save/reset.
5. Persist immutable layout revisions; never use React or process memory as storage.
6. Return 409/412 on stale writes without modifying the published layout.
7. Use one dashboard SSE connection with outbox cursors.
8. Implement atomic snapshot/high-water capture, replay and live handoff with no gap or duplicate.
9. Reject malformed, expired, cross-cell, nonexistent and ahead-of-high-water cursors.
10. Register widget data providers; providers return typed snapshots, freshness, source references and server-issued available actions.
11. Return only the public widget manifest to the browser. Keep server-only policy/bindings inside the API process.
12. Resolve actions entirely server-side from persisted descriptors.
13. Bind descriptor, authenticated principal, cell, room, dashboard, widget instance, target version, permission, capability, confirmation and expiry.
14. Consume single-use challenges transactionally.
15. Guarantee one external effect for double-clicks, network retries and worker/API crashes around the external call.
16. Write invocation, canonical receipt, audit and outbox event atomically or reconcile an already-performed idempotent effect to exactly one canonical receipt.
17. Fail closed when a provider, permission resolver or executor is missing.
18. Connect canonical providers for chats, work items, missions/workbenches, receipts, repository status and live application health.

### Required hosted gates

- API and storage typechecks.
- Route schema/OpenAPI validation.
- Live PostgreSQL API integration tests.
- Separate capability and permission tests.
- Cross-cell, cross-room and wrong-widget denial tests.
- Idempotency and challenge replay tests.
- Crash injection immediately before dispatch, after external success/before receipt commit, and after receipt commit; every case must converge to one external effect and one canonical receipt.
- Browser/API response and built-bundle scans prove no server-only manifest policy, capability, permission, credential or mutable target leaks.
- SSE disconnect/resume/no-gap/no-duplicate tests.
- Process restart persistence test.
- Database rollback and zero-residue receipt.

### Exit criteria

- Hosted API preview responds honestly when no authenticated data is available.
- All routes are registered only when dependencies exist.
- Independent P0/P1 review GO.
- Exact commit and manifest frozen.

## 8. Phase 3 — Project-home UI and shared widget renderer

### Dependencies

Phase 1 accepted. May run in parallel with Phase 2 and Phase 4. Do not merge until Phase 2’s final route contract is confirmed.

### Agent brief

Port the accepted UI packet into the current Frank shell. Keep the left project/chat navigation, central chat pane, composer, Console and Living Frame. The project home is a central-pane mode, not a replacement shell.

### Tasks

1. Port frozen UI head `d852e871...` by semantic diff.
2. Clicking a project opens `/projects/:projectId`; clicking a chat uses the same central pane; Home returns to the dashboard.
3. Resolve sidebar room slugs through the project registry before navigating to UUID-only project routes.
4. Fetch layout and each widget snapshot through the authenticated runtime client.
5. Validate all response identities and schema before accepting them.
6. Fence route switches and async completions with generation/request IDs and abort controllers.
7. Render compact/medium/wide grid layouts exactly as stored.
8. Provide explicit owner-only Edit layout mode with add, remove, reorder, move, resize, configure, Save, Discard and Reset.
9. Never show Save/Reset as successful until the durable API returns a validated newer revision and ETag.
10. Preserve conflict recovery with Reload and Discard.
11. Give every widget its own error boundary and honest loading, empty, stale, locked, unavailable and error state.
12. Provide keyboard-accessible move/resize controls, focus order, screen-reader labels and reduced-motion support.
13. Make Living Frame use the same registry with a narrow stacked renderer.
14. Never render nested provider data as executable markup.
15. Never include target policy, capabilities, permissions or connector instructions in the browser action command.
16. Keep a public static preview that contains no private data and clearly marks unavailable authenticated services.

### Required hosted gates

- Hosted web typecheck and production build.
- Focused async race, identity, save/reset and layout mapping tests.
- Authenticated browser tests at desktop, tablet, mobile and Living Frame widths.
- Two-session shared-layout test.
- Non-owner editing denial.
- Browser console and network error check.
- WCAG AA contrast, keyboard, screen reader labels and reduced motion.
- Lighthouse accessibility, best practices and SEO at 100 unless an exact external browser limitation is documented and independently reproduced.
- Restart persistence and stale-save conflict acceptance.

### Exit criteria

- Preview URL updated and exercised.
- No dead `href="#"` controls.
- No mojibake.
- No identity, async race or in-memory persistence issue.
- Independent P0/P1 review GO.

## 8A. Phase 3A — Combined Dashboard checkpoint

### Dependencies

Phases 2 and 3 independently green. This step is serialized and must finish before widget or Night Watch work consumes `[DASHBOARD_HEAD]`.

### Tasks

1. Create `codex/project-dashboard-integrated` from the accepted contract commit.
2. Integrate the exact accepted API and UI heads in documented order.
3. Reconcile route names, response identities, public manifest shape, ETags, layout versions, responsive placement maps and action commands.
4. Run joint hosted API/web builds and authenticated browser missions using live PostgreSQL.
5. Save, reload, conflict, discard and reset a layout through the real UI/API boundary.
6. Switch between two projects during load/save and prove no cross-project state or write.
7. Fetch and render per-instance widget snapshots and execute one safe test action through the real action ledger.
8. Scan browser bundles and HTTP responses for every server-only manifest field.
9. Freeze one exact combined SHA called `DASHBOARD_HEAD`, with contract/API/UI manifests and preview evidence.

### Exit criteria

- One exact `DASHBOARD_HEAD` exists and is independently P0/P1 GO.
- Phase 5 and Phase 6 use this SHA, not separate API/UI branches.
- Preview shows the integrated runtime honestly.

## 9. Phase 4 — Lakehouse and storage isolation

### Dependencies

Phase 1 accepted and the current Harness Seaweed foundation frozen. May run beside Phases 2 and 3. Shared Seaweed policy integration is serialized with the release manager. Update the hosted lake/data-health preview or documented live-backed proof surface before the first feature commit.

### Agent brief

Port lake head `7a965c23...` onto current main without taking ownership of attachment uploads or shared Seaweed topology. Add only lake buckets, identities and policy. Preserve the previously proven data path and denial matrix.

### Tasks

1. Rebase the exact 48-file lake manifest by semantic diff.
2. Keep the worker’s PostgreSQL outbox input read-only.
3. Use canonical object references; never copy attachment lifecycle logic.
4. Deploy private Lakekeeper, OpenFGA, lake worker, query worker and dedicated credentials with no public ports.
5. Create five Iceberg tables: raw events, normalized events, connector runs, action receipts and daily project metrics.
6. Preserve deterministic field/partition identifiers and drift readiness checks.
7. Batch commits every minute or 10,000 events.
8. Fence checkpoints with the live advisory-lock session and generation.
9. Preserve idempotent replay, quarantine, bounded compaction, safe-horizon orphan GC and storage-pressure behavior.
10. Keep DuckDB queries allowlisted; no arbitrary SQL endpoint.
11. Add lake-only Seaweed policies and identities to the accepted shared template during an exclusive lease.
12. Prove attachment and lake credentials cannot access each other’s buckets.
13. Configure thresholds: warn 70%, owner action 80%, pause nonessential ingestion 90%; never auto-delete canonical data.
14. Configure encrypted off-site object replication, PostgreSQL WAL backup, catalog snapshots and restore drills.

### Required hosted gates

- Manifest exactness and secret scan.
- Private Compose render with zero public ports.
- PostgreSQL outbox failure/replay to Iceberg.
- DuckDB read of committed history.
- Query client cannot modify catalog.
- Cross-role and cross-project warehouse denials.
- Worker/query/monitor denied attachment staging, canonical and preview buckets.
- Attachment identities denied all lake buckets.
- Mounted secret values absent from container inspection and logs.
- Restart each lake component independently.
- Restore a disposable stack from off-site data.
- Zero-residue cleanup receipt.

### Exit criteria

- Independent P0/P1 review GO.
- Data-path and denial evidence green on exact integrated head.
- No attachment or Graphify regression.
- Exact manifest and image digests frozen.

## 10. Phase 5 — Default widget provider groups

### Dependencies

Phase 3A `DASHBOARD_HEAD` frozen. Run provider groups in parallel because each group owns a separate directory. The release manager is the single named registry owner and leases the registry only after all groups pass.

### Group E1 — Operational widgets

- Waiting on you.
- Running now.
- Recent receipts.
- Open chats.
- Work and todos.

Use canonical chat, work item, mission, workbench and receipt records. Actions must be server-issued descriptors. Required actions include Approve, Reject, Review, Open, Stop, Complete and Schedule only when authorized.

### Group E2 — Project and application widgets

- Project status.
- Live application.

Show objective, branch, last activity, shortcuts, deployment, health, incidents and recent events. Missing repository or live app must produce a setup/empty state, never a false healthy state.

### Group E3 — Source and graph widgets

- Git tree/worktree lanes.
- Application graph.

The Git widget consumes repository/worktree facts. The graph widget consumes production Graphify and links to `/console/graph?project=...`. Do not duplicate graph extraction.

### Group E4 — Night Watch and data health placeholders

- Nightly opportunities provider registration placeholder.
- Data health.

Night Watch data remains unavailable until Phase 6. Data health shows connector freshness, lake backlog, last commit and capacity forecast from deterministic metrics.

### Requirements for every widget

- Self-contained directory: manifest, React view, server provider, fixtures, contract tests and accessibility tests.
- Stable ID and semantic version.
- Supported surfaces, dimension bounds, config JSON Schema/defaults and migration function.
- Capabilities, permissions, classifications, freshness mode, stale threshold, actions and detail route.
- Isolated error boundary and locked/stale/empty states.
- Multiple instances only when the manifest permits it.
- No model call for deterministic counts, health, repository state, actions or queries.
- Model-generated summaries include source references, timestamps and broker receipts.

### Exit criteria

- Each group has isolated hosted tests.
- Registry integration validates all manifests.
- A broken widget cannot crash neighbors.
- Default layout selects only the first six capability-appropriate widgets.
- Gallery offers the remaining widgets.

### Registry integration checkpoint

1. The release manager creates `codex/project-widget-registry-integrated` from `DASHBOARD_HEAD`.
2. It accepts only widget-group commits whose changed-file manifests do not touch registry, shell, migrations or lockfile.
3. It leases and updates the shared registry once, preserving all public/server manifest separation.
4. It validates every widget identifier/version, provider binding, surface, config schema, dimensions, instance rule, state renderer and action descriptor.
5. It runs the integrated hosted gallery, default-layout, accessibility and broken-widget isolation tests.
6. It freezes one exact registry SHA and manifest consumed by Night Watch and Phase 7.

## 11. Phase 6 — Night Watch 0015 and provider integration

### Dependencies

Phases 1, 3A and the registry integration checkpoint frozen. This phase is serial on the migration journal and contract index.

### Agent brief

Rebase only the authoritative Night Watch combined head onto the integrated Dashboard contracts. Do not consume any older SHA. Implement the production provider and migration without changing the shell or widget registry architecture.

### Tasks

1. Import canonical Harness `SourceRef`; normalize numeric legacy versions at input.
2. Define one API-local Night Watch provider data schema with a stable URI/version.
3. Provider data contains only: `as_of`, freshness, summary metrics, at most three server-capped candidate views, scout/source health and evidence/receipt references.
4. Candidate IDs/versions may correlate a server-issued descriptor but never encode executable policy.
5. Actions exist only in generic `snapshot.availableActions`.
6. Add exactly `0015_night_watch.sql` after accepted `0014`.
7. Reuse work items, runs, sources, evidence and action receipts; do not create parallel candidate/approval/workflow stores.
8. Register the provider for the Nightly opportunities widget.
9. Add Build preview, Test once, Dismiss and Review signup only as authorized action descriptors resolved by Dashboard’s action system.
10. Preserve all accepted evaluation/cost/risk policies.

### Required hosted gates

- Migrations `0000`–`0015` apply from empty PostgreSQL and rerun cleanly.
- Shared contract index includes Harness, Dashboard and Night Watch exports once.
- Provider data validates and contains no action policy fields.
- Candidate result count is capped at three.
- Every action produces one receipt and one widget update.
- Unauthorized or expired actions fail closed.
- Hosted Night Watch run updates the dashboard through SSE.

### Exit criteria

- Exact 0015 hash and manifest frozen.
- Independent P0/P1 review GO.
- Night Watch widget works through generic provider/action seams only.

## 12. Phase 7 — Full integration, performance and recovery

### Dependencies

Phases 1–6 complete. No more parallel feature work. One integration branch and one release manager own shared files.

### Tasks

1. Merge/rebase accepted packet heads in this order: contracts/0014, API, UI, lake, widget groups, Night Watch/0015.
2. Resolve shared indexes, schema registry, migration journal, package manifest, lockfile, shell and production Compose manually from authoritative content.
3. Run the complete workspace verify and production web/API/worker builds on the hosted environment.
4. Run database migrations `0000`–`0015` on a cloned production schema with representative data.
5. Run one million synthetic events without loss.
6. Sustain 100 events/second for 30 minutes while the dashboard stays responsive.
7. Recover a backlog at 500 events/second.
8. Prove 30-day historical summaries under five seconds p95.
9. Prove current dashboard API under 500 ms p95.
10. Prove project home usable within 2.5 seconds on a warm production connection.
11. Prove stream updates visible within three seconds p95.
12. Test maximum 25-widget layouts.
13. Test desktop, tablet, mobile and narrow Living Frame.
14. Test two authorized sessions, one owner and one viewer.
15. Restart API, web, workers, PostgreSQL connections, Lakekeeper, OpenFGA, Seaweed and query worker independently.
16. Restore PostgreSQL, objects, Iceberg, catalog and layouts into a replacement disposable stack.
17. Run regressions for chat send/stream/persist, attachments, Range download, ClamAV, workbench stop/recovery, Graphify list/refresh/overview/console and Night Watch work-item creation.
18. Generate SBOM, provenance, image signatures, migration hashes, secret scan and exact changed-file manifest.
19. Produce a rollback bundle containing database, Caddy, Compose, environment references, prior image digests and restore instructions.

### Exit criteria

- No P0 or P1 findings.
- P2 findings recorded without hiding them.
- All hosted gates green on exact commit.
- Preview has been exercised by authenticated browser missions.
- Exact release candidate is immutable and signed.

## 13. Phase 8 — Superseded-system deletion and codebase cleanup

### Dependencies

Phase 7 green. The replacement candidate must be complete before any repository cleanup. Live production services, routes, schedules, credentials and rollback artifacts remain untouched until the new release has switched and passed acceptance.

### Agent brief

Remove every superseded active implementation, document, process and flow that has a proven replacement. Do not guess from age or naming. “Old” means the deletion manifest proves it is unreachable and replaced.

### Step 8.1 — Build the deletion manifest

Create `docs/plans/PROJECT_HOME_LEGACY_DELETION_MANIFEST.md` with one row per target:

- Exact repository path, service name, container/image digest, process-manager unit, cron/schedule ID, flow/workflow ID, preview path, bucket prefix or configuration key.
- Current owner.
- Replacement path/service/flow.
- Static references found.
- Runtime references found.
- Data classification.
- Whether canonical user data exists.
- Whether rollback or signed evidence depends on it.
- Deletion method.
- Expected recovered space.
- Verification that absence is safe.

Targets without an exact replacement or with a live reference are not deletable and block the phase.

### Step 8.2 — Remove superseded repository content

Delete from the active tree:

- Old dashboard/home implementations replaced by the project-home shell mode.
- Hard-coded project room lists replaced by the project registry.
- Old Living Frame widget rendering replaced by the registry renderer.
- Duplicate widget/provider/action code.
- Duplicate graph extractors or old Graphify adapters.
- Duplicate upload/object lifecycle code and obsolete attachment adapters.
- In-memory layout/action persistence and placeholder mock providers.
- Superseded migration drafts, generated schema copies and stale examples.
- Old connector control-plane experiments that are not used.
- Old lake prototypes, static query stubs and retired storage policies.
- Old mockups, preview-only assets and temporary patch scripts once no acceptance evidence references them.
- Documentation that describes deleted routes, services, flows or deployment commands.
- Obsolete dependencies and lockfile entries.
- Dead feature flags and compatibility branches whose supported migration window is complete.

Use reference scans, dependency direction tests, TypeScript builds and route/schema registries to prove absence. Do not leave commented-out code or “old” folders.

### Step 8.3 — Prepare the post-acceptance hosted-retirement manifest

Do not remove active or rollback-capable production resources here. Prepare literal commands and zero-reference checks for post-acceptance removal of:

- Old preview directories.
- Stopped candidate containers and zero-reference images.
- Retired Compose services and networks.
- Old systemd/Goose/cron/Temporal schedules and event flows.
- Obsolete Caddy routes.
- Temporary deployment/evidence staging not needed by the signed release.
- Retired object prefixes containing no canonical user data.
- Superseded OpenFGA/Lakekeeper tuples or policies.

Already-stopped, non-rollback, zero-reference preview/candidate artifacts may be deleted before release only when independently reviewed. Never run a global prune.

### Step 8.4 — Prove cleanliness

- Repository search returns zero references to each retired symbol, route, service, flow and environment key.
- Route/OpenAPI registry exposes only current routes.
- Schema registry exposes only current versions plus explicitly supported compatibility versions.
- Process manager, Docker, cron/scheduler, Caddy and OpenFGA/Lakekeeper inventories contain no retired target.
- Production secret store contains no retired credential.
- Dependency graph contains no retired package.
- Full build and tests remain green after deletion.
- Fresh clone/build requires none of the retired assets.

### Step 8.5 — Rebuild and re-prove the cleaned candidate

Repository cleanup changes the candidate. After the deletion commit:

1. Rerun every Phase 7 build, test, migration, performance, recovery, browser and regression gate.
2. Rebuild all affected OCI images from the cleanup commit.
3. Regenerate SBOMs, provenance, signatures, source/migration/schema hashes and the rollback bundle.
4. Freeze this new cleanup SHA as the only Phase 9 production candidate.
5. Invalidate all earlier candidate image/signature references for promotion purposes while retaining them as audit evidence.

### Important scope boundary

This phase removes obsolete content from the active system. It does not erase Git history, canonical user/project data, signed release evidence, current encrypted recovery copies or legal/audit records. If Steven later requires cryptographic erasure from Git history or backups, create a separate exact hash/path manifest and accept that all descendant commits, signatures, receipts and clones must be regenerated.

### Exit criteria

- Deletion manifest reviewed by an independent agent.
- Every repository target absent; every live-host retirement target has an exact post-acceptance command and zero-reference proof prerequisite.
- No canonical data deleted.
- Every Phase 7 hosted gate is rerun and green on the deletion commit.
- Deletion commit and rebuilt images are intentional, reviewable and signed.

## 14. Phase 9 — One terminal production release

### Dependencies

All prior phases green. No open P0/P1. Legacy deletion complete in the candidate and deployment plan. Production baseline remains healthy.

### Release procedure

1. Revalidate free bytes using the signed phase-aware capacity gate.
2. Revalidate exact image digests, attestations, SBOMs, source SHA and migration hashes.
3. Capture an encrypted rollback bundle including Caddy, Compose, PostgreSQL, current images, storage/catalog configuration and workbench assignment.
4. Replicate the encrypted object off-cell and verify full readback hash plus streaming decrypt/archive listing.
5. Stage exact signed images without building on production.
6. Enter a tested deployment write fence: drain queued/running mutators or record them for replay, reject new consequential writes, and prove chat/action/outbox inputs are safely buffered. A database snapshot alone is not an acceptable rollback boundary.
7. Apply migrations `0014` and `0015` with advisory deployment lock and captured rollback state.
8. Start private lake services and workers; require readiness and denial canaries.
9. Switch API, web and workers atomically with rollback armed.
10. Keep public exposure behind the existing authenticated edge; no DNS changes.
11. Run internal health, schema, queue, SSE, lake, storage, Graphify, chat and Night Watch checks.
12. Run authenticated public browser acceptance:
    - Project list and project home.
    - Shared layout load/edit/save/reload/reset.
    - Non-owner edit denial.
    - Open chat and send/stream/persist.
    - Attachment upload/scan/promotion/download.
    - Approval action with receipt.
    - Running work update through SSE.
    - Git widget.
    - Graph preview and full graph link.
    - Live app health.
    - Night Watch provider and action.
    - Data health and historical query.
13. Exercise mobile and narrow Living Frame paths.
14. Wait through a quiescence window long enough to detect rebuild loops, restart loops, polling storms and duplicate actions.
15. If any gate fails, run the tested coupled rollback and replay/buffer every post-snapshot write before lifting the write fence. Do not fix live and do not lose acceptance-test or concurrent user writes.
16. If the candidate passes, retire only the exact hosted services, routes, flows, schedules, credentials, previews and images listed in the reviewed Phase 8 manifest. Recheck zero references immediately before each literal removal; never globally prune.
17. Rerun internal/public smoke after live retirement and prove the retired inventory is absent.
18. Lift the write fence only after replay/reconciliation is complete and canonical queues/outbox are consistent.
19. Write `PRODUCTION_ACCEPTED.receipt` only now, containing exact commit, image IDs/digests, migration hashes, schema hashes, test receipts, deletion manifest hash, off-cell backup hash, public acceptance results, write-fence/replay receipt, post-retirement smoke and zero-residue inventory.

### Public completion definition

The app is complete only when:

- The production acceptance receipt exists and its hash is independently verified.
- Public authenticated smoke is green.
- Every required project has a useful home.
- The dashboard survives process and browser restarts.
- Actions are authorized, idempotent and receipted.
- Historical data and memory projections reference canonical sources.
- Rich chat and attachments remain fully functional.
- Graphify remains stable and bounded.
- Night Watch is integrated without a second workflow.
- Superseded active code, docs, services, processes and flows are absent.
- No disposable release resources remain.

## 15. Cold-start agent prompts

Use these prompts verbatim. Replace bracketed values with exact accepted SHAs only.

### Contracts agent

> Work only in a new worktree from `[INTEGRATION_BASE]`. Read `docs/plans/PROJECT_HOME_PRODUCTION_HANDOVER.md` completely. Execute Phase 1 only. Reconcile frozen contract head `80f91f7fe3f325a3ed47039a8c8e730e9b42c961` against current Harness/chat main. Harness canonical SourceRef and object-manifest exports win. Regenerate migration `0014_project_dashboard.sql` and the journal; do not create `room_id_cell_uidx`. Run hosted contract and disposable PostgreSQL gates. Return exact commit, 0014 hash, changed-file manifest, test receipts, cleanup receipt and blockers. Do not merge or edit UI/API/lake files.

### API agent

> Work from accepted Phase 1 contract commit `[CONTRACT_HEAD]` in a new worktree. Read the handover completely. Execute Phase 2 only, porting frozen API head `db20ce85eab8e3f50a03d547ab338cb039d98282` semantically. Use canonical auth, capability, permission, action boundary, audit and outbox. Run hosted live-PostgreSQL, idempotency, challenge and SSE tests. Return exact commit, route list, manifest and receipts. Do not edit UI, lake or migration files.

### UI agent

> Work from accepted Phase 1 contract commit `[CONTRACT_HEAD]` in a new worktree. Read the handover completely. Execute Phase 3 only, porting frozen UI head `d852e87176d707423f4f245da3b2b54f8c3465f6` semantically. Preserve FrankShell and Living Frame. Use authenticated durable APIs; no in-memory fallback. Update the hosted preview first, run hosted build/browser/accessibility gates and return exact commit, manifest, preview URL and evidence. Do not edit API, migrations or lake files.

### Lake agent

> Work from accepted Phase 1 contract commit `[CONTRACT_HEAD]` in a new worktree. Read the handover completely. Execute Phase 4 only, porting lake head `7a965c23bbfb41ff776a8b80522db80397dc8d46`. Harness owns shared Seaweed topology and attachment lifecycle; add only lake policy/identities during an exclusive lease. Re-run the exact hosted data-path and denial matrix. Return exact commit, 48-file-or-successor manifest, image digests, proof hash and zero-residue receipt. Do not edit Dashboard UI/API behavior.

### Widget group agent

> Work from accepted Dashboard API/UI contracts `[DASHBOARD_HEAD]`. Read Phase 5 and implement only group `[E1|E2|E3|E4]` in a self-contained widget directory. Use canonical providers and server-issued actions. Do not edit shared registry, shell, migrations, lockfile or another group. Run hosted contract/accessibility tests and return exact commit, widget IDs/versions, manifest and evidence.

### Night Watch agent

> Work after Dashboard integration head `[DASHBOARD_HEAD]`. Consume only authoritative Night Watch combined head `2e8544fd80eb569284e5b0d7f33cf68f30eed59e`. Execute Phase 6. Harness SourceRef wins. Add exactly migration `0015_night_watch.sql`; no shell or competing registry edits. Provider actions exist only in generic snapshot.availableActions. Return exact commit, 0015 hash, provider schema URI/hash, manifest and hosted receipts.

### Cleanup agent

> Work only after the complete replacement candidate is green. Read Phase 8. First produce an exact legacy deletion manifest with reference, runtime, data and rollback evidence for every target. Delete only proven superseded targets. Never globally prune, erase canonical data, rewrite Git history or remove signed evidence. Re-run the full hosted gate and return deletion commit, manifest hash, actual reclaimed bytes and active-system zero-reference proof.

### Independent reviewer

> Review exact candidate `[SHA]` read-only against the relevant phase and the full non-negotiable rules. Report only P0/P1 blockers; log P2 separately without reopening scope. Verify identity binding, auth boundaries, data ownership, migrations, idempotency, restart recovery, secret exposure, destructive deletion targets and evidence claims. A missing hosted proof is a blocker when the phase requires it. Return GO/NO-GO with exact file/line evidence.

### Release agent

> Execute Phase 9 only on exact signed candidate `[SHA]`. Target only production `76.13.209.160`. Do not build on production, change DNS, weaken limits or improvise cleanup. Require phase-aware capacity, off-cell rollback, exact migration and image proofs. Use coupled rollback on any failure. Return either a verified PRODUCTION_ACCEPTED receipt or a sealed rollback receipt and exact blocker.

## 16. Plan mutation protocol

Agents must not silently change this plan.

1. Record the proposed change in `PROJECT_HOME_EXECUTION_STATUS.md`.
2. State the fact that invalidates the current step.
3. Identify dependencies and shared files affected.
4. Choose one: split step, insert prerequisite, replace implementation behind the same contract, or block.
5. Obtain one independent architecture/security review for contract, migration, identity, storage or production changes.
6. Commit the plan amendment separately before implementation.
7. Never use plan mutation to weaken an acceptance gate or expand a deletion target.

## 17. Final handover checklist

The release manager must be able to answer yes to every item:

- [ ] Exact accepted main and production baseline recorded.
- [ ] Chat post-merge evidence accepted or its blocker recorded.
- [ ] Contracts reconciled on current main.
- [ ] Migration 0014 applied and hashed.
- [ ] Dashboard API/actions/SSE hosted green.
- [ ] Project-home UI hosted green and accessible.
- [ ] One combined `DASHBOARD_HEAD` joint API/UI checkpoint accepted.
- [ ] Lake full path and denial matrix hosted green.
- [ ] Default widgets complete and isolated.
- [ ] Night Watch migration 0015/provider integrated.
- [ ] Migrations 0000–0015 clean apply and rerun.
- [ ] Rich chat/attachment/Graphify regressions green.
- [ ] Performance, restart and restore gates green.
- [ ] Exact legacy deletion manifest reviewed.
- [ ] Superseded active code/docs/processes/flows removed.
- [ ] Full Phase 7 evidence, images and signatures regenerated on the deletion commit.
- [ ] Images signed with SBOM/provenance.
- [ ] Current encrypted off-cell rollback verified.
- [ ] Exact no-build production promotion completed.
- [ ] Authenticated public browser acceptance green.
- [ ] Quiescence window green.
- [ ] Deployment write fence and post-snapshot write replay/reconciliation proven.
- [ ] Post-acceptance live retirement and smoke green.
- [ ] No disposable resources remain.
- [ ] `PRODUCTION_ACCEPTED.receipt` exists and its SHA-256 is published.

Until every box is checked, the correct status is **NOT COMPLETE / NOT PRODUCTION ACCEPTED**.
