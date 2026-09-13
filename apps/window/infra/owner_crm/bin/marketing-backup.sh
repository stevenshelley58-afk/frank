#!/usr/bin/env bash
# Manual root-only consistent local backup for owner Mautic and ntfy. No off-host copy.
set -euo pipefail
out=/srv/frank/backups/owner-marketing
id="local-$(date -u +%Y%m%dT%H%M%SZ)"
sqlite_image='keinos/sqlite3@sha256:f8c752a4c90a1a86c48e2fcf30010c8f5e7e521e23852f6c66e0845b5b431f25'
fail(){ echo "owner marketing backup: $*" >&2; exit 2; }
test "$(id -u)" = 0 || fail 'must run as root'
for c in frank-owner-marketing frank-owner-marketing-db frank-owner-ntfy; do docker inspect "$c" >/dev/null 2>&1 || fail "missing $c"; done
install -d -m 0700 -o root -g root "$out"
dir="$out/$id"; partial="$out/.$id.partial"
test ! -e "$dir" && test ! -e "$partial" || fail 'backup id exists'
install -d -m 0700 -o root -g root "$partial"
cleanup(){ rm -rf -- "$partial"; }
trap cleanup EXIT
mysql_counts(){
  docker exec frank-owner-marketing-db sh -euc '
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    mysql -uroot -N mautic -e "SHOW FULL TABLES WHERE Table_type = CHAR(66,65,83,69,32,84,65,66,76,69)" | cut -f1 |
    while IFS= read -r table; do
      [[ $table =~ ^[A-Za-z0-9_]+$ ]]
      count=$(mysql -uroot -N mautic -e "SELECT COUNT(*) FROM $table")
      printf "%s\t%s\n" "$table" "$count"
    done
  '
}
tree_hashes(){ docker run --rm -v "$1":/source:ro alpine:3.21 sh -euc 'cd /source; find . -type f -print0 | sort -z | xargs -0r sha256sum'; }
sqlite_counts(){
  docker run --rm --user 0:0 --entrypoint sh -v "$1":/data:ro "$sqlite_image" -euc '
    for db in cache.db user.db; do
      test "$(sqlite3 "file:/data/$db?mode=ro" "PRAGMA integrity_check;")" = ok
      sqlite3 "file:/data/$db?mode=ro" "SELECT name FROM sqlite_schema WHERE type=char(116,97,98,108,101) ORDER BY name" |
      while IFS= read -r table; do count=$(sqlite3 "file:/data/$db?mode=ro" "SELECT COUNT(*) FROM \"$table\""); printf "%s\t%s\t%s\n" "$db" "$table" "$count"; done
    done
  '
}
docker exec frank-owner-marketing-db sh -lc 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events --databases mautic' | gzip -c > "$partial/mautic.sql.gz"
for v in frank_owner_marketing_config frank_owner_marketing_media; do
  docker run --rm -v "$v":/source:ro alpine:3.21 tar -C /source -czf - . > "$partial/$v.tar.gz"
done
# SQLite's online backup API is safe for a live ntfy database, including WAL mode.
install -d -m 0700 "$partial/ntfy-sqlite"
docker run --rm --user 0:0 --entrypoint sh -v frank_owner_notifications_cache:/source:ro -v "$partial/ntfy-sqlite":/backup "$sqlite_image" -euc '
  for name in cache.db user.db; do
    test -f "/source/$name"
    sqlite3 "file:/source/$name?mode=ro" ".backup /backup/$name"
    test "$(sqlite3 "/backup/$name" "PRAGMA integrity_check;")" = ok
  done
'
sqlite_counts "$partial/ntfy-sqlite" > "$partial/ntfy-source.tsv"
tar -C "$partial/ntfy-sqlite" -czf "$partial/ntfy-sqlite.tar.gz" cache.db user.db
rm -rf -- "$partial/ntfy-sqlite"
configs=(/srv/frank/secrets/owner-marketing/owner-marketing.env /srv/frank/secrets/owner-notifications/server.yml /srv/frank/secrets/owner-notifications/owner-notifications.env)
for f in "${configs[@]}"; do [[ -f $f && ! -L $f ]] || fail "missing required private config"; done
tar -C / -czf "$partial/private-config.tar.gz" "${configs[@]#/}" 2>/dev/null || fail 'private config capture failed'
mysql_counts > "$partial/mautic-source.tsv"
tree_hashes frank_owner_marketing_config > "$partial/config-source.sha256"
tree_hashes frank_owner_marketing_media > "$partial/media-source.sha256"
( cd /; sha256sum "${configs[@]#/}" ) > "$partial/private-source.sha256"
(cd "$partial"; sha256sum *.gz *.tsv *.sha256 > SHA256SUMS)
printf '{"scope":"local-only","off_host":false,"mautic":"native mysqldump plus config/media","ntfy":"SQLite online backup plus private config","restore_claim":false}\n' > "$partial/receipt.json"
chmod -R go-rwx "$partial"
mv "$partial" "$dir"
trap - EXIT
echo "$dir"
