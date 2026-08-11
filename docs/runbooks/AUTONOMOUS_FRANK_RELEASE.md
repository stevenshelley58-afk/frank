# Autonomous FRANK release safety runbook

Runbook ID: `RB-REL-002`  
Version: 3
Scope: the current single-host FRANK deployment on `vps`  
Owner: release operator

This runbook adds five fail-closed controls around a release:

1. a hosted preflight against the exact reviewed commit;
2. a timestamped, checksummed PostgreSQL backup set;
3. an exact API/web/codegraph image and codegraph-volume rollback unit;
4. a fail-closed production application Compose overlay and hardened edge policy;
5. public HTTPS liveness, readiness, and web smoke checks after deployment.

The preflight, backup, snapshot, and smoke scripts do **not** pull source, build images,
run migrations, restart containers, or deploy. Snapshot briefly pauses and always
unpauses the legacy codegraph writer while archiving its volume. The rollback script is
an explicit recovery mutation, and the production release remains the bounded step
between the backup and smoke gates.

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
- The candidate production application definition is always the ordered pair
  `/srv/frank/infra/docker-compose.dev.yml` then the reviewed
  `$FRANK_RELEASE_SOURCE/infra/production/docker-compose.app.yml`. The release source is a
  separate clean immutable worktree; it is never the mutable central workspace. Never
  reverse the files or apply the overlay alone.

## Files

| File | Purpose | Production mutation when run |
|---|---|---|
| `scripts/production/hosted-preflight.sh` | Disk, Git, secret-name, Docker, network, Compose, container, and image gates | None |
| `scripts/production/backup-postgres.sh` | Atomic gzip `pg_dump`, SHA-256 verification, manifest, retention | Writes backup sets and removes expired matching sets |
| `scripts/production/post-deploy-smoke.sh` | Public `/live`, `/ready`, and web-root checks | None beyond ordinary request logs |
| `scripts/production/snapshot-codegraph-release.sh` | Captures prior API/web/codegraph images, legacy overlay, and codegraph volume | Briefly pauses codegraph; writes a checksummed root-only rollback set |
| `scripts/production/rollback-codegraph-release.sh` | Restores the captured three-service application unit and codegraph volume | Stops/recreates API, web, and codegraph; replaces codegraph volume contents |
| `infra/production/docker-compose.app.yml` | Authoritative production overrides for API, web, codegraph, and their Caddy dependency | None until passed to `docker compose up` |
| `infra/production/Caddyfile.frank-production` | Replacement `frank.fail` site block with a private UI/control surface | None until merged into the live Caddy candidate and reloaded |

Required host commands are Bash 4.3+, Docker with Compose, Git, GitHub CLI, `jq`,
`curl`, `gzip`, `openssl`, `sha256sum`, `flock`, `find`, `realpath`, and standard
GNU coreutils.

## 1. Create the release evidence directory

Use a new root-owned directory for every attempt, including failed attempts:

```bash
set -Eeuo pipefail
set +x
umask 077

cd /srv/frank
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
test "${#FRANK_EXPECTED_COMMIT}" -eq 40
printf '%s' "$FRANK_EXPECTED_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
release_branch="release-$release_id"
export FRANK_EXPECTED_BRANCH="$release_branch"
export FRANK_RELEASE_SOURCE="/srv/frank/releases/${release_id}-${FRANK_EXPECTED_COMMIT:0:12}"
export FRANK_REPO_PATH="$FRANK_RELEASE_SOURCE"
export FRANK_RELEASE_COMMIT="$FRANK_EXPECTED_COMMIT"
export FRANK_CELL_ID='frank'
export FRANK_API_AUDIENCE='frank.api'
export FRANK_COMPOSE_FILE='/srv/frank/infra/docker-compose.dev.yml'
export FRANK_DATA_PATH='/srv/frank'
export FRANK_MAX_DISK_PERCENT='75'
export FRANK_MIN_FREE_GIB='20'
export FRANK_DISK_GATE_MODE='absolute'
export FRANK_RELEASE_REQUIRED_BYTES='21932447888'
export FRANK_ROLLBACK_HEADROOM_BYTES='23862108519'
export FRANK_REQUIRED_NETWORK='frank'
export FRANK_CODEGRAPH_NETWORK='frank-codegraph-internal'
export FRANK_CODEGRAPH_CONTAINER='frank-codegraph'
export FRANK_REQUIRED_SECRET_VARS='FRANK_DB_PASSWORD FRANK_DATABASE_URL FRANK_REDIS_URL FRANK_SESSION_SIGNING_KEY FRANK_ENVELOPE_SIGNING_KEY DEEPSEEK_API_KEY FRANK_DOMAIN_SERVICE_TOKEN FRANK_PACK_SIGNING_KEY GOOSE_ACP_SECRET FRANK_BASIC_AUTH_HASH FRANK_BASIC_AUTH_PASSWORD'
```

The explicit absolute disk gate replaces the percentage decision for this release without
creating a bypass: `FRANK_DISK_GATE_MODE=absolute` requires both positive canonical-decimal
byte inputs, still enforces the independent 20 GiB minimum-free floor, rejects a signed
64-bit overflow, and requires available bytes to cover their sum. The default mode remains
the existing 75% gate for callers that do not opt into an audited absolute budget.

The `45,794,556,407`-byte requirement is deliberately conservative and was calculated from
audited candidate registry manifests and current committed limits. The fresh signed release
manifest is verified separately before deployment:

| Capacity held before mutation | Exact bytes |
|---|---:|
| Candidate image pull, nine-times compressed allowance for expanded layers, and one pull-staging copy | 10,234,814,980 |
| PostgreSQL backup plus transient output | 86,748,518 |
| CodeGraph volume snapshot plus transient output | 22,022,438 |
| Five coexisting Graphify releases at the committed 2 GiB limit | 10,737,418,240 |
| Bounded service logs and release evidence | 851,443,712 |
| **Release-required subtotal** | **21,932,447,888** |
| Retained rollback images and image archive | 1,850,401,127 |
| CodeGraph service minimum-free guard | 536,870,912 |
| Explicit operational safety reserve (20 GiB) | 21,474,836,480 |
| **Rollback-headroom subtotal** | **23,862,108,519** |
| **Total required free capacity** | **45,794,556,407** |

Recalculate and review both byte inputs whenever image sizes, the Graphify release limit or
retention count, database/volume sizes, log bounds, or the safety reserve changes. Never
lower them merely to pass preflight.

The secret variables named above, except `FRANK_DOMAIN_SERVICE_TOKEN`, must then be
injected into the current process by the accepted secret runtime. Step 3C mints and exports
that service token from the verified API digest before preflight. Do not paste any value
into this runbook, a command log, or the evidence directory.

### 2A. Materialize the clean exact release worktree

Use a dedicated bare cache. These commands do not read, fetch, reset, clean, or otherwise
modify `/srv/frank/repo`, so a dirty primary checkout is left untouched. The unique branch
allows preflight to prove both the exact reviewed commit and zero divergence from
`origin/main` without relying on detached-HEAD exceptions:

