# FRANK GitHub Repository Audit and Exact Update Plan

**Repository:** `stevenshelley58-afk/frank`  
**Audited commit:** `fc255180df7c4bed4db151f12d48f23ba67f1a2d`  
**Audit date:** 29 July 2026  
**Controlling specification:** `FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`, version 1.1  
**Audience:** A coding agent with no previous FRANK context  
**Decision:** Correct and harden the repository before adding more product features. Keep the existing core architecture; do not rewrite it.

---

## 1. Executive verdict

The repository is a good foundation, but it is not yet safe to treat as fully synchronized, continuously verified, or production-composable.

The following parts are already strong and must be preserved:

- PostgreSQL is canonical and the transactional outbox is in the same transaction boundary.
- Data-class, cell-scope, identity, action-envelope, policy, audit-chain, exact-money, idempotency, and provenance contracts are explicit.
- The domain API and storage adapter have meaningful tests and narrow dependency boundaries.
- Fast-moving providers are already intended to sit behind ports.
- The current design can accept the revised Buzz and MCP decisions without redesigning the canonical data model.

The mandatory corrections are:

1. Put specification version 1.1 in the repository.
2. Repair the requirement-registry generator so it discovers every normative requirement table, including `MCP-001` through `MCP-010`.
3. Synchronize ADR-008, ADR-011, the architecture overview, and repository status text.
4. Add real GitHub checks and protect `main`.
5. Replace placeholder lint commands with real checks.
6. Make PostgreSQL integration tests mandatory in CI rather than silently skipped.
7. Make non-development startup fail closed when production identity, signing, and replay protection are not configured.
8. Make `pnpm build` produce runnable output and prove that the API can start.
9. Land the stable Buzz and MCP boundary contracts before building either integration.
10. Remove the unexplained `.probe-push-files` artifact.

This is a synchronization and hardening pass, not a core rewrite.

---

## 2. Evidence from the audited commit

### 2.1 Repository state

- Default branch: `main`
- Audited head: `fc255180df7c4bed4db151f12d48f23ba67f1a2d`
- Open pull requests: none
- Open issues: none
- GitHub Actions runs: none
- Branch protection on `main`: absent
- `.github/` directory: absent
- `.codegraph/` directory: absent

### 2.2 Checks run during the audit

The repository requires Node `22.11.0` and pnpm `10.28.0`. The audit machine had Node `26.2.0`, so dependencies were installed with the engine check overridden only for read-only inspection:

```powershell
pnpm --config.engine-strict=false install --frozen-lockfile
node tools/lint/dependency-direction.mjs
node tools/registry/validate-contracts.mjs
node tools/lint/validate-environments.mjs
pnpm --config.engine-strict=false exec turbo run typecheck lint test
```

Observed result:

- 426 tests passed.
- 0 executed tests failed.
- 103 PostgreSQL-backed tests were skipped because no test database URL was present.
- Type checking passed.
- Dependency-direction, contract, and environment checks passed.
- The committed registry check could not run correctly because the controlling specification is missing from the repository.
- Package `lint` commands passed only because they are `echo` placeholders.

These results show that the implemented domain slice is healthy, but they are not a substitute for an official Node 22.11 CI run with PostgreSQL.

### 2.3 Registry defect reproduced

When the existing generator was pointed at specification version 1.1, it found:

- five new Buzz requirements: `BUZZ-008` through `BUZZ-012`;
- two new section locators: `FRANK-§0.3` and `FRANK-§8.2.1`;
- none of `MCP-001` through `MCP-010`.

Cause: `tools/registry/generate-registry.mjs` only accepts requirement rows while the current top-level section number is `4`.

After the parser is corrected, the expected registry is:

- 127 requirement records;
- 162 section records;
- 289 total records;
- 17 new records needing explicit stewardship: five Buzz requirements, ten MCP requirements, and two section locators.

Do not hard-code those totals into the generator. Use them only as a one-time reconciliation check for specification version 1.1.

---

## 3. Severity-ranked findings

| Severity | Finding | Repository evidence | Required result |
|---|---|---|---|
| Critical | The repository points to a controlling specification that is not committed. | `README.md` and `docs/product/README.md` name `docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`; the file does not exist. | Commit specification version 1.1 and make every authority link repository-relative. |
| High | The registry silently omits requirements outside §4. | `tools/registry/generate-registry.mjs` restricts parsing to `REQUIREMENT_SECTION = '4'`. | Discover any correctly headed normative requirement table, including §8.2.1. |
| High | The README claims CI enforcement, but the repository has no workflow or protected branch. | No `.github/`, no Actions runs, unprotected `main`. | Required GitHub checks run on pull requests and `main`; direct unsafe merges are blocked. |
| High | The normal server composition can use development identity, an in-memory key resolver, and an in-memory nonce ledger in a production-labelled environment. | Defaults in `apps/api/src/server.ts`; `apps/api/src/main.ts` injects none of the durable alternatives. | Non-development startup refuses local/in-memory security composition. |
| High | Database integration tests silently skip in ordinary test runs. | `describe.skipIf` depends on `FRANK_TEST_DATABASE_URL`; no CI supplies it. | A dedicated CI job runs all database tests and fails if they try to skip. |
| High | Lint success is not real lint success. | Every workspace package uses an `echo` command for `lint`. | Real static style and correctness checks run locally and in CI. |
| High | The controlling architecture text predates the final Buzz and MCP decisions. | ADR-008, ADR-011, and `docs/architecture/overview.md` describe earlier boundaries. | Documentation matches specification version 1.1 and does not overstate implementation. |
| Medium | `pnpm build` has no package build tasks, and the API entry point states it cannot be started. | `turbo.json` declares build output; package scripts do not build; `apps/api/src/main.ts` documents the gap. | A reproducible build creates runnable API output and a smoke test proves startup. |
| Medium | Buzz and MCP are not implemented, which is acceptable, but their stable boundary contracts are also absent. | No Buzz adapter, Capability Broker, or relevant schemas exist. | Add versioned schemas, examples, types, and conformance fixtures before integration code. |
| Low | An unexplained probe file is tracked. | `.probe-push-files` contains only `probe`. | Remove it. |

