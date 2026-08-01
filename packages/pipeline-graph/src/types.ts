/**
 * @frank/pipeline-graph — data contract.
 *
 * The entire component renders from one declarative PipelineSpec. Any system
 * that can describe itself as "things producing things" (Blockwise AdStudio
 * template trace today; research pipeline, DraftCheck, any frank module
 * tomorrow) feeds the same contract and gets the same interactive graph.
 *
 * Design rules:
 *  - Pure data. No React, no fetch, no DOM types in this file.
 *  - IDs are opaque lowercase dot-separated identifiers (frank convention).
 *  - Every field the UI renders is declared here; the renderers never guess.
 */

/** A normalized rectangle in 0..1 coordinates (region boxes, hit areas). */
export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/* ---------------------------------------------------------------- *
 * Payloads — the stuff that flows along edges.                     *
 * ---------------------------------------------------------------- */

export type PayloadImage = {
  kind: "image";
  src: string;
  alt?: string;
  /** Optional normalized region boxes drawn over the thumbnail. */
  overlayBoxes?: Array<Box & { label?: string }>;
};

export type PayloadText = {
  kind: "text";
  value: string;
  /** Render as a code/prompt block instead of prose. */
  code?: boolean;
};

export type PayloadData = {
  kind: "data";
  entries: Array<{ key: string; value: string }>;
};

export type Payload = PayloadImage | PayloadText | PayloadData;

/* ---------------------------------------------------------------- *
 * Nodes                                                            *
 * ---------------------------------------------------------------- */

/**
 * How a node participates in the pipeline. Drives the card's shape:
 *  - image   : a visual asset (sample ad, property photo, finished render)
 *  - text    : an editable copy value (headline, price line)
 *  - data    : a structured record (template definition, resolved copy map)
 *  - process : a transformation (clone prompt build, image generation)
 *  - gate    : a verification/check (hash check, QA gate, verify script)
 *  - output  : a finished deliverable (the canonical flat ad image)
 */
export type NodeKind = "image" | "text" | "data" | "process" | "gate" | "output";

export type NodeStatus = "ok" | "warn" | "error" | "running" | "idle";

/** A field the operator may edit in the inspector (e.g. ad copy). */
export type EditableField = {
  key: string;
  label: string;
  value: string;
  maxLength?: number;
  multiline?: boolean;
};

/** A command the operator may run from the inspector (e.g. regenerate). */
export type NodeAction = {
  key: string;
  label: string;
  variant?: "default" | "primary" | "danger";
  /** Short caption of what the action touches, shown under the button. */
  hint?: string;
};

export type PipelineNode = {
  id: string;
  kind: NodeKind;
  title: string;
  /** One-line description under the title. */
  subtitle?: string;
  status?: NodeStatus;
  /** What the node carries. Array renders stacked; single renders inline. */
  payload?: Payload | Payload[];
  fields?: EditableField[];
  actions?: NodeAction[];
  /** Read-only provenance rows (hashes, file paths, model names). */
  meta?: Array<{ key: string; value: string; mono?: boolean }>;
};

/* ---------------------------------------------------------------- *
 * Edges                                                            *
 * ---------------------------------------------------------------- */

export type EdgeKind = "data" | "control";

export type PipelineEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** data = content flows; control = triggers/orders (rendered dashed). */
  kind?: EdgeKind;
};

/* ---------------------------------------------------------------- *
 * Spec — the whole picture                                         *
 * ---------------------------------------------------------------- */

export type LayoutDirection = "LR" | "TB";

export type PipelineSpec = {
  /** Opaque identifier, e.g. "adstudio.template-trace.leads-magnet". */
  id: string;
  title: string;
  description?: string;
  /** Layout flow. Defaults to "LR" (left to right). */
  direction?: LayoutDirection;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
};

export type SpecError = {
  /** The offending location, e.g. "nodes[3].id" or "edges[0].source". */
  at: string;
  message: string;
};
