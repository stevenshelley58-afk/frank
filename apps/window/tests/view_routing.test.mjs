import assert from "node:assert/strict";
import test from "node:test";

import { isOwnerDashboardProject, blockwiseTemplateUrl, OWNER_SECTIONS, ownerPathForCustomer, ownerPathForSection, pathForView, routeForPath, viewForPath } from "../web/js/view-routing.js";

test("Ad Template Generator has a canonical deep link and every other view returns home", () => {
  assert.equal(viewForPath("/ad-template-generator"), "ad-template-generator");
  assert.equal(viewForPath("/ad-template-generator/"), "ad-template-generator");
  assert.equal(viewForPath("/ad-studio"), "ad-template-generator");
  assert.equal(pathForView(viewForPath("/ad-studio")), "/ad-template-generator");
  assert.equal(viewForPath("/blog-studio"), "blog-studio");
  assert.equal(viewForPath("/blog-studio/"), "blog-studio");
  assert.equal(pathForView("blog-studio"), "/blog-studio");
  assert.equal(viewForPath("/ad-radar"), "ad-radar");
  assert.equal(viewForPath("/ad-radar/"), "ad-radar");
  assert.equal(pathForView("ad-radar"), "/ad-radar");
  assert.equal(viewForPath("/"), "hub");
  assert.equal(viewForPath("/not-a-view"), "hub");
  assert.equal(pathForView("ad-template-generator"), "/ad-template-generator");
  assert.equal(pathForView("tools"), "/tools");
  assert.deepEqual(routeForPath("/project/blockwise"), { view: "project", projectId: "blockwise" });
  assert.equal(pathForView("project", { projectId: "blockwise" }), "/project/blockwise");
  assert.deepEqual(routeForPath("/entity/tool/accounts"), { view: "entity-home", entity: { kind: "tool", id: "accounts" } });
  assert.deepEqual(routeForPath("/entity/tool/mail"), { view: "entity-home", entity: { kind: "tool", id: "mail" } });
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

test("the vanilla hub has its own address now that the owner shell holds the root", () => {
  assert.equal(pathForView("hub"), "/hub");
  assert.deepEqual(routeForPath("/hub"), { view: "hub" });
  assert.deepEqual(routeForPath("/hub/"), { view: "hub" });
  // An unknown path still resolves to the hub view, and canonicalises to the
  // hub address rather than to the shell's front door.
  assert.equal(viewForPath("/not-a-view"), "hub");
  assert.equal(pathForView(viewForPath("/not-a-view")), "/hub");
  // A view with no address of its own falls back to the hub, not to "/".
  assert.equal(pathForView("widget-builder"), "/hub");
  // A stale tab landing on the root still reads as the hub.
  assert.equal(viewForPath("/"), "hub");
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


test("owner frontend belongs only to Blockwise and retains technical home", () => {
  assert.equal(isOwnerDashboardProject("blockwise"), true);
  assert.equal(isOwnerDashboardProject("blockwise", "?preview=blockwise-operations"), true);
  assert.equal(isOwnerDashboardProject("blockwise", "?technical=1"), false);
  assert.equal(isOwnerDashboardProject("mini-frank"), false);
  assert.equal(isOwnerDashboardProject("other", "?preview=blockwise-operations"), false);
  assert.equal(pathForView("blockwise-dashboard"), "/project/blockwise");
});

test("owner workspace sections are allowlisted nested routes under the Blockwise home", () => {
  // The plain project home keeps its exact historical shape.
  assert.deepEqual(routeForPath("/project/blockwise"), { view: "project", projectId: "blockwise" });
  assert.deepEqual(routeForPath("/project/blockwise/"), { view: "project", projectId: "blockwise" });

  for (const section of OWNER_SECTIONS) {
    assert.deepEqual(routeForPath(`/project/blockwise/${section}`), {
      view: "project",
      projectId: "blockwise",
      ownerSection: section,
    });
    // A trailing slash is the same route, so shared links survive both spellings.
    assert.deepEqual(routeForPath(`/project/blockwise/${section}/`), {
      view: "project",
      projectId: "blockwise",
      ownerSection: section,
    });
    assert.equal(pathForView("project", { projectId: "blockwise", ownerSection: section }), `/project/blockwise/${section}`);
  }

  // A section is never an arbitrary user string.
  const unknown = routeForPath("/project/blockwise/not-a-section");
  assert.equal(unknown.invalid, true);
  assert.equal(unknown.view, "hub");
  assert.match(unknown.message, /No owner workspace section is registered/);

  // The technical project home is still reachable for every owner section.
  assert.deepEqual(routeForPath("/project/blockwise?technical=1"), { view: "project", projectId: "blockwise" });
});

test("owner customer deep links accept only one opaque identifier", () => {
  assert.deepEqual(routeForPath("/project/blockwise/customer/abc-123_XYZ"), {
    view: "project",
    projectId: "blockwise",
    ownerCustomerId: "abc-123_XYZ",
  });
  assert.deepEqual(routeForPath("/project/blockwise/customer/abc-123_XYZ/"), {
    view: "project",
    projectId: "blockwise",
    ownerCustomerId: "abc-123_XYZ",
  });
  assert.equal(pathForView("project", { projectId: "blockwise", ownerCustomerId: "abc-123" }), "/project/blockwise/customer/abc-123");

  // Percent-encoded identifiers decode without becoming a path separator, and
  // encodings that cannot name a record are rejected instead of half-decoded.
  assert.equal(routeForPath("/project/blockwise/customer/a%2Eb").ownerCustomerId, "a.b");
  assert.equal(ownerPathForCustomer("a/b"), "/project/blockwise");
  assert.equal(ownerPathForCustomer("a b"), "/project/blockwise");
  assert.equal(routeForPath("/project/blockwise/customer/a%2Fb").invalid, true);
  assert.equal(routeForPath("/project/blockwise/customer/a%20b").invalid, true);

  // No identifier, an empty identifier, and extra segments are all rejected
  // rather than silently resolving to a neighbouring route.
  assert.equal(routeForPath("/project/blockwise/customer").invalid, true);
  assert.equal(routeForPath("/project/blockwise/customer/").invalid, true);
  assert.equal(routeForPath("/project/blockwise/customer/abc/extra").invalid, true);
  assert.equal(routeForPath("/project/blockwise/customer/../secret").invalid, true);
  assert.equal(routeForPath("/project/blockwise/crm/extra").invalid, true);
});

test("owner routing does not widen other projects or entity homes", () => {
  // Another project keeps the historical project view and gains no owner section.
  assert.deepEqual(routeForPath("/project/mini-frank"), { view: "project", projectId: "mini-frank" });
  assert.equal(routeForPath("/project/mini-frank/crm").invalid, true);
  assert.equal(routeForPath("/project/mini-frank/crm").view, "hub");
  assert.deepEqual(routeForPath("/project/blockwise?technical=1"), { view: "project", projectId: "blockwise" });

  // Entity homes are unchanged, including their two-segment limit.
  assert.deepEqual(routeForPath("/entity/tool/accounts"), { view: "entity-home", entity: { kind: "tool", id: "accounts" } });
  assert.equal(routeForPath("/entity/tool/accounts/extra").invalid, true);
  assert.equal(routeForPath("/entity/tool/not-registered").invalid, true);

  // Unrelated static routes are untouched by the wider path pattern.
  assert.equal(viewForPath("/tools"), "tools");
  assert.equal(viewForPath("/ops"), "ops");
  assert.equal(pathForView("ops"), "/ops");
  assert.equal(ownerPathForSection("not-a-section"), "/project/blockwise");
});

