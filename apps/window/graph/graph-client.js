export const GRAPH_SCHEMA = "schema://frank.graph/v1";
export const COMBINED_GRAPH_SCHEMA = "schema://frank.graph/v2";
export const COMBINED_GRAPH_LENS = "knowledge.combined";
export const GRAPH_LENSES = new Set(["tool.pipeline"]);
export const COMBINED_GRAPH_LENSES = new Set([COMBINED_GRAPH_LENS]);

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
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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

// v2 deliberately has its own validator.  The Tool pipeline contract above is
// kept byte-for-byte compatible so a knowledge provider cannot accidentally
// broaden what the v1 adapter accepts.
function boundedJson(value, label, active = new Set(), state = { depth: 0, entries: 0, chars: 0 }) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 2048 || CONTROL.test(value) || HTML_OR_SCRIPT.test(value) || SECRET.test(value)) throw new Error(`${label} is unsafe`);
    state.chars += value.length;
    if (state.chars > 32768) throw new Error(`${label} is too large`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} is non-finite`);
    return;
  }
  if (typeof value !== "object" || active.has(value)) throw new Error(`${label} is invalid`);
  if (state.depth >= 8) throw new Error(`${label} is too deep`);
  active.add(value);
  state.depth += 1;
  try {
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
    let count = 0;
    for (const item of entries) {
      if (++count > 128 || ++state.entries > 4096) throw new Error(`${label} is too large`);
      const key = Array.isArray(value) ? String(item[0]) : item[0];
      if (!Array.isArray(value) && (CONTROL.test(key) || HTML_OR_SCRIPT.test(key) || key.length > 128)) throw new Error(`${label} has an unsafe field`);
      boundedJson(item[1], `${label}.${key}`, active, state);
    }
  } finally {
    state.depth -= 1;
    active.delete(value);
  }
}

function boundedMetadata(value, label) {
  if (value === null) return;
  if (!value || typeof value !== "object") throw new Error(`${label} must be JSON metadata`);
  const active = new Set();
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (active.has(item)) throw new Error(`${label} is cyclic`);
    active.add(item);
    try {
      if (!Array.isArray(item)) {
        for (const [key, child] of Object.entries(item)) {
          if (/(?:token|secret|password|private|credential|authorization|prompt|payload|raw[_-]?body|gen[_-]?ai)/i.test(key)) throw new Error(`${label}.${key} is sensitive`);
          visit(child);
        }
      } else item.forEach(visit);
    } finally { active.delete(item); }
  };
  visit(value);
  boundedJson(value, label);
}

function genericSource(value, label) {
  const result = exact(value, ["provider_id", "provider_version", "source_type", "source_ref", "sha256"], label);
  safeText(result.provider_id, `${label}.provider_id`, OPAQUE_ID, 160);
  safeText(result.provider_version, `${label}.provider_version`, SAFE_REFERENCE, 160);
  safeText(result.source_type, `${label}.source_type`, OPAQUE_ID, 160);
  safeText(result.source_ref, `${label}.source_ref`, SAFE_REFERENCE, 640);
  safeText(result.sha256, `${label}.sha256`, SHA256);
  return result;
}

function genericPresentation(value, label) {
  const result = exact(value, [], label, ["group_id", "icon", "tone"]);
  for (const [key, item] of Object.entries(result)) safeText(item, `${label}.${key}`, key === "group_id" ? GRAPH_ID : OPAQUE_ID, key === "group_id" ? 320 : 128);
  return result;
}

function genericRef(value, label, known, prefix) {
  safeText(value, label, GRAPH_ID, 320);
  if (!value.startsWith(prefix) || !known.has(value)) throw new Error(`${label} is unknown`);
  return value;
}

export function validateCombinedGraphSnapshot(value, expected = {}) {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string" || new TextEncoder().encode(encoded).length > 8 * 1024 * 1024) throw new Error("Combined graph body is too large");
  } catch (error) {
    throw new Error(`Combined graph body is invalid: ${error.message}`);
  }
  const graph = exact(value, [
    "schema", "graph_id", "graph_revision", "generated_at", "provider", "subject", "scope",
    "lens", "capabilities", "nodes", "edges", "groups", "trace_ref", "extensions",
  ], "Combined graph response");
  if (graph.schema !== COMBINED_GRAPH_SCHEMA) throw new Error("Unexpected combined graph response");
  safeText(graph.graph_id, "Combined graph identity", GRAPH_ID, 320);
  safeText(graph.graph_revision, "Combined graph revision", SHA256);
  timestamp(graph.generated_at, "Combined graph generated_at");
  const provider = exact(graph.provider, ["id", "version", "authority"], "Combined graph provider");
  safeText(provider.id, "Combined graph provider identity", OPAQUE_ID, 128);
  safeText(provider.version, "Combined graph provider version", SEMVER);
  if (!AUTHORITIES.has(provider.authority)) throw new Error("Combined graph provider authority is invalid");
  const subject = exact(graph.subject, ["kind", "id"], "Combined graph subject");
  if (subject.kind !== "project") throw new Error("Combined graph subject is invalid");
  safeText(subject.id, "Combined graph subject identity", PROJECT_ID);
  if ((expected.kind || expected.entityId) && (expected.kind !== "project" || subject.id !== expected.entityId)) throw new Error("Combined graph subject does not match the request");
  const graphScope = exact(graph.scope, ["kind", "id"], "Combined graph scope");
  if (graphScope.kind !== "project" || graphScope.id !== subject.id) throw new Error("Combined graph scope is invalid");
  safeText(graphScope.id, "Combined graph scope identity", PROJECT_ID);
  if (!(graph.graph_id === `project:${subject.id}` || graph.graph_id.startsWith(`project:${subject.id}/`))) throw new Error("Combined graph identity does not match its project subject");
  if (graph.lens !== COMBINED_GRAPH_LENS || (expected.lens && expected.lens !== graph.lens)) throw new Error("Combined graph lens is invalid");
  if (!Array.isArray(graph.capabilities) || graph.capabilities.length > 128) throw new Error("Combined graph capabilities are invalid");
  uniqueIds(graph.capabilities, "Combined graph capabilities");
  for (const capability of graph.capabilities) safeText(capability, "Combined graph capability", OPAQUE_ID, 160);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.groups)) throw new Error("Combined graph response is incomplete");
  if (graph.nodes.length > 5000 || graph.edges.length > 10000 || graph.groups.length > 5000) throw new Error("Combined graph exceeds its size bound");

  const nodeIds = new Set();
  for (const [index, rawNode] of graph.nodes.entries()) {
    const label = `Combined graph node ${index}`;
    const node = exact(rawNode, [
      "id", "source_id", "kind", "label", "scope", "authority", "source", "classification",
      "freshness", "capabilities", "ports", "status", "presentation", "extensions",
    ], label, ["metadata"]);
    safeText(node.source_id, `${label} source identity`, OPAQUE_ID, 160);
    safeText(node.id, `${label} identity`, GRAPH_ID, 320);
    if (!node.id.startsWith(`${graph.graph_id}/`) || nodeIds.has(node.id)) throw new Error("Combined graph node identity is invalid or duplicated");
    nodeIds.add(node.id);
    safeText(node.kind, `${label} kind`, OPAQUE_ID, 160);
    safeText(node.label, `${label} label`, null, 1024);
    const nodeScope = scope(node.scope);
    if (!sameScope(nodeScope, graphScope) || !AUTHORITIES.has(node.authority) || !CLASSIFICATIONS.has(node.classification)) throw new Error("Combined graph node provenance is invalid");
    freshness(node.freshness, `${label} freshness`);
    genericSource(node.source, `${label} source`);
    if (!Array.isArray(node.capabilities) || node.capabilities.length > 128) throw new Error(`${label} capabilities are invalid`);
    uniqueIds(node.capabilities, `${label} capabilities`);
    for (const capability of node.capabilities) safeText(capability, `${label} capability`, OPAQUE_ID, 160);
    if (!Array.isArray(node.ports) || node.ports.length) throw new Error("Combined graph node ports are invalid");
    if (!NODE_STATUSES.has(node.status)) throw new Error("Combined graph node status is invalid");
    genericPresentation(node.presentation, `${label} presentation`);
    if (Object.keys(node.extensions).length) throw new Error(`${label} extensions are not supported`);
    if (Object.hasOwn(node, "metadata")) boundedMetadata(node.metadata, `${label} metadata`);
  }

  const edgeIds = new Set();
  for (const [index, rawEdge] of graph.edges.entries()) {
    const label = `Combined graph edge ${index}`;
    const edge = exact(rawEdge, ["id", "source_id", "from", "to", "kind", "authority", "classification", "source", "freshness", "status", "presentation", "extensions"], label, ["metadata"]);
    if (!(typeof edge.source_id === "string" || (Number.isSafeInteger(edge.source_id) && edge.source_id >= 0))) throw new Error(`${label} source identity is invalid`);
    if (typeof edge.source_id === "string") safeText(edge.source_id, `${label} source identity`, OPAQUE_ID, 160);
    safeText(edge.id, `${label} identity`, GRAPH_ID, 320);
    if (!edge.id.startsWith(`${graph.graph_id}/`) || edgeIds.has(edge.id)) throw new Error("Combined graph edge identity is invalid or duplicated");
    edgeIds.add(edge.id);
    if (!(typeof edge.kind === "string" && new Set(["relation", "association", "dependency", "reference", "control"]).has(edge.kind)) || !AUTHORITIES.has(edge.authority) || !CLASSIFICATIONS.has(edge.classification) || !EDGE_STATUSES.has(edge.status)) throw new Error("Combined graph edge declaration is invalid");
    genericRef(edge.from, `${label}.from`, nodeIds, `${graph.graph_id}/`);
    genericRef(edge.to, `${label}.to`, nodeIds, `${graph.graph_id}/`);
    genericSource(edge.source, `${label} source`);
    freshness(edge.freshness, `${label} freshness`);
    const presentation = exact(edge.presentation, [], `${label} presentation`, ["tone", "dashed"]);
    if (Object.hasOwn(presentation, "tone")) safeText(presentation.tone, `${label}.presentation.tone`, GENERIC_TOKEN, 128);
    if (Object.hasOwn(presentation, "dashed") && typeof presentation.dashed !== "boolean") throw new Error("Combined graph edge presentation is invalid");
    if (Object.keys(edge.extensions).length) throw new Error(`${label} extensions are not supported`);
    if (Object.hasOwn(edge, "metadata")) boundedMetadata(edge.metadata, `${label} metadata`);
  }

  const groupIds = new Set();
  for (const [index, rawGroup] of graph.groups.entries()) {
    const label = `Combined graph group ${index}`;
    const group = exact(rawGroup, ["id", "label", "parent_id", "order"], label, ["metadata"]);
    safeText(group.id, `${label} identity`, GRAPH_ID, 320);
    if (!group.id.startsWith(`${graph.graph_id}/`) || groupIds.has(group.id)) throw new Error("Combined graph group identity is invalid or duplicated");
    safeText(group.label, `${label} label`, null, 1024);
    groupIds.add(group.id);
    if (group.parent_id !== null) safeText(group.parent_id, `${label}.parent identity`, GRAPH_ID, 320);
    if (!Number.isSafeInteger(group.order) || group.order < 0) throw new Error("Combined graph group order is invalid");
    if (Object.hasOwn(group, "metadata")) boundedMetadata(group.metadata, `${label} metadata`);
  }
  for (const group of graph.groups) if (group.parent_id !== null && !groupIds.has(group.parent_id)) throw new Error("Combined graph group parent is unknown");
  const visitingGroups = new Set();
  const visitedGroups = new Set();
  const visitGroup = (groupId) => {
    if (visitingGroups.has(groupId)) throw new Error("Combined graph groups must be acyclic");
    if (visitedGroups.has(groupId)) return;
    visitingGroups.add(groupId);
    const group = graph.groups.find((item) => item.id === groupId);
    if (group?.parent_id) visitGroup(group.parent_id);
    visitingGroups.delete(groupId);
    visitedGroups.add(groupId);
  };
  for (const groupId of groupIds) visitGroup(groupId);
  for (const node of graph.nodes) {
    if (Object.hasOwn(node.presentation, "group_id")) genericRef(node.presentation.group_id, "Combined graph node group", groupIds, `${graph.graph_id}/`);
  }
  if (graph.trace_ref !== null) throw new Error("Combined graph response cannot advertise a trace");
  if (Object.keys(graph.extensions).length) throw new Error("Combined graph extensions are not supported");
  return graph;
}

export function graphEndpoint(params) {
  const allowed = new Set(["kind", "entityId", "lens"]);
  if (!params || typeof params !== "object" || Object.keys(params).some((key) => !allowed.has(key))) throw new Error("Unsupported graph selector");
  const { kind, entityId, lens = kind === "project" ? COMBINED_GRAPH_LENS : "tool.pipeline" } = params;
  if (!new Set(["tool", "project"]).has(kind) || !OPAQUE_ID.test(String(entityId || ""))) throw new Error("Invalid graph request");
  if ((kind === "tool" && lens !== "tool.pipeline") || (kind === "project" && lens !== COMBINED_GRAPH_LENS)) throw new Error("Invalid graph request");
  const query = new URLSearchParams({ lens });
  return `/api/graphs/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}?${query}`;
}

export async function fetchGraphSnapshot(params, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(graphEndpoint(params), { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Graph is unavailable");
  return params?.kind === "project" ? validateCombinedGraphSnapshot(body, params) : validateGraphSnapshot(body, params);
}
