# F2-C1 — Content factory

**Depends:** F1-1, F1-3, F1-4 · **Model:** cheap · **Parallel group C**
**Allowed:** `modules/content-factory/**`
**Forbidden:** other modules, Blockwise repo, hot files

Research → brief → draft → review → approve → release. Blockwise renders approved releases; it never runs a content pipeline.

---

## Port from Blockwise

`content_runs` · `content_artifacts` · `content_reviews` · content-specific `prompt_runs`, `prompt_sets`, `prompt_set_items`, `prompt_templates` · `operator_approvals` · `packages/content-engine` · `src/lib/content-engine` · the runtime under `hermes/tools/research-runtime/bin/content-engine.mjs` · all content production skills and the operator content console.

**Port the whole pipeline, not just the files named `blog`.** Articles, SEO, media briefs, social posts and lead-ad drafts all run through it.

**Do not blindly move global prompt/model tables.** Label each row and call site by owner first: content rows move to Frank, AdStudio rows stay in Blockwise until AdStudio model execution is separately extracted.

---

## Genericity

Replace `blockwise-*` skill IDs in the core with generic capability IDs. Bind the Blockwise implementations through the project pack:

```
pack.publication_targets[]     which channels this project publishes to
pack.brand.voice               tone
pack.compliance.claim_rules    what it may not assert
pack.model_profiles            cheap / middle / strong
```

Use the Frank workflow and model brokers — **not** `research.work_queue` and **not** Blockwise model tables. Ad Radar and content currently share a queue; that ends here. Each module gets its own job type and state.

---

## Published-article payload (consumed by B4-2)

Contains: slug · title · excerpt · structured content blocks · author/publisher label · canonical URL · SEO title and description · Open Graph fields · JSON-LD · public content-addressed asset URLs with alt text and hashes · publication status, dates, version, tombstone · approved CTA configuration permitted by the pack.

**Must exclude:** prompts · raw model output · private research notes · provider receipts · operator comments · draft assets.

Write the exclusion as a **test**, not a comment — the same shape as B1's PII test.

---

## Done when

- [ ] A fixture brief runs end to end to an approved release with deterministic state transitions and evidence at each step
- [ ] Manifest validates; migrations clean; cross-project isolation tested
- [ ] Operator can create, inspect, revise, approve, release, withdraw and rerun
- [ ] Withdrawal emits a tombstone release
- [ ] Excluded fields cannot appear in a payload — proven by test
- [ ] `grep -ri blockwise modules/content-factory/` returns nothing
- [ ] Green against `packs/acme` with different channels and voice
