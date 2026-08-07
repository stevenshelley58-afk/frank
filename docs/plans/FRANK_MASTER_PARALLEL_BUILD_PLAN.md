# FRANK Master Parallel Build Plan

**Date:** 6 August 2026  
**Status:** Proposed execution plan  
**Purpose:** Consolidate the Workbenches specification, Channels SDK integration plan, and prebuilt integration plan into one build program that multiple agents can execute safely in parallel.

## 0. Authority and scope

### 0.1 Authority order

This document coordinates execution. It does not replace higher-authority product or architecture decisions.

1. Accepted ADRs win over every plan.
2. `FRANK_ROOMS_ARCHITECTURE.md` remains the UX authority.
3. `FRANK_BUILD_PLAN.md` remains the engineering and S1-S7 build authority.
4. Existing contract and dependency rules remain mandatory.
5. This plan controls sequencing, task ownership, merge gates, and parallel-agent coordination.

This program is layered onto S1-S7 and does not reorder them. If the S2 frontend rebuild has not landed, UI-01 and the relevant UI-04 overlay foundations should land first to avoid migrating the same surfaces twice.

Where this plan conflicts with an accepted ADR, stop the affected workstream and update the plan after the ADR is resolved.

### 0.2 Included

This program delivers:

- Cowork-class workbenches for durable delegated work.
- Server-side execution that survives browser closure, client disconnection, and runner restarts.
- A per-task filesystem fence, sandbox, harness, plan, events, leash, deliverables, and receipt.
- Work-item-native approvals and pause/resume behavior.
- A first mobile control surface using the direct Telegram adapter from `@copilotkit/channels`.
- Connected PC folders through Syncthing.
- Scheduled workbenches with fresh workspaces and receipts.
- Docker and `srt` isolation now, with a conditional microsandbox pilot when KVM is available.
- Vendored shadcn/ui primitives mapped to Frank's existing design tokens.
- GitHub CI, secret scanning, issue tracking, and branch hygiene.
- Chrome-verified previews with stored evidence.
- A packaged Claude plugin containing the selected Frank rules and skills.

### 0.3 Excluded from this program

The following are not part of the current release:

- Full mini-Frank chat inside Telegram, WhatsApp, Slack, Discord, or Teams.
- The Channels AG-UI bridge described as C5 in the source plan.
- Multi-tenant or white-label isolation.
- A second room model, second approval state machine, or second transcript store.
- CopilotKit Intelligence or any managed gateway in the canonical execution path.
- Temporal migration. Goose scheduling remains the interim implementation.
- Raw Firecracker integration.
- Replacing Frank's design system with tweakcn or another theme.
- Vercel previews for Frank.
- Supabase as a new Frank runtime dependency.
- OpenHands, E2B, Daytona, or another external control plane as Frank's foundation.

## 1. Program outcome

At completion, Steven can hand a task to any Frank room and leave. Frank creates a work item and durable workbench on the VPS, provisions an isolated workspace, launches a selected harness, publishes a 3 to 10 step plan, streams step state into the Running surface, pauses only for a real decision, accepts that decision from the phone, produces files and preview links, writes a compact receipt, and leaves enough audit evidence to reconstruct the entire run.

The product behavior must satisfy all of these conditions:

- Closing every client does not stop the task.
- The task is still a work item. The workbench is its execution record, not a competing state machine.
- Room and shared-folder boundaries are enforced by mounts and operating-system permissions.
- Harness choice is replaceable through `AgentHarnessAdapter` and ACP where supported.
- Progress is represented as plan steps, not a stream of model narration.
- Mobile surfaces submit normal command envelopes. They never write canonical state directly.
- Deliverables land as files and preview URLs. Chat receives only a short handoff and final receipt.
- Every run has a wall-clock timeout, spend or token budget, and kill switch.
- Scheduled runs use fresh workspaces and leave normal receipts.
- Every visible change is previewed, opened in Chrome, exercised, checked for console and network errors, and handed over with evidence.

## 2. Decisions resolved for this master plan

The source material contains several open decisions and one direct overlap. This plan uses the following execution assumptions until Steven changes them.

| ID | Decision | Execution rule |
|---|---|---|
| M1 | First channel platform | Telegram, direct adapter, polling mode for the initial implementation. |
| M2 | First channel scope | Notify and approve only. No full room conversation. |
| M3 | Channels C5 | Deferred. It requires a separate ADR and is not started automatically after C4. |
| M4 | Channels StateStore | Postgres, with the SDK conformance suite as a hard gate before any real approval card ships. |
| M5 | Hermes responsibility | Channels takes Telegram and later WhatsApp messaging. Hermes retains autonomous background work and cron only until scheduled workbenches replace each cron task. |
| M6 | ntfy overlap | Do not build ntfy and Telegram as competing approval surfaces in release 1. Telegram is the first interactive approval surface. ntfy remains an optional later adapter if Android notification-shade actions are still required. Only one interactive decision surface may be enabled for a binding. |
| M7 | UI theme | Frank tokens only. No tweakcn theme. |
| M8 | First shadcn target | Tasks console. |
| M9 | Isolation rung 1 | One Docker container per workbench, non-root, resource-limited, explicit mounts, with `srt` for filesystem and egress policy. |
| M10 | Isolation rung 2 | Microsandbox only if `ls /dev/kvm` succeeds on the target VPS. Absence of KVM does not block release 1. |
| M11 | Scheduling | Goose schedule first. Temporal remains the target without changing the workbench contract. |
| M12 | Channel lifecycle | The direct SDK path may use `channel["ɵruntime"]` only inside the Channels adapter package. No other package may reference it. |
| M13 | Durable approval flow | Post card, finish the delivery turn, and resolve later through a new inbound interaction and the outbox. Do not keep a Node promise open for hours or days. |
| M14 | CI protection | Add the verify workflow immediately. Enable main branch protection only after the workflow has completed successfully on two representative changes. |
| M15 | Workbench persistence | Postgres from day one. In-memory workbench or approval state is not permitted beyond throwaway spikes. |
| M16 | Second harness: Prime Agent | Adopt Prime Agent (`PrimeIntellect-ai/prime-agent`, pinned exact version — v0.7.0 at writing) as an EXPERIMENTAL first-class harness behind `AgentHarnessAdapter` (WB-04C). Goose remains the default until the cross-harness evaluation (WB-04E/WB-10) produces evidence. One Prime environment per workbench; Frank keeps the sandbox, schedules, outer leash, and refinement approvals. |

## 3. Non-negotiable architecture rules

### 3.1 Canonical state

- Work items remain the canonical task and approval state.
- Every workbench transition must correspond to a work-item transition, audit entry, and outbox event.
- The workbench record stores execution detail only: workspace, harness, leash, plan, events, artifacts, receipt, and optional schedule.
- Channel, ntfy, web, and any future surface are transport and rendering layers only.
- A surface resolves work only by submitting the standard command envelope with `command_id`, `expected_version`, and `reason` where required.
- Frank's records remain the transcript and evidence authority. Do not enable Channels transcripts as another source of truth.

### 3.2 Filesystem fence

- Every workbench gets a scratch workspace and only the mounts declared in its task definition.
- Mount modes are `ro`, `rw`, or `staged`.
- Cross-room writes must fail at operating-system level.
- Shared-folder writes use a staged copy and a decision work item before landing.
- Connected PC folders are send-only from the PC by default. Write-back is an explicit per-folder choice.

### 3.3 Harness seam

- Goose headless is the default engine.
- ACP is the preferred protocol when the harness supports it.
- `coder/agentapi` is the compatibility wrapper for non-ACP terminal agents.
- The runner depends only on `AgentHarnessAdapter`, not on Goose-specific implementation details.
- The same task definition must be runnable under at least two harness adapters before the harness abstraction is considered proven.

### 3.4 Progress and receipts

