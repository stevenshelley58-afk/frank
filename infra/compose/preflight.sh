#!/usr/bin/env bash
# =========================================================================================
# FRANK — Slice 1 cell preflight
# =========================================================================================
#
# READ-ONLY. This script creates nothing, starts nothing, pulls nothing and writes nothing
# outside its own stdout/stderr. Run it before the first `docker compose up` and again
# before any redeploy after host changes.
#
# Spec: FRANK-§16.6 "Deployment discovery records the actual host before provisioning";
#       FRANK-§16.3.1 step 2 "Refuse destructive work if any target remains ambiguous";
#       FRANK-§15.6 (only the reverse proxy is publicly reachable);
#       FRANK-§21 Workstream 3 verification (a public port scan exposes only intended
#       edge services).
#
# WHY THIS EXISTS: the target is a SHARED Ubuntu 24.04 box already running six unrelated
# production projects — blockwise, draftcheck-wa-v3, coolify, cuz, elfandwonder,
# character-generator — with roughly 20 live containers. A FRANK deploy that takes a port,
# a subnet or the last of the RAM is an outage for someone else's production system.
#
# Exit codes:  0 = clear to deploy (warnings may be present)
#              1 = at least one BLOCKER; do not deploy
#              2 = the script itself could not run its checks
# =========================================================================================

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"

BLOCKERS=0
WARNINGS=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_GRN=$'\033[32m'; C_DIM=$'\033[2m'; C_BLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_YEL=""; C_GRN=""; C_DIM=""; C_BLD=""; C_OFF=""
fi

section() { printf '\n%s== %s ==%s\n' "$C_BLD" "$1" "$C_OFF"; }
ok()      { printf '  %sPASS%s  %s\n' "$C_GRN" "$C_OFF" "$1"; }
info()    { printf '  %sINFO%s  %s\n' "$C_DIM" "$C_OFF" "$1"; }
warn()    { printf '  %sWARN%s  %s\n' "$C_YEL" "$C_OFF" "$1"; WARNINGS=$((WARNINGS + 1)); }
block()   { printf '  %sBLOCK%s %s\n' "$C_RED" "$C_OFF" "$1"; BLOCKERS=$((BLOCKERS + 1)); }
fatal()   { printf '\n%sFATAL%s %s\n' "$C_RED" "$C_OFF" "$1"; exit 2; }

# -----------------------------------------------------------------------------------------
# Load tunables. .env if present (it is what will actually be deployed), else .env.example
# for its defaults. Never printed, never echoed.
# -----------------------------------------------------------------------------------------
load_env_value() {
  # load_env_value VAR_NAME DEFAULT — reads from .env then .env.example, without sourcing.
  local var="$1" def="${2:-}" val="" f
  for f in "$ENV_FILE" "$ENV_EXAMPLE"; do
    [ -r "$f" ] || continue
    val="$(sed -n "s/^[[:space:]]*${var}=//p" "$f" | tail -n 1 | sed 's/[[:space:]]*#.*$//' | sed 's/[[:space:]]*$//')"
    [ -n "$val" ] && { printf '%s' "$val"; return 0; }
  done
  printf '%s' "$def"
}

EDGE_PORT="$(load_env_value FRANK_EDGE_PORT 8443)"
OPENBAO_PORT="$(load_env_value FRANK_OPENBAO_PORT 48200)"
TEMPORAL_UI_PORT="$(load_env_value FRANK_TEMPORAL_UI_PORT 48088)"
NETWORK_SUBNET="$(load_env_value FRANK_NETWORK_SUBNET 172.28.240.0/24)"
MIN_DISK_GB="$(load_env_value FRANK_PREFLIGHT_MIN_DISK_GB 45)"
MIN_MEM_GB="$(load_env_value FRANK_PREFLIGHT_MIN_AVAIL_MEM_GB 14)"
MEM_CEILING_MB="$(load_env_value FRANK_PREFLIGHT_MEM_CEILING_MB 11264)"

