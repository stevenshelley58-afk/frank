# Hermes Runtime

Frank Hub Stage 4 runs Hermes as a private operator runtime beside the Frank
API and worker services.

## Runtime Shape

The runtime file is `docker-compose.hermes.yml`.

Default service:

- service name: `hermes`
- image: `${HERMES_IMAGE:-nousresearch/hermes-agent:latest}`
- command: `gateway run`
- restart policy: `unless-stopped`
- container API port: `8642`
- host port publishing: none
- persistent data: `./runtime/hermes:/opt/data`
- task workspaces: `./workspaces:/opt/frank-hub/workspaces`
- Frank artifacts: `./runtime/artifacts:/opt/frank-hub/runtime/artifacts`

Frank API and worker containers call Hermes through the private Compose network
at:

```text
http://hermes:8642
```

Do not create a Cloudflare hostname for Hermes. Do not expose Hermes directly to
the browser.

## Required Environment

```env
HERMES_ENABLED=false
HERMES_IMAGE=nousresearch/hermes-agent:latest
HERMES_API_BASE_URL=http://hermes:8642
HERMES_API_SERVER_KEY=
HERMES_TIMEOUT_SECONDS=1800
HERMES_STALL_TIMEOUT_SECONDS=300
HERMES_EVENTS_POLL_MS=1000
HERMES_WORKSPACE_ROOT=/opt/frank-hub/workspaces
HERMES_ARTIFACT_ROOT=/opt/frank-hub/runtime/artifacts
FRANK_BACKUP_ROOT=/opt/frank-backups
```

`HERMES_ENABLED=true` requires a non-empty `HERMES_API_SERVER_KEY`. Frank refuses
Hermes operations when the key is missing.

## First VPS Setup

Configure Hermes data interactively before enabling it for Frank:

```bash
cd /opt/frank-hub
mkdir -p runtime/hermes runtime/artifacts workspaces/tasks
docker run -it --rm -v /opt/frank-hub/runtime/hermes:/opt/data nousresearch/hermes-agent setup
```

Then set the private API values in `/opt/frank-hub/.env`:

```env
HERMES_ENABLED=true
HERMES_API_SERVER_KEY=change-this
HERMES_API_BASE_URL=http://hermes:8642
```

Start Frank with Hermes:

```bash
cd /opt/frank-hub
docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env up -d --build
./scripts/healthcheck.sh
./scripts/hermes_check.sh
```

## Image Pinning

The first Stage 4 implementation uses:

```env
HERMES_IMAGE=nousresearch/hermes-agent:latest
```

After the first successful VPS smoke test, pin `HERMES_IMAGE` to the tested tag
or digest. The research record in `docs/hermes-integration-research.md` records
the manifest digest observed during development.

## Workspace Policy

Default workspace root:

```text
/opt/frank-hub/workspaces
```

Task workspace:

```text
/opt/frank-hub/workspaces/tasks/{task_id}
```

Rules:

- Repo-wide tasks may use `/opt/frank-hub` only when explicitly selected.
- Never use `/` as a workspace.
- Never use `/root` as a workspace.
- Record `workspace_path` on `runner_sessions`.
- Artifacts stay under `/opt/frank-hub/runtime/artifacts`.

## Smoke Tests

Read-only smoke task:

```text
Title: Hermes smoke test
Description: Inspect the current workspace, report current directory, list top-level files, do not edit files.
```

Expected result:

- Hermes starts.
- Logs are visible in Frank.
- Final output includes workspace path and top-level file list.
- Task completes.
- No files are changed.

Write smoke task:

```text
Title: Hermes write test
Description: Create runtime/artifacts/hermes-smoke-test.txt with one line: "Hermes can write from Frank."
```

Expected result:

- The file is created.
- Task completes.
- The file is captured or visible as an artifact.

## Git Credentials Policy

Do not assume Hermes can push. Detect whether the repo remote allows push before
asking Hermes to push. If push is unavailable, Hermes should commit locally or
produce a patch/diff. Do not change deploy key permissions automatically.

## Rollback

Stop only Hermes:

```bash
cd /opt/frank-hub
docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env down hermes
```

Disable Hermes:

```env
HERMES_ENABLED=false
```

Return to current `main`:

```bash
cd /opt/frank-hub
git checkout main
git pull --ff-only
./scripts/deploy.sh
./scripts/healthcheck.sh
```

Leave runner tables, artifacts, and backups in place. Do not drop data.

## Merge Strategy

After the feature branch passes VPS verification:

1. Merge `stage4-hermes-operator-mode` into `main`.
2. Deploy `main`.
3. Verify main health.
4. Do not leave the VPS permanently on the feature branch unless explicitly
   requested.
