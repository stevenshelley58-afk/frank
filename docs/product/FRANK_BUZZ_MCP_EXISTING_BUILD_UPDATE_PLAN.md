# FRANK Existing-Build Update Plan — Buzz and MCP 2026-07-28

**Date:** 29 July 2026  
**Status:** Executable handoff  
**Authority:** `FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` version 1.1  
**Audience:** A coding agent with no prior context  

## 1. Objective

Update the existing FRANK concept and the eventual application so that:

1. Buzz is the strategic private human-agent workspace and bounded agent mesh.
2. FRANK remains the durable owner of life/build records, workflows, schedules, policy, secrets, approvals, effect receipts, evidence, and external audit anchoring.
3. MCP 2026-07-28 is the preferred tool protocol, including its stateless core, Multi Round-Trip Requests, cache semantics, Apps, Tasks, and hardened authorization.
4. Every visible action reports truthful state. A static button must never imply that a message was sent, an agent ran, or a release shipped.
5. Existing Buzz work is reused before equivalent custom code is written.

Do not reinterpret these decisions. If implementation evidence conflicts with an assumption below, record the evidence, preserve the boundary, and update the implementation note.

## 2. Current repository truth

The current workspace contains:

- a controlling Markdown specification and generated Word document;
- historical V2, V3, and white-label notes;
- `outputs/frank-os-clickable/`, a static HTML/CSS/JavaScript interaction concept;
- `outputs/agent-os-mockup/`, an older static concept;
- document-generation and render scripts under `work/`.

It does **not** contain:

- a backend API;
- PostgreSQL or object-storage schemas;
- Temporal workflows;
- a Buzz relay or `buzz-*` packages;
- Nostr key management;
- an MCP host, client, or Capability Broker;
- model or harness adapters;
- authentication, secrets, sandboxes, connectors, telemetry, CI, or deployment manifests.

Therefore, the immediate code update can make the static concept accurate and demonstrate intended interactions. It cannot truthfully claim to implement FRANK, Buzz, MCP, agents, or deployments. The service work below must be applied to the actual application repository when it exists, or used as the file structure for creating it.

## 3. Locked architectural decisions

### 3.1 Buzz

- Use Buzz for rooms, threads, signed Nostr collaboration identities/events, human-agent presence, ACP presentation and steering, agent/CLI tooling, project/branch conversation, Git/NIP-34 events, and bounded room-local automations.
- Prefer maintained upstream relay, desktop/mobile clients, `buzz-acp`, `buzz-agent`, `buzz-dev-mcp`, `buzz-cli`, custom ACP harness definitions, official Compose, and official Helm assets.
- Maintain only a small `frank-buzz` integration layer. Do not fork the Buzz UI or relay to reproduce FRANK branding.
- Track upstream `main` in a daily canary. Production runs a tested immutable commit/image.
- Buzz room data is private on the dedicated VPS but readable by that server until compatible end-to-end encryption is proven.
- Never place raw credentials, recovery material, trust roots, broad connector tokens, or policy-prohibited records in Buzz.
- A Buzz event may propose an action. It cannot, by itself, authorize production deployment or another consequential effect.
- Buzz workflows may perform reversible room-local work. Temporal owns durable recurrence, long-running life/build work, retries, pending input, approval waits, and consequential effects.
- Keep the selected production forge authoritative until Buzz Git hosting passes the full forge and recovery suite.

### 3.2 MCP 2026-07-28

