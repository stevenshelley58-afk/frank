export const GRAPH_SCHEMA = "schema://frank.graph/v1";
export const TRACE_SCHEMA = "schema://frank.tool-app-trace/v1";
export const GRAPH_LENSES = new Set([
  "tool.pipeline",
  "tool.settings",
  "run.trace",
  "system.topology",
  "project.dependencies",
  "release.receipts",
]);

const TRACE_ID = /^[0-9a-f]{32}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,319}$/;
const ENTITY_KINDS = new Set(["project", "tool", "agent", "service"]);

export function validateGraphSnapshot(value) {
  if (!value || typeof value !== "object" || value.schema !== GRAPH_SCHEMA) throw new Error("Unexpected graph response");
  if (!GRAPH_ID.test(String(value.graph_id || ""))) throw new Error("Graph identity is invalid");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.groups)) throw new Error("Graph response is incomplete");
  if (typeof value.lens !== "string" || !GRAPH_LENSES.has(value.lens)) throw new Error("Graph lens is invalid");
  return value;
}

export function validateTraceSnapshot(value, expectedTraceId) {
  if (!value || typeof value !== "object" || value.schema !== TRACE_SCHEMA) throw new Error("Unexpected trace response");
  if (!TRACE_ID.test(expectedTraceId) || (value.trace_id && value.trace_id !== expectedTraceId)) throw new Error("Trace identity is invalid");
  return value;
}

export function graphEndpoint({ kind, entityId, lens = "tool.pipeline", settingsRevisionId = "", traceId = "" }) {
  if (!ENTITY_KINDS.has(kind) || !OPAQUE_ID.test(String(entityId || "")) || !GRAPH_LENSES.has(lens)) throw new Error("Invalid graph request");
  const query = new URLSearchParams({ lens });
  if (settingsRevisionId) {
    if (!OPAQUE_ID.test(settingsRevisionId)) throw new Error("Invalid settings revision selector");
    query.set("settings_revision_id", settingsRevisionId);
  }
  if (traceId) {
    if (!TRACE_ID.test(traceId)) throw new Error("Invalid trace selector");
    query.set("trace_id", traceId);
  }
  return `/api/graphs/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}?${query}`;
}

export async function fetchGraphSnapshot(params, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(graphEndpoint(params), { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Graph is unavailable");
  return validateGraphSnapshot(body);
}
