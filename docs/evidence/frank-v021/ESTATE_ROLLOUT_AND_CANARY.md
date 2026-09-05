# Shared-estate live rollout + canary status (Session 1)

Date: 2026-09-03. Production SHA: `22b8d30c0550d1b31db3d129faac3d2e891a9ee9`
(`FRANK_V021_FOUNDATION=1`, flag served from the root-owned env file, not
deploy-time interpolation).

## Live rollout receipts

- Config 34→39 migration on the live Hermes root verified (pre-migration
  backup `config-v34-pre-migration-1541Z.yaml`); Kanban freeze flags
  `auto_decompose`/`auto_subscribe_on_create` both false.
- `/srv/skills` cutover executed via the emitted S5 scripts: 38 unique valid
  operator skills promoted atomically (backup
  `/srv/skills.previous.20260903T160213Z`), checksum parity OK
  (`dbc96b6f…`). Two code fixes were required first (see "Issues found and
  fixed").
- Registry re-seeded: 6 project workspaces + `unassigned`, all `active` with
  canonical `/projects/<slug>` host paths. Legacy relative roots are
  absolutized at seed time; the previous quarantined registry is preserved
  as `workspace-registry.json.quarantined-*`.
- Per-project attachments bind: `business-os` `.frank-attachments` ro bind
  via systemd mount unit (see `HOST_ATTACHMENT_BINDS.md`).
- Codex ACLs applied via `setup_codex_user.sh` (ACL-based, not chgrp) for
  `business-os` + `v021canary-estate`: group `frank-proj-<slug>` rwX with
  default ACL inheritance; Hermes group access preserved without restarts.

## Canary (test group 10) — status

**PROVEN live:**
- Disposable project registered (`v021canary-estate`), resolves to its
  canonical host path.
- `POST /internal/workspaces` resolve: 403 without credential, 503 when
  unconfigured, 200 with canonical path for active workspaces only.
- Lease lifecycle: acquire 201 → heartbeat → release 200; second acquire
  while held → **409** (exclusivity); release with wrong generation → 409.
- Launcher `launch_codex_task.sh` end-to-end as the `codex` OS user: resolve
  → acquire → heartbeat loop → enters checkout → verified exit → release.
- ACL write probe: codex created/removed a probe file in a registered root;
  Hermes write access unchanged.
- Negative plane isolation: codex user → Hermes serve kanban plane
  (127.0.0.1:9119) → 401; codex user → API server (127.0.0.1:18642) → 401.
  (Frank's SPA fallback returns 200 HTML for unknown paths — no API.)

**NOT_PROVEN (external blocker):**
- Live Codex model calls: the Codex account hit its usage limit (resets
  Sep 7 2026). The in-lease file mutation, the Hermes→Codex→Hermes
  cross-generation sequence, and shared-skill invocation from a live Codex
  run remain unproven until then. The lease mechanics around the task are
  proven above; rerun the protocol when quota resets.

## Issues found and fixed during rollout

1. Skills inventory missed nested category roots (`github/github-issues`
   style) — recursive discovery added + tests (quadrupled coverage:
   10→104 hermes skills inventoried).
2. Emitted `check_checksum_parity.sh` had an invalid heredoc terminator
   (`PY")` instead of `PY` + `)"`) — fixed; `bash -n` added to tests.
3. Dockerfile did not ship the foundation/work-routines/hermes-adapter/
   infra modules — container crash-looped on first foundation deploy
   (brief production outage, ~3 min, restored by rebuild).
4. Registry seeding passed raw relative roots → all workspaces quarantined.
5. Private lease/resolve endpoints were never registered — wired.
6. Foundation flag via compose interpolation silently defaulted to 0 on
   bare `docker compose up` — moved to the root-owned env file.
7. Hindsight embedded daemon was down (SIGTERMed by earlier gateway
   restart); restarted via its own embed manager; deploy's expose.sh gate
   then passed.
