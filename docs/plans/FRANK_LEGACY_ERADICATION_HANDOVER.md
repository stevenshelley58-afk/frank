# Frank completion and legacy-eradication handover

Status: execution handover

Prepared from repository main: `b5b338b1589454596130b30364f70d55cf34f644`

Production Graphify acceptance ancestor: `fead0c4b9e3cae60038b54f999a5066d165f8a2b`

Production host: `76.13.209.160`

Do not use or move production to: `187.52.115.7`

## 1. Outcome

Finish Frank, deploy the final integrated build to the existing production VPS, and remove every superseded implementation, document, process, flow, preview, branch, image, runtime resource, backup, and remote copy that the deletion manifest classifies as legacy.

Completion means all of the following are true at the same time:

1. The final repository main is green, signed, deployed, and matches production.
2. The current Graphify implementation is the only CodeGraph implementation.
3. No legacy compatibility switch, legacy rollback path, old code, stale plan, deprecated skill, obsolete flow, superseded preview, unused server copy, old image, old volume, old release tree, or old backup remains in any inventoried location.
4. Current user data, current Graphify data, current source, secrets, and unrelated projects were not deleted.
5. A final negative inventory proves zero legacy residue.
6. The final hosted preview and authenticated production smoke are green.

The phrase “not saved anywhere” is interpreted only through the owner-signed
erasure mode selected in Phase 0. `clean-current-tree` removes legacy material
from the live tree and operational systems but explicitly permits immutable
published history and transparency metadata. `hard-erasure` replaces the
repository and attempts removal from every enumerated storage/provider surface.
Never claim hard erasure while an enumerated provider or clone retains content.

Steven's current requested outcome maps to `hard-erasure`. Phase 0 must record that
choice and this instruction in its signed authority packet. `clean-current-tree` is
documented only as the honest fallback if a provider makes complete content erasure
impossible; it does not satisfy the currently requested outcome.

This is an eradication job, not a general disk cleanup. Never use a broad name match, global prune, recursive deletion of a parent directory, or `tools/ops/teardown-old-frank.sh --destroy`. That script matches the current Frank deployment and can destroy production.

## 2. Current facts

- Graphify is accepted in production at `fead0c4b9e3cae60038b54f999a5066d165f8a2b`.
- Repository main has advanced to `b5b338b1589454596130b30364f70d55cf34f644` through the Wave 1/chat integration. Treat `b5b338b` as the source baseline and `fead0c4b` as the currently deployed Graphify acceptance ancestor.
- Current production image IDs from the Graphify acceptance are:
  - API: `sha256:ce0da0831bf762ea6950decf12c2febe33b4eda48291950e3cb8f56addacaa1b`
  - Web: `sha256:20dbe519a24f7fccf01df49de4fcc1b64953842c4ff707c179b0fc5439df2447`
  - CodeGraph: `sha256:8e97261bdb76a53feef2e21b4582c6521bf3f4b04a0d8099f111843862fbc224`
  - Workbench: `sha256:062256276884fd39bcecd156743d7e7d9f4200c3bddf6938821412931e493db0`
- Production acceptance evidence is `/srv/frank/release-evidence/20260811T223058Z` and the acceptance receipt SHA-256 is `90eeb23a8b98cf0adabc1abc585adafe07f27ba3286bd540359d6be045f08df6`.
- The current Graphify supervisor lives under `apps/codegraph/**`. It is current code. Do not delete it.
- The current service is named `frank-codegraph`. A name containing `codegraph` or `frank` is not proof that a resource is legacy.
- The current API route is `apps/api/src/routes/codegraph.ts`. It is current code. Do not delete it.
- Current Compose services, network, volume initializer, registry bind, API BFF, SBOM/VEX workflows, and signed image build are required until a replacement is accepted.
- `flows/README.md` describes a current pipeline folder contract. Do not delete `flows/` merely because the user said “old flows”; prove that each concrete flow is superseded or migrate its live contract first.
- The root worktree contains unrelated dirty work. Never stage or commit it as part of this program.