printf '%sFRANK Slice 1 cell preflight%s\n' "$C_BLD" "$C_OFF"
printf '%scompose project: frank-cell   compose file: %s%s\n' "$C_DIM" "$COMPOSE_FILE" "$C_OFF"
printf '%shost: %s   date: %s%s\n' "$C_DIM" "$(hostname 2>/dev/null || echo unknown)" \
       "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$C_OFF"

[ -r "$COMPOSE_FILE" ] || fatal "compose file not found or unreadable: ${COMPOSE_FILE}"

# =========================================================================================
section "1. Tooling"
# =========================================================================================

if ! command -v docker >/dev/null 2>&1; then
  block "docker is not on PATH. Install Docker Engine 24+ before deploying."
else
  DOCKER_VER="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  if [ -z "$DOCKER_VER" ]; then
    DOCKER_VER="$(docker version --format '{{.Client.Version}}' 2>/dev/null | head -n 1 | tr -d '[:space:]')"
    [ -n "$DOCKER_VER" ] || DOCKER_VER="unknown"
    warn "Docker daemon did not answer; read client version ${DOCKER_VER}. Daemon checks below will be skipped."
    DOCKER_DAEMON=0
  else
    DOCKER_DAEMON=1
    ok "Docker Engine ${DOCKER_VER} (daemon reachable)"
  fi
  DOCKER_MAJOR="${DOCKER_VER%%.*}"
  case "$DOCKER_MAJOR" in
    ''|*[!0-9]*) warn "could not parse Docker version '${DOCKER_VER}'" ;;
    *) if [ "$DOCKER_MAJOR" -lt 24 ]; then
         block "Docker ${DOCKER_VER} is too old. This compose file uses oom_score_adj, per-service cpus/mem_limit and depends_on conditions; Docker Engine 24+ is required."
       else
         ok "Docker major version ${DOCKER_MAJOR} meets the 24+ requirement"
       fi ;;
  esac
fi

COMPOSE_VER=""
if docker compose version --short >/dev/null 2>&1; then
  COMPOSE_VER="$(docker compose version --short 2>/dev/null)"
elif command -v docker-compose >/dev/null 2>&1; then
  block "only the legacy v1 'docker-compose' binary was found. This file is Compose Spec v2 (profiles, depends_on conditions, named volumes with explicit 'name'). Install the docker compose v2 plugin."
else
  block "the 'docker compose' v2 plugin is not available."
fi

if [ -n "$COMPOSE_VER" ]; then
  CV="${COMPOSE_VER#v}"
  CV_MAJOR="${CV%%.*}"; CV_REST="${CV#*.}"; CV_MINOR="${CV_REST%%.*}"
  case "${CV_MAJOR}${CV_MINOR}" in
    ''|*[!0-9]*) warn "could not parse compose version '${COMPOSE_VER}'" ;;
    *) if [ "$CV_MAJOR" -lt 2 ] || { [ "$CV_MAJOR" -eq 2 ] && [ "$CV_MINOR" -lt 20 ]; }; then
         block "docker compose ${COMPOSE_VER} is too old; 2.20+ is required for 'name:', profiles and depends_on conditions as used here."
       else
         ok "docker compose ${COMPOSE_VER}"
       fi ;;
  esac
fi

# =========================================================================================
section "2. Compose file renders"
# =========================================================================================

