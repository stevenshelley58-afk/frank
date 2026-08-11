"use client";

/**
 * FRANK Console — Code Graph module.
 *
 * Renders the live code intelligence graph using @frank/pipeline-graph.
 * Fetches PipelineSpec from the API, which reads from the codegraph
 * service's shared volume. Zero impact on Frank's request path.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ConsoleHeader } from "../components/console-header";
import { moduleById } from "../registry";
import { useAuth } from "@/components/providers";

// PipelineGraph uses React Flow which needs the browser — dynamic import
const PipelineGraph = dynamic(
  () => import("@frank/pipeline-graph").then((m) => m.PipelineGraph),
  { ssr: false, loading: () => <div className="pg-loading">Loading graph engine…</div> },
);

type ProjectInfo = {
  id: string;
  hasGraph: boolean;
  hasSpec: boolean;
  generatedAt: string | null;
};

type PipelineSpec = {
  id: string;
  title: string;
  description?: string;
  direction?: "LR" | "TB";
  nodes: Array<{
    id: string;
    kind: string;
    title: string;
    subtitle?: string;
    status?: string;
    meta?: Array<{ key: string; value: string; mono?: boolean }>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    kind?: string;
  }>;
};

type GraphStatus = {
  projectId: string;
  fileCount: number;
  symbolCount: number;
  relationCount: number;
  generatedAt: string | null;
  errorCount: number;
};

export default function GraphConsolePage() {
  const { api } = useAuth();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spec, setSpec] = useState<PipelineSpec | null>(null);
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load project list on mount
  useEffect(() => {
    if (!api) return;
    api('/v1/codegraph/projects')
      .then((r) => r.json())
      .then((data) => {
        const projs = data.projects ?? [];
        setProjects(projs);
        // Auto-select first project with a spec
        const first = projs.find((p: ProjectInfo) => p.hasSpec);
        if (first) setSelected(first.id);
      })
      .catch(() => setError("Cannot reach the codegraph API."));
  }, [api]);

  // Load spec + status when a project is selected
  useEffect(() => {
    if (!api || !selected) return;
    setLoading(true);
    setError(null);
    setSpec(null);
    setStatus(null);

    Promise.all([
      api(`/v1/codegraph/${encodeURIComponent(selected)}/spec`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("No spec")),
      ),
      api(`/v1/codegraph/${encodeURIComponent(selected)}/status`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("No status")),
      ),
    ])
      .then(([specData, statusData]) => {
        setSpec(specData);
        setStatus(statusData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [api, selected]);

  const handleRefresh = useCallback(() => {
    if (!selected) return;
    if (!api) return;
    api(`/v1/codegraph/${encodeURIComponent(selected)}/refresh`, { method: "POST" })
      .then((r) => r.json())
      .then(() => {
        // Re-fetch after a short delay to let the rebuild finish
        setTimeout(() => {
          api(`/v1/codegraph/${encodeURIComponent(selected)}/spec`)
            .then((r) => r.json())
            .then(setSpec)
            .catch(() => {});
          api(`/v1/codegraph/${encodeURIComponent(selected)}/status`)
            .then((r) => r.json())
            .then(setStatus)
            .catch(() => {});
        }, 3000);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Code graph refresh failed.'));
  }, [api, selected]);

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={moduleById('graph')} />

      {/* Project selector + status bar */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <select
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value || null)}
          className="rounded-md border border-line bg-subtle px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
        >
          {projects.length === 0 && <option value="">No projects found</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.hasSpec}>
              {p.id} {p.hasSpec ? "" : "(no graph)"}
            </option>
          ))}
        </select>

        {status && (
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
            <span>{status.fileCount} files</span>
            <span>{status.symbolCount} symbols</span>
            <span>{status.relationCount} relations</span>
            {status.errorCount > 0 && (
              <span className="text-red-500">{status.errorCount} errors</span>
            )}
            {status.generatedAt && (
              <span className="text-muted/60">
                {new Date(status.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        <button
          onClick={handleRefresh}
          disabled={!selected}
          className="ml-auto rounded-md border border-line bg-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-ink2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Graph canvas */}
      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-paper/80">
            <span className="font-mono text-xs text-muted">Building graph…</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-paper/80">
            <div className="text-center">
              <p className="font-mono text-xs text-red-500">{error}</p>
              <p className="mt-1 text-[11px] text-muted">
                Is the codegraph service running? Check{" "}
                <code className="rounded bg-subtle px-1">docker ps | grep codegraph</code>
              </p>
            </div>
          </div>
        )}

        {spec && !loading && !error && (
          <PipelineGraph
            spec={spec as any}
            inspector
            minimap
            className="h-full w-full"
          />
        )}

        {!spec && !loading && !error && (
          <div className="grid h-full place-items-center">
            <p className="font-mono text-xs text-muted">
              Select a project to view its code graph.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