## 3. Non-negotiable boundaries

### Keep until a final replacement is accepted

- `apps/codegraph/**`
- `apps/api/src/routes/codegraph.ts` and current CodeGraph tests
- `infra/production/docker-compose.app.yml` current Graphify services and network
- `.github/workflows/codegraph-image-security.yml`
- CodeGraph portions of `.github/workflows/release-artifacts.yml`
- current PostgreSQL/Valkey data
- `/srv/frank/workspaces/central`
- current Graphify data volume and current release
- current Caddy configuration, Goose service, secrets, and domain token
- production DNS at `76.13.209.160`
- the current four production image digests
- the currently required rollback and off-cell set until the final post-clean build has passed its observation window
- user files, user projects, credentials, databases, and unrelated services

### Never do

- Do not run `git clean`, force-push, rewrite history, or delete branches until the exact hard-erasure manifest is approved in Phase 7.
- Do not run Docker system/image/volume/buildx prune.
- Do not delete by substring such as `*frank*`, `*codegraph*`, `*old*`, or `*legacy*`.
- Do not delete a Docker image until its full immutable ID has zero container, current-manifest, rollback-manifest, and final-candidate references.
- Do not delete a volume until its exact labels, contents, owner, and zero references are recorded.
- Do not remove release evidence before the final replacement evidence is independently verified.
- Do not touch Blockwise, Dashboard, Lake, Night Watch, Pavone, or other task-owned resources without an owner-signed exact manifest.
- Do not deploy to or change DNS toward `187.52.115.7`.

## 4. Definition of legacy

An item is legacy only when all four tests pass:

1. **Identity:** the item has an exact path, Git object/ref, Docker ID, volume/network ID, provider object ID, or process/unit name.
2. **Ownership:** provenance proves it belongs to the superseded Frank implementation or an obsolete delivery attempt.
3. **No use:** there are zero live runtime, source, manifest, rollback, documentation-source-of-truth, user-data, and downstream references.
4. **Replacement:** the final accepted implementation covers the behavior, or the product specification explicitly removes the behavior.

If any test fails, classify the item as `KEEP` or `REVIEW`; never infer `DELETE`.

Likely legacy candidates that still require exact proof:

- `skills/deprecated/**`
- `tools/ops/teardown-old-frank.sh`
- `FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK` and its one-time migration tests/docs
- wording and procedures that restore the pre-Graphify Node CodeGraph
- pre-Graphify image digests, overlays, volumes, releases, config rollback sets, and off-cell archives
- stale plan/status documents that describe completed or superseded work as active
- superseded product update plans after their still-valid requirements are merged into one current specification
- obsolete mockups and hosted previews
- inactive local worktrees and merged branches
- failed-attempt scripts, staging archives, downloaded release artifacts, build caches, and temp directories with reproducible upstream sources
- the unused KVM4 host `187.52.115.7`, after identity, billing, and zero-production-use verification

## 5. Agent topology

Use isolated worktrees. Do not let two agents edit the same file. Agents return manifests and commits; only the integration agent merges.

### Phase 0: freeze authority, collection plan, tooling, and erasure mode

No inventory or destructive action begins until a root integration agent writes
`eradication/PHASE0.json` and three pinned identities sign its complete canonical
hash: the release owner, the integration agent, and an independent verifier. The
schema requires `release_owner_identity`, detached `release_owner_signature`,
`integration_agent_identity/signature`, and `independent_verifier_identity/signature`.
None may be the same credential. It must also contain:

- `erasure_mode`: exactly `clean-current-tree` or `hard-erasure`
- exact `origin/main` SHA and proof the isolated control worktree is clean
- exact deployed production SHA, four image digests, acceptance receipt path/hash,
  DNS result, original-VPS SSH host-key fingerprint, and current health results
- every audited identity: workstation, original VPS, unused VPS, GitHub owner/repo,
  GHCR namespace, OneDrive root, preview root, and any other provider account