if [ -n "$COMPOSE_VER" ]; then
  if [ -r "$ENV_FILE" ]; then
    CONFIG_ERR="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile admin config -q 2>&1)"
  else
    # No .env yet. Every credential uses ${VAR:?...}, so the file deliberately refuses to
    # render with an empty secret. Syntax-check it against the template with placeholders
    # substituted, so a genuine YAML or schema error is still caught here. The missing
    # secrets themselves are reported by section 3, not disguised as a syntax failure.
    TMP_ENV="$(mktemp 2>/dev/null)" || TMP_ENV=""
    if [ -n "$TMP_ENV" ]; then
      sed 's/^\(FRANK_[A-Z0-9_]*\)=$/\1=validate-placeholder/' "$ENV_EXAMPLE" > "$TMP_ENV"
      CONFIG_ERR="$(docker compose -f "$COMPOSE_FILE" --env-file "$TMP_ENV" --profile admin config -q 2>&1)"
      rm -f "$TMP_ENV"
      info "no .env present — the compose file was syntax-checked against .env.example with placeholder secrets"
    else
      CONFIG_ERR="could not create a temporary file to validate against"
    fi
  fi
  if [ -n "$CONFIG_ERR" ]; then
    block "docker compose config failed:"
    printf '%s\n' "$CONFIG_ERR" | sed 's/^/          /'
  else
    ok "docker compose config renders without error"
  fi
fi

# =========================================================================================
section "3. Secrets and configuration hygiene (FRANK-15.3, FRANK-17.2)"
# =========================================================================================

REQUIRED_VARS="FRANK_DB_PASSWORD FRANK_TEMPORAL_DB_PASSWORD FRANK_AUTHENTIK_DB_PASSWORD \
FRANK_VALKEY_PASSWORD FRANK_AUTHENTIK_REDIS_PASSWORD FRANK_NATS_PASSWORD \
FRANK_S3_ACCESS_KEY FRANK_S3_SECRET_KEY FRANK_AUTHENTIK_SECRET_KEY"

if [ ! -r "$ENV_FILE" ]; then
  block ".env not found at ${ENV_FILE}. Copy .env.example and generate every secret (the generator command is in the header of .env.example). Nothing is generated for you: FRANK-15.3 requires secrets to be created at deploy time and held outside the repository."
else
  ok ".env present"

  PERMS="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%A' "$ENV_FILE" 2>/dev/null || echo '')"
  case "$PERMS" in
    600|400) ok ".env permissions ${PERMS}" ;;
    '')      warn "could not read .env permissions" ;;
    *)       block ".env is mode ${PERMS}; it holds every database, cache and identity credential for the cell. Run: chmod 600 ${ENV_FILE}" ;;
  esac

  MISSING=""
  for v in $REQUIRED_VARS; do
    val="$(sed -n "s/^[[:space:]]*${v}=//p" "$ENV_FILE" | tail -n 1 | sed 's/[[:space:]]*#.*$//' | sed 's/[[:space:]]*$//')"
    [ -z "$val" ] && MISSING="${MISSING} ${v}"
  done
  if [ -n "$MISSING" ]; then
    block "required secret(s) unset in .env:${MISSING}"
  else
    ok "all required secrets are set in .env"
  fi

  # Duplicate credentials defeat the FRANK-16.4 separation the init script builds.
  DUPES="$(for v in $REQUIRED_VARS; do
             sed -n "s/^[[:space:]]*${v}=//p" "$ENV_FILE" | tail -n 1
           done | sed '/^$/d' | sort | uniq -d | wc -l | tr -d ' ')"
  if [ "${DUPES:-0}" -gt 0 ]; then
    block "${DUPES} credential value(s) are reused across services in .env. FRANK-16.4 and FRANK-15.2 require separate workload credentials; a shared password makes the per-database REVOKEs in postgres/initdb/00-databases.sh meaningless."
  else
    ok "no credential value is reused across services"
  fi

  BOOTSTRAP_PW="$(sed -n 's/^[[:space:]]*FRANK_AUTHENTIK_BOOTSTRAP_PASSWORD=//p' "$ENV_FILE" | tail -n 1)"
  if [ -n "$BOOTSTRAP_PW" ]; then
    info "Authentik bootstrap credentials are set — correct for a FIRST deploy. FRANK-15.2/15.3: blank them and restart Authentik immediately after the owner enrols a passkey."
  fi
fi

if command -v git >/dev/null 2>&1 && git -C "$SCRIPT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$SCRIPT_DIR" ls-files --error-unmatch .env >/dev/null 2>&1; then
    block ".env is TRACKED BY GIT. FRANK-17.2: infrastructure code contains no secrets. Remove it from the index and rotate every value it contains."
  else
    ok ".env is not tracked by git"
  fi
