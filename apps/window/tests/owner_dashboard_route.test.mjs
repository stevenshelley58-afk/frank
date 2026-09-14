import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

test("native applications use the existing private Frank route host", () => {
  assert.match(html, /data-view="blockwise-dashboard" id="owner-dashboard" aria-label="Blockwise native applications"/);
  assert.match(html, /owner-dashboard\.css\?v=20260914-native-owner-apps-v1/);
  assert.match(app, /disposeOwnerDashboard = mountOwnerDashboard\(\$\("#owner-dashboard"\)\)/);
});

test("Blockwise launch branches before the technical project home and disposes on navigation", () => {
  const project = app.slice(app.indexOf("function showProject("), app.indexOf('$$('.concat('".rail-item[data-view]"'), app.indexOf("function showProject(")));
  assert.ok(project.indexOf("isOwnerDashboardProject") < project.indexOf("openProjectHome"));
  assert.match(project, /mountOwnerDashboard[\s\S]*?return true;[\s\S]*?openProjectHome/);
});

test("native launch styles are scoped and contain no dashboard fixture selectors", () => {
  const css = readFileSync(new URL("../web/owner-dashboard.css", import.meta.url), "utf8");
  assert.match(css, /^\.owner-launch\s*\{/);
  assert.doesNotMatch(css, /owner-dashboard-(stat|chart|connection|split)/);
});
