# Autonomous FRANK release safety runbook

Runbook ID: `RB-REL-002`  
Version: 2  
Scope: the current single-host FRANK deployment on `vps`  
Owner: release operator

This runbook adds three fail-closed controls around a release:

1. a hosted preflight against the exact reviewed commit;
2. a timestamped, checksummed PostgreSQL backup set;
3. a fail-closed production application Compose overlay and hardened edge policy;
4. public HTTPS liveness, readiness, and web smoke checks after deployment.

The scripts do **not** pull source, build images, run migrations, restart containers,
or deploy. The production mutation remains an explicit, separately authorized release
step between the backup and smoke gates.

## Safety contract

- Run these commands on the VPS, never against `localhost` from a workstation.
- Keep shell tracing disabled. None of the scripts prints a secret value.
- Inject secrets from OpenBao or the accepted runtime secret path. Do not source a
  repository file or a world-readable `.env` file.
- Supply the full reviewed 40-character commit. A branch name is not a release identity.
- Stop immediately if any command exits non-zero. Do not bypass a failed gate.
- Do not use `scripts/rebuild.sh` for a release: it pulls mutable `main`, builds in
  production, and its `localhost:3000` probe does not address the FRANK API.
- Database restore is never automatic. A failed release normally rolls the application
  images back while preserving forward-compatible schema changes.
- The production application definition is always the ordered pair
  `/srv/frank/infra/docker-compose.dev.yml` then
  `/srv/frank/repo/infra/production/docker-compose.app.yml`. Never reverse them or apply
  the overlay alone.

## Files

| File | Purpose | Production mutation when run |
|---|---|---|
| `scripts/production/hosted-preflight.sh` | Disk, Git, secret-name, Docker, network, Compose, container, and image gates | None |
| `scripts/production/backup-postgres.sh` | Atomic gzip `pg_dump`, SHA-256 verification, manifest, retention | Writes backup sets and removes expired matching sets |
| `scripts/production/post-deploy-smoke.sh` | Public `/live`, `/ready`, and web-root checks | None beyond ordinary request logs |
| `infra/production/docker-compose.app.yml` | Authoritative production overrides for API, web, and their Caddy dependency | None until passed to `docker compose up` or `build` |
| `infra/production/Caddyfile.frank-production` | Replacement `frank.fail` site block with a private UI/control surface | None until merged into the live Caddy candidate and reloaded |

Required host commands are Bash 4.3+, Docker with Compose, Git, `jq`, `curl`,
`gzip`, `sha256sum`, `flock`, `find`, `realpath`, and standard GNU coreutils.

## 1. Create the release evidence directory

Use a new root-owned directory for every attempt, including failed attempts:

```bash
set -Eeuo pipefail
set +x
umask 077

cd /srv/frank/repo
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
evidence_dir="/srv/frank/release-evidence/$release_id"
install -d -m 0700 -- "$evidence_dir"
```

Record the release request separately in the change pack. The evidence directory is an
operator artifact, not a place for credentials.

## 2. Pin the reviewed identity and runtime requirements

Set only identifiers and variable **names** in the command history:

```bash
export FRANK_EXPECTED_COMMIT='<FULL_40_CHARACTER_REVIEWED_COMMIT>'
export FRANK_EXPECTED_BRANCH='main'
export FRANK_REPO_PATH='/srv/frank/repo'
export FRANK_COMPOSE_FILE='/srv/frank/infra/docker-compose.dev.yml'
export FRANK_DATA_PATH='/srv/frank'
export FRANK_MAX_DISK_PERCENT='75'
export FRANK_MIN_FREE_GIB='20'
export FRANK_REQUIRED_NETWORK='frank'
export FRANK_REQUIRED_SECRET_VARS='FRANK_DB_PASSWORD FRANK_DATABASE_URL FRANK_REDIS_URL FRANK_SESSION_SIGNING_KEY FRANK_ENVELOPE_SIGNING_KEY DEEPSEEK_API_KEY FRANK_DOMAIN_SERVICE_TOKEN FRANK_PACK_SIGNING_KEY GOOSE_ACP_SECRET FRANK_BASIC_AUTH_HASH FRANK_BASIC_AUTH_PASSWORD'
```

The secret variables named above must then be injected into the current process by the
accepted secret runtime. Do not paste their values into this runbook, a command log, or
the evidence directory.

