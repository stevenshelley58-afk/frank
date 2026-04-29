# Restore Procedure

Backups are stored outside the repository by default under:

```text
/opt/frank-backups
```

Do not commit backup files, database dumps, `.env`, private keys, or provider
tokens.

## Pre-Restore Checks

```bash
cd /opt/frank-hub
git status --short --branch
docker compose ps
ls -lah /opt/frank-backups
```

If the task is risky, take a Hostinger snapshot before restore.

## Restore Postgres

Pick a `*.dump` file from `/opt/frank-backups/postgres`.

```bash
cd /opt/frank-hub
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-frank}" -d "${POSTGRES_DB:-frank}"
docker compose cp /opt/frank-backups/postgres/frank-postgres-YYYYMMDDTHHMMSSZ.dump postgres:/tmp/frank-restore.dump
docker compose exec -T postgres pg_restore --clean --if-exists -U "${POSTGRES_USER:-frank}" -d "${POSTGRES_DB:-frank}" /tmp/frank-restore.dump
docker compose exec -T postgres rm -f /tmp/frank-restore.dump
./scripts/healthcheck.sh
```

This is destructive to the current database state. Confirm the selected dump
before running it.

## Restore Frank Files

Pick a `*.tar.gz` file from `/opt/frank-backups/files`.

```bash
cd /opt
mkdir -p frank-hub-restore-check
tar -xzf /opt/frank-backups/files/frank-files-YYYYMMDDTHHMMSSZ.tar.gz -C frank-hub-restore-check
```

Inspect the extracted files first. To restore over `/opt/frank-hub`, stop only
the app containers you need to replace and copy specific files back. Do not
blindly overwrite `.env`, tunnel credentials, Docker volumes, or `/root/.ssh`.

## Hermes Rollback

Stop only Hermes:

```bash
cd /opt/frank-hub
docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env stop hermes
docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env rm -f hermes
```

Disable Hermes:

```env
HERMES_ENABLED=false
```

Deploy the previous main branch:

```bash
cd /opt/frank-hub
git checkout main
git pull --ff-only
./scripts/deploy.sh
./scripts/healthcheck.sh
```

Leave runner tables, artifacts, and backups in place. Do not drop data unless
the user explicitly requests that destructive action.

## Post-Restore Verification

```bash
cd /opt/frank-hub
docker compose ps
./scripts/healthcheck.sh
curl -fsS http://127.0.0.1:${API_PORT:-8080}/healthz
```

Then verify:

- dashboard loads
- `/v1/runners/hermes/status` reports disabled or configured as expected
- recent backups are visible in Frank
- kill switch history is intact
