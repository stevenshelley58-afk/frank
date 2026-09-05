# Frank v0.21 — Session 5 shared estate handoff
> Historical shared-estate handoff. The 2026-09-05 cleanup removed the dedicated workspace-foundation test named below; current workspace coverage lives in the remaining infrastructure suite.


Branch: `codex/frank-v021-shared-estate` (tip at time of writing: see
`git rev-parse origin/codex/frank-v021-shared-estate`). No merge to main, no
deploy, no in-place `/projects/frank` patch, no production change of any kind.

## Lineage (forward-only merges, no history rewrites)

| Item | SHA |
| --- | --- |
| Immutable interface contract (READY, v1.0.0) | `2139353` |
| Contract tip folded forward (S5/S2 wake-up) | `27f969e` |
| S1 foundation fallback (merged, superseded by labeled checkpoint) | `1493b55` |
| Mismatch handoff (pre-contract coordination) | `419f64e` |
| **Labeled foundation checkpoint** | `7c5ab4c` |
| Part A attachments | `ec6aeb2` |
| Part C skills | `ac384d1` |
| Part D memory | `0de91ea` |
| Part E maps | `eaf824f` |
| Part F discovery + hub tools | `c29791b`, `38ca0ce` |
| Part G Codex | `530878f` |
| auto_retain expectation update | this commit |

`codex/frank-v021-adapter-base` was **not published** at handoff time;
adapter-dependent composed canaries are therefore deferred, not fabricated.

## Opaque workspace migration matrix

Migrated registry (`infra/workspace/resolver.py`) from
`docs/evidence/frank-v021/WORKSPACE_INVENTORY.md` candidates. Private record:
`{workspace_id (opaque UUIDv4), project_id, slug, host_path, hermes_path,
container_path, memory_scope (immutable, legacy-derived), board_binding_id
(opaque; private record → native board slug), root_kind, status}`.

| slug | host_path | hermes/container | memory_scope | notes |
| --- | --- | --- | --- | --- |
| blockwise | `/projects/blockwise-product-release-21a192cd2420` | `/projects/blockwise` → `/vps/projects/blockwise` | `steven-blockwise` | host/container divergence as data |
| merrypaws | `/projects/merrypaws` | same-name | `steven-merrypaws` | |
| elfandwonder | `/projects/elfandwonder` | `/projects/elfwonder` UI id maps to legacy root | `steven-elfandwonder` | never re-derived from UI id |
| pavone-demo | `/projects/pavone-demo` | same-name | `steven-pavone-demo` | |
| mini-frank | `/projects/mini-frank` | same-name | `steven-mini-frank` | |
| unassigned | (none — staging only) | — | `steven-unassigned` | upload-staging root kind |
| business-os | relative `business-os` | — | — | **quarantined**: non-canonical root |
| stale `/srv/projects/*` | `/srv/projects/...` | — | — | **quarantined**: outside canonical roots |

Browser DTO shape (type-enforced `WorkspacePublic`): `{workspace_id,
project_id, root_kind, status}` — no private path, bank, or board slug can
appear (tested). New registrations get exactly one immutable `memory_scope`;
duplicate slugs are refused (evidence persisted, first mapping preserved).

## Lease API, callers, reconciliation

`WorkspaceLease` (`infra/workspace/lease.py`): acquire (atomic, flock +
record replace; busy → bounded FIFO queue or immediate explicit refusal with
no residue), heartbeat (TTL/3; stale generation → `StaleGeneration`), release
(double/cross-workspace/replay rejected), cancel_queued, inspect (lock-free),
reconcile + recover_all (restart marks `reconciling`, refuses acquisitions,
resolves via injected authoritative verifier; outage fails closed). Reclaim =
TTL **plus** verified owner death; live owners beyond TTL are renewed.
Records: workspace id, executor kind/id, session/task/job/run ids, random
generation, times, bounded events. Storage corruption → `LeaseUnavailable`.

Callers: private endpoint blueprint (`/internal/leases/*`, runtime-only
bearer credential, constant-time compare, 503 when unset) for the gateway
hook and Codex launcher; in-process API for Hub prompt/Kanban/cron (Session 1
wires acquisition points; flag `frank.lease_gate` behavior is theirs). Real
Hermes owner-verifier: intentionally absent (composition dependency for
Sessions 1/2). Composed-test deferrals: end-to-end lease around live Hermes
tasks and the cross-branch Codex canary (below).

## Attachments

- Typed roots (`infra/workspace/roots.py`): per workspace a read-only
  `live-reference` root (canonical project) + `upload-staging` root
  (`/data/uploads` host twin `/srv/frank/data/window/uploads`, partitions
  `projects/<opaque-project-id>/` and explicit `unassigned/`).
- Manifests (`manifest.py`): deterministic bounded file/folder manifests,
  symlink-free walk, explicit `hash_deferred` (64 MB budget),
  `truncation: false` fail-closed on limits, use-time revalidation
  (changed/deleted/size/hash mismatch → honest failure).
