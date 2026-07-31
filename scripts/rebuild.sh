#!/bin/bash
set -euo pipefail

LOG="/tmp/frank-rebuild.log"
REPO="/srv/frank/repo"
COMPOSE="/srv/frank/infra/docker-compose.dev.yml"

echo "=== Frank rebuild started at $(date -u) ===" > "$LOG"

# 1. Pull latest code
echo "[1/4] Pulling latest code..." >> "$LOG"
cd "$REPO"
git pull origin main >> "$LOG" 2>&1 || git pull >> "$LOG" 2>&1 || echo "git pull skipped (no remote or not a git repo)" >> "$LOG"

# 2. Rebuild containers
echo "[2/4] Rebuilding containers..." >> "$LOG"
cd /srv/frank/infra
docker compose -f "$COMPOSE" build >> "$LOG" 2>&1

# 3. Restart services
echo "[3/4] Restarting services..." >> "$LOG"
docker compose -f "$COMPOSE" up -d >> "$LOG" 2>&1

# 4. Verify health
echo "[4/4] Verifying health..." >> "$LOG"
sleep 5
HEALTH=$(curl -sf http://localhost:3000/v1/system/live 2>/dev/null || echo '{"live":false}')
echo "Health check: $HEALTH" >> "$LOG"

echo "=== Frank rebuild completed at $(date -u) ===" >> "$LOG"
cat "$LOG"