---

## 4. Locked architectural decisions

The implementing agent must not reconsider these unless new evidence proves a direct conflict and an ADR records the decision.

### 4.1 FRANK owns durable truth

FRANK owns:

- canonical personal and build records;
- durable runs, schedules, retries, pending input, and completion;
- identity bindings, policy decisions, approvals, action envelopes, and receipts;
- secrets and credential handles;
- evidence and externally anchored audit;
- customer-cell isolation.

PostgreSQL and object storage remain canonical. Temporal remains the durable workflow implementation behind `WorkflowPort`.

### 4.2 Buzz is strategic but bounded

Use the maintained Buzz project for private rooms, signed Nostr collaboration events, clients, ACP presentation and steering, agent and CLI tooling, Git-event direction, Compose/Helm deployment assets, and reversible room-local workflow actions.

Do not make Buzz the canonical personal/build database, durable scheduler, policy authority, secret store, release authority, or only audit record.

Production Buzz is pinned to a tested immutable commit or image. A separate synthetic-data canary follows upstream `main` and runs compatibility, migration, security, and recovery checks. Do not fork the Buzz UI or relay merely to make it look like FRANK.

### 4.3 MCP 2026-07-28 belongs at one broker boundary

The FRANK Capability Broker is the sole managed MCP client/host. Harnesses do not connect directly to arbitrary MCP servers.

Use the stateless 2026-07-28 edge:

- no hidden transport session as workflow state;
- no sticky routing;
- validate protocol, method, name, body, `_meta`, and authenticated identity together;
- map Multi Round-Trip input to a durable FRANK Input Request;
- link every MCP Task to a canonical FRANK Run before exposing its handle;
- sandbox MCP Apps on an isolated origin;
- bind OAuth/OIDC credentials to verified issuer and audience;
- keep deprecated behavior in an instrumented compatibility adapter with an owner and removal date.

---

## 5. Rules for the implementing agent

1. Start from the exact audited commit or first record why the head changed.
2. Work on `chore/sync-spec-1.1-buzz-mcp`.
3. Make small commits in the order in section 6.
4. Do not delete or weaken existing contract, policy, identity, database, or API tests.
5. Do not rename existing canonical records merely for style.
6. Do not add a direct provider SDK to domain packages.
7. Do not add direct MCP access to a harness.
8. Do not write a replacement Buzz client, room system, relay, ACP adapter, or Git-event system.
9. Do not claim Buzz or MCP integration works when only contracts or stubs exist.
10. Do not store secrets, `.env` files, databases, generated build output, `node_modules`, or local agent state in Git.
11. Do not bypass a failing deterministic check because an AI reviewer says the code looks correct.
12. Do not update unrelated dependencies.
13. Pin every new tool or dependency exactly.
14. Preserve compatibility or add a migration and rollback note.
15. Every new requirement row must have owner, implementation, test, evidence, and honest status.

---

## 6. Exact work order

Complete the following work in order. Do not start feature development between these commits.

### Commit 1 — Import the controlling authority

**Commit message**

```text
docs: import FRANK specification 1.1
```

**Create**

- `docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`
- `docs/product/FRANK_BUZZ_MCP_EXISTING_BUILD_UPDATE_PLAN.md`
- `docs/product/FRANK_GITHUB_REPOSITORY_UPDATE_PLAN.md`

Use these exact source documents from the planning workspace:

- `outputs/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`
- `outputs/FRANK_BUZZ_MCP_EXISTING_BUILD_UPDATE_PLAN.md`
- `outputs/FRANK_GITHUB_REPOSITORY_UPDATE_PLAN.md`

Copy the controlling specification without rewording its architectural decisions. Copy this GitHub repository plan as the exact correction handoff.

The older `FRANK_BUZZ_MCP_EXISTING_BUILD_UPDATE_PLAN.md` was written when the workspace contained only the clickable concept. Before committing it:

1. preserve its locked Buzz/MCP/FRANK decisions and real-application implementation rules;
2. replace its “current repository truth” with section 2 of this audit;
3. move prototype-only instructions into a clearly labelled historical/mockup appendix or remove them if the prototype is not being imported into this repository;
4. point its repository-correction work order to `FRANK_GITHUB_REPOSITORY_UPDATE_PLAN.md`;
5. do not leave statements saying there is no backend, PostgreSQL schema, API, CI definition, or infrastructure when those items now exist.

**Update**

- `README.md`
- `docs/product/README.md`

Required edits:

1. State that the repository contains the canonical specification version 1.1.
2. Replace `/root/.claude/uploads/...` and `/home/claude/...` with repository-relative links.
3. Do not reference nonexistent documents as if they exist.
4. Change the status statement so it truthfully says that the first durable data/API slice exists, while web, brokers, workflow workers, Buzz, and MCP integrations remain unimplemented.
5. Remove the claim that CI enforces gates until Commit 5 adds CI, or phrase it as the intended merge gate.
6. Keep the documented authority order.
7. Update product documentation to explain that an accepted ADR may receive a recorded amendment when a later controlling specification explicitly changes that same ADR. Never silently rewrite history.

**Delete**

- `.probe-push-files`

**Checks**

```powershell
Test-Path docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md
Test-Path docs/product/FRANK_BUZZ_MCP_EXISTING_BUILD_UPDATE_PLAN.md
Test-Path docs/product/FRANK_GITHUB_REPOSITORY_UPDATE_PLAN.md
rg -n "/root/|/home/claude|\\.probe-push-files" README.md docs
```

Expected:

- all three `Test-Path` calls return `True`;
- the search returns no stale machine-specific authority path;
- `.probe-push-files` is absent.

**Done condition**

A contributor cloning only the GitHub repository can identify and open every controlling document.

---

### Commit 2 — Repair and test requirement discovery

**Commit message**

```text
fix(registry): discover normative requirement tables
```

**Update**

- `tools/registry/generate-registry.mjs`

**Create**

- `tools/registry/generate-registry.test.mjs`
- `tools/registry/fixtures/requirements-across-sections.md`
- `tools/registry/fixtures/requirements-in-code-fence.md`
- `tools/registry/fixtures/malformed-requirement-tables.md`

If the repository prefers TypeScript tests for tools, a `.test.ts` file is acceptable, but it must run in `pnpm verify`.

**Parser behavior**

Replace the §4-only rule with table-shape discovery:

1. Continue ignoring fenced code.
2. Track numbered `##` and `###` headings as now.
3. Treat a table as a normative requirement table only when its normalized header is exactly:

   ```text
   ID | Requirement | Acceptance evidence
   ```

4. Require the following row to be a valid Markdown separator row.
5. Parse subsequent three-cell rows until the table ends.
6. Accept only IDs matching the existing requirement-ID pattern.
7. Set `sourceSection` to the nearest numbered heading.
8. Preserve duplicate-ID warnings and first-record-wins behavior.
9. Do not parse a matching-looking table without a numbered normative section.
10. Do not parse examples inside code fences.
11. Remove the `REQUIREMENT_SECTION = '4'` restriction and update all comments/error messages that describe §4-only behavior.
12. Export or isolate the parser enough for direct unit testing without invoking `process.exit`.

**Required tests**

- Discovers `ABC-001` under §4.
- Discovers `MCP-001` under §8.2.1.
- Discovers two different prefixes in different normative sections.
- Ignores the same table inside a code fence.
- Ignores malformed separator rows.
- Ignores two-cell and four-cell rows.
- Ignores invalid IDs.
- Warns once for duplicate IDs and retains the first.
- Preserves the nearest numbered section locator.
- Produces a clear error when zero requirement rows exist.

**Add a package script**

In root `package.json`:

```json
"registry:test": "node --test tools/registry/generate-registry.test.mjs"
```

Add `pnpm run registry:test` before `registry:check` in `verify`.

**Regenerate**

```powershell
pnpm run registry:test
pnpm run registry:generate
```

Inspect `docs/requirements/registry.json`.

For specification version 1.1, confirm:

- `MCP-001` through `MCP-010` exist exactly once;
- `BUZZ-008` through `BUZZ-012` exist exactly once;
- `FRANK-§0.3` and `FRANK-§8.2.1` exist exactly once;
- 127 records have `kind: "requirement"`;
- 162 records have `kind: "section"`;
- 289 records exist in total.

Assign the 17 new records:

| Records | Owner | Initial status | Implementation link | Test/evidence |
|---|---|---|---|---|
| `BUZZ-008`–`BUZZ-012` | Collaboration platform owner | `specified` | ADR-011 and the Buzz boundary contracts added in Commit 8 | Buzz conformance plan and contract tests |
| `MCP-001`–`MCP-010` | Capability Broker owner | `specified` | ADR-008 and the MCP boundary contracts added in Commit 9 | MCP conformance plan and contract tests |
| `FRANK-§0.3` | Product architecture owner | `documented` | specification 1.1 reconciliation | registry drift test |
| `FRANK-§8.2.1` | Capability Broker owner | `specified` | ADR-008 and MCP contracts | MCP conformance plan |

Use the repository’s existing owner naming convention. If an individual team member is not defined, use stable role names, not invented people.

