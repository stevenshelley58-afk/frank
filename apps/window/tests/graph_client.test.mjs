import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { graphEndpoint, validateGraphSnapshot } from "../graph/graph-client.js";

const adversarialCorpus = JSON.parse(readFileSync(new URL("./fixtures/graph/adversarial-validation-corpus.json", import.meta.url), "utf8"));

const digest = `sha256:${"d".repeat(64)}`;
const graphId = "tool:fixture-tool";
const observed = "2026-08-14T00:00:00Z";
const graphSource = {
  manifest_id: "fixture-tool",
  manifest_version: "0.1.1",
  pipeline_id: "main",
  pipeline_version: "0.1.1",
  sha256: digest,
};

function node(id, entry = false) {
  return {
    id: `${graphId}/pipeline:main/node:${id}`,
    source_id: id,
    kind: "step",
    label: id,
    scope: { kind: "global" },
    authority: "manifest",
    source: { ...graphSource },
    classification: "unspecified",
    freshness: { observed_at: observed },
    capabilities: [],
    ports: [],
    status: "declared",
    presentation: {},
    extensions: { "frank.graph.entry": entry },
  };
}

function edge(sourceId, from, to) {
  return {
    id: `${graphId}/pipeline:main/edge:${sourceId}:${from}:${to}`,
    source_id: sourceId,
    from: `${graphId}/pipeline:main/node:${from}`,
    to: `${graphId}/pipeline:main/node:${to}`,
    kind: "control",
    authority: "manifest",
    classification: "unspecified",
    source: { ...graphSource },
    freshness: { observed_at: observed },
    status: "declared",
    presentation: {},
    extensions: {},
  };
}

const graph = {
  schema: "schema://frank.graph/v1",
  graph_id: graphId,
  graph_revision: `sha256:${"a".repeat(64)}`,
  generated_at: observed,
  provider: { id: "tool-manifest", version: "1.0.0", authority: "manifest" },
  subject: { kind: "tool", id: "fixture-tool" },
  scope: { kind: "global" },
  lens: "tool.pipeline",
  capabilities: ["inspect"],
  nodes: [node("prepare", true), node("publish")],
  edges: [edge(0, "prepare", "publish")],
  groups: [],
  trace_ref: null,
  extensions: {},
};

const copy = () => structuredClone(graph);
const expected = { kind: "tool", entityId: "fixture-tool", lens: "tool.pipeline" };

test("graph client validates the complete provider envelope and GET selectors", () => {
  assert.equal(validateGraphSnapshot(graph, expected), graph);
  assert.equal(graphEndpoint({ ...expected, settingsRevisionId: "4" }), "/api/graphs/tool/fixture-tool?lens=tool.pipeline&settings_revision_id=4");
  assert.throws(() => graphEndpoint({ ...expected, lens: "tool.execute" }));
  assert.throws(() => graphEndpoint({ ...expected, traceId: "0123456789abcdef0123456789abcdef" }));
  assert.throws(() => validateGraphSnapshot({ ...graph, schema: "schema://frank.graph/v2" }, expected));
  assert.throws(() => validateGraphSnapshot({ ...graph, subject: { kind: "tool", id: "other" } }, expected));
  assert.throws(() => validateGraphSnapshot({ ...graph, lens: "run.trace" }, expected));
  assert.throws(() => validateGraphSnapshot({ ...graph, graph_revision: "sha256:bad" }, expected));
  assert.throws(() => validateGraphSnapshot({ ...graph, trace_ref: { trace_id: "0123456789abcdef0123456789abcdef" } }, expected));
});

test("graph client rejects unknown, incomplete, active-content, control, and nonfinite payloads", () => {
  const unknown = copy();
  unknown.injected = true;
  const incomplete = copy();
  delete incomplete.nodes[0].source;
  const html = copy();
  html.nodes[0].label = "<b>unsafe</b>";
  const script = copy();
  script.nodes[0].label = "javascript:alert(1)";
  const control = copy();
  control.nodes[0].label = "bad\u0001label";
  const nonfinite = copy();
  nonfinite.extensions = { "frank.graph.selection": { node_id: Number.NaN } };
  for (const candidate of [unknown, incomplete, html, script, control, nonfinite]) {
    assert.throws(() => validateGraphSnapshot(candidate, expected));
  }
});

