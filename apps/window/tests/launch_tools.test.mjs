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

test("unconfigured launch exposes real email tools without invented readiness or sends", async () => {
  const { nodes, calls } = await render();
  assert.equal(nodes.filter((n) => n.className === "launch-desk-card").length, 6);
  const links = nodes.filter((n) => n.tag === "a").map((n) => n.href);
  assert.ok(links.includes("https://resend.com/emails/receiving"));
  assert.ok(links.includes("https://resend.com/emails"));
  assert.ok(links.includes("https://resend.com/automations"));
  assert.ok(!nodes.some((n) => n.className === "launch-desk-status" && ["Live", "Connected"].includes(n.textContent)));
  assert.ok(nodes.some((n) => /Resend prohibits cold outreach/.test(n.textContent || "")));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, options]) => options.signal instanceof AbortSignal && options.method === undefined && options.body === undefined));
});

test("configured Mailflare becomes the Inbox link while Resend stays the delivery log", async () => {
  const { nodes } = await render([
    { provider: "mailflare", configured: true, verified: false, status: "configured", base_url: "https://mail.example.test" },
  ]);
  const links = nodes.filter((n) => n.tag === "a").map((n) => [n.textContent, n.href]);
  assert.ok(links.some(([label, href]) => label === "Open Mailflare setup" && href === "https://mail.example.test"));
  assert.ok(links.some(([label, href]) => label === "Read delivery logs" && href === "https://resend.com/emails/receiving"));
  assert.ok(nodes.some((n) => n.className === "launch-desk-status" && n.textContent === "Verify Mailflare"));
  assert.ok(!nodes.some((n) => n.className === "launch-desk-status" && n.textContent === "Connected"));
});

test("verified Mailflare is the human Inbox and never replaces Resend delivery", async () => {
  const { nodes } = await render([
    { provider: "mailflare", configured: true, verified: true, status: "ready", base_url: "https://mail.example.test" },
  ]);
  assert.ok(nodes.some((n) => n.tag === "a" && n.textContent === "Open Mailflare" && n.href === "https://mail.example.test"));
  assert.ok(nodes.some((n) => n.tag === "a" && n.textContent === "Read delivery logs" && n.href === "https://resend.com/emails/receiving"));
  assert.ok(nodes.some((n) => n.className === "launch-desk-status" && n.textContent === "Connected"));
  assert.ok(nodes.some((n) => /Read and reply to conversations in Mailflare/.test(n.textContent || "")));
});

test("CRM access never incorrectly requires replacing the sender with Stalwart", async () => {
  const { nodes } = await render([{ provider: "mautic", verified: true, status: "ready", base_url: "https://crm.example.test" }]);
  assert.ok(nodes.some((n) => n.tag === "a" && n.href === "https://crm.example.test"));
  assert.ok(nodes.some((n) => n.className === "launch-desk-status" && n.textContent === "Connected"));
  assert.ok(!nodes.some((n) => /both.*Stalwart/.test(n.textContent || "")));
});

test("each analytics dashboard remains accessible independently", async () => {
  const { nodes } = await render([{ provider: "ga4", verified: true, status: "ready" }]);
  assert.ok(nodes.some((n) => n.tag === "a" && n.textContent === "Open Google Analytics"));
  assert.ok(nodes.some((n) => n.tag === "a" && n.textContent === "Clarity setup"));
});

test("failed setup reads show a retry rather than a healthy-looking empty dashboard", async () => {
  const { nodes } = await render([], {}, true);
  assert.ok(nodes.some((n) => /No service is assumed connected/.test(n.textContent || "")));
  assert.ok(nodes.some((n) => n.tag === "button" && n.textContent === "Try again" && n.listeners.click));
});

test("direct app links are usable before status requests finish", () => {
  globalThis.document = { head: new Element(), getElementById: () => null, createElement: (tag) => new Element(tag) };
  globalThis.window = {};
  globalThis.fetch = () => new Promise(() => {});
  const host = new Element();
  get("blockwise-launch-desk").mount(host);
  const nodes = descend(host);
  assert.equal(nodes.filter((n) => n.className === "launch-desk-card").length, 6);
  assert.ok(nodes.some((n) => n.tag === "a" && n.href === "https://resend.com/emails/receiving"));
});
