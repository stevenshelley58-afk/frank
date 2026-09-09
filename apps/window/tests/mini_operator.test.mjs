import assert from "node:assert/strict";
import test from "node:test";

import { createMiniServiceRequestsPanel } from "../web/js/mini-service-requests.js";

class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.className = "";
    this.selectedIndex = 0;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  get options() { return this.children; }
  get text() { return this.textContent; }
}

class FakeDocument {
  constructor() { this.visibilityState = "visible"; this.listeners = {}; }
  createElement(tag) { return new FakeNode(tag); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const allText = (node) => [node.textContent, ...node.children.flatMap(allText)].join(" ");
const find = (node, predicate) => predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);

test("Mini requests are literal text and status actions persist through the same-origin API", async () => {
  const documentRef = new FakeDocument();
  const host = new FakeNode();
  const calls = [];
  const hostile = '<img src=x onerror="globalThis.pwned=1">';
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "PATCH") return response(200, { service_request: { status: "contacted" } });
    return response(200, { requests: [{
      operator_status: "new",
      request: { id: "svc_1", kind: "video_call", note: hostile },
      contact: { method: "email", value: hostile },
    }] });
  };
  const panel = createMiniServiceRequestsPanel(host, { documentRef, fetchImpl, pollMs: 30000 });
  panel.setActive(true);
  await pause();

  assert.equal(host.hidden, false);
  assert.match(allText(host), /Service requests/);
  assert.equal(allText(host).split(hostile).length - 1, 2);
  assert.equal(globalThis.pwned, undefined);

  const select = find(host, (node) => node.tagName === "SELECT");
  select.value = "contacted";
  select.selectedIndex = 1;
  await select.listeners.change();
  assert.equal(JSON.parse(calls.at(-1).options.body).status, "contacted");
  assert.match(allText(host), /Saved as Contacted/);
  panel.setActive(false);
});

test("manual refresh works and 401/503 are visible errors rather than empty states", async () => {
  const documentRef = new FakeDocument();
  const host = new FakeNode();
  const replies = [
    response(401, {}),
    response(503, {}),
    response(200, { requests: [] }),
  ];
  const panel = createMiniServiceRequestsPanel(host, {
    documentRef,
    fetchImpl: async () => replies.shift(),
    pollMs: 30000,
  });
  panel.setActive(true);
  await pause();
  assert.match(allText(host), /authentication expired/);
  const refresh = find(host, (node) => node.dataset.miniOperatorRefresh);
  await refresh.listeners.click();
  await pause();
  assert.match(allText(host), /unavailable.*Mini connection/);
  await panel.refresh();
  assert.match(allText(host), /No service requests need follow-up/);
  panel.setActive(false);
});

test("a new refresh aborts the overlapping request and hidden panels stop fetching", async () => {
  const documentRef = new FakeDocument();
  const host = new FakeNode();
  const pending = [];
  const panel = createMiniServiceRequestsPanel(host, {
    documentRef,
    fetchImpl: (_url, options) => new Promise((resolve) => pending.push({ resolve, signal: options.signal })),
    pollMs: 30000,
  });
  panel.setActive(true);
  await pause();
  const first = pending[0];
  panel.refresh();
  await pause();
  assert.equal(first.signal.aborted, true);
  panel.setActive(false);
  assert.equal(host.hidden, true);
  assert.equal(pending.at(-1).signal.aborted, true);
});