Do not mark the Buzz or MCP requirements `done`. The code does not implement them yet.

**Checks**

```powershell
pnpm run registry:test
pnpm run registry:check
```

**Done condition**

The generator discovers requirements by normative table shape, the committed registry matches version 1.1, and no record is unowned.

---

### Commit 3 — Reconcile ADRs and architecture

**Commit message**

```text
docs(architecture): reconcile Buzz and MCP decisions
```

**Update**

- `docs/adr/ADR-008-acp-mcp-protocols.md`
- `docs/adr/ADR-011-buzz-collaboration.md`
- `docs/adr/README.md`
- `docs/architecture/overview.md`
- any other file found by:

  ```powershell
  rg -n "specification v1\\.0|Buzz is a collaboration relay|optional room provider|never creates or schedules|MCP for tools|Slice 0 in progress|No services are running"
  ```

**ADR-008 required decision**

Title:

```text
ADR-008 — ACP for harness sessions; MCP 2026-07-28 for tools, Apps, Tasks and input
```

Record:

- original acceptance date: 28 July 2026;
- decision revision: 2;
- amended date: 29 July 2026;
- amended by specification version 1.1;
- previous decision summarized in a history section.

The current decision must say:

- ACP governs client-to-agent session control.
- MCP 2026-07-28 is the preferred tool edge.
- The Capability Broker is the sole managed MCP boundary.
- MCP transport state cannot replace FRANK workflow state.
- Multi Round-Trip input, Tasks, Apps, caching, and issuer-bound auth follow §8.2.1.
- A2A remains optional at explicit system boundaries only.
- Claude support is capability-probed per surface rather than inferred from an announcement.

**ADR-011 required decision**

Title:

```text
ADR-011 — Buzz is the strategic collaboration workspace and bounded agent mesh
```

Record the same revision and history fields as ADR-008.

The current decision must say:

- FRANK reuses maintained Buzz relay, clients, ACP, agent, CLI, workflow, Git-event, Compose, and Helm work when it passes conformance.
- A small `frank-buzz` boundary maps identity, rooms, assignments, projections, grants, and receipts.
- Buzz can carry bounded work and room-local reversible actions.
- FRANK retains canonical records, durable scheduling, policy, secrets, consequential effect authority, evidence, and external audit anchoring.
- Production is pinned; an isolated canary follows upstream `main`.
- Buzz content on the private server is server-readable unless proven compatible end-to-end encryption is later adopted.

**Architecture overview required changes**

1. Replace “Buzz is a collaboration relay” with the strategic-but-bounded decision.
2. Add MCP 2026-07-28 details to the Capability Broker row.
3. Mark implementation states honestly:
   - API and canonical PostgreSQL adapter: implemented foundation;
   - brokers, Temporal workers, web client, Buzz adapter, and MCP broker: specified or not implemented;
   - do not describe planned directory names as existing services.
4. Separate “contract status” from “implementation status” in tables.
5. Keep one clear authority diagram:

   ```text
   Harness/ACP → FRANK Harness Broker
                        ↓
               FRANK Capability Broker → MCP servers
                        ↓
               Action boundary and receipts

   Buzz rooms/agents ↔ frank-buzz boundary ↔ FRANK Runs/Commands
   PostgreSQL/Object storage/Temporal remain authoritative
   ```

**Checks**

```powershell
rg -n "specification v1\\.0|optional room provider|never creates or schedules work independently|Buzz is a collaboration relay, never canonical state" README.md docs
pnpm run registry:check
```

Expected: no stale controlling statement remains. Historical text is allowed only under an explicitly labelled previous-decision section.

**Done condition**

The spec, ADRs, architecture overview, registry, and README agree on Buzz, MCP, and current implementation status.

---

### Commit 4 — Add real lint and format gates

**Commit message**

```text
build: replace placeholder lint gates
```

Use one pinned repository-wide toolchain. Prefer Biome for this repository because it can replace every placeholder with one fast configuration and avoids a larger ESLint plugin graph. If the repository already acquires an established lint stack before this work begins, keep that stack instead of adding a second one.

**If using Biome**

**Update**

- root `package.json`
- all workspace `package.json` files containing placeholder `lint` scripts

**Create**

- `biome.json`

Pin the current selected Biome version exactly in `devDependencies`. Do not use a version range.

Root scripts:

```json
"lint": "biome lint .",
"format:check": "biome format .",
"format": "biome format --write ."
```

Workspace packages may remove their fake `lint` script if root lint owns the repository, or replace it with a real scoped Biome command. Do not retain an `echo` lint command.

Update `verify` so `format:check` and `lint` are explicit gates. Do not rely on Turbo reporting a placeholder task as successful.

Configuration requirements:

- inspect TypeScript, JavaScript, JSON, and supported configuration files;
- ignore `node_modules`, `dist`, coverage, Turbo output, local state, and generated registry output only if formatting it would make generation unstable;
- reject unused imports and obvious correctness errors;
- keep existing intentional type-only imports;
- do not perform broad semantic rewrites.

Run the formatter once, inspect the diff, and separate pure formatting from semantic changes. If formatting creates a large diff, commit it separately immediately before the lint commit.

