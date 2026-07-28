# Environments

Six environment definitions, one per environment named in FRANK-§16.4. Each is a YAML
document validated against [`schema.json`](./schema.json) (`schema://frank.environment/v1`)
by [`tools/lint/validate-environments.mjs`](../../tools/lint/validate-environments.mjs),
which runs in `pnpm verify` and in CI.

```
pnpm env:validate
```

None of these environments exists yet. Slice 0 produces definitions and manifests; no
service runs. See [Why this is a Slice 0 deliverable](#why-an-environment-definition-is-a-slice-0-deliverable)
below.

| File | Environment |
|---|---|
| [`local.env.yaml`](./local.env.yaml) | Local developer stack |
| [`integration.env.yaml`](./integration.env.yaml) | Continuous integration and contract verification |
| [`preview.env.yaml`](./preview.env.yaml) | Expiring per-change preview |
| [`staging.env.yaml`](./staging.env.yaml) | Production-shaped release rehearsal |
| [`production.env.yaml`](./production.env.yaml) | FRANK production cell |
| [`recovery.env.yaml`](./recovery.env.yaml) | Warm recovery cell |

---

## Comparison

Rows are the schema fields; columns are the six environments.

| | **local** | **integration** | **preview** | **staging** | **production** | **recovery** |
|---|---|---|---|---|---|---|
| **Purpose** (§16.4) | Reproducible dev stack, synthetic fixtures | Automated service and connector contracts; builds the signed artifact | One expiring environment per change | Production-shaped release rehearsal and migration verification | `frank.fail`, immutable artifacts, controlled promotion | Isolated restoration target with no outbound side effects |
| **Status** (gate 7) | defined | defined | defined | **defined, not a stub** | defined | **defined, not a stub** |
| **Topology** (§16.1) | Developer workstation | Ephemeral CI runner | Execution and preview worker | Control-plane cell | Control-plane cell | Warm recovery cell |
| **Provider account** | Developer-owned | CI provider | Sandbox provider | VPS provider | VPS provider | **Independent recovery provider** |
| **Services present** (§16.2, of 24) | 9 | 8 | 9 | 19 | 22 | 14 |
| **Notable absences** | Untrusted execution, OpenBao, preview hosting | Untrusted execution, Buzz, OpenBao, dashboards | Buzz, projections, OpenBao, operator overlay | Preview hosting | Preview hosting | Preview hosting, untrusted execution, evals |
| **Data ceiling** (§2.3) | `internal` | `internal` | `internal` | `internal` | **`sensitive`** | **`sensitive`** |
| **May hold `private`** | no | no | no | no | **yes** | **yes** |
| **May hold `sensitive`** | no | no | no | no | **yes** | **yes** |
| **Data origin** | Synthetic fixtures | Synthetic fixtures | **Synthetic fixtures only** (§16.4) | Sanitized synthetic, production-shaped | Real owner data | Restored production backup |
| **Registrable domain** (§16.3) | `localhost` | internal | **`SANDBOX_BASE_DOMAIN`** — never a child of `frank.fail` | `frank.fail` | `frank.fail` | `frank.fail` |
| **Hostnames** | `*.frank.localhost` | `*.integration.internal` | `*.preview.SANDBOX_BASE_DOMAIN` | `*.staging.frank.fail` | `frank.fail`, `api.`, `auth.`, `rooms.`, `hooks.`, `status.` | The production names, pre-provisioned, plus `recovery.frank.fail` |
| **Public DNS / access** | no / loopback | no / none | yes / expiring auth | yes / authenticated only | yes / authenticated only | pre-provisioned, not pointed / **none until fenced** |
| **Isolated from production** | all six axes | all six axes | **all six axes** — cookies, service workers, credentials, networks, storage, identity audience | all six axes | n/a | credentials and networks only (it must serve production's names after failover) |
| **Egress** | Unrestricted developer | Allowlist | **Policy proxy, default deny** | Allowlist | Allowlist | **Policy proxy, default deny** |
| **Real external side effects** (§16.4) | no — sandboxed doubles | no — sandboxed doubles | no — contained | no — contained | **yes — the only one** | no — contained until reconciled |
| **Secret source** (§15.3) | age/SOPS file | CI OIDC, short-lived | Expiring per-preview issuer | OpenBao, own root and KMS key | OpenBao, KMS in the independent account | OpenBao recovery path, KMS + offline shares |
| **Backup posture** (§16.7) | none — disposable | Artifacts only | none — disposable | Pre-change snapshot, restore-tested per release | **Continuous WAL + encrypted off-cell; RPO 5 min; monthly isolated restore, quarterly full-cell** | **Restore target; quarterly full-cell exercise** |
| **Promotes from** | working tree | signed source commit | integration | integration (artifact), preview (evidence) | **staging** (+ recovery on failback) | production |
| **Promotes to** | — | preview, staging | staging | **production** | recovery (pre-staged images; + production on failback) | production (failback) |
| **Artifact role** (§18.2, §18.4) | none | **builds and signs** | runs the pinned digest | **release evidence anchor** | **consumes the pinned staging digest; rebuild forbidden** | pre-stages the same digest |
| **Lifetime** | on demand | ephemeral per run | **ephemeral per change, 14-day TTL** (§16.8) | permanent | permanent | standing warm |
| **Disposable** (§21 W2) | yes | yes | **yes** | no (rebuildable) | no (rebuildable) | **yes** |
| **Destruction rule** | `compose down --volumes`; no evidence needed | Discarded at run end; artifacts and evidence survive | Auto-destroy at TTL, merge, or abandon; failed sandboxes within 48 h of evidence collection | Signed inventory then destruction manifest; blocked while a release is in flight | §16.3.1 steps 10–12: 14-day read-only rollback window, restore verified, full destruction manifest | Blocked until production is confirmed sole write authority and reconciliation is clean; KMS key retired by seal migration |
| **Resources** (§16.6) | Whatever the machine has | Runner; ≤2 heavy / 6 light jobs | Worker quota; ≤2 heavy / 6 light jobs | Full reference profile: 8 vCPU / 64 GB / 400 GB | Full reference profile: 8 vCPU / 64 GB / 400 GB | Full reference profile: 8 vCPU / 64 GB / 400 GB |

Both resource tables — the FRANK-§16.6 memory envelopes and disk quotas — are checked
arithmetically by the validator: envelopes plus the 8 GB OS reserve must equal 64 GB, and
the quotas must sum to 400 GB. Drift in either fails the build.

---

## The promotion path

```
working tree ─▶ local

source commit ─▶ integration ──▶ preview ──▶ staging ──▶ production ──▶ recovery
                 (build once,     (review)   (evidence    (pinned       (pre-staged
                  sign, SBOM,                 anchor)      digest)       images)
                  provenance)
                                                              ◀── failback ──┘
```

**The digest chain.** FRANK-§18.4 says *build once; promote the same signed artifact*, and
FRANK-§18.2 turns that into a promotion threshold: **Release identity — one artifact digest
from staging evidence through production promotion.** The six definitions make that chain
checkable rather than aspirational:

1. `integration` is the only environment with `artifact.builtHere: true`. It produces the
   signed image, SBOM, and provenance from a source commit.
2. `preview` and `staging` both run that exact digest, with `rebuildForbidden: true`. A
   passing preview journey is therefore evidence about the release, not about a one-off build.
3. `staging` sets `artifact.isReleaseEvidenceAnchor: true`. The digest recorded in its
   immutable evidence pack is the reference value. Exactly one environment may claim this,
   and the validator checks that it is staging.
4. `production` sets `digestSource: staging`,
   `requiresDigestMatchingStagingEvidence: true`, `builtHere: false`, and
   `rebuildForbidden: true`. It cannot promote an artifact staging did not exercise.
5. `recovery` pre-stages the identical digest, because FRANK-§16.1 requires the warm cell to
   hold signed release images for the running version. Failing over onto a different image
   would mean recovering onto software no evidence pack ever exercised.

If any environment were allowed to rebuild, every downstream signature would attest to an
artifact that no evidence pack had run, and the Release-identity threshold would become
unverifiable. The validator's `env-digest-chain` rule fails the build for exactly that.

**What is not artifact promotion.** Two edges in the graph carry something other than a
build. `production → recovery` continuously carries replicated state and the pre-staged
images. `recovery → production` is the failback: after fencing, reconciliation, and a clean
invocation ledger, canonical state is repatriated to a rebuilt production cell. Both edges
are declared at both ends — the validator's `env-promotion-symmetry` rule rejects a
promotion edge that only one side admits to — and neither changes `digestSource`.

**What each hop gates on.** `integration` gates on the FRANK-§18.1 static, unit, contract,
and integration layers plus FRANK-§15.8 supply-chain checks. `staging` gates on preview
journeys passing and the FRANK-§18.2 promotion thresholds. `production` gates on the full
FRANK-§18.3 release gate: critical findings resolved and never waivable; high security,
isolation, authorization, data-loss, integrity, and recovery findings resolved and not
waivable; migrations rehearsed; a confirmed recovery point; an immutable evidence pack.

---

## Why an environment definition is a Slice 0 deliverable

Because an environment's boundaries are only cheap to set before it exists. Every rule
these files encode — previews on a separately owned registrable domain, production as the
only holder of `private` and `sensitive` data, production as the only source of real
external side effects, recovery admitting no traffic until the old writer is fenced, one
artifact digest travelling from staging evidence to production promotion — is a constraint
that is trivial to satisfy while the answer is still a YAML key and expensive to retrofit
once something is running. A preview host that shipped on `preview.frank.fail` cannot be
moved without invalidating every cookie, service worker, and stored credential that was
issued under the shared eTLD+1. A staging cell seeded from a production restore has already
placed `sensitive` data somewhere its controls, retention, and compartment rules were never
designed for, and FRANK-§2.3 offers no way to un-inherit that class. A recovery cell built
in the production provider account does not survive the failure it was built for, and you
learn that during the incident. These are not configuration details discovered during
deployment; they are the decisions deployment will be judged against, and Slice 0 is where
they get written down, given a schema, and made to fail a build when violated. The exit gate
asks for six real definitions rather than six placeholders for the same reason the
requirement registry asks for owners: an unwritten constraint is not a constraint, and a
constraint no tool checks is a comment.