- Every run publishes a 3 to 10 step plan before substantive execution.
- Step states are `pending`, `doing`, `done`, `failed`, or `skipped`.
- The room thread receives one handoff mention at start and one receipt at completion.
- Raw tool chatter is evidence in the workbench detail view, not primary chat content.
- A receipt contains what was done, what was found, decisions taken, assumptions made, and evidence links.

### 3.5 Surface isolation

- `apps/channels-listener` is a separate long-running process. It is not a route inside `apps/api`.
- The listener calls Frank's API over HTTP exactly as the web app does.
- A channel outage cannot hide, delete, delay, or corrupt canonical work-item state.
- Telemetry is disabled with `COPILOTKIT_TELEMETRY_DISABLED=true` and verified by test.
- Bot tokens are injected through OpenBao or the existing secret mechanism. They are never committed or placed in synced folders.

### 3.6 Delivery discipline

- `pnpm run verify` is the common local and CI gate.
- Visible changes require a preview URL and Chrome evidence.
- No agent hands over a link that it has not opened and exercised.
- One phase equals one intentional commit unless the phase is explicitly split in this plan.
- Every task includes a rollback note.

## 4. Target architecture

```text
Steven
  |
  | web, Telegram, future phone surfaces
  v
+----------------------- SURFACES ------------------------+
| apps/web            apps/channels-listener             |
| Running, Waiting,   direct Telegram adapter            |
| Files, receipts     notify, update, interaction        |
+-----------------------------+---------------------------+
                              |
                              | HTTP command/query APIs
                              v
+----------------------- CONTROL PLANE -------------------+
| Rooms | work items | policy | delegation | approvals   |
| audit | outbox | records | receipts | provider registry|
+-----------------------------+---------------------------+
                              |
                              | createWorkbench(taskDef)
                              v
+----------------------- WORKBENCH RUNNER ----------------+
| Postgres execution record | queue | recovery | SSE      |
| plan | events | leash | artifacts | receipt             |
+-----------------------------+---------------------------+
                              |
                              | AgentHarnessAdapter
                              v
+------------------------- HARNESS ------------------------+
| Goose headless | ACP agents | agentapi-wrapped CLIs     |
+-----------------------------+---------------------------+
                              |
                              v
+------------------------ WORKSPACE -----------------------+
| Docker + srt | explicit mounts | egress allowlist       |
| optional microsandbox when KVM is available             |
+----------------------+----------------+------------------+
                       |                |
                       v                v
                Syncthing folders   preview.frank.fail
```

### 4.1 Work-item lifecycle

All states are expressed through work-item transitions:

```text
proposed -> queued -> provisioning -> running <-> waiting
                                           |
                                           v
                                      verifying
                                           |
                         +-----------------+------------------+
                         v                 v                  v
                       done              failed            cancelled
```

The baseline task must verify that the current WORK-004 transition model already supports these states. If it does not, the contracts owner prepares the required ADR or migration before runner code depends on them.

### 4.2 Minimum workbench record

```ts
Workbench {
  id
  workItemId
  roomId
  taskDef {
    instruction
    mounts[] { source, path, mode: "ro" | "rw" | "staged" }
    harness { adapter, provider, model }
    skills[]
    leash { wallClockSec, tokenBudget, spendCapUsd }
    network { egressAllowlist[] }
  }
  plan[] { step, state, note }
  events[]
  artifacts[] { path, kind, previewUrl? }
  receipt { summary, assumptions[], evidence[] }
  schedule? { cron, tz }
}
```

Minimum append-only event types:

- `workbench_created`
- `provisioning_started`
- `provisioned`
- `plan_published`
- `step_updated`
- `decision_requested`
- `paused`
- `resumed`
- `artifact_registered`
- `receipt_published`
- `stop_requested`
- `timed_out`
- `failed`
- `cancelled`
- `completed`

Names may follow existing repository conventions. Semantics are fixed.

## 5. Parallel-agent operating model

### 5.1 Agent roster

The ideal execution team is eight agents. Fewer agents can combine adjacent workstreams, but ownership boundaries must remain intact.

| Agent | Workstream | Primary ownership | Must not own concurrently |
|---|---|---|---|
| AG-0 | Integration and contracts | Authority checks, decisions, shared-file leases, merge order, contract and migration coordination, release evidence | Feature implementation in another agent's leased path |
| AG-1 | Delivery controls | GitHub Actions, preview verification skill, evidence conventions, issue pipeline, secret scanning | Workbench runtime, channel adapter, application feature code |
| AG-2 | Web UI | shadcn bridge, tasks console, command palette, overlays, feedback, rail, Running/Waiting/Files UI | API canonical state, DB transitions, channel listener |
| AG-3 | Workbench core | Workbench schema, runner, Docker provisioner, harness integration, events, SSE, leash, recovery, receipts | Channels adapter, Syncthing infrastructure, general web component migrations |
| AG-4 | Human loop and Channels | Telegram spike, ChannelPort, Postgres StateStore, listener, cards, interactions, identity, outage handling | Workbench runner internals beyond the documented pause/resume interface |
| AG-5 | Folders and artifacts backend | Syncthing deployment, room folder bindings backend, mount plumbing, staged writes, artifact and preview backend | Shared UI files without a lease from AG-2 |
| AG-6 | Scheduling and sandbox hardening | Goose schedules, fresh-run semantics, `srt` egress profiles, conditional microsandbox, provider selection wiring | Workbench schema or delegation integration without AG-3 lease |
| AG-7 | Plugin and execution docs | Skill selection, plugin packaging, smoke tests, evals, consolidated execution docs | Product runtime code |

### 5.2 Shared-file leases

The following files or areas are conflict hotspots. Only one agent may hold the lease at a time:

- Root `package.json` and `pnpm-lock.yaml`.
- Workspace configuration.
- Contract exports and schema registry.
- Database migration journal and migration ordering files.
- Docker Compose and VPS service manifests.
- `apps/web/src/app/globals.css`.
- Tailwind configuration.
- App shell, rail, and console registry.
- `AGENTS.md` and precedence documentation.

AG-0 records the active lease in the execution status file before an agent edits a hotspot.

### 5.3 Branch and commit rules

- Branch: `agent/<stream>/<task-id>-<slug>`.
- One task or phase per branch unless AG-0 approves a combined slice.
- One intentional commit per source phase where practical.
- Agents do not merge their own branch into main.
- GitHub is used for tracking and gates. Preview URLs remain the review surface.
- Agents search existing issues before creating new ones.
- Dependency additions are declared in the task handoff. AG-0 coordinates lockfile merge order.

### 5.4 Required handoff from every agent

Each completed task must provide:

1. Task ID and branch.
2. Files changed.
3. Decision or contract assumptions used.
4. Commands run and exact result.
5. Preview URL for visible work.
6. Chrome path exercised.
7. Screenshots or other evidence.
8. Known limitations.
9. Rollback procedure.
10. Commit hash.
11. Next task unblocked.

### 5.5 Stop conditions

An agent stops and hands back evidence rather than improvising when:

- An accepted ADR conflicts with the assigned task.
- A required contract state or endpoint does not exist.
- A change would create a second canonical state store.
- A surface would need to write directly to the database.
- A shared file is leased to another agent.
- KVM is absent and the task is the microsandbox pilot.
- A visible change cannot be verified on the preview lane.
- The direct Channels SDK path fails outside the throwaway spike.
- The Postgres StateStore conformance suite is not green.

## 6. Dependency graph and execution waves

### 6.1 Critical path

```text
G0 authority, decisions, baseline
  -> delegation refactor phases 1-3 confirmed
  -> WB core runner
  -> pause/resume human loop
  -> folders and schedules fan out
  -> integrated acceptance
```

Channels, delivery controls, UI foundation, and plugin packaging run beside the critical path and join at defined gates.

