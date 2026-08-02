# FRANK Agent Kernel — Build Plan (Workstream 5 + Memory)

**Goal:** Build Frank's agent kernel properly, with memory as a first-class,
spec-compliant part of it. Frank OWNS memory; harnesses (Goose today, others later)
borrow it via context packs. Per FRANK-§7, §6.2, BRAIN-006.

**Starting point (verified on VPS /srv/frank/repo, 2026-08):**
- `packages/contracts/` exports: common, classification, event-envelope, policy,
  evidence, module-manifest, screen, pack, buzz. (`pack.ts` = EXTENSION pack §6.10,
  e.g. `industry.real-estate` — NOT the agent context pack.)
- `packages/identity/` (signed sessions), `packages/policy/` (envelope, signing) — EXIST.
- `adapters/harness/goose/` → `goose-adapter.ts` — a WORKING Goose ACP adapter exists.
- `apps/api/src/services/work-view.ts` — Workstream 4 (domain kernel) has a foothold.
- `apps/web` → live chat via `/api/chat/route.ts` with proven per-room identity injection.
- mem0 server LIVE on VPS :8888 (Gemini backend) — candidate memory backend, behind an interface.
- MISSING (verified, zero hits): the §7.4 **context-pack contract** (net-new, author in
  `packages/contracts`), the kernel orchestration package (run state machine, harness
  selection, context-pack ASSEMBLY, durable run records), and the memory module.

**Architectural invariants (from spec — non-negotiable):**
- Frank owns the run, memory, policy, artifact format. Harnesses are replaceable workers. (§7.1)
- Context packs are minimized, hash-addressed, reproducible. Agents do NOT inherit all
  of Frank's memory just because a tool can reach it. (§7.4) ← why memory ≠ "dump everything".
- Every run transition records actor, time, reason, policy decision, correlation, evidence. (§7.3)
- Memory must be reviewable, editable, expirable, deletable (BRAIN-006) → memory control surface.
- Generated memory ≠ source truth (data classes: generated-untrusted). Memory recalls are
  injected as a distinct, labelled, lower-trust context section.

---

## Dependency-ordered sessions

### S0 — De-risk + contract audit (FIRST SESSION, small, low-risk)
Goal: prove the seams before building on them. No production changes.
1. Read `goose-adapter.ts` + `evidence.ts` + `policy.ts` in full — confirm the exact
   harness adapter interface.
2. AUTHOR the §7.4 context-pack contract in `packages/contracts` (it does not exist
   yet — verified zero hits). Define the signed, hash-addressed, minimized manifest.
3. Confirm how `apps/web/api/chat/route.ts` calls Goose today (the injection seam to
   replace with a context pack).
4. Decide the kernel's home: new `packages/kernel/` (orchestration) + `packages/memory/`
   (memory interface + mem0 impl), reusing `packages/contracts` types.
5. Deliverable: this plan refined with exact interfaces; a green "adapter contract is
   stable" finding. **Steve reviews the interface shapes before S1.**

### S1 — Memory module behind an interface (foundation, testable alone)
- `packages/memory/`: `MemoryProvider` interface {recall(query, scope), store(messages, scope),
  list/edit/delete/expire} + a `Mem0MemoryProvider` impl (HTTP to :8888) + an in-memory fake for tests.
- Scope model: per-room / per-project / personal, mapped to mem0 filters (user_id/agent_id).
- Tag recalled facts as `generated-untrusted` per data classification.
- Unit tests against the fake; integration test against live mem0.
- Fannable: independent of kernel orchestration.

### S2 — Run state machine + durable run records
- `packages/kernel/`: RunState enum (all §7.3 states) + transition table that enforces
  legal transitions and records {actor, time, reason, policy, correlation, evidence}.
- Persistence via `adapters/storage` (Postgres) — new `runs` table + migration.
- Tests: every legal/illegal transition; durability across restart.

### S3 — Context-pack assembly (where memory meets the agent)
- Kernel assembles a ContextPack (§7.4) for an assignment: goal, requirements, tools,
  budget, AND a minimized memory section via S1's recall — hash-addressed, reproducible.
- This replaces the ad-hoc per-room identity injection with a proper, auditable pack.
- Fannable after S1+S2.

### S4 — Harness selection + adapter wiring
- Kernel selects a harness per agent profile, drives it through the existing
  `AgentHarnessAdapter` (Goose adapter exists; others later). Harness gets a context
  pack, returns normalized events/artifacts. Swap Goose → no memory lost.

### S5 — Wire kernel into the live /api/chat path + memory control surface
- Route calls kernel.run(goal, room) instead of Goose directly. Kernel: recall → pack →
  harness → store-new-facts → persist run record.
- BRAIN-006: minimal memory control UI (list/edit/delete memories) — or API + later UI.
- Verify in-container (per frank-agent-runtime-integration skill deploy loop).

---

## What Steve does in parallel (no coding)
- Review interface shapes after S0 (the key gate).
- Click-test the live chat after S5.
- Decide agent-profile → harness/model mappings when S4 needs them.
- Spot-check the memory control surface.

## Fanning to agents
S1 (memory) and S2 (run state) are independent → can run as parallel subagents after S0.
S3 needs both. S4/S5 sequential.

## Dependency / ordering notes (verified from spec §21)
- Workstream 5 (this) DEPENDS ON Workstream 4 (Canonical Domain Kernel). WS4 has a
  foothold (`work-view.ts`) but is not complete — confirm the WorkItem contract is
  stable enough before S2 persists runs against it.
- WS5 can proceed in parallel with parts of WS6 (harness/model/skill brokers).

## Risks / open questions (to grill before S1)
1. Is mem0 the memory backend, or does Frank's own Postgres+pgvector own storage and
   mem0 is just the extraction/embedding engine? (spec: memory swappable + owned by Frank)
2. Context-pack "minimization" — who decides which memories are relevant? (recall ranking
   vs. explicit pack manifest)
3. Does the kernel run inside `apps/api` (TS) or as its own service? (affects S2/S5)
