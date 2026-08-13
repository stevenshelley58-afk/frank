# FS prep (AG-5) — Wave 0 notes only. No integration before Gate G3.

Recorded 2026-08-06. Companion to `FRANK_MASTER_PARALLEL_BUILD_PLAN.md` §8G.

## Syncthing deployment checklist (FS-01, executes at G3)

1. Install Syncthing on VPS: `apt install syncthing` + systemd unit
   `syncthing@root` (or dedicated `frank-sync` user). Port 22000/tcp + 8384
   (GUI on 127.0.0.1 only, Caddy-fronted if remote access wanted).
2. Install Syncthing-Fork (or official app) on Steven's Pixel 10 / Windows PC.
   Windows: SyncTrayzor.
3. Exchange device IDs (VPS ↔ PC). **Never put device IDs in the repo.**
4. Folder model: `/frank/deployed/sync/<room-id>/<folder>` on VPS, one folder per
   bound room folder. `.stignore` excludes `.env*`, `*.secret`, `node_modules`,
   `~*` temp files.
5. Direction default: **PC Send Only, VPS Receive Only.** Write-back is an
   explicit per-folder opt-in recorded in the room folder binding (FS-02).
6. Firewall: 22000/tcp open; GUI never exposed.
7. Recovery: `syncthing cli config` backup at `/frank/deployed/infra/syncthing/`;
   re-pair procedure documented in docs/ops.

## Backend interface proposal (FS-02)

```ts
interface RoomFolderBinding {
  id: string;
  roomId: string;
  label: string;                 // human name
  serverPath: string;            // /frank/deployed/sync/<room>/<folder>
  syncDirection: 'pc-to-vps' | 'vps-to-pc' | 'bidirectional';
  mountMode: 'ro' | 'rw' | 'staged';
  writeBackEnabled: boolean;     // default false
  syncStatus: 'synced' | 'waiting-to-sync' | 'conflict' | 'offline';
}
```

- API: `GET/POST /v1/rooms/:id/folders`, `PATCH /v1/rooms/:id/folders/:fid`
  (write-back toggle only via command envelope with audit).
- Workbench mount source = binding.serverPath, mode from binding ∩ taskDef.
- Shared-folder write ⇒ staged copy + decision work item (ADR-022) before
  landing; approved write lands through runner-controlled copy, never the
  harness process.

## End-to-end test fixture (FS-06)

`fixtures/fs-e2e/`: 50-row CSV with known duplicates + expected cleaned output.
Steps: sync → close PC → workbench runs against VPS copy → result staged →
"waiting to sync" shown → PC reconnects → write-back only if enabled.

## Open facts for G3

- Syncthing not yet installed on VPS (checked 2026-08-06: no binary, no unit).
- `/srv` has 141G free — ample for sync copies.
