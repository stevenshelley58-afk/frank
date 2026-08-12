# F1-2 — Release contract

**Depends:** F1-1 (project registry) · **Model:** strongest available · **Serial** — no parallel work during this task
**Allowed files:** `packages/frank-release-contract/**`
**Forbidden:** every module, every app, all hot files

This is the boundary between Frank and every project that plugs into it. Freeze it before anything consumes it. A change here after Wave 2 starts invalidates every producer and consumer.

---

## Objective

One envelope, many typed payloads. A `TemplatePack` is a *payload type*, not a competing contract.

```
packages/frank-release-contract/
  src/
    envelope.ts          ReleaseEnvelope v1
    payloads/
      template-pack.ts   TemplatePack v1
      published-article.ts
      ad-intelligence.ts
      index.ts           payload type registry
    hashing.ts           canonical JSON + sha256
    signing.ts           Ed25519 sign / verify
    index.ts
  schemas/               JSON Schema per type, generated
  fixtures/
    valid/               one per payload type
    invalid/             one per rejection reason below
  test/
```

---

## 1. ReleaseEnvelope v1

```ts
type ReleaseEnvelope = {
  schema: "frank.release/v1";
  release_id: string;          // uuid, also the idempotency key
  project_id: string;          // must resolve in the project registry
  module_id: string;           // producing module
  payload_type: string;        // key in the payload registry
  payload_version: number;     // version of the payload schema
  artifact_id: string;         // stable across versions of the same artifact
  version: number;             // monotonic per artifact_id, starts at 1
  status: "published" | "withdrawn";
  created_at: string;          // ISO-8601 UTC
  published_at: string | null;
  supersedes: string | null;   // previous release_id
  payload_hash: string;        // sha256 of canonical payload + asset manifest
  assets: AssetRef[];
  payload: unknown;            // validated against payload_type + payload_version
  tombstone: boolean;
  signature: string;           // Ed25519 over the canonical envelope minus signature
};

type AssetRef = {
  key: string;                 // stable within the payload
  sha256: string;
  bytes: number;
  media_type: string;
  path: string;                // relative path inside the release archive
};
```

### Rules

1. Immutable after publication. A correction is a **new version**, never an edit.
2. `version` increases by exactly 1 per `artifact_id`. Gaps are a validation error.
3. `payload_hash` covers canonical payload **and** the asset manifest, so swapping an asset invalidates the release.
4. Idempotency key is `release_id`. Replaying it returns the original receipt, never a new one.
5. Withdrawal is a new release with `tombstone: true` and `status: "withdrawn"`. History is never mutated.
6. The envelope must never contain: bearer tokens, private object paths, provider credentials, prompt text, model outputs, rejected candidates, or private source images.

### Canonical JSON

Deterministic hashing is the whole point — Frank and every consumer must compute the same hash.

- UTF-8, no BOM
- Object keys sorted by Unicode code point
- No insignificant whitespace
- Numbers as shortest round-trip form; no `-0`, no exponents for integers
- `undefined` omitted; `null` preserved
- Arrays keep order

Write a test proving two independent serialisations of a semantically identical object produce identical bytes.

---

## 2. TemplatePack v1 (payload type)

```ts
type TemplatePack = {
  template_id: string;
  builder_version: string;
  renderer_version: string;      // must match the renderer that will consume it
  classification: string;        // from the project pack taxonomy
  feed_layout: Layout;           // 1080 × 1350
  story_layout: Layout;          // 1080 × 1920
  inputs: InputContract;         // shared across both layouts
  semantic_colours: ColourRole[];
  fonts: FontRef[];
  safe_previews: AssetRef[];     // must match deterministic renders
  qa_evidence: QaEvidence;
};

type Layout = {
  width: 1080;
  height: 1350 | 1920;
  layers: Layer[];               // ordered, back to front
};

type Layer =
  | { type: "plate";         id: string; geometry: Geometry; asset_key: string }
  | { type: "image_slot";    id: string; geometry: Geometry; slot: ImageSlot }
  | { type: "overlay_patch"; id: string; geometry: Geometry; asset_key: string; alpha: number }
  | { type: "text";          id: string; geometry: Geometry; text: TextSpec }
  | { type: "logo";          id: string; geometry: Geometry; asset_key: string };

type Geometry = {                // normalised 0..1 relative to layout
  x: number; y: number; w: number; h: number;
  rotation?: number;             // degrees, default 0
};

type ImageSlot = {
  input_key: string;             // must exist in inputs.images
  mask: "none" | "rect" | "rounded" | "circle" | "path";
  mask_path?: string;            // SVG path, required when mask === "path"
  min_source: { w: number; h: number };
  default_crop: { x: number; y: number; w: number; h: number };
  allow_placement_override: boolean;
};

type TextSpec = {
  input_key: string;             // must exist in inputs.texts
  font_key: string;              // must exist in fonts
  size_px: number;
  line_height: number;
  tracking: number;
  align: "left" | "center" | "right";
  max_chars: number;
  max_lines: number;
  colour_role: string;           // must exist in semantic_colours
  on_overflow: "refuse";         // only legal value in v1
};

type FontRef = { key: string; family: string; weight: number; style: string; sha256: string; asset_key: string };
type ColourRole = { role: "background"|"primary"|"secondary"|"accent"|"text"|"text_inverse"; default_hex: string };
```

