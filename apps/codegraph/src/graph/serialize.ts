/**
 * @frank/codegraph — PipelineSpec serializer.
 *
 * Converts a ProjectGraph into the PipelineSpec contract that
 * @frank/pipeline-graph already renders. This is the bridge between
 * the code intelligence backend and the existing React Flow frontend.
 *
 * Types are inlined so codegraph stays zero-dependency on Frank packages.
 * The output JSON is shape-compatible with @frank/pipeline-graph's PipelineSpec.
 */

import type { ProjectGraph, RelationKind } from "../types.js";

/* Inlined PipelineSpec types (shape-compatible with @frank/pipeline-graph) */
type PayloadImage = { kind: "image"; src: string; alt?: string };
type PayloadText = { kind: "text"; value: string; code?: boolean };
type PayloadData = { kind: "data"; entries: Array<{ key: string; value: string }> };
type Payload = PayloadImage | PayloadText | PayloadData;
type NodeKind = "image" | "text" | "data" | "process" | "gate" | "output";
type NodeStatus = "ok" | "warn" | "error" | "running" | "idle";
type PipelineNode = {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle?: string;
  status?: NodeStatus;
  payload?: Payload | Payload[];
  fields?: Array<{ key: string; label: string; value: string; maxLength?: number; multiline?: boolean }>;
  actions?: Array<{ key: string; label: string; variant?: "default" | "primary" | "danger"; hint?: string }>;
  meta?: Array<{ key: string; value: string; mono?: boolean }>;
};
type EdgeKind = "data" | "control";
type PipelineEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: EdgeKind;
};
type PipelineSpec = {
  id: string;
  title: string;
  description?: string;
  direction?: "LR" | "TB";
  nodes: PipelineNode[];
  edges: PipelineEdge[];
};

const RELATION_LABEL: Record<RelationKind, string> = {
  imports: "imports",
  calls: "calls",
  extends: "extends",
  implements: "implements",
  uses_type: "uses",
  contains: "contains",
};

/**
 * Convert a whole-project graph into a PipelineSpec.
 * For large projects this produces a file-level view (one node per file).
 * Pass a fileFilter to zoom into a single file's symbols.
 */
export function graphToPipelineSpec(
  graph: ProjectGraph,
  options?: {
    title?: string;
    fileFilter?: string;
    maxNodes?: number;
  },
): PipelineSpec {
  const maxNodes = options?.maxNodes ?? 120;
  const fileFilter = options?.fileFilter;

  if (fileFilter) {
    return symbolLevelSpec(graph, fileFilter);
  }
  if (graph.symbolCount <= maxNodes) {
    return symbolLevelSpec(graph);
  }
  return fileLevelSpec(graph);
}

function fileLevelSpec(graph: ProjectGraph): PipelineSpec {
  const nodes: PipelineNode[] = graph.files.map((file) => ({
    id: `file:${file.path}`,
    kind: "process" as const,
    title: file.path.split("/").pop() ?? file.path,
    subtitle: `${file.symbols.length} symbols · ${file.language} · ${formatBytes(file.sizeBytes)}`,
    status: "idle" as const,
    meta: [
      { key: "path", value: file.path, mono: true },
      { key: "language", value: file.language },
      { key: "symbols", value: String(file.symbols.length) },
      { key: "hash", value: file.hash, mono: true },
    ],
  }));

  const fileIds = new Set(graph.files.map((f) => `file:${f.path}`));
  const edges: PipelineEdge[] = [];
  const seen = new Set<string>();

  for (const rel of graph.relations) {
    if (rel.kind !== "imports") continue;
    const source = `file:${rel.source}`;
    const target = resolveImportToFile(rel.source, rel.target, graph);
    const targetId = target ? `file:${target}` : `ext:${rel.target}`;

    if (!fileIds.has(source)) continue;
    const edgeId = `${source}→${targetId}`;
    if (seen.has(edgeId)) continue;
    seen.add(edgeId);

    edges.push({ id: edgeId, source, target: targetId, label: "imports", kind: "data" });

    if (!fileIds.has(targetId) && targetId.startsWith("ext:") && !nodes.some((n) => n.id === targetId)) {
      nodes.push({
        id: targetId,
        kind: "data" as const,
        title: rel.target,
        subtitle: "external module",
        status: "idle" as const,
      });
    }
  }

  return {
    id: `codegraph.${graph.projectId}`,
    title: graph.projectId,
    description: `${graph.fileCount} files · ${graph.symbolCount} symbols · ${graph.relationCount} relations`,
    direction: "LR",
    nodes,
    edges,
  };
}

function symbolLevelSpec(graph: ProjectGraph, fileFilter?: string): PipelineSpec {
  const symbols = fileFilter
    ? graph.symbols.filter((s) => s.file === fileFilter)
    : graph.symbols;

  const nodes: PipelineNode[] = symbols.map((sym) => ({
    id: sym.id,
    kind: symbolKindToNodeKind(sym.kind),
    title: sym.name,
    subtitle: `${sym.kind} · L${sym.line}-${sym.endLine}${sym.exported ? " · exported" : ""}`,
    status: "idle" as const,
    meta: [
      { key: "file", value: sym.file, mono: true },
      { key: "kind", value: sym.kind },
      ...(sym.summary ? [{ key: "summary", value: sym.summary }] : []),
      ...(sym.parentId ? [{ key: "parent", value: sym.parentId, mono: true }] : []),
    ],
  }));

  const symbolIds = new Set(symbols.map((s) => s.id));
  const edges: PipelineEdge[] = [];
  const seen = new Set<string>();

  for (const rel of graph.relations) {
    if (!symbolIds.has(rel.source) && !symbolIds.has(rel.target)) continue;
    if (rel.kind === "imports") continue;
    const edgeId = `${rel.source}→${rel.target}:${rel.kind}`;
    if (seen.has(edgeId)) continue;
    seen.add(edgeId);
    edges.push({
      id: edgeId,
      source: rel.source,
      target: rel.target,
      label: RELATION_LABEL[rel.kind],
      kind: rel.kind === "calls" ? "control" : "data",
    });
  }

  for (const sym of symbols) {
    if (sym.parentId && symbolIds.has(sym.parentId)) {
      const edgeId = `${sym.parentId}→${sym.id}:contains`;
      if (!seen.has(edgeId)) {
        seen.add(edgeId);
        edges.push({ id: edgeId, source: sym.parentId, target: sym.id, label: "contains", kind: "data" });
      }
    }
  }

  return {
    id: fileFilter ? `codegraph.${graph.projectId}.${fileFilter}` : `codegraph.${graph.projectId}.symbols`,
    title: fileFilter ?? `${graph.projectId} — all symbols`,
    description: `${symbols.length} symbols · ${edges.length} relations`,
    direction: "TB",
    nodes,
    edges,
  };
}

function symbolKindToNodeKind(kind: string): NodeKind {
  switch (kind) {
    case "function": case "method": return "process";
    case "class": return "data";
    case "interface": case "type": return "text";
    case "route": return "gate";
    case "component": return "output";
    default: return "data";
  }
}

function resolveImportToFile(fromFile: string, importPath: string, graph: ProjectGraph): string | null {
  if (importPath.startsWith(".")) {
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    const resolved = normalizePath(`${dir}/${importPath}`);
    for (const ext of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
      const candidate = resolved + ext;
      if (graph.files.some((f) => f.path === candidate)) return candidate;
    }
    if (graph.files.some((f) => f.path === resolved)) return resolved;
  }
  for (const file of graph.files) {
    if (file.path.includes(importPath)) return file.path;
  }
  return null;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
