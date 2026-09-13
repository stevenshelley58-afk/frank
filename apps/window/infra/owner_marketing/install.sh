#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; compose_file="$script_dir/compose.yml"; die(){ echo "owner-marketing install: $*" >&2; exit 1; }
cd "$script_dir/../../../.."; [[ -z "$(git status --porcelain)" ]] || die dirty-or-untracked-source; git ls-files --error-unmatch apps/window/infra/owner_marketing/compose.yml apps/window/infra/owner_marketing/nginx.conf apps/window/infra/owner_marketing/deploy.sh apps/window/infra/owner_marketing/install.sh apps/window/infra/owner_marketing/check.sh >/dev/null || die untracked-source; cd "$script_dir"
secret_dir=/srv/frank/secrets/owner-marketing; env_file="$secret_dir/owner-marketing.env"; [[ -f "$env_file" && ! -L "$env_file" ]] || die missing-secret; [[ "$(stat -c '%U:%a' "$secret_dir")" == root:700 && "$(stat -c '%U:%a' "$env_file")" == root:600 ]] || die unsafe-secret-permissions
set -a; source "$env_file"; set +a
[[ -n "${MAUTIC_ADMIN_PASSWORD:-}" ]] || die missing-admin-secret
docker inspect frank-owner-marketing frank-owner-marketing-db frank-owner-marketing-ingress >/dev/null 2>&1 || die missing-containers; [[ "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing)" == healthy && "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing-db)" == healthy && "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing-ingress)" == healthy ]] || die unhealthy
existing_tables="$(docker exec frank-owner-marketing-db sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"mautic\""')"; [[ "$existing_tables" == 0 ]] || die database-not-empty
site_url="${MAUTIC_PUBLIC_URL:-http://127.0.0.1:${MAUTIC_HOST_PORT}}"
docker exec -w /var/www/html frank-owner-marketing php bin/console mautic:install "$site_url" --force --no-interaction --db_driver=pdo_mysql --db_host=db --db_port=3306 --db_name=mautic --db_user=mautic --db_password="$MAUTIC_DB_PASSWORD" --db_backup_tables=false --admin_firstname=Owner --admin_lastname=Marketing --admin_username=owner --admin_email=owner@localhost.invalid --admin_password="$MAUTIC_ADMIN_PASSWORD"
"$script_dir/check.sh"
