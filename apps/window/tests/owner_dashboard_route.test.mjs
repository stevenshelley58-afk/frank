import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

test("the owner workspace uses the existing private Frank route host", () => {
  assert.match(html, /data-view="blockwise-dashboard" id="owner-dashboard"/);
  assert.match(html, /owner-dashboard\.css\?v=/);
  assert.match(app, /disposeOwnerDashboard = mountOwnerDashboard\(\$\("#owner-dashboard"\), \{/);
});

test("Blockwise branches before the technical project home and disposes on navigation", () => {
  const project = app.slice(app.indexOf("function showProject("), app.indexOf('$$('.concat('".rail-item[data-view]"'), app.indexOf("function showProject(")));
  assert.ok(project.indexOf("isOwnerDashboardProject") < project.indexOf("openProjectHome"));
  assert.match(project, /mountOwnerDashboard[\s\S]*?return true;[\s\S]*?openProjectHome/);
});

test("the owner workspace receives its section from the route, not from a rebuilt home", () => {
  // A deep link such as /project/blockwise/crm must reach the workspace as a
  // section, and the address bar must keep that section rather than collapsing
  // to the bare project home on the next history write.
  assert.match(app, /ownerDetail\.ownerSection = options\.ownerSection/);
  assert.match(app, /ownerDetail\.ownerCustomerId = options\.ownerCustomerId/);
  assert.match(app, /ownerSection: route\.ownerSection/);
  assert.match(app, /ownerCustomerId: route\.ownerCustomerId/);
  assert.match(app, /routeDetail: ownerDetail/);
});

test("the workspace host is mounted through the shared panel element", () => {
  // The launcher must not return: no owner surface may open an external tab.
  assert.doesNotMatch(app, /target\s*=\s*["']_blank["'][\s\S]{0,120}owner/i);
});

test("owner workspace styles stay scoped to the owner namespace", () => {
  // The stylesheet is loaded for every Frank view, so it must not leak generic
  // selectors, and it must not carry the retired sample-dashboard selectors.
  const css = readFileSync(new URL("../web/owner-dashboard.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|\*)\s*\{/);
  assert.doesNotMatch(css, /owner-dashboard-(stat|chart|connection|split)/);
});