### 6.2 Wave 0: facts, guardrails, and throwaway proof

Start these in parallel:

- AG-0: GOV-01 to GOV-04.
- AG-1: DEL-01 and DEL-03.
- AG-3: WB-00.
- AG-4: CH-00.
- AG-7: PLG-01.
- AG-2: UI-01 may start as soon as DEL-01 is documented and AG-0 grants the globals/Tailwind lease.
- AG-5 and AG-6: prepare implementation and test notes only. Do not integrate WB3 or WB4 work before Gate G3.
- AG-0: complete GOV-06 before Wave 3 expands the mobile and workbench control surfaces.

### 6.3 Wave 1: independent foundations

After Gate G0:

- AG-3 builds the persisted workbench record, runner skeleton, provisioner, and event store.
- AG-4 builds ChannelPort and the Postgres StateStore.
- AG-1 codifies preview verification and evidence storage, then adds secret-scanning workflow and issue conversion.
- AG-2 completes the token bridge and tasks table.
- AG-7 packages the selected plugin skills after the verify-preview skill exists.

### 6.4 Wave 2: core behavior and first useful phone loop

After the relevant Wave 1 tasks pass:

- AG-3 connects Goose, plan publication, SSE, delegation creation, leash, stop, restart recovery, and receipts.
- AG-3 exposes the documented decision-request and pause/resume seam.
- AG-4 builds the Telegram listener, durable cards, command-envelope interaction, identity mapping, telemetry test, and expiry behavior.
- AG-2 builds the live Running and Waiting surfaces against stable APIs, plus command palette and feedback primitives.
- AG-7 installs and smoke-tests the plugin.

### 6.5 Wave 3: fan-out after the human-loop gate

Once Gate G3 proves workbench pause/resume and phone approval:

- AG-5 builds Syncthing integration, folder bindings, staged writes, artifacts, and preview backend.
- AG-6 builds scheduled workbenches, fresh-workspace enforcement, `srt` egress profiles, harness/model selection, and the conditional microsandbox pilot.
- AG-2 builds folder-binding UI, artifacts panel, preview links, overlay migrations, and rail hardening.
- AG-4 adds room bindings, brief pushes, Running state updates, and outage isolation.

### 6.6 Wave 4: system acceptance and migration

- Run the full acceptance matrix.
- Migrate selected Hermes messaging responsibility to Channels.
- Migrate selected Hermes cron tasks to scheduled workbenches only after each schedule passes its own receipt test.
- Enable main branch protection after representative CI success.
- Complete branch cleanup by proposal and approval.
- Publish the final architecture and release receipt.

## 7. Gate definitions

| Gate | Requirement | Evidence required | Unblocks |
|---|---|---|---|
| G0: Authority and baseline | ADR precedence checked, open decisions resolved, delegation refactor phases 1-3 confirmed, VPS facts recorded | `docs/plans/BASELINE.md`, decision table, path ownership map | Workbench and Channels production code |
| G1: Delivery controls | Preview protocol active, CI runs `pnpm run verify`, secret handling defined | Green CI, one deliberate red/green proof, verified preview evidence | All visible production changes |
| G2: Workbench core | Durable run starts, survives browser closure, publishes plan, enforces fence, stops on command, leaves receipt | Running UI evidence, browser-close test, mount-failure test, stop under 5 seconds, restart test | Human loop integration |
| G3: Human loop | Runner creates waiting work, pauses, phone card resolves through command endpoint, restart does not orphan action | Real Telegram approval, audit envelope, double-tap concurrency proof, process-restart proof | Folder and schedule fan-out |
| G4: Folders and schedules | Synced folders, staged writes, artifacts, previews, fresh scheduled runs, egress policy | Folder round-trip evidence, shared-write approval, scheduled receipt, blocked curl | Final acceptance |
| G5: Release | Full W1-W10 matrix, channel outage isolation, UI accessibility, plugin smoke, CI and preview evidence | Final test report and release receipt | Production promotion |

## 8. Workstream task register

## 8A. Governance and integration

### GOV-01: Authority audit

**Owner:** AG-0  
**Dependencies:** None  
**Output:** A short authority map naming the currently accepted ADRs and the exact documents controlling UX, engineering, work items, harnesses, secrets, storage, previews, and dependencies.

**Checks:**

- Confirm ADR-001, ADR-005, ADR-008, ADR-011, ADR-012, ADR-013, ADR-014, ADR-019, ADR-021, ADR-022, and ADR-023 status.
- Confirm whether WORK-004 already contains all required work-item states.
- Confirm whether the delegation refactor phases 1-3 have landed.
- Confirm the current command-envelope endpoint and idempotency behavior.

**Verify:** Another agent can determine authority without reopening all source documents.

### GOV-02: Decision lock

**Owner:** AG-0  
**Dependencies:** GOV-01  
**Output:** Record decisions M1-M15 in the repository's normal decision location. Mark assumptions that remain reversible.

**Hard rule:** Do not start Channels C1 or a production mobile adapter until M1-M6 are recorded.

### GOV-03: Repository path and lease map

**Owner:** AG-0  
**Dependencies:** GOV-01  
**Output:** Map each task in this plan to actual repository paths. The source material fixes some paths, but not the workbench runner module path. Resolve that before coding.

Minimum fixed paths from the source:

- `packages/contracts/src/channel.ts`
- `schemas/channel-*.v1.schema.json`
- `adapters/collaboration/channels/`
- `apps/channels-listener/`
- `apps/web/src/components/ui/`
- `apps/web/components.json`
- `.github/workflows/verify.yml`
- `skills/engineering/verify-preview/SKILL.md`

### GOV-04: Issue and dependency board

**Owner:** AG-0 with AG-1  
**Dependencies:** GOV-03  
**Output:** One issue per task or independently shippable slice, labelled by stream and gate. Every issue includes dependencies, allowed paths, acceptance criteria, and evidence requirements.

**Verify:** No duplicate issues. Every task in the current wave has exactly one owner.

### GOV-05: Merge queue and release manifest

**Owner:** AG-0  
**Dependencies:** G1  
**Output:** A maintained merge order and release manifest showing task status, branch, commit, CI, preview, and gate.

**Rule:** Merge by dependency order, not by whichever agent finishes first.


### GOV-06: Re-review the stably/orca overlap

**Owner:** AG-0 or a dedicated research agent  
**Dependencies:** Before Wave 3 surface expansion  
**Output:** Re-check whether the current stably/orca VPS and mobile fleet-agent capabilities can replace any non-canonical surface work without taking over Frank's control plane.

**Decision rule:** It may replace or accelerate presentation and session-steering pieces only. Work items, policy, provenance, fences, receipts, and canonical state remain Frank-owned. Record adopt, mine, or continue-build with evidence before CH-06 and the broader Wave 3 surface work.

## 8B. Delivery controls

### DEL-01: Adopt the Chrome preview protocol

**Owner:** AG-1  
**Dependencies:** None  
**Output:** Immediate operating rule for every preview deployment.

Required sequence:

1. Deploy to `https://preview.frank.fail/<slug>/`.
2. Open the URL in Chrome.
3. Exercise the change-specific click path.
4. Inspect console errors and failed network requests.
5. Capture screenshots of key states. Capture a GIF for interactive flows when useful.
6. Fix and redeploy before handoff if broken.

**Verify:** Apply the protocol to the next real preview.

### DEL-02: Codify preview verification and evidence

**Owner:** AG-1  
**Dependencies:** DEL-01  
**Output:**

- `skills/engineering/verify-preview/SKILL.md`
- Cross-reference from the existing preview-deploy skill.
- Evidence naming and storage convention by slug and version.
- Failure loop with a maximum of three fix-and-redeploy cycles before escalation.

**Verify:** Skill can be invoked by a fresh agent and produces the required evidence without verbal guidance.

