# Frank v0.21 — Session 5 foundation checkpoint (labeled)
> Historical handoff, not a current implementation guide. The cleanup on
> 2026-09-05 removed `workspace_foundation.py` and its dedicated test after
> their responsibilities were absorbed by the remaining workspace
> infrastructure. References below record the then-current checkpoint only.


Status: **CHECKPOINT PUBLISHED — supersedes `codex/frank-v021-foundation-s1-fallback`
per the recorded supersede rule.** Dependency-free: no Hermes adapter, no
Session 2/3/4 modules, no new dependencies (stdlib + existing Flask only).

## Lineage and SHAs

| Item | SHA |
| --- | --- |
| Immutable interface contract (READY, v1.0.0) | `2139353037fe544ca4306c521492846cf2b03c98` |
| Contract tip folded forward (S5/S2 wake-up + fallback activation) | `27f969e1c9d7430f2d0960099157daf92797d08b` |
| S1 foundation fallback (merged forward, kept green) | `1493b55dc6a0ea934551da0b15b444653b0e1b99` |
| Mismatch handoff base | `419f64e15efa0f9813cf735bc35a1613fbd3a175` |
| This checkpoint tip | see `git rev-parse codex/frank-v021-shared-estate` after push |

Merges are forward-only; no published history was rewritten.

## Files

- `apps/window/infra/workspace/__init__.py`
- `apps/window/infra/workspace/schemas.py` — module-local typed schemas
  (`schema://frank.workspace-resolver/v1`, `schema://frank.workspace-lease/v1`);
  canonical shared schema files remain Session 1-owned.
- `apps/window/infra/workspace/resolver.py` — `WorkspaceRegistry`
- `apps/window/infra/workspace/lease.py` — `WorkspaceLease`
- `apps/window/infra/workspace/lease_blueprint.py` — private authenticated
  endpoint blueprint
- `apps/window/tests/test_workspace_resolver.py` (16 tests)
- `apps/window/tests/test_workspace_lease.py` (17 tests)
- `apps/window/tests/test_workspace_lease_endpoint.py` (4 tests)
- Fallback modules kept green: `apps/window/workspace_foundation.py`,
  `apps/window/tests/test_workspace_foundation.py` (12 tests)

## Resolver API (contract §4)

- `WorkspaceRegistry(path, uuid_factory=None, verify_host_paths=False,
  canonical_prefixes=("/projects/",))`
- `migrate_registry(candidates, unassigned_scope="steven-unassigned")` →
  `{"migrated": n, "quarantined": n}`. Merges forward; never re-derives an
  existing mapping. Quarantine evidence records are persisted for entries
  that were never registered; duplicate slugs are counted and refused.
- `get_active(workspace_id)` → private record
  `{host_path, hermes_path, container_path, memory_scope (immutable legacy-derived),
  board_binding_id (opaque), board_slug_private (native slug, server-only)}`.
- `public_list()` → the ONLY browser shape:
  `{workspace_id, project_id, root_kind, status}` — no private path, bank,
  or slug can appear (type-enforced `WorkspacePublic`).
- `resolve_rel(workspace_id, rel)` → `{display_path, private_path, workspace_id}`.
- `safe_resolve` / `safe_read_file` / `safe_stat` — O_NOFOLLOW component-wise
  walk under the exact root; rejects absolute paths, traversal, dot/hidden
  components, NUL/control characters, non-NFC Unicode, Windows device names,
  trailing dot/space, symlinks (at the exact component), sockets/devices/FIFOs,
  oversized reads. All failures raise `PathRejected` / `WorkspaceUnknown` —
  fail closed, no silent fallback.

Migration candidate data (from `docs/evidence/frank-v021/WORKSPACE_INVENTORY.md`):
six canonical `/projects/*` roots with the blockwise host/container divergence
as data; `business-os` (relative root) and stale `/srv/projects/*` candidates
quarantine; `mini-frank`/`blockwise` session-implied projects registered from
their canonical roots; unassigned workspace gets `steven-unassigned` +
`upload-staging`.

## Lease API (contract §5)

- `WorkspaceLease(root, ttl_seconds=300, max_queue=8, verifier=None,
  clock=time.time, generation_factory=None)` — `root` lives under the
  existing Window operational-data root (`leases/` + `locks/` subdirs);
  no scheduler, no daemon.
