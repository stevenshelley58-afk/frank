export const GRAPH_SCHEMA = "schema://frank.graph/v1";
export const GRAPH_LENSES = new Set(["tool.pipeline"]);

const SETTINGS_SCHEMA = "schema://frank.tool-app-settings/v1";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const NAMESPACED = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const HTML_OR_SCRIPT = /<\/?[A-Za-z][^>]*>|javascript\s*:/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SECRET = /-----BEGIN [A-Z ]+-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i;
const SCOPES = new Set(["global", "profile", "project", "workspace", "session"]);
const AUTHORITIES = new Set(["manifest", "settings", "hermes", "otel", "provider"]);
const CLASSIFICATIONS = new Set(["unspecified", "public", "internal", "private", "secret"]);
const NODE_STATUSES = new Set(["declared", "queued", "running", "succeeded", "failed", "blocked", "cancelled", "unavailable"]);
const EDGE_STATUSES = new Set(["declared", "active", "succeeded", "failed", "unavailable"]);
const GENERIC_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value;
}

function exact(value, required, label, optional = []) {
  const source = object(value, label);
  const keys = Object.keys(source);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(source, key)) || keys.some((key) => !allowed.has(key))) throw new Error(`${label} has an invalid field set`);
  return source;
}

function safeText(value, label, pattern = null, maxLength = null) {
  if (typeof value !== "string" || !value || (maxLength !== null && value.length > maxLength) || CONTROL.test(value) || HTML_OR_SCRIPT.test(value) || SECRET.test(value)) throw new Error(`${label} is unsafe`);
  if (pattern && !pattern.test(value)) throw new Error(`${label} has an invalid format`);
  return value;
}

function timestamp(value, label) {
  safeText(value, label, null, 96);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
  return value;
}

function safeJson(value, label, active = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && (value.length > 2048 || CONTROL.test(value) || HTML_OR_SCRIPT.test(value) || SECRET.test(value))) throw new Error(`${label} is unsafe`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} is non-finite`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} is not JSON-compatible`);
  if (active.has(value)) throw new Error(`${label} is cyclic`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => safeJson(item, `${label}[${index}]`, active));
    } else {
      for (const [key, item] of Object.entries(value)) {
        if (CONTROL.test(key) || HTML_OR_SCRIPT.test(key)) throw new Error(`${label} has an unsafe field`);
        safeJson(item, `${label}.${key}`, active);
      }
    }
  } finally {
    active.delete(value);
  }
}

function scope(value) {
  const source = object(value, "Graph scope");
  if (!SCOPES.has(source.kind)) throw new Error("Graph scope is invalid");
  if (source.kind === "global") exact(source, ["kind"], "Graph scope");
  else {
    exact(source, ["kind", "id"], "Graph scope");
    safeText(source.id, "Graph scope identity", OPAQUE_ID);
  }
  return source;
}

function sameScope(left, right) {
  return left.kind === right.kind && left.id === right.id;
}

function freshness(value, label) {
  const source = exact(value, ["observed_at"], label, ["expires_at"]);
  timestamp(source.observed_at, `${label}.observed_at`);
  if (Object.hasOwn(source, "expires_at")) timestamp(source.expires_at, `${label}.expires_at`);
}

function source(value, label) {
  const result = exact(value, ["manifest_id", "manifest_version", "pipeline_id", "pipeline_version", "sha256"], label);
  safeText(result.manifest_id, `${label}.manifest_id`, OPAQUE_ID);
  safeText(result.pipeline_id, `${label}.pipeline_id`, OPAQUE_ID);
  safeText(result.manifest_version, `${label}.manifest_version`, SEMVER);
  safeText(result.pipeline_version, `${label}.pipeline_version`, SEMVER);
  safeText(result.sha256, `${label}.sha256`, SHA256);
  return result;
}

function sameSource(left, right) {
  return left.manifest_id === right.manifest_id && left.manifest_version === right.manifest_version && left.pipeline_id === right.pipeline_id && left.pipeline_version === right.pipeline_version && left.sha256 === right.sha256;
}

