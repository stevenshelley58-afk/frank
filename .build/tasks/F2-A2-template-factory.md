# F2-A2 — Template factory

**Depends:** F1-2 (contract), F2-A1 (renderer) · **Model:** cheap for loops, strong for the review rubric · **Parallel group A**
**Allowed files:** `modules/template-factory/**`, `packs/blockwise/template-policy.json`
**Forbidden:** renderer internals, Blockwise repo, contract package

Frank's private factory. It ingests one source ad and emits a signed `TemplatePack` containing **two independently designed layouts**. Blockwise never sees the source ad, the prompts, or the rejected candidates.

---

## Product laws

1. Frank owns source ads, prompts, iteration history, rejected candidates, model credentials.
2. Blockwise receives **only** the signed pack.
3. Every pack has Feed `1080×1350` **and** Story `1080×1920`, one shared content contract, independently designed geometry, independently completed review loops.
4. **Story is a redesign, not a crop.** A Story produced by scaling or extending Feed is a defect, not a shortcut.
5. **No human review field exists anywhere.** Automated QA approves or quarantines. If you find yourself adding `approved_by`, stop.

---

## 1. Intake

Record for every source ad:

```
private_source_location    (Frank-owned storage, never referenced in a pack)
creative_id | file_id
sha256
classification             (from project pack taxonomy)
source_aspect_ratio
declared_image_inputs[]
declared_text_inputs[]
protected_regions[]        (baked elements that must survive unchanged)
```

Vision extracts **only what is visible**. It must not invent customer input fields that aren't in the source.

---

## 2. Versioned AI requests

Store prompt version, payload, model route, output and cost for **every** iteration. This ledger is how you debug a bad pack six weeks later.

### Extract
```json
{ "sourceImage": "private asset ID",
  "task": "extract_customer_inputs_and_layer_candidates",
  "requiredOutput": { "imageInputs": [], "textInputs": [], "colourRoles": [],
                      "protectedRegions": [], "candidateLayers": [] } }
```

### Build
```json
{ "sourceImage": "private asset ID",
  "aspectTask": "source_aspect | alternate_aspect_redesign",
  "inputContract": {}, "currentLayerDocument": {}, "previousDefects": [],
  "allowedOperations": ["add_layer","move_layer","resize_layer","change_typography",
    "change_mask","change_crop","change_colour_role","replace_masked_plate_region"] }
```

**The model returns structured layer operations, never a finished image.** Reject any response containing image bytes.

### Review
```json
{ "sourceImage": "...", "candidateRender": "private render ID",
  "aspectTask": "...", "inputContract": {}, "safeZones": {},
  "previousDefects": [], "rubricVersion": "v1" }
```

Required review output:
```json
{ "decision": "pass | correct | escalate | reject",
  "confidence": 0.0,
  "scores": { "styleLikeness":0, "hierarchy":0, "geometry":0,
              "readability":0, "assetIntegrity":0, "safeZones":0 },
  "defects": [{ "code":"stable_code", "severity":"critical|major|minor",
                "placement":"feed|story", "layerId":"id", "box":{},
                "evidence":"short reason", "suggestedOperation":{} }] }
```

Defect codes are a **fixed enum**. A model returning an unknown code is a validation failure, not a new defect type.

---

## 3. Model escalation — cost control

Use model *profiles* from the project pack, never hardcoded provider names.

1. Deterministic checks first — **zero AI cost**. Geometry bounds, font hashes, overflow, safe zones. Most defects die here.
2. Cheapest capable multimodal reviewer.
3. If it passes with high confidence, run a **second independent cheap review**.
4. Accept when both cheap reviewers pass.
5. On disagreement, escalate **only the disputed defects** to the middle tier.
6. If the same defect survives two correction attempts, escalate **that defect** to the strong tier.
7. Never rerun a full expensive review for an unrelated minor defect.
8. **Maximum 8 correction iterations per placement.**
9. On exhaustion: reject and quarantine. **Never lower the gate to get a pass.**

---

## 4. Source-aspect loop

Optimises: pixel and region similarity · exact visual hierarchy · text placement and typography · image-slot geometry · overlay alignment · protected pixels · brand character.

Masked image generation is permitted **only** for a declared plate or overlay region. It may never repaint the whole ad — assert this by checking the mask covers less than the full canvas.

## 5. Alternate-aspect redesign loop

**Separate job, separate history.** Inputs: original source ad, approved source-aspect document, shared input contract, target safe zones.

Produces a **native composition** for the other ratio. Reviewed for style continuity, hierarchy, balance, legibility, use of vertical space, safe zones and shared content keys.

**Explicit reject:** any output whose layer geometry is a linear transform of the Feed layout. Test this — it's the failure mode this loop exists to prevent.

---

## 6. Stress QA — both placements, before packaging

Longest allowed text · one-character text · portrait, landscape and square photos · minimum accepted dimensions · extreme crop positions · template colours · brand-pack colours · **missing brand-pack roles** · contrast checks · font loading · safe zones · source identity leakage · deterministic rerender hash · no private asset references.

---

## Done when

- [ ] Feed passes its own loop; Story passes its own loop
- [ ] Both share identical content keys
- [ ] All stress fixtures pass
- [ ] Two cheap reviewers agree, or a stronger reviewer resolved the dispute
- [ ] No human-approval field exists anywhere in the module
- [ ] Pack signs and validates against F1-2
- [ ] Cost ledger records every attempt with model, tokens and cost
- [ ] A Story that is a scaled Feed is **rejected** by test
- [ ] `grep -ri blockwise modules/template-factory/` returns nothing
- [ ] Fixture project `acme` produces a pack with no real-estate vocabulary