fi

# =========================================================================================
section "4. Ports (FRANK-15.6; SHARED HOST)"
# =========================================================================================

listeners() {
  if command -v ss >/dev/null 2>&1; then ss -Hltn 2>/dev/null
  elif command -v netstat >/dev/null 2>&1; then netstat -ltn 2>/dev/null
  else return 1; fi
}

LISTEN_SNAPSHOT="$(listeners)"
if [ -z "$LISTEN_SNAPSHOT" ]; then
  warn "neither ss nor netstat is available; port checks are being made against Docker's published-port table only, which will miss non-Docker listeners."
fi

DOCKER_PORTS=""
if [ "${DOCKER_DAEMON:-0}" -eq 1 ]; then
  DOCKER_PORTS="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null)"
fi

port_in_use() {
  local p="$1"
  printf '%s\n' "$LISTEN_SNAPSHOT" | grep -Eq "[:.]${p}[[:space:]]" && return 0
  printf '%s\n' "$DOCKER_PORTS" | grep -Eq ":${p}->" && return 0
  return 1
}

port_holder() {
  local p="$1" holder=""
  holder="$(printf '%s\n' "$DOCKER_PORTS" | grep -E ":${p}->" | cut -f1 | paste -sd, - 2>/dev/null)"
  [ -n "$holder" ] && { printf 'container %s' "$holder"; return; }
  if command -v ss >/dev/null 2>&1; then
    holder="$(ss -Hltnp 2>/dev/null | grep -E "[:.]${p}[[:space:]]" | grep -o 'users:((\"[^\"]*\"' | head -n 1 | tr -d '"' | sed 's/users:((//')"
  fi
  [ -n "$holder" ] && printf 'process %s' "$holder" || printf 'an unidentified process'
}

# 4a. FRANK's own ports must be FREE.
for spec in "FRANK_EDGE_PORT:${EDGE_PORT}:FRANK Caddy edge (host edge forwards frank.fail here)" \
            "FRANK_OPENBAO_PORT:${OPENBAO_PORT}:OpenBao admin API (loopback only)" \
            "FRANK_TEMPORAL_UI_PORT:${TEMPORAL_UI_PORT}:Temporal UI (admin profile, loopback only)"; do
  var="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; label="${rest#*:}"
  case "$port" in
    ''|*[!0-9]*) block "${var} is not a number: '${port}'"; continue ;;
  esac
  if port_in_use "$port"; then
    block "port ${port} (${label}) is ALREADY IN USE by $(port_holder "$port"). Pick a free port for ${var} in .env — do not evict whatever is there; it belongs to another production project."
  else
    ok "port ${port} free — ${label}"
  fi
done

# 4b. 80/443 must NOT be free: something else owns the public edge, and FRANK relies on it.
for pub in 80 443; do
  if port_in_use "$pub"; then
    ok "port ${pub} is held by $(port_holder "$pub") — expected. FRANK must never bind it; the existing edge forwards frank.fail to 127.0.0.1:${EDGE_PORT}."
  else
    warn "port ${pub} is FREE. FRANK does not bind it and this compose file cannot serve public TLS on its own. Nothing will reach frank.fail until a host edge terminates TLS and proxies to 127.0.0.1:${EDGE_PORT}. See README 'Wiring the host edge'."
  fi
done

# 4c. Nothing FRANK publishes may be reachable from off-box.
if [ "${DOCKER_DAEMON:-0}" -eq 1 ] && [ -n "$COMPOSE_VER" ]; then
  ENVARG=(); [ -r "$ENV_FILE" ] && ENVARG=(--env-file "$ENV_FILE") || ENVARG=(--env-file "$ENV_EXAMPLE")
  RENDERED="$(docker compose -f "$COMPOSE_FILE" "${ENVARG[@]}" --profile admin config 2>/dev/null)"
  if [ -n "$RENDERED" ]; then
    BAD_BINDS="$(printf '%s\n' "$RENDERED" | grep -E '^\s+published:' -A2 -B2 | grep -E 'host_ip:' | grep -v '127\.0\.0\.1' || true)"
    if [ -n "$BAD_BINDS" ]; then
      block "a published port is not bound to 127.0.0.1. FRANK-15.6 and the Slice 1 exit gate require a public port scan to expose only intended edge services:"
      printf '%s\n' "$BAD_BINDS" | sed 's/^/          /'
    else
      ok "every published port (including the admin profile) binds 127.0.0.1 only"
    fi
  fi
fi

# =========================================================================================
section "5. Existing frank-cell resources (FRANK-16.3.1 step 2)"
# =========================================================================================

if [ "${DOCKER_DAEMON:-0}" -eq 1 ]; then
  EXISTING_C="$(docker ps -a --filter 'name=^frank-cell-' --format '{{.Names}} ({{.Status}})' 2>/dev/null)"
  EXISTING_V="$(docker volume ls --filter 'name=^frank-cell-' --format '{{.Name}}' 2>/dev/null)"
  EXISTING_N="$(docker network ls --filter 'name=^frank-cell-net$' --format '{{.Name}}' 2>/dev/null)"
  EXISTING_P="$(docker ps -a --filter 'label=com.docker.compose.project=frank-cell' --format '{{.Names}}' 2>/dev/null)"

  if [ -n "${EXISTING_C}${EXISTING_V}${EXISTING_N}${EXISTING_P}" ]; then
    block "frank-cell resources already exist on this host. This preflight is for a FIRST deploy; deploying over existing state risks reusing a data directory whose credentials no longer match .env. Inventory them and decide explicitly (README 'Tearing down') before continuing:"
    [ -n "$EXISTING_C" ] && printf '%s\n' "$EXISTING_C" | sed 's/^/          container: /'
    [ -n "$EXISTING_V" ] && printf '%s\n' "$EXISTING_V" | sed 's/^/          volume:    /'
    [ -n "$EXISTING_N" ] && printf '%s\n' "$EXISTING_N" | sed 's/^/          network:   /'
  else
    ok "no frank-cell container, volume or network exists"
  fi

  # The RETIRED deployment used the frank-hub prefix. It must be left strictly alone
  # (FRANK-16.3.1 steps 10-11: stopped, network-isolated and read-only through the rollback
  # window). Report it so nobody confuses the two during teardown.
  LEGACY="$(docker ps -a --filter 'name=frank-hub' --format '{{.Names}}' 2>/dev/null; docker volume ls --filter 'name=frank-hub' --format '{{.Name}}' 2>/dev/null)"
  if [ -n "$LEGACY" ]; then
    warn "legacy 'frank-hub' resources are present. They are NOT part of this cell and must not be touched: FRANK-16.3.1 keeps the retired cell stopped, isolated and read-only through the rollback window."
    printf '%s\n' "$LEGACY" | sed 's/^/          legacy: /'
  else
    ok "no legacy frank-hub resources on this host"
  fi

  OTHER="$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')"
  info "${OTHER} container(s) currently running on this host — FRANK is a guest here, not the owner."
else
  warn "Docker daemon unreachable; existing-resource inventory NOT checked. Re-run this script on the target host before deploying — FRANK-16.3.1 step 2 refuses destructive or overlapping work while any target is ambiguous."
fi

# =========================================================================================
section "6. Network subnet (shared host)"
# =========================================================================================

subnet_prefix() { printf '%s' "${1%.*/*}"; }   # 172.28.240.0/24 -> 172.28.240

if [ "${DOCKER_DAEMON:-0}" -eq 1 ]; then
  WANT="$(subnet_prefix "$NETWORK_SUBNET")"
  IN_USE="$(docker network ls -q 2>/dev/null | xargs -r docker network inspect -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)"
  CLASH="$(printf '%s\n' "$IN_USE" | grep -F " ${WANT}." || true)"
  if [ -n "$CLASH" ]; then
    block "FRANK_NETWORK_SUBNET ${NETWORK_SUBNET} overlaps an existing Docker network. Choosing it would break routing for another project. Pick a different /24:"
    printf '%s\n' "$CLASH" | sed 's/^/          /'
  else
    ok "subnet ${NETWORK_SUBNET} does not overlap any existing Docker network"
  fi

  if command -v ip >/dev/null 2>&1; then
    HOSTCLASH="$(ip -4 route 2>/dev/null | grep -F "${WANT}." || true)"
    [ -n "$HOSTCLASH" ] && warn "the host routing table already has a route inside ${WANT}.0/24: $(printf '%s' "$HOSTCLASH" | head -n1)"
  fi
else
  warn "Docker daemon unreachable; subnet overlap with the six other projects' networks NOT checked. Re-run on the target host."
fi

# =========================================================================================
section "7. Memory headroom (FRANK-16.6)"
# =========================================================================================

if [ -r /proc/meminfo ]; then
  MEM_TOTAL_KB="$(awk '/^MemTotal:/{print $2}' /proc/meminfo)"
  MEM_AVAIL_KB="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
  MEM_TOTAL_GB=$(( MEM_TOTAL_KB / 1024 / 1024 ))
  MEM_AVAIL_GB=$(( MEM_AVAIL_KB / 1024 / 1024 ))
  info "host memory: ${MEM_TOTAL_GB} GiB total, ${MEM_AVAIL_GB} GiB available"

  if [ "$MEM_AVAIL_GB" -lt "$MIN_MEM_GB" ]; then
    block "only ${MEM_AVAIL_GB} GiB available; ${MIN_MEM_GB} GiB is required (the ~$((MEM_CEILING_MB / 1024)) GiB FRANK ceiling plus margin for the six other projects). Starting FRANK now risks OOM-killing another project's production containers."
  else
    ok "${MEM_AVAIL_GB} GiB available meets the ${MIN_MEM_GB} GiB requirement"
  fi
else
  warn "/proc/meminfo unreadable; memory headroom not checked"
fi

# Assert the declared caps against the ceiling. This is the guard that keeps FRANK inside
# its agreed slice of a shared box even if someone edits a single FRANK_MEM_* value.
SUM_MB=0
UNPARSED=""
for v in FRANK_MEM_POSTGRES FRANK_MEM_VALKEY FRANK_MEM_NATS FRANK_MEM_TEMPORAL \
         FRANK_MEM_TEMPORAL_UI FRANK_MEM_AUTHENTIK_SERVER FRANK_MEM_AUTHENTIK_WORKER \
         FRANK_MEM_AUTHENTIK_REDIS FRANK_MEM_OPENBAO FRANK_MEM_SEAWEEDFS FRANK_MEM_CADDY; do
  raw="$(load_env_value "$v" '')"
  [ -z "$raw" ] && { UNPARSED="${UNPARSED} ${v}"; continue; }
  num="$(printf '%s' "$raw" | tr -d '[:alpha:]')"
  unit="$(printf '%s' "$raw" | tr -d '[:digit:]' | tr '[:upper:]' '[:lower:]')"
  case "$unit" in
    m|mb) SUM_MB=$(( SUM_MB + num )) ;;
    g|gb) SUM_MB=$(( SUM_MB + num * 1024 )) ;;
    *)    UNPARSED="${UNPARSED} ${v}=${raw}" ;;
  esac