```bash
release_repo_url='https://github.com/stevenshelley58-afk/frank.git'
release_cache_root='/srv/frank/release-cache'
release_git_dir="$release_cache_root/frank.git"
release_worktrees_root='/srv/frank/releases'

install -d -m 0750 -- "$release_cache_root" "$release_worktrees_root"
test "$(realpath -e -- "$release_cache_root")" = "$release_cache_root"
test "$(realpath -e -- "$release_worktrees_root")" = "$release_worktrees_root"

if test ! -e "$release_git_dir"; then
  git clone --bare -- "$release_repo_url" "$release_git_dir"
fi
test "$(git --git-dir="$release_git_dir" rev-parse --is-bare-repository)" = 'true'
test "$(git --git-dir="$release_git_dir" remote get-url origin)" = "$release_repo_url"

git --git-dir="$release_git_dir" config remote.origin.fetch \
  '+refs/heads/main:refs/remotes/origin/main'
test "$(git --git-dir="$release_git_dir" config --get-all remote.origin.fetch)" = \
  '+refs/heads/main:refs/remotes/origin/main'
git --git-dir="$release_git_dir" fetch --prune origin \
  '+refs/heads/main:refs/remotes/origin/main'
origin_main="$(git --git-dir="$release_git_dir" rev-parse refs/remotes/origin/main)"
test "$origin_main" = "$FRANK_EXPECTED_COMMIT"
test ! -e "$FRANK_RELEASE_SOURCE" && test ! -L "$FRANK_RELEASE_SOURCE"
test -z "$(git --git-dir="$release_git_dir" branch --list "$release_branch")"

git --git-dir="$release_git_dir" worktree add --track -b "$release_branch" \
  "$FRANK_RELEASE_SOURCE" refs/remotes/origin/main

test "$(realpath -e -- "$FRANK_RELEASE_SOURCE")" = "$FRANK_RELEASE_SOURCE"
test "$(git -C "$FRANK_RELEASE_SOURCE" rev-parse HEAD)" = "$FRANK_EXPECTED_COMMIT"
test "$(git -C "$FRANK_RELEASE_SOURCE" symbolic-ref --short HEAD)" = "$FRANK_EXPECTED_BRANCH"
test "$(git -C "$FRANK_RELEASE_SOURCE" rev-parse --abbrev-ref '@{upstream}')" = 'origin/main'
test -z "$(git -C "$FRANK_RELEASE_SOURCE" status --porcelain=v1 --untracked-files=normal)"
test "$(git -C "$FRANK_RELEASE_SOURCE" rev-list --count origin/main..HEAD)" -eq 0
test "$(git -C "$FRANK_RELEASE_SOURCE" rev-list --count HEAD..origin/main)" -eq 0
git --git-dir="$release_git_dir" worktree list --porcelain \
  > "$evidence_dir/release-worktrees.txt"
```

Retain this exact worktree for as long as any running container bind-mounts it. A later
retention job may use `git --git-dir="$release_git_dir" worktree remove` only after the
release is no longer live and no rollback procedure references it. Never delete a mounted
release directory directly.

### 2B. Provision the codegraph control credential

Provision the shared API/codegraph control token before Compose validation. It is a random
file-backed secret, not the signed web BFF identity token minted later from the verified API
artifact:

```bash
install -d -o root -g root -m 0700 -- /srv/frank/secrets
control_token_file='/srv/frank/secrets/codegraph-control-token'
control_token_tmp="$(mktemp /srv/frank/secrets/.codegraph-control-token.XXXXXX)"
trap 'rm -f -- "${control_token_tmp:-}"' EXIT

openssl rand -hex 32 > "$control_token_tmp"
chown 10001:10001 "$control_token_tmp"
chmod 0400 "$control_token_tmp"
mv -f -- "$control_token_tmp" "$control_token_file"
trap - EXIT

export FRANK_CODEGRAPH_CONTROL_TOKEN_FILE="$control_token_file"
test "$(stat -c '%u:%g:%a' "$FRANK_CODEGRAPH_CONTROL_TOKEN_FILE")" = '10001:10001:400'
```

The codegraph token must never enter release evidence or shell tracing. Its rotation
requires an API/codegraph restart together.

Optional overrides:

- `FRANK_REQUIRED_CONTAINERS`: comma- or space-separated container names.
- `FRANK_REQUIRED_IMAGES`: comma- or space-separated image references.
- `FRANK_REQUIRE_UPSTREAM_SYNC=false`: only for an intentionally detached, exact-commit
  release whose exception is already recorded. The expected commit check remains mandatory.
- `FRANK_IMAGE_LOCK_FILE`: absolute path to a non-secret file containing one
  `<image-reference> <sha256:image-id>` pair per line. Use this when immutable image IDs
  have been prepared; a mismatch blocks release.
- `FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK=true`: one-time Graphify migration flag when the
  running legacy Node codegraph still uses the general `frank` network. Record the
  exception, prove the candidate's dedicated internal network in step 3E, and unset it
  immediately after the first successful rollout. It must remain false thereafter.

## 3. Verify immutable artifacts, persist runtime state, and run hosted preflight

Artifact verification must finish before the workbench digest is persisted. Persistence
must finish before the candidate API image mints the domain service token, and token
issuance must finish before hosted preflight checks the exact digest set.

### 3A. Download and verify the GitHub release artifact

`release-artifacts` publishes only after a successful `verify` run for a push to the
protected `main` branch. Its first artifact is created by the first successful verify
following a merge to `main`; it does not publish release images for feature branches or
backfill an already-verified commit. Repository settings must keep `main` protected; the
workflow checks that `main` is the repository default branch but cannot create or verify
the branch-protection rule itself.

Download the evidence artifact for the exact approved full commit. Use a GitHub CLI
identity with read access to the repository attestations. The release workflow verifies
anonymous digest pulls, so the VPS must not require or retain a GHCR credential. Neither
credential material nor image pull state is written to evidence or printed:

```bash
export FRANK_RELEASE_COMMIT="$FRANK_EXPECTED_COMMIT"
export FRANK_GITHUB_REPOSITORY='stevenshelley58-afk/frank'
export FRANK_ARTIFACT_RUN_ID='<SUCCESSFUL_RELEASE_ARTIFACTS_RUN_ID>'
export FRANK_RELEASE_ARTIFACT_DIR="$evidence_dir/github-release-artifact"

rm -rf -- "$FRANK_RELEASE_ARTIFACT_DIR"
mkdir -p -- "$FRANK_RELEASE_ARTIFACT_DIR"

gh run view "$FRANK_ARTIFACT_RUN_ID" -R "$FRANK_GITHUB_REPOSITORY" \
  --json conclusion,headBranch,headSha,workflowName \
  > "$evidence_dir/release-artifacts-run.json"
node --input-type=module - "$evidence_dir/release-artifacts-run.json" "$FRANK_RELEASE_COMMIT" <<'NODE'
import { readFileSync } from 'node:fs';
const [path, commit] = process.argv.slice(2);
const run = JSON.parse(readFileSync(path, 'utf8'));
if (run.conclusion !== 'success' || run.workflowName !== 'release-artifacts' ||
    run.headBranch !== 'main' || run.headSha !== commit) {
  throw new Error('Release artifact workflow run is not the successful main build for this commit');
}
NODE

gh run download "$FRANK_ARTIFACT_RUN_ID" -R "$FRANK_GITHUB_REPOSITORY" \
  --name "release-evidence-$FRANK_RELEASE_COMMIT" \
  --dir "$FRANK_RELEASE_ARTIFACT_DIR"

manifest="$FRANK_RELEASE_ARTIFACT_DIR/release-manifest.json"
api_sbom="$FRANK_RELEASE_ARTIFACT_DIR/api.spdx.json"
web_sbom="$FRANK_RELEASE_ARTIFACT_DIR/web.spdx.json"
codegraph_sbom="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.spdx.json"
codegraph_sbom_verified="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.spdx.verified.json"
codegraph_sbom_bundle="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.spdx.sigstore.json"
codegraph_sbom_receipt="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.spdx.attestation.verify.json"
workbench_sbom="$FRANK_RELEASE_ARTIFACT_DIR/workbench.spdx.json"
codegraph_vex="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.openvex.json"
codegraph_vex_verified="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.openvex.verified.json"
codegraph_vex_bundle="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.openvex.sigstore.json"
codegraph_vex_receipt="$FRANK_RELEASE_ARTIFACT_DIR/codegraph.openvex.attestation.verify.json"
codegraph_raw_report="$FRANK_RELEASE_ARTIFACT_DIR/codegraph-grype-raw.json"
codegraph_policy_report="$FRANK_RELEASE_ARTIFACT_DIR/codegraph-grype-vex.json"
test -s "$manifest"
test -s "$api_sbom"
test -s "$web_sbom"
test -s "$codegraph_sbom"
test -s "$codegraph_sbom_verified"
test -s "$codegraph_sbom_bundle"
test -s "$codegraph_sbom_receipt"
test -s "$workbench_sbom"
test -s "$codegraph_vex"
test -s "$codegraph_vex_verified"
test -s "$codegraph_vex_bundle"
test -s "$codegraph_vex_receipt"
test -s "$codegraph_raw_report"
test -s "$codegraph_policy_report"

node --input-type=module - "$manifest" "$FRANK_RELEASE_ARTIFACT_DIR" "$api_sbom" "$web_sbom" "$codegraph_sbom" "$workbench_sbom" "$codegraph_vex" \
  "$FRANK_RELEASE_COMMIT" "$FRANK_GITHUB_REPOSITORY" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [manifestPath, artifactDir, apiSbomPath, webSbomPath, codegraphSbomPath, workbenchSbomPath, codegraphVexPath, commit, repository] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedEvidence = [
  'api.spdx.json',
  'web.spdx.json',
  'codegraph.spdx.json',
  'codegraph.spdx.verified.json',
  'codegraph.spdx.sigstore.json',
  'codegraph.spdx.attestation.verify.json',
  'workbench.spdx.json',
  'codegraph.openvex.json',
  'codegraph.openvex.verified.json',
  'codegraph.openvex.sigstore.json',
  'codegraph.openvex.attestation.verify.json',
  'codegraph-grype-raw.json',
  'codegraph-grype-vex.json',
];
if (JSON.stringify(Object.keys(manifest.evidence_sha256 ?? {}).sort()) !== JSON.stringify([...expectedEvidence].sort())) {
  throw new Error('Manifest evidence hash set is incomplete');
}
for (const name of expectedEvidence) {
  const actual = createHash('sha256').update(readFileSync(`${artifactDir}/${name}`)).digest('hex');
  if (manifest.evidence_sha256[name] !== actual) throw new Error(`Evidence SHA-256 mismatch: ${name}`);
}
const expectedAttestations = [
  'api_provenance', 'web_provenance', 'codegraph_provenance',
  'codegraph_sbom', 'codegraph_vex', 'workbench_provenance',
];
if (JSON.stringify(Object.keys(manifest.attestations ?? {}).sort()) !== JSON.stringify([...expectedAttestations].sort()) ||
    expectedAttestations.some((name) => {
      const record = manifest.attestations[name];
      return typeof record?.attestation_id !== 'string' || !record.attestation_id.trim() ||
        typeof record.storage_records_supported !== 'boolean' ||
        !Array.isArray(record.storage_record_ids) ||
        (record.storage_records_supported && record.storage_record_ids.length < 1) ||
        (!record.storage_records_supported && record.storage_record_ids.length !== 0) ||
        record.storage_record_ids.some((id) => typeof id !== 'string' || !id.trim());
    })) {
  throw new Error('Manifest attestation/storage-record metadata is invalid');
}
for (const path of [apiSbomPath, webSbomPath, codegraphSbomPath, workbenchSbomPath]) {
  const sbom = JSON.parse(readFileSync(path, 'utf8'));
  if (!sbom || typeof sbom !== 'object' || !sbom.spdxVersion) throw new Error(`Invalid SPDX JSON: ${path}`);
}
const digest = /^sha256:[a-f0-9]{64}$/;
const owner = repository.split('/')[0].toLowerCase();
const expected = {
  api: `ghcr.io/${owner}/frank-api`,
  web: `ghcr.io/${owner}/frank-web`,
  codegraph: `ghcr.io/${owner}/frank-codegraph`,
  workbench: `ghcr.io/${owner}/frank-workbench`,
};
if (manifest.schema_version !== 2 || manifest.commit !== commit ||
    manifest.repository !== repository || manifest.verified_by?.workflow !== 'verify' ||
    !Number.isInteger(manifest.verified_by?.run_id) ||
    manifest.sbom?.api !== 'api.spdx.json' || manifest.sbom?.web !== 'web.spdx.json' ||
    manifest.sbom?.codegraph !== 'codegraph.spdx.json' ||
    manifest.sbom?.codegraph_verified_predicate !== 'codegraph.spdx.verified.json' ||
    manifest.sbom?.codegraph_signed_bundle !== 'codegraph.spdx.sigstore.json' ||
    manifest.sbom?.codegraph_verification_receipt !== 'codegraph.spdx.attestation.verify.json' ||
    manifest.sbom?.codegraph_predicate_type !== 'https://spdx.dev/Document/v2.3' ||
    manifest.sbom?.workbench !== 'workbench.spdx.json' ||
    manifest.vex?.codegraph !== 'codegraph.openvex.json' ||
    manifest.vex?.verified_predicate !== 'codegraph.openvex.verified.json' ||
    manifest.vex?.signed_bundle !== 'codegraph.openvex.sigstore.json' ||
    manifest.vex?.verification_receipt !== 'codegraph.openvex.attestation.verify.json' ||
    manifest.vex?.predicate_type !== 'https://openvex.dev/ns/v0.2.0' ||
    manifest.security_reports?.codegraph_raw !== 'codegraph-grype-raw.json' ||
    manifest.security_reports?.codegraph_policy !== 'codegraph-grype-vex.json' ||
    manifest.images?.api?.reference !== expected.api || !digest.test(manifest.images?.api?.digest ?? '') ||
    manifest.images?.web?.reference !== expected.web || !digest.test(manifest.images?.web?.digest ?? '') ||
    manifest.images?.codegraph?.reference !== expected.codegraph || !digest.test(manifest.images?.codegraph?.digest ?? '') ||
    manifest.images?.workbench?.reference !== expected.workbench || !digest.test(manifest.images?.workbench?.digest ?? '')) {
  throw new Error('Manifest does not exactly bind this commit, repository, SBOMs, and immutable GHCR images');
}
const vex = JSON.parse(readFileSync(codegraphVexPath, 'utf8'));
const codegraphDigest = manifest.images.codegraph.digest.slice('sha256:'.length);
const expectedProduct = `pkg:oci/frank-codegraph@sha256%3A${codegraphDigest}?repository_url=${encodeURIComponent(`ghcr.io/${owner}`)}`;
const vexCves = vex.statements?.map((statement) => statement.vulnerability?.name).sort();
if (
  vex['@context'] !== 'https://openvex.dev/ns/v0.2.0' ||
  JSON.stringify(vexCves) !== JSON.stringify(['CVE-2026-11940', 'CVE-2026-11972', 'CVE-2026-15308']) ||
  vex.statements.some((statement) =>
    statement.status !== 'not_affected' ||
    statement.justification !== 'vulnerable_code_not_present' ||
    statement.products?.length !== 1 ||
    statement.products[0]?.['@id'] !== expectedProduct ||
    JSON.stringify(statement.products[0]?.hashes) !== JSON.stringify({'sha-256': codegraphDigest}) ||
    JSON.stringify(statement.products[0]?.subcomponents) !== JSON.stringify([{'@id': 'pkg:generic/python@3.14.6'}])
  )
) {
  throw new Error('OpenVEX does not exactly bind the release codegraph digest and audited CPython findings');
}
NODE

# Re-evaluate the fail-closed scan policy from the downloaded, hash-bound reports.
jq -e '
  [(.ignoredMatches // [])[] |
    select(.vulnerability.severity == "High" or .vulnerability.severity == "Critical")] |
  length == 0
' "$codegraph_raw_report" >/dev/null
jq -e '
  [(.matches // [])[] |
    select(.vulnerability.severity == "Critical")] | length == 0
' "$codegraph_raw_report" >/dev/null
jq -e '
  [(.matches // [])[] |
    select(.vulnerability.severity == "High" or .vulnerability.severity == "Critical") |
    .vulnerability.id] | unique | sort ==
  ["CVE-2026-11940", "CVE-2026-11972", "CVE-2026-15308"]
' "$codegraph_raw_report" >/dev/null
jq -e '
  [(.matches // [])[] |
    select(.vulnerability.severity == "High" or .vulnerability.severity == "Critical") |
    select(
      .artifact.name != "python" or
      .artifact.version != "3.14.6" or
      .artifact.purl != "pkg:generic/python@3.14.6" or
      ([.matchDetails[]?.searchedBy.package? |
        select(.name == "python" and .version == "3.14.6")] | length == 0)
    )] | length == 0
' "$codegraph_raw_report" >/dev/null
jq -e '
  [(.matches // [])[] |
    select(.vulnerability.severity == "High" or .vulnerability.severity == "Critical")] |
  length == 0
' "$codegraph_policy_report" >/dev/null

verify_run_id="$(node --input-type=module - "$manifest" <<'NODE'
import { readFileSync } from 'node:fs';
console.log(JSON.parse(readFileSync(process.argv[2], 'utf8')).verified_by.run_id);
NODE
)"
gh run view "$verify_run_id" -R "$FRANK_GITHUB_REPOSITORY" \
  --json conclusion,event,headBranch,headSha,workflowName \
  > "$evidence_dir/verify-run.json"
node --input-type=module - "$evidence_dir/verify-run.json" "$FRANK_RELEASE_COMMIT" <<'NODE'
import { readFileSync } from 'node:fs';
const [path, commit] = process.argv.slice(2);
const run = JSON.parse(readFileSync(path, 'utf8'));
if (run.conclusion !== 'success' || run.workflowName !== 'verify' || run.event !== 'push' ||
    run.headBranch !== 'main' || run.headSha !== commit) {
  throw new Error('Manifest verify run is not the successful main push verification for this commit');
}
NODE

export FRANK_API_IMAGE="$(node --input-type=module - "$manifest" <<'NODE'
import { readFileSync } from 'node:fs';
const image = JSON.parse(readFileSync(process.argv[2], 'utf8')).images.api;
console.log(`${image.reference}@${image.digest}`);
NODE
)"
export FRANK_WEB_IMAGE="$(node --input-type=module - "$manifest" <<'NODE'
import { readFileSync } from 'node:fs';
const image = JSON.parse(readFileSync(process.argv[2], 'utf8')).images.web;
console.log(`${image.reference}@${image.digest}`);
NODE
)"
export FRANK_CODEGRAPH_IMAGE="$(node --input-type=module - "$manifest" <<'NODE'
import { readFileSync } from 'node:fs';
const image = JSON.parse(readFileSync(process.argv[2], 'utf8')).images.codegraph;
console.log(`${image.reference}@${image.digest}`);
NODE
)"
export FRANK_WORKBENCH_IMAGE="$(node --input-type=module - "$manifest" <<'NODE'
import { readFileSync } from 'node:fs';
const image = JSON.parse(readFileSync(process.argv[2], 'utf8')).images.workbench;
console.log(`${image.reference}@${image.digest}`);
NODE
)"

(
  anonymous_docker_config="$(mktemp -d)"
  trap 'rm -rf -- "$anonymous_docker_config"' EXIT
  export DOCKER_CONFIG="$anonymous_docker_config"
  docker pull "$FRANK_API_IMAGE"
  docker pull "$FRANK_WEB_IMAGE"
  docker pull "$FRANK_CODEGRAPH_IMAGE"
  docker pull "$FRANK_WORKBENCH_IMAGE"
)
gh attestation verify "oci://$FRANK_API_IMAGE" -R "$FRANK_GITHUB_REPOSITORY" \
  --deny-self-hosted-runners --source-digest "$FRANK_RELEASE_COMMIT" \
  --source-ref 'refs/heads/main' \
  --signer-digest "$FRANK_RELEASE_COMMIT" \
  --signer-workflow "$FRANK_GITHUB_REPOSITORY/.github/workflows/release-artifacts.yml" \
  --format json \
  > "$evidence_dir/api.attestation.verify.json"
gh attestation verify "oci://$FRANK_WEB_IMAGE" -R "$FRANK_GITHUB_REPOSITORY" \
  --deny-self-hosted-runners --source-digest "$FRANK_RELEASE_COMMIT" \
  --source-ref 'refs/heads/main' \
  --signer-digest "$FRANK_RELEASE_COMMIT" \
  --signer-workflow "$FRANK_GITHUB_REPOSITORY/.github/workflows/release-artifacts.yml" \
  --format json \
  > "$evidence_dir/web.attestation.verify.json"
gh attestation verify "oci://$FRANK_CODEGRAPH_IMAGE" -R "$FRANK_GITHUB_REPOSITORY" \
  --deny-self-hosted-runners --source-digest "$FRANK_RELEASE_COMMIT" \
  --source-ref 'refs/heads/main' \
  --signer-digest "$FRANK_RELEASE_COMMIT" \
  --signer-workflow "$FRANK_GITHUB_REPOSITORY/.github/workflows/release-artifacts.yml" \
  --format json \
  > "$evidence_dir/codegraph.attestation.verify.json"
gh attestation verify "oci://$FRANK_CODEGRAPH_IMAGE" -R "$FRANK_GITHUB_REPOSITORY" \
  --bundle "$codegraph_sbom_bundle" \
  --deny-self-hosted-runners --source-digest "$FRANK_RELEASE_COMMIT" \
  --source-ref 'refs/heads/main' \
  --signer-digest "$FRANK_RELEASE_COMMIT" \
  --signer-workflow "$FRANK_GITHUB_REPOSITORY/.github/workflows/release-artifacts.yml" \
  --predicate-type 'https://spdx.dev/Document/v2.3' \
  --format json \
  > "$evidence_dir/codegraph.spdx.attestation.verify.json"
jq -e \
  --arg name "${FRANK_CODEGRAPH_IMAGE%@*}" \
  --arg digest "${FRANK_CODEGRAPH_IMAGE##*@sha256:}" '
    length == 1 and
    .[0].verificationResult.statement.predicateType == "https://spdx.dev/Document/v2.3" and
    .[0].verificationResult.statement.subject == [{"name": $name, "digest": {"sha256": $digest}}]
  ' "$evidence_dir/codegraph.spdx.attestation.verify.json" >/dev/null
jq -S -c . "$codegraph_sbom" > "$evidence_dir/codegraph.spdx.local.canonical.json"
jq -S -c '.[0].verificationResult.statement.predicate' \
  "$evidence_dir/codegraph.spdx.attestation.verify.json" \
  > "$evidence_dir/codegraph.spdx.verified.canonical.json"
cmp --silent \
  "$evidence_dir/codegraph.spdx.local.canonical.json" \
  "$evidence_dir/codegraph.spdx.verified.canonical.json"
cmp --silent \
  "$codegraph_sbom_verified" \
  "$evidence_dir/codegraph.spdx.verified.canonical.json"
rm -f -- \
  "$evidence_dir/codegraph.spdx.local.canonical.json" \
  "$evidence_dir/codegraph.spdx.verified.canonical.json"
gh attestation verify "oci://$FRANK_CODEGRAPH_IMAGE" -R "$FRANK_GITHUB_REPOSITORY" \
  --bundle "$codegraph_vex_bundle" \
  --deny-self-hosted-runners --source-digest "$FRANK_RELEASE_COMMIT" \
  --source-ref 'refs/heads/main' \
  --signer-digest "$FRANK_RELEASE_COMMIT" \
  --signer-workflow "$FRANK_GITHUB_REPOSITORY/.github/workflows/release-artifacts.yml" \
  --predicate-type 'https://openvex.dev/ns/v0.2.0' \
  --format json \
  > "$evidence_dir/codegraph.openvex.attestation.verify.json"
jq -e \
  --arg name "${FRANK_CODEGRAPH_IMAGE%@*}" \
  --arg digest "${FRANK_CODEGRAPH_IMAGE##*@sha256:}" '
    length == 1 and
    .[0].verificationResult.statement.predicateType == "https://openvex.dev/ns/v0.2.0" and
    .[0].verificationResult.statement.subject == [{"name": $name, "digest": {"sha256": $digest}}]
  ' "$evidence_dir/codegraph.openvex.attestation.verify.json" >/dev/null
jq -S -c . "$codegraph_vex" > "$evidence_dir/codegraph.openvex.local.canonical.json"
jq -S -c '.[0].verificationResult.statement.predicate' \
  "$evidence_dir/codegraph.openvex.attestation.verify.json" \
  > "$evidence_dir/codegraph.openvex.verified.canonical.json"
cmp --silent \
  "$evidence_dir/codegraph.openvex.local.canonical.json" \
  "$evidence_dir/codegraph.openvex.verified.canonical.json"
cmp --silent \
  "$codegraph_vex_verified" \
  "$evidence_dir/codegraph.openvex.verified.canonical.json"
rm -f -- \
  "$evidence_dir/codegraph.openvex.local.canonical.json" \
  "$evidence_dir/codegraph.openvex.verified.canonical.json"
gh attestation verify "oci://$FRANK_WORKBENCH_IMAGE" -R "$FRANK_GITHUB_REPOSITORY" \
  --deny-self-hosted-runners --source-digest "$FRANK_RELEASE_COMMIT" \
  --source-ref 'refs/heads/main' \
  --signer-digest "$FRANK_RELEASE_COMMIT" \
  --signer-workflow "$FRANK_GITHUB_REPOSITORY/.github/workflows/release-artifacts.yml" \
  --format json \
  > "$evidence_dir/workbench.attestation.verify.json"
docker image inspect "$FRANK_API_IMAGE" "$FRANK_WEB_IMAGE" "$FRANK_CODEGRAPH_IMAGE" "$FRANK_WORKBENCH_IMAGE" \
  --format '{{.RepoDigests}}\t{{.Id}}' \
  > "$evidence_dir/application-images.pulled.tsv"
test "$(docker image inspect --format '{{json .Config.Entrypoint}}' "$FRANK_CODEGRAPH_IMAGE")" = \
  '["/usr/local/bin/python3","-P","-m","frank_codegraph"]'

```

