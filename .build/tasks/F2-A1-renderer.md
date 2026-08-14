# F2-A1 — Deterministic renderer

**Depends:** F1-2 (contract frozen) · **Model:** cheap · **Parallel group A**
**Allowed files:** `packages/frank-renderer/**`
**Forbidden:** Frank service, Blockwise UI, contract package, hot files

One renderer. Frank QA and Blockwise Save/Publish both call it. If you find yourself writing a second render path, stop and escalate.

---

## Objective

Given a `TemplatePack` layout + resolved input values, produce a PNG at exact dimensions, byte-identical for identical inputs.

```
renderLayout({
  layout: Layout,
  inputs: ResolvedInputs,
  colourMap: Record<string,string>,
  assets: AssetResolver,        // key -> bytes, verified by sha256
  fonts: FontResolver
}) => { png: Buffer, sha256: string }
```

---

## Requirements

1. **Exact output size.** Feed `1080×1350`, Story `1080×1920`. No scaling of the canvas, ever.
2. **Deterministic layer order** — array order, back to front. No z-index, no sorting.
3. **Fonts loaded by recorded hash.** Verify `sha256` before use; mismatch is a hard error, never a fallback font. A missing font fails the render.
4. **Image slot masks:** `none`, `rect`, `rounded`, `circle`, `path`. Anti-aliasing settings must be pinned so output is stable across runs.
5. **Crop transform.** Crop boxes are normalised against the **original** image, not the slot. Apply crop, then fit to slot geometry. Never upscale beyond `min_source`; refuse instead.
6. **Overlay alpha** composited in linear space, pinned blend mode.
7. **Text measurement and refusal.** Measure with the actual font. If the string exceeds `max_chars`, `max_lines`, or the geometry box, **refuse the render with `DOC_TEXT_OVERFLOW`**. Never shrink, never ellipsise, never overflow.
8. **Semantic colour resolution.** Resolve `colour_role` through `colourMap`. A missing role is an error, not a silent default.
9. **No network access during rendering.** Assert this in test by rendering with networking disabled.
10. **Byte-identical output.** Same inputs → same sha256. Across processes, across restarts, across machines.

---

## Determinism — the hard part

Sources of non-determinism to eliminate explicitly, each with a test:

- Font hinting and subpixel positioning → pin hinting mode, disable subpixel AA
- Colour profile handling → strip all input profiles, work in sRGB, embed nothing
- PNG encoder metadata → no timestamps, no software tag, fixed compression level
- Floating-point geometry → round to a fixed sub-pixel grid before rasterising, document the grid
- Image decode differences → pin the decoder and its version

**Test:** render the same fixture 100 times in one process and 10 times across fresh processes. All 110 hashes identical.

---

## Vercel compatibility canary

Blockwise runs on Vercel. Before building further:

1. Build a minimal canary that renders one fixture using the chosen native library.
2. Deploy it to a Vercel Preview.
3. Confirm the PNG hash matches the local render exactly.

**If the native library does not work on Vercel, stop and escalate to the coordinator.** The decision is then: run the renderer as a Frank service that Blockwise calls over HTTP. **Do not ship two renderer paths** — that guarantees Feed/Story divergence between Frank's QA and Blockwise's Save.

Record the outcome in `.build/DECISIONS.md` either way.

---

## Fixtures

| Fixture | Asserts |
|---|---|
| `minimal-feed` | single plate, exact 1080×1350 |
| `minimal-story` | single plate, exact 1080×1920 |
| `all-layer-types` | plate, image_slot, overlay_patch, text, logo |
| `mask-each` | one per mask type |
| `crop-extremes` | crop at each corner and centre, portrait/landscape/square sources |
| `text-longest` | at exactly `max_chars` — must render |
| `text-overflow` | one char over — must refuse with the exact code |
| `text-single-char` | must render, no layout collapse |
| `colour-template` vs `colour-brand` | same layout, two colour maps, different output |
| `missing-colour-role` | must error |
| `font-hash-mismatch` | must error, no fallback |
| `min-source-violation` | image below `min_source` → refuse |

---

## Done when

- [ ] All fixtures render or refuse exactly as specified
- [ ] 110-render determinism test passes (100 in-process, 10 cross-process)
- [ ] Vercel canary hash matches local hash, **or** the escalation decision is recorded in DECISIONS.md
- [ ] Network access during render is proven impossible
- [ ] Text overflow refuses — verified by a test that would fail if it silently shrank
- [ ] No project-specific vocabulary: `grep -ri blockwise packages/frank-renderer/` is empty
- [ ] Renderer exports its `renderer_version`, and it matches what packs declare
