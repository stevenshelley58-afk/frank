#!/usr/bin/env bash
# Session-1 reviewed handoff: launch one Codex task on the VPS inside the
# exclusive Frank workspace lease. Fail closed: no lease, no launch; renewal
# loss terminates the task. Direct writable project entry outside this
# launcher is denied by the frozen supported-host policy.
#
# Usage: launch_codex_task.sh WORKSPACE_ID -- codex exec --full-auto "task"
set -euo pipefail

WORKSPACE_ID="${1:?usage: launch_codex_task.sh WORKSPACE_ID -- <codex argv...>}"
shift; [ "${1:-}" = "--" ] && shift
: "${FRANK_LEASE_CREDENTIAL:?export FRANK_LEASE_CREDENTIAL (runtime-only secret)}"
: "${FRANK_LEASE_API:?export FRANK_LEASE_API=http://127.0.0.1:<port>/internal/leases}"
: "${FRANK_RESOLVE_API:?export FRANK_RESOLVE_API=http://127.0.0.1:<port>/internal/workspaces}"

# 1. Resolve the opaque workspace id to its private host path (server-side).
RESOLVE_BODY="$(printf '{"workspace_id":"%s"}' "$WORKSPACE_ID")"
HOST_PATH="$(curl -fsS -X POST "$FRANK_RESOLVE_API" \
  -H "Authorization: Bearer $FRANK_LEASE_CREDENTIAL" \
  -H 'Content-Type: application/json' -d "$RESOLVE_BODY" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["host_path"])')"

# 2. Acquire the exclusive lease before entering the checkout.
ACQUIRE_BODY="$(printf '{"owner":{"executor_kind":"codex","executor_id":"codex-%s"}}' "$$")"
LEASE_JSON="$(curl -fsS -X POST "$FRANK_LEASE_API/$WORKSPACE_ID/acquire" \
  -H "Authorization: Bearer $FRANK_LEASE_CREDENTIAL" \
  -H 'Content-Type: application/json' -d "$ACQUIRE_BODY")"
GENERATION="$(printf '%s' "$LEASE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["lease"]["generation"])')"
echo "lease acquired: ${GENERATION:0:8}…"

cleanup() {
  curl -fsS -X POST "$FRANK_LEASE_API/$WORKSPACE_ID/release" \
    -H "Authorization: Bearer $FRANK_LEASE_CREDENTIAL" \
    -H 'Content-Type: application/json' \
    -d "{\"generation\":\"$GENERATION\"}" >/dev/null \
    || echo "WARN: lease release failed; reconciliation will resolve it" >&2
}
trap cleanup EXIT

# 3. Heartbeat while the task is alive; the generation stays inside this
#    process (never exported to the task itself).
(
  while sleep "${FRANK_HEARTBEAT_SECONDS:-60}"; do
    curl -fsS -X POST "$FRANK_LEASE_API/$WORKSPACE_ID/heartbeat" \
      -H "Authorization: Bearer $FRANK_LEASE_CREDENTIAL" \
      -H 'Content-Type: application/json' \
      -d "{\"generation\":\"$GENERATION\"}" >/dev/null \
      || { echo "lease renewal failed; terminating task" >&2; kill -TERM "$TASK_PID" 2>/dev/null; exit 1; }
  done
) &
HEARTBEAT_PID=$!

# 4. Run the Codex task in the resolved private host path. Codex reads the
#    repository AGENTS.md, sees /srv/skills via its supported user-skill path
#    (runtime-owned .system skills stay in place) and reads current generated
#    knowledge/maps. Transcripts stay separate from Hermes.
set +e
cd "$HOST_PATH"
codex "$@"
STATUS=$?
set -e
kill "$HEARTBEAT_PID" 2>/dev/null || true
wait "$HEARTBEAT_PID" 2>/dev/null || true
exit "$STATUS"
