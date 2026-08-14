# Graphify upgrade completion handover

Status: execution plan for a low-context agent

Scope: Graphify upgrade only

Repository baseline when prepared: `b5b338b1589454596130b30364f70d55cf34f644`

Currently accepted Graphify production ancestor: `fead0c4b9e3cae60038b54f999a5066d165f8a2b`

Production host: `76.13.209.160`

Unused migration host: `187.52.115.7`

## 1. Objective

Finish the Graphify upgrade completely, merge it with current main, sign and deploy the
result to the existing production VPS, prove the public and internal Graphify paths,
then remove every superseded pre-Graphify CodeGraph compatibility path and every
Graphify-upgrade-specific obsolete artifact from the defined inventory surfaces.

This plan does **not** clean up Frank generally. It does not remove unrelated old docs,
deprecated skills, flows, mockups, tasks, branches, services, images, or user data.

The job is complete only when:

1. current main contains the final Graphify-only cleanup;
2. the official signed release for that exact main SHA is green;
3. the exact signed release is deployed on `76.13.209.160` with no DNS change;
4. internal Graphify and authenticated public BFF acceptance are green;
5. the current Graphify supervisor is the only CodeGraph implementation and runtime;
6. all items in the signed Graphify legacy deletion manifest are absent;
7. no current Graphify, rollback, user, or unrelated Frank asset was deleted;
8. the final preview reports `PRODUCTION ACCEPTED` and the heavy lane is idle.

## 2. Current production truth

Graphify was accepted in production at exact SHA
`fead0c4b9e3cae60038b54f999a5066d165f8a2b`.

Accepted production image digests/local IDs:

- API: `sha256:ce0da0831bf762ea6950decf12c2febe33b4eda48291950e3cb8f56addacaa1b`
- Web: `sha256:20dbe519a24f7fccf01df49de4fcc1b64953842c4ff707c179b0fc5439df2447`
- CodeGraph: `sha256:8e97261bdb76a53feef2e21b4582c6521bf3f4b04a0d8099f111843862fbc224`
- Workbench: `sha256:062256276884fd39bcecd156743d7e7d9f4200c3bddf6938821412931e493db0`

Acceptance evidence:

- directory: `/srv/frank/release-evidence/20260811T223058Z`
- receipt: `/srv/frank/release-evidence/20260811T223058Z/PRODUCTION_ACCEPTED.receipt`
- receipt SHA-256: `90eeb23a8b98cf0adabc1abc585adafe07f27ba3286bd540359d6be045f08df6`
- preview: `https://preview.frank.fail/graphify-code-intelligence-v2/`

The accepted implementation already proved:

- Graphify v0.9.39 AST-only supervisor
- non-root UID 10001
- internal-only Docker network and no published host port
- blocked egress
- authenticated control API
- duplicate refresh idempotency
- valid graph with unique nodes and edges and no dangling/self edges
- public projects/status/overview/refresh/job/bounds behavior
- 70 seconds of stable-ready quiescence with zero restarts/publication drift
- checksummed schema-v2 rollback including Caddy
- PostgreSQL and encrypted off-cell backups

Repository main later advanced to `b5b338b1589454596130b30364f70d55cf34f644`
through unrelated Wave 1/chat work. The final Graphify cleanup must start from the
then-current `origin/main`, not reset main back to `fead0c4b`.

## 3. Current Graphify assets: KEEP

These names contain `codegraph`, but they are the current Graphify implementation.
Never delete them based on their names.

### Source and API

- `apps/codegraph/**`
- `apps/api/src/routes/codegraph.ts`
- current CodeGraph tests under `apps/api/src/test/**` and `apps/codegraph/tests/**`
- `infra/production/codegraph-projects.json`

### Production and release configuration

