# Frank Platform + Blockwise Rebuild — Execution Plan

**For:** Claude Code, parallel cheap agents
**Repos:** `frank` (platform) · `blockwise` (tenant #1)
**VPS:** 76.13.209.160 · `/frank` `/projects` `/infra` `/archive`

---

## 0. The one idea that shapes everything

**Frank is a platform. Blockwise is the first tenant, not the only one.**

Every module extracted from Blockwise must be generic, with project-specific behaviour supplied by a **project pack**:

```
frank/
  modules/<module>/          generic capability — no project names in code
  packs/blockwise/           config, policy, taxonomy, brand, thresholds
  packs/<next-project>/      adding project #2 = adding a pack, never forking a module
```

**Rejection test for every PR:** if a module contains the string `blockwise` outside `packs/`, it's wrong. A fixture project named `acme` must be able to use the module with zero code changes. Agents must run this check before committing.

---

## 1. Resumability protocol — read this first

You may run out of credits mid-build. Every agent obeys this so any other agent can take over cold.

### State lives in the repo, not in an agent's head

```
frank/.build/
  STATE.md          one line per task: id | status | branch | commit | owner | updated
  tasks/<ID>.md     objective, allowed files, done-when, notes, blockers
  DECISIONS.md      append-only; every non-obvious choice with its reason
```

### Commit contract — every agent, every task

1. **First action:** read `.build/STATE.md`. Claim exactly one task with status `READY` by setting it to `IN_PROGRESS` and committing that single line change. Never claim two.
2. **Commit at every green checkpoint**, not at the end. Minimum one commit per hour of work. A commit that only compiles is still worth making.
3. **Commit message format** — a fresh agent reads only this to understand state:
   ```
   <TASK-ID>: <what changed>

   Status: in-progress | complete
   Done: <what now works>
   Next: <exact next step>
   Files: <paths touched>
   ```
4. **Last action:** set the task to `DONE` (or `BLOCKED` with the reason in `tasks/<ID>.md`), commit, push.
5. **Never leave uncommitted work.** If you must stop, commit as `in-progress` with an accurate `Next:`.
6. **Never force-push. Never rebase another agent's branch. Never touch a task you did not claim.**

### Cold-start prompt for any replacement agent

> Read `frank/.build/STATE.md` and `frank/.build/DECISIONS.md`. Find the first task with status `READY` whose dependencies are all `DONE`. Read `.build/tasks/<ID>.md`. Claim it, do it, commit per the contract in `EXECUTION-PLAN.md` §1. Touch only the files that task lists as allowed.

Any agent, any model, any day can resume from this. That's the whole point.

---

## 2. Parallelism and file ownership

Three workers plus one coordinator. More workers means more collisions on shared files.

**Hot files — coordinator only, never a parallel worker:**

```
packages/contracts/src/index.ts
adapters/storage/postgres/migrations/meta/_journal.json
adapters/storage/postgres/src/schema/index.ts
apps/api/src/main.ts
apps/web/src/components/shell/frank-shell.tsx
infra/production/docker-compose.app.yml
pnpm-lock.yaml
```

A worker needing a hot-file change writes the requested delta into `.build/tasks/<ID>.md` under `HOT-FILE REQUEST` and marks itself `BLOCKED`. The coordinator applies it in one serial commit.

**Migration numbers are handed out by the coordinator only.** Frank is at `0013`. Next free is `0014`. One task, one number, recorded in `STATE.md` before the agent starts.

---

## 3. Waves

Each task: `ID | what | depends on | allowed files`. Tasks in the same wave with no shared files run in parallel.

### Wave 0 — Make it resumable and runnable *(serial, ~1 day)*

| ID | Task | Allowed files |
|---|---|---|
| `F0-1` | Create `.build/` scaffold, STATE.md, DECISIONS.md, cold-start doc | `.build/**` |
| `F0-2` | Deploy Frank from `main` to the VPS; confirm it loads and chat responds | `infra/**` |
| `F0-3` | Point Graphify registry at every project, not just `frank` | `infra/production/codegraph-projects.json` |
| `F0-4` | Add `.gitignore` rules: `.cache/`, fonts, sample dirs, `node_modules` | `.gitignore` |

**Gate:** `frank.fail` loads, chat responds, Graphify lists every project. **Nothing else starts until this passes** — without a running Frank you cannot verify a single thing you build.

### Wave 1 — Platform foundations *(serial, contract-critical)*

| ID | Task | Depends | Allowed files |
|---|---|---|---|
| `F1-1` | **Project registry + pack loader.** `packs/<id>/pack.json` with schema, validator, loader, `packs/acme` fixture | F0 | `packages/project-pack/**`, `packs/**` |
| `F1-2` | **Release contract.** `ReleaseEnvelope v1` + payload registry. Typed payloads plug in: `TemplatePack`, `PublishedArticle`, `AdIntelligence` | F1-1 | `packages/frank-release-contract/**` |
| `F1-3` | **Module manifest + scaffold.** `frank.module/v1`: tables, capabilities, events, health, retention, project scoping. Generator so every later module is identical | F1-1 | `packages/frank-module/**` |
| `F1-4` | **Service identity + delivery.** Project-scoped tokens, idempotency ledger, import receipts, cursors, hash verification, revocation | F1-2 | `modules/delivery/**` |

**Gate:** fixture project `acme` resolves a pack, a fake module emits a signed release, a fake consumer imports it idempotently and rejects a tampered hash.

> **This wave is the whole architecture.** Get it right and every later module is mechanical. Rush it and you rebuild everything twice. It's the one place worth the strongest model.

### Wave 2 — Frank tools, ripped from Blockwise *(parallel, 3 workers)*

Each is a generic module + a Blockwise pack entry. Each ships behind the Wave 1 contract.

| ID | Module | Ripped from Blockwise | Parallel group |
|---|---|---|---|
| `F2-A1` | `renderer` — deterministic Feed 1080×1350 + Story 1080×1920, byte-identical PNG hashes, no network | new build | A |
| `F2-A2` | `template-factory` — intake, extract, layer build, two independent AI review loops, stress QA, sign | `src/lib/adstudio/*` (rebuilt, not ported) | A |
| `F2-B1` | `ad-intelligence` — collect, normalise, classify, provenance. **Exports must make contact/PII fields structurally impossible** | `research.*` tables, `hermes/tools/research-runtime` | B |
| `F2-B2` | `prospect-discovery` — prospects, contact points, evidence, confidence | `research.agent_contacts`, agent/agency contact fields | B |
| `F2-B3` | `mail` — provider-neutral inbound/outbound, threads, receipts | operator Resend adapter, `EmailConsole` | B |
| `F2-B4` | `outreach` — lists, sequences, approval, send ledger, suppression. **No path may reach `mail` without a suppression check** | new build | B (after B2+B3) |
| `F2-C1` | `content-factory` — briefs, runs, artifacts, review, approval, release | `packages/content-engine`, `src/lib/content-engine` | C |

**Rules for every Wave 2 task:** no module imports another module's tables — they exchange `subject_ref` and events. Real-estate taxonomy, Meta lead-form rules and brand voice go in `packs/blockwise`, never in module code.

**Gate per module:** manifest validates · migrations apply clean and rerun as no-op · project isolation tested · emits a valid release · `grep -ri blockwise modules/<name>` returns zero.

### Wave 3 — Frank surfaces *(parallel with Wave 2)*

| ID | Task | Depends |
|---|---|---|
| `F3-1` | Project home + widget runtime + registry (migration `0014`) | F1-3 |
| `F3-2` | Widget groups: operational, project/app, source/graph, data health | F3-1 |
| `F3-3` | Night Watch provider (migration `0015`) | F3-1 |
| `F3-4` | Operator consoles for each Wave 2 module | F2 modules |

### Wave 4 — Blockwise as tenant #1 *(parallel, 3 workers)*

Start from `/projects/blockwise/repo-clean` @ `3959be8` (68 MB, already stripped).

| ID | Task | Allowed files |
|---|---|---|
| `B4-1` | **Deletion commit — first commit on the branch.** Remove the legacy AdStudio path per the file list in the AdStudio plan §1.2–1.6. Replace `/ad-studio` with a server-rendered "being prepared" state, no fallback template | `src/lib/adstudio/**`, `src/components/adstudio/**`, `scripts/adstudio/**`, tests |
| `B4-2` | **Consumer boundary.** Server-only Frank client, cursor, receipts, payload-hash verification, last-known-good cache, feature-flagged off | `src/lib/frank/**` |
| `B4-3` | **Template catalogue.** Import packs, quarantine until every check passes, atomic activation, `409` on same-identity-different-hash | `src/app/api/internal/**` |
| `B4-4` | **Layered editor.** Konva canvas, Feed/Story tabs, crop with shaded overlay and per-placement coordinates, colour modes, undo/redo. No PNG during editing | `src/components/adstudio/**` |
| `B4-5` | **Save.** Validate against pinned pack, canonical hash, render both PNGs, one transaction, no partial state | `src/app/api/adstudio/**` |
| `B4-6` | **Publish + Instant Forms.** AI-generated editable form, snapshot freeze, Meta objects PAUSED, readback, separate activation | `src/lib/meta/**` |

**Rule:** Blockwise never calls a Frank database and never generates a template. It imports releases and renders them.

### Wave 5 — Project #2 proof

Add `packs/<second-project>` and run one module end to end for it. **This is the real test of the architecture.** If it needs a code change in any module, Wave 1 failed and you fix it now rather than discovering it in six months.

---

## 4. Standard worker prompt

```
Read frank/.build/STATE.md, frank/.build/DECISIONS.md, and EXECUTION-PLAN.md §1-2.

Task: <ID>
Objective: <one sentence>
Depends on: <IDs, all must be DONE>
Allowed files: <exact paths>
Forbidden: hot files (§2), other modules, another agent's branch
Contract to consume: <package + version>
Done when: <testable conditions>

Rules:
- Claim the task in STATE.md and commit that before starting.
- Commit at every green checkpoint using the §1 message format.
- No project name outside packs/. Run: grep -ri blockwise modules/<name> — must be empty.
- No localhost. Verify on the hosted preview.
- Never edit an applied migration; request a new number from the coordinator.
- Never drop a non-empty table.
- On blocker: write it to .build/tasks/<ID>.md, set BLOCKED, commit, stop.
- Final action: set DONE, commit, push.

Return: task ID, branch, commit SHA, files changed, done-when results, blockers.
```

**Model allocation:** Wave 1 contracts — strongest available. Everything else — cheap. Review at merges only.

---

## 5. Standing rules

1. One copy per project. `repo` = source, `deployed` = running.
2. Never bind-mount a single file into a container. Mount the directory.
3. Never put `build:` on a digest-pinned production service.
4. Tag every release image. Prune dangling only, never `-a`.
5. Assets are never committed — no fonts, no sample images, no caches.
6. No module knows a project's name. Packs carry that.
7. Delete before building, not after. On a dev box that's how you stay clean.

## 6. Outstanding, unrelated to the build

- **No host firewall.** `ufw` absent, INPUT policy `ACCEPT`. Ten minutes.
- **PAT lacks `workflow` scope** — 4 blockwise branches can't push; preserved in `/archive/blockwise-full.bundle`.
- **Unused KVM4 `187.52.115.7`** — you're paying for it.
- `/archive` holds 3.3 GB of recovery material: git bundles, uncommitted patches, the 1.7 GB verified research dump, 13 of your images, container manifest.