- The FRANK Capability Broker is the sole managed MCP host/client.
- The preferred edge is stateless. Do not use `initialize`, `initialized`, `Mcp-Session-Id`, sticky sessions, or hidden gateway workflow state.
- Validate `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, authenticated identity, `_meta`, capabilities, and body together.
- Map `input_required` to a durable FRANK Input Request.
- Map MCP Tasks to canonical FRANK Runs and Actions. A Task handle is never the only record of work.
- Sandbox MCP Apps on an isolated origin. Do not expose raw secrets to an App.
- Bind OAuth/OIDC credentials to the verified issuer and audience. Prefer Client ID Metadata Documents.
- Put deprecated protocol behavior behind a measured compatibility adapter with a removal record.
- Capability-probe Claude products. “Rolling out” is not evidence that a particular Claude surface supports every feature.

### 3.3 FRANK

- PostgreSQL and object storage remain canonical.
- Temporal remains the durable workflow and scheduler implementation behind `WorkflowPort`.
- All effectful tools use an Action Envelope and invocation ledger.
- Approval is artifact-bound, actor-bound, policy-bound, expiring, and replay-protected.
- Harness and model selection remain separate.
- Every customer later receives a completely isolated cell.

## 4. Review findings

| Severity | Finding | Evidence in current workspace | Required correction |
|---|---|---|---|
| Critical | The clickable concept can visually “ship” a release without a backend, policy decision, action envelope, or receipt. | `outputs/frank-os-clickable/app.js` removes a local approval card; several buttons say “Approve & ship.” | Label the interaction as a simulation. Change the room action to “Send approval intent to FRANK.” Show policy validation and a mock receipt before a simulated shipped state. |
| High | The room says “encrypted on your VPS,” but current Buzz room content is server-readable rather than generally end-to-end encrypted. | `outputs/frank-os-clickable/index.html`, room day divider. | Replace with “Private on your VPS · server-readable.” Add a concise details explanation. |
| High | “Agents can act” hides the capability boundary and can imply unrestricted execution. | Room composer in `index.html`. | Replace with a bounded mode such as “Agents may propose” or show the active capability grant and expiry. |
| High | The visual architecture describes a thin Buzz bridge and custom Rooms UI, which understates the strategic upstream adoption. | Rooms and Agents screens. | Present Buzz as the workspace; present FRANK as the durable control, policy, memory, and evidence layer behind it. |
| High | No MCP 2026-07-28 state is represented. | No MCP implementation or normalized task/input/App UI exists. | Add visual states for a long-running task, required input, App grant, capability receipt, protocol revision, and stateless retry. Do not pretend these are connected. |
| High | Native Buzz and FRANK workflows are not distinguished. | Automation screen has one undifferentiated list. | Split “Room automations” from “Durable FRANK automations” and explain ownership. |
| Medium | Git authority is unclear. | Buzz room is linked to a branch but no forge authority or mirror status is shown. | Display “GitHub authoritative · Buzz NIP-34 mirror” until forge conformance changes the decision. |
| Medium | Upstream risk is invisible. | No Buzz commit, image pin, canary, or compatibility state is shown. | Add an Operations detail with production pin, canary commit, last conformance result, and rollback pin. |
| Medium | The older mockup can be mistaken for maintained product work. | `outputs/agent-os-mockup/`. | Keep it clearly marked historical; do not implement new behavior there. |
| Medium | User-supplied room messages are inserted through an HTML template. | `app.js` creates a fixed `innerHTML` shell, then assigns message text separately. | Keep all untrusted values on `textContent`; add a regression test so future work does not interpolate them into HTML. |
| Low | Static screenshots can capture stale modal or approval state. | Screenshot assets are not tied to a reset script. | Add deterministic state reset and regenerate screenshots from named routes and viewport sizes. |

## 5. Rules for the implementing agent

1. Read `outputs/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`, especially sections 0.3, 4.13, 7, 8, 13–15, 18, 22–24, and 27–28.
2. Read the current files before editing. Preserve unrelated user changes.
3. Search for repository-specific `AGENTS.md`, `CLAUDE.md`, and runbooks and obey them.
4. Create a working branch named `feat/frank-buzz-mcp-2026-07-28`.
5. Record the starting commit, dirty files, Node version, package manager, and test commands in the change note.
6. Do not install a dependency merely because its name appears in this plan. Verify ownership, licence, pin, integrity, compatibility, and exit path.
7. Do not write a second chat service, second scheduler, second policy engine, or second canonical task database.
8. Do not put provider keys in source, Buzz messages, screenshots, fixtures, logs, or browser storage.
9. Do not turn a protocol input request into an approval. Create separate FRANK records.
10. Do not describe a mocked interaction as working integration.
11. Every effectful retry must reconcile through an idempotency key and invocation record.
12. Every change must have a deterministic test and a visible done condition.

## 6. Work order for the current static concept

Apply these steps only to `outputs/frank-os-clickable/`. Do not add backend-shaped fake network calls.

### 6.1 Establish deterministic local state

Files:

- `outputs/frank-os-clickable/app.js`
- `outputs/frank-os-clickable/index.html`

Changes:

1. Replace scattered state constants with one `prototypeState` object containing:
   - `activeScreen`;
   - `deviceMode`;
   - `reviewItems`;
   - `buzzRoom`;
   - `capabilityGrant`;
   - `mcpTask`;
   - `inputRequest`;
   - `selectedHarnessRoute`;
   - `selectedModelRoute`;
   - `simulationNoticeAcknowledged`.
2. Add a `resetPrototypeState()` function that restores a frozen initial-state clone.
3. Add a visible “Concept simulation” label near the device switcher.
4. Add query-string routes for at least:
   - `?device=desktop&screen=today`;
   - `?device=desktop&screen=room`;
   - `?device=desktop&screen=review`;
   - `?device=desktop&screen=agents`;
   - `?device=mobile&screen=today`;
   - `?device=mobile&screen=room`.
5. Use `history.replaceState` when navigation changes so reload reproduces the same screen.

Tests:

- Reloading each URL reproduces the selected screen and device.
- Reset removes sent prototype messages, modal state, and simulated approvals.
- Unknown screen/device values fall back safely.

Done condition:

- A screenshot runner can open a named state without prior clicks.

### 6.2 Correct Buzz naming and privacy

File:

- `outputs/frank-os-clickable/index.html`

Changes:

1. Rename primary navigation “Rooms” to “Buzz” or “Buzz Rooms.”
2. Change “Powered by Buzz” to “Buzz workspace” with “Self-hosted, signed and open source.”
3. Replace “Today / encrypted on your VPS” with:
   - primary label: “Private on your VPS”;
   - secondary label: “Server-readable · do not post secrets.”
4. Add a details control explaining:
   - dedicated VPS;
   - signed Nostr events;
   - server-readable content;
   - canonical records stored in FRANK;
   - secrets excluded.
5. Change “Agents can act” to “Bounded grant active” and show:
   - allowed operations;
   - room/project scope;
   - expiry;
   - revoke control.
6. Add footer metadata:
   - production Buzz pin;
   - canary commit;
   - last conformance result;
   - rollback pin.
7. Add “Upstream components” detail listing relay, ACP, agent, CLI, workflows, Git events, and deployment assets. Label unavailable items as “planned,” never “connected.”

Tests:

- No visible copy claims end-to-end encryption.
- No room copy implies that membership alone grants tool access.
- Privacy details are keyboard accessible and fit mobile width.

Done condition:

- A non-technical reader can correctly explain what is private, what is readable, and what FRANK still owns.

### 6.3 Correct the approval interaction

Files:

- `outputs/frank-os-clickable/index.html`
- `outputs/frank-os-clickable/app.js`

Changes:

1. Outside the Buzz room, keep “Approve & ship” only as a clearly simulated Review-screen journey.
2. Inside the Buzz room, change the button to “Send approval intent to FRANK.”
3. On click, show this ordered mock state:
   - intent event signed;
   - actor and membership resolved;
   - artifact digest checked;
   - policy revision checked;
   - replay check passed;
   - FRANK Review decision recorded;
   - release action queued;
   - simulated receipt displayed.
4. The receipt must show:
   - intent event ID;
   - FRANK decision ID;
   - artifact digest abbreviation;
   - policy revision;
   - action idempotency key;
   - timestamp;
   - explicit “prototype data” label.
5. A repeated click must return the same simulated receipt rather than create a second release.
6. A changed artifact revision must invalidate the old simulated decision.

Tests:

- A reaction or message does not change the release state.
- Double click produces one receipt.
- Altering the selected artifact forces a new review.

Done condition:

- The visual journey teaches the real policy boundary.

### 6.4 Represent Buzz and FRANK workflow ownership

File:

- `outputs/frank-os-clickable/index.html`

Changes:

1. Split Automations into:
   - “Buzz room automations”: notifications, labels, room summaries, branch-room updates;
   - “FRANK durable automations”: source monitoring, YouTube ingestion, app builds, retries, waiting for input, releases.
2. Add an ownership badge to each card.
3. Add a handoff example:
   - Buzz event detects a branch update;
   - signed ingress command reaches FRANK;
   - Temporal starts or signals the canonical run;
   - results and receipts project back to Buzz.
4. Show that disabling Buzz does not stop an already-running canonical FRANK job.

Tests:

- Every automation card has exactly one owner.
- No card suggests both schedulers own recurrence.

Done condition:

- Scheduler ownership is visible without reading the architecture document.

### 6.5 Add MCP 2026-07-28 normalized states

Files:

- `outputs/frank-os-clickable/index.html`
- `outputs/frank-os-clickable/app.js`
- `outputs/frank-os-clickable/styles.css`

Changes:

1. Add a compact “Capability activity” panel to Build or Agents.
2. Show one example MCP Task mapped to a FRANK Run:
   - protocol revision `2026-07-28`;
   - MCP Task handle;
   - FRANK Run ID;
   - server and tool name;
   - state;
   - cache scope/expiry when relevant;
   - last receipt.
3. Show one `input_required` example normalized as a FRANK Input Request.
4. The input form must distinguish:
   - ordinary missing information;
   - an artifact-bound Review decision.
5. Add one MCP App example with:
   - isolated origin;
   - requested host capabilities;
   - allow once / deny controls;
   - “No raw secrets shared.”
6. Add a “Stateless retry” activity item showing that a retry used another gateway replica and reconciled to the same run.
7. Keep protocol terminology behind a details disclosure. Default copy should say “Needs information,” “Long-running tool,” and “Interactive tool view.”

Tests:

- Input submission cannot approve a release.
- Denying an App grant leaves it unable to call the mock capability.
- Refresh restores the chosen static scenario.
- All controls work with keyboard and reduced motion.

Done condition:

- The concept accurately demonstrates the new protocol without making the main interface technical.

### 6.6 Show route ownership

File:

- `outputs/frank-os-clickable/index.html`

Changes:

1. In Agents, show:
   - Buzz workspace/ACP as the collaboration entry layer;
   - FRANK Harness Broker as assignment and run owner;
   - Codex, Claude Code, Goose, Hermes, Qoder, and `buzz-agent` as replaceable workers;
   - FRANK Model Broker as a separate selection.
2. Replace “Buzz room bridge complete” with an honest state such as “Buzz workspace adapter designed” unless real integration evidence exists.
3. Add a route explanation:
   - why the harness was selected;
   - why the model was selected;
   - which subscription/API lane is used;
   - privacy class;
   - fallback rule.

Tests:

- Choosing a model does not silently change the harness.
- Choosing a harness does not erase the model policy.
- Unsupported combinations show a reason.

Done condition:

- A reader understands that Buzz, a harness, and a model are three different layers.

### 6.7 Show Git authority and upstream tracking

File:

- `outputs/frank-os-clickable/index.html`

Changes:

1. On Build and Buzz room detail, show:
   - “GitHub authoritative”;
   - “Buzz NIP-34 mirror/collaboration”;
   - commit hash;
   - branch;
   - preview artifact digest.
2. Add a dependency card:
   - production Buzz pin;
   - upstream `main` head;
   - compatibility delta;
   - canary status;
   - promote/hold recommendation.
3. Do not make “promote Buzz pin” mutate a production-looking state. Open a simulated evidence panel.

Done condition:

- The concept does not imply that two forges are simultaneously authoritative.

### 6.8 Security and accessibility cleanup

Files:

- `outputs/frank-os-clickable/app.js`
- `outputs/frank-os-clickable/index.html`
- `outputs/frank-os-clickable/styles.css`

Changes:

1. Keep every user-entered value on `textContent`, `value`, or a safe attribute setter. Never interpolate it into `innerHTML`.
2. Add `aria-live` for state changes.
3. Restore focus to the trigger after closing a dialog.
4. Trap focus inside open dialogs and support Escape.
5. Give every icon-only button an accessible name.
6. Preserve system fonts. Remove decorative display-font declarations if they resolve to non-system faces.
7. Honour `prefers-reduced-motion`.
8. Meet WCAG 2.2 AA contrast and focus visibility.

Tests:

- Submit `<img src=x onerror=alert(1)>`; it appears as text and executes nothing.
- Run keyboard-only journeys.
- Run an accessibility scanner on every named route.
- Test widths 360, 390, 768, 1280, and 1600 pixels.

Done condition:

- No critical or serious automated accessibility finding remains and all primary journeys work without a pointer.

### 6.9 Regenerate prototype evidence

Create or update a screenshot script in the actual application test tooling. For this static workspace, use a Playwright script only if Playwright is already available; do not commit browser binaries or generated dependency folders.

Required screenshots:

- desktop Today;
- desktop Buzz room;
- desktop Review;
- desktop Agents/capability activity;
- mobile Today;
- mobile Buzz room;
- mobile input request.

Each screenshot must start from a fresh browser context and a named query-string state.

Done condition:

- Screenshots are reproducible and contain no stale modal, toast, or prior simulated approval.

## 7. Work order for the real application repository

If the application repository already has equivalent packages, use its names and record the mapping. If it does not exist, create the structure below without pretending the static concept is the application.

Recommended ownership:

```text
apps/
  web/                         FRANK browser/PWA product
  desktop/                     Tauri shell