**Checks**

```powershell
pnpm run format:check
pnpm run lint
rg -n "\"lint\"\\s*:\\s*\"echo" -g package.json
```

Expected: checks pass and the final search returns nothing.

**Done condition**

Lint and formatting failures produce a non-zero exit code locally and in CI.

---

### Commit 5 — Add GitHub verification and protected delivery

**Commit message**

```text
ci: verify contracts code and PostgreSQL behavior
```

**Create**

- `.github/workflows/verify.yml`
- `docs/runbooks/ci.md`

**Workflow triggers**

- every pull request;
- pushes to `main`;
- manual dispatch.

**Permissions**

Use read-only repository contents by default:

```yaml
permissions:
  contents: read
```

Do not give the workflow production secrets or deployment permission.

**Toolchain**

- Node `22.11.0`
- pnpm `10.28.0`
- frozen lockfile
- pnpm cache through the supported Node setup

**Job 1: `static-and-unit`**

Steps:

1. checkout;
2. install exact Node and pnpm versions;
3. `pnpm install --frozen-lockfile`;
4. `pnpm run verify`.

At this point `verify` must cover:

- dependency direction;
- contract examples;
- environment definitions;
- registry parser tests;
- registry drift and ownership;
- formatting;
- real lint;
- type checking;
- non-database unit/contract tests.

**Job 2: `postgres-integration`**

Use a service container:

```text
pgvector/pgvector:0.8.0-pg17
```

Create two isolated test databases because the API integration suite derives or accepts its own database:

- `frank_test`
- `frank_api_test`

Set:

```text
FRANK_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/frank_test
FRANK_TEST_API_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/frank_api_test
FRANK_REQUIRE_INTEGRATION=1
```

Update:

- `adapters/storage/postgres/src/integration/harness.ts`
- `apps/api/src/test/slice1.integration.test.ts`
- related test configuration as needed

Behavior:

- local runs may still skip database suites when no URL is configured;
- if `FRANK_REQUIRE_INTEGRATION=1`, an absent/unreachable database or an attempted integration skip is a failing test, not a skip;
- CI logs must clearly list the executed database suites.

Run the storage adapter and API suites with their existing package filters rather than running unrelated jobs twice.

**Job 3: `compose-validate`**

Run configuration-only checks that do not need production secrets:

- repository environment validator;
- `docker compose config` using safe CI-only placeholder values or the repository’s supported example-to-CI mechanism;
- image references remain pinned according to repository policy.

Do not start the full production-shaped Compose stack in this job.

**Branch protection**

After the workflow has one successful run:

1. Protect `main`.
2. Require pull requests.
3. Require `static-and-unit`, `postgres-integration`, and `compose-validate`.
4. Require the branch to be current before merge.
5. Block force pushes and deletion.
6. Do not require a human approval solely to slow Steven down; deterministic gates and the configured review policy are the guard.
7. Record the exact protection settings in `docs/runbooks/ci.md`.

**Checks**

```powershell
pnpm install --frozen-lockfile
pnpm run verify
```

Then inspect the GitHub run and confirm all three named jobs execute.

**Done condition**

The README’s CI claim becomes true, PostgreSQL behavior is actually exercised, and `main` cannot accept a change with a failing required check.

---

### Commit 6 — Fail closed outside development

**Commit message**

```text
fix(api): reject development security composition outside dev
```

The immediate requirement is a safe composition boundary. Concrete Authentik and OpenBao adapters can be built in later work, but production-labelled startup must not silently fall back now.

**Update**

- `apps/api/src/config.ts`
- `apps/api/src/server.ts`
- `apps/api/src/main.ts`
- `packages/identity/src/local-signed-session.ts`
- `packages/policy/src/nonce.ts`

**Create**

- `apps/api/src/composition.ts`
- `apps/api/src/test/production-composition.test.ts`

Use names consistent with the existing codebase if an equivalent composition module already exists when the agent starts.

**Required behavior**

Define explicit runtime classes:

- `development`
- `test`
- `preview`
- `staging`
- `production`
- `recovery`

`development` and `test` may use:

- `LocalSignedSessionProvider`;
- `InMemoryKeyResolver`;
- `InMemorySpentNonceLedger`;
- in-process no-op enrichment.

`preview`, `staging`, `production`, and `recovery` must require explicitly injected or configured:

- non-local OIDC identity provider;
- secret-backed signing/key resolver;
- durable shared nonce ledger;
- non-no-op enrichment only when a route depends on it.

If any required production dependency is missing:

- fail before binding a network port;
- return a non-zero process exit;
- name the missing dependency class without printing a secret;
- do not downgrade to a development implementation.

Do not detect safety by `instanceof` alone across package boundaries. Give adapters a declared capability/composition descriptor such as:

```ts
interface RuntimeSecurityDescriptor {
  identity: "local" | "oidc";
  keyStorage: "memory" | "secret-backed";
  nonceDurability: "process" | "shared-durable";
}
```

Validate the descriptor against the runtime class at startup.

**Required tests**