- `acquire(workspace_id, LeaseOwner, max_wait_seconds=0)` → `LeaseGrant`
  (atomic, cross-process via `flock` + atomic record replace). Busy →
  bounded FIFO queue or explicit `LeaseRefused` (no residue on refusal).
- `heartbeat(workspace_id, generation)` — TTL/3 cadence; stale generation →
  `StaleGeneration`.
- `release(workspace_id, generation)` — terminal; promotes queue head.
  Double release / cross-workspace / replay → `StaleGeneration`.
- `cancel_queued(workspace_id, generation)`; `inspect(workspace_id)` —
  read-only, never needs a lease.
- `reconcile(workspace_id)` + `recover_all()` — restart path marks active
  records `reconciling`, refuses acquisitions, resolves via the injected
  authoritative verifier; verifier outage fails closed.
- Reclaim rule: TTL expiry **plus** verifier-confirmed owner death — never
  wall-clock alone. Live owners beyond TTL are renewed, not stolen.
- Record fields: workspace id, executor kind/id, session/task/job/run ids,
  random generation, acquired/heartbeat/expiry times, bounded event history.
- `LeaseUnavailable` on corrupt storage — fail closed.

## Private endpoint (Session 1 wiring — exact patch)

`create_lease_blueprint(lease, url_prefix="/internal/leases",
credential_env="FRANK_LEASE_CREDENTIAL")` returns a Flask blueprint:
`POST <ws>/acquire|heartbeat|release|cancel-queued`, `GET <ws>`.
Auth: runtime-only env credential, `Authorization: Bearer`, constant-time
compare; unset credential or bad auth → 503/403. Never browser-reachable;
mount on the loopback/private bridge only.

Suggested Session 1 wiring in `server.py` (after `_project_store` init):

```python
from pathlib import Path
from infra.workspace.resolver import WorkspaceRegistry
from infra.workspace.lease import WorkspaceLease
from infra.workspace.lease_blueprint import create_lease_blueprint

_workspace_registry = WorkspaceRegistry(
    Path(os.environ.get("WORKSPACE_REGISTRY_FILE", str(CHAT_DIR / "workspaces.json"))),
    verify_host_paths=True,
)
_workspace_lease = WorkspaceLease(
    Path(os.environ.get("LEASE_DATA_ROOT", str(CHAT_DIR / "workspace-leases"))),
    verifier=None,  # Session 1/2 wire the real Hermes run-verifier at composition
)
app.register_blueprint(
    create_lease_blueprint(_workspace_lease), url_prefix="/internal/leases"
)
```

Plus `FRANK_LEASE_CREDENTIAL` added to the runtime-only secret file
(`/srv/frank/secrets/window.env`), never to compose defaults or Git.

## Canary allocation (contract §10, S5)

State root `/srv/frank-canaries/s5-hermes-v021`; API Server
`127.0.0.1:18646`; rich serve `127.0.0.1:19124`; banks `steven-v021canary-*`;
session/board prefixes `v021canary-`.

## Test results

```
cd apps/window
python3 -m unittest tests.test_workspace_resolver tests.test_workspace_lease \
  tests.test_workspace_lease_endpoint tests.test_workspace_foundation
# Ran 53 tests in ~5s — OK
```

Full `python3 -m unittest discover -s tests` on this branch: same result set
as the pristine contract base (`27f969e`): 17 pre-existing environmental
loader errors (e.g. `Mini Frank legacy project root is unavailable` outside
the production checkout context) — verified identical on the untouched base,
so zero new failures are introduced by this checkpoint. `node --check` not
applicable (no JavaScript added).

## Handoff notes for Session 1

1. Create `codex/frank-v021-foundation` at this exact checkpoint object and
   apply the wiring patch + registry migration (candidates per the inventory
   evidence) there.
2. The fallback modules remain green in-tree; the supersede rule makes the
   labeled `infra/workspace` implementation authoritative for future work.
   Removing `workspace_foundation.py` + its test is a Session-1 cleanup
   decision at composition time, not done here.
3. Real Hermes owner-verifier wiring (`verifier=` callback) is intentionally
   absent (composition dependency per the contract).
4. Feature-flag `frank.lease_gate` behavior (off → legacy path) belongs to
   Session 1's central wiring; this module exposes `acquire` for the Hub
   prompt/Kanban/cron/Codex acquisition points.
