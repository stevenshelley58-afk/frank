// Legacy import and startup contract for the owner workspace (P2).
//
// An earlier replacement of the owner surface broke an imported manifest by
// removing fields its consumer still read. This check imports every consumer
// that pulls the owner workspace in, asserts the fields they read are intact,
// and starts the workspace through the legacy shortcut as well as app.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every operations shortcut keeps the fields its consumers read", async () => {
  const { OPERATIONS_TOOLS, operationsTool, mountOperationsTool } = await import("../web/js/operations-tools.js");
  assert.ok(Array.isArray(OPERATIONS_TOOLS), "OPERATIONS_TOOLS is still an exported array");
  assert.equal(OPERATIONS_TOOLS.length, 8);
  const expectedIds = ["inbox", "calendar", "notifications", "customers", "email-flows", "billing", "analytics", "connections"];
  assert.deepEqual(OPERATIONS_TOOLS.map((tool) => tool.id), expectedIds);
  for (const tool of OPERATIONS_TOOLS) {
    // These four fields were removed once and broke the preview consumer.
    assert.equal(typeof tool.provider, "string", `${tool.id} lost its provider`);
    assert.equal(typeof tool.description, "string", `${tool.id} lost its description`);
    assert.ok(Array.isArray(tool.metrics), `${tool.id} lost its metrics array`);
    assert.ok(Array.isArray(tool.items), `${tool.id} lost its items array`);
    assert.equal(typeof tool.name, "string", `${tool.id} lost its name`);
  }
  assert.equal(operationsTool("connections").name, "Connections");
  assert.equal(operationsTool("not-a-tool"), null);
  assert.equal(typeof mountOperationsTool, "function", "the legacy mount entry point survives");
});

test("the retired operations preview still imports and keeps every declared manifest field", async () => {
  const preview = await import("../web/js/blockwise-operations-preview.js");
  assert.equal(preview.isBlockwiseOperationsPreview(), false);
  assert.ok(preview.BLOCKWISE_PREVIEW_MANIFESTS.length > 0);
  const fields = ["id", "version", "title", "description", "surfaces", "default_size", "allowed_sizes", "provider", "freshness", "accepts_connection", "multiple", "preview"];
  for (const manifest of preview.BLOCKWISE_PREVIEW_MANIFESTS) {
    for (const field of fields) {
      assert.ok(Object.hasOwn(manifest, field), `${manifest.id} lost ${field}`);
    }
    assert.ok(Array.isArray(manifest.surfaces) && manifest.surfaces.length > 0, `${manifest.id} lost its surfaces`);
    assert.ok(manifest.allowed_sizes.includes(manifest.default_size), `${manifest.id} declares an unusable default size`);
  }
  const home = preview.blockwisePreviewHome({ name: "Blockwise" });
  assert.equal(home.schema, "schema://frank.home/v1");
  assert.equal(home.instances.length, preview.BLOCKWISE_PREVIEW_MANIFESTS.length);
  assert.ok(home.instances.every((instance) => instance.widget_id && instance.layout && instance.config));
  const snapshot = preview.blockwisePreviewSnapshot(home.instances[0]);
  assert.ok(snapshot, "the preview snapshot consumer still returns a snapshot");
  for (const field of ["status", "summary", "data", "links"]) {
    assert.ok(Object.hasOwn(snapshot, field), `the preview snapshot lost ${field}`);
  }
  assert.equal(snapshot.status, "recorded");
  // The per-tool snapshot path reads metrics[0][0]. OPERATIONS_TOOLS carries
  // empty metrics on purpose (no fixture business data in the owner surface),
  // so that path must stay unreachable. Re-enabling the preview fails here and
  // forces the consumer to be fixed instead of shipping a crash.
  assert.equal(preview.isBlockwiseOperationsPreview(), false);
});

test("every declared tool manifest on disk still satisfies the tool-app contract", () => {
  const toolsDir = path.join(root, "tools");
  const ids = readdirSync(toolsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(ids.length >= 5, "the discovered tool packages are still present");
  const manifestFields = ["schema", "id", "version", "name", "description", "scopes", "settings", "pipelines", "capabilities", "connectors", "schedules", "thresholds", "approval_gates"];
  const homeFields = ["blurb", "capabilities", "connection_capabilities", "default_widget_ids", "id", "kind", "name"];
  for (const id of ids) {
    const manifest = JSON.parse(readFileSync(path.join(toolsDir, id, "manifest.json"), "utf8"));
    assert.equal(manifest.schema, "schema://frank.tool-app-manifest/v1", `${id} manifest schema`);
    assert.equal(manifest.id, id, `${id} manifest id`);
    assert.match(manifest.version, /^\d+\.\d+\.\d+/, `${id} manifest version`);
    for (const field of manifestFields) {
      assert.ok(Object.hasOwn(manifest, field), `${id} manifest lost ${field}`);
    }
    const home = JSON.parse(readFileSync(path.join(toolsDir, id, "home.json"), "utf8"));
    assert.deepEqual(Object.keys(home).sort(), homeFields, `${id} home.json field set`);
    assert.equal(home.kind, "tool", `${id} home.json kind`);
    assert.equal(home.id, id, `${id} home.json id`);
    assert.ok(Array.isArray(home.capabilities) && Array.isArray(home.default_widget_ids) && Array.isArray(home.connection_capabilities));
  }
});

test("the owner workspace modules import without a browser and keep the mount contract", async () => {
  const dashboard = await import("../web/js/owner-dashboard.js");
  assert.equal(typeof dashboard.mountOwnerDashboard, "function");
  assert.equal(typeof dashboard.mountOwnerDashboard(null), "function", "a null host yields a no-op disposer instead of throwing");
  assert.ok(Array.isArray(dashboard.OWNER_SOURCES) && dashboard.OWNER_SOURCES.length === 7);
  const host = await import("../web/js/owner-app-host.js");
  assert.equal(typeof host.createOwnerAppHost, "function");
  assert.ok(host.OWNER_APPS.length >= 4);
  for (const app of host.OWNER_APPS) {
    assert.match(app.origin, /^https:\/\/[a-z0-9.-]+$/, `${app.id} declares a plain https origin`);
    assert.ok(Array.isArray(app.pathPrefixes) && app.pathPrefixes.length > 0, `${app.id} declares path prefixes`);
    assert.ok(String(app.home).startsWith("/"), `${app.id} declares a home path`);
  }
});

test("the shell, the legacy shortcut and app.js still agree on the owner entry point", () => {
  const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
  // The vanilla Window hands the owner routes to the shell the server serves
  // there, so it no longer mounts the workspace itself.
  assert.doesNotMatch(app, /mountOwnerDashboard/);
  assert.match(app, /window\.location\.assign\(ownerPath\)/);
  const legacy = readFileSync(new URL("../web/js/operations-tools.js", import.meta.url), "utf8");
  assert.match(legacy, /import \{ mountOwnerDashboard \} from "\.\/owner-dashboard\.js/);
  assert.match(legacy, /return mountOwnerDashboard\(root\)/);
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="owner-dashboard"/);
  // The shared operations tool still renders owner workspace markup.
  assert.match(html, /owner-dashboard\.css\?v=/);
});
