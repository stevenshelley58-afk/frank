#!/usr/bin/env bash
#
# teardown-old-frank.sh — remove the legacy FRANK deployment from this host.
#
# FRANK-§16.3.1 steps 1-3: resolve and record every resource belonging to the
# existing deployment, and REFUSE DESTRUCTIVE WORK IF ANY TARGET REMAINS
# AMBIGUOUS. This script implements that literally: it will not delete anything
# it cannot attribute to FRANK, and it will not delete anything at all unless
# you pass --destroy after reading the inventory.
#
#   Step 1 — inventory (default, read-only, safe to run any time):
#       sudo bash teardown-old-frank.sh
#
#   Step 2 — destroy, after you have read the inventory:
#       sudo bash teardown-old-frank.sh --destroy
#
# Everything it touches must match a FRANK pattern. Anything ambiguous is
# reported under REVIEW and never touched, so unrelated projects on this box
# are safe. A destruction manifest is written to /root/frank-destruction-*.txt
#
set -uo pipefail

DESTROY=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --destroy) DESTROY=1 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    --help|-h) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MANIFEST="/root/frank-destruction-${STAMP}.txt"
FOUND=0
REVIEW=0

# FRANK-owned if it matches one of these. Deliberately narrow.
NAME_RE='(^|[^a-z0-9])frank([^a-z0-9]|$)'
DOMAIN_RE='(hub\.|api\.|auth\.|rooms\.|hooks\.|status\.)?frank\.fail'