done
[ -n "$UNPARSED" ] && warn "could not parse memory cap(s):${UNPARSED}"

info "declared FRANK memory caps total ${SUM_MB} MiB (including the admin-profile Temporal UI)"
if [ "$SUM_MB" -gt "$MEM_CEILING_MB" ]; then
  block "declared memory caps total ${SUM_MB} MiB, above the agreed ${MEM_CEILING_MB} MiB ceiling for this shared host. Reduce a FRANK_MEM_* value or raise FRANK_PREFLIGHT_MEM_CEILING_MB deliberately, with the README allocation table updated to match."
else
  ok "declared caps ${SUM_MB} MiB are within the ${MEM_CEILING_MB} MiB ceiling ($((MEM_CEILING_MB - SUM_MB)) MiB uncommitted reserve)"
fi

# FRANK-16.6 reserves 8 GB and 15% CPU for the OS on the reference profile; the equivalent
# guard here is that the ceiling must not eat everything the host has.
if [ -n "${MEM_TOTAL_GB:-}" ] && [ "$MEM_TOTAL_GB" -gt 0 ]; then
  if [ $(( SUM_MB * 100 / (MEM_TOTAL_GB * 1024) )) -gt 45 ]; then
    warn "FRANK would claim $(( SUM_MB * 100 / (MEM_TOTAL_GB * 1024) ))% of total host RAM. On a box with six other production projects, keep this under 45%."
  fi
