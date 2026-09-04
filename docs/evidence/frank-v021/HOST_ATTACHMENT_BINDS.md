# Per-project .frank-attachments read-only binds (host change)

Date: 2026-09-03. Owner: Session 1 (integration). Contract: shared-estate
handoff §Attachments — "bind root = project root; whole-project read-only
bind, never per-batch".

## State

| Project (registry id) | Project root | Uploads partition | Bind |
| --- | --- | --- | --- |
| business-os | `/projects/business-os` | `/srv/frank/data/window/uploads/projects/business-os` | `/projects/business-os/.frank-attachments` (bind, ro) |

The `unassigned/` upload scope has no project root; it is never bound.

## Procedure (repeat per newly registered project with a live root)

1. `mkdir -p /srv/frank/data/window/uploads/projects/<id>` (root:root 755,
   matching the existing uploads tree; the container writes partitions
   through `/data/uploads`).
2. `mkdir -p /projects/<slug>/.frank-attachments && chown root:hermes &&
   chmod 2755` (mountpoint only; content comes from the bind).
3. systemd mount unit (path-escaped):
   `UNIT=$(systemd-escape -p --suffix=mount /projects/<slug>/.frank-attachments)`
   with `What=/srv/frank/data/window/uploads/projects/<id>`,
   `Options=bind,ro,nosuid,nodev`, `WantedBy=local-fs.target`;
   `systemctl enable --now`.
4. Append `.frank-attachments/` to `/projects/<slug>/.git/info/exclude`
   (maps/knowledge/Explorer exclusion is enforced in code via
   `HIDDEN_SEGMENTS` / `MOUNTPOINT_SEGMENTS`).

## Verification receipts

- `systemctl is-active projects-business\x2dos-.frank\x2dattachments.mount`
  → active; enabled for boot via `local-fs.target.wants`.
- `findmnt` → `ro,nosuid,nodev` on the bind target.
- `sudo -u hermes test -r ...` → OK (Hermes can read the whole-project view).
- Root write probe → "Read-only file system" (consumers cannot mutate).
- `.git/info/exclude` contains `.frank-attachments/`; project `git status`
  clean.

## Rollback

`sudo systemctl disable --now <unit> && sudo rm /etc/systemd/system/<unit>`
and `rmdir /projects/<slug>/.frank-attachments`. Uploads partitions are plain
directories and remain intact.