- development starts with current local defaults;
- test starts with deterministic injected components;
- production plus local identity fails;
- production plus in-memory keys fails;
- production plus in-memory nonce ledger fails;
- production with all three compliant descriptors reaches server construction;
- error output never includes configured key material;
- `main.ts` validates composition before `listen`.

**Important limitation**

Do not mark Authentik, OpenBao signing, or a PostgreSQL nonce ledger implemented merely because test doubles satisfy the descriptor. Create follow-up requirement links for:

- `AuthentikOidcIdentityProvider`;
- OpenBao-backed envelope signing/key resolution;
- `PostgresSpentNonceLedger` using an atomic unique `(cell_id, nonce)` claim.

**Done condition**

No non-development environment can start using local identity, process-only replay protection, or memory-only signing keys.

---

### Commit 7 — Make the API build and start reproducibly

**Commit message**

```text
build(api): produce runnable server artifacts
```

Use the existing TypeScript compiler unless a demonstrated packaging problem requires a bundler. Avoid adding a build framework without need.

**Update**

- root `package.json`
- `turbo.json`
- each buildable workspace package’s `package.json`
- package TypeScript configurations
- `apps/api/src/main.ts`

**Create**

- `apps/api/tsconfig.build.json`
- build configurations for shared packages as needed
- `apps/api/Dockerfile`
- `apps/api/src/test/startup-smoke.test.ts` or a repository-level smoke script

**Required behavior**

1. `pnpm build` creates `dist/**` for packages needed by the API.
2. Package exports resolve built JavaScript and declaration files for production consumption while tests can still resolve source through the chosen test configuration.
3. `@frank/api` exposes:

   ```json
   "start": "node dist/main.js"
   ```

4. Source maps are generated without embedding secrets.
5. The Docker image:
   - uses pinned base image digests;
   - builds with Node 22.11;
   - runs as a non-root user;
   - contains production dependencies and built output only;
   - has no `.env`, test database, source-control metadata, or local state;
   - exposes no port except the configured API port;
   - has a health check compatible with the existing health route.
6. Remove the obsolete “cannot be started yet” comment from `main.ts` and replace it with accurate startup documentation.

**Smoke test**

Use an ephemeral PostgreSQL test service. Start the compiled server with development-only test credentials, wait for the health route, request `/v1/openapi.json`, then shut down cleanly.

Verify:

- compiled code starts, not `tsx` or Vitest source loading;
- SIGTERM drains the server and closes the pool;
- startup without `FRANK_DATABASE_URL` exits non-zero;
- production runtime with development security descriptors exits non-zero.

**Checks**

```powershell
pnpm run build
pnpm run typecheck
pnpm run test
docker build -f apps/api/Dockerfile .
```

**Done condition**

The compiled API and its container are reproducible, runnable, non-root, and protected by the runtime-composition guard.

---

### Commit 8 — Land Buzz boundary contracts without pretending the integration exists

**Commit message**

```text
feat(contracts): define bounded Buzz integration
```

**Create versioned schemas under the existing contract layout**

- `BuzzIdentityBinding`
- `BuzzRoomLink`
- `BuzzEventReference`
- `BuzzIngressCommand`
- `BuzzProjectionCursor`
- `BoundedAssignment`
- `BuzzAssignmentRef`

Use the repository’s existing schema naming, folder, example, and TypeScript-generation conventions. Do not create a competing contract system.

Every applicable schema must carry:

- schema version;
- cell ID;
- immutable FRANK ID;
- Buzz/Nostr reference;
- actor/service identity;
- room and project/run relationship;
- source, correlation, and causation IDs;
- created time;
- data class;
- policy revision;
- idempotency or replay key;
- artifact digest for commands concerning an artifact.

**Create**

- `adapters/collaboration/buzz/README.md`
- `adapters/collaboration/buzz/src/port.ts`
- contract tests and valid/invalid examples
- `infra/buzz/README.md`
- `docs/runbooks/buzz-upstream-canary.md`

The adapter at this commit is a port and package boundary only. It must not contain a fake in-memory relay that can be mistaken for a working integration.

The `BuzzPort` contract may expose:

```ts
interface BuzzPort {
  health(): Promise<BuzzHealth>;
  ensureRoom(link: DesiredRoomLink): Promise<BuzzRoomLink>;
  ensureMember(binding: BuzzIdentityBinding, roomId: string): Promise<void>;
  publishProjection(event: FrankProjectionEvent): Promise<BuzzEventReference>;
  receiveEvents(cursor: BuzzProjectionCursor): AsyncIterable<SignedBuzzEvent>;
  submitAssignment(assignment: BoundedAssignment): Promise<BuzzAssignmentRef>;
  steerAssignment(ref: BuzzAssignmentRef, input: SteeringInput): Promise<void>;
  cancelAssignment(ref: BuzzAssignmentRef): Promise<void>;
  mirrorGitEvent(event: CanonicalGitEvent): Promise<BuzzEventReference>;
}
```

Adjust names only to match established FRANK conventions.

**Document**

