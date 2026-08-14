# B4-4 — Layered customer editor

**Depends:** B4-3 (catalogue), F1-2 · **Model:** cheap · **Three sub-lanes, parallel**
**Allowed files:** `src/components/adstudio/**`, `src/lib/adstudio/editor/**`
**Forbidden:** API routes, migrations, Frank repo

**Law: no PNG exists during editing.** The customer edits layers. PNGs are produced only by Save, server-side.

Before any UI work, load `$impeccable` and follow: critique → distill → craft → layout → typeset → adapt → harden → polish. Inspect the current production interface first. Use shadcn/ui, Tailwind v4 and existing Blockwise tokens. If `$impeccable` is unavailable, pause and escalate.

---

## Sub-lane A — Editor shell and layers

`src/components/adstudio/editor/**`

- Feed and Story tabs over one shared document
- Konva layered canvas (Konva is **not currently installed** — add it)
- Layer selection, shared text editing, image-slot selection
- Undo/redo across all mutations
- Explicit dirty / saved / error state — never optimistic
- Full keyboard access; mobile sheets
- **No client-generated canonical PNG.** A canvas `toDataURL` anywhere in this lane is a bug.

---

## Sub-lane B — Image selection and crop UX

`src/components/adstudio/crop/**`

The crop interaction, exactly:

1. Customer chooses **Upload** or **Library**
2. **Preserve the original image** — always
3. Correct EXIF orientation
4. Validate type, size, dimensions against the slot's `min_source`
5. Open a crop dialog showing the **complete image**
6. **Shade everything outside the crop box**
7. Lock the crop box aspect ratio to the selected slot
8. Move and resize with mouse, touch **and keyboard**
9. Clamp the box inside the image bounds
10. Show the actual slot result live alongside
11. Store **normalised** crop coordinates against the original
12. Feed and Story keep **separate** crop coordinates
13. **Never upload a destructively cropped copy**

Shared image replacement updates both placements. A crop change affects only the placement being edited. Test both directions — this is the most common thing to get backwards.

---

## Sub-lane C — Colours, copy and wireframes

`src/components/adstudio/panels/**`

**The colour checkbox, exactly:**
- Unchecked → template colours
- Checked → Brand Pack colours

Semantic roles: background · primary · secondary · accent · main text · inverse text.

Handle a missing role or insufficient contrast **without silently altering the template** — surface it to the customer and refuse the swap for that role.

Same panel also owns: primary text · headline · description · CTA · Facebook Feed wireframe · Instagram Feed wireframe · Story wireframe · truncation and "more" behaviour matching Meta's real rendering.

---

## Visual gate

Chrome on a Vercel Preview at **1440×900**, **768×1024**, **390×844**, **320×844**.

Check: mouse, touch emulation, keyboard, focus order, 44-pixel touch targets, zoom, text overflow, screen-reader labels.

---

## Done when

- [ ] One shared document drives both tabs; switching tabs never loses state
- [ ] Crop dialog shows the whole image with outside-box shading, ratio locked to slot
- [ ] Keyboard-only crop works end to end
- [ ] Feed and Story crops stay independent; shared image replacement updates both
- [ ] Original images are never destructively modified — verify stored bytes
- [ ] Colour checkbox switches modes; missing roles surface rather than silently defaulting
- [ ] No canvas-generated PNG anywhere in the client
- [ ] All four viewports pass; no dead `href="#"`; no mojibake
- [ ] Reload restores full layered state
