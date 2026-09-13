#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd -P)"
runtime=/srv/hermes/owner-mail-events
secret=/srv/hermes/secrets/owner-mail-events.env
die(){ echo "owner-mail-events deploy: $*" >&2; exit 1; }
[[ $(id -u) -eq 0 ]] || die "run as root"
cd "$repo_root"
git diff --quiet && git diff --cached --quiet && [[ -z $(git status --porcelain) ]] || die "committed clean checkout required"
for f in apps/window/owner_mail_events.py apps/window/owner_mail_reply.py apps/window/infra/owner_email_flows/mautic_flows.py "$script_dir/owner_mail_events_app.py" "$script_dir/requirements.txt" "$script_dir/owner-mail-events.service"; do [[ -f "$f" ]] || die "missing $f"; done
[[ -f "$secret" && ! -L "$secret" && $(stat -c '%U:%a' "$secret") == root:600 ]] || die "root-only secret file required"
for key in RESEND_WEBHOOK_SECRET OWNER_MAIL_EVENTS_RESEND_API_KEY OWNER_MAIL_EVENTS_MAUTIC_USERNAME OWNER_MAIL_EVENTS_MAUTIC_PASSWORD OWNER_MAIL_REPLY_SECRET; do grep -q "^${key}=." "$secret" || die "missing $key"; done
id hermes >/dev/null; command -v python3 >/dev/null; command -v systemctl >/dev/null
sha=$(git rev-parse HEAD); release="$runtime/releases/$sha"
install -d -o root -g root -m 0755 "$runtime/releases" "$release"
install -o root -g root -m 0644 apps/window/owner_mail_events.py "$release/owner_mail_events.py"
install -o root -g root -m 0644 apps/window/owner_mail_reply.py "$release/owner_mail_reply.py"
install -o root -g root -m 0644 apps/window/infra/owner_email_flows/mautic_flows.py "$release/mautic_flows.py"
install -o root -g root -m 0644 "$script_dir/owner_mail_events_app.py" "$release/owner_mail_events_app.py"
if [[ ! -x "$runtime/venv/bin/gunicorn" ]]; then python3 -m venv "$runtime/venv"; "$runtime/venv/bin/pip" install --disable-pip-version-check -r "$script_dir/requirements.txt"; fi
ln -sfn "$release" "$runtime/current.new"; mv -Tf "$runtime/current.new" "$runtime/current"
install -o root -g root -m 0644 "$script_dir/owner-mail-events.service" /etc/systemd/system/owner-mail-events.service
systemctl daemon-reload; systemctl enable --now owner-mail-events.service; systemctl restart owner-mail-events.service
for _ in $(seq 1 20); do curl -fsS --max-time 2 http://172.16.1.1:18085/health >/dev/null && break; sleep 1; done
curl -fsS --max-time 2 http://172.16.1.1:18085/health >/dev/null || die "private receiver health check failed"
echo "owner-mail-events deployed $sha"
