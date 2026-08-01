import type { PipelineSpec } from '@frank/pipeline-graph';

import type { DemoTemplate } from './templates-data';

/**
 * Per-template pipeline trace, built from the real Blockwise production code
 * paths (verified in Blockwise src/lib/adstudio/):
 *
 *   OFFLINE (build time, runs once per template)
 *     source ad → buildCloneImageRequest → generation → QA gate → approved sample
 *       → adstudio-type-specs.mjs (OCR v2) → typography map
 *       → template contract (typography + deterministicEditing.imageBoxes)
 *
 *   ONLINE (customer generation — no vision, no re-measurement)
 *     customer assets + copy → buildCloneImageRequest (reference = sample)
 *       → buildPrebuiltTemplateCloneQa copies the offline boxes onto the
 *         matching-format creative BEFORE it is persisted → editor regions
 *         live on the creative → targeted edit redraws ONLY a ±2% padded box.
 */
export function buildTemplateTraceSpec(t: DemoTemplate): PipelineSpec {
  /** First text region that actually has a measured spec (robust across templates). */
  const firstMeasured =
    t.textInputs.find((f) => t.typography[f.key]?.sampleBox) ?? t.textInputs[0];
  const headline = firstMeasured ? t.typography[firstMeasured.key] : undefined;
  const headlineBox = headline?.sampleBox ?? { x: 0, y: 0, width: 0, height: 0 };

  const copyLegend = t.textInputs
    .map((f) => `${f.label}: "${f.sample}"`)
    .join('; ');

  /** Real prompt shape from buildCloneImageRequest (reference-clone.ts). */
  const clonePrompt = [
    'Clone reference image 1 as closely as possible, preserving its composition, spacing, typography, visual hierarchy, shapes, and image treatment.',
    'Reference image 1 is the ad design to clone.',
    "Reference image 2 is the customer's landscape property photograph. Replace the matching asset in the design with it.",
    'Customer asset replacement is mandatory: reference image 1 controls the design only; never retain a source image where a supplied replacement asset belongs.',
    `Use these exact visible text values and no others: ${copyLegend}.`,
    'Every supplied text value is mandatory: render each value character-for-character exactly once, fully visible, and at a readable size.',
    'Colour instruction: preserve the exact colour palette of reference image 1. Do not recolour the design to match the supplied logo or Brand Pack.',
    `Produce one finished ${t.format} Meta real-estate ad with no Meta interface chrome.`,
  ].join(' ');

  /** Real prompt shape from buildTargetedEditRequest — text branch. */
  const editLegend = t.textInputs
    .slice(0, 3)
    .map((f) => `${f.key}: "${f.sample}"`)
    .join('; ');
  const editField = t.textInputs[0];
  const editPrompt = [
    'Reference image 1 is an existing finished ad.',
    `Change only the ${editField?.label ?? 'Headline'} so it reads exactly "${editField?.sample ?? ''}" in the same position and type treatment.`,
    'Keep every other pixel unchanged.',
    ` Every listed text value must remain visible and character-for-character exact: ${editLegend}.`,
  ].join(' ');

  const sampleHash = t.sourceHash.slice(0, 8);

  const openAnatomy = [
    {
      key: 'open-anatomy',
      label: 'Inspect regions →',
      variant: 'primary' as const,
      hint: 'Drill into Template Anatomy for this template',
    },
  ];

  return {
    id: `adstudio.template-trace.${t.id}`,
    title: `Template lifecycle: ${t.name}`,
    description:
      'How one real template goes from a private source ad to customer-editable text regions — and why those regions never move when the models run.',
    direction: 'LR',
    nodes: [
      /* ---------------- OFFLINE BUILD ---------------- */
      {
        id: 'source-ad',
        kind: 'data',
        title: 'Source ad',
        subtitle: 'Private Meta ad we clone from. Never shown to customers.',
        status: 'ok',
        payload: {
          kind: 'data',
          entries: [
            { key: 'file', value: `meta_ad_candidates/${t.sourceFile}` },
            { key: 'sha-256', value: `${sampleHash}…` },
            { key: 'canvas', value: `${t.dimensions.width}×${t.dimensions.height}` },
            { key: 'visibility', value: 'private — operator only' },
          ],
        },
        meta: [
          { key: 'file', value: `meta_ad_candidates/${t.sourceFile}`, mono: true },
          { key: 'sha-256', value: `${sampleHash}…`, mono: true },
          { key: 'canvas', value: `${t.dimensions.width}×${t.dimensions.height}` },
        ],
      },
      {
        id: 'clone-request',
        kind: 'process',
        title: 'buildCloneImageRequest',
        subtitle: 'The only full-ad generation request. Reference order is contractual.',
        status: 'ok',
        payload: { kind: 'text', value: clonePrompt, code: true },
        meta: [
          { key: 'reference 1', value: 'the ad design to clone' },
          { key: 'stylePreset', value: 'real_estate_clone', mono: true },
          { key: 'aspectRatio', value: t.format, mono: true },
        ],
      },
      {
        id: 'generation',
        kind: 'process',
        title: 'Image generation',
        subtitle: 'Seeded, deterministic-input image model call.',
        status: 'ok',
        meta: [
          { key: 'seed', value: '0', mono: true },
          { key: 'negativePrompt', value: 'GLOBAL_CLONE_NEGATIVES', mono: true },
        ],
      },
      {
        id: 'qa-gate',
        kind: 'gate',
        title: 'Sample QA gate',
        subtitle: 'Hash must differ from source; no Meta chrome; copy exact.',
        status: 'ok',
        meta: [
          { key: 'generatedBy', value: 'reference_clone', mono: true },
          { key: 'sample hash', value: '≠ source hash', mono: true },
        ],
      },
      {
        id: 'approved-sample',
        kind: 'image',
        title: 'Approved sample',
        subtitle: 'The public design. The sample image IS the design.',
        status: 'ok',
        payload: { kind: 'image', src: t.sampleSrc, alt: t.name },
        actions: openAnatomy,
        meta: [
          { key: 'path', value: t.sampleSrc, mono: true },
          { key: 'canvas', value: `${t.dimensions.width}×${t.dimensions.height}` },
        ],
      },

      /* -------- OFFLINE MEASUREMENT (where the boxes come from) -------- */
      {
        id: 'offline-measure',
        kind: 'process',
        title: 'adstudio-type-specs.mjs',
        subtitle: 'Offline OCR v2 measures text regions once, from the approved sample.',
        status: 'ok',
        payload: {
          kind: 'data',
          entries: [
            { key: 'runs', value: 'once per template, at build time' },
            { key: 'measures', value: 'sampleBox + sizeRatio + font per region' },
            { key: 'vision at runtime', value: 'never' },
          ],
        },
        meta: [
          { key: 'script', value: 'scripts/build/font-corpus/adstudio-type-specs.mjs', mono: true },
          { key: 'measurementSource', value: 'ocr-v2', mono: true },
        ],
      },
      {
        id: 'typography-map',
        kind: 'data',
        title: 'Typography map',
        subtitle: 'Per-region type spec, keyed by text input. Real values below.',
        status: 'ok',
        payload: {
          kind: 'data',
          entries: [
            {
              key: `${firstMeasured?.key ?? 'headline'}.sampleBox`,
              value: `x ${headlineBox.x.toFixed(3)} · y ${headlineBox.y.toFixed(3)} · w ${headlineBox.width.toFixed(3)} · h ${headlineBox.height.toFixed(3)}`,
            },
            { key: `${firstMeasured?.key ?? 'headline'}.sizeRatio`, value: String(headline?.sizeRatio.toFixed(4) ?? '—') },
            { key: `${firstMeasured?.key ?? 'headline'}.font`, value: headline ? `${headline.family} ${headline.weight}` : '—' },
            { key: 'font-size rule', value: 'CSS px = box height px × sizeRatio' },
          ],
        },
        meta: [
          { key: 'regions measured', value: String(t.textInputs.length) },
          { key: 'fitScore', value: String(headline?.fitScore ?? '—') },
        ],
      },
      {
        id: 'template-contract',
        kind: 'data',
        title: 'Template contract',
        subtitle: 'The only AdStudio template contract: sample + inputs + measured boxes.',
        status: 'ok',
        payload: {
          kind: 'data',
          entries: [
            { key: 'id', value: t.id },
            { key: 'format', value: `${t.format} → ${t.dimensions.width}×${t.dimensions.height}` },
            { key: 'text inputs', value: String(t.textInputs.length) },
            { key: 'image inputs', value: String(t.imageInputs.length) },
            { key: 'deterministicEditing', value: t.deterministicStatus },
          ],
        },
        meta: [
          { key: 'file', value: `template-gallery/${t.id}.json`, mono: true },
          { key: 'imageBoxes', value: `${t.imageInputs.filter((i) => i.box).length} measured` },
        ],
      },

      /* ---------------- ONLINE: CUSTOMER GENERATION ---------------- */
      {
        id: 'customer-inputs',
        kind: 'text',
        title: 'Customer copy',
        subtitle: 'The text inputs the customer fills in. Edit me.',
        status: 'ok',
        fields: t.textInputs.slice(0, 3).map((f) => ({
          key: f.key,
          label: f.label,
          value: f.sample,
          maxLength: f.maxLength,
        })),
        meta: [
          { key: 'text fields', value: String(t.textInputs.length) },
          { key: 'image fields', value: String(t.imageInputs.length) },
        ],
      },
      {
        id: 'customer-generation',
        kind: 'process',
        title: 'Customer generation',
        subtitle: 'Same clone request, reference image 1 = the approved sample.',
        status: 'ok',
        payload: {
          kind: 'data',
          entries: [
            { key: 'reference 1', value: 'approved sample (the design)' },
            { key: 'reference 2+', value: 'customer property photo, portrait, logo' },
            { key: 'prompt', value: 'buildCloneImageRequest (identical shape)' },
          ],
        },
        meta: [{ key: 'aspectRatio', value: '4:5 or 9:16', mono: true }],
      },
      {
        id: 'region-map-copy',
        kind: 'gate',
        title: 'buildPrebuiltTemplateCloneQa',
        subtitle: 'Offline boxes are copied onto the creative BEFORE it is persisted. No vision.',
        status: 'ok',
        payload: {
          kind: 'data',
          entries: [
            { key: '4:5 → 4:5', value: 'boxes copied as-is' },
            { key: '4:5 → 9:16', value: 'extend canvas equally above & below' },
            { key: '9:16 → 4:5', value: 'centre-crop' },
            { key: 'result', value: 'editor regions persisted with the creative' },
          ],
        },
        meta: [{ key: 'vision model calls', value: '0', mono: true }],
      },
      {
        id: 'finished-creative',
        kind: 'image',
        title: 'Finished creative',
        subtitle: 'The flat ad the customer edits. Regions are already on it.',
        status: 'ok',
        payload: {
          kind: 'image',
          src: t.sampleSrc,
          alt: 'Finished creative with editor regions',
          overlayBoxes: t.textInputs
            .map((f) => {
              const spec = t.typography[f.key];
              return spec?.sampleBox
                ? { ...spec.sampleBox, label: f.label }
                : { x: 0, y: 0, width: 0, height: 0 };
            })
            .filter((b) => b.width > 0),
        },
        actions: openAnatomy,
        meta: [
          { key: 'text regions', value: String(t.textInputs.filter((f) => t.typography[f.key]?.sampleBox).length) },
          { key: 'image hitboxes', value: String(t.imageInputs.filter((i) => i.box).length) },
        ],
      },

      /* ---------------- TARGETED EDIT (why things don't move) ---------------- */
      {
        id: 'region-edit',
        kind: 'process',
        title: 'Targeted region edit',
        subtitle: 'Crop → model redraws only the crop → paste back only the ±2% box.',
        status: 'ok',
        payload: { kind: 'text', value: editPrompt, code: true },
        meta: [
          { key: 'crop padding', value: '15% of box size', mono: true },
          { key: 'composite tolerance', value: '±2% (COMPOSITE_PADDING 0.02)', mono: true },
          { key: 'pixels changed', value: 'only inside the padded box' },
        ],
      },
    ],
    edges: [
      { id: 'e.source.clone', source: 'source-ad', target: 'clone-request', label: 'design reference' },
      { id: 'e.clone.gen', source: 'clone-request', target: 'generation' },
      { id: 'e.gen.qa', source: 'generation', target: 'qa-gate' },
      { id: 'e.qa.sample', source: 'qa-gate', target: 'approved-sample', label: 'approved' },
      { id: 'e.sample.measure', source: 'approved-sample', target: 'offline-measure', label: 'OCR v2, once' },
      { id: 'e.measure.typo', source: 'offline-measure', target: 'typography-map', label: 'sampleBox + sizeRatio' },
      { id: 'e.typo.contract', source: 'typography-map', target: 'template-contract' },
      { id: 'e.sample.contract', source: 'approved-sample', target: 'template-contract', kind: 'control', label: 'sample = design' },
      { id: 'e.inputs.gen2', source: 'customer-inputs', target: 'customer-generation', label: 'copy + assets' },
      { id: 'e.contract.gen2', source: 'template-contract', target: 'customer-generation', kind: 'control', label: 'reference = sample' },
      { id: 'e.gen2.regions', source: 'customer-generation', target: 'region-map-copy' },
      { id: 'e.contract.regions', source: 'template-contract', target: 'region-map-copy', label: 'offline boxes' },
      { id: 'e.regions.creative', source: 'region-map-copy', target: 'finished-creative', label: 'regions persisted' },
      { id: 'e.creative.edit', source: 'finished-creative', target: 'region-edit', label: 'edit one region' },
    ],
  };
}