- official upstream assets are preferred;
- production pin and image digest;
- separate daily canary against upstream `main`;
- synthetic data only in canary;
- compatibility, migration, signing, membership, backup/restore, rate-limit, ACP, workflow, and Git-reference tests;
- room content is server-readable;
- secrets are prohibited;
- Buzz proposals enter FRANK through signed, idempotent ingress;
- no Buzz event alone is an approval or effect receipt;
- Temporal owns durable work.

**Required contract tests**

- missing or wrong cell;
- invalid schema version;
- forged or absent event reference;
- wrong room/project relationship;
- duplicate replay key;
- stale cursor;
- altered artifact digest;
- command with no policy revision;
- cross-cell assignment reference.

**Registry**

Link `BUZZ-008` through `BUZZ-012` to these contracts and tests, but leave status honest: contracts defined, integration not implemented.

**Done condition**

Future Buzz work has one stable boundary, one upstream strategy, and no invitation to rebuild Buzz inside FRANK.

---

### Commit 9 — Land MCP 2026-07-28 boundary contracts and conformance fixtures

**Commit message**

```text
feat(contracts): define MCP 2026-07-28 broker boundary
```

**Create versioned schemas**

- `CapabilityServerRegistration`
- `CapabilityCatalogueSnapshot`
- `McpRequestIdentity`
- `McpTaskLink`
- `InputRequest`
- `McpAppGrant`
- `CacheReceipt`

Every applicable schema must carry:

- protocol revision;
- cell and principal;
- server identity and immutable registration revision;
- method/name and schema hashes;
- policy and capability-catalogue revisions;
- run/action relationship;
- data and effect classes;
- credential audience handle, never a raw token;
- expiry, idempotency, and replay fields;
- task/input/cache/App-specific state.

**Create**

- `services/capability-broker/README.md`
- `packages/contracts` fixtures and tests using the existing layout
- `tests/conformance/mcp-2026-07-28/README.md`
- deterministic fixtures for the cases below

This commit defines contracts and test vectors. It does not need to proxy a real MCP server.

**Required fixture groups**

1. Stateless retry:
   - same logical request reaches two replicas;
   - no session header or sticky-state dependency;
   - one result or reconciled outcome.
2. Request identity:
   - missing protocol/method/name header;
   - unsupported revision;
   - body/header mismatch;
   - `_meta` principal mismatch;
   - changed server registration.
3. Multi Round-Trip input:
   - one canonical Input Request;
   - duplicate, stale, wrong-actor, expired, and altered-artifact responses fail;
   - requested information is not treated as approval.
4. MCP Tasks:
   - handle links to a FRANK Run;
   - restart, update, cancellation, notification gap, and handle collision reconcile.
5. Caching:
   - scope includes cell, principal, policy, server revision, method, normalized arguments, and protocol revision;
   - policy/schema/revocation changes invalidate;
   - no cross-principal or cross-cell hit.
6. Apps:
   - explicit host grant;
   - isolated-origin and sandbox fields;
   - no raw secrets;
   - origin spoof, grant reuse, and network escalation fail.
7. Authorization:
   - issuer and audience binding;
   - credential reuse across servers fails;
   - redirect/downgrade fixtures fail.
8. Compatibility:
   - deprecated capability use is inventoried with owner and removal date;
   - new code cannot depend directly on the legacy boundary.

**README requirements**

- Capability Broker is the only managed MCP edge.
- Tools, returned content, schemas, and annotations are untrusted inputs.
- Raw bearer-token passthrough is prohibited.
- Every effectful call crosses the action boundary and writes a canonical receipt.
- Tasks and input are protocol records linked to FRANK durable records.
- Claude surfaces are probed; announcement text is not a capability check.

**Registry**

Link `MCP-001` through `MCP-010` to the contracts and conformance fixtures. Do not mark broker behavior implemented.

**Done condition**

The future Capability Broker can be implemented against stable domain-neutral protocol records and binary conformance cases.

---

### Commit 10 — Final reconciliation and evidence

**Commit message**

```text
docs: record repository synchronization evidence
```

**Create**

- `docs/evidence/repository-sync-2026-07-29.md`

If `docs/evidence/` conflicts with an established evidence location added before this work, use the established location and update registry links.

**The evidence record must contain**

- starting and ending commit;
- exact Node, pnpm, Docker, and database versions;
- files changed;
- specification version and SHA-256;
- registry counts;
- test counts with passed, failed, and skipped totals;
- the GitHub workflow run URL;
- branch-protection settings;
- container image digest;
- database integration evidence;
- production-composition negative-test evidence;
- known unimplemented components;
- rollback for each database, contract, and deployment-affecting change;
- fresh-context review result;
- cross-model review result.