fi

# =========================================================================================
section "8. Disk (FRANK-16.6 quotas)"
# =========================================================================================

DOCKER_ROOT="/var/lib/docker"
if [ "${DOCKER_DAEMON:-0}" -eq 1 ]; then
  R="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)"
  [ -n "$R" ] && DOCKER_ROOT="$R"
fi
CHECK_PATH="$DOCKER_ROOT"; [ -d "$CHECK_PATH" ] || CHECK_PATH="/"

AVAIL_KB="$(df -Pk "$CHECK_PATH" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${AVAIL_KB:-}" ]; then
  AVAIL_GB=$(( AVAIL_KB / 1024 / 1024 ))
  USE_PCT="$(df -Pk "$CHECK_PATH" 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')"
  info "docker data root ${DOCKER_ROOT}: ${AVAIL_GB} GiB free, ${USE_PCT}% used"
  if [ "$AVAIL_GB" -lt "$MIN_DISK_GB" ]; then
    block "only ${AVAIL_GB} GiB free on ${CHECK_PATH}; ${MIN_DISK_GB} GiB required for images, the canonical database, object storage and JetStream."
  else
    ok "${AVAIL_GB} GiB free meets the ${MIN_DISK_GB} GiB requirement"
  fi
  # FRANK-16.6 lifecycle thresholds: alert 65%, throttle 75%, contain 85%.
  if [ -n "${USE_PCT:-}" ]; then
    if   [ "$USE_PCT" -ge 85 ]; then block "filesystem is ${USE_PCT}% used — past FRANK-16.6's 85% containment threshold before FRANK has written a single byte."
    elif [ "$USE_PCT" -ge 75 ]; then warn "filesystem is ${USE_PCT}% used — past FRANK-16.6's 75% throttle threshold."
    elif [ "$USE_PCT" -ge 65 ]; then warn "filesystem is ${USE_PCT}% used — past FRANK-16.6's 65% alert threshold."
    fi
  fi
