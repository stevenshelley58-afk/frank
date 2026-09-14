# Ad Radar per-run browser retention

Hourly, remove only closed `run-<UUID>` profiles under `/srv/hermes/ad-db/browser-home/profile` whose newest regular-file mtime is at least 24 hours old. Shared profiles, assets and source evidence are outside scope. Dry-run is default; `--apply` enables deletion. Fail closed on process or Docker inspection errors, any Chrome/Chromium process, symlink roots, and intersecting running/stopped container mounts or runtime file references. Two batch snapshots avoid per-folder process scans. Run only as root. Capture producer is currently Apify-only; do not enable concurrent local capture without coordinating retention ownership.

Install from an immutable committed copy using `install.sh /absolute/immutable/component/path`. The timer runs hourly and retains its most recent manifest in `/srv/cleanup-evidence/browser-retention-latest.json`. Disable with `systemctl disable --now ad-radar-browser-retention.timer`.

Directory mtimes are ignored because cache removal changes them. Symlinks within profiles are unlinked, never traversed.
