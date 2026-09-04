# Frank v0.21 Phase A 3b — workspace/project inventory (redacted)

Captured 2026-09-03T10:45Z. Raw queries under `/secure/frank-v021/raw/`.

## Frank window registry (`/srv/frank/data/window/projects.json`)

| project_id | stored root | note |
| --- | --- | --- |
| business-os | `business-os` (relative) | only registered project |
| mini-frank, blockwise | (absent from list) | referenced only via `sessions` mapping (`project_id` keys) — legacy/implicit |

Session→project map exists for 4 sessions (`api_1787381091_5d69c7a8`→mini-frank,
2×→blockwise, 1×→business-os).

## Hermes `projects.db` (native registry)

| id | slug | primary_path (stored) | board_slug | actual host path |
| --- | --- | --- | --- | --- |
| p_e6d40759 | frank | `/srv/projects/frank` | NULL | `/projects/frank` |
| p_a39eae27 | blockwise | `/srv/projects/blockwise` | NULL | `/projects/blockwise` |

**Mismatch proven:** `/srv/projects` does not exist on the host. Stored
`primary_path` values are stale; canonical layout is `/projects/<slug>`.
`board_slug` is NULL for both (no native board binding yet).

## Frank container mounts (read-only except data/legacy/preview)

| Host | Container | Mode |
| --- | --- | --- |
| /projects/frank | /vps/projects/frank | ro |
| /projects/blockwise-product-release-21a192cd2420 | /vps/projects/blockwise | ro |
| /projects/mini-frank | /vps/projects/mini-frank | ro |
| /projects/merrypaws | /vps/projects/merrypaws | ro |
| /projects/pavone-demo | /vps/projects/pavone-demo | ro |
| /projects/elfandwonder | /vps/projects/elfandwonder | ro |
| /srv/frank/data/window | /data | rw |
| /srv/frank/previews/mini | /previews/mini | rw |
| /projects/mini-frank/customer-projects | /legacy-mini-projects | rw |

Container-visible names differ from host names (e.g. `blockwise` container path
maps to the pinned release workspace `blockwise-product-release-21a192cd2420`).

## Hindsight banks (API 0.6.1, healthy, loopback 9177)

- `steven-frank` (4 facts)
- `steven-unassigned` (164 facts)
- Bank template in profile config: `steven-{workspace}`; unassigned default
  `steven-unassigned`. `recall_max_tokens: 2048`; currently `auto_retain: true`
  (to be frozen to `false` behind the Session 5 admission adapter at cutover).

## Kanban (kanban.db, SQLite)

0 tasks; schema already carries `workspace_kind`, `workspace_path`,
`project_id`, `idempotency_key`, `claim_lock`, `worker_pid`, `max_in_progress`
semantics columns. No boards bound to projects yet.

## Consequences for the migration design (Session 1 contract)

1. `workspace_id` must be opaque and minted per canonical project slug; the
   resolver (Session 5) maps `workspace_id → {host_path, hermes_path,
   container_path}`; host↔container name divergence (blockwise case) is data,
   not code.
2. `memory_scope` stays the immutable legacy-derived private value
   (`steven-<slug>` / `steven-unassigned`); never re-derived from new IDs.
3. `board_binding_id` is an opaque Frank handle mapped privately to a native
   Hermes board slug (currently none exist; creation is a later, tested step).
4. Current `server.py` path construction (string-built from `projects.json`
   `root`) cannot remain authoritative; registry migration must quarantine
   relative roots and bind each project to a resolver-verified canonical path.
5. Stale Hermes `primary_path` (`/srv/projects/*`) must be corrected through a
   reviewed migration, never edited live by hand.
