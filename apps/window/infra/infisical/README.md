# Private Infisical CE for Frank/Hermes

This is a separate Docker Compose stack for the existing Frank VPS. It adds no
Frank application code and does not expose an Infisical UI or API publicly.

The backend is pinned to Infisical CE `v0.162.14` by multi-architecture image
manifest digest. Postgres 16 Alpine and Redis 7.4 Alpine are also pinned by
manifest digest. The backend publishes only `127.0.0.1:18082:8080` by default;
the port is configurable through the generated external env file. Postgres and
Redis have no host ports and use the internal `infisical_private` network.
All three services stay on that private network; the backend's only host
reachability is the loopback binding. It does not join Frank's shared Docker
network, so Caddy and the Frank container cannot reach it directly. Caddy is
not changed.

## Files and secret boundary

- `compose.yml` is the tracked stack definition.
- `deploy.sh` creates `/srv/infisical/secrets/infisical.env` with fresh keys on
  first run, preserves it thereafter, validates mode `0600`, and starts the
  stack without removing volumes.
- `check.sh` verifies container health, the loopback-only binding, and the
  `/api/status` endpoint.
- `bootstrap-hermes.sh` uses a one-time admin API token supplied in the process
  environment to create the project, environment, fixed-scope CRUD role,
  project machine identity, Universal Auth method, and client secret. It stores only
  non-secret identity metadata in
  `/srv/infisical/secrets/hermes-bootstrap.env`. It requires an existing
  `HERMES_CONFIG_FILE` and an explicit `HERMES_SECRET_FILE` path; if the latter
  already exists, it must be a regular, non-symlink 0600 file. It receives only
  the Universal Auth client ID and client secret through an atomic 0600
  replacement. Credentials are never printed.
  The config update targets only Hermes' `plugins.entries.connections-agent.settings`
  subtree and preserves unrelated YAML. The script then runs an in-process
  Universal Auth CRUD/denial canary and removes its temporary secret.
- `resolve-hermes-python.sh` selects `HERMES_PYTHON` when provided, otherwise
  checks `$HERMES_INSTALL_DIR/venv/bin/python`, `$HERMES_HOME/venv/bin/python`,
  `$HERMES_HOME/venvs/hermes-dev/bin/python`, and
  `~/.hermes/venvs/hermes-dev/bin/python` before system `python3`. The selected
  interpreter must import `ruamel.yaml`; no package is installed by this bundle.
- `test.sh` performs shell syntax, static policy, optional ShellCheck, and
  optional Compose validation.

The tracked `infisical.env.example` is documentation only. Never copy secrets
from it into production.

## Parent execution commands

From the exact committed revision on the VPS:

```bash
cd /projects/frank/apps/window/infra/infisical
./deploy.sh
./check.sh
```

The expected private URL for Hermes is:

```text
http://127.0.0.1:18082
```

If port `18082` is already used, set `INFISICAL_HOST_PORT` before the first
deploy. The value is then persisted in the external env file. `deploy.sh`
refuses a port already in use and refuses any non-loopback compose binding.

## One-time human bootstrap

The official Compose flow requires the first user to sign up as the instance
administrator. This is the only UI step. It stays private: after deployment,
create an SSH tunnel from the operator workstation:

```bash
ssh -N -L 18082:127.0.0.1:18082 <vps-host>
```

Open `http://127.0.0.1:18082` through that tunnel, create the first admin
account, and close the tunnel. No public DNS or port is needed. Obtain a
short-lived admin API token from that account, then run the API bootstrap from
the VPS without putting the token in a file. Set the exact default-profile
config path and Hermes-owned credentials file:

```bash
cd /projects/frank/apps/window/infra/infisical
HERMES_CONFIG_FILE=/home/hermes/.hermes/config.yaml \
HERMES_SECRET_FILE=/srv/hermes/secrets/connections.env \
INFISICAL_BOOTSTRAP_TOKEN='short-lived-admin-token' ./bootstrap-hermes.sh
```

The paths above are examples; set them to the actual default-profile
`config.yaml` and Hermes 0600 secret file. `HERMES_PYTHON` may be set to the
production Hermes venv interpreter when it is not discoverable. Frank must
receive no Infisical token or client secret. The env file contains only the
canonical client ID and client secret for Universal Auth.
Hermes must use the client credentials to call
`POST /api/v1/auth/universal-auth/login`, cache the short-lived access token in
memory, reacquire it before expiry, and retry once on a 401. This bundle does
not generate or persist a static Infisical token; any static-token fallback must
be independently configured by Hermes.

The bootstrap writes this exact non-secret settings block into the default
profile's `config.yaml` (and only this subtree):

```yaml
plugins:
  entries:
    connections-agent:
      settings:
        enabled: true
        frank_url: http://127.0.0.1:18080
        infisical_url: http://127.0.0.1:18082
        infisical_project_id: <project-id>
        infisical_environment: production
        secret_path: /hermes
        resend_secret_name: RESEND_API_KEY
```

