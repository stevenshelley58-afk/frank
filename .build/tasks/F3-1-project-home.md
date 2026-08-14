# F3-1 — Project home, widget runtime, dashboard

**Depends:** F1-3, F3-0 (chat accepted) · **Migration:** `0014` (coordinator-assigned) · **Model:** cheap; strong review
**Allowed:** `modules/dashboard/**`, `apps/web/src/app/projects/**`, `apps/web/src/components/dashboard/**`
**Forbidden:** chat internals, other modules, hot files without a lease

Every project gets a live modular home inside the existing chat shell. **The project home is a central-pane mode, not a replacement shell** — keep the left project/chat navigation, the composer, the Console and the Living Frame.

---

## Non-negotiable rules

1. A project profile is **one-to-one with a durable room**. Do not create a second project entity.
2. Do not create another attachment lifecycle — consume `frank.object-manifest/v1` by `object_id`, digest and `source_ref`.
3. Do not create another CodeGraph extractor — consume the production Graphify API.
4. Do not create another scheduler — use the canonical Frank work queue.
5. Do not create another memory authority — PostgreSQL and object storage stay canonical.
6. **Widgets never call connectors, object storage or Iceberg directly.** They call providers.
7. Never expose DuckDB SQL, S3 credentials, connector credentials or action policy to the browser.
8. No remote JavaScript widgets. All widgets are compiled, registered Frank modules.

---

## Two manifest views — the security core

```ts
type PublicWidgetManifest = {          // safe for the browser
  widget_id: string; version: string;
  surfaces: ("project-home"|"living-frame")[];
  dimensions: { min: Size; max: Size; default: Size };
  config_schema: JSONSchema; config_defaults: unknown;
  detail_route?: string;
};

type ServerWidgetBinding = {           // NEVER leaves the API process
  widget_id: string;
  permissions: string[]; capabilities: string[];
  classifications: string[];
  provider_binding: string;
  target_rules: unknown; action_policy: unknown;
};
```

**Add a build-output and HTTP-response scan proving no `ServerWidgetBinding` field ever reaches a bundle or a browser payload.** This is the test that matters most in this task.

---

## Routes

```
GET  /v1/projects
GET  /v1/projects/:projectId
GET  /v1/projects/:projectId/dashboard?surface=project-home
PUT  /v1/projects/:projectId/dashboard          If-Match required
POST /v1/projects/:projectId/dashboard/reset
GET  /v1/widgets
GET  /v1/projects/:projectId/widgets/:instanceId
POST /v1/actions
GET  /v1/actions/:actionId
GET  /v1/dashboard/events?project_id=...        SSE
```

- Validate project, dashboard, cell, room, surface and widget-instance identity **separately** on every route.
- ETags with `If-Match` on save and reset. Stale write → `409`/`412` **without modifying the published layout**.
- Layout revisions are immutable and durable. **React state and process memory are not storage.**
- One SSE connection per dashboard, driven by outbox cursors. Atomic snapshot + high-water capture, replay, live handoff — **no gap, no duplicate**. Reject malformed, expired, cross-cell, nonexistent and ahead-of-high-water cursors.

## Actions

Resolved **entirely server-side** from persisted descriptors. Bind: descriptor · authenticated principal · cell · room · dashboard · widget instance · target version · permission · capability · confirmation · expiry. Single-use challenges consumed transactionally.

**Guarantee exactly one external effect** across double-clicks, network retries, and a worker/API crash on either side of the external call. Write invocation + receipt + audit + outbox atomically, or reconcile an already-performed idempotent effect to exactly one canonical receipt.

**Fail closed** when a provider, permission resolver or executor is missing.

Crash-injection tests are required at three points: before dispatch · after external success but before receipt commit · after receipt commit. All three converge to one effect and one receipt.

---

## Layout and backfill

Max 25 widgets. Responsive `compact` / `medium` / `wide` placements stored explicitly. Idempotent backfill creates exactly one project profile, one project-home dashboard and one published capability-aware default layout per eligible room, preserving existing room IDs, names, tints and icons. **Rerun changes zero rows.**

Default layout selects the first six capability-appropriate widgets; the gallery offers the rest.

---

## Done when

- [ ] Migrations `0000`–`0014` apply from empty and rerun as no-op; `room_id_cell_uidx` exists exactly once, owned by `0011`
- [ ] Server-only manifest fields cannot reach the browser — bundle and response scans clean
- [ ] Stale save returns 409/412 and leaves the layout untouched
- [ ] SSE resume produces no gap and no duplicate
- [ ] All three crash-injection cases converge to one effect and one receipt
- [ ] Backfill reruns with zero row changes
- [ ] Layout survives process restart and browser restart
- [ ] A broken widget cannot crash its neighbours
- [ ] Desktop, tablet, mobile and narrow Living Frame all pass; WCAG AA, keyboard, screen-reader labels, reduced motion
