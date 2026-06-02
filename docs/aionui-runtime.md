# AionUi Runtime

Frank Hub can run AionUi WebUI as a private production runtime beside Hermes.

## Runtime Shape

Compose file: `docker-compose.aionui.yml`.

- service name: `aionui`
- upstream release: `iOfficeAI/AionUi` `v2.1.9`
- artifact: `aionui-web-2.1.9-linux-x86_64.tar.gz` or arm64 by Docker target architecture
- checksum: verified from the release `.sha256` file during image build
- container port: `25808`
- host bind: `127.0.0.1:${AIONUI_HOST_PORT:-25808}`
- canonical browser path: `https://hub.frank.fail/aionui/`
- convenience route: `aionui.frank.fail` through the Frank web/Nginx container, redirecting to the canonical path
- persistent data: `./runtime/aionui:/data`
- credential capture: `./runtime/access/aionui-admin.json`

Do not expose AionUi directly without Cloudflare Access. The intended browser
path is Frank login first, then the embedded AionUi page.

## Shared Workspace Mounts

AionUi and Hermes share the same VPS paths:

```text
/opt/frank-projects
/opt/frank-hub/workspaces
/opt/frank-hub/runtime/artifacts
/opt/frank-hub/runtime/ai-instructions
```

`runtime/access`, `.env`, backups, Docker data, and Postgres data remain
protected paths.

## Startup

```bash
cd /opt/frank-hub
./scripts/aionui_compose_up.sh
```

The first AionUi launch generates an admin password. Frank's AionUi container
entrypoint captures it into `runtime/access/aionui-admin.json` and redacts it
from container logs. The file is a credential and must never be committed.

## Dashboard Operation

Frank API uses the Host Agent for bounded runtime actions:

- `aionui.start`
- `aionui.stop`
- `aionui.logs`
- `projects.import_c_dev`
- `projects.materialize_c_dev`
- `frank.check_latest`
- `frank.deploy_branch`
- `frank.healthcheck`

The Host Agent does not expose arbitrary shell command execution.

## Production Verification

Use production smoke checks only after backups:

```bash
cd /opt/frank-hub
./scripts/backup_postgres.sh
./scripts/backup_frank_files.sh
docker compose -f docker-compose.yml -f docker-compose.hermes.yml -f docker-compose.aionui.yml --env-file .env config
./scripts/deploy.sh
./scripts/healthcheck.sh
```

Expected:

- `hub.frank.fail` loads after Cloudflare Access.
- `aionui.frank.fail` is protected by Cloudflare Access and redirects to `hub.frank.fail/aionui/`.
- Frank's AionUi page embeds AionUi without a second AionUi login.
- `/opt/frank-projects` is visible to AionUi and Hermes.
- Hermes remains private on the Compose network.