Optional overrides:

- `FRANK_REQUIRED_CONTAINERS`: comma- or space-separated container names.
- `FRANK_REQUIRED_IMAGES`: comma- or space-separated image references.
- `FRANK_REQUIRE_UPSTREAM_SYNC=false`: only for an intentionally detached, exact-commit
  release whose exception is already recorded. The expected commit check remains mandatory.
- `FRANK_IMAGE_LOCK_FILE`: absolute path to a non-secret file containing one
  `<image-reference> <sha256:image-id>` pair per line. Use this when immutable image IDs
  have been prepared; a mismatch blocks release.

## 3. Run hosted preflight

```bash
bash scripts/production/hosted-preflight.sh \
  > "$evidence_dir/preflight.result" \
  2> "$evidence_dir/preflight.log"

grep -Fx 'preflight=passed' "$evidence_dir/preflight.result"
```

The result records the commit, branch, locally known upstream state, disk state, network,
and counts of checked containers, images, and secret names. The log contains secret names
only. A dirty worktree, wrong commit, unsynchronized branch, missing secret, invalid
Compose model, absent image, unhealthy container, or insufficient disk fails the gate.

The upstream check does not fetch. CI or the release operator must fetch before this step
and ensure the locally known upstream reference is current.

### 3A. Define and validate the production application overlay

Set the non-secret release/runtime identifiers. Secret values named in step 2 remain
injected by the accepted runtime and are not repeated here:

```bash
export FRANK_RELEASE_COMMIT="$FRANK_EXPECTED_COMMIT"
export FRANK_RELEASE_IMAGE_TAG="$FRANK_EXPECTED_COMMIT"
export FRANK_CELL_ID='frank'
export FRANK_OWNER_ID='steven'
export FRANK_API_AUDIENCE='frank.api'
export FRANK_PUBLIC_URL='https://frank.fail'
export FRANK_API_INTERNAL_URL='http://frank-api:3000'
export FRANK_WEB_INTERNAL_URL='http://frank-web:3001'
export FRANK_LOG_LEVEL='info'
export FRANK_MAX_BODY_BYTES='1048576'

export FRANK_WORKBENCH_RUNNER_ENABLED='true'
export FRANK_WORKBENCH_CONCURRENCY='2'
export FRANK_WORKBENCH_IMAGE_REPOSITORY='<REVIEWED_REGISTRY_AND_REPOSITORY>'
export FRANK_WORKBENCH_IMAGE_TAG='<REVIEWED_IMMUTABLE_TAG>'
export FRANK_WORKBENCH_IMAGE_DIGEST='sha256:<64_HEX_DIGEST>'
export FRANK_WORKBENCH_MODEL_PROVIDER='<REVIEWED_PROVIDER_ID>'
export FRANK_WORKBENCH_MODEL_BASE_URL='<REVIEWED_HTTPS_PROVIDER_BASE_URL>'
export FRANK_WORKBENCH_MODEL='<REVIEWED_MODEL_ID>'
export FRANK_WORKSPACE_SOURCE_HOST_PATH='/srv/frank/repo'

export GOOSE_ACP_URL='<REVIEWED_WS_OR_WSS_URL>'
export GOOSE_PROVIDER='<REVIEWED_GOOSE_PROVIDER_ID>'
export GOOSE_MODEL='<REVIEWED_GOOSE_MODEL_ID>'
export FRANK_EXPECTED_MODEL="$GOOSE_MODEL"

export FRANK_DOCKER_SOCKET_GID="$(stat -c '%g' /var/run/docker.sock)"
export FRANK_API_MEMORY_LIMIT='2048m'
export FRANK_API_CPU_LIMIT='2.0'
export FRANK_WEB_MEMORY_LIMIT='1536m'
export FRANK_WEB_CPU_LIMIT='1.5'
export FRANK_LOG_MAX_SIZE='10m'
export FRANK_LOG_MAX_FILES='5'
export FRANK_BASIC_AUTH_USER='<NON_SECRET_OPERATOR_NAME>'
```

