# Handoff — Frank v0.21 Work & Routines (Session 4)

Branch: `codex/frank-v021-work-routines`
Status: **implementation complete against the frozen contract; canary pending the foundation and adapter READY commits (bounded poll active). Nothing deployed.**

## 1. Ready contract

- Contract: `FRANK_HERMES_V021_CONTRACT` v1.0.0 — `INTERFACE_CONTRACT_STATUS: READY`
- Immutable commit / tag: `2139353037fe544ca4306c521492846cf2b03c98` (`frank-v021-contract-ready-v1.0.0`)
- This branch is created from that exact commit (verified parent of `0127a43`).
- Foundation (`codex/frank-v021-foundation`, `FOUNDATION_STATUS: READY`) and adapter base (`ADAPTER_STATUS: READY`): **not yet published at handoff-write time.** Per gate rules no mutating canary or final evidence is claimed. Poll continues; when they appear, this branch merges them forward and reruns affected receipts.

## 2. Commits and files

- `0127a43` feat(work): task service, routines, providers, tools, widgets, isolated work.css with focused tests
- `2139353` (contract, ancestry only — no rewrites)

New modules (all in `apps/window/`):

| File | Purpose |
|---|---|
| `work_state.py` | Deterministic native→friendly state mapping (projection only; native never collapsed) |
| `work_cron.py` | Typed Hermes cron client (`/api/cron/jobs`), schedule validation, next-run preview, gateway health |
| `work_service.py` | Task operations, project scope, board bindings, operation ledger, event drain/projection |
| `work_routines.py` | Routines: inert-first two-phase create, allowlisted updates, pause/resume/delete, run-now |
| `work_api.py` | Flask blueprint: strict same-origin guard, scope enforcement, task/routine/Hub routes |
| `work_providers.py` | Entity-home project-work provider + Hub Overnight/Waiting/Running read models + manifests |
| `work_tools.py` | Narrow conversational tool manifests/dispatch reusing the same services and IDs |
| `web/js/work.js` | Hub slide widgets (registry ids `overnight`/`waiting`/`running`), project work summary, task/routine drawer |
| `web/work.css` | Isolated stylesheet, every selector under `.work-root`, Frank tokens only |

Tests: `tests/test_work_state.py`, `test_work_cron.py`, `test_work_service.py`, `test_work_routines.py`, `test_work_api.py` — 87 focused tests, all passing.

## 3. State mapping (frozen in `tests/test_work_state.py`)

| Native task | Group | Label |
|---|---|---|
| `triage` | queued | Planned |
| `todo` | queued | Queued |
| `scheduled` | queued | Scheduled |
| `ready` | queued | Ready |
| `running` | running | Running |
| `blocked` | waiting | Waiting |
| `review` | waiting | Waiting for review |
| `done` | completed | Completed |
| `archived` | archived (hidden by default) | Archived |
| unknown | unknown (never guessed) | Unknown |

Runs: `starting`/`stopping` → transitional; `running` → running; `succeeded`/`failed`/`cancelled` → terminal with exact labels. A stopped task shows `stopping` until Hermes confirms exit — never "done".

## 4. Endpoint table

| Method/Route | Purpose | Guard |
|---|---|---|
| GET `/api/work/tasks?project_id&group&q&limit` | list (auto-provisions board idempotently) | read |
| POST `/api/work/tasks` | create passive task (`triage:true`, `workspace_kind:"dir"`, resolver path, `default`, native `idempotency_key`); post-create-only passive/no-worker verification | same-origin + JSON + operation id |
| GET `/api/work/tasks/<id>`, `?detail=true` | task / full detail (comments, attachments, attempts, runs) | scope-checked |
| GET `/api/work/tasks/<id>/events?cursor` | bounded event page (≤200, envelope-normalized) | read |
| PATCH `/api/work/tasks/<id>` | metadata update with optimistic revision | same-origin |
| POST `/api/work/tasks/<id>/actions/{ready,start,comment,attach,block,unblock,review,changes,retry,complete,archive,terminate}` | lifecycle (start/retry lease-gated; terminate exact run id) | same-origin + operation id |
| GET `/api/work/routines`, POST `/api/work/routines/preview`, POST `/api/work/routines`, GET/PATCH/DELETE `/api/work/routines/<id>` | routines: list, preview, inert-first create, read, typed update, confirmed delete | same-origin on mutations |
| POST `/api/work/routines/<id>/actions/{pause,resume,run-now}` | Hermes-confirmed pause/resume; leased, ledgered run-now | same-origin |
| GET `/api/work/hub/{overnight,waiting,running}` | Hub read models (`schema://frank.widget-snapshot/v1`, `source_truth:"hermes"`) | read |
| POST `/api/work/hub/acknowledge` | presentation-only Overnight cursor | same-origin |
| GET `/api/work/gateway` | gateway daemon health (serve alone never fires) | read |

