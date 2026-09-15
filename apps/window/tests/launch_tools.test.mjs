import assert from "node:assert/strict";
import test from "node:test";
import { get, list } from "../web/js/registry.js";
import "../web/js/widgets.js";

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  closest() { return { classList: { add() {} } }; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
}
const descend = (element) => [element, ...element.children.flatMap(descend)];
async function render(providers = [], mail = {}, fail = false) {
  const calls = [];
  globalThis.document = { head: new Element(), getElementById: () => null, createElement: (tag) => new Element(tag) };
  globalThis.window = {};
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return { ok: !fail, json: async () => url.endsWith("readiness") ? { providers } : mail };
  };
  const host = new Element();
  get("blockwise-launch-desk").mount(host);
  await new Promise(setImmediate);
  return { nodes: descend(host), calls };
}

test("launch navigation preserves essential Frank tools", () => {
  const ids = list("tools").map((tool) => tool.id);
  for (const id of ["blockwise-launch-desk", "account-manager", "connections", "factory-ad", "hermes-tool", "widget-builder"]) assert.ok(ids.includes(id), id);
});

test("launch entry stays internal and provider shortcuts are absent", async () => {
  const { nodes, calls } = await render();
  assert.equal(calls.length, 0);
  assert.equal(nodes.filter((n) => n.className === "launch-desk-card").length, 0);
  assert.ok(nodes.some((n) => n.tag === "button" && n.textContent === "Open Blockwise workspace"));
  assert.ok(!nodes.some((n) => /Mautic|Mailflare|Chatwoot|Resend/.test(n.textContent || "")));
  const button = nodes.find((n) => n.tag === "button" && n.textContent === "Open Blockwise workspace");
  assert.ok(button.listeners.click);
  let navigation;
  globalThis.window.dispatchEvent = (event) => { navigation = event; };
  button.listeners.click();
  assert.equal(navigation.type, "frank:project-home");
  assert.equal(navigation.detail, "blockwise");
});
