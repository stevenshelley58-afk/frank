/**
 * @frank/pipeline-graph — public entry.
 *
 * A modular pipeline visualiser: any system that describes itself as a
 * PipelineSpec gets the same interactive graph. First instance lives in
 * src/demo (Blockwise AdStudio template trace).
 */
export { PipelineGraph, type PipelineGraphProps } from "./PipelineGraph";
export { validateSpec } from "./validate";
export { layoutSpec, lineage, NODE_SIZE, type LayoutResult, type LayoutedNode } from "./layout";
export type {
  Box,
  Payload,
  PayloadImage,
  PayloadText,
  PayloadData,
  NodeKind,
  NodeStatus,
  EditableField,
  NodeAction,
  PipelineNode,
  EdgeKind,
  PipelineEdge,
  LayoutDirection,
  PipelineSpec,
  SpecError,
} from "./types";
