#!/bin/bash
# Frank v0.21 full-state backup (Phase A step 6 / cutover step 1).
# Captures every state root the release contract protects, with consistent
# SQLite online backups and a PostgreSQL logical dump for Hindsight.
# Never prints secret contents; emits a checksum manifest and restore notes.
set -euo pipefail

STAMP="${1:?usage: frank_v021_full_backup.sh <stamp>}"
if [[ ! "$STAMP" =~ ^[0-9TZ:-]+$ ]]; then echo "bad stamp" >&2; exit 2; fi
DEST="/srv/frank/backups/full-state/$STAMP"
if [[ -e "$DEST" ]]; then echo "destination exists: $DEST" >&2; exit 2; fi
install -d -o root -g root -m 0750 "$DEST"

log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# 1. Consistent SQLite online backups for every live Hermes DB.
STAGE="$DEST/.sqlite-stage"; install -d -m 0700 "$STAGE"
for db in /home/hermes/.hermes/*.db; do
  name="$(basename "$db")"
  log "sqlite online backup: $name"
  python3 - "$db" "$STAGE/$name" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
out = sqlite3.connect(dst)
src_con = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
src_con.backup(out)
out.close(); src_con.close()
PY
done

# 2. Consistent Hindsight PostgreSQL logical dump (embedded instance, live).
PG_BIN=/home/hermes/.pg0/installation/18.1.0/bin
log "pg_dump hindsight"
PGPASSWORD="$(python3 -c "import json; print(json.load(open('/home/hermes/.pg0/instances/hindsight-embed-hermes/instance.json'))['password'])")" \
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p 5432 -U hindsight -d hindsight \
  -F c -f "$STAGE/hindsight.dump" || {
  log "pg_dump failed" >&2
  exit 3
}
python3 -c "import json; print(json.load(open('/home/hermes/.pg0/instances/hindsight-embed-hermes/instance.json'))['database'])" > "$STAGE/hindsight.dbname"
mv "$STAGE/hindsight.dump" "$DEST/hindsight.dump"
mv "$STAGE/hindsight.dbname" "$DEST/hindsight.dbname"

# 3. rsync state roots. DB files come from the consistent stage copies.
rsync_a() { log "rsync $1"; rsync -a --delete "$1" "$2"; }
rsync_a /home/hermes/.hermes/ "$DEST/hermes-home/"
find "$DEST/hermes-home" -maxdepth 1 -name '*.db' -delete
find "$DEST/hermes-home" -maxdepth 1 -name '*.db-wal' -delete
find "$DEST/hermes-home" -maxdepth 1 -name '*.db-shm' -delete
rm -f "$DEST/hermes-home/kanban.db.dispatch.lock" "$DEST/hermes-home/kanban.db.init.lock"
cp -a "$STAGE"/*.db "$DEST/hermes-home/"
rsync_a /home/hermes/.hindsight/ "$DEST/hindsight-home/"
rsync_a /srv/frank/data/window/ "$DEST/frank-data-window/"
rsync_a /srv/frank/secrets/ "$DEST/frank-secrets/"
rsync_a /srv/frank/hermes-connections/ "$DEST/frank-hermes-connections/"
rsync_a /var/lib/frank/release/ "$DEST/frank-release/"
chmod -R go-rwx "$DEST/frank-secrets"

# 4. Docker named volumes for Infisical + Frank private state (db via dump).
log "infisical pg_dump"
docker exec infisical-db sh -c 'pg_dump -U "${POSTGRES_USER:-infisical}" "${POSTGRES_DB:-infisical}"' \
  | gzip > "$DEST/infisical-db.sql.gz"
log "infisical redis snapshot"
docker exec infisical-redis sh -c 'cat /data/dump.rdb 2>/dev/null || true' > "$DEST/infisical-redis-dump.rdb" || true

# 5. Configuration: units, cron, mounts, ACLs (metadata only).
CFG="$DEST/host-config"; install -d -m 0700 "$CFG"
systemctl cat hermes-serve hermes-gateway hermes-frank-vault-broker hindsight-frank-proxy.service hindsight-frank-proxy.socket > "$CFG/units.txt" 2>&1 || true
ls /etc/systemd/system > "$CFG/system-units-list.txt"
crontab -l > "$CFG/cron-root.txt" 2>&1 || true
su hermes -s /bin/sh -c 'crontab -l' > "$CFG/cron-hermes.txt" 2>&1 || true
for f in /etc/cron.d/*; do printf '=== %s\n' "$f"; cat "$f"; done > "$CFG/cron-d.txt"
find /projects -maxdepth 2 -printf '%M %u:%g %p\n' | sort > "$CFG/projects-perms.txt"
getfacl -R -p /projects /srv/frank /srv/skills > "$CFG/acl.txt" 2>/dev/null || true
docker inspect frank-window frank-caddy infisical-backend infisical-db infisical-redis > "$CFG/docker-inspect.json"
mount > "$CFG/mounts.txt"
sha256sum /home/hermes/.hermes/hermes-agent/gateway/tool_run_api.py >> "$CFG/live-hermes-tool-runs.sha256"

# 6. Manifest and restore notes (manifest excludes itself and the stage dir).
log "manifest (this hashes ~30G; takes a few minutes)"
rm -rf "$STAGE"
( cd "$DEST" && find . -type f ! -name SHA256SUMS.txt -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.txt ) || true
cat > "$DEST/RESTORE_NOTES.md" <<'EOF'
# Restore procedure (verified by the isolated drill)
1. Restore is always into a NEW versioned root, never over live state:
   rsync -a hermes-home/ /home/hermes/.hermes-restored-<stamp>/
2. Hindsight: create a NEW database and restore the logical dump:
   PGPASSWORD=<from live instance.json> $PG_BIN/pg_restore -h 127.0.0.1 -p 5432 \
     -U hindsight -d <newdb> --no-owner hindsight.dump
   Never point an old binary at state written by a newer schema; see the
   rollback pairing matrix.
3. Frank data: rsync frank-data-window/ back under /srv/frank/data/window
   only with the container stopped or after diffing.
4. Verify: sha256sum -c SHA256SUMS.txt (subset) and open each restored DB
   with sqlite3 in ro mode; compare table counts against receipt.
EOF
log "DONE: $DEST"
du -sh "$DEST"