- least-privilege credential source and tool/version for every read and mutation
- immutable evidence destination and encryption/retention policy
- exact observation duration and thresholds
- the inventory schema version and canonical
  `eradication/inventory-collection-plan.json` hash

The collection plan contains the intended `collections[]`, schemas, credentials,
scope, and erasure mode, but no discovered items. Phase 0 never contains a future
universe hash and is never mutated after signing.

Default observation contract unless Phase 0 makes it stricter:

- duration: 15 minutes after the final deployment and 15 minutes after destructive cleanup
- public live/ready success: 100% of one request every 30 seconds
- authenticated root/projects/status/overview: 100% success
- API/web/CodeGraph/Caddy restarts: zero
- CodeGraph queued/active jobs after refresh completion: zero
- extra Graphify publications during quiescence: zero
- HTTP 5xx from Frank during observation: zero

Required tool identities are pinned in Phase 0, including Git, GitHub CLI, Docker,
Docker Compose, OpenSSL, jq, PowerShell, SSH, the native OneDrive client, and the
hosting-provider control surface. A missing identity, credential, host fingerprint,
or evidence destination is `STOP`, not a fallback.

After Phase 0, Wave A materializes `eradication/inventory-universe.json` with two
immutable arrays:

- `collections[]`: every collection being audited, including exact filesystem roots,
  Git refs/worktrees, Docker collections, systemd, cron, Caddy, GitHub APIs and
  pagination cursors, GHCR packages, OneDrive folders, preview roots, backup roots,
  and provider instance IDs. Each includes snapshot time, discovery command/API,
  tool version, and completion cursor.
- `items[]`: every materialized item discovered from those collections, with one
  unique canonical target key, exact identity, collection key, and discovery hash.

Wave A hashes the completed universe after all collection cursors complete. This file
defines what “everywhere” means and differs by erasure mode. It is not authorized for
destruction until Wave B creates the separate triple-signed universe freeze.

No destructive lane may start before the owner-signed erasure mode and Phase 0 hash
are present in the hosted preview.

### Wave A: parallel read-only inventory

Run these four agents concurrently.

#### Agent A1 — repository source and dependency inventory

Prompt:

> Work read-only from exact `origin/main`. Inventory every legacy implementation reference. Start with `rg`; there is no `.codegraph` index. Produce `legacy-source.json` with exact path, line/symbol, dependency callers, replacement, disposition (`KEEP|DELETE|REVIEW`), and proof. Explicitly distinguish current `apps/codegraph/**` Graphify code from pre-Graphify compatibility paths. Inspect package scripts, Compose, workflows, tests, build inputs, release scripts, registry files, and generated indexes. Do not edit or delete.

Required checks:

- all imports/callers for each proposed deletion
- package/workspace references
- Docker build contexts
- CI workflow references
- runtime environment references
- contract/schema references
- current production manifest references

#### Agent A2 — documentation, process, skill, and flow inventory

Prompt:

> Work read-only from exact `origin/main`. Classify every file under `docs/**`, `flows/**`, `skills/deprecated/**`, mockups, and operational handover/process files as current, superseded, or review. For superseded documents, extract any still-valid requirement into a proposed single current document before marking the old file deletable. Produce `legacy-docs.json`. Do not delete current ADRs, legal notices, third-party licenses, schema registries, current runbooks, or the live pipeline contract. Do not edit.

The inventory must specifically review:

- `docs/plans/EXECUTION_STATUS.md`
- `docs/plans/FRANK_MASTER_PARALLEL_BUILD_PLAN.md`
- `docs/plans/WAVE2_PACKETS.md`
- `docs/plans/WAVE3_PACKETS.md`
- all files under `docs/product/**`
- `flows/README.md`
- `skills/deprecated/**`
- `tools/ops/teardown-old-frank.sh`

#### Agent A3 — production and unused-host inventory

Prompt:

> Read-only audit original production `76.13.209.160` and unused host `187.52.115.7`. Produce `legacy-runtime.json` with exact container IDs, image IDs/digests, volume/network names and labels, systemd units, processes, ports, release directories, rollback/config directories, backups, previews, build caches, cron, Caddy fragments, environment keys, and filesystem paths. Mark current Graphify/Frank resources KEEP. Prove that `187.52.115.7` has zero production/DNS role. No mutation.

For every runtime deletion candidate include:

- full ID/path
- size
- creation time
- owner/labels
- container and manifest references
- rollback references
- current process/file-handle references
- projected bytes recovered

#### Agent A4 — GitHub, workstation, and off-cell inventory

Prompt:

> Read-only audit GitHub branches/tags/releases/artifacts/caches/GHCR/attestations, all registered local worktrees, exact Frank-owned temp/staging files, hosted previews, `.codex` mirrors, and OneDrive encrypted objects. Produce `legacy-remote.json`. Do not touch user files, active/frozen worktrees, current evidence, current images, or other task-owned artifacts. Record which remote objects GitHub cannot truly erase because PR refs or attestation transparency records are immutable.

### Wave B: serial manifest freeze

One integration agent merges the four inventories into these files:

- `eradication/KEEP.json`
- `eradication/DELETE.json`
- `eradication/REVIEW.json`
- `eradication/dependency-proof.json`
- `eradication/inventory-universe.json`
- `eradication/UNIVERSE_FREEZE.json`

All manifests validate against a committed versioned JSON Schema. Every inventory
record contains a canonical target key, exact identity/path, lstat/realpath or
provider ID, identity/content hash, discovery source, owner, size, all references,
lifecycle state, disposition, replacement proof, and proposed executor action.
Canonical keys are unique. Gate B creates `UNIVERSE_FREEZE.json` containing the
canonical Phase 0 hash, collection-plan hash, completed cursor proofs, final universe
hash, and exact KEEP, DELETE, REVIEW, and dependency-proof hashes. The release owner,
integration agent, and independent verifier sign the complete canonical freeze hash
with their distinct Phase 0 identities. Gate B verifies both signature layers, then
mechanically proves:

`keys(universe.items) == disjoint_union(keys(KEEP), keys(DELETE), keys(REVIEW))`

There are no duplicate keys, all collection cursors remain unchanged, and the freeze
explicitly binds every artifact: Phase 0, collection plan, inventory universe, KEEP,
DELETE, REVIEW, and dependency proof. Numeric “all four/five” shorthand is forbidden.

Rules:

1. Each `DELETE` record has one exact target and all four legacy tests.
2. No wildcard targets.
3. No parent directory target when child ownership differs.
4. The schema validator proves the unique canonical keys in `KEEP + DELETE + REVIEW`
   equal the complete `inventory-universe` snapshot.
5. `REVIEW` must be empty before destructive work begins.
6. Publish the canonical SHA-256 and signature/bundle references for
   `PHASE0.json`, `inventory-collection-plan.json`, `inventory-universe.json`,
   `KEEP.json`, `DELETE.json`, `REVIEW.json`, `dependency-proof.json`, and
   `UNIVERSE_FREEZE.json`. Verify the hosted values byte-for-byte against the
   triple-signed freeze before Gate B exits.

Gate B exits only when an independent read-only agent confirms:

- no current source imports a delete target
- no current runtime or rollback manifest references a delete target
- no user data is in the delete set
- no unrelated project is in the delete set
- the current Graphify production unit is entirely in KEEP

### Wave C: parallel source cleanup

Create isolated branches with a committed path-owner matrix. These agents may run
in parallel only on disjoint paths. The integration agent exclusively owns all shared
hot files, generated indexes, workspace/lock files, and the final current runbook.

Path ownership:

| Owner | Exclusive paths |
|---|---|
| C1 | `apps/codegraph/**`, CodeGraph-specific API tests; proposes but does not edit shared release files |
| C2 | superseded docs/skills/mockups/flows listed in `DELETE.json`; cannot create/edit the final runbook |
| C3 | non-shared obsolete tooling/workflow files; proposes but does not edit root package/lock/generated registries |
| C4 | `.gitignore` and exact hygiene targets not owned above |
| Integration agent | Compose, current runbook, production scripts, root package/lock/workspace files, registries, cross-lane tests |

