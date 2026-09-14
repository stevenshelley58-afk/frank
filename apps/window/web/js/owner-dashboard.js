// Frank owner workspace: one combined overview plus the native applications
// that own the work.
//
// `/project/blockwise` is the owner-only content host. It renders a combined
// overview of every declared source, routes each summary item to a typed
// drill-down, and shows one native application at a time inside the Frank
// content area through `owner-app-host.js`.
//
// The module never invents a number. A source that is not connected renders an
// explicit unavailable state, a missing count stays missing, and a failed
// source never blanks the rest of the page. Provider data is read only through
// authorized Frank endpoints and is never copied into Frank browser storage.

import { ownerPathForCustomer, ownerPathForSection, routeForPath } from "./view-routing.js";
import { allowedNativePath, createOwnerAppHost, ownerApp } from "./owner-app-host.js";

const PROJECT_ID = "blockwise";
const PROJECT_HOME = "/project/blockwise";
const MAX_ITEMS = 25;
const MAX_ATTENTION_ITEMS = 6;
const OVERVIEW_FRESHNESS_MS = 60000;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const FILTER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SOURCE_STATUSES = new Set(["ready", "recorded", "verified", "empty", "attention", "error", "unavailable"]);
const CONNECTED_STATES = new Set(["ready", "attention", "empty", "cached"]);

// A section is the combined overview, a native application panel, a Frank read
// model with no native interface to frame, or the cross-application customer
// record reached from another summary item. Section ids match the route
// allowlist in view-routing.js; the customer section is reached by deep link
// rather than from the rail.
export const OWNER_SECTION_VIEWS = Object.freeze([
  Object.freeze({ id: "overview", label: "Overview", kind: "overview" }),
  Object.freeze({ id: "mail", label: "Mail", kind: "native", app: "mail" }),
  Object.freeze({ id: "crm", label: "CRM", kind: "native", app: "crm" }),
  Object.freeze({ id: "support", label: "Support", kind: "native", app: "support" }),
  Object.freeze({ id: "campaigns", label: "Email flows", kind: "native", app: "campaigns" }),
  Object.freeze({ id: "revenue", label: "Revenue", kind: "source" }),
  Object.freeze({ id: "results", label: "Results", kind: "source" }),
  Object.freeze({ id: "notifications", label: "Notifications", kind: "source" }),
  Object.freeze({ id: "customer", label: "Customer", kind: "customer", rail: false }),
]);

const SECTION_INDEX = new Map(OWNER_SECTION_VIEWS.map((section) => [section.id, section]));

export function ownerSectionView(id) {
  return SECTION_INDEX.get(String(id || "")) || null;
}

export function ownerRailSections() {
  return OWNER_SECTION_VIEWS.filter((section) => section.rail !== false).map((section) => section.id);
}

// Declared sources. Each entry is one read-model interface owned by the
// projection lane: `endpoint` is the authorized Frank route, `drilldown` is the
// typed destination the owner reaches when the source has nothing to say, and
// `adapter` names what is missing while the interface has no implementation.
export const OWNER_SOURCES = Object.freeze([
  Object.freeze({
    id: "mail",
    label: "Mail",
    app: "mail",
    endpoint: "/api/owner/workspace/sources/mail",
    purpose: "Inbound that still needs a reply.",
    adapter: "the Purelymail mailbox projection",
    drilldown: Object.freeze({ kind: "native-list", app: "mail", path: "/", label: "Open the mailbox" }),
  }),
  Object.freeze({
    id: "crm",
    label: "CRM",
    app: "crm",
    endpoint: "/api/owner/workspace/sources/crm",
    purpose: "Leads and follow-ups that need an owner.",
    adapter: "the Frappe CRM lead projection",
    drilldown: Object.freeze({ kind: "native-list", app: "crm", path: "/crm/leads", label: "Open leads" }),
  }),
  Object.freeze({
    id: "support",
    label: "Support",
    app: "support",
    endpoint: "/api/owner/workspace/sources/support",
    purpose: "Tickets waiting on a reply or an owner.",
    adapter: "the Frappe Helpdesk ticket projection",
    drilldown: Object.freeze({ kind: "native-list", app: "support", path: "/helpdesk/tickets", label: "Open tickets" }),
  }),
  Object.freeze({
    id: "campaigns",
    label: "Email flows",
    app: "campaigns",
    endpoint: "/api/owner/workspace/sources/campaigns",
    purpose: "Sending flows that need attention.",
    adapter: "the Mautic campaign projection",
    drilldown: Object.freeze({ kind: "native-list", app: "campaigns", path: "/s/campaigns", label: "Open campaigns" }),
  }),
  Object.freeze({
    id: "revenue",
    label: "Revenue",
    app: null,
    endpoint: "/api/owner/workspace/sources/revenue",
    purpose: "Payments and renewals that need a decision.",
    adapter: "the Stripe revenue projection",
    drilldown: Object.freeze({ kind: "owner-section", section: "revenue", label: "Open revenue" }),
  }),
  Object.freeze({
    id: "results",
    label: "Results",
    app: null,
    endpoint: "/api/owner/workspace/sources/results",
    purpose: "Lead and channel results against the plan.",
    adapter: "the reporting projection",
    drilldown: Object.freeze({ kind: "owner-section", section: "results", label: "Open results" }),
  }),
  Object.freeze({
    id: "notifications",
    label: "Notifications",
    app: null,
    endpoint: "/api/owner/workspace/sources/notifications",
    purpose: "Alerts raised by the owner services.",
    adapter: "the ntfy alert projection",
    drilldown: Object.freeze({ kind: "owner-section", section: "notifications", label: "Open notifications" }),
  }),
]);

