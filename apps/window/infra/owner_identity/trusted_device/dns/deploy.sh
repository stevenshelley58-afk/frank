#!/usr/bin/env bash
# Deploy the trusted-device resolver from a clean committed checkout.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../../../../.." && pwd)
die(){ echo "trusted-device-dns: $*" >&2; exit 1; }
[[ -z "$(git -C "$repo_root" status --porcelain -- apps/window/infra/owner_identity/trusted_device/dns)" ]] || die "component source is dirty"
address=$(tailscale ip -4 2>/dev/null | head -n1)
[[ "$address" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+$ ]] || die "no Tailscale IPv4 address on this host"
export OWNER_TAILSCALE_ADDRESS="$address"
export OWNER_DNS_SOURCE_SHA="$(git -C "$repo_root" rev-parse HEAD)"
docker compose --project-directory "$script_dir" -f "$script_dir/compose.yaml" up -d --remove-orphans
for _ in $(seq 1 20); do
  status=$(docker inspect -f '{{.State.Health.Status}}' frank-trusted-device-dns 2>/dev/null || echo missing)
  [[ "$status" == healthy ]] && break
  sleep 2
done
[[ "$status" == healthy ]] || die "resolver did not become healthy ($status)"
answer=$(dig +short +time=3 +tries=1 @"$address" auth.frank.fail A 2>/dev/null || true)
[[ "$answer" == "$address" ]] || die "resolver answered '$answer' for auth.frank.fail, expected $address"
public=$(dig +short +time=3 +tries=1 @"$address" frank.fail A 2>/dev/null || true)
[[ -n "$public" && "$public" != "$address" ]] || die "resolver did not forward frank.fail to public DNS (got '$public')"
echo "trusted-device resolver serving auth.frank.fail -> $address on $address:53"