- current `frank-codegraph` Compose service
- current `frank-codegraph-volume-init` service
- current `frank-codegraph-internal` network
- current Graphify data volume
- current registry and staged source mounts
- CodeGraph routes and environment in `infra/production/docker-compose.app.yml`
- `.github/workflows/codegraph-image-security.yml`
- current CodeGraph portions of `.github/workflows/release-artifacts.yml`
- current SBOM, OpenVEX, provenance, scratch-runtime, and anonymous-pull gates
- current snapshot and rollback capability after it is converted to
  Graphify-to-Graphify semantics

### Production state

- current PostgreSQL and Valkey data
- `/srv/frank/workspaces/central`
- current Graphify release and data
- current Caddy configuration and Goose service
- current runtime secrets, domain token, and control token
- current DNS: `frank.fail -> 76.13.209.160`
- current final image digests
- final acceptance evidence and the rollback set required by the final observation gate

## 4. Graphify legacy candidates: inventory, do not assume

These are the only candidate categories in scope.

### Source compatibility

- `FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK`
- the one-time migration behavior in `scripts/production/hosted-preflight.sh`
- its focused tests in `apps/api/src/test/hosted-preflight-disk-gate.test.ts`
- runbook language about a legacy Node CodeGraph or one-time legacy network
- rollback code that restores the pre-Graphify Node image/overlay instead of the
  prior accepted Graphify release
- snapshot metadata whose only purpose is restoring the pre-Graphify implementation

### Repository artifacts created during this upgrade

- merged inactive Graphify worktrees/branches such as `graphify-prod`,
  `codegraph-registry-readiness`, `codegraph-watcher-events`,
  `codegraph-prod-diagnosis`, and Graphify-specific release-fix worktrees
- failed-attempt operator scripts and reproducible local release downloads
- superseded Graphify previews, leaving only the final accepted preview
- Graphify-specific diagnostic fixtures or evidence copies that have a sealed canonical
  replacement and are not required by the final receipt

### Production artifacts

- pre-Graphify Node image IDs and tags
- failed/superseded Graphify candidate images
- obsolete legacy overlay files
- pre-Graphify volume snapshots and rollback/config directories after the final
  Graphify-to-Graphify rollback set passes observation
- obsolete release worktrees and evidence copies after the final evidence is sealed
- disposable Graphify diagnostic containers, networks, volumes, and processes

### Workstation, cloud, and provider artifacts

- Graphify-specific temporary directories, downloads, archives, and duplicate mirrors
- superseded Graphify ciphertext backups after the final backup and retention transition
- superseded GHCR candidate manifests and GitHub Actions artifacts where deletion is
  supported and provenance is no longer required
- the unused KVM4 host `187.52.115.7`, because it was created solely for the rejected
  Graphify migration, after provider identity and zero-use proof

No item is deletable until it has an exact identity and passes every test in Section 6.

## 5. Explicitly out of scope

Do not inspect for deletion or change these unless an exact Graphify dependency points
to a specific file and the integration owner approves that one file:

- general Frank product specifications and ADRs
- `skills/deprecated/**`
- general `flows/**`
- general mockups and previews
- Dashboard, Lake, Harness, Night Watch, Pavone, Blockwise, Buzz, attachments, chat,
  workbench, Files, schedules, channels, or storage implementation
- unrelated branches/worktrees, Docker resources, caches, backups, and evidence
- user files, databases, secrets, credentials, and projects
- general old-Frank teardown tooling unless it contains a direct active Graphify reference

Do not turn this into a repository-wide cleanup.

## 6. Exact deletion eligibility

A Graphify legacy item can enter `DELETE.json` only when all conditions are true:

1. It has one exact path, full Git ref/object, Docker image/container/volume/network ID,
   provider object ID, process/unit name, or provider instance ID.
2. Provenance shows it was created by the pre-Graphify implementation or this Graphify
   upgrade and is now superseded.
3. It has zero current source, build, package, workflow, Compose, container, process,
   mount, production-manifest, rollback-manifest, user-data, and downstream references.
4. The final Graphify implementation provides the same required behavior, or the
   behavior is explicitly retired.
