# Frank v0.21 Phase B2 — production-state migration rehearsal receipt

Executed 2026-09-03T13:30–13:40Z. Restored clone:
`/srv/frank-canaries/rehearsal-v021-migrate` (420M state-only restore from
backup `20260903T1058Z`, runtime caches excluded: hermes-agent, worktrees,
tool_runs, tool_assets, tool_checkpoints, lsp, bin, logs, images, tool_releases).

## Pairing proofs

| Pairing | Result |
| --- | --- |
| Old binary (0.20.1, production venv) + restored root | `/api/status` healthy, `config_version 34`, `auth_required:false` — **PASS** |
| New binary (v0.21.0 clean `29112bef`) + migrated clone | `/api/status` healthy, `config_version 39` (auto-migrated 34→39 on first start), `auth_required:false` — **PASS** |

## Parity (backup → migrated clone)

| Sentinel | Backup | Migrated |
| --- | --- | --- |
| sessions | 67 | 67 |
| messages | 7,625 | 7,625 |
| tool_runs | 88 | 88 |
| kanban tasks | 0 | 0 |
| projects | 2 | 2 |
| state `schema_version` | 26 | 26 |
| newest session ID / transcript tip | `20260903_102551_1968ec` | identical byte-tip |

Compression-lineage table present (`compression_locks`, 0 rows). Config
migration wrote a rollback file (`config.yaml.rollback-1787214132`) and
carried the 13:14Z provider/model changes; state schema was NOT changed by
v0.21 (26 → 26) — the migration is config-level and non-destructive.

## Cron quiesce

No cron job definitions exist (`jobs.json` absent; `cron/executions.db` has 0
executions; only ticker heartbeat files). "Pause every copied job" is
trivially satisfied; the ticker in the rehearsal clone was never started
against a live delivery surface (no channels configured in the isolated
gateway block).

## Conclusions

1. The v0.21 migration is safe to run against a restored production clone at
   cutover; rollback pairing (old binary ↔ old root, new binary ↔ migrated
   clone) is proven independently.
2. Config migration 34→39 is automatic and reversible via the written
   rollback file; no state schema migration is required for sessions,
   transcripts, Kanban, projects, or tool runs.
3. Hindsight (0.6.1) is untouched by the Hermes migration; banks verified
   separately (restore drill, `BACKUP_AND_ROLLBACK.md`).

Raw probe logs: `/srv/frank-canaries/rehearsal-v021-migrate/*.log` (root-owned
area, hashes in `/secure/frank-v021/raw/rehearsal-manifest.sha256`).