If a task needs a path outside its row, it submits a patch fragment to the integration
agent; it does not edit the path. Agents never merge their own branches.

#### Agent C1 — CodeGraph compatibility retirement

Scope:

- remove the one-time legacy network flag and tests
- replace legacy-Node rollback semantics with Graphify-to-Graphify rollback
- remove legacy overlay restoration logic
- propose snapshot/rollback and runbook changes to the integration agent

Do not change API bounds, Graphify parsing, auth, UID, egress, or current Compose topology.

#### Agent C2 — obsolete docs, skills, and flow cleanup

Scope:

- delete only paths listed in `DELETE.json`
- extract still-valid requirements for the integration agent to consolidate into:
  - one current product specification
  - one current execution status
  - one current production runbook
- remove `skills/deprecated/**` if no registry/import references remain
- remove obsolete mockups/previews from source
- delete empty directories

At the end, the handover document itself becomes obsolete. Delete it in the final cleanup commit after its checklist is complete.

#### Agent C3 — obsolete tooling and CI cleanup

Scope:

- delete `tools/ops/teardown-old-frank.sh` after replacing any still-needed inventory behavior with target-manifest tooling
- remove legacy-only workflow conditions, environment keys, tests, and owned scripts;
  submit package/generated-registry changes to the integration agent
- remove obsolete artifact download/staging helpers
- keep current SBOM, VEX, provenance, anonymous-pull, and signed release gates

#### Agent C4 — repository hygiene

Scope:

- remove tracked generated output, stale patches, archived mockups, obsolete fixtures, and dead dependencies listed in `DELETE.json`
- update `.gitignore` so local temp, worktree, preview, archive, and evidence files cannot be recommitted
- prove no database, secret, `.env`, `node_modules`, build output, or local agent state is staged
- run unused-export/dependency checks using hosted CI only

### Wave D: integration and hosted validation

One integration agent performs these steps serially:

1. Rebase each C branch onto the same current main.
2. Merge in order C1, C3, C2, C4.
3. Resolve shared files manually; never accept an entire side for:
   - `infra/production/docker-compose.app.yml`
   - `docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md`
   - `scripts/production/hosted-preflight.sh`
   - snapshot/rollback scripts
   - root package/lock/workspace files
4. Regenerate registries and lockfiles through the repository commands.
5. Deploy/update a hosted cleanup preview before feature testing.
6. Run the full hosted verify, secret scans, CodeGraph diagnostic, schema validation, package tests, build, container security, SBOM/VEX/provenance, and anonymous pull gates.
7. Run negative checks:
   - every exact repository delete path is absent
   - every forbidden legacy token is absent except the eradication manifest itself
   - no active file refers to a deleted path
   - no package points at a deleted workspace
   - no Compose service points at a deleted image or mount

Do not merge until one independent P0/P1 review is green.

### Wave E: final signed candidate and production promotion

Serial heavy lane; one mutating agent only.

1. Normal-merge the cleanup PR.
2. Wait for exact-main verify and secret scan.
3. Run the official signed release. No ad-hoc builds.
4. Verify schema-v2 manifest, all image digests, SBOMs, OpenVEX, provenance, anonymous pulls, UID, egress, and capacity.
5. Capture one final pre-clean rollback set.
6. Promote on `76.13.209.160` with no DNS change.
7. Run authenticated production acceptance:
   - live/ready/root auth
   - Graphify projects/status/overview
   - duplicate refresh idempotency
   - job success
   - stable ready and quiescence
   - valid graph with unique nodes/edges, no self/dangling edges
   - UID 10001, no host port, internal network, blocked egress
   - chat, attachments, workbench, Files, channel, and current Wave 1 surfaces
