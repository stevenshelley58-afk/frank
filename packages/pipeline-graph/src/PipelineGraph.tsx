import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Inspector, type InspectorHandlers } from "./Inspector";
import { NODE_SIZE, layoutSpec, type LayoutResult } from "./layout";
import { nodeTypes } from "./nodes";
import "./pipeline-graph.css";
import { validateSpec } from "./validate";
import type { NodeKind, PipelineSpec } from "./types";

const KIND_COLOR: Record<NodeKind, string> = {
  image: "var(--pg-kind-image)",
  text: "var(--pg-kind-text)",
  data: "var(--pg-kind-data)",
  process: "var(--pg-kind-process)",
  gate: "var(--pg-kind-gate)",
  output: "var(--pg-kind-output)",
};

export type PipelineGraphProps = {
  spec: PipelineSpec;
  /** Fired when an editable field changes (host decides persistence). */
  onFieldChange?: InspectorHandlers["onFieldChange"];
  /** Fired when a node action button is clicked (host decides execution). */
  onAction?: InspectorHandlers["onAction"];
  /** Fired whenever selection moves to a different node. */
  onSelectNode?: InspectorHandlers["onSelectNode"];
  /** Initially-selected node id. */
  initialNodeId?: string;
  /** Show the right inspector panel. Default true. */
  inspector?: boolean;
  /** Show the minimap. Default true. */
  minimap?: boolean;
  /** Extra class on the root for host scoping. */
  className?: string;
  style?: CSSProperties;
};

/**
 * The whole component: a React Flow canvas auto-arranged by ELK plus a
 * progressive-disclosure inspector. Feed it a PipelineSpec; it renders the
 * pipeline, lets you select any node, and reports edits/actions back up.
 *
 * Deliberately stateless about the pipeline itself — it renders `spec` and
 * mirrors back the *intent* to change it. The host owns the data.
 */
export function PipelineGraph({
  spec,
  onFieldChange,
  onAction,
  onSelectNode,
  initialNodeId,
  inspector = true,
  minimap = true,
  className,
  style,
}: PipelineGraphProps) {
  const [laid, setLaid] = useState<LayoutResult | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialNodeId ?? null);
  const layoutRun = useRef(0);

  // Fail fast on a malformed spec instead of rendering half a graph.
  const specErrors = useMemo(() => validateSpec(spec), [spec]);

  useEffect(() => {
    if (specErrors.length > 0) {
      setLaid(null);
      return;
    }
    const run = ++layoutRun.current;
    setLayoutError(null);
    layoutSpec(spec)
      .then((result) => {
        if (layoutRun.current === run) setLaid(result);
      })
      .catch((err: unknown) => {
        if (layoutRun.current === run) {
          setLayoutError(err instanceof Error ? err.message : "Layout failed");
        }
      });
  }, [spec, specErrors.length]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    if (!laid) return [];
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    return spec.nodes.map((node) => {
      const pos = byId.get(node.id);
      const size = NODE_SIZE[node.kind];
      return {
        id: node.id,
        type: "pipeline",
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        style: { width: size.width, height: size.height },
        draggable: false,
        selectable: true,
        data: {
          node: {
            id: node.id,
            kind: node.kind,
            title: node.title,
            subtitle: node.subtitle,
            status: node.status,
            payload: node.payload,
            hasFields: Boolean(node.fields && node.fields.length > 0),
          },
          kindColor: KIND_COLOR[node.kind],
        },
      } as unknown as FlowNode;
    });
  }, [spec, laid]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
    return spec.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "smoothstep",
      className: edge.kind === "control" ? "control" : undefined,
      labelStyle: { fontSize: 10 },
    }));
  }, [spec]);

  const selectedNode = useMemo(
    () => spec.nodes.find((n) => n.id === selectedId) ?? null,
    [spec, selectedId],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      setSelectedId(node.id);
      onSelectNode?.(node.id);
    },
    [onSelectNode],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleInspectorSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      onSelectNode?.(id);
    },
    [onSelectNode],
  );

  if (specErrors.length > 0) {
    return (
      <div className={`pg-root ${className ?? ""}`} style={style}>
        <div className="pg-shell">
          <div className="pg-canvas">
            <div className="pg-placeholder">
              Invalid pipeline spec: {specErrors.map((e) => `${e.at}: ${e.message}`).join(" · ")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`pg-root ${className ?? ""}`} style={style}>
      <div className="pg-shell">
        <div className="pg-canvas">
          {!laid && !layoutError && <div className="pg-placeholder">Arranging pipeline…</div>}
          {layoutError && <div className="pg-placeholder">Layout failed: {layoutError}</div>}
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
            <Controls showInteractive={false} />
            {minimap && <MiniMap pannable zoomable />}
          </ReactFlow>
        </div>
        {inspector && (
          <Inspector
            spec={spec}
            node={selectedNode}
            handlers={{
              onFieldChange,
              onAction,
              onSelectNode: handleInspectorSelect,
            }}
          />
        )}
      </div>
    </div>
  );
}
