// Owner workspace shell contract (P2): routes, source interfaces, typed
// drill-downs, missing-data honesty, native panel host, bridge validation and
// the dirty-state guard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OWNER_SECTIONS } from "../web/js/view-routing.js";
import {
  countText,
  mountOwnerDashboard,
  normalizeSourcePayload,
  ownerRailSections,
  ownerSectionHref,
  ownerSectionView,
  overviewState,
  OWNER_SOURCES,
  nativeRecordPath,
  parseDrilldownTarget,
  resetOwnerSourceCache,
  resolveOwnerRoute,
  sourceStateFromFailure,
  sourceStateFromResponse,
  targetPath,
} from "../web/js/owner-dashboard.js";
import {
  allowedNativePath,
  allowedNativeUrl,
  createOwnerAppHost,
  MAX_RETAINED_NATIVE_PANELS,
  ownerApp,
  panelStateFromFailure,
  panelStateFromReadiness,
  panelStateFromResponse,
  parseAppBridgeMessage,
  planPanelSwitch,
  readinessEndpoint,
  reloadNeedsConfirmation,
} from "../web/js/owner-app-host.js";

const dashboardSource = readFileSync(new URL("../web/js/owner-dashboard.js", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../web/js/owner-app-host.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../web/owner-dashboard.css", import.meta.url), "utf8");

/* ---------------------------------------------------------------- fake DOM */

class FakeNode {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.textValue = "";
    this.listeners = new Map();
    this.isConnected = true;
  }
  get textContent() {
    return this.textValue + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this.textValue = value === null || value === undefined ? "" : String(value);
    this.children = [];
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.textValue = "";
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
    this.isConnected = false;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== fn));
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ defaultPrevented: false, button: 0, detail: 0, preventDefault() {}, ...event });
  }
  focus() {
    this.focused = true;
  }
  get classList() {
    const self = this;
    const parts = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add: (name) => { if (!parts().includes(name)) self.className = [...parts(), name].join(" "); },
      remove: (name) => { self.className = parts().filter((part) => part !== name).join(" "); },
      contains: (name) => parts().includes(name),
    };
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = null;
  }
  createElement(tag) {
    const node = new FakeNode(this, tag);
    if (String(tag).toLowerCase() === "iframe") node.contentWindow = { frame: node };
    return node;
  }
}

function fakeWindow({ pathname = "/project/blockwise", onLine = true } = {}) {
  const listeners = new Map();
  const win = {
    location: { pathname, search: "", href: `https://frank.fail${pathname}` },
    navigator: { onLine },
    history: {
      pushed: [],
      replaced: [],
      pushState(state, _title, url) { this.pushed.push({ state, url }); win.location.pathname = url; },
      replaceState(state, _title, url) { this.replaced.push({ state, url }); win.location.pathname = url; },
    },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== fn)); },
    dispatch(type, event = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(event); },
    fetch: null,
  };
  return win;
}

