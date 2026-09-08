> Historical record or proposal. This is not current operating authority.
> Use the [maintained documentation index](../../README.md) before applying commands,
> endpoints, deployment claims or acceptance criteria from this record.

# Ad Template Generator Implementation Plan

> **For agentic workers:** Use the loaded subagent-driven-development workflow with the user's explicit Luna swarm selection. User rules override routine reviewer-agent and repeated approval gates. Implement the owned subsystem tasks below; parent coordinates actual diff review and integration.

**Goal:** Deliver reference-to-editable template generation with canonical preview/export rendering, explicit reconstruction/reuse evidence, and safe resumable operation.

**Architecture:** Retain Frank -> Hermes -> Blockwise. Reuse the structured template/document contract and deterministic renderer; close editor parity and replacement-acceptance gaps instead of adding duplicate engines or job stores.

**Tech Stack:** Existing Frank browser JavaScript/Python, Hermes Python, Blockwise TypeScript/React, shared contract/renderer packages, existing PostgreSQL/storage and deployment tooling.

---

## Task 1: Establish safe baselines

- [x] Read global and applicable project instructions; use VPS only.
- [x] Verify Frank live image and origin/main at a98246f11f9ff33549dbd684051fcd0f5acda40c.
- [x] Identify Blockwise live image at 58378f66c83f1ae2e5d103cfdfb38d257b3d7cd3; require implementation base to contain it.
- [x] Assign three independent Luna ownership boundaries.
- [ ] Record active Hermes baseline from service configuration without exposing secrets.
- [ ] Confirm fetched upstream and clean/isolated task branches before integration.

## Task 2: Canonical Blockwise rendering and revision identity

Owner: renderer_contract.

Primary files: packages/ad-template-contract/src/types.ts and schema.ts (reuse, change only if needed); packages/ad-template-renderer/src/renderer.ts and index.ts (reuse); src/components/adstudio/editor/editor-shell.tsx, layered-canvas.tsx, use-editor-state.ts; src/lib/adstudio/save-ad.ts; authenticated preview route/service discovered or added within existing adstudio routes.

- [ ] Record the exact subsystem plan in docs/superpowers/plans/2026-09-07-canonical-template-rendering.md.
- [ ] Add failing tests for canonical preview/save parity, template hash persistence, and stale preview responses.
- [ ] Implement canonical AdDocument preview using the existing renderer and asset resolution, preserving authentication and workspace checks.
- [ ] Wire editor preview with cancellation/staleness handling, explicit pending/error states, and preserved editing.
- [ ] Populate the existing template_hash revision field from immutable template JSON.
- [ ] Exercise long/Unicode text, missing/default images, placement crops, colours, and asset failures.
- [ ] Run npm run check:nul, npm run test, npm run typecheck, npm run build.
- [ ] Commit only intended Blockwise files; retain the candidate SHA and measured results.

## Task 3: Hermes reusable-template acceptance

Owner: generator_pipeline.

Boundary: existing Hermes ad-template-generator implementation and focused tests, not Frank UI or Blockwise renderer source.

- [ ] Record active implementation paths and exact subsystem plan before editing.
- [ ] Reuse current structured output, best-candidate repair, final-review gates, and persisted checkpoint handling.
- [ ] Add a deterministic reusable-content stress acceptance step where existing coverage is missing, using the shared renderer.
- [ ] Store reconstruction and replacement evidence separately, with actionable field/layer failures and bounded execution.
- [ ] Cover failing replacement cases and successful checkpoint/best-candidate behavior with focused regression tests.
- [ ] Run the repository-required test runner on changed behavior and necessary broader checks.
- [ ] Run a bounded real generation/render canary without approving or publishing its result.
- [ ] Commit intended changes and record source, model, render identity, elapsed time and available cost evidence.

## Task 4: Frank operator workflow

Owner: operator_workflow.

Files: apps/window/web/index.html, app.css, js/ad-template-generator.js, js/ad-template-generator-review.js as needed, and focused tests under apps/window/tests.

- [ ] Record subsystem plan in docs/superpowers/plans/2026-09-07-ad-template-operator-workflow.md.
- [ ] Add behavioral regression tests for distinct evidence selection and valid imported-template editor links.
- [ ] Present Upload -> Generate -> Compare -> Edit/Approve within the current design.
- [ ] Label faithful reconstruction and reusable template independently; show missing evidence honestly.
- [ ] Preserve advanced settings, batches, retries, attempt history, SSE state and approval controls.
- [ ] Add editor handoff only for a valid imported template identity.
- [ ] Run npm ci --ignore-scripts and PATH=/srv/frank/venvs/window/bin:$PATH npm run verify from apps/window.
- [ ] Commit intended files, preserving parent-owned spec/plan edits.

## Task 5: Integration and release

Owner: root coordinating the same Luna workers.

- [ ] Review actual diffs against the approved design; simplify unnecessary implementation without unrelated cleanup.
- [ ] Verify backend/frontend contracts and test evidence; fix substantive failures without weakening checks.
- [ ] Fetch current upstream; integrate intended commits without reverting intervening changes or rewriting history.
- [ ] Run required CI and container builds; preserve previous deploy revisions and rollback artifacts.
- [ ] Release backend/renderer compatibility before dependent UI where necessary.
- [ ] Deploy Frank with /projects/frank/apps/window/deploy.sh --revision <validated-full-sha>.
- [ ] Deploy Blockwise with the existing VPS runbook and check compiled provenance using BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env scripts/vps/product-health.sh <validated-full-sha>.
- [ ] Deploy Hermes with its verified existing runbook; do not replace service/profile plumbing.
- [ ] Check the live operator workflow in the authenticated browser and the canonical editor preview/export behavior.
- [ ] Record exact changes, test totals, canary outcome, live revisions and any genuine remaining blocker in release documentation.