services/
  api/                         canonical domain API
  workflow-worker/             Temporal workflows and activities
  capability-broker/           MCP 2026-07-28 host/client and policy edge
  harness-broker/              ACP and maintained harness adapters
  model-broker/                route planning above LiteLLM
  buzz-adapter/                small BuzzPort integration
  signer/                      narrow Nostr signing service
packages/
  contracts/                   JSON Schema/OpenAPI/event sources
  policy/                      policy inputs and decision types
  ui/                          shared accessible components
  test-conformance/            reusable protocol and adapter suites
infra/
  compose/
  helm/
  canary/
docs/
  adr/
  runbooks/
```

### 7.1 Add source-of-truth contracts first

Create versioned schemas for:

- `BuzzIdentityBinding`;
- `BuzzRoomLink`;
- `BuzzEventReference`;
- `BuzzIngressCommand`;
- `BuzzProjectionCursor`;
- `CapabilityServerRegistration`;
- `CapabilityCatalogueSnapshot`;
- `McpRequestIdentity`;
- `McpTaskLink`;
- `InputRequest`;
- `McpAppGrant`;
- `CacheReceipt`;
- `ActionEnvelope`;
- `InvocationReceipt`;
- `ReviewDecision`;
- `RunCheckpoint`.

Each schema must include:

- `schemaVersion`;
- `cellId`;
- immutable ID;
- actor/service identity;
- source and correlation IDs;
- created/updated timestamps;
- data class;
- policy revision where relevant;
- idempotency or replay key where relevant.

Generate TypeScript and other bindings from schemas. Do not hand-maintain competing types.

Tests:

- invalid data class, missing cell, unknown version, duplicate replay key, and cross-cell reference fail;
- backward-compatible fixtures from the prior supported revision still parse;
- breaking fixtures require an explicit migration.

### 7.2 Implement `BuzzPort`

The port must expose bounded operations such as:

```ts
interface BuzzPort {
  health(): Promise<BuzzHealth>
  ensureRoom(link: DesiredRoomLink): Promise<BuzzRoomLink>
  ensureMember(binding: BuzzIdentityBinding, roomId: string): Promise<void>
  publishProjection(event: FrankProjectionEvent): Promise<BuzzEventReference>
  receiveEvents(cursor: BuzzProjectionCursor): AsyncIterable<SignedBuzzEvent>
  submitAssignment(assignment: BoundedAssignment): Promise<BuzzAssignmentRef>
  steerAssignment(ref: BuzzAssignmentRef, input: SteeringInput): Promise<void>
  cancelAssignment(ref: BuzzAssignmentRef): Promise<void>
  mirrorGitEvent(event: CanonicalGitEvent): Promise<BuzzEventReference>
}
```

Implementation constraints:

- use upstream APIs/packages;
- verify event signature, kind, cell, room, actor binding, membership at event time, timestamp window, and replay state;
- convert accepted proposals into `BuzzIngressCommand`;
- publish through the transactional outbox;
- keep raw Buzz events immutable in the Buzz domain and store only normalized references/projections in FRANK;
- buffer projection delivery during outage;
- never accept a Buzz event as a direct effect receipt.

Tests:

- forged signature;
- revoked key;
- member removed after event;
- wrong room;
- wrong cell;
- duplicate event;
- delayed replay;
- altered artifact digest;
- Buzz outage and replay;
- relay database restore;
- projection rebuild.

### 7.3 Deploy Buzz without a private platform fork

1. Pin the reviewed upstream commit and immutable image digest.
2. Use official Compose for the first private cell unless existing infrastructure standardizes on Kubernetes; use official Helm when Kubernetes is selected.
3. Place Buzz behind the FRANK edge with:
   - TLS;
   - connection limits;
   - request/payload limits;
   - per-identity/room/kind rate limits;
   - health endpoints;
   - redacted logs;
   - isolated database/media volumes;
   - off-host encrypted backup.
4. Disable duplicate cron/scheduler behavior in managed agent children.
5. Create a `buzz-upstream-canary` deployment that:
   - follows `main`;
   - uses synthetic identities and data only;
   - restores a production-shaped scrubbed backup;
   - runs migrations and conformance;
   - never receives production credentials.
6. Store canary results as signed dependency evidence.
7. Promote by digest, never by a moving tag.

Rollback:

- restore the last compatible database snapshot to an isolated target;
- point traffic to the last known-good image only if schema compatibility is proven;
- otherwise keep Buzz unavailable while FRANK continues and projections queue.

### 7.4 Implement identity and signing

1. Authentik owns the FRANK human session.
2. Map each human, device, and agent service identity to a unique cell-scoped Nostr public key.
3. Human device keys use the platform keystore when available.
4. Agent signing uses a narrow signer service backed by OpenBao; a harness receives no raw private key.
5. Signer input must include:
   - principal;
   - permitted signing purpose;
   - room/event scope;
   - payload digest;
   - expiry;
   - request idempotency key.
6. Signer output contains the signed event and receipt; it cannot execute a tool.
7. Rotation and revocation produce new bindings and invalidate old ones.

Tests:

- cross-cell key reuse;
- signer asked for an undeclared purpose;
- expired membership;
- device loss;
- cell restore;
- agent removal;
- OpenBao unavailable;
- duplicated sign request.

### 7.5 Implement stateless MCP edge

For every MCP request:

1. Authenticate the transport principal.
2. Require and parse:
   - `MCP-Protocol-Version`;
   - `Mcp-Method`;
   - `Mcp-Name`.
3. Parse JSON-RPC and `_meta`.
4. Compare headers, body, authenticated identity, registered server/client, assignment catalogue, and policy.
5. Resolve the cell and run from signed FRANK context, not a transport session.
6. Authorize capability, data class, effect class, network/filesystem scope, credential audience, time, and budget.
7. Execute or proxy with deadline and cancellation.
8. Write a canonical receipt.
9. Return a response that is safe to retry.

Do not use:

- sticky sessions;
- `Mcp-Session-Id`;
- a memory map as the only task/input state;
- raw bearer-token forwarding;
- tool annotations as trusted policy facts.

Tests:

- retry on a different replica;
- replica loss mid-request;
- unsupported protocol revision;
- missing or mismatched headers;
- wrong client identity in `_meta`;
- altered tool schema;
- catalogue changed after run start;
- duplicate effect call;
- outcome unknown after timeout.

### 7.6 Implement Multi Round-Trip Requests

When a server returns `resultType: "input_required"`:

1. Validate the input schema and requested fields.
2. Create a canonical `InputRequest` transactionally.
3. Link it to the FRANK Run, Action, MCP operation, server, tool, actor, artifact revision, and expiry.
4. Suspend the owning Temporal workflow using a signal/update-compatible state.
5. Show a plain-language request in FRANK Review or the relevant screen.
6. Accept a response only from an authorized actor and current artifact/schema revision.
7. Store it once with a replay key.
8. Retry the original operation with `inputResponses`.
9. Reconcile duplicate or late responses.

If input would authorize an effect:

1. leave the `InputRequest` as information gathering;
2. create a separate `ReviewDecision`;
3. bind the decision to exact artifacts, policy revision, expiry, and actor;
4. resume only when both records are valid.

### 7.7 Implement MCP Tasks

1. Create the canonical FRANK Run/Action before returning or persisting an MCP Task handle.
2. Store `McpTaskLink` with:
   - server;
   - handle;
   - FRANK run/action IDs;
   - protocol revision;
   - last state/version;
   - poll schedule;
   - subscription cursor;
   - cancellation state.
3. Support:
   - `tasks/get`;
   - `tasks/update`;
   - `tasks/cancel`;
   - `subscriptions/listen` when advertised.
4. Reconcile polling and notifications by monotonic version.
5. Route `inputRequests` through the canonical Input Request flow.
6. On broker restart, reload non-terminal links and continue.
7. On server loss, show degraded state and retry by policy; do not invent completion.

Tests:

- crash before handle persistence;
- crash after server creates task but before client receipt;
- duplicate update;
- cancel/completion race;
- notification gap and poll recovery;
- server returns an unknown terminal state;
- task handle collision across servers/cells.

### 7.8 Implement cache rules

For cacheable lists and resource reads:

1. Build the key from:
   - cell;
   - principal/policy scope;
   - server registration revision;
   - method and normalized arguments;
   - protocol revision;
   - `cacheScope`.
2. Honour `ttlMs` with a monotonic clock.
3. Preserve deterministic ordering.
4. Invalidate on:
   - server/schema change;
   - capability grant change;
   - policy revision;
   - identity or membership revocation;
   - data-class change.
5. Never reuse private cache entries across principals or cells.

Tests:

- cache poisoning;
- cross-principal hit;
- stale tool catalogue;
- policy revoked during TTL;
- reordered results;
- zero/invalid TTL.

### 7.9 Implement MCP Apps

1. Serve Apps from a dedicated isolated origin, not the FRANK origin.
2. Use a sandboxed iframe and strict CSP.
3. Deny by default:
   - top navigation;
   - arbitrary popups;
   - same-origin privilege;
   - unrestricted network;
   - clipboard;
   - downloads;
   - persistent storage;
   - direct connector tokens.
4. Translate the `ui/` dialect through a host bridge that validates origin, schema, capability, cell, run, and grant.
5. Show requested host capabilities in plain language.
6. Support allow-once, allow-for-run, deny, and revoke.
7. Record grant and tool-call receipts.
8. Redact secrets and disallowed data before sending host context.

Tests:

- sandbox escape;
- origin spoofing;
- postMessage confusion;
- prompt injection requesting a broader tool;
- network exfiltration;
- clipboard read;
- grant reuse in another run/cell;
- revoked grant.

### 7.10 Harden OAuth/OIDC

1. Discover the authorization server through the registered connector/server record.
2. Require and validate `iss` against the intended server.
3. Bind tokens and client metadata to issuer and audience.
4. Never reuse credentials across authorization servers.
5. Set `application_type` correctly for localhost redirect clients.
6. Prefer Client ID Metadata Documents.
7. Put legacy dynamic registration behind a feature flag with telemetry and an owner.
8. Store only opaque credential handles in FRANK and harness contexts.
9. Capability-probe Claude support and record the exact client/product/version.

Tests:

- issuer mix-up;
- malicious discovery endpoint;
- redirect mismatch;
- audience confusion;
- token replay to another server;
- client metadata substitution;
- downgrade to legacy registration;
- claimed Claude feature unavailable.

### 7.11 Integrate Buzz ACP and agents

1. Register maintained Buzz ACP/harness definitions behind the Harness Broker.
2. Normalize every session into a FRANK Assignment and Run lineage.
3. Allow steering and cancellation only through authorized FRANK commands.
4. Start managed children with:
   - isolated workspace;
   - bounded environment;
   - no raw signing/provider/production secrets;
   - FRANK Capability Broker endpoint only;
   - native durable scheduler disabled;
   - native global memory writes disabled or treated as disposable cache.
5. Collect normalized events, artifacts, costs, tool receipts, and checkpoints.
6. If native session persistence is absent, rehydrate from the FRANK checkpoint; never claim hidden-state continuation.

Tests:

- agent process loss;
- Buzz ACP disconnect;
- duplicate child creation;
- child tries direct MCP;
- child tries native cron;
- model or harness swap;
- conflicting branch work;
- missing artifact receipt.

### 7.12 Separate Buzz and Temporal workflows

Create an ownership registry. Each automation has exactly one durable owner.

Buzz-owned examples:

- room label;
- local notification;
- summary proposal;
- branch-room association;
- collaboration event transformation.

Temporal-owned examples:

- daily source watch;
- YouTube and X ingestion;
- app build and review;
- model-deal verification;
- waiting overnight;
- retries across outage;
- external messages;
- releases;
- personal reminders and life administration.

Buzz may trigger a Temporal-owned flow only through a signed idempotent ingress command. Project results back to Buzz after canonical commit.

### 7.13 Keep Git authority explicit

1. Store one `authoritativeForge` per project.
2. Store Buzz/NIP-34 references as mirrors or collaboration links.
3. Link by repository identity, branch, commit hash, change ID, and artifact digest.
4. Do not give Buzz agent workers production deployment credentials.
5. Before changing forge authority, pass:
   - protected branches;
   - reviews;
   - status checks;
   - merge queue if required;
   - webhooks/events;
   - SSH/signing;
   - large files;
   - backup/restore;
   - disaster recovery;
   - CI integration;
   - migration both directions.

### 7.14 Add observability

Metrics:

- MCP requests by revision/method/server/result;
- stateless cross-replica retries;
- input requests open/expired/replayed;
- MCP Tasks by state and reconciliation lag;
- cache hit/miss/invalidation by scope;
- App grants and denials;
- issuer-validation failures;
- Buzz event lag, rejection reason, replay, and outage buffer;
- Buzz canary compatibility;
- assignment and receipt mismatch;
- duplicate scheduler prevention.

Traces must carry:

- cell ID in protected context;
- FRANK run/action;
- MCP task/input/App grant;
- Buzz room/event;
- harness assignment;
- action idempotency key.

Do not put private content, tokens, prompts with secrets, or full room messages into telemetry.

### 7.15 Migration and rollback

1. Inventory every existing MCP server/client and protocol revision.
2. Add the new broker path without changing production routing.
3. Replay recorded redacted traffic through both paths and compare.
4. Migrate read-only capabilities first.
5. Migrate effectful tools only after idempotency and outcome-unknown tests pass.
6. Track legacy use by server and method.
7. Remove legacy behavior only after zero measured use and a restore rehearsal.
8. Deploy Buzz canary independently.
9. Import only synthetic data until restore and membership tests pass.
10. Promote a pinned Buzz image to the private cell.
11. Enable read/project integration, then bounded assignments, then room-local workflows.
12. Keep a kill switch for Buzz ingress, Buzz egress, MCP Apps, MCP Tasks, and each server.

Rollback must:

- preserve canonical FRANK runs and receipts;
- pause unsafe effects;
- keep read-only FRANK available;
- queue Buzz projections;
- return to the last known-good broker/Buzz pin where schema compatibility permits;
- never erase evidence to make states appear consistent.

## 8. Required test suites

### 8.1 Deterministic

- formatting;
- lint;
- type checking;
- unit;
- contract/schema;
- database migration;
- integration;
- browser;
- accessibility;
- dependency and licence;
- secret scanning;
- static security;
- container and infrastructure checks.

### 8.2 Protocol conformance

- MCP stateless routing;
- request/header/identity validation;
- MRTR replay and expiry;
- Tasks restart/cancel/update;
- cache scope and invalidation;
- Apps sandbox and grants;
- OAuth/OIDC issuer binding;
- deprecated compatibility inventory.

### 8.3 Buzz conformance

- signed event and membership;
- key rotation/revocation;
- projection replay;
- outage buffer;
- assignment/steering/cancel;
- workflow ownership;
- Git reference integrity;
- upstream upgrade;
- database/media backup and restore;
- rate and payload limits.

### 8.4 Adversarial review

Run:

1. deterministic required checks;
2. a fresh-context review with no builder conversation;
3. a different model-family review;
4. security review focused on identity, approval confusion, replay, secrets, Apps, OAuth, and cross-cell isolation;
5. a final check that favourable model comments cannot override a failing deterministic check.

Severity:

- Critical: data/secret loss, arbitrary effect, auth bypass, cross-cell exposure, unrecoverable corruption.
- High: durable state loss, approval bypass, duplicate effect, false completion, material privacy claim.
- Medium: degraded recovery, confusing ownership, missing evidence, accessibility barrier.
- Low: polish or maintainability issue with no current safety or correctness impact.

## 9. Definition of complete

The change is complete only when:

- all affected documentation points to specification version 1.1;
- the static concept states its limitations and accurately shows Buzz/MCP/FRANK ownership;
- no interface claims general end-to-end encryption;
- no Buzz event directly authorizes a consequential effect;
- no native worker or Buzz scheduler owns FRANK recurrence or completion;
- MCP requests are stateless and safe across replicas;
- Task, input, cache, App, and auth tests pass;
- Buzz production is pinned and upstream `main` is tested separately;
- every effect has one canonical receipt;
- every customer-scoped object includes and enforces `cellId`;
- backups and restore are demonstrated;
- desktop and mobile visual checks pass;
- fresh-context and cross-model reviews contain no unresolved Critical or High finding;
- the evidence pack contains exact versions, commits, migrations, tests, screenshots, risks, rollback, and known limitations.

## 10. Handoff report template

The implementing agent must finish with:

```text
Starting commit:
Ending commit:
Files changed:
Specification requirements addressed:
Buzz upstream commit/image:
MCP SDKs and revisions:
Database migrations:
Tests run and exact results:
Screenshots/previews:
Security review:
Fresh-context review:
Cross-model review:
Known limitations:
Rollback procedure tested:
Items blocked by missing external access:
One command or credential action needed for each blocked item:
```

Do not report “implemented” for a static visual state, an unexecuted test, a mocked receipt, an unavailable connector, or a capability inferred only from an announcement.

