# Ad Template Operator Workflow

## Scope

Improve the existing Frank Ad Template Generator surface without changing the
Hermes run contract, provider policy, event stream, or durable state merge.

## Owned files

- `apps/window/web/index.html`
- `apps/window/web/app.css`
- `apps/window/web/js/ad-template-generator.js`
- `apps/window/web/js/ad-template-generator-review.js` (only if selector labels need refinement)
- focused UI and helper tests under `apps/window/tests/`

## Behavior

1. Make Upload → Generate → Compare → Edit/Approve the primary mental model.
2. Keep batch upload/history/retry/SSE behavior intact.
3. Label faithful source-filled QA evidence separately from the reusable
   customer-default artifact, with explicit missing-evidence states.
4. Show a Blockwise editor link only when the authoritative run contains an
   imported template route; retain request-changes, discard, and approval gates.
5. Keep advanced model controls secondary and collapsed by default.

## Verification

```bash
cd /projects/frank/apps/window
node --test tests/ad_template_generator_review.test.mjs tests/ad_template_generator_state.test.mjs tests/frontend_behavior.test.mjs
/usr/local/bin/python -m unittest tests.test_ui_contract