else
  warn "could not read free space for ${CHECK_PATH}"
fi

# =========================================================================================
section "9. Kernel and runtime capabilities"
# =========================================================================================

if [ -d /sys/fs/cgroup ]; then
  if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    ok "cgroup v2 unified hierarchy"
    grep -qw memory /sys/fs/cgroup/cgroup.controllers 2>/dev/null \
      && ok "memory controller available — mem_limit will be enforced" \
      || block "the cgroup memory controller is not available; every mem_limit in this compose file would be silently ignored and FRANK could OOM the other six projects."
  else
    warn "cgroup v1 detected. mem_limit works, but memory.swap accounting is often disabled; verify memswap_limit is honoured before trusting the caps."
  fi
fi

if [ "${DOCKER_DAEMON:-0}" -eq 1 ]; then
  SWAP_WARN="$(docker info 2>/dev/null | grep -i 'No swap limit support' || true)"
  [ -n "$SWAP_WARN" ] && warn "Docker reports no swap limit support: memswap_limit will not be enforced, so a FRANK container can swap instead of being capped. Add 'cgroup_enable=memory swapaccount=1' to the kernel command line if the caps must be exact."
fi

# Negative oom_score_adj (the FRANK-16.6 priority rule) needs privilege.
if [ "$(id -u)" -ne 0 ]; then
  if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    info "running as non-root in the docker group. Negative oom_score_adj values are applied by the daemon (which is root), so the FRANK-16.6 priority rule still holds."
  else
    warn "running as non-root and not in the docker group; docker commands may fail."
  fi
