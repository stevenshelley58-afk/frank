# Wave 3 task packets (pre-staged by AG-0)

Dispatch ONLY after Gate G3 passes (HITL-01/02 API proof + phone approval proof).
GOV-06 resolved: orca/stably = CONTINUE-BUILD (no surface replacement).
Contracts frozen: `docs/plans/WORKBENCH_API_CONTRACT.md`.

## Packet FS-W3: FS-01..FS-06 (AG-5)

Branch `agent/fs/connected-folders` from post-G3 main. Allowed paths:
`apps/api/src/services/folders/`, `apps/api/src/routes/folders.ts`,
`adapters/storage/postgres/migrations/000N_folder_bindings.sql`,
`apps/api/src/services/workbench/provisioner.ts` (mount plumbing ONLY,
interface via AG-3 seam), tests. Needs VPS access (ssh vps) for Syncthing.

- **FS-01** Syncthing between Steven's Windows PC and VPS: device identity
  exchange, firewall (Syncthing port only), `.stignore`, recovery doc.
  DEFAULT: PC Send Only / VPS Receive Only. Verify: test file reaches VPS;
  PC offline does not stop a running workbench. (Human-gated: Syncthing
  install on the PC — flag, don't block.)
- **FS-02** Room folder bindings: record {source, server_path, sync_direction,
  mount_mode ro|rw|staged, write_back bool} + CRUD API. Workbench receives
  ONLY folders bound to its room AND named in its task def.
- **FS-03** Mount plumbing + staged shared writes: bind synced copies into
  workbenches (provisioner seam); shared-folder write → staged copy +
  decision work item (HITL-01 path); approved write lands via controlled
  operation OUTSIDE the harness. Direct shared write fails; approved staged
  write succeeds + fully audited.
- **FS-04** Write-back opt-in per folder; offline PC = `results waiting to
  sync` status, NOT workbench failure; conflicts surfaced honestly, never
  auto-destructive override. NO live write-back claims to offline devices.
- **FS-05** Artifact + preview backend (extends WB-08): register files into
  room Files, classify kind, auto-deploy viewable HTML/reports to preview
  lane (preview-deploy.sh), return preview URL to receipt + UI.
- **FS-06** Acceptance: CSV cleanup E2E — source synced, laptop closed,
  workbench completes on VPS copy, result marked waiting-to-sync, PC
  reconnects and receives result ONLY if write-back enabled.

Gate: G4. Rollback: drop migration + routes; stop syncthing service.

## Packet SS-W3: SS-01..SS-05 (AG-6)

Branch `agent/ss/schedules-sandbox` from post-G3 main. Allowed paths:
`apps/api/src/services/workbench/scheduling/`, egress profile config,
`apps/api/src/services/workbench/` (selection wiring ONLY via AG-3 seam),
tests.

- **SS-01** taskDef carries {cron, tz}; each firing → NEW work item + NEW
  workbench; zero shared scratch state between consecutive runs (test it).
- **SS-02** Goose schedule as interim trigger → run routed through normal
  runner/receipt/audit/verification. Verify: test schedule fires with all
  clients closed, leaves receipt in the intended room.
- **SS-03** `srt` (sandbox-runtime) wrap: task-specific egress allowlists,
  filesystem policy preserved. Verify: curl to non-allowlisted domain FAILS
  inside workbench; allowlisted access succeeds.
- **SS-04** microsandbox pilot ONLY if `ls /dev/kvm` succeeds on VPS
  (WB-00 facts decide; absence → close task not-applicable, no host change).
- **SS-05** Per-task harness/model selection via provider registry; no
  hardcoded provider in runner.

Gate: G4. Rollback: revert branch; remove schedule rows.

## Packet UI-W3: UI-08 + UI-09 (AG-2)

Branch `agent/ui/files-channels` from post-FS-02/FS-05-contracts. Allowed
paths: `apps/web/src/` (files panel, folder-binding controls, channel
binding status). Needs FS-02/FS-05 + CH-06 backend contracts.

- **UI-08** Room folder-binding controls (send-only/receive-only/write-back
  states explicit), results-waiting-to-sync status, artifacts panel,
  download + preview URL affordances, staged shared-write approval detail.
- **UI-09** Bind/inspect room↔Telegram conversation; truthful health; web
  frame stays authoritative when channel down.

Gate: G4/G5. Rollback: revert branch.

## Packet CH-W3: CH-06 + CH-07 (AG-4)

Branch `agent/ch/room-binding` from post-CH-05. Allowed paths:
`adapters/collaboration/channels/`, `apps/channels-listener/`.

- **CH-06** Bind rooms↔Telegram conversations; push brief/Waiting/selected
  Running state via outbox; frame discipline (no per-step streaming into
  chat); message UPDATE, not card spam. Channel outage must not alter web
  state or canonical records (test with listener killed).
- **CH-07** Action retention policy; resolved/expired card behavior;
  delivery retry + dead-letter audit; SDK lifecycle upgrade smoke test;
  documented Grammy exit path behind ChannelPort.

Gate: G4. Rollback: revert branch.

## Dispatch order inside Wave 3

1. FS-W3 + SS-W3 immediately after G3 (independent).
2. CH-W3 immediately after G3 (needs stable outbox events — verify first).
3. UI-W3 after FS-02/FS-05 + CH-06 contracts land (can start mock-first
   against frozen contracts if AG-5 publishes them early).
