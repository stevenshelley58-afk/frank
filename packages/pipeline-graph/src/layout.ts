import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs";

import type { NodeKind, PipelineSpec } from "./types";

/**
 * Deterministic node footprint per kind. ELK uses these to route edges and
 * separate layers; the renderers size their cards to the same numbers so the
 * graph never reflows after layout.
 */
export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  image: { width: 236, height: 216 },
  text: { width: 236, height: 140 },
  data: { width: 236, height: 156 },
  process: { width: 236, height: 118 },
  gate: { width: 236, height: 118 },
  output: { width: 236, height: 232 },
};

export type LayoutedNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutResult = {
  nodes: LayoutedNode[];
  width: number;
  height: number;
};

const elk = new ELK();

/**
 * Run the ELK layered layout over a spec. Pure (no DOM), async only because
 * ELK's bundled engine is promise-based. Left-to-right by default: sources on
 * the left, outputs on the right — the reading direction of a pipeline.
 */
export async function layoutSpec(spec: PipelineSpec): Promise<LayoutResult> {
  const direction = spec.direction === "TB" ? "DOWN" : "RIGHT";

  const children: ElkNode[] = spec.nodes.map((node) => {
    const size = NODE_SIZE[node.kind];
    return { id: node.id, width: size.width, height: size.height };
  });

  const edges: ElkExtendedEdge[] = spec.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  const graph: ElkNode = {
    id: spec.id,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.spacing.nodeNode": "44",
      "elk.spacing.edgeNode": "28",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children,
    edges,
  };

  const laid = await elk.layout(graph);

  const nodes: LayoutedNode[] = (laid.children ?? []).map((child) => ({
    id: child.id ?? "",
    x: child.x ?? 0,
    y: child.y ?? 0,
    width: child.width ?? NODE_SIZE.data.width,
    height: child.height ?? NODE_SIZE.data.height,
  }));

  return {
    nodes,
    width: laid.width ?? 0,
    height: laid.height ?? 0,
  };
}

/** Provenance helper: for one node, which nodes feed it and which it feeds. */
export function lineage(spec: PipelineSpec, nodeId: string): {
  upstream: string[];
  downstream: string[];
} {
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  for (const edge of spec.edges) {
    if (edge.target === nodeId) upstream.add(edge.source);
    if (edge.source === nodeId) downstream.add(edge.target);
  }
  return { upstream: [...upstream], downstream: [...downstream] };
}
