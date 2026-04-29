# Hermes Integration Research

Date: 2026-04-29

This records the Stage 4 contract before implementation. Frank Hub remains the
control plane and durable system of record. Hermes remains the execution runtime.

## Sources Checked

- Official Docker docs: https://hermes-agent.nousresearch.com/docs/user-guide/docker/
- Official API server docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/
- Official repository: https://github.com/NousResearch/hermes-agent
- Current API source checked from `main`:
  https://raw.githubusercontent.com/NousResearch/hermes-agent/main/gateway/platforms/api_server.py
- Source commit checked with `git ls-remote`:
  `1d4218be564d5e8359426082c098ca3c132be498`
- Docker image manifest checked for `nousresearch/hermes-agent:latest`.

## Stage 3 Compatibility Check

Current `main` contains the minimum Stage 3 foundations needed for Stage 4:

- Task API exists in `apps/api/src/routes/tasks.ts`.
- Agent registry API exists in `apps/api/src/routes/agents.ts`.
- Audit log API and writer exist in `apps/api/src/routes/audit-log.ts` and
  `apps/api/src/audit.ts`.
- `task_events` are append-only inserts from task routes and worker code.
- `execution_kind` support exists in migration
  `infra/postgres/migrations/006_task_execution_foundation.sql`.
- Worker lease, heartbeat, state transition, and manual lifecycle handling exist
  in `apps/workers/src/task-worker.ts`.
- Dashboard task actions exist in `apps/web/src/pages/tasks.tsx`.

Stage 4 can add `hermes_operator` as an additional execution kind without
replacing the existing manual lifecycle path.

## Verified Hermes Runtime Facts

The official Docker docs describe running Hermes in Docker with:

- image: `nousresearch/hermes-agent`
- command: `gateway run`
- persistent data mounted into the container at `/opt/data`
- gateway API/default health port: `8642`

The official API docs describe:

- `API_SERVER_ENABLED=true`
- `API_SERVER_KEY` as the bearer-token secret
- default `API_SERVER_PORT=8642`
- default `API_SERVER_HOST=127.0.0.1`
- no browser CORS by default
- `API_SERVER_CORS_ORIGINS` only when direct browser access is explicitly needed

For Frank Hub, direct browser access is forbidden. Only Frank API/workers call
Hermes.

## Verified API Endpoints

Official docs and source confirm:

- `GET /health`
- `GET /health/detailed`
- `GET /v1/models`
- `POST /v1/runs`
- `GET /v1/runs/{run_id}/events`
- `POST /v1/runs/{run_id}/stop`

The source also exposes OpenAI-compatible endpoints such as
`POST /v1/chat/completions`, `POST /v1/responses`, response retrieval, and jobs
API routes. Stage 4 should use the runs API because it returns a `run_id` and
has an event stream designed for dashboards.

## Runs API Shape

The current source accepts `POST /v1/runs` with an `input` payload and returns a
JSON response like:

```json
{ "run_id": "run_...", "status": "started" }
```

`GET /v1/runs/{run_id}/events` is a Server-Sent Events stream. Observed event
names in source include:

- `tool.started`
- `tool.completed`
- `reasoning.available`
- `message.delta`
- `run.completed`
- `run.failed`

`POST /v1/runs/{run_id}/stop` attempts to interrupt the active agent, cancels
the owning task where possible, and returns:

```json
{ "run_id": "run_...", "status": "stopping" }
```

Frank should still tolerate `404` or missing stop support and fall back to
Frank-only cancellation if a deployed Hermes version differs.

## Docker Image Pinning

`nousresearch/hermes-agent:latest` was inspected locally with Docker manifest
metadata. Current manifest includes:

- linux/amd64 digest:
  `sha256:db9ccf45a210ca45446415ac183bd8430840d1ae168c6415c47047f9c3cc4ce8`
- linux/arm64 digest:
  `sha256:ebbe710adf2ead41017e6d1d1b5f65bcdd22629088e63dd99861f9e3bc1f7fa6`

Stage 4 Compose uses `HERMES_IMAGE=${HERMES_IMAGE:-nousresearch/hermes-agent:latest}`.
This keeps the first install simple while making pinning a one-line `.env`
change. Production should pin `HERMES_IMAGE` to a tested tag or digest after the
first successful VPS Hermes run.

## Security Decision

Hermes has terminal, file, web, memory, and skills access. Frank must treat the
Hermes API as a private privileged control socket.

Security gates:

- `HERMES_API_SERVER_KEY` must be non-empty when `HERMES_ENABLED=true`.
- Frank refuses enabled Hermes operation if the key is missing.
- Browser never calls Hermes.
- Frank must not configure Hermes CORS for browser access.
- No Cloudflare hostname is created for Hermes.
- `docker-compose.hermes.yml` must not publish `8642:8642`.
- If host debugging is ever required, bind only `127.0.0.1:8642:8642`.

The Compose service may bind inside the Docker network so Frank containers can
reach it; that is not a host-public bind.

## Stop Strategy

Primary stop path:

1. `POST /v1/runs/{run_id}/stop`
2. Mark the Frank `runner_session` as `stopping`.
3. Persist stop outcome and final status from the event stream or collection
   step.

Fallback path:

- If the endpoint is unavailable, use Frank-only cancellation and record method
  `frank_only`.
- If Frank later owns a process/container session directly, process or container
  stop can be added behind the same adapter method without exposing it to the UI.

## Workspace Decision

Default workspace root:

```text
/opt/frank-hub/workspaces
```

Task workspace:

```text
/opt/frank-hub/workspaces/tasks/{task_id}
```

Repo-wide tasks may use `/opt/frank-hub` only when explicitly selected. Frank
must never pass `/` or `/root` as the workspace.

## Known Limitations

- The public API docs document the runs API but do not fully specify every event
  payload field. The adapter must normalize unknown events defensively.
- The stop endpoint exists in current source, but Frank must tolerate older or
  different deployments where it is missing.
- The image is active and `latest` may move. Pin `HERMES_IMAGE` after first VPS
  validation.
- Stage 4 does not implement Frank-native memory or skills. Hermes memory and
  skills remain execution-time systems.

## Architecture Decision

Use a private Hermes Docker gateway on the same Compose network and integrate
through one `HermesRunnerAdapter`.

Frank will:

- own tasks, runner sessions, events, artifacts, backups, kill switch, audit,
  and UI state;
- call `POST /v1/runs` for task execution;
- consume `GET /v1/runs/{run_id}/events` for logs and final output;
- call `POST /v1/runs/{run_id}/stop` when available;
- keep all Hermes access server-side.

Hermes will:

- own terminal/file/web execution;
- own skills and memory during execution;
- not be exposed directly to the browser or public internet.
