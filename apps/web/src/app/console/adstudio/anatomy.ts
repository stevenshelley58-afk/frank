/**
 * Pure logic for the AdStudio Template Anatomy demo view.
 *
 * Every formula and prompt string here is a direct port of the production
 * Blockwise code, so the numbers the UI displays are real — not illustrative:
 *
 *   - buildPrebuiltTemplateCloneQa  →  mapSampleBoxToFormat / buildEditorRegions
 *       src/lib/adstudio/clone-regions.ts
 *   - cropRegionWithPadding         →  cropWindowRect          (padFraction 0.15)
 *       src/lib/adstudio/region-edit.ts
 *   - paddedPixelRect               →  paddedPixelRect         (COMPOSITE_PADDING 0.02)
 *       src/lib/adstudio/region-edit.ts
 *   - compositeRegionBack (crop-local rebase) →  compositeLocalRect
 *       src/lib/adstudio/region-edit.ts
 *   - buildTargetedEditRequest (text branch)  →  buildTargetedEditPrompt
 *       src/lib/adstudio/reference-clone.ts
 *   - CSS font-size = (region box height px) * sizeRatio
 *       src/lib/adstudio/templates.ts  (AdStudioTypeSpec.sizeRatio doc)
 *
 * This module is demo-only. The shipped package never imports it.
 */

import type { DemoTemplate, DemoTypeSpec } from "./templates-data";

/** Same compositing tolerance as region-edit.ts — the ±2% edge breathing room. */
export const COMPOSITE_PADDING = 0.02;
/** Same crop padding as region-edit.ts — 15% of the box's own size on every side. */
export const CROP_PAD_FRACTION = 0.15;
/** Both supported canvases are 1080px wide. */
export const CANVAS_WIDTH = 1080;

export type RegionBox = { x: number; y: number; width: number; height: number };
export type PixelRect = { left: number; top: number; width: number; height: number };