The artifact directory, manifest, parsed SPDX SBOMs, digest-bound OpenVEX, GitHub workflow
receipts, exact signed-bundle verification output, raw/policy scan reports, verified
provenance/OpenVEX predicate, and pulled image IDs are release evidence. The standalone
`codegraph-image-security` workflow is PR/manual diagnostic feedback only and is never a
promotion authority. The four image environment
variables must be copied only from the validated manifest output above—never composed from
a tag or a branch name.

### 3B. Atomically persist the manifest workbench digest

Before preflight or any Compose command, update only `FRANK_WORKBENCH_IMAGE` in the
root-owned runtime environment. This fails if the file is not a regular root-owned file or
contains zero or multiple assignments, preserves every other line plus owner and mode, and
uses a same-directory atomic rename. A root-owned exclusive lock covers the complete
read/transform/verify/rename/receipt sequence. It writes only a public digest, metadata,
and a hash of the runtime file to evidence; it never prints the runtime contents.

```bash
root_runtime_env='/srv/frank/secrets/production.env'
root_runtime_lock='/srv/frank/secrets/production.env.lock'
test "$(id -u)" -eq 0
if [[ ! -e "$root_runtime_lock" ]]; then
  install -o root -g root -m 0600 /dev/null "$root_runtime_lock"
fi
test -f "$root_runtime_lock" && test ! -L "$root_runtime_lock"
test "$(stat -c '%u:%g:%a' -- "$root_runtime_lock")" = '0:0:600'
exec {runtime_lock_fd}>"$root_runtime_lock"
flock -x "$runtime_lock_fd"
test -f "$root_runtime_env" && test ! -L "$root_runtime_env"
test "$(stat -c '%u' -- "$root_runtime_env")" -eq 0

rollback_config_dir="/srv/frank/config-rollback/$release_id"
test ! -e "$rollback_config_dir"
install -d -o root -g root -m 0700 -- "$rollback_config_dir"
prior_workbench_image="$(awk -F= '
  /^FRANK_WORKBENCH_IMAGE=/ { count += 1; value = substr($0, index($0, "=") + 1) }
  END { if (count != 1) exit 42; print value }
' "$root_runtime_env")"
printf '%s' "$prior_workbench_image" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-workbench@sha256:[a-f0-9]{64}$'
docker image inspect "$prior_workbench_image" >/dev/null
prior_workbench_image_id="$(docker image inspect "$prior_workbench_image" --format '{{.Id}}')"
printf '%s' "$prior_workbench_image_id" | grep -Eq '^sha256:[a-f0-9]{64}$'
printf 'FRANK_WORKBENCH_IMAGE=%s\n' "$prior_workbench_image" \
  > "$rollback_config_dir/production.env.workbench.before"
printf 'reference\timage_id\n%s\t%s\n' "$prior_workbench_image" "$prior_workbench_image_id" \
  > "$rollback_config_dir/workbench-image.before.tsv"
chmod 0600 \
  "$rollback_config_dir/production.env.workbench.before" \
  "$rollback_config_dir/workbench-image.before.tsv"

runtime_tmp="$(mktemp "${root_runtime_env}.tmp.XXXXXX")"
trap 'rm -f -- "$runtime_tmp"' EXIT
awk -v image="$FRANK_WORKBENCH_IMAGE" '
  /^FRANK_WORKBENCH_IMAGE=/ {
    count += 1
    print "FRANK_WORKBENCH_IMAGE=" image
    next
  }
  { print }
  END { exit count == 1 ? 0 : 42 }
' "$root_runtime_env" > "$runtime_tmp"
cmp -s \
  <(sed '/^FRANK_WORKBENCH_IMAGE=/d' "$root_runtime_env") \
  <(sed '/^FRANK_WORKBENCH_IMAGE=/d' "$runtime_tmp")
chown --reference="$root_runtime_env" "$runtime_tmp"
chmod --reference="$root_runtime_env" "$runtime_tmp"
mv -f -- "$runtime_tmp" "$root_runtime_env"
trap - EXIT

persisted_workbench_image="$(awk -F= '
  /^FRANK_WORKBENCH_IMAGE=/ { count += 1; value = substr($0, index($0, "=") + 1) }
  END { if (count != 1) exit 42; print value }
' "$root_runtime_env")"
test "$persisted_workbench_image" = "$FRANK_WORKBENCH_IMAGE"
{
  printf 'runtime_env=%s\n' "$root_runtime_env"
  printf 'owner_uid_gid=%s\n' "$(stat -c '%u:%g' -- "$root_runtime_env")"
  printf 'mode=%s\n' "$(stat -c '%a' -- "$root_runtime_env")"
  printf 'prior_frank_workbench_image=%s\n' "$prior_workbench_image"
  printf 'frank_workbench_image=%s\n' "$FRANK_WORKBENCH_IMAGE"
  printf 'runtime_env_sha256=%s\n' "$(sha256sum "$root_runtime_env" | awk '{print $1}')"
} > "$evidence_dir/runtime-workbench-image.update.receipt"
chmod 0600 "$evidence_dir/runtime-workbench-image.update.receipt"
flock -u "$runtime_lock_fd"
exec {runtime_lock_fd}>&-
```

