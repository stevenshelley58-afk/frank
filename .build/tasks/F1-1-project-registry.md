# F1-1 — Project registry and pack loader

**Depends:** F0 · **Model:** strong · **Serial — first architectural task**
**Allowed files:** `packages/project-pack/**`, `packs/**`
**Forbidden:** every module, every app, all hot files

This is what makes Frank a platform instead of Blockwise's backend. Every later module reads project behaviour through this. Build it first and build it right.

---

## Objective

A module contains **zero** project-specific values. Everything project-specific lives in a pack.

```
packs/
  blockwise/pack.json
  acme/pack.json          fixture project — proves genericity, ships in the repo
packages/project-pack/
  src/schema.ts  loader.ts  validate.ts  index.ts
  test/
```

---

## Pack schema

```ts
type ProjectPack = {
  schema: "frank.project-pack/v1";
  project_id: string;              // lowercase, [a-z0-9-], stable forever
  display_name: string;
  brand: {
    voice: string;
    colours: Record<string,string>;   // semantic role -> hex
    fonts: { key: string; family: string; weight: number }[];
    logo_asset_key?: string;
  };
  taxonomy: {
    verticals: string[];
    classification_map: Record<string,string>;  // module core term -> project term
  };
  compliance: {
    jurisdiction: string;                        // e.g. "AU"
    claim_rules: string[];
    required_disclaimers: string[];
  };
  ad_policy: {
    goals: string[];                             // project's ad goals, NOT in module code
    required_placements: ("feed"|"story")[];
    lead_form_required: boolean;
    copy_constraints: { max_primary: number; max_headline: number; max_description: number };
  };
  model_profiles: {
    cheap: string; middle: string; strong: string;   // profile names, never provider names
  };
  thresholds: {
    review_pass_confidence: number;
    max_correction_iterations: number;
    stale_after_hours: number;
  };
  publication_targets: { channel: string; enabled: boolean; config: Record<string,unknown> }[];
  retention: { evidence_days: number; artifact_days: number; quarantine_days: number };
  allowed_actions: string[];
  approval_policy: "automated" | "operator";
};
```

## Loader API

```ts
loadPack(project_id): ProjectPack          // throws on unknown or invalid
resolve<T>(pack, path, fallback?): T       // typed dotted-path lookup
listProjects(): string[]
```

Cache packs in memory with an explicit invalidate. Validate on load, never on use — a module must be able to trust the object it holds.

---

## The genericity rule

Every module resolves project behaviour through `loadPack`. Concretely:

| Wrong | Right |
|---|---|
| `if (project === 'blockwise')` | `pack.ad_policy.goals` |
| `const GOALS = ['real_estate_listing', ...]` | `pack.ad_policy.goals` |
| `requireLeadForm()` always | `pack.ad_policy.lead_form_required` |
| `model: 'gpt-4o-mini'` | `pack.model_profiles.cheap` |
| Hardcoded AU compliance strings | `pack.compliance.*` |

**`packs/acme` is the test.** It is a deliberately different vertical — not real estate, no lead-form requirement, different colours and goals. Every module's test suite must run green against `acme` as well as `blockwise`. If it can't, the module has project logic baked in.

---

## Done when

- [ ] Schema validates; invalid packs fail with field-level errors
- [ ] `packs/blockwise` carries every Blockwise-specific value currently hardcoded in the Blockwise repo — audit `src/lib/adstudio` and `hermes/skills` for the full list
- [ ] `packs/acme` exists, is a different vertical, and is used by later module tests
- [ ] Unknown `project_id` throws, never silently defaults
- [ ] `grep -ri blockwise packages/project-pack/src/` returns nothing
- [ ] `.build/DECISIONS.md` lists every value moved from code into the pack