5. The final signed candidate and rollback set do not require it.
6. An independent agent reproduces the identity and zero-reference result.

If any test fails, disposition is `KEEP` or `REVIEW`; never infer deletion.

Never delete by substring (`*frank*`, `*codegraph*`, `*legacy*`), wildcard, parent
directory, Docker prune, tag sweep, or global cache cleanup.

## 7. Parallel-agent topology

Agents work in isolated worktrees. Read-only inventories can run in parallel. Source
agents have disjoint ownership. Only the integration agent edits shared release files,
merges, signs, deploys, or deletes runtime/provider objects.

### Phase 0 — serial control packet

The integration agent writes `graphify-eradication/PHASE0.json` before dispatching.
It contains:

- exact current `origin/main` SHA
- exact accepted production SHA and four image digests
- production receipt path/hash and preview URL
- original VPS IP and SSH host-key fingerprint
- unused VPS provider account, server/order ID, IP, and host-key fingerprint
- GitHub repository/GHCR namespace
- workstation and OneDrive roots
- pinned tool versions and least-privilege credential sources
- evidence destination and retention period
- exact observation contract
- scope = `graphify-upgrade-only`
- `erasure_scope`: exactly `graphify-current-tree-and-operational`, covering the
  current source tree plus Graphify-specific runtime, workstation, cloud, provider,
  branch, worktree, artifact, package, preview, backup, and unused-host items

Published Git history is explicitly outside this focused plan because rewriting or
deleting the shared repository would affect unrelated Frank history. Phase 8 produces
an impact packet but performs no history rewrite or repository deletion. A low-context
agent may not expand the scope.

The release owner, integration agent, and independent verifier sign the canonical
Phase 0 hash with distinct pinned identities. A missing field or signature is `STOP`.

### Phase 1 — four parallel read-only inventories

Run A1–A4 concurrently.

#### Agent A1 — source and dependency inventory

Prompt:

> Work read-only from the exact Phase 0 main SHA. There is no `.codegraph` index, so use `rg` first. Inventory only pre-Graphify CodeGraph compatibility in source, tests, Compose, workflows, package scripts, and the production runbook. Distinguish current Python `apps/codegraph/**` Graphify code from legacy Node/bootstrap behavior. Produce `source.json` with exact path+line, callers/references, replacement, and `KEEP|DELETE|REVIEW`. Do not inspect unrelated product areas and do not edit.

Required seed queries:

```text
FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK
legacy Node codegraph
legacy codegraph
legacy overlay
snapshot-codegraph-release
rollback-codegraph-release
frank-codegraph
```

For `frank-codegraph`, classify each match; the service name itself is current.

#### Agent A2 — production runtime inventory

Prompt:

> Read-only audit `76.13.209.160` for Graphify/CodeGraph upgrade artifacts only. Record exact current containers/images/volume/network/release/config/backup/evidence as KEEP. Record exact pre-Graphify or failed-candidate artifacts as candidates. Include full IDs, labels, hashes, size, creation time, current/rollback references, mounts, processes, and projected bytes. Do not mutate, prune, or inspect unrelated services for deletion.

#### Agent A3 — workstation/GitHub/OneDrive inventory

Prompt:

> Read-only inventory Graphify-upgrade-specific local worktrees/branches/temp/downloads, GitHub Actions artifacts/caches, GHCR manifests, previews, `.codex` mirrors, and OneDrive encrypted objects. Exclude unrelated tasks and user files. For each item record exact identity, size, recoverability, current/final evidence reference, and disposition. Do not mutate.

#### Agent A4 — unused migration VPS inventory

Prompt:

> Read-only audit only Hostinger instance `187.52.115.7` using the provider/server identity from Phase 0. Prove it has zero DNS, traffic, production, database, unique-data, secret-authority, and rollback role. Inventory exact Frank/Graphify paths and resources on that host. Produce a provider cancellation packet with exact instance/order ID, host fingerprint, bounded target list, exclusion list, billing effect, and provider action. Do not wipe or cancel.

