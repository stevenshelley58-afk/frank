#!/usr/bin/env bash
set -Eeuo pipefail
component=apps/window/infra/owner_identity/trusted_device; canonical=/projects/frank; service=frank-trusted-device.service; release_root=/srv/frank/releases/trusted-device; secret=/srv/frank/secrets/owner-trusted-devices.json
die(){ echo "trusted-device install: $*" >&2; exit 1; }
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P); repo=$(git -C "$here" rev-parse --show-toplevel)
[[ "$repo" == "$canonical" ]] || die must-run-from-canonical-source
[[ "$(git -C "$canonical" branch --show-current)" == main ]] || die canonical-source-not-main
git -C "$canonical" diff --quiet HEAD -- "$component" || die component-has-uncommitted-source
[[ -z "$(git -C "$canonical" ls-files --others --exclude-standard -- "$component")" ]] || die component-has-untracked-source
git -C "$canonical" ls-files --error-unmatch "$component/server.py" "$component/$service" "$component/install.sh" >/dev/null
sha=$(git -C "$canonical" rev-parse HEAD); git -C "$canonical" diff --quiet "$sha" -- "$component" || die selected-source-drifted
[[ -f "$secret" && ! -L "$secret" ]] || die missing-regular-secret-config
[[ "$(stat -c '%U:%G:%a' "$secret")" == root:root:600 ]] || die unsafe-secret-config-permissions
install -d -o root -g root -m 0755 "$release_root"; target="$release_root/$sha"
if [[ ! -d "$target" ]];then temp=$(mktemp -d "$release_root/.${sha}.XXXXXX");trap 'rm -rf -- "$temp"' EXIT;git -C "$canonical" archive --format=tar "$sha" "$component"|tar -xf - -C "$temp";cmp "$canonical/$component/server.py" "$temp/$component/server.py";cmp "$canonical/$component/$service" "$temp/$component/$service";chmod -R go-w "$temp";chmod 0755 "$temp";chown -R root:root "$temp";mv "$temp" "$target";trap - EXIT;fi
[[ -f "$target/$component/server.py" && -f "$target/$component/$service" ]] || die incomplete-release-archive
ln -sfn "$sha" "$release_root/CURRENT";install -o root -g root -m 0644 "$target/$component/$service" "/etc/systemd/system/$service";systemctl daemon-reload;systemctl enable "$service";systemctl restart "$service";systemctl show "$service" -p FragmentPath -p LoadState -p ActiveState --no-pager;printf 'installed trusted-device committed revision=%s
' "$sha"