**Run from a clean checkout using Node 22.11.0**

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run registry:test
pnpm run registry:check
pnpm run deps:check
pnpm run contracts:validate
pnpm run env:validate
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
git status --short
```

Then run the PostgreSQL integration job with:

```text
FRANK_REQUIRE_INTEGRATION=1
FRANK_TEST_DATABASE_URL=<disposable frank_test database>
FRANK_TEST_API_DATABASE_URL=<disposable frank_api_test database>
```

Run:

1. deterministic checks;
2. a fresh-context code review with no builder conversation;
3. a different-model-family review;
4. a security-focused review of identity, replay, signing, cell scope, secrets, MCP Apps/auth, and Buzz ingress;
5. deterministic checks again after review fixes.

Severity rules:

- Critical: secret/data loss, arbitrary effect, auth bypass, cross-cell exposure, unrecoverable corruption.
- High: durable-state loss, approval bypass, duplicate effect, false completion, material privacy claim, production fallback to development security.
- Medium: degraded recovery, missing evidence, unclear ownership, inaccessible control.
- Low: maintainability or polish without present safety/correctness impact.

No Critical or High finding may remain unresolved.

**Done condition**

The working tree is clean, all required checks are green on GitHub, `main` is protected, documentation is synchronized, and evidence states truthfully what is and is not implemented.

---

## 7. Pull-request split

Use separate pull requests if the implementation agent cannot keep the total review surface understandable. Preserve this order:

1. Authority, registry parser, registry regeneration, ADRs, and architecture.
2. Real lint, GitHub verification, required database integration, and branch protection.
3. Production composition guard and runnable build.
4. Buzz boundary contracts and upstream canary runbook.
5. MCP boundary contracts and conformance fixtures.
6. Final evidence reconciliation.

Each pull request must be independently green. Do not merge a later pull request while an earlier authority or safety correction is outstanding.

---

## 8. What may continue after this plan is complete

After the synchronization pass is green, normal FRANK construction can continue without replacing the existing domain core.

Recommended next work:

1. implement `PostgresSpentNonceLedger`;
2. implement Authentik OIDC identity;
3. implement OpenBao-backed signing/key resolution;
4. implement Temporal workflow worker and canonical Run transitions;
5. implement the Capability Broker against the MCP contract suite;
6. deploy pinned Buzz using official assets and build the small `frank-buzz` adapter;
7. implement the web/PWA shell against generated API contracts;
8. add Harness and Model Brokers;
9. add second-brain projections and ingestion;
10. add the overnight build/review/evidence loop.

These are new construction items, not reasons to delay the repository corrections above.

---

## 9. Final acceptance checklist

The update is complete only when every box is true:

- [ ] Specification version 1.1 is committed in `docs/product/`.
- [ ] No controlling link points to a developer’s local filesystem.
- [ ] Registry parsing is based on normative table shape, not §4 alone.
- [ ] `MCP-001`–`MCP-010` and `BUZZ-008`–`BUZZ-012` are registered and owned.
- [ ] Registry version-1.1 totals are reconciled: 127 requirements, 162 sections, 289 total.
- [ ] ADR-008 and ADR-011 contain recorded revision history and current decisions.
- [ ] README and architecture status match the code.
- [ ] No `echo` placeholder lint remains.
- [ ] Node 22.11 and pnpm 10.28 are used in CI.
- [ ] Real PostgreSQL integration tests run and cannot silently skip in CI.
- [ ] GitHub required checks protect `main`.
- [ ] Non-development startup rejects local identity, memory-only keys, and process-only nonce state.
- [ ] `pnpm build` creates runnable API output.
- [ ] Compiled API startup and clean shutdown are tested.
- [ ] The API container is pinned, non-root, and contains no secrets or local state.
- [ ] Buzz boundary schemas and port exist without a fake relay implementation.
- [ ] MCP 2026-07-28 schemas and conformance fixtures exist without a fake broker claim.
- [ ] Buzz and MCP registry statuses remain honest.
- [ ] `.probe-push-files` is removed.
- [ ] Clean-checkout verification passes.
- [ ] Fresh-context, cross-model, and security reviews have no unresolved Critical or High finding.
- [ ] Evidence records exact versions, results, limitations, and rollback.

---

## 10. Required handoff report

The implementing agent must finish with this exact information:

```text
Starting commit:
Ending commit:
Branch:
Pull requests:
Files added:
Files changed:
Files removed:
Specification version and SHA-256:
Registry requirement/section/total counts:
New registry records and assigned owners:
Node and pnpm versions:
Static and unit test result:
PostgreSQL integration result:
Skipped test count:
Build result:
Container image digest:
Startup smoke result:
Production-composition negative tests:
GitHub workflow run:
Required branch checks:
Buzz boundary status:
MCP boundary status:
Fresh-context review:
Cross-model review:
Security review:
Known limitations:
Rollback tested:
Blocked external access:
One exact command or credential action for each blocked item:
```

Never report “implemented,” “secure,” “deployed,” or “tested” for a stub, a schema alone, a skipped test, a mocked external service, or an unexecuted workflow.

---

## 11. Primary references

- FRANK repository: <https://github.com/stevenshelley58-afk/frank>
- Audited commit: <https://github.com/stevenshelley58-afk/frank/commit/fc255180df7c4bed4db151f12d48f23ba67f1a2d>
- Buzz repository: <https://github.com/block/buzz>
- Buzz v0.5.0: <https://github.com/block/buzz/releases/tag/v0.5.0>
- MCP 2026-07-28 specification: <https://modelcontextprotocol.io/specification/2026-07-28>
- MCP release explanation: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- Claude MCP 2026-07-28 announcement: <https://claude.com/blog/bringing-mcp-2026-07-28-to-claude>