fi

# FRANK-16.6: the control VPS runs no untrusted build microVM, so no KVM is expected.
if [ -e /dev/kvm ]; then
  info "/dev/kvm present — unused. FRANK-16.6: the control VPS runs no untrusted build microVM; untrusted execution belongs to the separate execution worker (FRANK-15.4)."
else
  ok "/dev/kvm absent — expected and harmless. Nothing in this stack assumes nested virtualisation."
fi

if [ "${DOCKER_DAEMON:-0}" -eq 1 ]; then
  LOGDRV="$(docker info --format '{{.LoggingDriver}}' 2>/dev/null)"
  if [ -n "$LOGDRV" ] && [ "$LOGDRV" != "json-file" ]; then
    warn "the daemon default logging driver is '${LOGDRV}'. This compose file pins json-file with size caps per service, so FRANK is bounded either way, but verify the driver accepts max-size/max-file options."
  fi
fi

# =========================================================================================
section "10. Config files this compose file mounts"
# =========================================================================================

for f in caddy/Caddyfile \
         postgres/postgresql.conf \
         postgres/initdb/00-databases.sh \
         postgres/initdb/10-extensions.sh \
         valkey/valkey.conf \
         valkey/authentik-redis.conf \
         nats/nats.conf \
         temporal/dynamicconfig/frank.yaml \
         openbao/config/openbao.hcl \
         seaweedfs/s3.json.tmpl; do
  if [ -r "${SCRIPT_DIR}/${f}" ]; then
    ok "${f}"
  else
    block "missing or unreadable mounted config: ${f} (a missing bind-mount source is created by Docker as an empty DIRECTORY, which fails in a way that is hard to read)."
  fi
done

for s in postgres/initdb/00-databases.sh postgres/initdb/10-extensions.sh; do
  [ -x "${SCRIPT_DIR}/${s}" ] || warn "${s} is not executable. The PostgreSQL entrypoint sources non-executable .sh files rather than running them, which mostly works but changes error handling. Run: chmod +x ${SCRIPT_DIR}/${s}"
done

# No key material may be sitting in the tree.
STRAY="$(find "$SCRIPT_DIR" -maxdepth 3 -type f \
          \( -name '*.key' -o -name '*.pem' -o -name 'unseal*' -o -name '*root-token*' -o -name 's3.json' \) \
          2>/dev/null || true)"
if [ -n "$STRAY" ]; then
  block "key material or rendered secret files found in the compose directory. FRANK-15.3/17.2: none of this may exist here or be committed:"
  printf '%s\n' "$STRAY" | sed 's/^/          /'
else
  ok "no key material or rendered secret files in the compose directory"
fi

# =========================================================================================
printf '\n%s== Result ==%s\n' "$C_BLD" "$C_OFF"
# =========================================================================================

if [ "$BLOCKERS" -gt 0 ]; then
  printf '  %s%d BLOCKER(S)%s and %d warning(s). DO NOT DEPLOY.\n' "$C_RED" "$BLOCKERS" "$C_OFF" "$WARNINGS"
  printf '  Resolve every BLOCK line above, then run this script again.\n\n'
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  printf '  %sClear to deploy%s with %d warning(s). Read each WARN line and accept it deliberately.\n\n' "$C_GRN" "$C_OFF" "$WARNINGS"
else
  printf '  %sClear to deploy.%s No blockers, no warnings.\n\n' "$C_GRN" "$C_OFF"
fi
exit 0