const SOURCE_INDEX = new Map(OWNER_SOURCES.map((source) => [source.id, source]));

export function ownerSource(id) {
  return SOURCE_INDEX.get(String(id || "")) || null;
}

export function customerEndpoint(customerId) {
  return `/api/owner/workspace/customers/${encodeURIComponent(String(customerId || ""))}`;
}

function clip(value, limit = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, limit) : "";
}

export function finiteCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A count is only ever rendered when the source reported one. */
export function countText(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "";
}

/**
 * Validate one typed drill-down target. Frank composes every destination from
 * its own allowlists, so a projection may name an application and a path, never
 * a URL Frank would follow.
 */
export function parseDrilldownTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind || "");
  const label = clip(value.label, 80);
  if (kind === "native-list" || kind === "native-record") {
    const app = ownerApp(value.app);
    if (!app) return null;
    const path = allowedNativePath(app, value.path);
    if (!path) return null;
    return Object.freeze({ kind, app: app.id, section: app.id, path, label: label || app.label });
  }
  if (kind === "owner-section") {
    const section = ownerSectionView(value.section);
    if (!section || section.kind === "customer" || section.kind === "overview") return null;
    const filter = FILTER_ID.test(String(value.filter || "")) ? String(value.filter) : "";
    return Object.freeze({ kind, section: section.id, filter, label: label || section.label });
  }
  if (kind === "owner-record") {
    const customerId = OPAQUE_ID.test(String(value.customerId || "")) ? String(value.customerId) : "";
    if (!customerId) return null;
    return Object.freeze({ kind, section: "customer", customerId, label: label || "Customer overview" });
  }
  return null;
}

/** The Frank address a target opens. Every target stays inside Frank. */
export function targetPath(target) {
  if (!target) return PROJECT_HOME;
  if (target.kind === "owner-record") return ownerPathForCustomer(target.customerId);
  if (target.section) return ownerPathForSection(target.section);
  return PROJECT_HOME;
}

/**
 * Normalize one source payload. Unknown fields are ignored, malformed items are
 * dropped rather than rendered, and a missing count stays null instead of
 * becoming a zero the owner would read as real.
 */
export function normalizeSourcePayload(sourceId, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "invalid_payload", detail: "The source answered with a payload Frank cannot read." };
  }
  const status = SOURCE_STATUSES.has(String(payload.status || "").toLowerCase()) ? String(payload.status).toLowerCase() : "unavailable";
  const generated = payload.generated_at ?? payload.checked_at ?? null;
  let generatedAt = null;
  if (generated !== null && generated !== undefined && generated !== "") {
    const numeric = typeof generated === "number" || (typeof generated === "string" && generated.trim() !== "" && Number.isFinite(Number(generated))) ? Number(generated) : NaN;
    const date = new Date(Number.isFinite(numeric) ? (Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric) : generated);
    if (!Number.isNaN(date.valueOf())) generatedAt = date;
  }
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = [];
  let dropped = 0;
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      dropped += 1;
      continue;
    }
    const label = clip(raw.label ?? raw.title, 120);
    if (!label) {
      dropped += 1;
      continue;
    }
    const target = parseDrilldownTarget(raw.target);
    if (raw.target && !target) dropped += 1;
    items.push(Object.freeze({
      id: clip(raw.id, 120) || label,
      label,
      detail: clip(raw.detail ?? raw.meta, 200),
      count: finiteCount(raw.count),
      attention: raw.attention === true,
      priority: finiteCount(raw.priority) ?? 100,
      target,
      source: sourceId,
    }));
  }
  if (rawItems.length > MAX_ITEMS) dropped += rawItems.length - MAX_ITEMS;
  const rawMetrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const metrics = rawMetrics.slice(0, 6).flatMap((metric) => {
    if (!metric || typeof metric !== "object" || Array.isArray(metric)) return [];
    const label = clip(metric.label, 60);
    const value = finiteCount(metric.value);
    if (!label || value === null) return [];
    return [Object.freeze({ label, value, unit: clip(metric.unit, 16) })];
  });
  return {
    ok: true,
    status,
    generatedAt,
    summary: clip(payload.summary, 240),
    items: Object.freeze(items),
    metrics: Object.freeze(metrics),
    dropped,
  };
}