### Phase 2 — serial manifest freeze

The integration agent materializes:

- `graphify-eradication/inventory-universe.json`
- `graphify-eradication/KEEP.json`
- `graphify-eradication/DELETE.json`
- `graphify-eradication/REVIEW.json`
- `graphify-eradication/dependency-proof.json`
- `graphify-eradication/UNIVERSE_FREEZE.json`

The universe contains:

- `collections[]`: every audited Graphify-specific root/API collection and completed
  pagination cursor;
- `items[]`: every materialized item with a unique canonical key.

Mechanically prove:

```text
keys(universe.items) ==
  disjoint_union(keys(KEEP), keys(DELETE), keys(REVIEW))
```

`REVIEW` must be zero before implementation or deletion. The release owner, integration
agent, and independent verifier sign the freeze hash, which binds Phase 0, universe,
KEEP, DELETE, REVIEW, and dependency proof.

### Phase 3 — parallel source changes

Use three isolated branches from the same Phase 0 main. They may edit only their rows.

| Agent | Exclusive files | Task |
|---|---|---|
| C1 | `scripts/production/hosted-preflight.sh`, `apps/api/src/test/hosted-preflight-disk-gate.test.ts` | Remove the one-time legacy network flag and bootstrap allowance; make current Graphify topology mandatory. |
| C2 | `scripts/production/snapshot-codegraph-release.sh`, `scripts/production/rollback-codegraph-release.sh`, `apps/api/src/test/codegraph-rollback-bundle.test.ts` | Convert rollback from pre-Graphify Node semantics to prior-accepted-Graphify semantics; retain checksummed Caddy, API, web, CodeGraph, workbench, volume, and config capture. |
| C3 | Graphify-specific documentation selected by `DELETE.json`, excluding the current release runbook | Delete obsolete Graphify migration/incident text and retain required third-party notices/licenses. |

The integration agent exclusively edits:

- `docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md`
- `infra/production/docker-compose.app.yml`
- root package/workspace/lock files
- generated registries
- any cross-lane test

Agent requirements:

- no local test server or localhost
- no production changes
- no API limit, auth, Graphify parsing, UID, egress, network, or data-layout changes
- no agent commits another agent's files
- return exact diff, deleted paths, test additions, and unresolved references

### Phase 4 — integration and hosted preview

One integration agent performs this serially:

1. Rebase C1, C2, C3 onto the current exact main.
2. Review every deletion against signed `DELETE.json`.
3. Merge C1, then C2, then C3; manually update the current runbook.
4. Run exact negative source checks:
   - no `FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK`
   - no `legacy Node codegraph`
   - no legacy overlay restore command
   - no source/build/workflow reference to a deleted path
5. Prove the current Graphify service/API/Compose/workflows remain.
6. Update the existing hosted preview before merging.
7. Run hosted verify, secret scans, CodeGraph diagnostic, API/web package tests,
   snapshot/rollback tests, Compose render/security tests, SBOM/VEX/provenance, scratch
   runtime, and anonymous digest pulls.
8. Obtain one independent P0/P1 review.
9. Open a ready PR and merge normally only when every required check is green.

### Phase 5 — final exact-main signing

1. Record the merge SHA.
2. Require exact-main verify and secret scan success.
3. Run the official release workflow; do not build or sign ad hoc.
4. Verify schema-v2 manifest and every evidence hash.
5. Verify four immutable digest pulls and all provenance/SBOM/OpenVEX attestations.
6. Verify the CodeGraph scratch runtime, UID 10001, internal network, no host port,
   blocked egress, staged inputs, and disk phase gates.
7. Refresh every Graphify-only inventory collection and cursor against the exact merge
   SHA and signed candidate digests.
