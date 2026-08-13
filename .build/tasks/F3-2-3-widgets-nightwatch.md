# F3-2 / F3-3 — Widget groups and Night Watch

**Depends:** F3-1 frozen · **Model:** cheap, one agent per group · **Parallel — each group owns its own directory**
**Registry is coordinator-owned.** Groups never edit it; the coordinator leases it once after all groups pass.

---

## Every widget — the same shape, no exceptions

```
modules/dashboard/widgets/<widget-id>/
  manifest.ts        public manifest + server binding (separate objects)
  view.tsx           React, error-boundaried
  provider.ts        server-side data provider
  fixtures/          loading, empty, stale, locked, unavailable, error, populated
  contract.test.ts
  a11y.test.ts
```

Requirements: stable ID + semver · supported surfaces · dimension bounds · config JSON Schema + defaults + migration function · capabilities, permissions, classifications · freshness mode and stale threshold · actions · detail route · isolated error boundary · honest loading/empty/stale/locked/unavailable/error states · multiple instances only when the manifest permits.

**No model call for deterministic data.** Counts, health, repository state, actions and queries are computed, never generated. Any model-generated summary must carry source references, timestamps and broker receipts.

---

## F3-2 groups

**E1 — Operational:** Waiting on you · Running now · Recent receipts · Open chats · Work and todos.
Sources: canonical chat, work item, mission, workbench and receipt records. Actions (Approve, Reject, Review, Open, Stop, Complete, Schedule) are **server-issued descriptors only**, and only when authorised.

**E2 — Project and application:** Project status · Live application.
Shows objective, branch, last activity, shortcuts, deployment, health, incidents, recent events. **A missing repository or live app renders a setup/empty state — never a false healthy state.** Test this explicitly; a green tick over no data is the failure mode.

**E3 — Source and graph:** Git tree/worktree lanes · Application graph.
The graph widget consumes the **production Graphify API** and links to `/console/graph?project=...`. It does not extract anything.

**E4 — Night Watch placeholder and Data health.**
Night Watch data is unavailable until F3-3. Data health shows connector freshness, lake backlog, last commit and capacity forecast from deterministic metrics.

---

## F3-3 — Night Watch

**Migration `0015`** (coordinator-assigned), applied after `0014`.

**Ownership split — the thing to get right:** Night Watch owns its provider-specific **read-only** `snapshot.data` schema. Dashboard owns the generic snapshot envelope and `availableActions`.

Night Watch must **not** add `available_commands`, mutable action targets, action policy, a second widget registry, or shell edits.

Provider data contains only: `as_of` · freshness · summary metrics · **at most three** server-capped candidate views · scout/source health · evidence and receipt references. Candidate IDs may correlate a server-issued descriptor but **never encode executable policy**.

Actions (Build preview, Test once, Dismiss, Review signup) exist **only** in generic `snapshot.availableActions`, resolved by the Dashboard action system.

Reuse work items, runs, sources, evidence and action receipts. Do **not** create parallel candidate/approval/workflow stores.

Import the canonical `SourceRef` (`{ kind, id, version?: string }`). Normalise legacy numeric versions to strings **at the input boundary only**. Never define a second `SourceRef`.

---

## Done when

- [ ] Every widget has all seven state fixtures and passes a11y
- [ ] A deliberately broken widget renders its own error state and neighbours keep working
- [ ] Registry validates every ID, version, provider binding, surface, config schema and dimension
- [ ] Default layout picks exactly six capability-appropriate widgets
- [ ] No deterministic value is model-generated — audited per widget
- [ ] E2 renders a setup state, not a healthy state, with no repo configured
- [ ] Migrations `0000`–`0015` apply from empty and rerun clean
- [ ] Night Watch provider data validates and contains **zero** action-policy fields
- [ ] Candidate count capped at three, enforced server-side
- [ ] Every action produces exactly one receipt and one widget update; unauthorised and expired actions fail closed
