#!/usr/bin/env bash
# Manual root-only consistent local backup for owner Mautic and ntfy. No off-host copy.
set -euo pipefail
out=/srv/frank/backups/owner-marketing
id="local-$(date -u +%Y%m%dT%H%M%SZ)"
fail(){ echo "owner marketing backup: $*" >&2; exit 2; }
for c in frank-owner-marketing frank-owner-marketing-db frank-owner-notifications; do docker inspect "$c" >/dev/null 2>&1 || fail "missing $c"; done
install -d -m 0700 -o root -g root "$out"
dir="$out/$id"; test ! -e "$dir" || fail 'backup id exists'; install -d -m 0700 -o root -g root "$dir"
# Native engine dump; credentials stay inside the database container.
docker exec frank-owner-marketing-db sh -lc 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --events --databases mautic' | gzip -c > "$dir/mautic.sql.gz"
# Explicit named volumes only, never a broad Docker/host traversal.
for v in frank_owner_marketing_config frank_owner_marketing_media frank_owner_notifications_cache; do
 docker run --rm -v "$v":/source:ro alpine:3.21 tar -C /source -czf - . > "$dir/$v.tar.gz"
done
configs=(/srv/frank/secrets/owner-marketing/owner-marketing.env /srv/frank/secrets/owner-notifications/server.yml /srv/frank/secrets/owner-notifications/owner-notifications.env)
for f in "${configs[@]}"; do [[ -f $f && ! -L $f ]] || fail "missing required private config"; done
tar -C / -czf "$dir/private-config.tar.gz" "${configs[@]#/}" 2>/dev/null || fail 'private config capture failed'
(cd "$dir"; sha256sum *.gz > SHA256SUMS)
printf '{"scope":"local-only","off_host":false,"mautic":"native mysqldump plus config/media","ntfy":"named auth/cache volume plus config","restore_claim":false}\n' > "$dir/receipt.json"
chmod -R go-rwx "$dir"; echo "$dir"