### DEL-03: GitHub verify workflow

**Owner:** AG-1  
**Dependencies:** None  
**Output:** `.github/workflows/verify.yml` using Node 22, pnpm 10.28.0 from `packageManager`, frozen lockfile, and `pnpm run verify`.

**Verify:**

- Deliberate dependency-direction violation produces red CI.
- Revert produces green CI.
- No secrets are required.

### DEL-04: Secret scanning

**Owner:** AG-1  
**Dependencies:** DEL-03  
**Output:**

- Run repository secret scan before push sessions finish.
- Document one-time GitHub setting for secret scanning and push protection.
- Add a release checklist item proving no bot token, VPS secret, or environment file entered the branch.

### DEL-05: Plan-to-issues pipeline

**Owner:** AG-1  
**Dependencies:** GOV-04  
**Output:** Use the existing `skills/engineering/to-tickets` format to convert the active wave into issues with source acceptance criteria.

### DEL-06: Branch hygiene

**Owner:** AG-1  
**Dependencies:** G5  
**Output:** List merged and stale branches and propose deletions. Do not delete without approval.

## 8C. UI foundation and product surfaces

### UI-01: Frank token bridge and shadcn scaffold

**Owner:** AG-2  
**Dependencies:** DEL-01, globals/Tailwind lease  
**Output:**

- Add the shadcn CSS variable bridge after Frank token imports.
- Scaffold `apps/web/src/components/ui/` and `components.json`.
- Add `cn()` using `clsx` and `tailwind-merge`.
- Extend Tailwind v3 configuration additively.
- Vendor component source through the Shadcn UI MCP rather than assuming current CLI defaults fit React 18 and Tailwind 3.
- Keep Frank's icon set and replace Lucide imports during adaptation.

**Verify:**

- `pnpm run verify` green.
- Kitchen-sink page with button, input, and dialog in light and dark themes.
- Signal-colored focus rings.
- No console errors.
- Preview evidence at a versioned slug.

**Rollback:** Remove vendored UI scaffold and revert the additive token and Tailwind mappings.

### UI-02: Tasks console data table

**Owner:** AG-2  
**Dependencies:** UI-01  
**Output:** Replace the hand-built tasks list with a vendored shadcn data table wired to the existing data source. Include sorting, filtering, column visibility, row selection, and keyboard navigation. No API changes.

**Verify:** Sort, filter, selection, column visibility, and keyboard navigation on preview.

### UI-03: Command palette

**Owner:** AG-2  
**Dependencies:** UI-01  
**Output:** Global command palette sourced from the existing console registry. Desktop hotkey and mobile bottom-sheet presentation.

**Verify:** Fuzzy jump to rooms and consoles from any console at desktop and mobile widths.

### UI-04: Overlay migration

**Owner:** AG-2  
**Dependencies:** UI-01, G2 for workbench-specific overlays  
**Output:** Migrate confirmations, approvals, peek cards, worktree panel, composer affordances, and rail menus to vendored dialog, sheet, popover, and dropdown primitives.

**Verify:** Keyboard-only pass for focus trap, tab order, Escape, focus return, and scroll lock. Preserve room tint and identity behavior.

### UI-05: Feedback primitives

**Owner:** AG-2  
**Dependencies:** UI-01  
**Output:** Add Sonner and skeleton primitives for deploy, verify, delegation, polling, preview browser, and research-console feedback. Toasts must not cover the living frame.

### UI-06: Rail hardening

**Owner:** AG-2  
**Dependencies:** UI-01, GitHub token available to Shadcn MCP if block lookup requires it  
**Output:** Use the sidebar block as a reference to improve collapse, mobile drawer, keyboard navigation, and persistence without replacing Frank's room identity or tint logic.

### UI-07: Workbench Running and detail surfaces

**Owner:** AG-2  
**Dependencies:** WB-06 API and SSE contract  
**Output:**

- Running entry showing room, task, step `k/n`, active step note, elapsed state, and Stop.
- Workbench detail view for raw events and evidence.
- Waiting surface linked to the normal decision work item.
- Reconnect snapshot followed by live SSE.

**Verify:** Browser refresh and reconnect show the current snapshot without duplicate events.

### UI-08: Files, folder bindings, and previews

**Owner:** AG-2  
**Dependencies:** FS-02 and FS-05 backend contracts  
**Output:**

- Room folder-binding controls with clear send-only, receive-only, and write-back state.
- Results-waiting-to-sync status.
- Artifacts panel.
- File download and preview URL affordances.
- Staged shared-write approval detail.

### UI-09: Channel binding status

**Owner:** AG-2  
**Dependencies:** CH-06 backend  
**Output:** Bind or inspect a room's Telegram conversation and show truthful health. The web frame remains authoritative if the channel is down.

## 8D. Workbench core

### WB-00: Gating facts

**Owner:** AG-3  
**Dependencies:** None  
**Output:** Record in `docs/plans/BASELINE.md`:

- `ls /dev/kvm`
- `goose --version`
- `goose schedule list`
- `df -h /srv`
- Docker version and ability to run non-root containers with resource limits
- Postgres connectivity and migration mechanism
- Current delegation refactor phase status
- Current `AgentHarnessAdapter` and ACP capability
- Preview lane health
- Available CPU, memory, and disk facts needed to set a conservative concurrency limit

**Important:** The source does not specify a safe parallel workbench count. Record capacity facts and let AG-0 set the first limit. Do not guess.

### WB-01: Persisted workbench record and migration

**Owner:** AG-3  
**Dependencies:** G0, schema lease  
**Output:** Postgres schema for the workbench record, plan steps, append-only events, artifacts, receipt, and optional schedule reference. Link each record to a work item and room.

**Rules:**

- No separate task state machine.
- Event order is durable.
- Workbench creation is idempotent against the delegation command key.
- Migrations include rollback instructions.

**Verify:** Create, read, append events, and reconstruct a run snapshot from Postgres.

### WB-02: Runner service and queue skeleton

**Owner:** AG-3  
**Dependencies:** WB-01  
**Output:** A server-owned runner loop that claims queued work, provisions a workspace, invokes a harness adapter, records events, and finalizes a receipt.

**Minimum behavior:**

- Safe claim so two runner processes cannot execute the same workbench.
- Recovery scan after runner restart.
- Explicit terminal-state handling.
- Conservative concurrency limit from WB-00 facts.
- Orphaned container and volume cleanup path.

### WB-03: Docker workspace and mount fence

**Owner:** AG-3  
**Dependencies:** WB-02  
**Output:** One container per workbench with:

- Non-root user.
- CPU and memory limits.
- Scratch workspace volume.
- Explicit task mounts only.
- Mount modes `ro`, `rw`, and staged-copy support.
- No access to Docker socket.
- Network profile supplied by the task definition.

**Verify:**

- Attempted write to another room fails at OS level.
- Read-only mount rejects writes.
- Container exits without leaving an active process or writable orphan mount.

### WB-04: Harness adapter and Goose recipe

**Status:** ✅ Landed (merged to main at `9068898`) as the Goose half of the split recorded below (WB-04B). The generic seam is `AgentHarnessAdapter` (`packages/contracts/src/harness.ts`).

**Owner:** AG-3  
**Dependencies:** WB-02, existing ADR-023 adapter  
**Output:**

- Goose headless adapter using a recipe template.
- Recipe requires standalone instruction, 3 to 10 step plan publication, step updates, artifact registration, and receipt output.
- Skills mounted from the approved skills directory.
- ACP path where supported.
- `agentapi` mapping documented for non-ACP CLIs.

**Verify:** A trivial task reaches a receipt through the adapter without runner code importing Goose internals.

### WB-04B: GooseHarnessAdapter

**Status:** ✅ Landed with WB-04 (merged `9068898`).

### WB-04C: PrimeAgentHarnessAdapter

