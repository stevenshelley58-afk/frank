# Frank v0.21 Phase A 6/7/8 — full-state backup, restore drill, rollback matrix

Backup: `/srv/frank/backups/full-state/20260903T1058Z` (20G, 301,899 files,
manifest `SHA256SUMS.txt` verified with exit 0). Script:
`apps/window/scripts/frank_v021_full_backup.sh` (committed).

## What was captured

| Root | Method |
| --- | --- |
| Hermes SQLite DBs (`state.db`, `kanban.db`, `projects.db`, `response_store.db`, `verification_evidence.db`) | sqlite online `.backup()` (consistent while services run); WAL/SHM and `.lock` files excluded |
| Hindsight PostgreSQL (`hindsight-embed-hermes`) | `pg_dump -F c` (logical, consistent) → `hindsight.dump` + `hindsight.dbname` |
| `/home/hermes/.hermes` (sessions, tool_runs, worktrees, tool assets/checkpoints, skills, secrets, cron dir, config, notepad, sandboxes, response/state stores) | `rsync -a` (DBs replaced by consistent copies) |
| `/home/hermes/.hindsight` | `rsync -a` |
| `/srv/frank/data/window` (chats, uploads, maps, control-graph, evidence, connections) | `rsync -a` |
| `/srv/frank/secrets`, `/srv/frank/hermes-connections`, `/var/lib/frank/release` | `rsync -a` (secrets 0700) |
| Infisical DB / Redis | `pg_dump` via container + `dump.rdb` snapshot |
| Host config | systemd units, cron (root/hermes/cron.d), `/projects` + `/srv/frank` + `/srv/skills` perms/ACLs, docker inspect, mounts |

## Isolated restore verification (passed, 2026-09-03T11:01Z)

1. `sha256sum -c SHA256SUMS.txt` → exit 0 (no output = all OK).
2. Each restored SQLite DB opened read-only; expected tables present
   (state 25, kanban 8 incl. tasks, projects 4, response_store 2, evidence 4).
3. Hindsight logical restore drill: `CREATE DATABASE frank_v021_restore_drill`,
   `pg_restore --no-owner`, 15 public tables restored, all banks present
   (`steven-frank`, `steven-blockwise`, `steven-unassigned` + session-derived),
   drill database dropped. Live Hindsight was never touched.
4. No secret content printed at any step; secrets restored only under 0700.

## Immutable rollback identifiers (Phase A 7)

- Previous Frank image preserved as `frank-window:rollback-783f322a-20260903`
  (`sha256:783f322a0c9ad152cfa5008847f65e074144c95523169e8f0494ed999b34c064`),
  independent of the mutable `:current` tag.
- Previous approved-sha: `49d75ad79dcf1f89a18506e7af2a8abacd9b1487`.
- Previous Hermes runtime: dirty checkout at `ed1554a2fe` + live diff, now also
  captured as clean commit `350511412c` on branch
  `codex/frank-v021-tool-runs-recovery` (byte-identical files, hashes in
  PRODUCTION_BASELINE.md §4).

## Component rollback matrix (Phase A 8)

| Component | Rollback source | Procedure | New-state isolation rule |
| --- | --- | --- | --- |
| Frank image | `frank-window:rollback-783f322a-20260903` | recreate container via compose with previous image; data volume untouched | image rollback never touches `/srv/frank/data/window` |
| Frank data | `frank-data-window/` in this backup | stop window container, rsync back, start, run health canary | only with container stopped |
| Hermes binary/runtime | checkout `ed1554a2fe` (+ recovered diff `350511412c` if the pre-v0.21 behavior must be kept) | point `hermes-serve`/`hermes-gateway` ExecStart back to the old checkout | **old binary must only ever run against old/restored state root**; never against state written by v0.21 |
| Hermes state | `hermes-home/` in this backup | rsync to a NEW root, repoint `HERMES_HOME` | same pairing rule; v0.21 binary ↔ migrated clone only |
| Hindsight | `hindsight.dump` | create new DB, `pg_restore --no-owner` (drill proven); restart `hindsight-api` with restored instance | Hindsight schema unchanged by this release (client-side `auto_retain:false` config only) |
| STT | Hermes profile config in `hermes-home/` | restore config section; provider choice frozen in contract | n/a |
| Private bridge/gateway | `host-config/units.txt` + `/srv/frank/hermes-connections/` | reinstall units, restart | bridge is stateless |
| Infisical | `infisical-db.sql.gz` + `infisical-redis-dump.rdb` + named volumes preserved | pg_restore into new DB, recreate volumes only if destroyed | named volumes never `down -v`'d |
| Skills/mounts/ACLs | `host-config/acl.txt`, `projects-perms.txt` | re-apply recorded ACLs | cutover applied atomically in dependency order |

Rollback pairing invariant: every rollback pairs a binary with the state root of
the same schema generation; the final v0.21 cutover snapshot (taken at cutover
step 1) provides the old-binary-compatible state if v0.21 is rejected.
