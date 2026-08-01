import type { PipelineNode, PipelineSpec, Payload } from "./types";
import { lineage } from "./layout";

export type InspectorHandlers = {
  onFieldChange?: (nodeId: string, key: string, value: string) => void;
  onAction?: (nodeId: string, actionKey: string) => void;
  onSelectNode?: (nodeId: string) => void;
};

function PayloadView({ payload }: { payload: Payload }) {
  if (payload.kind === "image") {
    return (
      <div className="pg-inspector__payload">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pg-inspector__img" src={payload.src} alt={payload.alt ?? ""} />
      </div>
    );
  }
  if (payload.kind === "text") {
    return payload.code ? (
      <pre className="pg-inspector__code">{payload.value}</pre>
    ) : (
      <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}>{payload.value}</p>
    );
  }
  return (
    <table className="pg-inspector__table">
      <tbody>
        {payload.entries.map((entry) => (
          <tr key={entry.key}>
            <th>{entry.key}</th>
            <td>{entry.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Right-hand detail panel. Progressive disclosure: the canvas shows the shape;
 * the inspector shows the substance (full payload, provenance, editable fields,
 * runnable actions, and where this node sits in the lineage).
 */
export function Inspector({
  spec,
  node,
  handlers,
}: {
  spec: PipelineSpec;
  node: PipelineNode | null;
  handlers: InspectorHandlers;
}) {
  if (!node) {
    return (
      <aside className="pg-inspector">
        <p className="pg-inspector__empty">
          Select a node to see what flows through it — its inputs, outputs,
          provenance, and anything you can edit or run.
        </p>
      </aside>
    );
  }

  const { upstream, downstream } = lineage(spec, node.id);
  const titleOf = (id: string) => spec.nodes.find((n) => n.id === id)?.title ?? id;
  const payloads = node.payload ? (Array.isArray(node.payload) ? node.payload : [node.payload]) : [];

  return (
    <aside className="pg-inspector">
      <h2>{node.title}</h2>
      {node.subtitle && <p className="pg-inspector__sub">{node.subtitle}</p>}
      <div className="pg-inspector__badges">
        <span className="pg-badge">{node.kind}</span>
        {node.status && <span className="pg-badge">{node.status}</span>}
      </div>

      {(upstream.length > 0 || downstream.length > 0) && (
        <>
          <h3>Lineage</h3>
          <div className="pg-inspector__lineage">
            {upstream.map((id) => (
              <button key={`u-${id}`} onClick={() => handlers.onSelectNode?.(id)}>
                ← {titleOf(id)}
              </button>
            ))}
            {downstream.map((id) => (
              <button key={`d-${id}`} onClick={() => handlers.onSelectNode?.(id)}>
                → {titleOf(id)}
              </button>
            ))}
          </div>
        </>
      )}

      {payloads.length > 0 && (
        <>
          <h3>Payload</h3>
          {payloads.map((payload, i) => (
            <PayloadView key={i} payload={payload} />
          ))}
        </>
      )}

      {node.fields && node.fields.length > 0 && (
        <>
          <h3>Edit</h3>
          {node.fields.map((field) => (
            <div className="pg-inspector__field" key={field.key}>
              <label htmlFor={`pgf-${node.id}-${field.key}`}>
                {field.label}
                {field.maxLength ? ` · max ${field.maxLength}` : ""}
              </label>
              {field.multiline ? (
                <textarea
                  id={`pgf-${node.id}-${field.key}`}
                  rows={3}
                  maxLength={field.maxLength}
                  value={field.value}
                  onChange={(e) => handlers.onFieldChange?.(node.id, field.key, e.target.value)}
                />
              ) : (
                <input
                  id={`pgf-${node.id}-${field.key}`}
                  type="text"
                  maxLength={field.maxLength}
                  value={field.value}
                  onChange={(e) => handlers.onFieldChange?.(node.id, field.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </>
      )}

      {node.actions && node.actions.length > 0 && (
        <div className="pg-inspector__actions">
          {node.actions.map((action) => (
            <button
              key={action.key}
              className={`pg-btn${action.variant === "primary" ? " pg-btn--primary" : action.variant === "danger" ? " pg-btn--danger" : ""}`}
              onClick={() => handlers.onAction?.(node.id, action.key)}
            >
              {action.label}
              {action.hint && <span className="pg-btn__hint">{action.hint}</span>}
            </button>
          ))}
        </div>
      )}

      {node.meta && node.meta.length > 0 && (
        <>
          <h3>Provenance</h3>
          <table className="pg-inspector__table">
            <tbody>
              {node.meta.map((row) => (
                <tr key={row.key}>
                  <th>{row.key}</th>
                  <td className={row.mono ? "mono" : undefined}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </aside>
  );
}
