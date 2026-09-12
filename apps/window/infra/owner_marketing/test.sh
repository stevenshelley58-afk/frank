#!/usr/bin/env bash
set -euo pipefail
s="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; bash -n "$s/deploy.sh" "$s/check.sh"; grep -q 'mautic/mautic:7.2-apache@sha256:' "$s/compose.yml"; grep -q 'MAUTIC_RUN_CRON_JOBS' "$s/compose.yml"; grep -q 'internal: true' "$s/compose.yml"; grep -q '18106' "$s/compose.yml"; echo 'owner-marketing static tests passed'