All subsequent promotion Compose commands use this exact runtime file as their only
env-file, so they cannot silently restore the prior workbench digest. The root-only
rollback directory records that prior digest reference and its locally available immutable
image ID before the assignment changes. Removing that image before the release and
observation window ends makes rollback unavailable and blocks promotion.

### 3C. Mint the domain service token

Mint the web BFF identity token inside the verified API digest. The image contains the
frozen workspace install and the exact bundled `tsx` executable; the source worktree
remains clean. The executable is invoked directly by its immutable in-image path without a
package-manager shim. Docker receives the signing key by variable name, not as an argument,
and stdout goes directly to a root-only temporary file. Shell tracing is disabled before
any credential material is generated or read:

```bash
{ set +x; } 2>/dev/null
umask 077
domain_token_file='/srv/frank/secrets/domain-service-token'
domain_token_tmp="$(mktemp /srv/frank/secrets/.domain-service-token.XXXXXX)"
trap 'rm -f -- "${domain_token_tmp:-}"' EXIT
test "$(stat -c '%u:%g:%a' "$domain_token_tmp")" = '0:0:600'

docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,mode=1777,size=64m \
  --env HOME=/tmp \
  --env FRANK_SESSION_SIGNING_KEY \
  --env FRANK_API_AUDIENCE \
  --env FRANK_CELL_ID \
  --env FRANK_SERVICE_TOKEN_LIFETIME_SECONDS=31536000 \
  "$FRANK_API_IMAGE" \
  /app/apps/api/node_modules/.bin/tsx /app/scripts/production/mint-service-token.ts \
  > "$domain_token_tmp"

test -s "$domain_token_tmp"
test "$(wc -c < "$domain_token_tmp")" -le 8192
chown root:root "$domain_token_tmp"
chmod 0400 "$domain_token_tmp"
mv -f -- "$domain_token_tmp" "$domain_token_file"
trap - EXIT

export FRANK_DOMAIN_SERVICE_TOKEN="$(<"$domain_token_file")"
export FRANK_REQUIRED_IMAGES="$FRANK_API_IMAGE $FRANK_WEB_IMAGE $FRANK_CODEGRAPH_IMAGE $FRANK_WORKBENCH_IMAGE"
test -n "$FRANK_DOMAIN_SERVICE_TOKEN"
test "$(stat -c '%u:%g:%a' "$domain_token_file")" = '0:0:400'
```