- Snapshots (`attachments.py`): temp-write → validate → atomic publish;
  partial batches never sendable; status/cancel/retry/delete/prune via exact
  resolved dirs; browser names/media types untrusted; `source=local-upload`,
  `captured_at`, sha256 per entry; snapshot immutable. Retention rides the
  existing cleanup framework (no scheduler); `require_same_origin` helper
  for Session 1's centralized guard on upload/delete/copy/bind routes.
- Hermes handoff: IDs + display metadata only; `hermes_reference` returns
  exactly `@folder:.frank-attachments/<partition>/<session>/<batch>/<folder>`
  (bind root = project root; whole-project read-only bind, never per-batch;
  `.frank-attachments/` excluded from maps/knowledge/Explorer and Git via
  `.git/info/exclude` — Session 1 owns the actual bind/broker host change).
  `file.attach` `ref_text` + `image.detach` state for Session 2: preserved by
  keeping manifests and revalidation server-side; **composed ref_text/detach
  verification is deferred to Session 1's acceptance** (needs live Hermes).
- Limits frozen in code/tests: per-file 1 KB test cap (contract caps:
  image 25 MB, PDF 50 MB/25 pages `pdftoppm`, generic per contract —
  parameterized `max_file_bytes/max_batch_bytes/max_batch_files`).

## Skills

- Inventory (`infra/skills/inventory.py`): operator vs runtime-owned
  classification (`.system*` stays in place, excluded from `/srv/skills`);
  frontmatter validation; broken/unreadable references and path escapes
  marked error; same-name collisions hashed and quarantined (folders never
  merged); production-active version preserved via provenance marker.
- Staging (`staging.py`): fresh `skills.next.<release>`-style tree from
  inventories + uniquely-named project-scoped skills with explicit scope
  metadata; validation (no symlinks, no dupes, catalog checksum);
  **emits reviewed Session-1 scripts** — `promote_skills_cutover.sh`
  (backup + atomic mv + root:hermes + read-only), `rollback_skills_cutover.sh`,
  `check_checksum_parity.sh` (fails deployment on consumer/catalogue drift).
  Live consumers are never redirected by this branch; `/srv/skills` stays
  empty until Session 1 promotes.
- Provider (`provider.py`): ready/empty/stale/unavailable/error +
  `source_truth=filesystem` for the existing library/entity-home widget;
  bounded read-only SKILL.md inspection (no unsafe HTML/execution, no new
  Skills page).
- Populated-root/runtime classification: live re-inventory counts recorded in
  the mismatch handoff (Hermes 25/10, codex-hermes 17/1, codex-.codex 0/0,
  root-.codex 17/17) — counts drift; re-inventory runs at cutover.

## Hindsight memory

- Bank mapping frozen: `steven-unassigned` fallback, per-project legacy
  `steven-<root>` (elfandwonder exact), Mini scopes exact, template
  `steven-{workspace}` untouched. Global operator scope via configurable
  `global_bank_id` (promotions carry `origin_bank`/`origin_document`
  provenance; global recall preference = native global+project if the pinned
  integration proves it, else reviewed USER.md — decision recorded at
  composition, no untested bank merge).
- `auto_retain:false` in tracked `infra/memory/hindsight-config.json`
  (Session 1 deploys; live currently true). Recall sync
  `observation,world,experience` fields untouched.
- Admission (`infra/memory_admission.py`): direct-user project facts,
  explicit global preferences, authoritative sources — all with provenance +
  idempotency key; refuses non-user-attributed prose, assistant/tool content,
  secret-pattern matches, oversized/empty, missing provenance. Hindsight
  still extracts; no vendor patches.
- Memory view: `promote_document_global` (exact `PROMOTE <doc>` confirmation,
  stable idempotency key → same promoted document id on retry) + same-origin
  JSON route + "Remember everywhere" button (confirm dialog shows provenance
  and destination; reuses existing DOM/styles). Correction/forget behavior
  untouched (all 8 existing inspector tests pass).

## Maps

`graph/projection_receipts.py`: provenance envelopes (schema
`schema://frank.graph/v1`, revision, generated age, validation status →
ready/stale/error), approved-roots discovery filter (`.frank-attachments` +
upload data always excluded), deletion verification (removed node ids +
connected edges must vanish; ghosts fail loudly). Reuses existing pipeline/
workbench/Graphify/Archify; no new UI or store; no prompts/secrets/memory in
maps (existing provider redaction preserved).

## Unified tool/MCP discovery

`tool_apps/discovery_adapter.py`: per-package discovery from the one approved
tools root (fixes the seam: `discover_tool_homes` was validated in prod but
never fed the catalogue). Valid manifests → catalogue widgets with
`source_type: tool-package`, content-bound revision checksum, provider
binding — no per-package central edits, no package code executed. One invalid
manifest quarantined with visible evidence; duplicates refused; builtins win;
fixture add/remove proven in tests. Hermes skills/toolsets/MCP health
(`hub_read_tools.project_hermes_health`): explicit source type + authority,
attention-not-ready states, no secrets, no silent same-name merges.