**Owner:** AG-3 (post-G2)
**Dependencies:** WB-02..05 merged; Prime spike green (session-resume path PROVEN, not assumed — Prime ACP exposes no session/load today)
**Output:** The second real adapter per M16. A `frank-prime-sidecar` inside the workbench container owns the Prime Agent ACP stdin/stdout (Prime's ACP = one session per connection, one active prompt, fixed working directory; the process exits when ACP stdin closes — one workbench per process). The sidecar maps ACP events plus namespaced `_meta` (subagent status, quality gates, goals, compaction) to `HarnessEvent`s, stores the Prime session identifier, and exposes health + cancellation. Prime-specific types never leak past the adapter.

**Constraints (PA rules, non-negotiable):**

- One Prime environment per workbench: own container, state directory, credentials, root session, child-agent tree, and only its declared mounts. No shared daemon across rooms.
- Frank's sandbox stays mandatory: Prime inside Docker + `srt` + explicit ro/rw/staged mounts + CPU/mem limits. Prime's worker/kernel split is lifecycle recovery, NOT security.
- Frank owns schedules: Prime's persistent cron disabled in production workbenches; every scheduled firing creates a fresh workbench (W9). Short-lived in-run heartbeats allowed.
- Frank's outer leash is authoritative (e.g. Frank 30 min / Prime inner 27 min / Frank hard-kill 30 min). Spend caps, container kill, and the audited cancellation transition stay Frank's.
- `/refine` and any global harness store are disabled in release 1. Refinement output may become a candidate artifact; promotion to a canonical Frank skill/memory requires a staged change + ADR-022 approval. Frank memory/skills remain the only canonical stores.
- Prime child agents (`rlm(...)`) are internal to one workbench: never Frank rooms, work items, Buzz identities, or approval authorities. The Running surface stays the Frank 3-to-10-step plan; child status is detail-view evidence.

**Verify:** File fence (cross-room write fails at OS level); cancellation reaches `cancelled` under 5s; runner/adapter/container restart recovers without replaying tool actions; nested-agent activity stays inside the fence; inner+outer budgets both stop correctly; shared write becomes a Frank waiting item; artifacts register through Frank; full structured receipt; upgrade smoke test detects incompatible ACP/`_meta` changes.

### WB-04D: Frank bridge skill for Prime

**Owner:** AG-3 with AG-7
**Dependencies:** WB-04C
**Output:** A controlled `frank` skill (Python-backed, Prime's executable skill system) exposing structured calls — `publish_plan`, `update_step`, `request_decision`, `register_artifact`, `publish_receipt` — so Prime emits structured W5/W6/W7 events instead of prose Frank must infer. Skills mount from Frank's canonical `skills/` (never a parallel Prime library); Frank selects relevant skills per task via `taskDef.skills` — all approved skills stay linked, only relevant ones load.

**Verify:** A trivial Prime task reaches a complete structured receipt through the bridge with zero prose parsing.

### WB-04E: Cross-harness contract tests + evaluation

**Owner:** AG-3
**Dependencies:** WB-04B + WB-04C
**Output:** The same representative task definitions run under Goose and Prime must produce identical Frank-level outputs: plan, step transitions, decision requests, artifacts, receipt, cancellation, honest timeout. Internal event streams may differ. The evaluation records completion rate, human interventions, wall-clock, token/$ cost, recovery correctness, quality-gate success, receipt quality, and event-mapping complexity — the evidence for the default-engine routing decision (recommendation only until proven: Prime for complex/long-running/parallel-specialist work, Goose for deterministic recipes).

**Verify:** Both harnesses pass the same suite; comparison table recorded in the evaluation report.

### WB-05: Delegation front door

**Owner:** AG-3  
**Dependencies:** WB-01 to WB-04, delegation refactor phases 1-3  
**Output:** Replace `delegation-store.run() -> runTurn()` with `createWorkbench()` while retaining proposal, confirmation, idempotency, and delegate-tool behavior.

**Verify:** Delegate from Central, create exactly one workbench, and observe the expected work-item and audit entries.

### WB-06: Plan events and SSE

**Owner:** AG-3  
**Dependencies:** WB-04, WB-05  
**Output:**

- Persist plan before substantive work.
- Append step updates.
- `GET /v1/workbenches/:id/events` sends a snapshot on connect followed by live events.
- Reconnect resumes without duplicates or gaps.

**Verify:** UI shows step `k/n`, refreshes, and continues from current state.

### WB-07: Leash and cancellation

**Owner:** AG-3  
**Dependencies:** WB-02  
**Output:** Runner-enforced wall-clock timeout, token or spend budget hooks, and first-class Stop/cancel.

**Verify:**

- Stop halts the active process in under 5 seconds under normal VPS load.
- Timeout produces a truthful error receipt.
- Cancel and timeout both create audit entries and terminal work-item states.
- Model output cannot disable the leash.

### WB-08: Artifacts, receipt, and Central verification

**Owner:** AG-3  
**Dependencies:** WB-04 to WB-07  
**Output:**

- Artifact registration API.
- Receipt schema and room-thread message.
- Verification state before done.
- Central can reopen with a note rather than silently accepting bad output.

**Verify:** A comparison-sheet task leaves a file, optional preview URL, five-line receipt, and no file-body chat dump.

### WB-09: Restart durability and cleanup

**Owner:** AG-3  
**Dependencies:** WB-02, WB-06, WB-07  
**Output:**

- Runner restart recovery.
- Reconciliation for workbenches left in provisioning, running, waiting, or verifying.
- Container, volume, and temporary-file cleanup.
- Honest failure receipt when automatic recovery is unsafe.

**Verify:** Restart the runner during execution and during waiting. The run resumes or terminates honestly without duplication.

### WB-10: Harness swap proof

**Owner:** AG-3  
**Dependencies:** WB-04B (Goose), WB-04C (Prime Agent), WB-04E suite  
**Output:** Execute the same task definition under Harness 1 = Goose and Harness 2 = Prime Agent (M16) with no change outside adapter configuration. Both must produce the same Frank-level outputs: plan, step transitions, decision requests, artifacts, receipt, cancellation, honest timeout result.

**Verify:** Both runs produce equivalent plan, artifact, and receipt structures. The WB-04E comparison report decides whether Prime becomes the default engine for complex delegated work (Goose remains the deterministic fallback either way).

## 8E. Human loop and Channels

### CH-00: Throwaway direct Telegram spike

**Owner:** AG-4  
**Dependencies:** Telegram bot token supplied through a safe temporary mechanism  
**Location:** Outside the monorepo  
**Output:** Direct Telegram adapter, hardcoded card, two buttons, stub endpoint, and real VPS execution using the SDK's direct lifecycle seam.

**Questions answered:**

- Does `channel["ɵruntime"].start()` work on the VPS outside the scratch probe?
- Does a real button interaction reach the VPS reliably?
- Does polling mode behave without a public webhook?

**Verify:** Button tap on Steven's phone produces a VPS log entry.

**After verification:** Delete the spike. Do not promote its MemoryStore or hardcoded state into the repository.

### CH-01: ChannelPort contract

**Owner:** AG-4 with contract lease from AG-0  
**Dependencies:** CH-00, GOV-02  
**Output:**

- `packages/contracts/src/channel.ts`
- Export from the contracts index.
- Versioned schemas and examples.
- Neutral Frank-owned `ChannelContent` shape.
- `ChannelHealth` mirroring the truthful health posture used for Buzz.

**Contract semantics:**

- `notify()` posts Frank-authored content.
- `requestDecision()` registers and surfaces a waiting work item. Durable resolution arrives asynchronously through an inbound event and command envelope.
- `update()` changes a posted card's rendered state.
- `bind()` associates a Frank room with a platform conversation.
- `health()` reports truthful adapter state.

**Hard rules:**

- Contracts do not import channels-ui or any pre-1.0 third-party type.
- No contract suggests that a surface is an authority.

**Verify:** `pnpm run contracts:validate` and `pnpm run registry:check` green.

### CH-02: Postgres StateStore

**Owner:** AG-4  
**Dependencies:** CH-01, Postgres test environment  
**Output:** StateStore implementation covering key-value, list, lock, deduplication, and queue semantics with TTL and overflow behavior.

**Verify:** `runStateStoreConformance` passes against real Postgres.

**Hard gate:** CH-03 and CH-04 cannot start against production code until conformance is green.

### CH-03: Channels adapter and listener app

**Owner:** AG-4  
**Dependencies:** CH-01, CH-02  
**Output:**

- `adapters/collaboration/channels/`
- `apps/channels-listener/`
- The adapter package depends only on `@frank/contracts`, matching the existing collaboration-adapter direction.
- Direct Telegram adapter only.
- One internal use of `ɵruntime` inside the adapter package.
- Listener communicates with `apps/api` over HTTP.
- Health and restart behavior.

**Verify:** Listener restart does not lose registered actions or canonical work.

### CH-04: Notify and approve

**Owner:** AG-4  
**Dependencies:** CH-03, WB decision seam, command endpoint  
**Output:**

- Render a waiting decision as a native Telegram card.
- Include room, requested action, `why_now`, `next_safe_action`, and material evidence.
- Approve and Deny buttons submit normal command envelopes.
- Update the card in place after resolution.
- Handle expired action, stale `expected_version`, and already-resolved work clearly.

**Verify:**

- Real shared-folder or equivalent gated action creates a card.
- Approve moves `waiting -> ready` through the API.
- Full audit entry contains command envelope.
- Double-tap fails safely on optimistic concurrency.
- Approval in web followed by phone tap shows already resolved rather than executing twice.

### CH-05: Identity, secrets, and telemetry

**Owner:** AG-4  
**Dependencies:** CH-03  
**Output:**

- `identifyUser` resolves only Steven's bound identity. Unknown users are rejected.
- Bot token enters through OpenBao or the accepted secret path.
- `COPILOTKIT_TELEMETRY_DISABLED=true` in deployment configuration.
- Automated assertion that telemetry remains disabled.

### CH-06: Room binding and state push

**Owner:** AG-4  
**Dependencies:** CH-04, stable outbox events  
**Output:**

- Bind Frank rooms to Telegram conversations.
- Push brief, Waiting, and selected Running state changes.
- Apply frame discipline. Do not stream every step or tool event into chat.
- Support message update rather than card spam.

**Verify:** Delegation state appears on phone. Channel outage does not alter web state or canonical records.

### CH-07: Expiry, outage, and adapter exit test

**Owner:** AG-4  
**Dependencies:** CH-04, CH-06  
**Output:**

- Deliberate action retention policy.
- Resolved and expired card behavior.
- Delivery retry and dead-letter or audit behavior.
- Smoke test that detects SDK lifecycle breakage during upgrades.
- Documented exit path to a direct Grammy implementation behind ChannelPort.

### CH-08: Optional ntfy adapter

**Owner:** Not scheduled in release 1  
**Dependencies:** G5 and explicit decision that notification-shade action buttons are still needed  
**Rule:** Implement as an alternate decision notifier that submits the same command envelope. Do not enable it beside Telegram for the same binding.

## 8F. Workbench decision seam

### HITL-01: Decision work item from inside a run

**Owner:** AG-3  
**Dependencies:** WB-04, ADR-022 implementation  
**Output:** Harness or runner can request a decision with structured context. Frank creates a normal decision work item in `waiting`, records an event, and pauses only the affected branch or run.

**Verify:** Decision is indistinguishable in the API from other ADR-022 approvals.

### HITL-02: Pause, resume, deny, and restart

**Owner:** AG-3  
**Dependencies:** HITL-01  
**Output:**

- Resume after `ready` command.
- Cancel or safe-fail after `cancel` command.
- Waiting state survives runner restart.
- Duplicate or stale commands are rejected through expected-version semantics.

**Verify:** API-only test passes before mobile integration. Then repeat through CH-04.

### HITL-03: Ask less, record assumptions

**Owner:** AG-3 with product tests by AG-0  
**Dependencies:** HITL-01  
**Output:** Recipe and harness guidance asks only when the path is irreversible, destructive, spend-gated, cross-fence, or explicitly policy-gated. Reversible assumptions go into the receipt.

**Verify:** Representative tasks do not create unnecessary waiting items.

## 8G. Connected folders and deliverables

### FS-01: Syncthing deployment

**Owner:** AG-5  
**Dependencies:** G3  
**Output:** Self-hosted Syncthing connection between Steven's Windows PC and the VPS, with documented device identity, safe firewall configuration, `.stignore`, and recovery behavior.

**Default direction:** PC Send Only, VPS Receive Only.

**Verify:** A test file reaches the VPS copy. Unplugging the PC does not stop an already-started workbench.

### FS-02: Room folder bindings backend

**Owner:** AG-5  
**Dependencies:** FS-01  
**Output:** Room-to-folder binding records and APIs. Each binding declares source, server path, sync direction, workbench mount mode, and write-back permission.

**Verify:** A workbench receives only the folders bound to its room and task definition.

### FS-03: Mount plumbing and staged shared writes

**Owner:** AG-5 with AG-3 interface  
**Dependencies:** FS-02, WB-03, HITL-01  
**Output:**

- Bind synced copies into workbenches.
- Enforce `ro`, `rw`, and `staged` behavior.
- Shared-folder write produces a staged copy and decision work item.
- Approved write lands through a controlled operation outside the harness.

**Verify:** Direct shared write fails. Approved staged write succeeds and is fully audited.

### FS-04: Write-back and offline behavior

**Owner:** AG-5  
**Dependencies:** FS-02, FS-03  
**Output:**

- Write-back is opt-in per folder.
- Offline PC state becomes `results waiting to sync`, not workbench failure.
- Conflicts are surfaced honestly. No automatic destructive override.

**Clarification:** A workbench can continue with the server copy while the laptop is closed. Results sync back when the PC reconnects. The plan must not claim live write-back to an offline device.

### FS-05: Artifact and preview backend

**Owner:** AG-5 with AG-3 interface  
**Dependencies:** WB-08  
**Output:**

- Register files into room Files.
- Classify artifact kind.
- Auto-deploy viewable HTML, reports, or mockups to the existing preview lane.
- Return preview URL to the receipt and UI.

**Verify:** Viewable output produces a working preview URL that passes DEL-01.

### FS-06: Connected-folder acceptance

**Owner:** AG-5  
**Dependencies:** FS-01 to FS-05, UI-08  
**Output:** End-to-end evidence for a realistic CSV cleanup or file-generation task.

**Verify:**

1. Source data is synced before the run.
2. Laptop is closed or disconnected.
3. Workbench completes against the VPS copy.
4. Result is marked waiting to sync.
5. PC reconnects and receives the result only when write-back is enabled.

## 8H. Scheduling and sandbox hardening

### SS-01: Scheduled workbench definitions

**Owner:** AG-6  
**Dependencies:** G3, Goose scheduler confirmed in WB-00  
**Output:** Task definitions can carry cron and timezone. Each firing creates a new work item and new workbench.

**Hard rule:** Consecutive runs share no scratch workspace state.

### SS-02: Goose schedule and receipt routing

**Owner:** AG-6  
**Dependencies:** SS-01, WB-08  
**Output:** Use Goose schedule as the interim trigger. Route the resulting run through the normal runner, room receipt, audit, and verification paths.

**Verify:** A test schedule fires with all clients closed and leaves a receipt in the intended room.

### SS-03: `srt` filesystem and egress profiles

**Owner:** AG-6  
**Dependencies:** WB-03  
**Output:** Wrap harness execution with `sandbox-runtime`, enforce task-specific domain allowlists, and preserve explicit filesystem policy.

**Verify:** `curl` to a non-allowlisted domain fails inside the workbench. Required allowlisted access succeeds.

### SS-04: Conditional microsandbox pilot

**Owner:** AG-6  
**Dependencies:** WB-00 confirms `/dev/kvm`, SS-03 complete  
**Output:** Runner backend number two using microsandbox for selected untrusted or network-heavy tasks.

**If KVM is absent:** Record the result and close the task as not applicable. Do not change hosts inside this program.

**Verify:** Same workbench contract runs under Docker/srt and microsandbox backends.

### SS-05: Per-task harness and model selection

**Owner:** AG-6 with AG-3 interface  
**Dependencies:** provider registry available, WB-04  
**Output:** Select adapter, provider, and model through the task definition and provider registry. No hardcoded provider in the runner.

### SS-06: Hermes migration

**Owner:** AG-6 with AG-4  
**Dependencies:** CH-06, SS-02, G4  
**Output:**

- Channels becomes the owned Telegram messaging path.
- Hermes retains autonomous background work during migration.
- Move cron jobs one by one to scheduled workbenches only after each produces correct receipts and evidence.
- Remove duplicate delivery so one event does not reach the same phone from two systems.

### SS-07: Temporal migration boundary

**Owner:** Documentation only  
**Dependencies:** None  
**Output:** Define the queue and schedule interface that Temporal will replace later. Do not deploy Temporal in this program.

## 8I. Claude plugin

### PLG-01: Select the core skill set

**Owner:** AG-7  
**Dependencies:** None  
**Output:** Include only:

- `frank-tdd`
- `frank-debug`
- `preview-deploy`
- `verify-preview`
- `code-review`
- `to-tickets`
- a distilled `frank-rules` skill containing Rule 0 and precedence

Exclude `in-progress/`, `deprecated/`, and `misc/last30days` from version 0.1.0.

### PLG-02: Scaffold and package

**Owner:** AG-7  
**Dependencies:** DEL-02, PLG-01  
**Output:** Plugin manifest, selected skills, adaptation for Claude assumptions, version 0.1.0, and a repeatable build script or checklist. In-repository skills remain canonical.

### PLG-03: Install and smoke test

**Owner:** AG-7  
**Dependencies:** PLG-02  
**Output:** Install on desktop and open a fresh session without the Frank folder connected.

**Verify:**

- Asking to deploy a preview applies Rule 0.
- Asking for Frank's rules returns the correct precedence and preview process.
- The session does not need to rediscover the repository first.

### PLG-04: Trigger eval

**Owner:** AG-7  
**Dependencies:** PLG-03  
**Output:** Run the available skill evaluation harness against representative prompts such as bug fixing, preview deployment, review, and ticket conversion. Update descriptions based on measured trigger errors.

## 9. Adopt versus build

| Concern | Adopt | Frank builds |
|---|---|---|
| Default task engine | Goose headless, recipes, sub-recipes | Plan and receipt recipe templates |
| Complex coding/research execution | Prime Agent (pinned exact version) behind `AgentHarnessAdapter` | `PrimeAgentHarnessAdapter`, per-workbench sidecar, ACP/`_meta` event mapping, Frank bridge skill, cross-harness tests |
| Harness protocol | ACP | Adapter mapping and runner client behavior |
| Non-ACP CLI wrapper | `coder/agentapi` | Event mapping into workbench events |
| Sandbox policy | Docker plus `srt` | Task-specific mounts, limits, and egress profiles |
| Conditional microVM | microsandbox | Second runner backend |
| Phone interaction | Direct `@copilotkit/channels` Telegram adapter | ChannelPort adapter, Postgres StateStore, cards, command routing |
| Connected folders | Syncthing | Room binding UI and workbench mount plumbing |
| Interim scheduling | Goose schedule | Fresh workbench creation and receipt routing |
| Skills format | agentskills.io and approved skill packs | Skill selection and workspace mounting |
| Web components | Vendored shadcn/ui source | Frank token bridge and product-specific composition |
| CI | GitHub Actions | Exact verify workflow and repository gates |
| Preview verification | Chrome and existing preview lane | Skill, evidence format, and mandatory execution process |
| Core control plane | No suitable external product | Work-item spine, runner, events, receipts, verification, fences, and UI |

## 10. Acceptance matrix

| Requirement | Test | Owner | Gate |
|---|---|---|---|
| W1 Fire and forget | Start a 20+ minute representative task, close every client, reconnect from another device, observe mid-run or completed receipt | AG-3, AG-2 | G2/G5 |
| W2 No second state machine | Reconstruct every transition from work-item audit history and workbench events | AG-0, AG-3 | G5 |
| W3 Physical fence | Attempt cross-room and read-only writes from inside the container | AG-3 | G2 |
| W4 Swappable harness | Run same task definition under two adapters | AG-3 | G5 |
| W5 Plan, not log | Running shows step `k/n`; room thread contains start handoff and final receipt only | AG-2, AG-3 | G2/G5 |
| W6 Human decision | Gated action creates waiting work; Telegram Approve resumes through command envelope | AG-3, AG-4 | G3 |
| W7 Deliverables and receipt | File and preview URL land; no long chat dump | AG-3, AG-5, AG-2 | G4 |
| W8 Connected folders | Run continues with PC offline; result syncs later only when write-back is enabled | AG-5 | G4 |
| W9 Scheduling | Scheduled task fires with all clients closed, fresh workspace, normal receipt | AG-6 | G4 |
| W10 Leash | Stop under 5 seconds; timeout and budget stop leave honest receipts | AG-3 | G2/G5 |
| Durable mobile action | Restart listener between post and click; action still resolves | AG-4 | G3 |
| Optimistic concurrency | Double-tap and cross-surface second approval fail safely | AG-4 | G3 |
| Channel outage isolation | Disable listener; web and canonical state remain correct | AG-4, AG-2 | G4/G5 |
| No managed gateway | Network and dependency inspection show direct adapter path only | AG-4 | G3 |
| Telemetry disabled | Automated test and deployment environment assertion | AG-4 | G3 |
| Preview discipline | Visible change has exercised Chrome path, console check, screenshot evidence | AG-1 | Every visible task |
| UI accessibility | Keyboard-only overlay and table pass; mobile command palette works | AG-2 | G5 |
| CI enforcement | Deliberate red/green proof and normal branch green | AG-1 | G1 |
| Plugin portability | Fresh session applies Rule 0 without connected repository | AG-7 | G5 |

## 11. Operational requirements for a safe release

These items coordinate the source requirements into production behavior. They do not add a second product scope.

### 11.1 Concurrency and backpressure

- WB-00 records actual VPS capacity.
- AG-0 selects an initial maximum concurrent workbench count from those facts.
- The runner queues excess work rather than overcommitting memory, disk, or browser processes.
- Browser-enabled workbenches may require a lower separate limit.
- The source does not define numeric limits. Do not invent them before measurement.

### 11.2 Disk management

- Set per-workbench workspace limits where supported.
- Record disk usage in run evidence.
- Clean completed scratch workspaces according to an explicit retention rule.
- Never delete registered artifacts or receipts as part of scratch cleanup.
- Alert or block new provisioning before `/srv` exhaustion.

### 11.3 Recovery

- On runner start, reconcile every non-terminal workbench.
- Recovery must be idempotent.
- If process state cannot be trusted, stop the workbench and issue an honest failure receipt rather than silently replaying destructive steps.
- Waiting decisions survive runner and listener restart.

### 11.4 Observability

Minimum operational signals:

- Workbenches by state.
- Queue depth and claim latency.
- Provisioning duration.
- Active step duration.
- Decisions waiting and oldest waiting age.
- Stops, timeouts, and budget terminations.
- Container and workspace cleanup failures.
- Disk usage.
- Channel delivery failures, expired actions, and stale-version interactions.
- Syncthing disconnected state and results waiting to sync.

The existing audit and outbox remain the evidence source. Metrics must not become another state authority.

### 11.5 Security

- Non-root workbench processes.
- No Docker socket inside workbenches.
- Explicit mounts only.
- Default-deny or explicit egress policy.
- OpenBao or accepted short-lived secret injection.
- No secrets in images, repositories, preview content, evidence screenshots, or synced folders.
- Unknown Telegram users are rejected before any work-item lookup is exposed.

## 12. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Channels SDK API churn and internal lifecycle seam | High | Pin exact version, isolate `ɵruntime` to one adapter file, run upgrade smoke test, retain direct Grammy exit path |
| Prime Agent pre-1.0 API churn (v0.6/v0.7 breaking changes) | High | Pin exact version (no caret), all Prime types behind `PrimeAgentHarnessAdapter`, upgrade smoke test, never expose daemon/`_meta` to Frank contracts, Goose fallback always on |
| Pending approval orphaned by restart | High | Postgres StateStore is a hard gate; conformance suite must pass before CH-03/CH-04 |
| Mobile surface gains authority by convenience | High | Every button calls the normal command endpoint; contract and integration tests reject direct mutation |
| Duplicate Telegram and ntfy decisions | High | One active interactive decision surface per binding; ntfy deferred |
| Runner duplicates a workbench after restart | High | Safe DB claim, idempotency key, recovery reconciliation, audit test |
| Cross-room write caused by bad model behavior | High | OS mounts and staged-write mechanism, not prompt rules |
| VPS resource exhaustion | High | Measured concurrency limit, queueing, container limits, disk guard, browser-specific cap |
| KVM unavailable | Medium | Docker and `srt` remain release path; microsandbox closes as not applicable |
| `agentapi` terminal parsing breaks after CLI update | Medium | Pin versions, adapter smoke tests, prefer ACP where supported |
| Syncthing conflict or unsafe write-back | Medium | Send-only default, explicit write-back, no automatic destructive override, visible conflict state |
| shadcn source assumes React 19 or Tailwind 4 | Medium | Vendor through MCP, adapt per component, verify both themes before migration |
| UI migration damages room tint or living frame | Medium | One overlay per preview, keyboard tests, preserve Frank identity logic |
| Public preview captures sensitive information | Medium | Use non-sensitive fixtures; inspect screenshots before storing; existing no-secrets rule remains |
| CI and local verify diverge | Medium | Same command, Node 22, frozen lockfile, treat divergence as a repository defect |
| Plugin drifts from canonical skills | Medium | Repository skills remain source; repeatable package generation and version bump |
| Channel outage confuses users | Low to Medium | Truthful health in web, canonical state unaffected, retry and expiry messages |

## 13. Deferred and rejected items

### 13.1 Deferred

- Channels C5 full AG-UI room conversation.
- Temporal queue and schedule migration.
- ntfy notification-shade adapter.
- WhatsApp adapter after Telegram proves the architecture.
- Slack, Teams, and Discord.
- Persistent browser service using Steel.
- Full mobile live steering using Happy.
- MicroVM host change if the current VPS lacks KVM.
- Supabase backup or replica role, which requires an ADR.
- Dataviz work unrelated to an active console slice.

### 13.2 Rejected for this layer

- CopilotKit managed Intelligence path.
- Channels BuiltInAgent.
- Channels transcript store.
- Direct database mutation from a channel interaction.
- `ɵruntime` usage outside the adapter package.
- MemoryStore in production.
- OpenHands as Frank's control plane. If WB-02 through WB-05 cannot be stabilized after the planned runner slice, a separate evaluation may inspect OpenHands Agent Server as a bounded execution substrate, never as the canonical control plane.
- E2B self-hosting for this VPS architecture.
- Daytona OSS.
- Vibe Kanban as a dependency.
- Claude Squad, Crystal, or cmux as the product surface.
- Tweakcn themes.
- Vercel previews.

## 14. Definition of done for every task

A task is complete only when all applicable items are true:

- The assigned acceptance test passes.
- `pnpm run verify` is green locally.
- CI is green.
- Contracts and schemas validate when touched.
- A visible change has a preview URL.
- The agent opened the preview in Chrome and exercised the relevant path.
- Console and network errors were checked.
- Evidence is attached using the agreed convention.
- No secret entered code, logs, screenshots, or preview fixtures.
- A rollback instruction exists.
- The branch contains an intentional commit and handoff.
- AG-0 confirms the next dependency is unblocked.

## 15. Agent task packet template

Use this block when assigning any task to an execution agent.

```md
# Task <ID>: <title>

Owner: <agent>
Branch: agent/<stream>/<task-id>-<slug>
Gate: <gate>
Status: READY | BLOCKED

## Goal
<One observable outcome.>

## Authority
- ADRs: <list>
- Plan sections: <list>
- Existing contracts: <list>

## Dependencies
- <completed task or external fact>

## Allowed paths
- <paths>

## Forbidden paths
- <paths owned by other agents>

## Non-negotiable constraints
- <state, security, dependency, and UX rules>

## Deliverables
- <files, migration, endpoint, UI, docs>

## Acceptance tests
1. <test>
2. <test>

## Required commands
- pnpm run verify
- <stream-specific commands>

## Preview path
- https://preview.frank.fail/<slug>/

## Evidence
- Screenshots:
- Console/network check:
- Logs or audit entries:

## Rollback
<Exact rollback.>

## Handoff
- Files changed:
- Assumptions:
- Known limitations:
- Commit:
- Next task unblocked:
```

## 16. Immediate parallel launch packet

The following tasks can start first without waiting for the entire program to be decomposed again.

### AG-0: Integration

Start:

- GOV-01 Authority audit
- GOV-02 Decision lock
- GOV-03 Repository path and lease map
- GOV-04 Initial issue board

Do not start feature coding.

### AG-1: Delivery controls

Start:

- DEL-01 Chrome preview protocol
- DEL-03 GitHub verify workflow

Then:

- DEL-02 verify-preview skill
- DEL-04 secret scanning

### AG-3: Workbench core

Start:

- WB-00 Gating facts

Then wait for G0 before:

- WB-01 persisted record
- WB-02 runner skeleton

### AG-4: Channels

Start:

- CH-00 throwaway Telegram spike

Then wait for GOV-02 before:

- CH-01 ChannelPort
- CH-02 Postgres StateStore

### AG-2: Web UI

Start UI-01 only after:

- DEL-01 is active.
- AG-0 grants the globals/Tailwind lease.
- M7 and M8 are recorded.

### AG-7: Plugin

Start:

- PLG-01 skill selection

Wait for DEL-02 before PLG-02.

### AG-5: Folders

Before G3, prepare only:

- Syncthing deployment checklist.
- Backend interface proposal.
- End-to-end test fixture.

Do not modify workbench mounts or production APIs before G3.

### AG-6: Scheduling and sandbox

Before G3, prepare only:

- Goose schedule fixture.
- `srt` egress test profile.
- Microsandbox applicability note based on WB-00.

Do not integrate scheduled workbenches before G3.

## 17. Final release receipt

AG-0 publishes one final receipt containing:

- What shipped.
- Which source decisions were implemented.
- Which assumptions were changed.
- Every accepted ADR involved.
- Gate results and evidence links.
- The full W1-W10 acceptance result.
- Mobile approval and concurrency test result.
- Channel outage result.
- Connected-folder and scheduled-run result.
- Harness swap result.
- CI, preview, accessibility, and plugin result.
- Open risks.
- Deferred tasks and their explicit trigger.
- Rollback path for each deployed service.

The release is not complete until the receipt can be used to reconstruct why every major behavior exists and how it was verified.