`FRANK_DATABASE_URL`, `FRANK_REDIS_URL`, signing keys, `DEEPSEEK_API_KEY`,
`FRANK_DOMAIN_SERVICE_TOKEN`, `GOOSE_ACP_SECRET`, `FRANK_BASIC_AUTH_HASH`, and
`FRANK_BASIC_AUTH_PASSWORD` are secret material even when a name says "URL" or "hash".
Inject their values without shell tracing. The Caddyfile accepts only the compatible hash;
the plaintext password exists only in the root release environment for authenticated smoke.

Two values require operational issuance, not an invented repository default:

- `FRANK_DOMAIN_SERVICE_TOKEN` must be a production bearer credential issued for the web
  BFF with only its required API capabilities. The repository has no production token-mint
  command; generate and rotate it through the accepted identity/secret system before this
  release. A development-session token is not acceptable.
- `FRANK_BASIC_AUTH_HASH` must be generated from a separately stored strong password with
  Caddy's bcrypt password tool. Store the hash and its corresponding
  `FRANK_BASIC_AUTH_PASSWORD` in the root-only secret runtime. Neither value belongs in Git,
  the candidate Caddyfile, or release evidence.

Validate formats and the fully merged model without saving or printing the resolved
Compose document, because it contains injected values:

```bash
base_compose='/srv/frank/infra/docker-compose.dev.yml'
app_overlay='/srv/frank/repo/infra/production/docker-compose.app.yml'
compose=(docker compose -f "$base_compose" -f "$app_overlay")

version="$(docker compose version --short)"
test "$(printf '%s\n' '2.24.4' "$version" | sort -V | head -n1)" = '2.24.4'
test "$FRANK_WORKBENCH_RUNNER_ENABLED" = 'true'
test "$FRANK_WORKBENCH_CONCURRENCY" -ge 1
test "$FRANK_WORKBENCH_CONCURRENCY" -le 8
printf '%s' "$FRANK_WORKBENCH_IMAGE_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'
printf '%s' "$FRANK_RELEASE_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
printf '%s' "$FRANK_DOCKER_SOCKET_GID" | grep -Eq '^[0-9]+$'
test "$(realpath -e -- "$FRANK_WORKSPACE_SOURCE_HOST_PATH")" = '/srv/frank/repo'
case "$FRANK_BASIC_AUTH_HASH" in
  '$2a$'*|'$2b$'*|'$2y$'*) ;;
  *) printf '%s\n' 'FRANK_BASIC_AUTH_HASH must be a bcrypt hash' >&2; exit 1 ;;
esac

"${compose[@]}" config --quiet
"${compose[@]}" config --format json | jq -e '
  .services["frank-api"].build.context == "/srv/frank/repo" and
  .services["frank-web"].build.context == "/srv/frank/repo" and
  .services["frank-api"].environment.FRANK_ENV == "production" and
  .services["frank-web"].environment.FRANK_DOMAIN_API_URL == "http://frank-api:3000" and
  .services["frank-caddy"].environment.FRANK_WEB_INTERNAL_URL == "http://frank-web:3001" and
  (.services["frank-api"].environment.FRANK_WORKBENCH_IMAGE |
    test("@sha256:[0-9a-f]{64}$")) and
  ([.services | to_entries[] |
    select(any(.value.volumes[]?;
      .type == "bind" and .source == "/var/run/docker.sock")) |
    .key] == ["frank-api"]) and
  ((.services["frank-api"].ports // []) | length == 0) and
  ((.services["frank-web"].ports // []) | length == 0) and
  ((.services["frank-db"].ports // []) | length == 0) and
  ((.services["frank-redis"].ports // []) | length == 0) and
  ((.services["frank-codegraph"].ports // []) | length == 0) and
  (.services["frank-api"].healthcheck != null) and
  (.services["frank-web"].healthcheck != null)
' >/dev/null

"${compose[@]}" config --images > "$evidence_dir/compose.images.expected.txt"
sha256sum "$base_compose" "$app_overlay" \
  /srv/frank/repo/infra/production/Caddyfile.frank-production \
  > "$evidence_dir/release-inputs.sha256"
```

The `!override` and `!reset` tags are security controls, not cosmetic merge choices. They
remove inherited development environment entries, constrain the API mount set, and prove
that API/web and all supporting stores have no host-published ports. The Docker socket
remains a root-equivalent daemon capability even though the API process is non-root; only
the reviewed API image may receive it, and no workbench container may ever inherit it.
`DEEPSEEK_API_KEY` is renamed into the API environment only. The control-plane model loop
uses it for inference and passes only commands through `docker exec`, never the key or a
provider environment file.