function world({ fetchImpl, pathname = "/project/blockwise", onLine = true } = {}) {
  const doc = new FakeDocument();
  const win = fakeWindow({ pathname, onLine });
  win.fetch = fetchImpl;
  doc.defaultView = win;
  return { doc, win };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function walk(node, out = []) {
  out.push(node);
  for (const child of node.children) walk(child, out);
  return out;
}

function byDataset(root, key, value) {
  return walk(root).find((node) => node.dataset?.[key] === value) || null;
}

function allByDataset(root, key) {
  return walk(root).filter((node) => node.dataset?.[key] !== undefined);
}

function panelOf(slot, appId) {
  const region = byDataset(slot, "testid", "owner-app-host");
  return region ? region.children.find((node) => node.dataset.app === appId) || null : null;
}

function frameOf(panel) {
  return panel ? panel.children[1].children.find((node) => node.tagName === "IFRAME") || null : null;
}

function readinessBody(app, path) {
  const declared = ownerApp(app);
  return { app, status: "ready", ready: true, frameable: true, origin: declared.origin, path: path || declared.home };
}

/* ------------------------------------------------------------------ routes */

test("the owner workspace rails the frozen route allowlist and nothing else", () => {
  assert.deepEqual(OWNER_SECTIONS, ["mail", "crm", "support", "campaigns", "revenue", "results", "notifications"]);
  assert.deepEqual(ownerRailSections(), ["overview", ...OWNER_SECTIONS]);
  assert.equal(ownerSectionView("customer").rail, false);
  assert.equal(ownerSectionView("not-a-section"), null);
  assert.equal(ownerSectionHref("mail"), "/project/blockwise/mail");
  assert.equal(ownerSectionHref("overview"), "/project/blockwise");
  assert.equal(ownerSectionHref("customer", "cust_9f2"), "/project/blockwise/customer/cust_9f2");
});

test("a deep link reaches its section from mount options or from the address bar", () => {
  assert.deepEqual(resolveOwnerRoute({ section: "crm" }), { section: "crm" });
  assert.deepEqual(resolveOwnerRoute({ pathname: "/project/blockwise/support" }), { section: "support" });
  assert.deepEqual(resolveOwnerRoute({ pathname: "/project/blockwise/campaigns/" }), { section: "campaigns" });
  assert.deepEqual(resolveOwnerRoute({ pathname: "/project/blockwise/customer/cust_9f2" }), { section: "customer", customerId: "cust_9f2" });
  assert.deepEqual(resolveOwnerRoute({ customerId: "cust_9f2" }), { section: "customer", customerId: "cust_9f2" });
  assert.deepEqual(resolveOwnerRoute({ pathname: "/project/blockwise" }), { section: "overview" });
  assert.deepEqual(resolveOwnerRoute({ pathname: "/project/blockwise/not-real" }), { section: "overview" });
  // An address that is not an opaque identifier is refused rather than fetched.
  assert.deepEqual(resolveOwnerRoute({ customerId: "steven@example.com" }), { section: "customer", customerId: "" });
  assert.equal(ownerSectionHref("customer", "steven@example.com"), "/project/blockwise");
});

test("every summary item is a typed drill-down and Frank composes the destination", () => {
  const native = parseDrilldownTarget({ kind: "native-list", app: "crm", path: "/crm/leads?status=Open", label: "New leads" });
  assert.deepEqual(native, { kind: "native-list", app: "crm", section: "crm", path: "/crm/leads?status=Open", label: "New leads" });
  assert.equal(targetPath(native), "/project/blockwise/crm");
  // A record target names the record, and Frank composes the path from the
  // application's own allowlist, so a crafted identifier cannot widen it.
  const record = parseDrilldownTarget({ kind: "native-record", app: "support", recordKind: "ticket", recordId: "TICK-14" });
  assert.equal(record.path, "/helpdesk/tickets/TICK-14");
  assert.equal(targetPath(record), "/project/blockwise/support");
  assert.equal(nativeRecordPath("crm", "lead", "CRM-LEAD-2026-00015"), "/crm/leads/CRM-LEAD-2026-00015");
  assert.equal(nativeRecordPath("crm", "lead", "../admin"), null);
  assert.equal(nativeRecordPath("crm", "lead", "a/b"), null);
  assert.equal(nativeRecordPath("crm", "not-a-kind", "x"), null);
  assert.equal(parseDrilldownTarget({ kind: "native-record", app: "crm", recordKind: "lead", recordId: "../etc" }), null);
  const section = parseDrilldownTarget({ kind: "owner-section", section: "revenue", filter: "overdue" });
  assert.deepEqual(section, { kind: "owner-section", section: "revenue", filter: "overdue", label: "Revenue" });
  assert.equal(targetPath(section), "/project/blockwise/revenue");
  const customer = parseDrilldownTarget({ kind: "owner-record", customerId: "cust_9f2" });
  assert.equal(targetPath(customer), "/project/blockwise/customer/cust_9f2");
});

test("an unsafe or unknown drill-down target is refused, never rendered", () => {
  for (const bad of [
    { kind: "native-list", app: "crm", path: "https://evil.example/crm/leads" },
    { kind: "native-list", app: "crm", path: "//evil.example/crm" },
    { kind: "native-list", app: "crm", path: "javascript:alert(1)" },
    { kind: "native-list", app: "crm", path: "/etc/passwd" },
    { kind: "native-list", app: "crm", path: "/crm/../../etc/passwd" },
    { kind: "native-list", app: "crm", path: "/crm/%2e%2e/admin" },
    { kind: "native-list", app: "not-an-app", path: "/crm/leads" },
    { kind: "native-list", app: "crm" },
    { kind: "owner-section", section: "overview" },
    { kind: "owner-section", section: "customer" },
    { kind: "owner-record", customerId: "not a valid id" },
    { kind: "external", href: "https://evil.example/" },
    {},
    null,
    "crm",
  ]) {
    assert.equal(parseDrilldownTarget(bad), null, `expected refusal for ${JSON.stringify(bad)}`);
  }
});

test("the shell composes no application URL of its own and the launcher cannot return", () => {
  assert.doesNotMatch(dashboardSource, /https?:\/\//);
  assert.doesNotMatch(dashboardSource, /NATIVE_OWNER_APPS/);
  assert.doesNotMatch(dashboardSource, /tail3084c0/);
  assert.doesNotMatch(dashboardSource, /target\s*=\s*"_blank"/);
  assert.doesNotMatch(cssSource, /\.owner-launch/);
  assert.match(cssSource, /^\/\* Frank owner workspace\./);
  assert.match(cssSource, /\.owner-workspace\s*\{/);
});

test("the shell keeps provider data out of Frank storage and never reads an app document", () => {
  for (const source of [dashboardSource, hostSource]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
    assert.doesNotMatch(source, /contentDocument|innerHTML/);
    assert.doesNotMatch(source, /\bsample\b|\bfictional\b|\blorem\b|\bNorthline\b|Chatwoot|Stalwart/i);
  }
});

/* ----------------------------------------------------------- missing data */

test("a missing count is missing, never zero, and an unusable target is dropped", () => {
  assert.equal(countText(null), "");
  assert.equal(countText(0), "0");
  const normalized = normalizeSourcePayload("crm", {
    status: "ready",
    summary: "Two leads need a follow-up.",
    items: [
      { id: "a", label: "No count reported" },
      { id: "b", label: "Reported zero", count: 0 },
      { id: "c", label: "Unsafe target", count: 3, target: { kind: "native-list", app: "crm", path: "https://evil.example/" } },
      { id: "d", count: 4 },
    ],
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.items.length, 3);
  assert.equal(normalized.items[0].count, null);
  assert.equal(normalized.items[1].count, 0);
  assert.equal(normalized.items[2].target, null);
  assert.equal(normalized.dropped, 2); // one unsafe destination, one item with no label
});

test("a missing adapter is an unavailable state, not an empty board", () => {
  const missing = sourceStateFromResponse("crm", 404, null);
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.reason, "adapter_missing");
  assert.equal(missing.data, null);
  assert.match(missing.detail, /no adapter for the Frappe CRM lead projection/i);
  const unmapped = sourceStateFromResponse("mail", 404, null);
  assert.equal(unmapped.state, "unavailable");
  const refused = sourceStateFromResponse("mail", 401, null);
  assert.equal(refused.state, "error");
  assert.equal(refused.reason, "not_authorized");
  assert.equal(sourceStateFromResponse("mail", 500, null).state, "error");
  assert.equal(sourceStateFromResponse("mail", 200, { status: "unknown-status" }).state, "unavailable");
  assert.equal(sourceStateFromResponse("mail", 200, null).state, "error");
  assert.equal(sourceStateFromFailure("mail", new Error("boom")).state, "error");
  assert.equal(sourceStateFromFailure("mail", new Error("boom"), { online: false }).reason, "offline");
});

test("a failed source keeps its last confirmed read and stays dated", () => {
  const fetchedAt = new Date("2026-09-14T04:30:00Z");
  const payload = { status: "ready", summary: "One conversation needs a reply.", items: [{ id: "1", label: "Riverside enquiry", count: 1 }] };
  const cached = { data: normalizeSourcePayload("mail", payload), fetchedAt };
  const failed = sourceStateFromResponse("mail", 503, null, { cached, checkedAt: new Date("2026-09-14T05:00:00Z") });
  assert.equal(failed.state, "cached");
  assert.equal(failed.data.items.length, 1);
  assert.equal(failed.fetchedAt, fetchedAt);
  assert.match(failed.detail, /HTTP 503/);
  const cold = sourceStateFromResponse("mail", 503, null, { checkedAt: new Date("2026-09-14T05:00:00Z") });
  assert.equal(cold.state, "error");
  assert.equal(cold.data, null);
});

test("the combined overview never claims nothing needs you while a source is unreadable", () => {
  const unreadable = { source: OWNER_SOURCES[0], state: sourceStateFromResponse("mail", 404, null) };
  const blank = overviewState([unreadable, { source: OWNER_SOURCES[1], state: sourceStateFromResponse("crm", 404, null) }]);
  assert.equal(blank.state, "unavailable");
  assert.match(blank.detail, /no source is connected/i);
  assert.deepEqual(blank.missing, ["mail", "crm"]);

  const ready = sourceStateFromResponse("crm", 200, { status: "empty", summary: "No open leads." });
  const quiet = overviewState([unreadable, { source: OWNER_SOURCES[1], state: ready }]);
  assert.equal(quiet.state, "empty");
  assert.match(quiet.detail, /Nothing needs you in the sources Frank can read/);
  assert.deepEqual(quiet.missing, ["mail"]);

  const busy = sourceStateFromResponse("crm", 200, {
    status: "attention",
    summary: "Two leads need a follow-up.",
    items: [
      { id: "1", label: "Overdue follow-up", count: 2, attention: true, priority: 1, target: { kind: "native-list", app: "crm", path: "/crm/leads?status=Open" } },
      { id: "2", label: "Quiet lead", count: 4 },
    ],
  });
  const attention = overviewState([{ source: OWNER_SOURCES[1], state: busy }]);
  assert.equal(attention.state, "attention");
  assert.equal(attention.items.length, 1);
  assert.equal(attention.items[0].label, "Overdue follow-up");
});

/* --------------------------------------------------------------- app host */

test("readiness, not an iframe load event, decides whether an app is framed", () => {
  assert.doesNotMatch(hostSource, /addEventListener\("load"|onload\s*=/);
  assert.equal(readinessEndpoint("crm"), "/api/owner/workspace/apps/crm/readiness");
  const ready = panelStateFromReadiness("crm", readinessBody("crm"));
  assert.equal(ready.state, "ready");
  assert.equal(ready.url, "https://crm.frank.fail/crm/leads/view/list");
  const elsewhere = panelStateFromReadiness("crm", { ...readinessBody("crm"), origin: "https://evil.example" });
  assert.equal(elsewhere.state, "blocked");
  assert.equal(elsewhere.reason, "origin_not_allowed");
  const outside = panelStateFromReadiness("crm", { ...readinessBody("crm"), path: "/helpdesk/tickets" });
  assert.equal(outside.state, "blocked");
  assert.equal(outside.reason, "path_not_allowed");
  const framed = panelStateFromReadiness("crm", { status: "unavailable", ready: false, frameable: false, reason: "frame_ancestors_none", origin: "https://crm.frank.fail", path: "/crm/leads/view/list" });
  assert.equal(framed.state, "blocked");
  assert.equal(framed.reason, "frame_ancestors_none");
  const notReady = panelStateFromReadiness("crm", { status: "unavailable", ready: false, frameable: true, origin: "https://crm.frank.fail", path: "/crm/leads/view/list" });
  assert.equal(notReady.state, "unavailable");
  assert.equal(panelStateFromResponse("crm", 404, null).reason, "adapter_missing");
  assert.equal(panelStateFromResponse("crm", 403, null).state, "unauthorized");
  assert.equal(panelStateFromResponse("support", 200, readinessBody("support", "/helpdesk/tickets")).state, "ready");
  assert.equal(panelStateFromFailure("crm", new Error("nope"), { online: false }).state, "offline");
});

test("a native path is normalized inside the declared application origin", () => {
  assert.equal(allowedNativePath(ownerApp("crm"), "/crm/leads"), "/crm/leads");
  assert.equal(allowedNativePath(ownerApp("crm"), "/crm/leads?status=Open#top"), "/crm/leads?status=Open#top");
  assert.equal(allowedNativePath(ownerApp("mail"), "/?_task=mail"), "/?_task=mail");
  assert.equal(allowedNativeUrl("crm", "/crm/leads"), "https://crm.frank.fail/crm/leads");
  assert.equal(allowedNativeUrl("support", "/crm/leads"), null);
  assert.equal(allowedNativeUrl("crm", "/crm/../../etc/passwd"), null);
  assert.equal(allowedNativeUrl("crm", "https://crm.frank.fail.evil.example/crm/leads"), null);
  assert.equal(allowedNativeUrl("crm", "/crm/leads\\..\\.."), null);
  assert.equal(allowedNativeUrl("nope", "/"), null);
});

test("a bridge message needs the exact origin, the exact source window, the version and a valid payload", () => {
  const doc = new FakeDocument();
  const frame = doc.createElement("iframe");
  const good = { origin: "https://mail.frank.fail", source: frame.contentWindow, data: { channel: "frank.owner-app", version: 1, app: "mail", type: "dirty", dirty: true } };
  assert.deepEqual(parseAppBridgeMessage(good, frame, "mail"), { type: "dirty", dirty: true });
  assert.deepEqual(parseAppBridgeMessage({ ...good, data: { ...good.data, type: "ready" } }, frame, "mail"), { type: "ready" });
  assert.deepEqual(parseAppBridgeMessage({ ...good, data: { ...good.data, type: "route", path: "/?_task=mail" } }, frame, "mail"), { type: "route", path: "/?_task=mail" });
  assert.equal(parseAppBridgeMessage({ ...good, origin: "*" }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, origin: "https://mail.frank.fail.evil.example" }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, source: { other: true } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: { ...good.data, version: 2 } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: { ...good.data, channel: "other" } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: { ...good.data, app: "crm" } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: { ...good.data, type: "send-mail" } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: { ...good.data, dirty: "yes" } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: { ...good.data, type: "route", path: "https://evil.example/" } }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage({ ...good, data: "ready" }, frame, "mail"), null);
  assert.equal(parseAppBridgeMessage(good, frame, "crm"), null);
  // A message is never authorization: nothing in the host mutates a record or sends mail.
  assert.doesNotMatch(hostSource, /postMessage\(/);
});

test("panel switching retains at most one protected native panel and asks before destroying it", () => {
  const retainable = (id) => Boolean(ownerApp(id)?.retain);
  assert.deepEqual(planPanelSwitch({ current: "mail", next: "mail" }).action, "activate");
  assert.deepEqual(planPanelSwitch({ current: "mail", next: "crm", retained: [], retainable }), {
    action: "retain-and-activate", retain: ["mail"], evict: [], warning: null,
  });
  // A plain application is destroyed on the way out, so nothing runs forever in a hidden frame.
  assert.deepEqual(planPanelSwitch({ current: "crm", next: "support", retained: [], retainable }), {
    action: "retain-and-activate", retain: [], evict: ["crm"], warning: null,
  });
  // Leaving the applications for a read model keeps the mailbox alive.
  assert.deepEqual(planPanelSwitch({ current: "mail", next: null, retained: [], retainable }), {
    action: "retain-and-activate", retain: ["mail"], evict: [], warning: null,
  });
  // A dirty application earns the retained slot, and the protected mailbox then needs an answer.
  const crowded = planPanelSwitch({ current: "crm", next: "support", retained: ["mail"], dirty: ["crm"], retainable });
  assert.equal(crowded.action, "confirm");
  assert.equal(crowded.warning.app, "mail");
  assert.deepEqual(crowded.evict, ["mail"]);
  // A retained application that is not protected is evicted without a question.
  const silent = planPanelSwitch({ current: "crm", next: "support", retained: ["mail"], dirty: ["crm"], retainable: (id) => id === "crm" });
  assert.equal(silent.action, "retain-and-activate");
  assert.deepEqual(silent.evict, ["mail"]);
  assert.deepEqual(silent.retain, ["crm"]);
  assert.equal(MAX_RETAINED_NATIVE_PANELS, 1);
  assert.equal(reloadNeedsConfirmation("mail"), true);
  assert.equal(reloadNeedsConfirmation("crm"), false);
  assert.equal(reloadNeedsConfirmation("crm", { dirty: ["crm"] }), true);
});

/* ------------------------------------------------- mounted shell behaviour */

function mountWorld({ fetchImpl, pathname = "/project/blockwise", options = {} } = {}) {
  resetOwnerSourceCache();
  const { doc, win } = world({ fetchImpl, pathname });
  const root = doc.createElement("section");
  const dispose = mountOwnerDashboard(root, options);
  return { doc, win, root, dispose };
}

test("the mounted workspace rails real links, and no application is framed before authorization", async () => {
  const { root, dispose } = mountWorld({ fetchImpl: async () => jsonResponse(404, null) });
  await dispose.whenSettled();
  const workspace = byDataset(root, "testid", "owner-workspace");
  assert.ok(workspace, "the workspace root is mounted");
  const links = walk(workspace).filter((node) => node.dataset.section !== undefined);
  assert.deepEqual(links.map((link) => link.dataset.section), ["overview", ...OWNER_SECTIONS]);
  assert.equal(links.find((link) => link.dataset.section === "mail").href, "/project/blockwise/mail");
  assert.equal(links.find((link) => link.dataset.section === "overview").getAttribute("aria-current"), "page");
  assert.equal(links.find((link) => link.dataset.section === "crm").getAttribute("aria-current"), null);
  assert.equal(walk(workspace).filter((node) => node.tagName === "IFRAME").length, 0);
  for (const source of OWNER_SOURCES) {
    const tile = byDataset(workspace, "source", source.id);
    assert.equal(tile.dataset.state, "unavailable", `${source.id} reports its missing adapter`);
    assert.match(tile.textContent, /no adapter/i);
  }
  assert.match(workspace.textContent, /no source is connected in this release/);
  assert.match(workspace.textContent, /Declared interface: \/api\/owner\/workspace\/sources\/mail/);
  assert.equal(walk(workspace).filter((node) => node.className.includes("owner-item-count")).length, 0);
  const bar = walk(workspace).find((node) => node.className === "owner-bar-truth");
  assert.match(bar.textContent, /0 of 7 sources connected/);
  dispose();
});

test("a drill-down opens the application panel that owns the record", async () => {
  const payload = {
    status: "attention",
    summary: "Two leads need a follow-up.",
    items: [{ id: "1", label: "Overdue follow-up", count: 2, attention: true, target: { kind: "native-list", app: "crm", path: "/crm/leads?status=Open", label: "Open overdue leads" } }],
  };
  const { win, root, dispose } = mountWorld({
    fetchImpl: async (url) => {
      if (url === "/api/owner/workspace/sources/crm") return jsonResponse(200, payload);
      return jsonResponse(404, null);
    },
  });
  await dispose.whenSettled();
  const workspace = byDataset(root, "testid", "owner-workspace");
  const tile = byDataset(workspace, "source", "crm");
  assert.equal(tile.dataset.state, "attention");
  const count = walk(tile).find((node) => node.className === "owner-item-count");
  assert.equal(count.textContent, "2");
  const link = walk(tile).find((node) => node.dataset.targetKind === "native-list");
  assert.equal(link.href, "/project/blockwise/crm");
  assert.equal(link.dataset.targetPath, "/crm/leads?status=Open");
  link.dispatch("click", { detail: 0 });
  assert.equal(win.history.pushed.length, 1);
  assert.equal(win.history.pushed[0].url, "/project/blockwise/crm");
  assert.equal(win.history.pushed[0].state.ownerSection, "crm");
  await dispose.whenSettled();
  const panel = panelOf(byDataset(root, "testid", "owner-app-host"), "crm");
  assert.ok(panel, "the CRM panel is mounted in the Frank content area");
  assert.equal(panel.dataset.state, "unavailable");
  assert.equal(frameOf(panel), null, "no frame is created without an authorized readiness answer");
  dispose();
});

test("an authorized application is framed in place, and mail survives a switch", async () => {
  const { doc, win } = world({
    fetchImpl: async (url) => {
      if (url.includes("/apps/")) {
        const app = url.includes("/mail/") ? "mail" : url.includes("/crm/") ? "crm" : "support";
        return jsonResponse(200, readinessBody(app));
      }
      return jsonResponse(404, null);
    },
  });
  const appHost = createOwnerAppHost({ document: doc, window: win, fetch: win.fetch });
  const slot = doc.createElement("div");
  appHost.mount(slot);
  appHost.show("mail");
  await appHost.whenSettled();
  const mailFrame = frameOf(panelOf(slot, "mail"));
  assert.equal(mailFrame.src, "https://mail.frank.fail/");
  assert.equal(appHost.panelState("mail"), "ready");
  appHost.show("crm");
  await appHost.whenSettled();
  const mailPanel = panelOf(slot, "mail");
  assert.equal(mailPanel.hidden, true);
  assert.equal(mailPanel.dataset.retained, "true");
  assert.equal(frameOf(mailPanel), mailFrame, "the retained frame is the same live document");
  assert.deepEqual(appHost.retainedIds(), ["mail"]);
  assert.equal(appHost.hasUnsavedWork(), true, "a retained mailbox counts as unsaved work");
  appHost.show("mail");
  await appHost.whenSettled();
  assert.equal(panelOf(slot, "mail").hidden, false);
  assert.equal(frameOf(panelOf(slot, "mail")), mailFrame);
  assert.deepEqual(appHost.retainedIds(), []);
  // A plain application is destroyed on the way out, so nothing is kept forever.
  appHost.show("crm");
  await appHost.whenSettled();
  appHost.show("support");
  await appHost.whenSettled();
  assert.equal(panelOf(slot, "crm"), null);
  assert.equal(appHost.activeApp(), "support");
  appHost.dispose();
});

test("a dirty application triggers the guard before Frank destroys a protected panel", async () => {
  const { doc, win } = world({
    fetchImpl: async (url) => {
      if (url.includes("/apps/")) {
        const app = url.includes("/mail/") ? "mail" : url.includes("/crm/") ? "crm" : "support";
        return jsonResponse(200, readinessBody(app));
      }
      return jsonResponse(404, null);
    },
  });
  const appHost = createOwnerAppHost({ document: doc, window: win, fetch: win.fetch });
  const slot = doc.createElement("div");
  appHost.mount(slot);
  appHost.show("mail");
  await appHost.whenSettled();
  appHost.show("crm");
  await appHost.whenSettled();
  const crmFrame = frameOf(panelOf(slot, "crm"));
  win.dispatch("message", {
    origin: "https://crm.frank.fail",
    source: crmFrame.contentWindow,
    data: { channel: "frank.owner-app", version: 1, app: "crm", type: "dirty", dirty: true },
  });
  assert.deepEqual(appHost.dirtyIds(), ["crm"]);
  assert.equal(appHost.show("support"), false, "the switch waits for the owner");
  assert.equal(appHost.activeApp(), "crm");
  assert.equal(appHost.pendingWarning().kind, "switch");
  assert.equal(appHost.pendingWarning().app, "mail");
  assert.match(byDataset(slot, "testid", "owner-app-host").parentNode.children[0].textContent, /cannot tell whether it saved your work/);
  appHost.cancelPending();
  assert.equal(appHost.activeApp(), "crm");
  assert.equal(appHost.show("support"), false);
  appHost.confirmPending();
  await appHost.whenSettled();
  assert.equal(appHost.activeApp(), "support");
  assert.equal(panelOf(slot, "mail"), null, "the owner confirmed, so the protected panel is closed");
  appHost.dispose();
});

test("the mounted workspace follows an owner route without leaving the workspace", async () => {
  const { win, root, dispose } = mountWorld({ fetchImpl: async () => jsonResponse(404, null), options: { section: "mail" } });
  await dispose.whenSettled();
  const workspace = byDataset(root, "testid", "owner-workspace");
  const mailLink = walk(workspace).find((node) => node.dataset.section === "mail");
  assert.equal(mailLink.getAttribute("aria-current"), "page");
  win.location.pathname = "/project/blockwise/results";
  win.dispatch("popstate", {});
  await dispose.whenSettled();
  assert.equal(walk(root).find((node) => node.dataset.section === "results").getAttribute("aria-current"), "page");
  assert.match(root.textContent, /Lead and channel results against the plan/);
  dispose();
  assert.equal(byDataset(root, "testid", "owner-workspace"), null, "dispose removes the workspace");
  assert.equal(typeof dispose.hasUnsavedWork, "function");
  assert.equal(dispose.hasUnsavedWork(), false);
});

test("the legacy operations shortcut still starts the real workspace host", async () => {
  const { mountOperationsTool } = await import("../web/js/operations-tools.js");
  resetOwnerSourceCache();
  const { doc } = world({ fetchImpl: async () => jsonResponse(404, null) });
  const root = doc.createElement("div");
  const dispose = mountOperationsTool(root);
  assert.equal(typeof dispose, "function");
  await dispose.whenSettled();
  const workspace = byDataset(root, "testid", "owner-workspace");
  assert.ok(workspace, "the legacy shortcut lands on the real workspace, not a launcher");
  assert.equal(walk(workspace).find((node) => node.dataset.section === "overview").getAttribute("aria-current"), "page");
  assert.equal(walk(workspace).filter((node) => node.tagName === "IFRAME").length, 0);
  dispose();
});
