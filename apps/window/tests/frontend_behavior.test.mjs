import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Hub modules do not resolve the graph chunk before a graph surface opens", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(process.execPath, [
    "--experimental-loader", "./tests/no_graph_loader.mjs",
    "--input-type=module", "--eval",
    "await import('./web/js/homes.js'); await import('./web/js/ad-studio.js');",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("work mutations share one operation id between JSON body and header input", async () => {
  globalThis.window = {};
  const { workMutation } = await import("../web/js/work.js");
  const mutation = workMutation("task-create", { project_id: "frank", title: "Ship it" });
  const body = JSON.parse(mutation.body);
  assert.match(mutation.operationId, /^task-create-[a-f0-9]+$/);
  assert.equal(body.operation_id, mutation.operationId);
  assert.equal(body.project_id, "frank");
});

test("a new project work mount aborts and replaces the previous project request", async () => {
  class FakeElement {
    constructor() { this.children = []; this.dataset = {}; this.className = ""; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
  }
  globalThis.window = {};
  globalThis.document = { createElement: () => new FakeElement() };
  const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return new Promise(() => {});
  };
  const { mountProjectWorkInto } = await import("../web/js/work.js");
  const host = new FakeElement();
  mountProjectWorkInto(host, "alpha");
  const firstChild = host.children[0];
  mountProjectWorkInto(host, "beta");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.notEqual(host.children[0], firstChild);
  assert.match(calls[1].url, /project_id=beta/);
});