/** Derive a source state from one HTTP answer, with or without a dated cache. */
export function sourceStateFromResponse(sourceId, httpStatus, payload, { cached = null, checkedAt = new Date() } = {}) {
  const code = Number(httpStatus);
  const fail = (state, reason, detail) => Object.freeze({
    state: cached ? "cached" : state,
    reason,
    detail,
    data: cached?.data || null,
    fetchedAt: cached?.fetchedAt || checkedAt,
    checkedAt,
  });
  if (code === 404 || code === 501) {
    const source = ownerSource(sourceId);
    return fail("unavailable", "adapter_missing", source?.adapter
      ? `Frank has no adapter for ${source.adapter} in this release.`
      : "Frank has no adapter for this source in this release.");
  }
  if (code === 401 || code === 403) {
    return fail("error", "not_authorized", "Frank is not authorized to read this source. Sign in to Frank again, then retry.");
  }
  if (!Number.isFinite(code) || code < 200 || code >= 300) {
    return fail("error", `http_${Number.isFinite(code) ? code : "unknown"}`, `The source answered with HTTP ${Number.isFinite(code) ? code : "an unknown status"}.`);
  }
  const normalized = normalizeSourcePayload(sourceId, payload);
  if (!normalized.ok) return fail("error", normalized.reason, normalized.detail);
  const state = normalized.status === "attention" ? "attention"
    : normalized.status === "empty" ? "empty"
      : normalized.status === "unavailable" ? "unavailable"
        : normalized.status === "error" ? "error" : "ready";
  return Object.freeze({
    state,
    reason: state === "unavailable" ? "source_unavailable" : "",
    detail: state === "unavailable" ? (normalized.summary || "This source reported that it is not available.") : "",
    data: normalized,
    fetchedAt: checkedAt,
    checkedAt,
  });
}

export function sourceStateFromFailure(sourceId, error, { online = true, cached = null, checkedAt = new Date() } = {}) {
  const offline = online === false;
  const message = clip(error?.message, 120);
  return Object.freeze({
    state: cached ? "cached" : "error",
    reason: offline ? "offline" : "check_failed",
    detail: offline
      ? "This device is offline, so Frank cannot check this source."
      : (message ? `The check did not complete: ${message}` : "The check did not complete."),
    data: cached?.data || null,
    fetchedAt: cached?.fetchedAt || checkedAt,
    checkedAt,
  });
}

// In-memory only, for the life of the page. Nothing is written to browser
// storage, and every cached tile is rendered with the time it was read.
const sourceCache = new Map();

export function resetOwnerSourceCache() {
  sourceCache.clear();
}

export function ownerSourceCache() {
  return new Map(sourceCache);
}

export function isConnectedState(value) {
  return CONNECTED_STATES.has(value);
}

/**
 * The combined overview state. With no connected source Frank says so instead
 * of showing an empty board, and an empty attention roll-up always names the
 * sources that could not be read.
 */
export function overviewState(views) {
  const loaded = views.filter((view) => view?.state);
  const connected = loaded.filter((view) => isConnectedState(view.state.state));
  const missing = loaded.filter((view) => !isConnectedState(view.state.state));
  const items = [];
  for (const view of connected) {
    for (const item of view.state.data?.items || []) {
      if (item.attention) items.push(item);
    }
  }
  items.sort((a, b) => (a.priority - b.priority) || a.label.localeCompare(b.label));
  if (!connected.length) {
    return Object.freeze({
      state: "unavailable",
      reason: "no_connected_source",
      detail: "Frank cannot say what needs you, because no source is connected in this release.",
      items: Object.freeze([]),
      missing: Object.freeze(missing.map((view) => view.source.id)),
      connected: Object.freeze([]),
    });
  }
  return Object.freeze({
    state: items.length ? "attention" : "empty",
    reason: items.length ? "" : "no_attention_items",
    detail: items.length ? "" : "Nothing needs you in the sources Frank can read.",
    items: Object.freeze(items.slice(0, MAX_ATTENTION_ITEMS)),
    truncated: items.length > MAX_ATTENTION_ITEMS,
    missing: Object.freeze(missing.map((view) => view.source.id)),
    connected: Object.freeze(connected.map((view) => view.source.id)),
  });
}

