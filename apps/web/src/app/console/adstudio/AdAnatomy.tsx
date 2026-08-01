'use client';

/**
 * AdStudio Template Anatomy — demo-only interactive view.
 *
 * Two modes:
 *   ANATOMY  — pick any real template, see the approved sample with every
 *              measured text/image region drawn as the actual sample text at
 *              production size; click a region for its exact spec; drag a
 *              region to reposition it (emits a spec patch).
 *   EDIT PATH — step through exactly how a text edit is executed and why the
 *              region never moves: crop a padded window → model redraws only
 *              the crop → paste back ONLY the ±2% padded box.
 *
 * All geometry comes from anatomy.ts, a direct port of the production
 * math, so every number on screen is real. Demo-only; never shipped.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";

import { DEMO_TEMPLATES, type DemoTemplate, type DemoTypeSpec } from "./templates-data";
import {
  buildEditorRegions,
  buildTargetedEditPrompt,
  compositeLocalRect,
  cropWindowRect,
  fontCssSizePx,
  paddedPixelRect,
  regionPx,
  regionAreaFraction,
  targetHeightFor,
  CANVAS_WIDTH,
  COMPOSITE_PADDING,
  CROP_PAD_FRACTION,
  type EditorRegion,
  type RegionBox,
} from "./anatomy";
import "./anatomy.css";

type Mode = "anatomy" | "edit";
type ViewFormat = "4:5" | "9:16";

const CANVAS_CSS_WIDTH = 430;

/* ------------------------------------------------------------------ */
/* Font injection — self-hosted faces live in public/fonts/adstudio.  */
/* One @font-face per unique fontFile so weights render correctly.    */
/* ------------------------------------------------------------------ */
function collectFontFaces(): Array<{ family: string; file: string; weight: number; italic: boolean }> {
  const seen = new Set<string>();
  const faces: Array<{ family: string; file: string; weight: number; italic: boolean }> = [];
  for (const template of DEMO_TEMPLATES) {
    for (const spec of Object.values(template.typography)) {
      if (!spec.fontFile) continue;
      const key = `${spec.fontId}-${spec.weight}-${spec.italic ? "i" : "r"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push({
        family: `anat-${key}`,
        file: spec.fontFile,
        weight: spec.weight,
        italic: spec.italic,
      });
    }
  }
  return faces;
}

function fontCssFor(spec: DemoTypeSpec): string {
  const key = `${spec.fontId}-${spec.weight}-${spec.italic ? "i" : "r"}`;
  return `anat-${key}, "${spec.family}", ${spec.fallbackFamily}`;
}

let fontsInjected = false;
function injectFonts() {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;
  const style = document.createElement("style");
  style.textContent = collectFontFaces()
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${f.file}") format("woff2");font-weight:${f.weight};font-style:${f.italic ? "italic" : "normal"};font-display:swap;}`,
    )
    .join("\n");
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                       */
/* ------------------------------------------------------------------ */
function fmt(n: number, digits = 4): string {
  return n.toFixed(digits);
}

function pctOfCanvas(box: RegionBox): string {
  return `${(regionAreaFraction(box) * 100).toFixed(1)}%`;
}

/** Preview per-line font size in CSS px for the scaled-down canvas. */
function previewFontSize(spec: DemoTypeSpec, boxHeightCssPx: number): number {
  const lines = Math.max(1, spec.sampleLineCount);
  const perLineHeight = boxHeightCssPx / lines;
  return perLineHeight * spec.sizeRatio;
}

/* ------------------------------------------------------------------ */
/* Format-map mini diagram (how the box survives 4:5 → 9:16)          */
/* ------------------------------------------------------------------ */
function FormatMap({ box }: { box: RegionBox }) {
  // Draw a 4:5 and a 9:16 canvas; the box is mapped between them with the
  // same deterministic transform production uses.
  const W = 62;
  const h45 = W * (1350 / 1080);
  const h916 = W * (1920 / 1080);
  // 4:5 → 9:16: extend canvas equally above & below.
  const off = (1920 - 1350) / 2;
  const y916 = (box.y * 1350 + off) / 1920;
  const hgt916 = (box.height * 1350) / 1920;
  return (
    <div className="anat-fmtmap">
      <div className="anat-fmt-col">
        <svg width={W} height={h45} viewBox={`0 0 ${W} ${h45}`}>
          <rect width={W} height={h45} fill="#eef1f4" stroke="#c2cad3" strokeWidth="1" />
          <rect
            x={box.x * W}
            y={box.y * h45}
            width={box.width * W}
            height={box.height * h45}
            fill="rgba(124,58,237,0.35)"
            stroke="#7c3aed"
            strokeWidth="1.5"
          />
        </svg>
        <span className="anat-fmt-cap">4:5 · measured</span>
      </div>
      <div className="anat-fmt-col">
        <svg width={W} height={h916} viewBox={`0 0 ${W} ${h916}`}>
          <rect width={W} height={h916} fill="#eef1f4" stroke="#c2cad3" strokeWidth="1" />
          <rect
            x={box.x * W}
            y={y916 * h916}
            width={box.width * W}
            height={hgt916 * h916}
            fill="rgba(28,100,217,0.30)"
            stroke="#1c64d9"
            strokeWidth="1.5"
          />
        </svg>
        <span className="anat-fmt-cap">9:16 · extended</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */
export type AdAnatomyProps = {
  /** Open with this template pre-selected (drill-down from the graph). */
  initialTemplateId?: string;
};

export function AdAnatomy({ initialTemplateId }: AdAnatomyProps = {}) {
  useEffect(() => {
    injectFonts();
  }, []);

  const [templateId, setTemplateId] = useState(initialTemplateId ?? DEMO_TEMPLATES[0].id);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("anatomy");
  const [viewFormat, setViewFormat] = useState<ViewFormat>("4:5");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, RegionBox>>({});
  const [showText, setShowText] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [simStep, setSimStep] = useState(0);
  const [editValue, setEditValue] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const template = useMemo(
    () => DEMO_TEMPLATES.find((t) => t.id === templateId) ?? DEMO_TEMPLATES[0],
    [templateId],
  );

  // Track external drill-down selection.
  useEffect(() => {
    if (initialTemplateId && initialTemplateId !== templateId) setTemplateId(initialTemplateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId]);

  // When the template changes, reset per-template state and pick a sensible default region.
  useEffect(() => {
    setViewFormat(template.format === "9:16" ? "9:16" : "4:5");
    setOverrides({});
    setSimStep(0);
    const firstText = buildEditorRegions(template, template.format === "9:16" ? "9:16" : "4:5").find(
      (r) => r.kind === "text",
    );
    setSelectedKey(firstText?.key ?? null);
    setEditValue(firstText?.sampleText ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const targetHeight = targetHeightFor(viewFormat);
  const canvasCssHeight = CANVAS_CSS_WIDTH * (targetHeight / CANVAS_WIDTH);

  const regions = useMemo(() => {
    const base = buildEditorRegions(template, viewFormat);
    return base.map((r) => (overrides[r.key] ? { ...r, box: overrides[r.key] } : r));
  }, [template, viewFormat, overrides]);

  const selected = useMemo(
    () => regions.find((r) => r.key === selectedKey) ?? null,
    [regions, selectedKey],
  );

  // The region the edit-path simulator targets (must be a text region).
  const simRegion = useMemo(
    () => (selected?.kind === "text" ? selected : regions.find((r) => r.kind === "text") ?? null),
    [selected, regions],
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return DEMO_TEMPLATES;
    return DEMO_TEMPLATES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [search]);

  /* ---------------- drag handling ---------------- */
  const beginDrag = useCallback(
    (e: React.PointerEvent, region: EditorRegion) => {
      if (mode !== "anatomy") return;
      const stage = stageRef.current;
      if (!stage) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      dragOffset.current = { dx: px - region.box.x, dy: py - region.box.y };
      setDragging(region.key);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [mode],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent, region: EditorRegion) => {
      if (dragging !== region.key) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const next: RegionBox = {
        x: Math.min(Math.max(0, px - dragOffset.current.dx), 1 - region.box.width),
        y: Math.min(Math.max(0, py - dragOffset.current.dy), 1 - region.box.height),
        width: region.box.width,
        height: region.box.height,
      };
      setOverrides((prev) => ({ ...prev, [region.key]: next }));
    },
    [dragging],
  );

  const endDrag = useCallback(() => setDragging(null), []);

  /* ---------------- simulator geometry ---------------- */
  const sim = useMemo(() => {
    if (!simRegion) return null;
    const W = CANVAS_WIDTH;
    const H = targetHeight;
    const crop = cropWindowRect(simRegion.box, W, H);
    const paste = paddedPixelRect(simRegion.box, W, H);
    const local = compositeLocalRect(simRegion.box, crop, W, H);
    const fullPx = W * H;
    const cropPx = crop.width * crop.height;
    const pastePx = paste.width * paste.height;
    return { crop, paste, local, fullPx, cropPx, pastePx };
  }, [simRegion, targetHeight]);

  const editPromptText = useMemo(() => {
    if (!simRegion) return "";
    const expected: Record<string, string> = {};
    for (const r of regions) {
      if (r.kind === "text" && r.key !== simRegion.key && r.sampleText) expected[r.key] = r.sampleText;
    }
    return buildTargetedEditPrompt({
      fieldLabel: simRegion.label,
      newValue: editValue || simRegion.sampleText || "",
      expectedCopy: expected,
    });
  }, [simRegion, regions, editValue]);

  const overrideFor = selectedKey ? overrides[selectedKey] : undefined;

  return (
    <div className="anat-root">
      {/* ---------- toolbar ---------- */}
      <div className="anat-toolbar">
        <div className="anat-title">
          Template Anatomy
          <span className="anat-title-sub">measured offline · deterministic at runtime</span>
        </div>

        <div className="anat-mode">
          <button className={mode === "anatomy" ? "active" : ""} onClick={() => setMode("anatomy")}>
            Anatomy
          </button>
          <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>
            Edit path
          </button>
        </div>

        <div className="anat-legend">
          <span><span className="swatch" style={{ background: "#7c3aed" }} />text region</span>
          <span><span className="swatch" style={{ background: "#0f766e" }} />image region</span>
          {mode === "edit" && (
            <>
              <span><span className="swatch" style={{ background: "#b45309" }} />crop window</span>
              <span><span className="swatch" style={{ background: "#15803d" }} />paste box (±2%)</span>
            </>
          )}
        </div>

        <div className="anat-spacer" />

        <span style={{ fontSize: 11, color: "var(--anat-ink-faint)" }}>canvas</span>
        <div className="anat-mode">
          <button className={viewFormat === "4:5" ? "active" : ""} onClick={() => setViewFormat("4:5")}>
            4:5
          </button>
          <button className={viewFormat === "9:16" ? "active" : ""} onClick={() => setViewFormat("9:16")}>
            9:16
          </button>
        </div>
        <label style={{ fontSize: 11, color: "var(--anat-ink-soft)", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> text
        </label>
        <label style={{ fontSize: 11, color: "var(--anat-ink-soft)", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} /> images
        </label>
      </div>

      {/* ---------- body ---------- */}
      <div className="anat-body">
        {/* rail */}
        <div className="anat-rail">
          <div className="anat-rail-header">{DEMO_TEMPLATES.length} templates</div>
          <input
            className="anat-search"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="anat-list">
            {filteredTemplates.map((t) => (
              <div
                key={t.id}
                className={`anat-item ${t.id === templateId ? "active" : ""}`}
                onClick={() => setTemplateId(t.id)}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="anat-item-name">{t.name}</div>
                  <div className="anat-item-meta">{t.textInputs.length} text · {t.imageInputs.length} img</div>
                </div>
                <span className="anat-format-tag">{t.format}</span>
              </div>
            ))}
          </div>
        </div>

        {/* canvas */}
        <div className="anat-canvaswrap">
          <div
            ref={stageRef}
            className="anat-stage"
            style={{ width: CANVAS_CSS_WIDTH, height: canvasCssHeight }}
          >
            <img src={template.sampleSrc} alt={template.name} draggable={false} />

            {/* dim outside crop in edit mode */}
            {mode === "edit" && sim && simStep >= 1 && (
              <DimOutside rect={sim.crop} w={CANVAS_CSS_WIDTH} h={canvasCssHeight} W={CANVAS_WIDTH} H={targetHeight} />
            )}

            {/* regions */}
            {regions.map((r) => {
              if (r.kind === "text" && !showText) return null;
              if (r.kind === "image" && !showImage) return null;
              const px = regionPx(r.box, CANVAS_CSS_WIDTH, canvasCssHeight);
              const isSel = r.key === selectedKey;
              const draggable = mode === "anatomy";
              const spec = r.typeSpec;
              const boxHeightCss = r.box.height * canvasCssHeight;
              return (
                <div
                  key={r.key}
                  className={[
                    "anat-region",
                    r.kind === "text" ? "kind-text" : "kind-image",
                    isSel ? "selected" : "",
                    draggable ? "draggable" : "",
                    dragging === r.key ? "dragging" : "",
                  ].join(" ")}
                  style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
                  onClick={() => setSelectedKey(r.key)}
                  onPointerDown={(e) => beginDrag(e, r)}
                  onPointerMove={(e) => onDragMove(e, r)}
                  onPointerUp={endDrag}
                >
                  <span className="anat-region-tag">{r.label}</span>
                  {r.kind === "text" && spec && r.sampleText && (
                    <span
                      className="anat-region-text"
                      style={{
                        fontFamily: fontCssFor(spec),
                        fontWeight: spec.weight,
                        fontStyle: spec.italic ? "italic" : "normal",
                        fontSize: previewFontSize(spec, boxHeightCss),
                        lineHeight: spec.lineHeight,
                        letterSpacing: spec.tracking ? `${spec.tracking}px` : undefined,
                        textAlign: spec.align,
                        color: spec.color,
                        textTransform: spec.case === "upper" ? "uppercase" : "none",
                      }}
                    >
                      {r.sampleText}
                    </span>
                  )}
                </div>
              );
            })}

            {/* simulator overlays */}
            {mode === "edit" && sim && simRegion && (
              <>
                {simStep >= 1 && (
                  <CropRect rect={sim.crop} W={CANVAS_WIDTH} H={targetHeight} cw={CANVAS_CSS_WIDTH} ch={canvasCssHeight} />
                )}
                {simStep >= 3 && (
                  <PasteRect rect={sim.paste} W={CANVAS_WIDTH} H={targetHeight} cw={CANVAS_CSS_WIDTH} ch={canvasCssHeight} />
                )}
              </>
            )}
          </div>
        </div>

        {/* inspector */}
        <div className="anat-inspector">
          {mode === "anatomy" ? (
            <AnatomyInspector
              template={template}
              region={selected}
              targetHeight={targetHeight}
              override={overrideFor}
              onReset={() => {
                if (selectedKey) setOverrides((p) => { const n = { ...p }; delete n[selectedKey]; return n; });
              }}
            />
          ) : (
            <EditInspector
              template={template}
              region={simRegion}
              sim={sim}
              step={simStep}
              setStep={setSimStep}
              editValue={editValue}
              setEditValue={setEditValue}
              prompt={editPromptText}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overlay rectangles                                                 */
/* ------------------------------------------------------------------ */
function scaleRect(rect: { left: number; top: number; width: number; height: number }, W: number, H: number, cw: number, ch: number) {
  return {
    left: (rect.left / W) * cw,
    top: (rect.top / H) * ch,
    width: (rect.width / W) * cw,
    height: (rect.height / H) * ch,
  };
}

function CropRect({ rect, W, H, cw, ch }: { rect: { left: number; top: number; width: number; height: number }; W: number; H: number; cw: number; ch: number }) {
  const s = scaleRect(rect, W, H, cw, ch);
  return (
    <div className="anat-crop-rect" style={{ left: s.left, top: s.top, width: s.width, height: s.height }}>
      <span className="anat-step-label">crop +15%</span>
    </div>
  );
}

function PasteRect({ rect, W, H, cw, ch }: { rect: { left: number; top: number; width: number; height: number }; W: number; H: number; cw: number; ch: number }) {
  const s = scaleRect(rect, W, H, cw, ch);
  return (
    <div className="anat-paste-rect" style={{ left: s.left, top: s.top, width: s.width, height: s.height }}>
      <span className="anat-step-label">paste ±2%</span>
    </div>
  );
}

/** Darken everything outside the crop using four surrounding divs. */
function DimOutside({ rect, w, h, W, H }: { rect: { left: number; top: number; width: number; height: number }; w: number; h: number; W: number; H: number }) {
  const s = scaleRect(rect, W, H, w, h);
  const dim: CSSProperties = { position: "absolute", background: "rgba(11,15,20,0.55)", pointerEvents: "none" };
  return (
    <div className="anat-dim">
      <div style={{ ...dim, left: 0, top: 0, width: w, height: s.top }} />
      <div style={{ ...dim, left: 0, top: s.top + s.height, width: w, height: h - (s.top + s.height) }} />
      <div style={{ ...dim, left: 0, top: s.top, width: s.left, height: s.height }} />
      <div style={{ ...dim, left: s.left + s.width, top: s.top, width: w - (s.left + s.width), height: s.height }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Anatomy inspector                                                  */
/* ------------------------------------------------------------------ */
function AnatomyInspector({
  template,
  region,
  targetHeight,
  override,
  onReset,
}: {
  template: DemoTemplate;
  region: EditorRegion | null;
  targetHeight: number;
  override?: RegionBox;
  onReset: () => void;
}) {
  if (!region) {
    const textCount = template.textInputs.filter((f) => template.typography[f.key]?.sampleBox).length;
    return (
      <>
        <div className="anat-section">
          <div className="anat-section-title">Template</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{template.name}</div>
          <div className="anat-note">{template.audienceIntent}</div>
        </div>
        <div className="anat-section">
          <div className="anat-section-title">Contract</div>
          <dl className="anat-kv">
            <dt>id</dt><dd>{template.id}</dd>
            <dt>format</dt><dd>{template.format} · {template.dimensions.width}×{template.dimensions.height}</dd>
            <dt>text inputs</dt><dd>{template.textInputs.length} ({textCount} measured)</dd>
            <dt>image inputs</dt><dd>{template.imageInputs.length}</dd>
            <dt>editing</dt><dd>{template.deterministicStatus}</dd>
          </dl>
        </div>
        <div className="anat-section">
          <div className="anat-section-title">Where boxes come from</div>
          <p className="anat-note">
            Every region is measured <strong>once, offline</strong>, from the approved sample by{" "}
            <code>adstudio-type-specs.mjs</code> (OCR v2). The boxes are stored in the template
            contract and copied onto each matching-format creative <strong>before it is persisted</strong> —
            no vision model runs when a customer generates or edits.
          </p>
          <p className="anat-note" style={{ marginTop: 8 }}>
            Font size is not guessed either: <code>CSS&nbsp;px = box&nbsp;height&nbsp;px × sizeRatio</code>.
          </p>
        </div>
        <div className="anat-section">
          <div className="anat-note" style={{ color: "var(--anat-ink-faint)" }}>
            Click a region on the canvas to inspect it. In Anatomy mode you can drag a region to
            reposition it.
          </div>
        </div>
      </>
    );
  }

  const spec = region.typeSpec;
  const px = regionPx(region.box, CANVAS_WIDTH, targetHeight);
  const orig = region.sampleBox;
  return (
    <>
      <div className="anat-section">
        <div className="anat-section-title">{region.kind === "text" ? "Text region" : "Image region"}</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{region.label}</div>
        <div className="anat-note" style={{ fontFamily: "var(--anat-mono)", fontSize: 11 }}>{region.key}</div>
      </div>

      <div className="anat-section">
        <div className="anat-section-title">Position ({CANVAS_WIDTH}×{targetHeight} canvas)</div>
        <dl className="anat-kv">
          <dt>normalized</dt><dd>x {fmt(region.box.x)} · y {fmt(region.box.y)}</dd>
          <dt>size</dt><dd>w {fmt(region.box.width)} · h {fmt(region.box.height)}</dd>
          <dt>pixels</dt><dd>{px.left},{px.top} · {px.width}×{px.height}</dd>
          <dt>canvas area</dt><dd>{pctOfCanvas(region.box)}</dd>
        </dl>
        {override && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="anat-note" style={{ color: "var(--anat-accent)" }}>moved by drag</span>
            <button className="anat-btn" onClick={onReset}>reset</button>
          </div>
        )}
      </div>

      {region.kind === "text" && spec && (
        <>
          <div className="anat-section">
            <div className="anat-section-title">Type spec (measured)</div>
            <dl className="anat-kv">
              <dt>font</dt><dd>{spec.family} {spec.weight}{spec.italic ? " italic" : ""}</dd>
              <dt>case</dt><dd>{spec.case}</dd>
              <dt>align</dt><dd>{spec.align}</dd>
              <dt>color</dt><dd>{spec.color}</dd>
              <dt>lineHeight</dt><dd>{fmt(spec.lineHeight, 3)}</dd>
              <dt>lines</dt><dd>{spec.sampleLineCount}</dd>
              <dt>sizeRatio</dt><dd>{fmt(spec.sizeRatio)}</dd>
              <dt>box height</dt><dd>{px.height}px</dd>
              <dt>font-size</dt><dd>{fmt(fontCssSizePx(px.height, spec.sizeRatio), 1)}px <span style={{ color: "var(--anat-ink-faint)" }}>(h × ratio)</span></dd>
            </dl>
          </div>
          <div className="anat-section">
            <div className="anat-section-title">Confidence</div>
            <div className="anat-stat-row">
              <div>
                <div className="anat-big-number">{fmt(spec.fitScore, 2)}<small>font fit</small></div>
              </div>
              <div>
                <div className="anat-big-number">{fmt(spec.detectionScore, 2)}<small>detection</small></div>
              </div>
            </div>
          </div>
          <div className="anat-section">
            <div className="anat-section-title">Format survival (4:5 → 9:16)</div>
            <FormatMap box={orig} />
            <p className="anat-note" style={{ marginTop: 8 }}>
              The same deterministic transform production uses: a Story canvas extends the Feed canvas
              equally above &amp; below, so this box lands in the right place without re-measuring.
            </p>
          </div>
        </>
      )}

      {region.kind === "text" && (
        <div className="anat-section">
          <div className="anat-section-title">Sample copy</div>
          <div className="anat-prompt">{region.sampleText}</div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Edit-path inspector                                                */
/* ------------------------------------------------------------------ */
const SIM_STEPS = ["Select", "Crop", "Redraw", "Paste", "Why it holds"] as const;

function EditInspector({
  template,
  region,
  sim,
  step,
  setStep,
  editValue,
  setEditValue,
  prompt,
}: {
  template: DemoTemplate;
  region: EditorRegion | null;
  sim: { crop: { width: number; height: number; left: number; top: number }; paste: { width: number; height: number; left: number; top: number }; local: { width: number; height: number }; fullPx: number; cropPx: number; pastePx: number } | null;
  step: number;
  setStep: (n: number) => void;
  editValue: string;
  setEditValue: (s: string) => void;
  prompt: string;
}) {
  if (!region || !sim) {
    return <div className="anat-section"><div className="anat-note">No text region available.</div></div>;
  }

  const cropPct = (sim.cropPx / sim.fullPx) * 100;
  const pastePct = (sim.pastePx / sim.fullPx) * 100;
  const savings = sim.fullPx / sim.cropPx;

  return (
    <>
      <div className="anat-section">
        <div className="anat-section-title">Edit path · {region.label}</div>
        <div className="anat-note" style={{ fontFamily: "var(--anat-mono)", fontSize: 11, marginBottom: 10 }}>
          {template.id}
        </div>
        <div className="anat-steps">
          {SIM_STEPS.map((label, i) => (
            <button
              key={label}
              className={i === step ? "active" : i < step ? "done" : ""}
              onClick={() => setStep(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="anat-note" style={{ fontWeight: 600, color: "var(--anat-ink)" }}>{SIM_STEPS[step]}</div>
      </div>

      <div className="anat-section">
        <input
          className="anat-edit-copy"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder={`New ${region.label.toLowerCase()}…`}
        />
        <dl className="anat-kv">
          <dt>box (known)</dt><dd>x {fmt(region.box.x, 3)} · y {fmt(region.box.y, 3)}</dd>
          <dt>crop window</dt><dd>{sim.crop.width}×{sim.crop.height}px · {cropPct.toFixed(1)}% of canvas</dd>
          <dt>paste box</dt><dd>{sim.paste.width}×{sim.paste.height}px · {pastePct.toFixed(1)}% of canvas</dd>
          <dt>model pixels</dt><dd>{savings.toFixed(1)}× fewer than full-image</dd>
        </dl>
      </div>

      <div className="anat-section">
        <div className="anat-section-title">{stepDescription(step)}</div>
        <p className="anat-note">{stepBody(step, region, sim, pastePct)}</p>
        {step >= 2 && (
          <div style={{ marginTop: 10 }}>
            <div className="anat-section-title" style={{ marginBottom: 6 }}>Exact prompt sent</div>
            <div className="anat-prompt">{prompt}</div>
          </div>
        )}
      </div>

      {step === 4 && (
        <div className="anat-section">
          <div className="anat-section-title">Three guarantees</div>
          <ol className="anat-note" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
            <li><strong>Position is never decided by a model.</strong> The box is measured offline and copied onto the creative at generation time.</li>
            <li><strong>The model only ever sees a small crop.</strong> It cannot move anything outside it.</li>
            <li><strong>Only the ±{Math.round(COMPOSITE_PADDING * 100)}% padded box is pasted back.</strong> Every other pixel is copied byte-for-byte from the original.</li>
          </ol>
          <div className="anat-code" style={{ marginTop: 10 }}>
{`crop  padFraction = ${CROP_PAD_FRACTION}
paste COMPOSITE_PADDING = ${COMPOSITE_PADDING}
src   region-edit.ts`}
          </div>
        </div>
      )}
    </>
  );
}

function stepDescription(step: number): string {
  switch (step) {
    case 0: return "0 · The box is already known";
    case 1: return "1 · Crop a padded window";
    case 2: return "2 · Model redraws only the crop";
    case 3: return "3 · Paste back only the padded box";
    default: return "4 · Why the button cannot move";
  }
}

function stepBody(
  step: number,
  region: EditorRegion,
  sim: { cropPx: number; pastePx: number; fullPx: number },
  pastePct: number,
): string {
  switch (step) {
    case 0:
      return `The ${region.label} region's position and size were measured once, offline, from the approved sample and stored in the template contract. When this creative was generated, that exact box was copied onto it. Nothing at edit time has to find it — so nothing can get it wrong.`;
    case 1:
      return `We crop a window around the box, padded by 15% of the box's own size for antialiasing breathing room. That is ${(sim.cropPx / 1000).toFixed(0)}k px — only ${((sim.cropPx / sim.fullPx) * 100).toFixed(1)}% of the full ${(sim.fullPx / 1e6).toFixed(2)}MP canvas. This is the entire image the model will see.`;
    case 2:
      return `The model is instructed to change only this one value, in place, in the same type treatment. It is given the crop, not the ad. Even if it wanted to, it has no pixels outside this window to move.`;
    case 3:
      return `From the model's output we extract only the box grown by the ±2% compositing tolerance (${(sim.pastePx / 1000).toFixed(0)}k px, ${pastePct.toFixed(1)}% of the canvas) and paste it back at the box's original position. Everything outside comes straight from the original — byte-for-byte.`;
    default:
      return `Movement would require a model to (a) see pixels outside the crop and (b) have them survive compositing. The pipeline makes both impossible: the crop is all the model sees, and only the ±2% padded box is ever written back.`;
  }
}