8. Create `graphify-eradication/FINAL_FREEZE.json` binding:
   - Phase 0 and Universe Freeze hashes/signatures
   - baseline main SHA and exact final merge SHA
   - refreshed universe and cursor proofs
   - final KEEP, DELETE, REVIEW, and dependency-proof hashes
   - exact four signed candidate digests
   - lifecycle states (`KEEP`, `KEEP_UNTIL`, `DELETE`)
9. Require release-owner, integration-agent, and independent-verifier signatures on
   the canonical Final Freeze hash. `REVIEW` must still be zero.
10. Stop on any mismatch; do not deploy a superseded SHA or delete under the
    pre-implementation universe.

### Phase 6 — rollback-safe original-VPS promotion

One mutating release agent only. No parallel VPS work.

1. Confirm DNS still resolves only to `76.13.209.160`.
2. Confirm the current accepted production unit is healthy.
3. Create a fresh current-Graphify schema-v2 rollback snapshot with:
   - active Caddy file and SHA
   - current API/web/CodeGraph/workbench image IDs and digest refs
   - current Graphify volume identity and contents
   - current config/runtime assignments
4. Create and verify the PostgreSQL backup.
5. Create a fresh encrypted off-cell object and prove native sync, full readback SHA,
   streamed decrypt, and archive contents without plaintext.
6. Run the signed post-pull capacity gate.
7. Execute the no-build promotion with the 1920-second readiness bound and automatic
   coupled rollback.
8. Run internal acceptance:
   - health unauthenticated
   - control API 401 without token and 200 with token
   - token cell is exactly `frank`
   - duplicate refresh maps to one job
   - job succeeds
   - graph is within bounds, unique, and has no dangling/self edges
   - files owned by UID 10001
   - egress blocked
9. Run authenticated public acceptance:
   - live 200 and ready 200
   - root 401 unauthenticated and 200 authenticated
   - projects/status/overview/console 200
   - raw and expand 403
   - duplicate refresh 202 with the same job
   - job succeeds
   - bounded overview respects totals and limits
   - status reaches ready with no build/queue/error
10. Observe for 15 minutes:
   - zero API/web/CodeGraph/Caddy restarts
   - zero unexpected publications
   - zero queued/active jobs
   - zero HTTP 5xx

On any terminal failure, execute coupled rollback immediately and prove exact prior
Graphify/Caddy/volume/API/web/workbench recovery. Do not retry blindly.

### Phase 7 — Graphify-specific eradication

This phase begins only after Phase 6 observation passes and a signed lifecycle
transition changes `KEEP_UNTIL(final SHA, observation receipt)` records to `DELETE`.
The executor must verify the complete Phase0 -> Universe Freeze -> Final Freeze ->
lifecycle-transition chain before each deletion.

Use a reviewed manifest executor. It accepts one exact record at a time, revalidates
identity and zero references, writes before/after receipts, and stops the entire lane
after any mismatch. No wildcard or batch prune.

Order:

1. stop/fence only processes that can recreate the exact target;
2. remove disposable Graphify diagnostic containers;
3. remove exact obsolete Graphify networks and volumes;
4. remove superseded pre-Graphify/failed-candidate image IDs;
5. remove obsolete Graphify release/config/rollback/backup/evidence directories;
6. remove superseded Graphify preview versions, keeping the final accepted preview;
7. remove exact Graphify-upgrade local temp/download/archive paths;
8. remove exact superseded Graphify `.codex`/OneDrive ciphertext pairs only after the
   final pair is verified and retained;
9. delete provider-supported superseded Graphify GitHub artifacts/caches/GHCR
   manifests after zero final-release/provenance references;
10. remove clean, merged, inactive Graphify worktrees with `git worktree remove`, then
    delete their branches normally;
11. execute the owner-signed Hostinger action packet for `187.52.115.7`: verify exact
    instance and host fingerprint, erase only bounded Graphify/Frank targets, cancel
    that unused instance, and record provider/billing receipt;
12. rerun the full Graphify-only inventory and require zero `DELETE` residue.