## Hub read tools

`infra/workspace/hub_read_tools.py`: cross-project opaque listing; per-project
bounded file list (50 entries) / read (200 KB) with hidden + sensitive-name
refusal; map section with provenance; approved skill text via the existing
inspector; tool + memory-source health matching provider snapshots exactly;
provenance/revision hints returned; no bulk exports. Mutation tools = Session 4.

## Codex on the VPS

- `codex_launcher.py::run_leased_task`: immediate refusal on busy workspace
  (never enters checkout), heartbeat + owner-verifier renewal, terminate +
  fail-closed on renewal loss, release after verified exit, generation stays
  in the launcher process. Race test: exactly one of two simultaneous
  launchers enters and writes.
- `scripts/codex-vps/setup_codex_user.sh` (Session-1 reviewed): not root,
  not in `hermes`, records over-broad `sudo`/`docker` memberships, per-project
  group + setgid + `safe.directory`, world-writable roots forbidden.
- `scripts/codex-vps/launch_codex_task.sh` (Session-1 reviewed): resolve →
  acquire → heartbeat → `codex exec` in the resolved private host path →
  release; renewal loss terminates.
- Runbook `docs/handoffs/frank-v021-codex-vps-runbook.md`: mechanism
  (`codex exec` on VPS; CLI at `/usr/bin/codex`), canary protocol (sequential
  two-way writes across verified generations, shared skill, global+project
  memory via `steven-v021canary-*` at the S5 allocation, same map revision,
  simultaneous-start exclusion, negative kanban canary, no local copy),
  explicit same-access boundaries (no live transcripts, no Hermes
  credentials, no direct DB/loopback plugin access, `.system` stays
  runtime-owned).
- **Live canary: not yet run** — requires `codex/frank-v021-adapter-base`
  (ADAPTER_STATUS READY) and Session 1's host steps. `RELEASE_STATUS`
  implications are Session 1's call; nothing here is labeled proven without it.

## STT (Part B) findings

No service built; `/api/audio/voice-config` never exposed. Capacity: the
`/srv/frank/data` host root shares `/` (387G total, 154G free, 61% used) —
sufficient for transcode temp files; the temp-file policy recommendation is
to stage under the existing data root with the existing cleanup pass owning
sweeps. Pinned `POST /api/audio/transcribe` endpoint failures are Session 1's
(provider/config); microphone UI is Session 3.

## New-project visibility

Implemented per the frozen contract's selection at composition: Option A
(generated explicit read-only mounts on controlled restart) or Option B
(restricted broker over registered canonical workspaces) — both are
Session-1 host changes; the resolver/registry side is ready for either and
the canary protocol covers the disposable-project proof.

## Test commands and results

```
cd apps/window
python3 -m unittest tests.test_workspace_resolver tests.test_workspace_lease \
  tests.test_workspace_lease_endpoint tests.test_workspace_foundation \
  tests.test_workspace_attachments tests.test_skills_estate \
  tests.test_memory_admission tests.test_map_receipts \
  tests.test_tool_discovery tests.test_hub_read_tools tests.test_codex_launcher
# 97 tests — OK (S5 estate suites)
python3 -m unittest discover -s tests
# Ran 681 tests — 0 failures; 17 pre-existing environmental loader errors,
# verified identical on pristine contract base 27f969e (e.g. "Mini Frank
# legacy project root is unavailable" outside the production checkout).
node --check web/js/*.js   # all OK
bash -n scripts/codex-vps/*.sh  # OK
```

Existing-expectation update: `tests/test_hindsight_memory_infra.py` now
asserts `auto_retain` false (v0.21 contract change; was the one full-suite
failure this branch caused).

## Known boundaries and rollback/removal

- Composed/adapter-deferred (not fabricated): live `@folder:` Hermes reads,
  `file.attach` ref_text + `image.detach` accounting, lease around real
  Hermes runs, Codex live canary, live consumer redirect, `/srv/skills`
  promotion, `auto_retain` live flip, mounts/broker, Codex ACL host changes —
  all gated on `codex/frank-v021-adapter-base` and/or Session 1 host steps.
- Rollback: skills — `rollback_skills_cutover.sh <backup>`; foundation
  modules are additive (remove `infra/workspace`, `infra/skills`,
  `infra/memory_admission.py`, `graph/projection_receipts.py`,
  `tool_apps/discovery_adapter.py`, `scripts/codex-vps/`, added tests, and
  revert the two-file config/test edit); registry/lease data lives under the
  operational-data root and can be archived wholesale.
- Cleanup of canary sentinels: exact batch/project dirs via the service's
  delete path; banks `steven-v021canary-*` deleted through the Hindsight API
  by the canary owner after proof.