8. Observe for the exact Phase 0 duration and thresholds. Do not purge rollback material before this passes.
9. Atomically publish `eradication/LIFECYCLE_TRANSITION.json`, signed by the release
   and independent verification agents. It changes records only from:
   - `CURRENT` to `KEEP`
   - `KEEP_UNTIL(<candidate>,<observation-receipt>)` to `DELETE`
   - never directly from `REVIEW` to `DELETE`
10. The transition names the final current release, current Graphify volume, current
    DB, final evidence, active secrets/config, and final four image digests as `KEEP`.

### Wave F: serial production and remote eradication

This phase is destructive. Use exactly one agent and the frozen `DELETE.json`.

Use a reviewed manifest executor, not handwritten bulk commands. The executor accepts
one immutable record at a time and must:

1. verify the Phase 0 signatures and collection-plan hash, then verify the triple-
   signed Universe Freeze chain and its schema/universe/KEEP/DELETE/REVIEW/dependency-
   proof hashes
2. perform `lstat` plus resolved-path containment for files and reject symlinks,
   reparse points, mount escapes, parent/root/home targets, globs, and identity drift
3. revalidate Docker/provider IDs, labels, hashes, owner, and zero references
4. fence only the exact units/processes named in the record and prove the fence
5. write a signed before receipt
6. execute the one target-specific deletion with a bounded timeout
7. write a signed after/absence/bytes-recovered receipt
8. unfence only the named current units when the record requires it
9. stop the entire lane after any mismatch or partial failure

The executor never accepts a directory list, wildcard, parent target, global prune,
or a second target after failure. Every target defines its exact fence/unfence commands
and whether it has a recoverable quarantine step. Irrecoverable deletion requires the
signed `DELETE` state and current lifecycle-transition receipt.

Order:

1. Fence all background jobs that might recreate legacy artifacts.
2. Recheck every target identity and zero-reference proof at action time.
3. Delete superseded containers, then networks, then volumes, then images by full ID.
4. Delete exact superseded release/config/rollback/backup/evidence directories.
5. Delete exact obsolete previews and static files.
6. Remove obsolete environment keys, systemd units, cron entries, and Caddy fragments.
7. Delete the exact obsolete off-cell ciphertext objects and `.codex` mirrors.
8. Delete exact GitHub Actions artifacts/caches and superseded GHCR manifests where the provider permits it.
9. Remove inactive local worktrees through `git worktree remove` only after clean/merged proof, then delete their branches normally.
10. Handle `187.52.115.7` only through a separate owner-signed provider action packet.
    It must name the provider account, instance/server ID, plan/order ID, current IP,
    SSH host-key fingerprint, exact contained `lstat`/realpath targets, KEEP exclusions,
    zero-production/DNS proof, backup disposition, exact provider cancellation action,
    expected billing effect, and before/after provider receipts. Never target `/`, a
    home directory, `/srv`, or another parent. If any identity or provider field is
    unavailable, leave the host in `REVIEW` and stop.
11. Rerun the complete negative inventory after every group.

Do not delete the final current release, current Graphify volume, current DB, current secrets, current source checkout, final acceptance evidence, or unrelated provider objects.

### Wave G: execute the Phase 0 history/provider mode

A normal deletion commit removes files from current main but preserves them in Git history. The requirement “not saved anywhere” cannot be truthfully claimed without addressing history, clones, PR refs, artifacts, packages, backups, and transparency logs. The mode was already selected in Phase 0; do not choose it here.

The dumb agent must stop and produce one exact hard-erasure packet containing:

- path and blob IDs to erase
- branches/tags containing them
- clone/worktree owners
- GitHub PR refs that cannot be deleted by ordinary Git operations
- signed releases/attestations whose transparency records are permanent
- blast radius to downstream branches and deployed release provenance
- replacement repository option if GitHub cannot remove hidden refs

Execute only the preselected mode:

1. **Clean-current-tree mode:** keep published history; the inventory universe excludes
   immutable history content, and the acceptance phrase must say it remains.
