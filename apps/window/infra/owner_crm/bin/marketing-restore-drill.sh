#!/usr/bin/env bash
# Restore owner Mautic and ntfy only into disposable, networkless engines.
set -euo pipefail
backup_root=/srv/frank/backups/owner-marketing
mysql_image='mysql@sha256:85b9bf2e29cf836ecb8c2a15a935d4ba0c606631dff1dd79531a11983c638f2a'
sqlite_image='keinos/sqlite3@sha256:f8c752a4c90a1a86c48e2fcf30010c8f5e7e521e23852f6c66e0845b5b431f25'
fail(){ echo "owner marketing restore drill: $*" >&2; exit 2; }
test "$(id -u)" = 0 || fail 'must run as root'
[[ $# -le 1 ]] || fail 'usage: marketing-restore-drill.sh [backup-directory]'
if [[ $# -eq 1 ]]; then
  dir=$(realpath -e -- "$1")
else
  dir=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'local-*' -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')
  test -n "$dir" || fail 'no local backup found'
  dir=$(realpath -e -- "$dir")
fi
[[ "$dir" == "$backup_root"/local-* ]] || fail 'backup must be a local owner-marketing archive'
test ! -L "$dir" && test "$(stat -c %u "$dir")" = 0 || fail 'backup must be root owned'
for f in mautic.sql.gz frank_owner_marketing_config.tar.gz frank_owner_marketing_media.tar.gz ntfy-sqlite.tar.gz private-config.tar.gz mautic-source.tsv ntfy-source.tsv config-source.sha256 media-source.sha256 private-source.sha256 SHA256SUMS; do
  test -f "$dir/$f" && test ! -L "$dir/$f" || fail "missing artifact: $f"
done
(cd "$dir"; sha256sum -c SHA256SUMS >/dev/null)
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
work=$(mktemp -d "$backup_root/.restore-$run_id.XXXXXX")
db="owner-marketing-restore-$run_id"
password=$(openssl rand -hex 24)
cleanup(){ docker rm -f "$db" >/dev/null 2>&1 || true; rm -rf -- "$work"; }
trap cleanup EXIT
docker run -d --name "$db" --network none --tmpfs /var/lib/mysql:rw,nosuid,noexec,size=1073741824 -e MYSQL_ROOT_PASSWORD="$password" "$mysql_image" --skip-log-bin >/dev/null
ready=false
for _ in $(seq 1 90); do
  if docker exec -e MYSQL_PWD="$password" "$db" mysql -uroot -N -e "SELECT 1" >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true || fail 'isolated MySQL did not become ready'
docker exec -e MYSQL_PWD="$password" "$db" mysql -uroot -e 'CREATE DATABASE IF NOT EXISTS mautic CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;'
echo "restore drill: importing Mautic dump" >&2
gzip -cd "$dir/mautic.sql.gz" | docker exec -i -e MYSQL_PWD="$password" "$db" mysql -uroot mautic
mysql_counts(){
  docker exec "$db" sh -euc '
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    mysql -uroot -N mautic -e "SHOW FULL TABLES WHERE Table_type = CHAR(66,65,83,69,32,84,65,66,76,69)" | cut -f1 |
    while IFS= read -r table; do
      [[ $table =~ ^[A-Za-z0-9_]+$ ]]
      count=$(mysql -uroot -N mautic -e "SELECT COUNT(*) FROM $table")
      printf "%s\t%s\n" "$table" "$count"
    done
  '
}
echo "restore drill: counting restored Mautic tables" >&2
mysql_counts > "$work/mautic-restored.tsv"
diff -u "$dir/mautic-source.tsv" "$work/mautic-restored.tsv" >/dev/null || fail 'Mautic table counts differ from live source'
tree_hashes(){ docker run --rm -v "$1":/source:ro alpine:3.21 sh -euc 'cd /source; find . -type f -print0 | sort -z | xargs -0r sha256sum'; }
mkdir "$work/config" "$work/media" "$work/private"
tar -C "$work/config" -xzf "$dir/frank_owner_marketing_config.tar.gz"
tar -C "$work/media" -xzf "$dir/frank_owner_marketing_media.tar.gz"
tar -C "$work/private" -xzf "$dir/private-config.tar.gz"
tree_hashes "$work/config" > "$work/config-restored.sha256"
tree_hashes "$work/media" > "$work/media-restored.sha256"
diff -u "$dir/config-source.sha256" "$work/config-restored.sha256" >/dev/null || fail 'Mautic config hashes differ from live source'
diff -u "$dir/media-source.sha256" "$work/media-restored.sha256" >/dev/null || fail 'Mautic media hashes differ from live source'
configs=(srv/frank/secrets/owner-marketing/owner-marketing.env srv/frank/secrets/owner-notifications/server.yml srv/frank/secrets/owner-notifications/owner-notifications.env)
( cd "$work/private"; sha256sum "${configs[@]}" ) > "$work/private-restored.sha256"
diff -u "$dir/private-source.sha256" "$work/private-restored.sha256" >/dev/null || fail 'private runtime config hashes differ from live source'
mkdir "$work/ntfy-restored"
tar -C "$work/ntfy-restored" -xzf "$dir/ntfy-sqlite.tar.gz"
sqlite_counts(){
  docker run --rm --user 0:0 --entrypoint sh -v "$1":/data:ro "$sqlite_image" -euc '
    for db in cache.db user.db; do
      test "$(sqlite3 "file:/data/$db?mode=ro" "PRAGMA integrity_check;")" = ok
      sqlite3 "file:/data/$db?mode=ro" "SELECT name FROM sqlite_schema WHERE type=char(116,97,98,108,101) ORDER BY name" |
      while IFS= read -r table; do count=$(sqlite3 "file:/data/$db?mode=ro" "SELECT COUNT(*) FROM \"$table\""); printf "%s\t%s\t%s\n" "$db" "$table" "$count"; done
    done
  ' > "$2"
}
sqlite_counts "$work/ntfy-restored" "$work/ntfy-restored.tsv"
diff -u "$dir/ntfy-source.tsv" "$work/ntfy-restored.tsv" >/dev/null || fail 'ntfy table counts differ from live source'
receipt="$dir/restore-receipt-$run_id.json"
mautic_tables=$(wc -l < "$work/mautic-restored.tsv")
ntfy_tables=$(wc -l < "$work/ntfy-restored.tsv")
config_files=$(wc -l < "$work/config-restored.sha256")
media_files=$(wc -l < "$work/media-restored.sha256")
jq -n --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson mautic_tables "$mautic_tables" --argjson ntfy_tables "$ntfy_tables" --argjson config_files "$config_files" --argjson media_files "$media_files" '{accepted_at:$at,isolated_mysql_network:"none",production_db_changed:false,checksums:true,mautic:{all_table_counts_match:true,tables:$mautic_tables},mautic_config:{all_hashes_match:true,files:$config_files},mautic_media:{all_hashes_match:true,files:$media_files},ntfy:{all_table_counts_match:true,integrity_check:"ok",tables:$ntfy_tables},private_configs:{all_hashes_match:true,contents_not_exposed:true}}' > "$receipt"
chmod 0600 "$receipt"
trap - EXIT
docker rm -f "$db" >/dev/null
rm -rf -- "$work"
echo "$receipt"