test("graph client rejects duplicate identities and dangling or forged relationships", () => {
  const duplicateNode = copy();
  duplicateNode.nodes.push(structuredClone(duplicateNode.nodes[0]));
  const danglingEdge = copy();
  danglingEdge.edges[0].to = `${graphId}/pipeline:main/node:missing`;
  const forgedEdgeSource = copy();
  forgedEdgeSource.edges[0].source.pipeline_id = "other";
  const duplicateSource = copy();
  duplicateSource.nodes.push(node("archive"));
  duplicateSource.edges.push(edge(0, "prepare", "archive"));
  const badGroup = copy();
  badGroup.groups = [{ id: "main", label: "Main", parent_id: "missing" }];
  const cyclicGroups = copy();
  cyclicGroups.groups = [
    { id: "one", label: "One", parent_id: "two" },
    { id: "two", label: "Two", parent_id: "one" },
  ];
  for (const candidate of [duplicateNode, danglingEdge, forgedEdgeSource, duplicateSource, badGroup, cyclicGroups]) {
    assert.throws(() => validateGraphSnapshot(candidate, expected));
  }
});

test("graph client binds settings selectors to immutable graph references", () => {
  const settingsGraph = copy();
  settingsGraph.nodes[0].settings_revision_ref = {
    schema: "schema://frank.tool-app-settings/v1",
    scope: { kind: "global" },
    revision: 4,
  };
  assert.equal(validateGraphSnapshot(settingsGraph, { ...expected, settingsRevisionId: "4" }), settingsGraph);
  assert.throws(() => validateGraphSnapshot(settingsGraph, { ...expected, settingsRevisionId: "5" }));

  const boundaryGraph = copy();
  boundaryGraph.nodes[0].settings_revision_ref = {
    schema: "schema://frank.tool-app-settings/v1",
    scope: { kind: "global" },
    revision: Number.MAX_SAFE_INTEGER,
  };
  assert.equal(
    validateGraphSnapshot(boundaryGraph, { ...expected, settingsRevisionId: String(Number.MAX_SAFE_INTEGER) }),
    boundaryGraph,
  );
});

test("graph client rejects the shared server/browser adversarial corpus", () => {
  for (const fixture of adversarialCorpus) {
    const candidate = copy();
    const mutations = fixture.mutations || [{ path: fixture.path, value: fixture.value }];
    for (const mutation of mutations) {
      let target = candidate;
      for (const part of mutation.path.slice(0, -1)) target = target[part];
      target[mutation.path.at(-1)] = structuredClone(mutation.value);
    }
    assert.throws(
      () => validateGraphSnapshot(candidate, expected),
      undefined,
      `${fixture.id} was accepted in the browser`,
    );
  }
});

test("graph client rejects cyclic nested values without recursing indefinitely", () => {
  const candidate = copy();
  const selection = {};
  selection.node_id = selection;
  candidate.extensions = { "frank.graph.selection": selection };
  assert.throws(() => validateGraphSnapshot(candidate, expected), /cyclic/);
});