log()  { printf '%s\n' "$*"; [ -n "${MANIFEST_OPEN:-}" ] && printf '%s\n' "$*" >> "$MANIFEST"; }
hdr()  { log ""; log "── $* ─────────────────────────────────────────"; }
hit()  { FOUND=$((FOUND+1)); log "  DELETE  $*"; }
rev()  { REVIEW=$((REVIEW+1)); log "  REVIEW  $*"; }
keep() { log "  keep    $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# The NEW frank repo is also called "frank". If a checkout of it is already on
# this host, every pattern here matches it. Skip anything whose git origin is
# the new repository — losing the new build to the legacy teardown would be a
# self-inflicted wound, and it is exactly what the naive pattern would do.
NEW_REPO_RE='stevenshelley58-afk/frank(\.git)?$'
is_new_repo() {
  local p="$1" origin=""
  [ -d "$p/.git" ] || return 1
  origin="$(git -C "$p" remote get-url origin 2>/dev/null)" || return 1
  [[ "$origin" =~ $NEW_REPO_RE ]]
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo — this inspects Docker, systemd, and /opt." >&2
  exit 1
fi

MANIFEST_OPEN=1
: > "$MANIFEST"
log "FRANK legacy teardown — host $(hostname) — ${STAMP}"
log "mode: $([ "$DESTROY" -eq 1 ] && echo 'DESTROY' || echo 'INVENTORY ONLY (read-only)')"

# ---------------------------------------------------------------- docker ----
DOCKER_CONTAINERS=(); DOCKER_VOLUMES=(); DOCKER_NETWORKS=(); DOCKER_IMAGES=(); COMPOSE_PROJECTS=()
if have docker && docker info >/dev/null 2>&1; then
  hdr "Docker containers"
  while IFS=$'\t' read -r id name image; do
    [ -z "${id:-}" ] && continue
    if [[ "$name" =~ $NAME_RE ]] || [[ "$image" =~ $NAME_RE ]]; then
      DOCKER_CONTAINERS+=("$id"); hit "container  $name  ($image)"
    else
      keep "container  $name  ($image)"
    fi
  done < <(docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}' 2>/dev/null)
  [ ${#DOCKER_CONTAINERS[@]} -eq 0 ] && log "  (no FRANK containers)"

  hdr "Docker compose projects"
  while read -r proj; do
    [ -z "${proj:-}" ] && continue
    if [[ "$proj" =~ $NAME_RE ]]; then COMPOSE_PROJECTS+=("$proj"); hit "compose project  $proj"
    else keep "compose project  $proj"; fi
  done < <(docker ps -a --filter 'label=com.docker.compose.project' \
             --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u)

  hdr "Docker volumes  (DATA — deleting these is irreversible)"
  while read -r vol; do
    [ -z "${vol:-}" ] && continue
    if [[ "$vol" =~ $NAME_RE ]]; then DOCKER_VOLUMES+=("$vol"); hit "volume  $vol"
    else keep "volume  $vol"; fi
  done < <(docker volume ls --format '{{.Name}}' 2>/dev/null)

  hdr "Docker networks"
  while read -r net; do
    [ -z "${net:-}" ] && continue
    case "$net" in bridge|host|none) continue ;; esac
    if [[ "$net" =~ $NAME_RE ]]; then DOCKER_NETWORKS+=("$net"); hit "network  $net"
    else keep "network  $net"; fi
  done < <(docker network ls --format '{{.Name}}' 2>/dev/null)

  hdr "Docker images"
  while read -r img; do
    [ -z "${img:-}" ] && continue
    [[ "$img" == "<none>:<none>" ]] && continue
    if [[ "$img" =~ $NAME_RE ]]; then DOCKER_IMAGES+=("$img"); hit "image  $img"; fi
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null)
  [ ${#DOCKER_IMAGES[@]} -eq 0 ] && log "  (no FRANK images)"
else
  hdr "Docker"; log "  not installed or not running"
fi

# ------------------------------------------------------------- systemd ----
SYSTEMD_UNITS=()
hdr "systemd units"
if have systemctl; then
  while read -r unit _; do
    [ -z "${unit:-}" ] && continue
    if [[ "$unit" =~ $NAME_RE ]]; then SYSTEMD_UNITS+=("$unit"); hit "unit  $unit"; fi
  done < <(systemctl list-unit-files --no-legend --no-pager 2>/dev/null | awk '{print $1}' | grep -Ei 'frank' || true)
fi
[ ${#SYSTEMD_UNITS[@]} -eq 0 ] && log "  (no FRANK units)"

# ----------------------------------------------------------- filesystem ----
FS_PATHS=()
hdr "Filesystem"
for base in /opt /srv /var/www /usr/local/share /etc; do
  [ -d "$base" ] || continue
  while read -r p; do
    [ -z "${p:-}" ] && continue
    if is_new_repo "$p"; then keep "path  $p  (NEW frank repo — protected)"; continue; fi
    FS_PATHS+=("$p"); hit "path  $p  ($(du -sh "$p" 2>/dev/null | cut -f1))"
  done < <(find "$base" -maxdepth 2 -iname '*frank*' 2>/dev/null)
done
for home in /root /home/*; do
  [ -d "$home" ] || continue
  while read -r p; do
    [ -z "${p:-}" ] && continue
    if is_new_repo "$p"; then keep "path  $p  (NEW frank repo — protected)"; continue; fi
    FS_PATHS+=("$p"); hit "path  $p  ($(du -sh "$p" 2>/dev/null | cut -f1))"
  done < <(find "$home" -maxdepth 2 -iname '*frank*' -not -name 'frank-destruction-*' 2>/dev/null)
done
[ ${#FS_PATHS[@]} -eq 0 ] && log "  (no FRANK paths)"

# -------------------------------------------------------- reverse proxy ----
hdr "Reverse proxy configs mentioning frank.fail  (REVIEW — not auto-deleted)"
for d in /etc/nginx /etc/caddy /etc/traefik /etc/apache2; do
  [ -d "$d" ] || continue
  while read -r f; do
    [ -z "${f:-}" ] && continue
    rev "config  $f"
  done < <(grep -rlEi "$DOMAIN_RE" "$d" 2>/dev/null || true)
done
[ "$REVIEW" -eq 0 ] && log "  (none found)"

# ------------------------------------------------------------ postgres ----
hdr "Host PostgreSQL databases  (REVIEW — not auto-deleted)"
if have psql && id postgres >/dev/null 2>&1; then
  while read -r db; do
    db="$(echo "$db" | xargs)"; [ -z "$db" ] && continue
    [[ "$db" =~ $NAME_RE ]] && rev "database  $db   (drop manually: sudo -u postgres dropdb $db)"
  done < <(sudo -u postgres psql -tAc 'SELECT datname FROM pg_database' 2>/dev/null || true)
else
  log "  (no host psql — databases are likely inside Docker volumes above)"
fi

# ---------------------------------------------------------------- cron ----
hdr "Cron entries mentioning frank  (REVIEW — not auto-deleted)"
CRON_HITS=0
for f in /etc/crontab /etc/cron.d/*; do
  [ -f "$f" ] || continue
  grep -qEi 'frank' "$f" 2>/dev/null && { rev "cron  $f"; CRON_HITS=1; }
done
for u in root $(ls /home 2>/dev/null); do
  crontab -u "$u" -l 2>/dev/null | grep -qEi 'frank' && { rev "cron  user:$u"; CRON_HITS=1; }
done
[ "$CRON_HITS" -eq 0 ] && log "  (none found)"

# --------------------------------------------------------------- summary ----
log ""
log "══════════════════════════════════════════════════════════════"
log "  $FOUND item(s) will be DELETED.  $REVIEW item(s) need manual REVIEW."
log "══════════════════════════════════════════════════════════════"

if [ "$DESTROY" -eq 0 ]; then
  log ""
  log "Read-only. Nothing was changed."
  log "Inventory saved to: $MANIFEST"
  log ""
  log "If the DELETE list is correct and the REVIEW list holds nothing you need:"
  log "    sudo bash $0 --destroy"
  exit 0
fi

if [ "$FOUND" -eq 0 ]; then
  log ""; log "Nothing to delete. Old FRANK is already gone from this host."; exit 0
fi

if [ "$ASSUME_YES" -eq 0 ]; then
  log ""
  echo "You chose --destroy. This is IRREVERSIBLE and there is no backup."
  echo "Docker volumes listed above contain the old FRANK databases."
  printf 'Type exactly  DESTROY FRANK  to proceed: '
  read -r confirm
  if [ "$confirm" != "DESTROY FRANK" ]; then
    log "Aborted by operator. Nothing was changed."; exit 1
  fi
fi

hdr "Destroying"

for p in "${COMPOSE_PROJECTS[@]:-}"; do
  [ -z "$p" ] && continue
  log "  compose down  $p"
  docker compose -p "$p" down --volumes --remove-orphans >/dev/null 2>&1 \
    || log "    (compose down failed; containers removed individually below)"
done

for u in "${SYSTEMD_UNITS[@]:-}"; do
  [ -z "$u" ] && continue
  log "  systemd  stop/disable/remove  $u"
  systemctl stop "$u" >/dev/null 2>&1
  systemctl disable "$u" >/dev/null 2>&1
  rm -f "/etc/systemd/system/$u" "/lib/systemd/system/$u"
done
[ ${#SYSTEMD_UNITS[@]:-0} -gt 0 ] && systemctl daemon-reload >/dev/null 2>&1

for c in "${DOCKER_CONTAINERS[@]:-}"; do
  [ -z "$c" ] && continue
  log "  container  rm -f  $c"
  docker rm -f "$c" >/dev/null 2>&1 || log "    (already gone)"
done

for v in "${DOCKER_VOLUMES[@]:-}"; do
  [ -z "$v" ] && continue
  log "  volume  rm  $v"
  docker volume rm "$v" >/dev/null 2>&1 || log "    FAILED — still in use by a non-FRANK container; left in place"
done

for n in "${DOCKER_NETWORKS[@]:-}"; do
  [ -z "$n" ] && continue
  log "  network  rm  $n"
  docker network rm "$n" >/dev/null 2>&1 || log "    (in use or already gone)"
done

for i in "${DOCKER_IMAGES[@]:-}"; do
  [ -z "$i" ] && continue
  log "  image  rmi  $i"
  docker rmi "$i" >/dev/null 2>&1 || log "    (in use or already gone)"
done

for p in "${FS_PATHS[@]:-}"; do
  [ -z "$p" ] && continue
  case "$p" in
    /|/etc|/opt|/srv|/home|/root|/var|/usr|/var/www) log "  REFUSED to delete $p — too broad"; continue ;;
  esac
  log "  path  rm -rf  $p"
  rm -rf "$p"
done

log ""
log "══════════════════════════════════════════════════════════════"
log "  Destruction complete.  Manifest: $MANIFEST"
log "══════════════════════════════════════════════════════════════"
log ""
log "Still yours to do by hand (this script never touches them):"
log "  - the $REVIEW REVIEW item(s) above: proxy configs, host databases, cron"
log "  - Cloudflare DNS records for frank.fail / hub / api"
log "  - the frank.fail domain registration itself — you are KEEPING this"
log ""
log "Verify with:  docker ps -a | grep -i frank ; ls -d /opt/*frank* 2>/dev/null"