## 5. Central registration patches for Session 1 (exact)

Session 1 owns shared wiring. Everything below is additive; no competing edits were made to central files.

1. Backend import/registration — in `server.py`, after the app is created:
```python
from work_api import api as work_api_bp, configure as work_configure
app.register_blueprint(work_api_bp)
work_configure(
    project_loader=<migrated registry loader>,
    kanban=<Session 2 frozen adapter>,
    resolver=<Session 5 private resolver>,
    leases=<Session 5 lease service>,
    cron_client=work_cron.CronClient(HERMES_URL, lambda: HERMES_KEY),
)
```
2. Frontend import — in `web/index.html` (one line, alongside app.js):
```html
<script type="module" src="/web/js/work.js"></script>
```
and the stylesheet (one line):
```html
<link rel="stylesheet" href="/web/work.css">
```
3. Widget catalogue — register `work_providers.WORK_WIDGET_MANIFESTS` (4 manifests, all `source_truth:"hermes"`); the entity-home renderer hook is `window.frankWork.projectWidget(element, projectId)` (one `else if (widgetId === "project-work")` line in `homes.js` `renderProjectSnapshot`, or equivalent).
4. Conversational tools — register `work_tools.WORK_TOOLS` via Hermes's approved tool/MCP boundary; dispatch through `work_tools.dispatch(tool_id, arguments)`.

## 6. Test results (focused/full)

- Focused work tests: `python3 -m unittest tests.test_work_state tests.test_work_cron tests.test_work_service tests.test_work_routines tests.test_work_api` → **87 tests OK**.
- Full Window suite: 645 tests; the worktree has **zero regressions** — remaining errors are a strict subset of the pre-existing environment failures present on `main` (13 errors + 1 failure there vs 12 here; the worktree additionally *passes* 2 tests `main` fails because the `vendor/agenttrail` + `vendor/archify` submodules are initialized here).
- `node --check web/js/work.js` → OK. All new Python modules `py_compile` clean.

## 7. Canary evidence

**Not yet run — honestly pending.** The gate forbids mutating canaries before `FOUNDATION_STATUS: READY` and `ADAPTER_STATUS: READY` with matching hashes. Planned canary (S4 allocation, per contract §10/S1 handoff): endpoint ports 18645/19123, state root `/srv/frank-canaries/s4-hermes-v021`, unique disposable project/board/job namespace, sole profile `default`, notifications/provider writes/destructive tools blocked. Steps: full lifecycle ready→start→running→blocked→unblock→review→changes→retry→done→archive; two-phase routine create with rollback drill; run-now reconciliation; restart survival; redacted receipts; post-canary cleanup with zero-residual proof (no enabled routine, worker, lease, upload/attachment, or disposable board remaining). Labels the four-executor composed race, cross-service restart, false-stale protection, and dead-owner reclaim as Session-1 composed-only evidence — not fabricated here.

## 8. Limits and known risks

- `work_cron.py` validates cron expressions, `every <minutes>m` intervals, and offset ISO timestamps; natural-language schedules are rejected by design (Frank only previews what it can compute). Upstream also accepts richer natural language — accepted only if Session 1 freezes a narrower tested shim.
- `max_in_progress` is **not** set: the frozen contract does not prove the field exists; the shared workspace lease is the boundary (per review correction R3).
- The Hub Overnight cursor is a tiny presentation-only JSON file (`work-view-cursor.json`), explicitly separated from Hermes truth; if the integration exposes a per-user preference store it can be moved there without behavior change.
- Board binding slugs/workdirs live in a private server-side registry file; the browser never sees them. Wrong-board/wrong-project/workspace-mismatch bindings quarantine instead of adopting.
- `home_providers`/`homes.js` were not modified; the project-work widget mounts via the documented one-line integration patch.

## 9. Migration statement

No data migration is required. Frank's work features create their own Hermes boards/tasks/jobs lazily per project (`ensure_board` is idempotent). Existing registry projects without a migrated `workspace_id` fail closed with `workspace_not_migrated` until Session 5's resolver migration lands — no legacy `root`-derived paths are used as authority.

## 10. Rollback / removal

1. Drop the blueprint registration, the two `<script>`/`<link>` lines, and the catalogue entry — the site returns to its previous behavior; no shared file is structurally changed by this branch.
2. Frank-side artifacts are limited to `work-operations.jsonl`, `work-board-bindings.json`, `work-view-cursor.json` under the data dir — delete to reset.
3. Hermes-side: archive/remove S4-canary tasks and jobs via supported API operations only; never delete state paths.