function uniqueIds(values, label) {
  if (!Array.isArray(values) || values.some((item) => typeof item !== "string" || !OPAQUE_ID.test(item)) || new Set(values).size !== values.length) throw new Error(`${label} is invalid`);
}

function extensions(value, label, allowed) {
  const result = object(value, label);
  const keys = Object.keys(result);
  if (keys.some((key) => !NAMESPACED.test(key) || !allowed.has(key))) throw new Error(`${label} has an unsupported field`);
  safeJson(result, label);
  return result;
}

export function validateGraphSnapshot(value, expected = {}) {
  const graph = exact(value, [
    "schema", "graph_id", "graph_revision", "generated_at", "provider", "subject", "scope",
    "lens", "capabilities", "nodes", "edges", "groups", "trace_ref", "extensions",
  ], "Graph response");
  if (graph.schema !== GRAPH_SCHEMA) throw new Error("Unexpected graph response");
  safeText(graph.graph_id, "Graph identity", GRAPH_ID);
  safeText(graph.graph_revision, "Graph revision", SHA256);
  timestamp(graph.generated_at, "Graph generated_at");

  const provider = exact(graph.provider, ["id", "version", "authority"], "Graph provider");
  safeText(provider.id, "Graph provider identity", OPAQUE_ID);
  safeText(provider.version, "Graph provider version", SEMVER);
  if (!AUTHORITIES.has(provider.authority)) throw new Error("Graph provider authority is invalid");

  const subject = exact(graph.subject, ["kind", "id"], "Graph subject");
  if (subject.kind !== "tool") throw new Error("Graph subject is invalid");
  safeText(subject.id, "Graph subject identity", OPAQUE_ID);
  if ((expected.kind || expected.entityId) && (subject.kind !== expected.kind || subject.id !== expected.entityId)) throw new Error("Graph subject does not match the request");
  const graphScope = scope(graph.scope);
  const subjectId = `${subject.kind}:${subject.id}`;
  const expectedGraphId = graphScope.kind === "global" || (graphScope.kind === subject.kind && graphScope.id === subject.id)
    ? subjectId
    : `${graphScope.kind}:${graphScope.id}/${subjectId}`;
  if (graph.graph_id !== expectedGraphId) throw new Error("Graph identity does not match its subject and scope");
  if (!GRAPH_LENSES.has(graph.lens)) throw new Error("Graph lens is invalid");
  if (expected.lens && graph.lens !== expected.lens) throw new Error("Graph lens does not match the request");
  uniqueIds(graph.capabilities, "Graph capabilities");
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.groups)) throw new Error("Graph response is incomplete");

  const nodeIds = new Set();
  const nodeSources = new Map();
  const nodeSourceIds = new Map();
  const nodeRuntimePipelineIds = new Map();
  for (const [index, rawNode] of graph.nodes.entries()) {
    const label = `Graph node ${index}`;
    const node = exact(rawNode, [
      "id", "source_id", "kind", "label", "scope", "authority", "source", "classification",
      "freshness", "capabilities", "ports", "status", "presentation", "extensions",
    ], label, ["settings_revision_ref"]);
    safeText(node.id, `${label} identity`, GRAPH_ID);
    if (!node.id.startsWith(`${graph.graph_id}/`) || nodeIds.has(node.id)) throw new Error("Graph node identity is invalid or duplicated");
    nodeIds.add(node.id);
    safeText(node.source_id, `${label} source identity`, OPAQUE_ID);
    safeText(node.kind, `${label} kind`, OPAQUE_ID);
    safeText(node.label, `${label} label`);
    const nodeScope = scope(node.scope);
    if (!sameScope(nodeScope, graphScope) || !AUTHORITIES.has(node.authority) || !CLASSIFICATIONS.has(node.classification)) throw new Error("Graph node provenance is invalid");
    freshness(node.freshness, `${label} freshness`);
    const nodeSource = source(node.source, `${label} source`);
    if (subject.kind === "tool" && nodeSource.manifest_id !== subject.id) throw new Error("Graph node source does not match its Tool subject");
    const nodePrefix = `${graph.graph_id}/pipeline:`;
    const nodeSuffix = `/node:${node.source_id}`;
    if (!node.id.startsWith(nodePrefix) || !node.id.endsWith(nodeSuffix)) throw new Error("Graph node identity does not match its source");
    const runtimePipelineId = node.id.slice(nodePrefix.length, -nodeSuffix.length);
    safeText(runtimePipelineId, `${label} runtime pipeline identity`, OPAQUE_ID);
    nodeSources.set(node.id, nodeSource);
    nodeSourceIds.set(node.id, node.source_id);
    nodeRuntimePipelineIds.set(node.id, runtimePipelineId);
    uniqueIds(node.capabilities, `${label} capabilities`);
    if (!Array.isArray(node.ports) || node.ports.length) throw new Error("Graph node ports are invalid");
    if (!NODE_STATUSES.has(node.status)) throw new Error("Graph node status is invalid");
    const presentation = exact(node.presentation, [], `${label} presentation`, ["group_id", "icon", "tone"]);
    for (const [key, item] of Object.entries(presentation)) safeText(item, `${label} presentation.${key}`, OPAQUE_ID);
    const nodeExtensions = extensions(node.extensions, `${label} extensions`, new Set(["frank.graph.entry"]));
    if (Object.hasOwn(nodeExtensions, "frank.graph.entry") && typeof nodeExtensions["frank.graph.entry"] !== "boolean") throw new Error("Graph node entry extension is invalid");
    if (Object.hasOwn(node, "settings_revision_ref")) {
      const revision = exact(node.settings_revision_ref, ["schema", "scope", "revision"], `${label} settings revision`);
      const revisionScope = scope(revision.scope);
      if (revision.schema !== SETTINGS_SCHEMA || !sameScope(revisionScope, graphScope) || !Number.isSafeInteger(revision.revision) || revision.revision < 0) throw new Error("Graph settings revision is invalid");
    }
  }

  const edgeIds = new Set();
  const edgeSourceIds = new Set();
  for (const [index, rawEdge] of graph.edges.entries()) {
    const label = `Graph edge ${index}`;
    const edge = exact(rawEdge, ["id", "source_id", "from", "to", "kind", "authority", "classification", "source", "freshness", "status", "presentation", "extensions"], label);
    safeText(edge.id, `${label} identity`, GRAPH_ID);
    if (!edge.id.startsWith(`${graph.graph_id}/`) || edgeIds.has(edge.id)) throw new Error("Graph edge identity is invalid or duplicated");
    edgeIds.add(edge.id);
    if (!Number.isSafeInteger(edge.source_id) || edge.source_id < 0 || edge.kind !== "control") throw new Error("Graph edge declaration is invalid");
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("Graph edge references an unknown node");
    if (!AUTHORITIES.has(edge.authority) || !CLASSIFICATIONS.has(edge.classification) || !EDGE_STATUSES.has(edge.status)) throw new Error("Graph edge provenance is invalid");
    freshness(edge.freshness, `${label} freshness`);
    const edgeSource = source(edge.source, `${label} source`);
    if (!sameSource(edgeSource, nodeSources.get(edge.from)) || !sameSource(edgeSource, nodeSources.get(edge.to))) throw new Error("Graph edge source does not match its endpoints");
    const fromRuntimePipelineId = nodeRuntimePipelineIds.get(edge.from);
    const toRuntimePipelineId = nodeRuntimePipelineIds.get(edge.to);
    if (fromRuntimePipelineId !== toRuntimePipelineId) throw new Error("Graph edge crosses runtime pipeline instances");
    const sourceKey = `${fromRuntimePipelineId}\u0000${edge.source_id}`;
    if (edgeSourceIds.has(sourceKey)) throw new Error("Graph edge source identity is duplicated");
    edgeSourceIds.add(sourceKey);
    const canonicalId = `${graph.graph_id}/pipeline:${fromRuntimePipelineId}/edge:${edge.source_id}:${nodeSourceIds.get(edge.from)}:${nodeSourceIds.get(edge.to)}`;
    if (edge.id !== canonicalId) throw new Error("Graph edge identity does not match its source");
    const presentation = exact(edge.presentation, [], `${label} presentation`, ["tone", "dashed"]);
    if (Object.hasOwn(presentation, "tone")) safeText(presentation.tone, `${label} presentation.tone`, OPAQUE_ID);
    if (Object.hasOwn(presentation, "dashed") && typeof presentation.dashed !== "boolean") throw new Error("Graph edge presentation is invalid");
    extensions(edge.extensions, `${label} extensions`, new Set());
  }

  const groupIds = new Set();
  for (const [index, rawGroup] of graph.groups.entries()) {
    const label = `Graph group ${index}`;
    const group = exact(rawGroup, ["id", "label"], label, ["parent_id", "order"]);
    safeText(group.id, `${label} identity`, OPAQUE_ID);
    safeText(group.label, `${label} label`);
    if (groupIds.has(group.id)) throw new Error("Graph group identity is duplicated");
    groupIds.add(group.id);
    if (Object.hasOwn(group, "parent_id")) safeText(group.parent_id, `${label} parent identity`, OPAQUE_ID);
    if (Object.hasOwn(group, "order") && (!Number.isSafeInteger(group.order) || group.order < 0)) throw new Error("Graph group order is invalid");
  }
  for (const group of graph.groups) if (Object.hasOwn(group, "parent_id") && !groupIds.has(group.parent_id)) throw new Error("Graph group parent is unknown");
  const groupParents = new Map(graph.groups.map((group) => [group.id, group.parent_id]));
  const visitingGroups = new Set();
  const visitedGroups = new Set();
  const visitGroup = (groupId) => {
    if (visitingGroups.has(groupId)) throw new Error("Graph groups must be acyclic");
    if (visitedGroups.has(groupId)) return;
    visitingGroups.add(groupId);
    const parentId = groupParents.get(groupId);
    if (parentId) visitGroup(parentId);
    visitingGroups.delete(groupId);
    visitedGroups.add(groupId);
  };
  for (const groupId of groupIds) visitGroup(groupId);
  for (const node of graph.nodes) {
    const groupId = node.presentation.group_id;
    if (Object.hasOwn(node.presentation, "group_id") && !groupIds.has(groupId)) throw new Error("Graph node group is unknown");
  }
  if (graph.trace_ref !== null) throw new Error("Current Tool graph response cannot advertise an uncorrelated trace");

  const graphExtensions = extensions(graph.extensions, "Graph extensions", new Set(["frank.graph.selection"]));
  if (Object.hasOwn(graphExtensions, "frank.graph.selection")) {
    const selection = exact(graphExtensions["frank.graph.selection"], [], "Graph selection", ["node_id", "edge_id"]);
    if (!Object.keys(selection).length) throw new Error("Graph selection is invalid");
    if (Object.hasOwn(selection, "node_id")) {
      safeText(selection.node_id, "Graph selection node identity", GRAPH_ID);
      if (!nodeIds.has(selection.node_id)) throw new Error("Graph selection is invalid");
    }
    if (Object.hasOwn(selection, "edge_id")) {
      safeText(selection.edge_id, "Graph selection edge identity", GRAPH_ID);
      if (!edgeIds.has(selection.edge_id)) throw new Error("Graph selection is invalid");
    }
  }
  return graph;
}

export function graphEndpoint(params) {
  const allowed = new Set(["kind", "entityId", "lens"]);
  if (!params || typeof params !== "object" || Object.keys(params).some((key) => !allowed.has(key))) throw new Error("Unsupported graph selector");
  const { kind, entityId, lens = "tool.pipeline" } = params;
  if (kind !== "tool" || !OPAQUE_ID.test(String(entityId || "")) || lens !== "tool.pipeline") throw new Error("Invalid graph request");
  const query = new URLSearchParams({ lens });
  return `/api/graphs/tool/${encodeURIComponent(entityId)}?${query}`;
}

export async function fetchGraphSnapshot(params, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(graphEndpoint(params), { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Graph is unavailable");
  return validateGraphSnapshot(body, params);
}
