import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

function showProjectSource() {
  const start = app.indexOf("function showProject(");
  assert.ok(start >= 0, "app.js still defines showProject");
  const end = app.indexOf('$$(".rail-item[data-view]"', start);
  assert.ok(end > start, "showProject is still followed by the rail listener");
  return app.slice(start, end);
}

test("the vanilla Window no longer renders the owner workspace", () => {
  // The owner shell is served at the owner routes themselves, so a second copy
  // inside the vanilla Window would be a stale duplicate of the same surface.
  assert.doesNotMatch(app, /mountOwnerDashboard/);
  assert.doesNotMatch(app, /disposeOwnerDashboard/);
  assert.doesNotMatch(html, /id="owner-dashboard"/);
  // The stylesheet stays: the shared operations tool still renders the owner
  // workspace markup inside the vanilla Window.
  assert.match(html, /owner-dashboard\.css\?v=/);
});

test("Blockwise branches before the technical project home and hands off to the owner path", () => {
  const project = showProjectSource();
  assert.ok(project.indexOf("isOwnerDashboardProject") < project.indexOf("openProjectHome"));
  assert.match(project, /pathForView\("project", \{/);
  assert.match(project, /ownerSection: options\.ownerSection,/);
  assert.match(project, /ownerCustomerId: options\.ownerCustomerId,/);
  assert.match(project, /window\.location\.assign\(ownerPath\)[\s\S]*?return true;[\s\S]*?openProjectHome/);
});

test("the handoff cannot loop on a tab already parked on the owner address", () => {
  const project = showProjectSource();
  assert.match(project, /if \(window\.location\.pathname !== ownerPath\) window\.location\.assign\(ownerPath\);/);
});

test("the handoff sits inside the owner branch, so ?technical=1 keeps the vanilla home", () => {
  // isOwnerDashboardProject is false for ?technical=1, and the server serves the
  // vanilla Window for that query, so the technical project home must still be
  // rendered here rather than bounced back to the shell.
  const project = showProjectSource();
  const branch = project.indexOf("isOwnerDashboardProject");
  const assign = project.indexOf("window.location.assign");
  const technicalHome = project.indexOf('document.body.classList.toggle("blockwise-operations-preview"');
  assert.ok(branch >= 0, "showProject still branches on isOwnerDashboardProject");
  assert.ok(assign > branch, "the assign sits inside the owner branch");
  assert.ok(technicalHome > assign, "the technical project home comes after the owner branch returns");
  assert.doesNotMatch(project.slice(technicalHome), /window\.location\.assign/);
});

test("no owner surface opens an external tab", () => {
  // The launcher must not return: every owner surface stays inside Frank.
  assert.doesNotMatch(app, /target\s*=\s*["']_blank["'][\s\S]{0,120}owner/i);
});

test("owner workspace styles stay scoped to the owner namespace", () => {
  // The stylesheet is loaded for every Frank view, so it must not leak generic
  // selectors, and it must not carry the retired sample-dashboard selectors.
  const css = readFileSync(new URL("../web/owner-dashboard.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /(^|\n)\s*(html|body|\*)\s*\{/);
  assert.doesNotMatch(css, /owner-dashboard-(stat|chart|connection|split)/);
});
