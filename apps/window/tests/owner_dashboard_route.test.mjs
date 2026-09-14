import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

test("dashboard has a dedicated host inside the existing private Frank shell", () => {
  assert.match(html, /data-view="blockwise-dashboard" id="owner-dashboard"/);
  assert.match(html, /owner-dashboard\.css\?v=/);
  assert.match(app, /disposeOwnerDashboard = mountOwnerDashboard\(\$\("#owner-dashboard"\)\)/);
});

test("owner preview branches before the live home fetch and disposes on navigation", () => {
  const project = app.slice(app.indexOf("function showProject("), app.indexOf('$$('.concat('".rail-item[data-view]"'), app.indexOf("function showProject(")));
  assert.ok(project.indexOf("isOwnerDashboardProject") < project.indexOf("openProjectHome"));
  assert.match(project, /mountOwnerDashboard[\s\S]*?return true;[\s\S]*?openProjectHome/);
  assert.match(app, /function show\([\s\S]*?disposeOwnerDashboard\?\.\(\);/);
  assert.match(html, /id="owner-dashboard-return" href="\/project\/blockwise"/);
});


test("dashboard root token rule is a valid standalone selector", () => {
  const css = readFileSync(new URL("../web/owner-dashboard.css", import.meta.url), "utf8");
  assert.match(css, /^\.owner-dashboard\s*\{/);
  assert.doesNotMatch(css, /^\+ /m);
});


test("sample lead series reconciles to every period total", async () => {
  const { rangeMetrics } = await import("../web/js/owner-dashboard.js");
  for (const days of [7, 30, 90]) {
    const sample = rangeMetrics(days);
    assert.equal(sample.g.reduce((sum, count) => sum + count, 0), sample.leads);
    assert.equal(sample.mrr, rangeMetrics(30).mrr);
    assert.equal(sample.paying, rangeMetrics(30).paying);
  }
});