## 4. Capture rollback images and configuration evidence

Capture the exact running image IDs before changing anything:

```bash
for container in frank-frank-api-1 frank-web frank-codegraph frank-frank-caddy-1; do
  docker inspect --format '{{.Name}}\t{{.Config.Image}}\t{{.Image}}' "$container"
done > "$evidence_dir/containers.before.tsv"

git -C /srv/frank/repo rev-parse HEAD > "$evidence_dir/git.before.txt"
sha256sum /srv/frank/infra/docker-compose.dev.yml \
  /srv/frank/infra/Caddyfile \
  /srv/frank/repo/infra/production/docker-compose.app.yml \
  /srv/frank/repo/infra/production/Caddyfile.frank-production \
  > "$evidence_dir/config.before.sha256"

rollback_config_dir="/srv/frank/config-rollback/$release_id"
install -d -m 0700 -- "$rollback_config_dir"
install -m 0600 -- /srv/frank/infra/Caddyfile "$rollback_config_dir/Caddyfile"

docker image tag "$(docker inspect --format '{{.Image}}' frank-frank-api-1)" \
  "frank-frank-api:rollback-$release_id"
docker image tag "$(docker inspect --format '{{.Image}}' frank-web)" \
  "frank-frank-web:rollback-$release_id"
docker image tag "$(docker inspect --format '{{.Image}}' frank-codegraph)" \
  "frank-frank-codegraph:rollback-$release_id"
```

Image tags are local recovery pointers. The immutable image IDs in
`containers.before.tsv` are the evidence anchor.

## 5. Create and verify the database backup

The default output root is `/srv/frank/backups/postgres`; default retention is 35 days.
Retention only removes directories matching `frank-postgres-YYYYMMDDTHHMMSSZ` directly
under the resolved backup root.

```bash
export FRANK_DB_CONTAINER='frank-frank-db-1'
export FRANK_BACKUP_DIR='/srv/frank/backups/postgres'
export FRANK_BACKUP_RETENTION_DAYS='35'

bash scripts/production/backup-postgres.sh \
  > "$evidence_dir/backup.result" \
  2> "$evidence_dir/backup.log"

backup_set="$(awk -F= '$1 == "backup_set" {print $2}' "$evidence_dir/backup.result")"
test -n "$backup_set"
(
  cd -- "$backup_set"
  sha256sum --check SHA256SUMS
) > "$evidence_dir/backup.verify.txt"
```

Each backup set contains:

- `frank-postgres-<timestamp>.sql.gz` - plain SQL, gzip-compressed;
- `SHA256SUMS` - standard SHA-256 manifest;
- `manifest.env` - timestamp, byte size, container/image identity, source commit,
  and retention setting, with no credential or database content.

This is a local recovery point, not the required off-provider backup. Copy the complete
set to the approved encrypted off-cell store and record its immutable object/version ID
before a state-changing release.

## 6. Deployment boundary

Only after preflight, overlay validation, rollback-image capture, local backup verification,
and off-cell copy evidence are complete may the approved deployment mechanism run. Never
substitute a `git pull`, an unrecorded mutable build, or the legacy rebuild script.

The application overlay builds from the exact checked-out repository. Build and record the
two image IDs before changing a running container:

```bash
"${compose[@]}" build --pull frank-api frank-web \
  > "$evidence_dir/build.log" 2>&1

docker image inspect \
  "frank-frank-api:$FRANK_RELEASE_IMAGE_TAG" \
  "frank-frank-web:$FRANK_RELEASE_IMAGE_TAG" \
  --format '{{.RepoTags}}\t{{.Id}}' \
  > "$evidence_dir/application-images.built.tsv"

workbench_image_ref="${FRANK_WORKBENCH_IMAGE_REPOSITORY}:${FRANK_WORKBENCH_IMAGE_TAG}@${FRANK_WORKBENCH_IMAGE_DIGEST}"
docker pull --quiet "$workbench_image_ref" \
  > "$evidence_dir/workbench-image.pull.txt"
docker image inspect "$workbench_image_ref" \
  --format '{{.RepoDigests}}\t{{.Id}}' \
  > "$evidence_dir/workbench-image.resolved.tsv"

# One-time/repair-safe ownership initialization for the persistent artifact volume.
# The API then runs as uid/gid 10001 and archives /workspace/out here before teardown.
docker volume create \
  --label com.frank.purpose=workbench-artifacts \
  frank_workbench_artifacts \
  > "$evidence_dir/artifact-volume.create.txt"
docker run --rm \
  --user 0:0 \
  --mount type=volume,source=frank_workbench_artifacts,target=/var/lib/frank/artifacts \
  "frank-frank-api:$FRANK_RELEASE_IMAGE_TAG" \
  sh -ceu 'mkdir -p /var/lib/frank/artifacts; chown 10001:10001 /var/lib/frank/artifacts; chmod 0750 /var/lib/frank/artifacts'
docker volume inspect frank_workbench_artifacts \
  --format '{{.Name}}\t{{json .Labels}}' \
  > "$evidence_dir/artifact-volume.inspect.tsv"
```

