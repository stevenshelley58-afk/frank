import assert from "node:assert/strict";
import test from "node:test";

import { blockwiseTemplateUrl, pathForView, routeForPath, viewForPath } from "../web/js/view-routing.js";

test("Ad Studio has a canonical deep link and every other view returns home", () => {
  assert.equal(viewForPath("/ad-studio"), "ad-studio");
  assert.equal(viewForPath("/ad-studio/"), "ad-studio");
  assert.equal(viewForPath("/"), "hub");
  assert.equal(viewForPath("/not-a-view"), "hub");
  assert.equal(pathForView("ad-studio"), "/ad-studio");
  assert.equal(pathForView("tools"), "/tools");
  assert.deepEqual(routeForPath("/project/blockwise"), { view: "project", projectId: "blockwise" });
  assert.equal(pathForView("project", { projectId: "blockwise" }), "/project/blockwise");
  assert.deepEqual(routeForPath("/entity/tool/accounts"), { view: "entity-home", entity: { kind: "tool", id: "accounts" } });
  assert.equal(pathForView("entity-home", { entity: { kind: "tool", id: "accounts" } }), "/entity/tool/accounts");
  assert.deepEqual(routeForPath("/entity/agent/hermes/"), { view: "entity-home", entity: { kind: "agent", id: "hermes" } });
  assert.equal(routeForPath("/entity/tool/not-registered").invalid, true);
  assert.equal(routeForPath("/entity/unknown/accounts").invalid, true);
  assert.match(routeForPath("/entity/tool/not-registered").message, /No registered tool home/);
  assert.equal(routeForPath("/entity/tool/accounts/").view, "entity-home");
  assert.equal(routeForPath("/project/unknown id").view, "hub");
  assert.equal(routeForPath("/project/unknown id").invalid, true);
  assert.equal(routeForPath("/entity/tool").view, "hub");
  assert.equal(routeForPath("/ops/").view, "ops");
  assert.equal(pathForView("ops"), "/ops");
  for (const view of ["tools", "files", "connections", "accounts", "trace", "releases"]) {
    assert.equal(routeForPath(`/${view}/`).view, view);
    assert.equal(pathForView(view), `/${view}`);
  }
});

test("Blockwise editor links require a safe imported template identity", () => {
  assert.equal(
    blockwiseTemplateUrl({ template_id: "meta-006", status: "imported" }),
    "https://blockwise.sale/ad-studio/templates/meta-006",
  );
  assert.equal(
    blockwiseTemplateUrl({ template_url: "https://blockwise.sale/ad-studio/templates/meta-006" }),
    "https://blockwise.sale/ad-studio/templates/meta-006",
  );
  assert.equal(blockwiseTemplateUrl({}), "");
  assert.equal(blockwiseTemplateUrl({ template_id: "../admin" }), "");
  assert.equal(blockwiseTemplateUrl({ template_id: "meta-006", template_url: "https://evil.example/ad-studio/templates/meta-006" }), "");
  assert.equal(blockwiseTemplateUrl({ template_url: "http://blockwise.sale/ad-studio/templates/meta-006" }), "");
  assert.equal(blockwiseTemplateUrl({ template_url: "https://blockwise.sale/ad-studio/templates/meta-006?workspace=1" }), "");
  assert.equal(blockwiseTemplateUrl({ template_url: "https://user:pass@blockwise.sale/ad-studio/templates/meta-006" }), "");
  assert.equal(
    blockwiseTemplateUrl({
      template_id: "meta-006",
      template_url: "https://blockwise.sale/ad-studio/templates/different",
    }),
    "",
  );
});
