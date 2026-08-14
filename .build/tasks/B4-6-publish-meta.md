# B4-6 — Publish, Instant Forms and Meta

**Depends:** B4-5 (Save) · **Model:** strong (money and provider state) · **Two parallel lanes, then serial UI**
**Allowed files:** `src/lib/meta/**`, `src/lib/forms/**`, `src/app/(app)/publish/**`
**Forbidden:** editor, renderer, Frank repo

**Laws:** Meta objects are created **PAUSED** and read back before activation. Activation is a **separate explicit customer action**. The UI never says "Live" until provider readback confirms it.

---

## Lane A — AI Instant Form generator

Input:
```json
{ "campaignGoal":"", "offer":"", "creativeContext":{}, "primaryText":"",
  "headline":"", "description":"", "cta":"", "business":{},
  "privacyPolicyUrl":"", "destinationUrl":"", "metaRequirementsVersion":"" }
```

Output:
```json
{ "name":"", "formType":"higher_intent | more_volume",
  "intro":{"headline":"","body":""},
  "contactFields":[], "customQuestions":[],
  "privacy":{"url":"","linkText":""},
  "thankYou":{"title":"","body":"","actionType":"","actionUrl":""} }
```

**Process — deterministic first, model second:**

1. Deterministic rules select valid field types and strip prohibited categories (health, financial, sensitive personal). This runs **before** any model call.
2. Cheapest text model drafts wording only.
3. Deterministic validator checks the current Meta requirements register.
4. Cheap critic checks relevance and duplication.
5. Stronger model **only** if validation or critics disagree.
6. Customer previews and edits.
7. **Every edit reruns deterministic validation.**
8. Final form is pinned into the publication snapshot.

**Verify Meta's current API against live documentation and a real test account at execution time.** Do not copy the existing `v23.0` fallback and do not guess the next version. Record the version you verified in `.build/DECISIONS.md`.

---

## Lane B — Meta publishing backend

**Retain and adapt:** token vault · OAuth/account/Page setup · publish queue · idempotency and reconciliation · PAUSED-first creation · activation mutations · lead sync and dedupe.

**Replace outright:** client-supplied campaign-pack trust · flat `template_clone_image` assumptions · static forms · single-image placement handling · "submit and go live" wording.

Publish loads **authoritative server state only** — never client-supplied values:

```
exact saved revision · feed PNG hash · story PNG hash · copy · CTA
validated form · audience · budget · schedule
```

### Placement capability probe — do this early

Determine the one supported implementation against a real account:

- **Prefer** one creative using supported placement customisation.
- If lead forms and placement customisation are not supported together, use **separate placement-specific creatives/ad sets**.

**After the probe, keep only the proven path.** Shipping both as runtime fallbacks guarantees divergence. Record the outcome and date in DECISIONS.md.

---

## Publish flow (serial UI lane)

1. If dirty → Save first
2. If unchanged → reuse the exact stored PNG hashes, render nothing
3. Generate or load the Instant Form
4. Customer previews and edits it
5. Show final Feed and Story PNGs
6. Show copy, CTA, form, audience, budget, schedule
7. **Freeze a publication snapshot**
8. Upload the exact assets from the snapshot
9. Create form → campaign → ad set(s) → creative(s) → ads, **all PAUSED**
10. **Read back every ID and configuration**
11. Show **"Paused on Meta"** — never "Live"
12. Offer a separate activation action
13. Start lead sync only after the reconciled form exists

---

## Required tests

| Test | Asserts |
|---|---|
| Idempotent publish | Double-click creates one campaign, not two |
| Crash before readback | Reconciles to exactly one set of objects |
| Snapshot immutability | Editing after freeze does not change what was published |
| Form validation on edit | Every customer edit reruns deterministic checks |
| Prohibited field | Rejected before the model is called |
| PAUSED readback | Every created object confirmed paused |
| Activation | Separate call; no auto-activation path exists |
| Lead sync dedupe | Same lead twice → one record |
| Unchanged republish | Reuses PNG hashes, triggers no render |

---

## Done when

- [ ] Meta objects create PAUSED and every ID is read back
- [ ] The string "Live" cannot appear before readback confirms it
- [ ] Activation is a distinct customer action with its own receipt
- [ ] Publish reads only server state — a tampered client payload changes nothing
- [ ] Placement probe outcome recorded; only one path shipped
- [ ] Meta API version verified against live docs, recorded with date
- [ ] One real test lead reaches Blockwise and deduplicates
