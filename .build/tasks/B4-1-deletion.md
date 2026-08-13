# B4-1 — Legacy AdStudio deletion

**Depends:** none (starts immediately, parallel with all Frank work) · **Model:** cheap · **Must be the FIRST commit on the branch**
**Base:** `/projects/blockwise/repo-clean` @ `3959be8`
**Allowed:** everything listed below · **Forbidden:** adding any new feature

This is a replacement, not a migration. **No dual running, no fallback flag, no dormant clone path, no old template gallery, no customer-visible partial release.**

Before touching publishing code, set in web and worker environments:
```
BLOCKWISE_ENABLE_PROVIDER_WRITES=false
```

---

## 1. Template assets and builders — delete completely

```
src/lib/adstudio/template-gallery/
public/adstudio-samples/meta/
public/adstudio-samples/photos/
scripts/adstudio/create-template.mjs
scripts/adstudio/local-template-adapter.mjs
scripts/build/rasterize-adstudio-samples.mjs
scripts/verify/adstudio-templates.mjs
hermes/skills/adstudio-template-builder/SKILL.md
.github/codex/prompts/adstudio-template-integrator.md
mockups/qwen-adstudio-full-process-20260722/
```
Plus old AdStudio samples referenced by the homepage, and other AdStudio mockups/exports/generated visuals.

`meta_ad_candidates/` — **move to Frank private storage first, verify hashes, then remove.** Source ads are Frank inputs, not Blockwise templates.

## 2. Runtime code — delete the flat-clone and model-editing path

```
reference-clone.ts · clone-generation.ts · clone-campaign.ts · clone-creative.ts
clone-regions.ts · region-edit.ts · rasterize-reference.ts
generate-template-campaign.ts · template-resolver.ts · template-preview.ts
clone-specific creative-preview.ts and export/render helpers
trigger/adstudio-generate.ts
/api/adstudio/jobs/[id] · /api/adstudio/creatives/[id]/edit
old campaign generation endpoint · old campaign-pack autosave/draft path
```

**Remove these identifiers everywhere** — the hard-reset verifier must fail if any survives:

```
reference_clone · reference-clone · buildCloneImageRequest
buildTargetedEditRequest · template_clone_image · templateClone · cloneQa
AD_STUDIO_TEMPLATES · RESOLVABLE_AD_STUDIO_TEMPLATES
adstudio.generate.template · adstudio/clones
```

## 3. Customer UI — delete, do not patch

```
ad-studio-workbench.tsx · new-ad-dialog.tsx · new-ad-dialog-brief.ts
new-ad-dialog-slots.ts · generation-ad-stream.tsx · generation-ad-stream-data.ts
canvas/in-place-ad-editor.tsx · canvas/creative-edit-client.ts
existing AdStudio panels · preview.tsx · styles.ts
AdStudio topbar and old state hooks · existing /ad-studio loader and sample fallback
```

Replace the route with a **server-controlled "AdStudio is being prepared" state**. No old implementation, no fallback template.

## 4. Static form presets

`src/lib/adstudio/default-lead-forms.ts` · `scripts/adstudio/sync-default-lead-forms.mjs` · preset tests · template-manifest form defaults. Instant Forms are generated at Publish time from the actual ad.

## 5. Tests and docs

Delete `adstudio-clone-*` · `adstudio-reference-clone.test.ts` · `adstudio-inplace-editor.test.ts` · `adstudio-template-020.test.ts` · `adstudio-local-template-adapter.test.mjs` · old generation tests · old hard-reset template tests · `e2e/adstudio-real-loop.spec.ts`.

Rewrite or delete AdStudio content in `docs/CLONE-PLAYBOOK.md` · `FIRST_TESTER_PLAN.md` · `LAUNCH_PLAN.md` · `REBUILD-PLAN.md` · `AGENT_EXECUTION_PLAN.md` · old Meta screencast instructions · `PRODUCT.md` · `AGENTS.md` · `CLAUDE.md` · production readiness/rollback docs.

**`AGENTS.md` and `CLAUDE.md` currently forbid the new architecture** — rewrite them to state the new laws. **Rewrite the hard-reset verifier to enforce those laws**: it must fail if any legacy identifier remains.

## 6. Production data

The audit found 80 campaigns · 470 creatives · 575 revisions · 168 creative jobs · 11 linked Meta publish plans, **two still labelled `publishing`**.

Before any destructive migration: re-count rows · reconcile the 11 plans · inspect the two `publishing` ones · confirm whether their Meta campaigns/forms/ad sets/ads exist · pause external objects if needed · record IDs needing continued lead access · verify no active spend · remove old worker/job registrations.

Storage: 229 clone objects (~430 MB) and one obsolete photo-prep object may go. **324 other AdStudio objects may include customer media — never delete the broader prefix.**

**Empty legacy tables may be dropped. Non-empty ones move to `legacy_archive`.** Never edit applied migration history — add a new retirement migration.

---

## Gate

- [ ] Old `/ad-studio` functionality unavailable
- [ ] Old generation and edit endpoints return 404 or 410
- [ ] Old Trigger/VPS job kinds unregistered
- [ ] `git ls-files` contains no old manifests, public samples or mockups
- [ ] Strict legacy identifier search returns **zero** matches
- [ ] App builds without the legacy code
- [ ] No provider writes can run
- [ ] Exact reconciliation report exists for legacy data and external Meta objects
- [ ] **No fallback or dual-path flag exists anywhere**