Never use command substitution around the issuer itself: its only output is the credential.
The redirected file and exported runtime value must never enter release evidence or shell
tracing. Rotation requires a coordinated API/web restart.

### 3D. Run hosted preflight

```bash
bash "$FRANK_RELEASE_SOURCE/scripts/production/hosted-preflight.sh" \
  > "$evidence_dir/preflight.result" \
  2> "$evidence_dir/preflight.log"

grep -Fx 'preflight=passed' "$evidence_dir/preflight.result"
grep -Fx 'disk_gate_mode=absolute' "$evidence_dir/preflight.result"
grep -Fx 'release_required_bytes=21932447888' "$evidence_dir/preflight.result"
grep -Fx 'rollback_headroom_bytes=23862108519' "$evidence_dir/preflight.result"
grep -Fx 'release_total_required_bytes=45794556407' "$evidence_dir/preflight.result"
```

Preflight records the commit, branch, locally known upstream state, disk state, network,
and counts of checked containers, images, and secret names. Its log contains secret names
only. A dirty worktree, wrong commit, unsynchronized branch, missing secret, invalid
Compose model, absent image, unhealthy container, or insufficient disk fails the gate.
The preflight does not fetch; step 2A already proved the release worktree is synchronized
with `origin/main`.

### 3E. Define and validate the production application overlay

Set the non-secret release/runtime identifiers. Secret values named in step 2 remain
injected by the accepted runtime and are not repeated here:

```bash
export FRANK_CELL_ID='frank'
export FRANK_OWNER_ID='steven'
export FRANK_PUBLIC_URL='https://frank.fail'
export FRANK_API_INTERNAL_URL='http://frank-api:3000'
export FRANK_WEB_INTERNAL_URL='http://frank-web:3001'
export FRANK_LOG_LEVEL='info'
export FRANK_MAX_BODY_BYTES='1048576'

export FRANK_WORKBENCH_RUNNER_ENABLED='true'
export FRANK_WORKBENCH_CONCURRENCY='2'
export FRANK_WORKBENCH_MODEL_PROVIDER='<REVIEWED_PROVIDER_ID>'
export FRANK_WORKBENCH_MODEL_BASE_URL='<REVIEWED_HTTPS_PROVIDER_BASE_URL>'
export FRANK_WORKBENCH_MODEL='<REVIEWED_MODEL_ID>'
export FRANK_MISSION_ORCHESTRATOR_ENABLED='true'
export FRANK_MISSION_WORKSPACE_SOURCE='/srv/frank/workspaces/central'
export FRANK_MISSION_PLANNER_MODEL='deepseek-v4-flash'
export FRANK_MISSION_CHEAP_MODEL='deepseek-v4-flash'
export FRANK_MISSION_STRONG_MODEL='deepseek-v4-pro'
export FRANK_WORKSPACE_SOURCE_HOST_PATH='/srv/frank/workspaces/central'

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

- `FRANK_DOMAIN_SERVICE_TOKEN` is the production bearer credential minted in step 3C for
  the web BFF with only its reviewed API capabilities. Never print it or use the
  development-session route.
- `FRANK_BASIC_AUTH_HASH` must be generated from a separately stored strong password with
  Caddy's bcrypt password tool. Store the hash and its corresponding
  `FRANK_BASIC_AUTH_PASSWORD` in the root-only secret runtime. Neither value belongs in Git,
  the candidate Caddyfile, or release evidence.

The codegraph credential issued in step 2B is one shared random bearer token consumed as a
Docker file secret by both API and codegraph. Compose file-backed secrets are bind mounts
in this deployment; its host ownership and mode are therefore part of the contract. A
missing/unreadable file blocks Compose startup.

Validate formats and the fully merged model without saving or printing the resolved
Compose document, because it contains injected values:

```bash
base_compose='/srv/frank/infra/docker-compose.dev.yml'
app_overlay="$FRANK_RELEASE_SOURCE/infra/production/docker-compose.app.yml"
compose=(docker compose --env-file "$root_runtime_env" -f "$base_compose" -f "$app_overlay")

version="$(docker compose version --short)"
test "$(printf '%s\n' '2.24.4' "$version" | sort -V | head -n1)" = '2.24.4'
test "$FRANK_WORKBENCH_RUNNER_ENABLED" = 'true'
test "$FRANK_WORKBENCH_CONCURRENCY" -ge 1
test "$FRANK_WORKBENCH_CONCURRENCY" -le 8
printf '%s' "$FRANK_WORKBENCH_IMAGE" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-workbench@sha256:[a-f0-9]{64}$'
printf '%s' "$FRANK_RELEASE_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
printf '%s' "$FRANK_API_IMAGE" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-api@sha256:[a-f0-9]{64}$'
printf '%s' "$FRANK_WEB_IMAGE" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-web@sha256:[a-f0-9]{64}$'
printf '%s' "$FRANK_CODEGRAPH_IMAGE" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-codegraph@sha256:[a-f0-9]{64}$'
printf '%s' "$FRANK_DOCKER_SOCKET_GID" | grep -Eq '^[0-9]+$'
test "$(realpath -e -- "$FRANK_WORKSPACE_SOURCE_HOST_PATH")" = '/srv/frank/workspaces/central'
test "$(realpath -e -- "$FRANK_RELEASE_SOURCE")" = "$(realpath -e -- "$FRANK_REPO_PATH")"
test "$(stat -c '%u:%g:%a' "$FRANK_CODEGRAPH_CONTROL_TOKEN_FILE")" = '10001:10001:400'
case "$FRANK_BASIC_AUTH_HASH" in
  '$2a$'*|'$2b$'*|'$2y$'*) ;;
  *) printf '%s\n' 'FRANK_BASIC_AUTH_HASH must be a bcrypt hash' >&2; exit 1 ;;
esac