Keep the final current release, current data volume, DB, secrets, source, final preview,
final acceptance evidence, and final rollback/off-cell set.

### Phase 8 — Graphify history impact packet (read-only handoff)

Deleting files from main does not remove old Node CodeGraph blobs from shared Git
history, PR refs, or provider transparency systems. This focused plan must not rewrite
or delete the shared Frank repository because that would affect unrelated history.
Instead, produce a signed, read-only impact packet before claiming operational cleanup.

The packet lists:

- exact old CodeGraph paths and blob IDs;
- every branch/tag/PR ref containing them;
- all known clones/worktrees;
- related artifacts/packages/backups;
- immutable third-party metadata that cannot be erased;
- effect on signed provenance and downstream branches.

The packet binds the exact old CodeGraph paths/blob IDs, branches/tags/PR refs that
contain them, provider-retained artifacts/metadata, known shared clones/backups, and
the collateral effect of a history rewrite. It ends with one status:

- `NO REPOSITORY-WIDE ACTION REQUIRED` when current-tree and operational cleanup is
  the requested Graphify completion boundary; or
- `SEPARATE PRODUCT-WIDE MIGRATION REQUIRED` when the owner still requires old blob
  content removed from published history.

The second status is handed to a separately authorized product-wide repository
migration plan with its own complete inventory, preservation rules for unrelated
Frank history/issues/PRs/releases/packages/clones/backups, signing, rollback, and
production acceptance. This Graphify-only agent does not execute it.

### Phase 9 — final proof and handover self-removal

Publish:

- final repository and production SHA
- final four image digests
- exact production acceptance receipt and preview URL
- `KEEP/DELETE/REVIEW` counts with `REVIEW=0` and `DELETE residue=0`
- negative source scan results
- zero obsolete Graphify runtime/workstation/cloud/provider artifacts
- unused VPS cancellation receipt
- DNS proof for `76.13.209.160`
- final rollback/off-cell hashes
- 15-minute observation results
- heavy-lane-idle receipt

Then delete this handover document and temporary Graphify-eradication working manifests
from the final current tree. Retain encrypted signed audit evidence and a compact final
receipt containing only identities, hashes, zero counts, and permanent external metadata.

## 8. Required stop conditions

Stop immediately when:

- a target differs from its signed identity;
- a target has any current/final/rollback/user/downstream reference;
- `REVIEW` is nonzero;
- current Graphify or production health is not green;
- DNS differs from `76.13.209.160`;
- the recorded baseline SHA differs before implementation, or the exact authorized
  final SHA/digests differ from the signed Final Freeze during signing/deployment;
- backup/off-cell/Caddy/volume evidence fails a hash;
- a worktree is dirty or unmerged;
- provider identity for `187.52.115.7` is incomplete;
- deletion would cross a path root, mount, symlink/reparse point, or ownership boundary;
- any P0/P1 review finding remains;
- the final candidate is not officially signed from exact main.

Do not select a replacement deletion target automatically after a failure.

## 9. Final acceptance statement

The low-context agent may finish only with this evidence-backed statement:

> The Graphify upgrade is fully complete and live on the original production VPS at
> exact SHA `<sha>`. The current Python Graphify supervisor is the only CodeGraph
> implementation and runtime. Internal and public refresh/overview/stable-ready checks
> pass. Every item in the signed Graphify legacy manifest is absent from the current
> repository tree and Graphify operational runtime, workstation, cloud, provider,
> branch, worktree, package, artifact, preview, backup, and unused-host scope. REVIEW
> is zero, DNS remains `76.13.209.160`, rollback/off-cell evidence is valid, the unused
> migration VPS is cancelled, and the heavy lane is idle.

Published shared Git history is not rewritten by this focused plan. The signed Phase 8
impact packet states whether a separate product-wide repository migration is required.

Anything less is `GRAPHIFY UPGRADE NOT COMPLETE`.
