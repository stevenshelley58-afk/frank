import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { NodeKind, NodeStatus, Payload } from "./types";

/** Data handed to every custom node card by the canvas. */
export type NodeData = {
  node: {
    id: string;
    kind: NodeKind;
    title: string;
    subtitle?: string;
    status?: NodeStatus;
    payload?: Payload | Payload[];
    hasFields?: boolean;
  };
  kindColor: string;
  [key: string]: unknown;
};

export const STATUS_COLOR: Record<NodeStatus, string> = {
  ok: "var(--pg-status-ok)",
  warn: "var(--pg-status-warn)",
  error: "var(--pg-status-error)",
  running: "var(--pg-status-running)",
  idle: "var(--pg-status-idle)",
};

function statusVar(status?: NodeStatus): string | undefined {
  return status ? STATUS_COLOR[status] : undefined;
}

function firstImage(payload?: Payload | Payload[]) {
  const list = payload ? (Array.isArray(payload) ? payload : [payload]) : [];
  return list.find((p): p is Extract<Payload, { kind: "image" }> => p.kind === "image");
}

function PayloadBody({ node }: { node: NodeData["node"] }) {
  const list = node.payload ? (Array.isArray(node.payload) ? node.payload : [node.payload]) : [];

  // Prefer a real thumbnail when present.
  const image = firstImage(node.payload);
  if (image) {
    return (
      <div className="pg-node__thumbwrap">
        <img className="pg-node__img" src={image.src} alt={image.alt ?? node.title} loading="lazy" />
        {image.overlayBoxes?.map((box, i) => (
          <span
            key={i}
            className="pg-node__overlaybox"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
          />
        ))}
      </div>
    );
  }

  const text = list.find((p): p is Extract<Payload, { kind: "text" }> => p.kind === "text");
  if (text) {
    return (
      <p className={`pg-node__text${text.code ? " pg-node__text--code" : ""}`}>
        {text.value}
      </p>
    );
  }

  const data = list.find((p): p is Extract<Payload, { kind: "data" }> => p.kind === "data");
  if (data) {
    return (
      <dl className="pg-node__kv">
        {data.entries.slice(0, 4).map((entry) => (
          <div className="pg-node__kvrow" key={entry.key}>
            <dt>{entry.key}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return null;
}

/**
 * One card on the canvas. Same chrome for every kind — the colored tab and
 * status dot carry meaning; the body shows whatever the node carries. Handles
 * are invisible connection points (left = input, right = output) used only by
 * ELK's routed edges.
 */
function PipelineNodeCard({ data, selected }: NodeProps) {
  const node = (data as unknown as NodeData).node;
  const kindColor = (data as unknown as NodeData).kindColor;

  return (
    <div className={`pg-node${selected ? " pg-node--selected" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="pg-node__head">
        <span className="pg-node__kind" style={{ background: kindColor }} />
        <span className="pg-node__title">{node.title}</span>
        {node.status && (
          <span
            className={`pg-node__status${node.status === "running" ? " pg-node__status--running" : ""}`}
            style={{ background: statusVar(node.status) }}
          />
        )}
      </div>
      {node.subtitle && <div className="pg-node__subtitle">{node.subtitle}</div>}
      <div className="pg-node__body">
        <PayloadBody node={node} />
        {node.hasFields && (
          <span className="pg-node__fieldhint">✎ editable — open inspector</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const nodeTypes = { pipeline: memo(PipelineNodeCard) };
