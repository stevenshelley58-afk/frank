# Frank v0.21 Hermes runtime adapter — interface-contract mismatch handoff

Owner: Hermes v0.21 runtime adapter session (Prompt 2 of 5).
Branch: `codex/frank-v021-hermes-adapter`, cut from `main` @ `49d75ad`.

Status: **MISMATCH — `origin/codex/frank-v021-contract` not yet published.**
No implementation code exists on this branch yet; it holds coordination and
baseline evidence only, per gate rules 5/6.

## Gate state

- Gate rule 3 requires `origin/codex/frank-v021-contract` with
  `INTERFACE_CONTRACT_STATUS: READY` before implementation edits. That ref is
  absent from the remote (verified via `git ls-remote origin` polls:
  2026-09-03 ~10:28 UTC and ~11:36 UTC; only `codex/frank-v021-preflight` and
  `codex/frank-v021-shared-estate` match `codex/frank-v021*`).
- `origin/codex/frank-v021-foundation` is also absent; no mutating canary or
  lease-dependent work will start until it is fetched and verified
  (`FOUNDATION_STATUS: READY` + hashes).
- Polling continues on a bounded backoff. When the READY contract lands, the
  exact immutable commit SHA is recorded here, this branch merges it forward
  without rewriting history, and every affected receipt is rerun.

## Baseline evidence (read-only, main @ 49d75ad)

- `python -m unittest discover -s tests` (apps/window): **397 tests,
  1 failure, 18 errors** — all 18 errors are
  `ModuleNotFoundError: No module named 'flask'` loader failures from the bare
  interpreter (environment gap, not code); rerun baseline against a venv is
  recorded below once captured. The single failure is
  `test_control_inventory.ControlInventoryTests.test_repository_matrix_is_deterministic_and_canonical`,
  already reconciled against deployed reality on Session 1's preflight branch
  (`9e954da`). Not introduced by this session; no UI/runtime files touched.
- `node --check` on every JS/mjs file under `web/`, `mini/`, `graph/`,
  `tests/`: **0 failures**.

## Reused-surface discovery (concise)

- `server.py`: `hermes_base()`/`hermes_request()` REST helpers, chat session
  list/create/rename/model, transcript read, uploads, and
  `POST /api/chat/turn` streaming to `/api/sessions/{id}/chat/stream` via
  urllib. The adapter will be introduced behind an integration shim so
  browser-facing route behavior is preserved without a second set of chat
  routes.
- `tool_apps/contracts.py` + `tool_apps/adapters.py`: versioned command/event
  envelopes reused as-is (Session 1 owned).
- `project_store.py`: project↔session bindings only; no `workspace_id` yet.
  The adapter never trusts legacy `root` and waits for the Session 5
  resolver contract merged from the foundation branch.
- Window data root in-container is `/data` (host twin
  `/srv/frank/data/window`); adapter code references the configured root only.

## Next steps

1. On READY contract fetch: record SHA, merge forward, implement adapter
   modules + tests per the approved plan (contract-independent internals may
   proceed on this branch meanwhile, clearly separated).
2. Before any mutating canary: verify and merge
   `origin/codex/frank-v021-foundation`, use its real resolver/lease API.
3. Handoff document `docs/handoffs/frank-v021-hermes-adapter.md` is completed
   only at the final tested checkpoint.