The present application Dockerfiles still resolve a mutable `node:22-alpine` base and the
API installs dependencies without a frozen lockfile. Until those separate application-image
gaps are closed or the resulting images are promoted to an approved immutable registry,
the image IDs in `application-images.built.tsv` are mandatory evidence and a rebuild is a
new artifact, not the same release.

The Caddy file in `infra/production` is the authoritative replacement for only the existing
`frank.fail` site block. The live Caddyfile also owns unrelated hostnames, so replacing the
whole file with this fragment is forbidden. Assemble a root-owned candidate by preserving
every other live block and replacing exactly the old `frank.fail` block. The candidate must
contain no credential value: it retains `{$FRANK_BASIC_AUTH_USER}` and
`{$FRANK_BASIC_AUTH_HASH}` placeholders.

Validate that full candidate before installation:

```bash
caddy_candidate="$evidence_dir/Caddyfile.candidate"
test -s "$caddy_candidate"
test "$(grep -Ec '^[[:space:]]*frank\.fail[[:space:]]*\{' "$caddy_candidate")" -eq 1
grep -Fq '{$FRANK_BASIC_AUTH_USER}' "$caddy_candidate"
grep -Fq '{$FRANK_BASIC_AUTH_HASH}' "$caddy_candidate"

docker run --rm \
  -e FRANK_BASIC_AUTH_USER \
  -e FRANK_BASIC_AUTH_HASH \
  -v "$caddy_candidate:/etc/caddy/Caddyfile:ro" \
  caddy:2.8-alpine \
  caddy validate --config /etc/caddy/Caddyfile \
  > "$evidence_dir/caddy.validate.txt" 2>&1
```

If the candidate cannot be assembled with all unrelated routes preserved, the release is
blocked. Once the candidate and image provenance are accepted, the bounded production
mutation is:

```bash
install -m 0644 -- "$caddy_candidate" /srv/frank/infra/Caddyfile

"${compose[@]}" up -d \
  --no-build \
  --wait \
  --wait-timeout 180 \
  frank-api frank-web frank-caddy \
  > "$evidence_dir/compose-up.log" 2>&1

"${compose[@]}" ps \
  --format json > "$evidence_dir/compose-after.json"
docker inspect frank-frank-api-1 frank-web frank-frank-caddy-1 \
  --format '{{.Name}}\t{{.Image}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
  > "$evidence_dir/containers.after.tsv"
sha256sum /srv/frank/infra/Caddyfile > "$evidence_dir/caddy.after.sha256"
```

The deployment receipt must add the following to the same evidence directory:

- reviewed commit and signed artifact/image IDs;
- exact deployment command or workflow run ID;
- migration identifiers and compatibility decision;
- start/end timestamps and operator identity;
- Compose and edge configuration hashes after deployment;
- container image IDs after deployment.

If the resulting application image IDs, Caddy candidate, migration compatibility, or
off-cell backup receipt are not accepted, the release is blocked at this boundary.

## 7. Run public post-deploy smoke checks

Do not replace these checks with a host-loopback request. The hardened public contract is
HTTP 200 for liveness/readiness and HTTP 401 for `/`; a 200 root would mean the real app
and objective-entry UI were exposed without the required edge gate.