export type EditorRegion = {
  key: string;
  kind: "text" | "image";
  label: string;
  /** Normalized 0..1 box in the TARGET format canvas. */
  box: RegionBox;
  /** Normalized 0..1 box as measured on the SAMPLE (source-format) canvas. */
  sampleBox: RegionBox;
  typeSpec?: DemoTypeSpec;
  sampleText?: string;
  required?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

export function targetHeightFor(format: string): number {
  return format === "4:5" ? 1350 : format === "9:16" ? 1920 : 0;
}

/**
 * Port of the mapSampleBox closure inside buildPrebuiltTemplateCloneQa.
 * Story (9:16) generation extends a Feed (4:5) canvas equally above and below;
 * Feed generation from a Story sample centre-crops. Applying the same
 * deterministic transform keeps the offline boxes aligned.
 */
export function mapSampleBoxToFormat(
  box: RegionBox,
  sourceHeight: number,
  targetHeight: number,
): RegionBox | null {
  const verticalOffset = (targetHeight - sourceHeight) / 2;
  const rawY = (box.y * sourceHeight + verticalOffset) / targetHeight;
  const rawBottom = rawY + (box.height * sourceHeight) / targetHeight;
  const y = Math.max(0, rawY);
  const bottom = Math.min(1, rawBottom);
  if (bottom <= y) return null;
  return {
    x: box.x,
    y,
    width: box.width,
    height: bottom - y,
  };
}

/**
 * Port of buildPrebuiltTemplateCloneQa — the editor map that gets copied into
 * every matching-format creative BEFORE it is persisted (no vision at runtime).
 */
export function buildEditorRegions(template: DemoTemplate, format: string): EditorRegion[] {
  const targetHeight = targetHeightFor(format);
  if (!targetHeight) return [];
  const sourceHeight = template.dimensions.height;

  const regions: EditorRegion[] = [];
  for (const field of template.textInputs) {
    const spec = template.typography[field.key];
    if (!spec?.sampleBox) continue;
    const box = mapSampleBoxToFormat(spec.sampleBox, sourceHeight, targetHeight);
    if (!box) continue;
    regions.push({
      key: field.key,
      kind: "text",
      label: field.label,
      box,
      sampleBox: spec.sampleBox,
      typeSpec: spec,
      sampleText: field.sample,
      required: field.required,
    });
  }
  for (const field of template.imageInputs) {
    if (!field.box) continue;
    const box = mapSampleBoxToFormat(field.box, sourceHeight, targetHeight);
    if (!box) continue;
    regions.push({
      key: field.key,
      kind: "image",
      label: field.label,
      box,
      sampleBox: field.box,
      required: field.required,
    });
  }
  return regions;
}

/** Normalized box → pixel rectangle on a canvas of the given size. */
export function regionPx(box: RegionBox, imageWidth: number, imageHeight: number): PixelRect {
  return {
    left: Math.round(box.x * imageWidth),
    top: Math.round(box.y * imageHeight),
    width: Math.round(box.width * imageWidth),
    height: Math.round(box.height * imageHeight),
  };
}

/** Port of paddedPixelRect from region-edit.ts (±2% compositing tolerance). */
export function paddedPixelRect(box: RegionBox, imageWidth: number, imageHeight: number): PixelRect {
  const left = Math.max(0, Math.floor((box.x - COMPOSITE_PADDING) * imageWidth));
  const top = Math.max(0, Math.floor((box.y - COMPOSITE_PADDING) * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((box.x + box.width + COMPOSITE_PADDING) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((box.y + box.height + COMPOSITE_PADDING) * imageHeight));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Port of the crop-window math in cropRegionWithPadding: grow the box by
 * padFraction of its own size on every side, clamped to the image bounds.
 */
export function cropWindowRect(
  box: RegionBox,
  imageWidth: number,
  imageHeight: number,
  padFraction: number = CROP_PAD_FRACTION,
): PixelRect {
  const boxLeft = box.x * imageWidth;
  const boxTop = box.y * imageHeight;
  const boxWidth = box.width * imageWidth;
  const boxHeight = box.height * imageHeight;
  const padX = padFraction * boxWidth;
  const padY = padFraction * boxHeight;

  const left = clamp(Math.floor(boxLeft - padX), 0, imageWidth - 1);
  const top = clamp(Math.floor(boxTop - padY), 0, imageHeight - 1);
  const right = clamp(Math.ceil(boxLeft + boxWidth + padX), left + 1, imageWidth);
  const bottom = clamp(Math.ceil(boxTop + boxHeight + padY), top + 1, imageHeight);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Port of rebaseBoxToCrop from region-edit.ts. */
export function rebaseBoxToCrop(
  box: RegionBox,
  cropRect: PixelRect,
  originalWidth: number,
  originalHeight: number,
): RegionBox | undefined {
  if (!box || box.width <= 0 || box.height <= 0 || cropRect.width <= 0 || cropRect.height <= 0) {
    return undefined;
  }
  const x = clamp01((box.x * originalWidth - cropRect.left) / cropRect.width);
  const y = clamp01((box.y * originalHeight - cropRect.top) / cropRect.height);
  const width = clamp01((box.width * originalWidth) / cropRect.width);
  const height = clamp01((box.height * originalHeight) / cropRect.height);
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width: clamp01(Math.min(width, 1 - x)), height: clamp01(Math.min(height, 1 - y)) };
}

/**
 * Port of the crop-local paste rectangle inside compositeRegionBack: the
 * selected box grown by the ±2% tolerance, re-based into crop-local pixels and
 * clamped to the crop bounds. This is the ONLY rectangle that gets pasted back.
 */
export function compositeLocalRect(
  box: RegionBox,
  cropRect: PixelRect,
  imageWidth: number,
  imageHeight: number,
): PixelRect {
  const full = paddedPixelRect(box, imageWidth, imageHeight);
  const fullLeft = full.left;
  const fullTop = full.top;
  const fullRight = full.left + full.width;
  const fullBottom = full.top + full.height;

  const cropLocalLeft = clamp(fullLeft - cropRect.left, 0, cropRect.width - 1);
  const cropLocalTop = clamp(fullTop - cropRect.top, 0, cropRect.height - 1);
  const cropLocalRight = clamp(fullRight - cropRect.left, cropLocalLeft + 1, cropRect.width);
  const cropLocalBottom = clamp(fullBottom - cropRect.top, cropLocalTop + 1, cropRect.height);
  return {
    left: cropLocalLeft,
    top: cropLocalTop,
    width: Math.max(1, cropLocalRight - cropLocalLeft),
    height: Math.max(1, cropLocalBottom - cropLocalTop),
  };
}

/**
 * Port of the text-edit branch of buildTargetedEditRequest from
 * reference-clone.ts — the exact prompt the model receives for a text change.
 */
export function buildTargetedEditPrompt(inputs: {
  fieldLabel: string;
  newValue: string;
  expectedCopy?: Record<string, string>;
}): string {
  const preservationContract = Object.entries(inputs.expectedCopy ?? {})
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("; ");
  const preservationInstruction = preservationContract
    ? ` Every listed text value must remain visible and character-for-character exact: ${preservationContract}.`
    : "";
  return (
    `Reference image 1 is an existing finished ad. Change only the ${inputs.fieldLabel} ` +
    `so it reads exactly "${inputs.newValue}" in the same position and type treatment. ` +
    `Keep every other pixel unchanged.${preservationInstruction}`
  );
}

/**
 * Production font-size formula (templates.ts): CSS font-size equals the
 * region box height in the consumer's own pixels, times sizeRatio.
 */
export function fontCssSizePx(boxHeightPx: number, sizeRatio: number): number {
  return boxHeightPx * sizeRatio;
}

/** Fraction of the full canvas a region occupies (area), for the "how small is the edit" stat. */
export function regionAreaFraction(box: RegionBox): number {
  return box.width * box.height;
}