test("graph client accepts indexed runtime paths for duplicate canonical pipeline IDs", () => {
  const duplicatePipelines = copy();
  const firstNodes = duplicatePipelines.nodes.map((item) => ({
    ...structuredClone(item),
    id: item.id.replace("/pipeline:main/", "/pipeline:main:0/"),
    presentation: { group_id: "main:0" },
  }));
  const firstEdges = duplicatePipelines.edges.map((item) => ({
    ...structuredClone(item),
    id: item.id.replace("/pipeline:main/", "/pipeline:main:0/"),
    from: item.from.replace("/pipeline:main/", "/pipeline:main:0/"),
    to: item.to.replace("/pipeline:main/", "/pipeline:main:0/"),
  }));
  const secondNodes = firstNodes.map((item) => ({
    ...structuredClone(item),
    id: item.id.replace("/pipeline:main:0/", "/pipeline:main:1/"),
    presentation: { group_id: "main:1" },
  }));
  const secondEdges = firstEdges.map((item) => ({
    ...structuredClone(item),
    id: item.id.replace("/pipeline:main:0/", "/pipeline:main:1/"),
    from: item.from.replace("/pipeline:main:0/", "/pipeline:main:1/"),
    to: item.to.replace("/pipeline:main:0/", "/pipeline:main:1/"),
  }));
  duplicatePipelines.nodes = [...firstNodes, ...secondNodes];
  duplicatePipelines.edges = [...firstEdges, ...secondEdges];
  duplicatePipelines.groups = [
    { id: "main:0", label: "main", order: 0 },
    { id: "main:1", label: "main", order: 1 },
  ];
  assert.equal(validateGraphSnapshot(duplicatePipelines, expected), duplicatePipelines);
});

test("graph client accepts canonical identifiers beyond the retired 160-character limit", () => {
  const longToolId = `tool-${"t".repeat(156)}`;
  const longPipelineId = `pipeline-${"p".repeat(152)}`;
  const longFromId = `from-${"f".repeat(156)}`;
  const longToId = `to-${"t".repeat(158)}`;
  const longGraphId = `tool:${longToolId}`;
  const longSource = {
    ...graphSource,
    manifest_id: longToolId,
    pipeline_id: longPipelineId,
  };
  const longNode = (sourceId, entry = false) => ({
    ...node("prepare", entry),
    id: `${longGraphId}/pipeline:${longPipelineId}/node:${sourceId}`,
    source_id: sourceId,
    label: sourceId,
    source: { ...longSource },
  });
  const candidate = copy();
  candidate.graph_id = longGraphId;
  candidate.subject.id = longToolId;
  candidate.nodes = [longNode(longFromId, true), longNode(longToId)];
  candidate.edges = [{
    ...edge(0, "prepare", "publish"),
    id: `${longGraphId}/pipeline:${longPipelineId}/edge:0:${longFromId}:${longToId}`,
    from: candidate.nodes[0].id,
    to: candidate.nodes[1].id,
    source: { ...longSource },
  }];
  const longExpected = { kind: "tool", entityId: longToolId, lens: "tool.pipeline" };

  assert.ok(candidate.edges[0].id.length > 639);
  assert.equal(validateGraphSnapshot(candidate, longExpected), candidate);
  assert.equal(
    graphEndpoint(longExpected),
    `/api/graphs/tool/${encodeURIComponent(longToolId)}?lens=tool.pipeline`,
  );
});

test("graph client accepts generic groups with truthful optional fields", () => {
  const withoutOrder = copy();
  withoutOrder.groups = [{ id: "review-group", label: "Human readable review group" }];
  withoutOrder.nodes[0].presentation = { group_id: "review-group" };
  assert.equal(validateGraphSnapshot(withoutOrder, expected), withoutOrder);

  const withNonIndexOrder = copy();
  withNonIndexOrder.groups = [{ id: "publish-group", label: "Publishing", order: 7 }];
  withNonIndexOrder.nodes[1].presentation = { group_id: "publish-group" };
  assert.equal(validateGraphSnapshot(withNonIndexOrder, expected), withNonIndexOrder);
});

test("graph client accepts the maximum safe edge source and group order integers", () => {
  const candidate = copy();
  candidate.edges[0].source_id = Number.MAX_SAFE_INTEGER;
  candidate.edges[0].id = `${graphId}/pipeline:main/edge:${Number.MAX_SAFE_INTEGER}:prepare:publish`;
  candidate.groups = [{ id: "review-group", label: "Review", order: Number.MAX_SAFE_INTEGER }];
  candidate.nodes[0].presentation = { group_id: "review-group" };
  assert.equal(validateGraphSnapshot(candidate, expected), candidate);
});