```bash
export FRANK_PUBLIC_URL='https://frank.fail'
export FRANK_EXPECTED_SERVICE='frank-api'

bash scripts/production/post-deploy-smoke.sh \
  > "$evidence_dir/smoke.result" \
  2> "$evidence_dir/smoke.log"

grep -Fx 'smoke=passed' "$evidence_dir/smoke.result"
grep -Fx 'live_http=200' "$evidence_dir/smoke.result"
grep -Fx 'ready_http=200' "$evidence_dir/smoke.result"
grep -Fx 'root_unauth_http=401' "$evidence_dir/smoke.result"
grep -Fx 'root_auth_http=200' "$evidence_dir/smoke.result"
```

The script runs as root and writes the Basic Auth username/password only to a mode-0600
temporary curl config inside a mode-0700 directory. It removes the directory on exit and
never places either value in argv, stdout, stderr, or evidence. Set
`FRANK_WEB_EXPECTED_PATTERN` to a non-secret release marker when one is available; it is
checked against the authenticated real app, not the 401 response.

Continue external monitoring for the release observation window. One passing probe is
necessary evidence, not proof of sustained health.

## Rollback

Rollback is required when public smoke checks fail, a required container becomes
unhealthy, error rates materially increase, or migration compatibility differs from the
recorded release plan.

### Application-only rollback

Use this path only when the prior application is compatible with the current database
schema. Retag the captured prior images under the overlay's rollback tag, restore the
previous Caddyfile, then recreate only the application and edge services:

```bash
export FRANK_RELEASE_IMAGE_TAG="rollback-$release_id"
install -m 0644 -- "$rollback_config_dir/Caddyfile" /srv/frank/infra/Caddyfile

"${compose[@]}" up -d \
  --no-build \
  --force-recreate \
  --wait \
  --wait-timeout 180 \
  frank-api frank-web frank-caddy

bash scripts/production/post-deploy-smoke.sh \
  > "$evidence_dir/rollback-smoke.result" \
  2> "$evidence_dir/rollback-smoke.log"
grep -Fx 'smoke=passed' "$evidence_dir/rollback-smoke.result"
```

Record the resulting container image IDs and compare them with
`containers.before.tsv`, and compare the restored Caddy hash with
`config.before.sha256`. If they differ, rollback is not complete.

### Database recovery or migration failure

Do not restore over the live database while writers are running. Fence traffic and side
effects, preserve the failed state, and open an incident. First prove the backup in a
separate recovery PostgreSQL container or recovery cell:

```bash
backup_file="$(awk -F= '$1 == "backup_file" {print $2}' "$evidence_dir/backup.result")"
backup_set="${backup_file%/*}"
(
  cd -- "$backup_set"
  sha256sum --check SHA256SUMS
)

export FRANK_RECOVERY_DB_CONTAINER='<SEPARATE_RECOVERY_POSTGRES_CONTAINER>'
export FRANK_RECOVERY_DATABASE="frank_restore_${release_id}"

docker exec \
  -e FRANK_RECOVERY_DATABASE="$FRANK_RECOVERY_DATABASE" \
  "$FRANK_RECOVERY_DB_CONTAINER" \
  sh -ceu 'createdb --username "$POSTGRES_USER" "$FRANK_RECOVERY_DATABASE"'

gzip -cd -- "$backup_file" | docker exec -i \
  -e FRANK_RECOVERY_DATABASE="$FRANK_RECOVERY_DATABASE" \
  "$FRANK_RECOVERY_DB_CONTAINER" \
  sh -ceu 'psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$FRANK_RECOVERY_DATABASE"'
```

Verify migrations, critical table counts, audit-chain continuity, and application reads in
the isolated recovery target. A destructive live restore requires an incident-specific
plan that identifies the fenced writer, accepted data-loss point, restored checksum,
reconciliation method, and explicit release authority.

## Required evidence on completion

Retain these artifacts together:

- `preflight.result` and `preflight.log`;
- `containers.before.tsv`, Git commit, and configuration hashes;
- backup result, backup log, `SHA256SUMS`, `manifest.env`, verification output, and
  encrypted off-cell object/version ID;
- deployment workflow/command receipt and migration identifiers;
- post-deploy smoke result/log and observation-window health evidence;
- on rollback, prior and restored image IDs, rollback smoke output, incident ID, and any
  isolated restore evidence.

Never place secret values, `.env` files, raw session tokens, database contents, or private
keys in the release evidence directory.
