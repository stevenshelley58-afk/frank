import test from "node:test";
import assert from "node:assert/strict";
import { graphEndpoint, validateGraphSnapshot, validateTraceSnapshot } from "../graph/graph-client.js";

const graph = { schema: "schema://frank.graph/v1", graph_id: "tool:fixture-tool", nodes: [], edges: [], groups: [], lens: "tool.pipeline" };

test("graph client validates the shared envelope and builds only allowlisted GET selectors", () => {
  assert.equal(validateGraphSnapshot(graph), graph);
  assert.equal(graphEndpoint({ kind: "tool", entityId: "fixture-tool", lens: "tool.pipeline", settingsRevisionId: "rev-4" }), "/api/graphs/tool/fixture-tool?lens=tool.pipeline&settings_revision_id=rev-4");
  assert.throws(() => graphEndpoint({ kind: "tool", entityId: "fixture-tool", lens: "tool.execute" }));
  assert.throws(() => validateGraphSnapshot({ ...graph, schema: "schema://frank.graph/v2" }));
});

test("trace client requires the lowercase 32-hex identity", () => {
  const traceId = "0123456789abcdef0123456789abcdef";
  const trace = { schema: "schema://frank.tool-app-trace/v1", trace_id: traceId };
  assert.equal(validateTraceSnapshot(trace, traceId), trace);
  assert.throws(() => validateTraceSnapshot(trace, traceId.toUpperCase()));
});