2. **Hard-erasure mode:** create a new clean repository from the final tree, rotate
   secrets and deploy keys, repoint automation, delete the old repository (archiving
   is not erasure) and
   packages, remove all enumerated clones/worktrees/backups, and stop as `INCOMPLETE`
   if any provider PR ref, cache, fork, clone, package, or recoverable object remains.
   Third-party transparency hashes/metadata that cannot be erased are explicitly listed
   as permanent external records; content erasure must still be proven.

Do not use force-push as a casual cleanup mechanism. A new clean repository is easier to verify than a partial history rewrite.

### Wave H: final proof and self-cleanup

The final agent must produce:

- exact final main SHA
- exact production image digests
- complete KEEP/DELETE/REVIEW counts with REVIEW = 0
- zero-residue receipts for repository, workstation, original VPS, unused VPS, OneDrive, GitHub, GHCR, previews, containers, networks, volumes, images, processes, systemd, cron, and Caddy
- proof that current user data and unrelated services still exist
- authenticated production smoke and observation receipts
- DNS proof for `76.13.209.160`
- one current product spec, one current runbook, one current status document
- no deprecated skills, obsolete plans, old flow definitions, or legacy process scripts

Detailed signed inventory and deletion evidence is retained encrypted and access-
controlled for the Phase 0 retention period. It is never destroyed merely to make a
zero-residue claim. Public output contains compact hashes and zero counts only.

Every receipt conforms to a committed schema and includes schema version, signer,
timestamp, exact command/executor version, subject identity, before/after snapshot,
result, evidence hashes, and independent-verifier signature.

Then delete only temporary working copies:

- unencrypted temporary manifest working copies after the signed encrypted evidence copy is verified
- this handover document
- all cleanup worktrees and branches
- all temporary previews and diagnostic resources

Keep only a compact final acceptance receipt containing final SHA/digests, zero counts, and proof hashes.

## 6. Merge and concurrency rules

- Parallelize read-only inventory freely.
- Parallelize source edits only according to the committed path-owner matrix.
- Never run two VPS, Docker, OneDrive, DNS, GitHub-package, or history mutators concurrently.
- The production heavy lane is exclusive.
- The cleanup heavy lane is exclusive.
- The Git-history/provider erasure lane is exclusive.
- Each mutating lane must receive a fresh zero-reference handoff immediately before action.
- At most one integration agent may edit shared hot files.

## 7. Required stop conditions

Stop immediately when:

- a delete target differs from its manifest identity
- a target gains a process, container, manifest, rollback, or user-data reference
- current Graphify or production health is not green
- DNS differs from `76.13.209.160`
- a backup or final acceptance receipt fails its hash
- a branch/worktree is dirty or unmerged
- a `DELETE` target or content inside the selected Phase 0 universe remains recoverable
  from a provider; in clean-current-tree mode, enumerated out-of-scope Git history and
  immutable transparency metadata are allowed only when named in the signed receipt
- the final candidate is not signed from exact main
- any P0/P1 review finding remains open
- Phase 0 erasure mode or inventory universe is absent/stale
- schema validation or mechanical set equality fails
- a lifecycle record lacks the signed `KEEP_UNTIL -> DELETE` transition
- the manifest executor cannot prove containment, identity, fence, or absence

Do not choose another deletion target automatically after a failed target.

## 8. Final acceptance phrase

The job is complete only when the release owner can state, with receipts:

> Frank is fully deployed on the original production VPS at exact SHA `<sha>`. The current Graphify implementation is the only CodeGraph path. Every item in the frozen legacy manifest is absent from the inventory universe selected by Phase 0 erasure mode `<mode>`. REVIEW is zero, production smoke is green, DNS is unchanged, signed encrypted audit evidence is retained for `<retention>`, and no cleanup lane remains active. `<clean-current-tree mode only: Published Git history and immutable transparency metadata remain outside the erasure scope.>`

Anything less is `NOT COMPLETE`.