The behavior settings are config-authoritative; they are not written as
`HERMES_CONNECTIONS_*` environment variables. The only Infisical credentials
written to the 0600 env file are
`HERMES_CONNECTIONS_INFISICAL_CLIENT_ID` and
`HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET`.

Hermes reads secrets with the v4 endpoint:

```text
GET http://127.0.0.1:18082/api/v4/secrets
  ?projectId=<project-id>
  &environment=production
  &secretPath=/hermes
  &viewSecretValue=true
```

The bootstrap defaults are the exact identity: project slug
`frank-hermes-vault`, environment slug `production`, path `/hermes`, identity
`hermes-vault-broker`, and custom project role `hermes-vault-broker`. The role
grants only secret `read`, `create`, `edit`, and `delete`, plus folder read,
under that exact environment/path. Override the documented `INFISICAL_*`
variables before the first bootstrap if a different identity is required.
The bootstrap proves the identity has exactly one permanent project role, then
logs in with Universal Auth and verifies create/read/edit/delete at
`production:/hermes` while rejecting another path, environment, and project.

## Operations and rollback

Back up before upgrades or restores. The Postgres volume is the source of truth
for encrypted secrets, users, projects, and configuration; keep the encryption
key and auth secret with the backup procedure. Redis is cache/job state but is
persisted for clean restart behavior.

```bash
cd /projects/frank/apps/window/infra/infisical
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 -p "/srv/infisical/backups/$stamp"
docker compose --project-name infisical --env-file /srv/infisical/secrets/infisical.env -f compose.yml exec -T db \
  pg_dump -U infisical -d infisical --format=custom > "/srv/infisical/backups/$stamp/infisical.dump"
cp --preserve=mode /srv/infisical/secrets/infisical.env "/srv/infisical/backups/$stamp/infisical.env"
```

Restore is a deliberate maintenance action: stop the stack, restore into an
temporary database/container or the existing Postgres database only after
validating the backup and matching encryption key, then start and run
`./check.sh`. For an intentional in-place restore, validate the exact dump and
target first, then run:

```bash
test -s /srv/infisical/backups/<stamp>/infisical.dump
docker inspect infisical-db >/dev/null
docker compose --project-name infisical --env-file /srv/infisical/secrets/infisical.env -f compose.yml stop backend
docker compose --project-name infisical --env-file /srv/infisical/secrets/infisical.env -f compose.yml exec -T db \
  pg_restore -U infisical -d infisical --clean --if-exists --no-owner < /srv/infisical/backups/<stamp>/infisical.dump
docker compose --project-name infisical --env-file /srv/infisical/secrets/infisical.env -f compose.yml up -d
./check.sh
```

Never use `docker compose down -v` on this stack; it deletes the
named volumes. If a new image fails health checks, restore the previous tracked
revision and image digest, run `docker compose up -d`, and verify with
`./check.sh`. The named volumes are intentionally unchanged during deploy,
upgrade, and rollback.

For an upgrade, change the three pinned image references in a reviewed commit,
run `./test.sh`, back up Postgres, then run `./deploy.sh` and `./check.sh`. A
rollback is the same operation with the prior committed bundle and the same
named volumes; do not delete volumes. If bootstrap fails after a canary is
created, its exit cleanup attempts deletion; verify the fixed path with the
read-only list endpoint before retrying. The final bootstrap canary must pass
before Hermes is restarted.

## Official references

- [Infisical Docker Compose deployment](https://infisical.com/docs/self-hosting/deployment-options/docker-compose)
- [Infisical self-hosted environment variables](https://infisical.com/docs/self-hosting/configuration/envars)
- [Infisical Docker Compose template](https://raw.githubusercontent.com/Infisical/infisical/main/docker-compose.prod.yml)
- [Infisical machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities)
- [Universal Auth login API](https://infisical.com/docs/api-reference/endpoints/universal-auth/login)
- [Universal Auth client secret API](https://infisical.com/docs/api-reference/endpoints/universal-auth/create-client-secret)
- [Project roles and scoped permissions](https://infisical.com/docs/internals/permissions/project-permissions)
- [Project identity membership API](https://infisical.com/docs/api-reference/endpoints/project-identities-membership/get-by-id)
- [v4 create secret API](https://infisical.com/docs/api-reference/endpoints/secrets/create)
- [v4 update secret API](https://infisical.com/docs/api-reference/endpoints/secrets/update)
- [v4 delete secret API](https://infisical.com/docs/api-reference/endpoints/secrets/delete)
- [v4 list secrets API](https://infisical.com/docs/api-reference/endpoints/secrets/list)
- [Infisical image tags and digests](https://hub.docker.com/r/infisical/infisical/tags)
