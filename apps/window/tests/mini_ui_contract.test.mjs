import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const miniDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/mini");

async function source(name) {
  return readFile(path.join(miniDir, name), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the customer conversation is branded as Frank without legacy Mini copy", async () => {
  const html = await source("index.html");
  const script = await source("mini.js");
  const api = await source("mini_api.mjs");
  const customerHtml = html
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ");
  assert.match(html, /<title>Frank — Tell me what you need<\/title>/);
  assert.match(html, /href="\/frank\/style\.css"/);
  assert.match(html, /src="\/frank\/app\.js"/);
  assert.doesNotMatch(html, /(?:href|src)="[^\"]*\/mini(?:\/|\")/i);
  assert.doesNotMatch(customerHtml, /\bmini frank\b|\bmini\b/i);
  assert.doesNotMatch(`${script}\n${api}`, /\bmini frank\b/i);
  assert.match(script, /from "\.\/stream\.mjs"/);
  assert.match(script, /from "\.\/api\.mjs"/);
  assert.match(script, /new URL\("\/frank\/", location\.origin\)/);
  assert.doesNotMatch(script, /outcome-contract|<h3[^>]*>Before I build|<dt>I know|<dt>I have|<dt>I.?m assuming/i);
});

test("customer-visible source has no legacy ready or privacy copy", async () => {
  const html = await source("index.html");
  const script = await source("mini.js");
  const api = await source("mini_api.mjs");
  const css = await source("mini.css");
  const customerSource = `${html}\n${script}\n${api}\n${css}`;
  for (const phrase of [
    "Before I build",
    "Build this version",
    "That reply took too long",
    "Please try again",
    "Private link access",
    "How private access works",
    "I’ll use only what you share",
    "You have started several requests today",
    "free chat limit",
  ]) {
    assert.doesNotMatch(customerSource, new RegExp(escapeRegExp(phrase), "i"), phrase);
  }
  assert.doesNotMatch(script, /data-action="start-build"|data-action="start-free"|attachDecision|function startBuild/i);
  assert.match(script, /data-action="resume"/);
  assert.match(script, />Start build</);
  assert.match(script, />Retry<|>Try build again</);
});

test("the composer stays focused and offers a stop control for active work", async () => {
  const html = await source("index.html");
  const script = await source("mini.js");
  const css = await source("mini.css");

  assert.doesNotMatch(html, /I.?ll use only what you share|Private link access|How private access works/i);
  assert.doesNotMatch(script, /I.?ll use only what you share|Private link access|How private access works|bearer access/i);
  assert.match(script, /dataset\.action = canStop \? \"stop-response\"/);
  assert.match(script, /Stop response/);
  assert.doesNotMatch(css, /var\(--serif\)|gradient|font-family:\s*[^;]*serif/i);
});

test("the first non-empty message uses the fast streamed conversation before a full build", async () => {
  const script = await source("mini.js");
  const css = await source("mini.css");

  assert.match(script, /await guideAfter\(spokenText, files\)/);
  assert.doesNotMatch(script, /setBusy\(false\);\s*await startFreeWork\("new"\)/);
  assert.match(script, /attachResume\(assistantMessage\)/);
  assert.match(script, /Working on it/);
  assert.doesNotMatch(script, /Before I build|outcome-contract|Build this for free/i);
  assert.doesNotMatch(css, /#302e2a|#88837a/i);
  assert.match(css, /--sans:\s*-apple-system/);
});

test("only the build boundary applies the project entitlement and planning stays open", async () => {
  const script = await source("mini.js");

  assert.match(script, /error\.code === "project_limit_reached"/);
  assert.match(script, /one active build project/);
  assert.match(script, /building more projects is a paid feature/);
  assert.match(script, /state\.phase = "guiding"/);
  assert.match(script, /Keep planning or refine this build/);
  assert.match(script, /data-action="work">Open your project/);
});