### The pack must never contain

Executable code · HTML · external asset URLs · `data:` URLs · private source images · prompt history · credentials · rejected candidates · any human-review or approval field · a missing `feed_layout` or `story_layout`.

Encode these as **explicit rejection tests**, not documentation.

---

## 3. AdDocument v1 (customer editing state — consumer side)

```ts
type AdDocument = {
  template_id: string;
  template_version: number;
  template_hash: string;
  renderer_version: string;
  shared_image_values: Record<string, ImageValue>;   // keyed by input_key
  shared_text_values: Record<string, string>;
  feed_crop_overrides: Record<string, CropBox>;      // keyed by layer id
  story_crop_overrides: Record<string, CropBox>;
  colour_mode: "template" | "brand_pack";
  resolved_colour_map: Record<string, string>;
  meta_primary_text: string;
  meta_headline: string;
  meta_description: string;
  meta_cta: string;
  revision: number;
  document_hash: string;
  last_rendered_hash: string | null;
};

type CropBox = { x: number; y: number; w: number; h: number };   // normalised against the ORIGINAL image
type ImageValue = { object_id: string; sha256: string; width: number; height: number };
```

Feed and Story hold **separate** crop overrides. A shared image replacement updates both; a crop change affects only the placement being edited.

---

## 4. Fixtures — every one is a required test

**Valid:** complete Feed+Story pack · single-layer minimal pack · pack with `logo` layer · identical idempotent replay · article payload · ad-intelligence payload.

**Invalid — each must fail with a distinct stable error code:**

| Fixture | Expected code |
|---|---|
| Missing `story_layout` | `PACK_MISSING_PLACEMENT` |
| `input_key` referenced by a layer but absent from `inputs` | `PACK_INPUT_KEY_MISMATCH` |
| Geometry outside 0..1 | `PACK_LAYER_BOUNDS` |
| Font `sha256` doesn't match its asset | `PACK_FONT_HASH` |
| Payload references a private source asset | `PACK_PRIVATE_SOURCE` |
| Any external URL or `data:` URL | `PACK_EXTERNAL_URL` |
| Signature doesn't verify | `ENVELOPE_SIGNATURE` |
| An `AssetRef.sha256` doesn't match its bytes | `ENVELOPE_ASSET_HASH` |
| `renderer_version` unsupported by consumer | `PACK_RENDERER_VERSION` |
| Same `artifact_id` + `version`, different `payload_hash` | `RELEASE_VERSION_CONFLICT` |
| `version` jumps by more than 1 | `RELEASE_VERSION_GAP` |
| Crop box outside the image | `DOC_CROP_BOUNDS` |
| `colour_role` not in `semantic_colours` | `PACK_COLOUR_ROLE` |
| Text exceeds `max_chars` or `max_lines` | `DOC_TEXT_OVERFLOW` |

---

## Done when

- [ ] `pnpm build` and typecheck pass in the package
- [ ] JSON Schemas generate from the TS types; no hand-maintained drift
- [ ] Every valid fixture validates; every invalid fixture fails with its exact code
- [ ] Canonical hashing test: two independent serialisations → identical sha256
- [ ] Sign/verify round-trip; tampering any byte fails verification
- [ ] A fixture project `acme` produces a pack with no real-estate or Blockwise vocabulary
- [ ] `grep -ri blockwise packages/frank-release-contract/` returns nothing
- [ ] `.build/DECISIONS.md` records every field you added or omitted and why

**Then the contract is frozen.** Any later change requires a coordinator decision recorded in DECISIONS.md, and re-validation of every producer and consumer built against it.