/**
 * Resolve the section the workspace opens. Mount options come from app.js and
 * are authoritative; the address bar is the fallback so any caller that mounts
 * the workspace without options still lands on a real section.
 */
export function resolveOwnerRoute({ pathname = PROJECT_HOME, section, customerId } = {}) {
  if (customerId) return Object.freeze({ section: "customer", customerId: OPAQUE_ID.test(String(customerId)) ? String(customerId) : "" });
  if (section && SECTION_INDEX.has(String(section))) return Object.freeze({ section: String(section) });
  const route = routeForPath(pathname);
  if (route.view === "project" && route.projectId === PROJECT_ID) {
    if (route.ownerCustomerId) return Object.freeze({ section: "customer", customerId: route.ownerCustomerId });
    if (route.ownerSection) return Object.freeze({ section: route.ownerSection });
  }
  return Object.freeze({ section: "overview" });
}

export function ownerSectionHref(sectionId, customerId = "") {
  if (sectionId === "customer") return ownerPathForCustomer(customerId);
  if (sectionId === "overview" || !sectionId) return PROJECT_HOME;
  return ownerPathForSection(sectionId);
}

function make(doc, tag, className = "", text = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
  return node;
}

function timestampNode(doc, date) {
  const value = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : null;
  const time = make(doc, "time", "home-timestamp", value
    ? `as of ${value.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "as of an unknown time");
  if (value) time.dateTime = value.toISOString();
  return time;
}

function targetAnchor(doc, target) {
  const link = make(doc, "a", "owner-drilldown", target.label);
  link.href = targetPath(target);
  link.dataset.targetKind = target.kind;
  if (target.section) link.dataset.targetSection = target.section;
  if (target.path) link.dataset.targetPath = target.path;
  link.append(make(doc, "span", "owner-drilldown-go", "→"));
  return link;
}

/**
 * Mount the owner workspace. `mountOwnerDashboard(host, { section, customerId })`
 * returns a dispose function that also reports `hasUnsavedWork()` so a caller
 * can refuse to destroy a native panel that may hold the owner's work.
 */
export function mountOwnerDashboard(host, options = {}) {
  if (!host) return () => {};
  const doc = host.ownerDocument || globalThis.document;
  const win = doc?.defaultView || globalThis.window;
  return createOwnerWorkspace({ doc, win, host, options });
}

function createOwnerWorkspace({ doc, win, host, options }) {
  const state = {
    section: "overview",
    customerId: "",
    previousSection: "overview",
    sourceViews: new Map(),
    filter: "",
    lastOverviewLoad: 0,
    disposed: false,
    controller: null,
    inflight: new Set(),
    heading: null,
    panelNote: null,
    attentionBody: null,
    gridBody: null,
    tileRefs: new Map(),
  };

  const root = make(doc, "div", "owner-workspace");
  root.dataset.testid = "owner-workspace";

  const bar = make(doc, "header", "owner-bar");
  const barText = make(doc, "p", "owner-bar-truth", "Checking sources…");
  barText.setAttribute("role", "status");
  barText.setAttribute("aria-live", "polite");
  const barActions = make(doc, "div", "owner-bar-actions");
  const refresh = make(doc, "button", "owner-action", "Refresh");
  refresh.type = "button";
  refresh.setAttribute("aria-label", "Refresh sources and the open panel");
  barActions.append(refresh);
  bar.append(barText, barActions);

  const body = make(doc, "div", "owner-body");
  const rail = make(doc, "nav", "owner-rail");
  rail.setAttribute("aria-label", "Blockwise sections");
  const railList = make(doc, "ul", "owner-rail-list");
  rail.append(railList);
  const panel = make(doc, "div", "owner-panel");
  const readSlot = make(doc, "div", "owner-panel-read");
  const appSlot = make(doc, "div", "owner-panel-app");
  appSlot.hidden = true;
  panel.append(readSlot, appSlot);
  body.append(rail, panel);
  root.append(bar, body);
  host.replaceChildren(root);

  // The host uses the same fetch the workspace uses, so a test or a caller can
  // inject one transport for both.
  const appHost = createOwnerAppHost({
    document: doc,
    window: win,
    fetch: (input, init) => (win?.fetch || globalThis.fetch)(input, init),
  });
  appHost.mount(appSlot);

  const railLinks = new Map();
  for (const section of OWNER_SECTION_VIEWS) {
    if (section.rail === false) continue;
    const item = make(doc, "li", "owner-rail-item");
    const link = make(doc, "a", "owner-rail-link", section.label);
    link.href = ownerSectionHref(section.id);
    link.dataset.section = section.id;
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showSection(section.id, { push: true, focus: event.detail === 0 });
    });
    railLinks.set(section.id, link);
    item.append(link);
    railList.append(item);
  }

  refresh.addEventListener("click", () => {
    void loadSources({ force: true });
    const activeApp = appHost.activeApp();
    if (activeApp) void appHost.check(activeApp);
  });

  function announce(text) {
    barText.textContent = text;
  }

  function railState() {
    for (const [id, link] of railLinks) {
      if (id === state.section) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  function createTile({ id, label, purpose, drilldown, variant = "" }) {
    const tile = make(doc, "article", `owner-source${variant ? ` ${variant}` : ""}`);
    tile.dataset.source = id;
    tile.dataset.state = "checking";
    const head = make(doc, "header", "owner-source-head");
    const title = make(doc, "h3", "owner-source-title", label);
    const chip = make(doc, "span", "home-status-pill owner-source-chip", "Checking");
    head.append(title, chip);
    const tileBody = make(doc, "div", "owner-source-body");
    tileBody.append(make(doc, "div", "owner-skeleton", ""), make(doc, "div", "owner-skeleton is-short", ""));
    const foot = make(doc, "footer", "owner-source-foot");
    const drill = drilldown ? targetAnchor(doc, drilldown) : null;
    drill?.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openTarget(drilldown, { focus: event.detail === 0, sourceId: id });
    });
    const stamp = make(doc, "span", "owner-source-stamp", "");
    foot.append(...[drill, stamp].filter(Boolean));
    tile.append(head);
    if (purpose) tile.append(make(doc, "p", "owner-source-purpose", purpose));
    tile.append(tileBody, foot);
    return { tile, chip, stamp, body: tileBody, drill };
  }

  function renderTile(refs, viewState) {
    refs.tile.dataset.state = viewState.state;
    refs.chip.textContent = viewState.state === "cached" ? "cached" : viewState.state;
    refs.chip.className = `home-status-pill owner-source-chip status-${viewState.state === "cached" ? "attention" : viewState.state}`;
    refs.stamp.replaceChildren();
    const data = viewState.data;
    if (data) refs.stamp.append(timestampNode(doc, viewState.fetchedAt));
    refs.body.replaceChildren();
    if (!data) {
      refs.body.append(make(doc, "p", "owner-source-empty", viewState.detail || "This source has nothing to report."));
      if (viewState.reason) refs.body.append(make(doc, "p", "owner-source-reason", `Reason: ${viewState.reason}`));
      const retry = make(doc, "button", "owner-action owner-source-retry", "Retry");
      retry.type = "button";
      retry.addEventListener("click", () => void loadSource(ownerSource(refs.tile.dataset.source), { force: true }));
      refs.body.append(retry);
      const source = ownerSource(refs.tile.dataset.source);
      if (viewState.reason === "adapter_missing" && source) {
        refs.body.append(make(doc, "p", "home-truth", `Declared interface: ${source.endpoint}. The source is listed so the owner can see what is missing instead of an invented zero.`));
      }
      return;
    }
    const broken = viewState.state === "unavailable" || viewState.state === "error";
    if (viewState.state === "cached") {
      refs.body.append(make(doc, "p", "owner-source-stale", `The latest check failed: ${viewState.detail || "no answer"}. The values below are the last confirmed read.`));
    }
    if (data.summary) refs.body.append(make(doc, "p", "owner-source-summary", data.summary));
    if (broken) {
      if (!data.summary && viewState.detail) refs.body.append(make(doc, "p", "owner-source-empty", viewState.detail));
      if (viewState.reason) refs.body.append(make(doc, "p", "owner-source-reason", `Reason: ${viewState.reason}`));
      const retry = make(doc, "button", "owner-action owner-source-retry", "Retry");
      retry.type = "button";
      retry.addEventListener("click", () => void loadSource(ownerSource(refs.tile.dataset.source), { force: true }));
      refs.body.append(retry);
      if (viewState.reason === "adapter_missing") {
        const source = ownerSource(refs.tile.dataset.source);
        if (source) refs.body.append(make(doc, "p", "home-truth", `Declared interface: ${source.endpoint}. The source is listed so the owner can see what is missing instead of an invented zero.`));
      }
    } else {
      if (data.metrics.length) {
        const metrics = make(doc, "dl", "owner-metrics");
        for (const metric of data.metrics) {
          const wrap = make(doc, "div", "owner-metric");
          wrap.append(make(doc, "dt", "", metric.label), make(doc, "dd", "", `${metric.value.toLocaleString()}${metric.unit ? ` ${metric.unit}` : ""}`));
          metrics.append(wrap);
        }
        refs.body.append(metrics);
      }
      if (!data.items.length && !data.summary) {
        refs.body.append(make(doc, "p", "owner-source-empty", data.status === "empty" ? "No records are available yet." : "This source reported no items."));
      }
    }
    if (data.items.length) refs.body.append(itemList(data.items));
    if (data.dropped) {
      refs.body.append(make(doc, "p", "home-truth", `${data.dropped} item${data.dropped === 1 ? "" : "s"} could not be shown because Frank could not validate the destination.`));
    }
  }

  function itemList(items) {
    const list = make(doc, "ul", "owner-items");
    for (const item of items) {
      const row = make(doc, "li", "owner-item");
      if (item.attention) row.dataset.attention = "true";
      const line = make(doc, "div", "owner-item-line");
      const count = countText(item.count);
      if (count) line.append(make(doc, "span", "owner-item-count", count));
      if (item.target) {
        const link = targetAnchor(doc, item.target);
        link.classList.add("owner-item-link");
        link.textContent = item.label;
        link.append(make(doc, "span", "owner-drilldown-go", "→"));
        link.addEventListener("click", (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openTarget(item.target, { focus: event.detail === 0, sourceId: item.source });
        });
        line.append(link);
      } else {
        line.append(make(doc, "span", "owner-item-label", item.label));
      }
      if (item.source && item.source !== "customer") line.append(make(doc, "span", "owner-item-source", ownerSource(item.source)?.label || item.source));
      row.append(line);
      if (item.detail) row.append(make(doc, "p", "owner-item-detail", item.detail));
      list.append(row);
    }
    return list;
  }

  function showSection(sectionId, { customerId = "", push = false, focus = false, filter = "", appPath = "", from = "" } = {}) {
    if (state.disposed) return false;
    const section = ownerSectionView(sectionId);
    if (!section) return false;
    if (section.id === "customer" && !OPAQUE_ID.test(String(customerId))) {
      state.previousSection = state.section === "customer" ? state.previousSection : state.section;
      state.section = "customer";
      state.customerId = "";
      renderInvalidCustomer();
      railState();
      return false;
    }
    if (section.kind === "native") {
      const opened = appHost.show(section.app, { path: appPath || null, from });
      if (opened === false) return false; // a protected panel is waiting for the owner's answer
    } else if (appHost.activeApp()) {
      appHost.hideAll();
    }
    state.previousSection = state.section === "customer" ? state.previousSection : state.section;
    state.section = section.id;
    state.customerId = section.id === "customer" ? String(customerId) : "";
    state.filter = FILTER_ID.test(String(filter || "")) ? String(filter) : "";
    if (push) {
      const href = ownerSectionHref(section.id, state.customerId);
      const detail = { view: "blockwise-dashboard", projectId: PROJECT_ID };
      if (section.id !== "overview" && section.id !== "customer") detail.ownerSection = section.id;
      if (section.id === "customer") detail.ownerCustomerId = state.customerId;
      win?.history?.pushState?.(detail, "", href);
    }
    renderPanel({ focus, appPath });
    railState();
    return true;
  }

  function renderPanel({ focus = false, appPath = "" } = {}) {
    const section = ownerSectionView(state.section) || ownerSectionView("overview");
    if (section.kind === "native") {
      readSlot.hidden = true;
      readSlot.replaceChildren();
      appSlot.hidden = false;
      if (focus) appHost.focusHeading();
      return;
    }
    appSlot.hidden = true;
    readSlot.hidden = false;
    readSlot.replaceChildren();
    state.tileRefs = new Map();
    state.attentionBody = null;
    state.gridBody = null;
    state.heading = make(doc, "h2", "owner-panel-title", section.kind === "customer" ? "Customer overview" : section.label);
    state.heading.tabIndex = -1;
    readSlot.append(state.heading);
    if (section.id === "overview") renderOverview(readSlot);
    else if (section.kind === "customer") renderCustomer(readSlot, state.customerId);
    else renderSourcePanel(readSlot, section.id, appPath);
    if (focus) state.heading.focus?.({ preventScroll: true });
  }

  function renderOverview(container) {
    state.panelNote = make(doc, "p", "owner-panel-note", "Frank combines what the connected sources report. Every item opens the record or the filtered list that owns it, and the native application stays authoritative.");
    container.append(state.panelNote);
    const attention = make(doc, "section", "owner-attention");
    attention.dataset.region = "attention";
    attention.setAttribute("aria-label", "What needs you");
    state.attentionBody = make(doc, "div", "owner-attention-body");
    attention.append(make(doc, "h3", "owner-region-title", "What needs you"), state.attentionBody);
    const grid = make(doc, "section", "owner-sources");
    grid.dataset.region = "sources";
    grid.setAttribute("aria-label", "Sources");
    state.gridBody = make(doc, "div", "owner-source-grid");
    grid.append(make(doc, "h3", "owner-region-title", "Sources"), state.gridBody);
    container.append(attention, grid);
    for (const source of OWNER_SOURCES) {
      const refs = createTile({ id: source.id, label: source.label, purpose: source.purpose, drilldown: parseDrilldownTarget(source.drilldown) });
      state.tileRefs.set(source.id, refs);
      state.gridBody.append(refs.tile);
      const view = state.sourceViews.get(source.id);
      if (view) renderTile(refs, view.state);
    }
    renderAttention();
    const stale = Date.now() - state.lastOverviewLoad > OVERVIEW_FRESHNESS_MS;
    if (stale) void loadSources({});
  }

  function renderSourcePanel(container, sourceId, appPath) {
    const source = ownerSource(sourceId);
    state.panelNote = make(doc, "p", "owner-panel-note", source.purpose);
    container.append(state.panelNote);
    if (state.filter) state.panelNote.after(make(doc, "span", "owner-filter-chip", `Filter: ${state.filter}`));
    if (appPath) container.append(make(doc, "p", "owner-panel-from", `Opened from the overview: ${appPath}`));
    const drilldown = parseDrilldownTarget(source.drilldown);
    const refs = createTile({
      id: source.id,
      label: `${source.label} records`,
      // A Frank read model does not link to the panel it is already showing.
      drilldown: drilldown && drilldown.section !== source.id ? drilldown : null,
      variant: "owner-source-panel",
    });
    state.tileRefs.set(source.id, refs);
    container.append(refs.tile);
    const view = state.sourceViews.get(source.id);
    if (view) renderTile(refs, view.state);
    else void loadSource(source, {});
  }

  function renderCustomer(container, customerId) {
    state.panelNote = make(doc, "p", "owner-panel-note", "Cross-application context for one customer, assembled by Frank from the authorized sources. Every line opens the application that owns it.");
    container.append(state.panelNote);
    const backLabel = `Back to ${ownerSectionView(state.previousSection)?.label || "the previous section"}`;
    const backTarget = parseDrilldownTarget({ kind: "owner-section", section: state.previousSection, label: backLabel })
      || parseDrilldownTarget({ kind: "owner-section", section: "crm", label: backLabel });
    const refs = createTile({ id: "customer", label: "Customer", drilldown: backTarget, variant: "owner-source-panel" });
    state.tileRefs.set("customer", refs);
    container.append(refs.tile);
    void loadCustomer(refs, customerId);
  }

  function renderInvalidCustomer() {
    appSlot.hidden = true;
    readSlot.hidden = false;
    readSlot.replaceChildren();
    state.heading = make(doc, "h2", "owner-panel-title", "Customer overview");
    state.heading.tabIndex = -1;
    readSlot.append(state.heading);
    readSlot.append(make(doc, "p", "owner-source-empty", "That customer address is not a valid opaque identifier, so Frank will not request a record for it."));
    const back = make(doc, "a", "owner-action", "Back to the overview");
    back.href = PROJECT_HOME;
    readSlot.append(back);
    state.heading.focus?.({ preventScroll: true });
  }

  function openTarget(target, { focus = false, sourceId = "" } = {}) {
    if (!target) return;
    if (target.kind === "owner-record") {
      showSection("customer", { customerId: target.customerId, push: true, focus });
    } else if (target.kind === "native-list" || target.kind === "native-record") {
      showSection(target.section, { push: true, focus, filter: "", appPath: target.path, from: target.label });
    } else {
      showSection(target.section, { push: true, focus, filter: target.filter });
    }
    if (sourceId) announce(`Opened ${target.label} from ${ownerSource(sourceId)?.label || sourceId}.`);
  }

  async function loadSources({ force = false } = {}) {
    if (state.disposed) return;
    state.lastOverviewLoad = Date.now();
    state.controller?.abort?.();
    state.controller = typeof AbortController === "function" ? new AbortController() : null;
    const results = await Promise.all(OWNER_SOURCES.map((source) => loadSource(source, { force, signal: state.controller?.signal })));
    if (state.disposed) return;
    const connected = results.filter((result) => isConnectedState(result?.state)).length;
    const cached = results.filter((result) => result?.state === "cached").length;
    const newest = results.map((result) => result?.fetchedAt).filter(Boolean).sort((a, b) => b - a)[0];
    const when = newest ? newest.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "an unknown time";
    announce(`${connected} of ${OWNER_SOURCES.length} sources connected${cached ? `, ${cached} from cache` : ""} · checked ${when}`);
  }

  function loadSource(source, options = {}) {
    const running = runLoadSource(source, options).finally(() => state.inflight.delete(running));
    state.inflight.add(running);
    return running;
  }

  async function runLoadSource(source, { force = false, signal = null } = {}) {
    if (!source || state.disposed) return { state: "error" };
    const cached = sourceCache.get(source.id) || null;
    let viewState;
    try {
      const response = await (win?.fetch || globalThis.fetch)(source.endpoint, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: signal || state.controller?.signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      viewState = sourceStateFromResponse(source.id, response.status, payload, { cached, checkedAt: new Date() });
      if (viewState.data && response.ok) sourceCache.set(source.id, { data: viewState.data, fetchedAt: viewState.fetchedAt });
    } catch (error) {
      if (error?.name === "AbortError") return { state: "checking" };
      const online = typeof win?.navigator?.onLine === "boolean" ? win.navigator.onLine : true;
      viewState = sourceStateFromFailure(source.id, error, { online, cached, checkedAt: new Date() });
    }
    if (state.disposed) return viewState;
    state.sourceViews.set(source.id, { source, state: viewState });
    const refs = state.tileRefs.get(source.id);
    if (refs) renderTile(refs, viewState);
    renderAttention();
    return viewState;
  }

  async function loadCustomer(refs, customerId) {
    const render = (viewState) => {
      renderTile(refs, viewState);
      if (!viewState.data) return;
      refs.body.append(make(doc, "p", "home-truth", "Frank shows the record identifiers and status the sources returned. It never copies message bodies or contact details into Frank storage."));
    };
    try {
      const response = await (win?.fetch || globalThis.fetch)(customerEndpoint(customerId), {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      render(sourceStateFromResponse("customer", response.status, payload, { checkedAt: new Date() }));
    } catch (error) {
      const online = typeof win?.navigator?.onLine === "boolean" ? win.navigator.onLine : true;
      render(sourceStateFromFailure("customer", error, { online, checkedAt: new Date() }));
    }
  }

  function renderAttention() {
    const hostNode = state.attentionBody;
    if (!hostNode) return;
    hostNode.replaceChildren();
    const views = OWNER_SOURCES.map((source) => ({ source, state: state.sourceViews.get(source.id)?.state })).filter((view) => view.state);
    if (!views.length) {
      hostNode.append(make(doc, "p", "owner-source-empty", "Checking sources…"));
      return;
    }
    const overview = overviewState(views);
    hostNode.dataset.state = overview.state;
    if (overview.state === "unavailable") {
      hostNode.append(make(doc, "p", "owner-source-empty", overview.detail));
    } else if (!overview.items.length) {
      hostNode.append(make(doc, "p", "owner-source-empty", overview.detail));
    } else {
      hostNode.append(itemList(overview.items));
    }
    if (overview.missing.length) {
      const chips = make(doc, "ul", "owner-chip-list");
      for (const id of overview.missing) {
        const source = ownerSource(id);
        const item = make(doc, "li", "");
        const link = make(doc, "a", "owner-missing-link", `${source.label}: ${state.sourceViews.get(id)?.state?.state || "checking"}`);
        link.href = ownerSectionHref(source.app || source.id);
        link.addEventListener("click", (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          showSection(source.app || source.id, { push: true, focus: event.detail === 0 });
        });
        item.append(link);
        chips.append(item);
      }
      hostNode.append(chips);
      hostNode.append(make(doc, "p", "home-truth", "Frank shows nothing for a source it cannot read instead of a zero."));
    }
  }

  function handleOwnerRoute(event) {
    if (state.disposed) return;
    const detail = event?.detail || {};
    const resolved = resolveOwnerRoute({
      pathname: win?.location?.pathname || PROJECT_HOME,
      section: detail.section ?? detail.ownerSection,
      customerId: detail.customerId ?? detail.ownerCustomerId,
    });
    showSection(resolved.section || "overview", { customerId: resolved.customerId || "", push: false });
  }

  function handlePopState() {
    if (state.disposed || root.isConnected === false) return;
    const resolved = resolveOwnerRoute({ pathname: win?.location?.pathname || PROJECT_HOME });
    showSection(resolved.section || "overview", { customerId: resolved.customerId || "", push: false });
  }

  win?.addEventListener?.("frank:owner-route", handleOwnerRoute);
  win?.addEventListener?.("popstate", handlePopState);

  const initial = resolveOwnerRoute({
    pathname: win?.location?.pathname || PROJECT_HOME,
    section: options.section,
    customerId: options.customerId,
  });
  // Read the sources once on mount so the workspace bar is truthful on every
  // section, deep link included.
  void loadSources({});
  showSection(initial.section || "overview", { customerId: initial.customerId || "", push: false });

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.controller?.abort?.();
    win?.removeEventListener?.("frank:owner-route", handleOwnerRoute);
    win?.removeEventListener?.("popstate", handlePopState);
    appHost.dispose();
    root.remove?.();
  };
  dispose.hasUnsavedWork = () => !state.disposed && appHost.hasUnsavedWork();
  dispose.whenSettled = async () => {
    while (state.inflight.size) await Promise.allSettled([...state.inflight]);
    await appHost.whenSettled();
  };
  return dispose;
}