"${compose[@]}" config --quiet
"${compose[@]}" config --format json | jq -e '
  (.services["frank-api"].build == null) and
  (.services["frank-web"].build == null) and
  (.services["frank-codegraph"].build == null) and
  (.services["frank-codegraph-volume-init"].build == null) and
  (.services["frank-api"].image | test("^ghcr\\.io/[a-z0-9][a-z0-9._-]*/frank-api@sha256:[a-f0-9]{64}$")) and
  (.services["frank-web"].image | test("^ghcr\\.io/[a-z0-9][a-z0-9._-]*/frank-web@sha256:[a-f0-9]{64}$")) and
  (.services["frank-codegraph"].image | test("^ghcr\\.io/[a-z0-9][a-z0-9._-]*/frank-codegraph@sha256:[a-f0-9]{64}$")) and
  (.services["frank-codegraph-volume-init"].image == .services["frank-codegraph"].image) and
  (.services["frank-codegraph"].entrypoint == ["/usr/local/bin/python3", "-P", "-m", "frank_codegraph"]) and
  (.services["frank-codegraph-volume-init"].entrypoint == ["/usr/local/bin/python3", "-P", "-m", "frank_codegraph.volume_init"]) and
  .services["frank-api"].environment.FRANK_ENV == "production" and
  .services["frank-web"].environment.FRANK_DOMAIN_API_URL == "http://frank-api:3000" and
  .services["frank-caddy"].environment.FRANK_WEB_INTERNAL_URL == "http://frank-web:3001" and
  (.services["frank-api"].environment.FRANK_WORKBENCH_IMAGE |
    test("^ghcr\\.io/[a-z0-9][a-z0-9._-]*/frank-workbench@sha256:[a-f0-9]{64}$")) and
  ([.services | to_entries[] |
    select(any(.value.volumes[]?;
      .type == "bind" and .source == "/var/run/docker.sock")) |
    .key] == ["frank-api"]) and
  ((.services["frank-api"].ports // []) | length == 0) and
  ((.services["frank-web"].ports // []) | length == 0) and
  ((.services["frank-db"].ports // []) | length == 0) and
  ((.services["frank-redis"].ports // []) | length == 0) and
  ((.services["frank-codegraph"].ports // []) | length == 0) and
  ((.services["frank-codegraph"].networks | keys) == ["frank-codegraph-internal"]) and
  (.networks["frank-codegraph-internal"].internal == true) and
  (.services["frank-api"].healthcheck != null) and
  (.services["frank-web"].healthcheck != null) and
  (.services["frank-codegraph"].healthcheck != null) and
  (.secrets.frank_codegraph_control_token.file == env.FRANK_CODEGRAPH_CONTROL_TOKEN_FILE)
' >/dev/null

"${compose[@]}" config --images > "$evidence_dir/compose.images.expected.txt"
sha256sum "$base_compose" "$app_overlay" \
  "$FRANK_RELEASE_SOURCE/infra/production/Caddyfile.frank-production" \
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

## 4. Capture the complete application rollback unit

Before changing source, overlay, image tags, containers, or the codegraph volume, capture
the legacy Node codegraph and the API/web images that consume its contract as one unit:

```bash
export FRANK_RELEASE_ID="$release_id"
export FRANK_PRE_RELEASE_OVERLAY='/srv/frank/repo/infra/production/docker-compose.app.yml'
export FRANK_CODEGRAPH_BACKUP_ROOT='/srv/frank/backups/codegraph'

bash "$FRANK_RELEASE_SOURCE/scripts/production/snapshot-codegraph-release.sh" \
  > "$evidence_dir/codegraph-snapshot.result" \
  2> "$evidence_dir/codegraph-snapshot.log"
grep -Fx 'snapshot=passed' "$evidence_dir/codegraph-snapshot.result"
codegraph_snapshot="$(awk -F= '$1 == "snapshot" {print $2}' "$evidence_dir/codegraph-snapshot.result")"
test -n "$codegraph_snapshot"
export FRANK_CODEGRAPH_PHYSICAL_VOLUME="$(<"$codegraph_snapshot/codegraph-volume.txt")"
printf '%s' "$FRANK_CODEGRAPH_PHYSICAL_VOLUME" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$'
test "$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$FRANK_CODEGRAPH_PHYSICAL_VOLUME")" = 'frank_codegraph_data'

install -m 0600 -- "$codegraph_snapshot/images.tsv" "$evidence_dir/containers.before.tsv"
install -m 0600 -- "$codegraph_snapshot/codegraph-volume-labels.tsv" \
  "$evidence_dir/codegraph-volume-labels.tsv"

git -C "$FRANK_RELEASE_SOURCE" rev-parse HEAD > "$evidence_dir/git.candidate.txt"
sha256sum /srv/frank/infra/docker-compose.dev.yml \
  /srv/frank/infra/Caddyfile \
  "$FRANK_PRE_RELEASE_OVERLAY" \
  "$FRANK_RELEASE_SOURCE/infra/production/Caddyfile.frank-production" \
  > "$evidence_dir/config.before.sha256"

rollback_config_dir="/srv/frank/config-rollback/$release_id"
test -d "$rollback_config_dir" && test ! -L "$rollback_config_dir"
test "$(stat -c '%u:%g:%a' -- "$rollback_config_dir")" = '0:0:700'
test -s "$rollback_config_dir/production.env.workbench.before"
test -s "$rollback_config_dir/workbench-image.before.tsv"
for rollback_file in \
  "$rollback_config_dir/production.env.workbench.before" \
  "$rollback_config_dir/workbench-image.before.tsv"; do
  test -f "$rollback_file" && test ! -L "$rollback_file"
  test "$(stat -c '%u:%g:%a' -- "$rollback_file")" = '0:0:600'
done
prior_workbench_assignment="$(<"$rollback_config_dir/production.env.workbench.before")"
case "$prior_workbench_assignment" in
  FRANK_WORKBENCH_IMAGE=*) prior_workbench_image="${prior_workbench_assignment#FRANK_WORKBENCH_IMAGE=}" ;;
  *) printf '%s\n' 'invalid prior workbench assignment' >&2; exit 1 ;;
esac
printf '%s' "$prior_workbench_image" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-workbench@sha256:[a-f0-9]{64}$'
prior_workbench_image_id="$(awk -F '\t' 'NR == 2 { print $2 }' "$rollback_config_dir/workbench-image.before.tsv")"
test "$(awk -F '\t' 'NR == 2 { print $1 }' "$rollback_config_dir/workbench-image.before.tsv")" = "$prior_workbench_image"
printf '%s' "$prior_workbench_image_id" | grep -Eq '^sha256:[a-f0-9]{64}$'
test "$(docker image inspect "$prior_workbench_image" --format '{{.Id}}')" = "$prior_workbench_image_id"
install -m 0600 -- /srv/frank/infra/Caddyfile "$rollback_config_dir/Caddyfile"
```

The root-only snapshot contains the literal pre-release Compose overlay, configured image
references plus immutable IDs, a Docker image archive for all three services, and a
checksummed archive of the physical volume currently mounted at `/data/codegraph` (for
Compose project `frank`, normally `frank_frank_codegraph_data`). The logical-volume label
must be exactly `frank_codegraph_data`; an optional
`FRANK_CODEGRAPH_PHYSICAL_VOLUME` override must match the discovered mount. The snapshot
script fails before deployment if any identity or label cannot be verified. The root-only
rollback directory separately captures the prior workbench digest reference and immutable
image ID, and the availability check above proves that exact image remains local. Copy the
snapshot to the approved encrypted off-cell store
with the database backup.

## 5. Create and verify the database backup

The default output root is `/srv/frank/backups/postgres`; default retention is 35 days.
Retention only removes directories matching `frank-postgres-YYYYMMDDTHHMMSSZ` directly
under the resolved backup root.

```bash
export FRANK_DB_CONTAINER='frank-frank-db-1'
export FRANK_BACKUP_DIR='/srv/frank/backups/postgres'
export FRANK_BACKUP_RETENTION_DAYS='35'

bash "$FRANK_RELEASE_SOURCE/scripts/production/backup-postgres.sh" \
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

Only after preflight, manifest/attestation verification, overlay validation, rollback-image
capture, local backup verification, and off-cell copy evidence are complete may the
approved deployment mechanism run. Never substitute a `git pull`, an unrecorded mutable
build, or the legacy rebuild script. `docker compose build` is forbidden on the VPS for a
release: production promotes only the already verified GHCR digest references.

Record the pulled immutable images and their OCI commit labels before changing a running
container:

```bash
docker image inspect \
  "$FRANK_API_IMAGE" \
  "$FRANK_WEB_IMAGE" \
  "$FRANK_CODEGRAPH_IMAGE" \
  "$FRANK_WORKBENCH_IMAGE" \
  --format '{{.RepoTags}}\t{{.Id}}' \
  > "$evidence_dir/application-images.promoted.tsv"

for image in "$FRANK_API_IMAGE" "$FRANK_WEB_IMAGE" "$FRANK_CODEGRAPH_IMAGE" "$FRANK_WORKBENCH_IMAGE"; do
  test "$(docker image inspect "$image" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" \
    = "$FRANK_RELEASE_COMMIT"
  test "$(docker image inspect "$image" \
    --format '{{ index .Config.Labels "org.opencontainers.image.source" }}')" \
    = "https://github.com/$FRANK_GITHUB_REPOSITORY"
done

# One-time/repair-safe ownership initialization for the persistent artifact volume.
# The API then runs as uid/gid 10001 and archives /workspace/out here before teardown.
docker volume create \
  --label com.frank.purpose=workbench-artifacts \
  frank_workbench_artifacts \
  > "$evidence_dir/artifact-volume.create.txt"
docker run --rm \
  --user 0:0 \
  --mount type=volume,source=frank_workbench_artifacts,target=/var/lib/frank/artifacts \
  "$FRANK_API_IMAGE" \
  sh -ceu 'mkdir -p /var/lib/frank/artifacts; chown 10001:10001 /var/lib/frank/artifacts; chmod 0750 /var/lib/frank/artifacts'
docker volume inspect frank_workbench_artifacts \
  --format '{{.Name}}\t{{json .Labels}}' \
  > "$evidence_dir/artifact-volume.inspect.tsv"
```

The production host does not rebuild images. Any Dockerfile base-image or dependency
reproducibility concern is resolved in the GitHub build-and-attestation lane before the
manifest is published; a new source commit requires a new verified release artifact.

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

codegraph_wait_seconds=1920
printf 'Starting Graphify-backed services; first extraction may take up to 30 minutes.\n' >&2
"${compose[@]}" up -d \
  --no-build \
  --wait \
  --wait-timeout "$codegraph_wait_seconds" \
  frank-codegraph-volume-init frank-codegraph frank-api frank-web frank-caddy \
  2>&1 | tee "$evidence_dir/compose-up.log"

"${compose[@]}" ps \
  --format json > "$evidence_dir/compose-after.json"
docker inspect frank-codegraph frank-frank-api-1 frank-web frank-frank-caddy-1 \
  --format '{{.Name}}\t{{.Image}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
  > "$evidence_dir/containers.after.tsv"
sha256sum /srv/frank/infra/Caddyfile > "$evidence_dir/caddy.after.sha256"
```

The 1,920-second gate covers the supervisor's 1,800-second Graphify process timeout plus
health-transition margin. Compose progress remains visible through `tee` while being
retained as evidence. A timeout is a failed release; inspect the bounded codegraph logs and
retain the prior atomic `current` release rather than shortening or bypassing readiness.

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

bash "$FRANK_RELEASE_SOURCE/scripts/production/post-deploy-smoke.sh" \
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

### Coupled application/codegraph rollback

Use this path only when the prior application is compatible with the current database
schema. It restores the exact captured legacy overlay and codegraph volume, then recreates
codegraph, API, and web together from their archived image references. Do not roll only one
of these services across the Graphify contract boundary:

```bash
test -n "$codegraph_snapshot"
root_runtime_env='/srv/frank/secrets/production.env'
root_runtime_lock='/srv/frank/secrets/production.env.lock'
rollback_config_dir="/srv/frank/config-rollback/$release_id"
test -d "$rollback_config_dir" && test ! -L "$rollback_config_dir"
test "$(stat -c '%u:%g:%a' -- "$rollback_config_dir")" = '0:0:700'
test -f "$root_runtime_lock" && test ! -L "$root_runtime_lock"
test "$(stat -c '%u:%g:%a' -- "$root_runtime_lock")" = '0:0:600'
test -f "$root_runtime_env" && test ! -L "$root_runtime_env"
test "$(stat -c '%u' -- "$root_runtime_env")" -eq 0
exec {runtime_lock_fd}>"$root_runtime_lock"
flock -x "$runtime_lock_fd"

for rollback_file in \
  "$rollback_config_dir/production.env.workbench.before" \
  "$rollback_config_dir/workbench-image.before.tsv"; do
  test -f "$rollback_file" && test ! -L "$rollback_file"
  test "$(stat -c '%u:%g:%a' -- "$rollback_file")" = '0:0:600'
done
prior_workbench_assignment="$(<"$rollback_config_dir/production.env.workbench.before")"
case "$prior_workbench_assignment" in
  FRANK_WORKBENCH_IMAGE=*) prior_workbench_image="${prior_workbench_assignment#FRANK_WORKBENCH_IMAGE=}" ;;
  *) printf '%s\n' 'invalid prior workbench assignment' >&2; exit 1 ;;
esac
printf '%s' "$prior_workbench_image" | grep -Eq '^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-workbench@sha256:[a-f0-9]{64}$'
prior_workbench_image_id="$(awk -F '\t' 'NR == 2 { print $2 }' "$rollback_config_dir/workbench-image.before.tsv")"
test "$(awk -F '\t' 'NR == 2 { print $1 }' "$rollback_config_dir/workbench-image.before.tsv")" = "$prior_workbench_image"
printf '%s' "$prior_workbench_image_id" | grep -Eq '^sha256:[a-f0-9]{64}$'
test "$(docker image inspect "$prior_workbench_image" --format '{{.Id}}')" = "$prior_workbench_image_id"

runtime_restore_tmp="$(mktemp "${root_runtime_env}.rollback.XXXXXX")"
trap 'rm -f -- "${runtime_restore_tmp:-}"' EXIT
awk -v image="$prior_workbench_image" '
  /^FRANK_WORKBENCH_IMAGE=/ {
    count += 1
    print "FRANK_WORKBENCH_IMAGE=" image
    next
  }
  { print }
  END { exit count == 1 ? 0 : 42 }
' "$root_runtime_env" > "$runtime_restore_tmp"
cmp -s \
  <(sed '/^FRANK_WORKBENCH_IMAGE=/d' "$root_runtime_env") \
  <(sed '/^FRANK_WORKBENCH_IMAGE=/d' "$runtime_restore_tmp")
chown --reference="$root_runtime_env" "$runtime_restore_tmp"
chmod --reference="$root_runtime_env" "$runtime_restore_tmp"
mv -f -- "$runtime_restore_tmp" "$root_runtime_env"
trap - EXIT
test "$(awk -F= '
  /^FRANK_WORKBENCH_IMAGE=/ { count += 1; value = substr($0, index($0, "=") + 1) }
  END { if (count != 1) exit 42; print value }
' "$root_runtime_env")" = "$prior_workbench_image"
export FRANK_WORKBENCH_IMAGE="$prior_workbench_image"

export FRANK_CODEGRAPH_PHYSICAL_VOLUME="$(<"$codegraph_snapshot/codegraph-volume.txt")"
bash "$FRANK_RELEASE_SOURCE/scripts/production/rollback-codegraph-release.sh" "$codegraph_snapshot" \
  > "$evidence_dir/codegraph-rollback.result" \
  2> "$evidence_dir/codegraph-rollback.log"
grep -Fx 'rollback=passed' "$evidence_dir/codegraph-rollback.result"
flock -u "$runtime_lock_fd"
exec {runtime_lock_fd}>&-

install -m 0644 -- "$rollback_config_dir/Caddyfile" /srv/frank/infra/Caddyfile
docker compose --env-file "$root_runtime_env" -f /srv/frank/infra/docker-compose.dev.yml \
  -f "$codegraph_snapshot/pre-release-overlay.yml" \
  up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 frank-caddy

bash "$FRANK_RELEASE_SOURCE/scripts/production/post-deploy-smoke.sh" \
  > "$evidence_dir/rollback-smoke.result" \
  2> "$evidence_dir/rollback-smoke.log"
grep -Fx 'smoke=passed' "$evidence_dir/rollback-smoke.result"
```

Record the resulting API/web/codegraph image IDs and compare them with
`containers.before.tsv`; verify the codegraph snapshot checksums again; and compare the
restored Caddy hash with `config.before.sha256`. If any differ, rollback is not complete.

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
- verified release manifest with all six attestation IDs and explicit storage-record
  support/ID metadata (empty and `false` for a user-owned repository), four hash-bound
  SPDX SBOMs, four provenance receipts, the codegraph SBOM's exact signed bundle,
  equality-verified predicate and fresh receipt, the signed digest-bound codegraph
  OpenVEX bundle/predicate/receipt, plus the raw and VEX-aware codegraph scan reports;
- `release-worktrees.txt`, candidate Git commit, and zero-divergence preflight evidence;
- `containers.before.tsv`, `codegraph-volume-labels.tsv`, and configuration hashes;
- complete checksummed codegraph snapshot and its encrypted off-cell object/version ID;
- backup result, backup log, `SHA256SUMS`, `manifest.env`, verification output, and
  encrypted off-cell object/version ID;
- deployment workflow/command receipt and migration identifiers;
- post-deploy smoke result/log and observation-window health evidence;
- on rollback, codegraph rollback result/log, prior and restored image IDs, rollback smoke
  output, incident ID, and any isolated restore evidence.

## GitHub build-once artifact evidence

For a release built through GitHub Actions, retain the `release-evidence-<full-commit>`
artifact from the `release-artifacts` workflow with the release evidence above. Its
machine-readable `release-manifest.json` binds the verified full commit to the immutable
GHCR API, web, codegraph, and workbench image digests. All four SPDX SBOMs are hash-bound
evidence; only the codegraph SBOM is separately signed and equality-verified. That signed
SBOM, the signed codegraph OpenVEX, and GitHub OIDC provenance attestations are release evidence,
not a deployment instruction. Production consumes the
manifest's digest references only after the existing preflight, backup, and promotion
gates pass. The workflow never deploys to preview, staging, or production.

Never place secret values, `.env` files, raw session tokens, database contents, or private
keys in the release evidence directory.
