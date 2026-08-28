import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const miniDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/mini");

async function source(name) {
  return readFile(path.join(miniDir, name), "utf8");
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
  assert.doesNotMatch(customerHtml, /\bmini frank\b|\bmini\b/i);
  assert.doesNotMatch(`${script}\n${api}`, /\bmini frank\b/i);
  assert.doesNotMatch(script, /outcome-contract|<h3[^>]*>Before I build|<dt>I know|<dt>I have|<dt>I.?m assuming/i);
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
