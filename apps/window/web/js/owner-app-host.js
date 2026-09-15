// Frank owner workspace — native application panel host.
//
// The owner workspace shows one native application at a time inside the Frank
// content area. This module owns every decision about *whether* an application
// may be shown and what happens to it when the owner moves on:
//
//   * the app allowlist (identifier, origin, allowed path prefixes, work list)
//   * the authorized readiness check (never an iframe `load` event)
//   * the optional app bridge: exact origin, exact source window, version and a
//     schema-validated payload, and never an authorization to send or mutate
//   * preloaded, retained state: every registered application is loaded and kept
//     live from the moment the workspace mounts, so opening a section never
//     starts a readiness check or a native sign-in round trip
//   * the dirty-state guard and the conservative warning before destruction
//
// Nothing here reads an application document, copies application content into
// Frank browser storage, or frames an origin that is not declared below.

export const OWNER_APP_BRIDGE_CHANNEL = "frank.owner-app";
export const OWNER_APP_BRIDGE_VERSION = 1;
export const OWNER_APP_BRIDGE_TYPES = Object.freeze(["ready", "dirty", "route", "session_required"]);
export const MAX_APP_PATH_LENGTH = 512;

// Readiness states a panel can be in. `attention` is reported through the
// status chip of a ready panel rather than as a panel state: a provider that
// needs attention is still a provider Frank may show.
export const PANEL_STATES = Object.freeze([
  "idle", "checking", "ready", "blocked", "unavailable", "unauthorized", "error", "offline",
]);

const DEFAULT_FRAME_BLOCKED_DETAIL =
  "Frank does not allow this address to be shown inside the owner workspace yet.";

// Hostnames come from the frozen owner-workspace brief. `home` is the work list
// the owner normally wants, not a marketing landing page.
export const OWNER_APPS = Object.freeze([
  Object.freeze({
    id: "mail",
    label: "Mail",
    detail: "Owner mailbox",
    origin: "https://mail.frank.fail",
    pathPrefixes: Object.freeze(["/"]),
    // The broker mints the one-use Roundcube session and redirects to its
    // native mail view. Going straight to / would show Roundcube's own login.
    home: "/frank/launch",
    nativeLabel: "mail.frank.fail",
    // Webmail is the one surface where an owner may be mid-draft, so it is the
    // panel Frank preserves across a switch.
    retain: true,
  }),
  Object.freeze({
    id: "crm",
    label: "CRM",
    detail: "Frappe CRM",
    origin: "https://crm.frank.fail",
    pathPrefixes: Object.freeze(["/crm/", "/assets/", "/files/"]),
    // Verified against the installed CRM 1.83.0. A list lives at
    // /crm/<doctype>/view/list and a record at /crm/<doctype>/<name>. Note that
    // /crm/tasks/<id> is deliberately absent: this version renders a blank
    // content area for it rather than a record, so it is not offered.
    lists: Object.freeze([
      "/crm/dashboard",
      "/crm/leads/view/list",
      "/crm/contacts/view/list",
      "/crm/tasks/view/list",
      "/crm/notes/view/list",
      "/crm/deals/view/list",
    ]),
    records: Object.freeze({
      lead: "/crm/leads",
      contact: "/crm/contacts",
      deal: "/crm/deals",
      organization: "/crm/organizations",
      // Task and note records are deliberately absent: this CRM version has no
      // detail route for them, so a link would open a blank content area. Their
      // list screens are allowlisted instead.
    }),
    home: "/crm/leads/view/list",
    nativeLabel: "crm.frank.fail",
    retain: false,
  }),
  Object.freeze({
    id: "support",
    label: "Support",
    detail: "Frappe Helpdesk",
    origin: "https://crm.frank.fail",
    pathPrefixes: Object.freeze(["/helpdesk/", "/assets/", "/files/"]),
    // Verified against the installed Helpdesk 1.30.1.
    lists: Object.freeze([
      "/helpdesk/home",
      "/helpdesk/dashboard",
      "/helpdesk/tickets",
      "/helpdesk/kb",
    ]),
    records: Object.freeze({ ticket: "/helpdesk/tickets" }),
    home: "/helpdesk/tickets",
    nativeLabel: "crm.frank.fail",
    retain: false,
  }),
  Object.freeze({
    id: "campaigns",
    label: "Email flows",
    detail: "Mautic marketing",
    origin: "https://marketing.frank.fail",
    pathPrefixes: Object.freeze(["/s/", "/media/", "/assets/"]),
    // Verified against the installed Mautic 7.2.0.
    lists: Object.freeze(["/s/dashboard", "/s/campaigns", "/s/emails"]),
    records: Object.freeze({ campaign: "/s/campaigns/view", email: "/s/emails/view" }),
    home: "/s/campaigns",
    nativeLabel: "marketing.frank.fail",
    retain: false,
  }),
]);

const APP_INDEX = new Map(OWNER_APPS.map((app) => [app.id, app]));

// Every registered application is preloaded and kept warm from the moment the
// owner workspace mounts, so opening a section never starts a readiness check or
// a native sign-in round trip. `MAX_RETAINED_NATIVE_PANELS` still bounds the
// panels that were never preloaded, so a lazily created panel cannot accumulate
// either; a preloaded one is never destroyed by a switch. See `preload()`.
export const PRELOADED_APP_IDS = Object.freeze(OWNER_APPS.map((app) => app.id));
export const MAX_RETAINED_NATIVE_PANELS = 1;

export function ownerApp(id) {
  return APP_INDEX.get(String(id || "")) || null;
}

export function ownerAppIds() {
  return OWNER_APPS.map((app) => app.id);
}

function unsafePathShape(raw) {
  if (!raw.startsWith("/")) return true;
  if (raw.startsWith("//")) return true; // scheme-relative
  if (raw.includes("\\")) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return true;
  const pathname = raw.split(/[?#]/)[0];
  if (/%2f|%5c/i.test(pathname)) return true; // encoded separators never widen a route
  return false;
}

/**
 * Accept a same-application path only, and return it normalized. Absolute URLs,
 * protocol-relative forms, backslashes, encoded separators and traversal
 * segments are refused, so an allowlisted application can never be used to
 * reach another origin or a route outside its declared prefixes.
 */
export function allowedNativePath(app, path) {
  if (!app) return null;
  const raw = String(path ?? "").trim();
  if (!raw || raw.length > MAX_APP_PATH_LENGTH) return null;
  if (unsafePathShape(raw)) return null;
  if (raw.split(/[?#]/)[0].split("/").includes("..")) return null;
  let url = null;
  try {
    url = new URL(raw, app.origin);
  } catch {
    return null;
  }
  if (url.origin !== app.origin) return null;
  const pathname = url.pathname; // normalized by the URL parser
  const allowed = app.pathPrefixes.some((prefix) => {
    const base = prefix !== "/" && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    if (base === "/") return pathname.startsWith("/");
    return pathname === base || pathname.startsWith(`${base}/`);
  });
  if (!allowed) return null;
  return `${pathname}${url.search}${url.hash}`;
}

export function allowedNativeUrl(appId, path) {
  const app = ownerApp(appId);
  if (!app) return null;
  const safePath = allowedNativePath(app, path);
  if (!safePath) return null;
  try {
    const url = new URL(safePath, app.origin);
    if (url.origin !== app.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Validate one bridge message. A message is only ever a statement about the
 * sending application's own state; it never authorizes a send or a mutation.
 */
export function parseAppBridgeMessage(event, frame, appId) {
  const app = ownerApp(appId);
  if (!app || !event || !frame) return null;
  if (event.origin !== app.origin) return null; // exact origin, never "*" or a suffix match
  let sourceWindow = null;
  try {
    sourceWindow = frame.contentWindow;
  } catch {
    sourceWindow = null;
  }
  if (!sourceWindow || event.source !== sourceWindow) return null; // exact source window
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.channel !== OWNER_APP_BRIDGE_CHANNEL) return null;
  if (data.version !== OWNER_APP_BRIDGE_VERSION) return null;
  if (data.app !== app.id) return null;
  if (!OWNER_APP_BRIDGE_TYPES.includes(data.type)) return null;
  if (data.type === "dirty") {
    if (typeof data.dirty !== "boolean") return null;
    return Object.freeze({ type: "dirty", dirty: data.dirty });
  }
  if (data.type === "route") {
    const path = allowedNativePath(app, data.path);
    if (!path) return null;
    return Object.freeze({ type: "route", path });
  }
  return Object.freeze({ type: data.type });
}

/** Fixed supported native login, never a URL supplied by a frame message. */
export function nativeLoginUrl(appId) {
  const app = ownerApp(appId);
  if (!app) return null;
  if (appId === "mail") return app.origin + "/frank/launch?bridge=1";
  if (appId === "crm" || appId === "support") {
    return app.origin + "/api/method/frank_owner_entry.api.enter?app=" + appId;
  }
  return app.origin + "/frank/connect?app=campaigns";
}

export function readinessEndpoint(appId) {
  return `/api/owner/workspace/apps/${encodeURIComponent(String(appId || ""))}/readiness`;
}

function clippedText(value, limit = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, limit) : "";
}

function panelState(state, extra = {}) {
  return Object.freeze({ state, chip: extra.chip || state, detail: "", reason: "", url: null, status: null, checkedAt: null, ...extra });
}

/**
 * Turn one readiness payload into a panel state. The framing decision is made
 * only from an explicit `ready` + `frameable` pair from the authorized check.
 */
export function panelStateFromReadiness(appId, payload, checkedAt = null) {
  const app = ownerApp(appId);
  if (!app) return panelState("blocked", { reason: "unknown_app", detail: "Frank does not run that application." });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return panelState("unavailable", {
      reason: "no_readiness_payload",
      detail: "Frank could not read a readiness answer for this application.",
      checkedAt,
    });
  }
  const reason = clippedText(payload.reason, 80);
  const detail = clippedText(payload.detail);
  const declaredOrigin = typeof payload.origin === "string" ? payload.origin.trim() : app.origin;
  if (declaredOrigin !== app.origin) {
    return panelState("blocked", {
      chip: "refused",
      reason: "origin_not_allowed",
      detail: "Frank refused to show an address outside the approved origin for this application.",
      checkedAt,
    });
  }
  const path = allowedNativePath(app, typeof payload.path === "string" && payload.path ? payload.path : app.home);
  if (!path) {
    return panelState("blocked", {
      chip: "refused",
      reason: "path_not_allowed",
      detail: "Frank refused to show a route outside this application's approved paths.",
      checkedAt,
    });
  }
  const url = allowedNativeUrl(appId, path);
  if (!url) {
    return panelState("blocked", { chip: "refused", reason: "url_not_allowed", detail: DEFAULT_FRAME_BLOCKED_DETAIL, checkedAt });
  }
  const status = typeof payload.status === "string" ? payload.status.slice(0, 40) : null;
  if (payload.ready === true && payload.frameable === true) {
    return panelState("ready", { chip: status === "attention" ? "attention" : "ready", status, url, reason, checkedAt });
  }
  if (payload.frameable === false) {
    return panelState("blocked", {
      chip: "not shown",
      status,
      reason: reason || "frame_policy",
      detail: detail || DEFAULT_FRAME_BLOCKED_DETAIL,
      checkedAt,
    });
  }
  if (reason === "adapter_missing" || status === "unavailable") {
    return panelState("unavailable", {
      status,
      reason: reason || "adapter_missing",
      detail: detail || "Frank has no adapter for this application in this release.",
      checkedAt,
    });
  }
  return panelState("unavailable", {
    status,
    reason: reason || "not_ready",
    detail: detail || "This application reported that it is not ready to be shown.",
    checkedAt,
  });
}

/** Map an HTTP answer from the readiness route onto a panel state. */
export function panelStateFromResponse(appId, httpStatus, payload, checkedAt = null) {
  const code = Number(httpStatus);
  if (code === 401 || code === 403) {
    return panelState("unauthorized", {
      reason: "not_authorized",
      detail: "Frank is not authorized to check this application. Sign in to Frank again, then check again.",
      checkedAt,
    });
  }
  if (code === 404 || code === 501) {
    return panelState("unavailable", {
      reason: "adapter_missing",
      detail: "No readiness adapter for this application is wired into this release of Frank.",
      checkedAt,
    });
  }
  if (!Number.isFinite(code) || code < 200 || code >= 300) {
    return panelState("error", {
      reason: `http_${Number.isFinite(code) ? code : "unknown"}`,
      detail: `The readiness check failed with HTTP ${Number.isFinite(code) ? code : "an unknown status"}.`,
      checkedAt,
    });
  }
  return panelStateFromReadiness(appId, payload, checkedAt);
}

export function panelStateFromFailure(appId, error, { online = true, checkedAt = null } = {}) {
  if (online === false) {
    return panelState("offline", {
      reason: "offline",
      detail: "This device is offline, so Frank cannot check the application.",
      checkedAt,
    });
  }
  const message = clippedText(error?.message, 120);
  return panelState("error", {
    reason: "check_failed",
    detail: message ? `The readiness check did not complete: ${message}` : "The readiness check did not complete.",
    checkedAt,
  });
}

/**
 * Decide what happens to native panels when the owner moves from one section to
 * another. Pure, so the retention and dirty-state rules are testable without a
 * browser. `retained` is ordered oldest first.
 *
 * `keepAlive` names the preloaded panels. Those are never destroyed by a
 * switch: they are the panels the owner asked Frank to hold live, so the
 * outgoing one is parked instead of torn down.
 */
export function planPanelSwitch({ current = null, next = null, retained = [], dirty = [], retainable = null, keepAlive = null, maxRetained = MAX_RETAINED_NATIVE_PANELS } = {}) {
  const dirtySet = new Set(dirty);
  const isRetainable = (id) => (typeof retainable === "function" ? Boolean(retainable(id)) : false) || dirtySet.has(id);
  const isWarm = (id) => typeof keepAlive === "function" && Boolean(keepAlive(id));
  const plan = { action: "activate", retain: [], evict: [], warning: null };
  if (!current || current === next) return plan;
  const keep = isRetainable(current) ? [current] : [];
  const after = [...retained.filter((id) => id !== current), ...keep.filter((id) => !retained.includes(id))];
  const evictable = after.filter((id) => !keep.includes(id));
  const evict = [];
  // A preloaded application stays live. Anything else is destroyed unless it
  // earned the retained slot, so no application keeps running forever in a
  // hidden frame.
  if (!keep.includes(current) && !isWarm(current)) evict.push(current);
  let overflow = after.filter((id) => !isWarm(id)).length - Math.max(0, Number(maxRetained) || 0);
  for (const id of evictable) {
    if (overflow <= 0) break;
    if (isWarm(id)) continue;
    evict.push(id);
    overflow -= 1;
  }
  const evictedProtected = evict.filter((id) => isRetainable(id));
  plan.retain = keep;
  plan.evict = evict;
  if (evictedProtected.length) {
    plan.action = "confirm";
    plan.warning = Object.freeze({
      reason: "protected-panel",
      app: evictedProtected[0],
      next,
      evicted: Object.freeze([...evict]),
    });
  } else if (keep.length || evict.length) {
    plan.action = "retain-and-activate";
  }
  return plan;
}

/** The panel a reload would destroy is protected when it may hold unsaved work. */
export function reloadNeedsConfirmation(appId, { dirty = [], retainable = null } = {}) {
  const app = ownerApp(appId);
  if (!app) return false;
  if (dirty.includes(appId)) return true;
  return typeof retainable === "function" ? Boolean(retainable(appId)) : Boolean(app.retain);
}

function make(doc, tag, className = "", text = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
  return node;
}

/** One shared warning for every path that would destroy a protected panel. */
function guardMessage(app, action, nextLabel = "") {
  const label = app?.label || "The open panel";
  if (action === "reload") return `${label} is open and Frank cannot tell whether it has saved your work. Reloading closes it and starts again.`;
  if (action === "hide") return `${label} is open in the background and Frank cannot tell whether it saved your work. Frank needs that slot for another application.`;
  return `${label} is open in the background and Frank cannot tell whether it saved your work. Opening ${nextLabel || "another application"} closes it.`;
}

/**
 * Create the panel host. Every collaborator is injectable so the component can
 * be driven by tests without a browser.
 */
export function createOwnerAppHost(deps = {}) {
  const doc = deps.document || globalThis.document;
  const win = deps.window || globalThis.window;
  const fetchImpl = deps.fetch || ((input, init) => globalThis.fetch(input, init));
  const isOnline = deps.isOnline || (() => (typeof win?.navigator?.onLine === "boolean" ? win.navigator.onLine : true));
  const now = deps.now || (() => new Date());

  const region = make(doc, "div", "owner-app-host");
  region.dataset.testid = "owner-app-host";

  const guard = make(doc, "div", "owner-app-guard");
  guard.hidden = true;
  guard.setAttribute("role", "alert");

  const panels = new Map(); // appId -> { node, body, frame, state, retained, checkedAt }
  const dirty = new Map(); // appId -> boolean, from the app bridge only
  const bridgeSeen = new Set();
  const inflight = new Set(); // every readiness check that has not settled yet
  let retainedOrder = [];
  let active = null;
  let pending = null; // { kind: "switch"|"reload", app, next, onConfirm }
  let disposed = false;
  let approvedNativeNavigation = false;
  let host = null;
  let onStateChange = deps.onStateChange || null;

  function frameFor(appId) {
    const entry = panels.get(appId);
    return entry?.frame || null;
  }

  /**
   * Which panel a bridge message came from. Preloading means several panels are
   * live at once, so the sender is resolved from the frame that owns the source
   * window rather than assumed to be the visible one.
   */
  function appForBridgeSource(source) {
    if (!source) return null;
    for (const [id, entry] of panels) {
      let frameWindow = null;
      try {
        frameWindow = entry.frame?.contentWindow || null;
      } catch {
        frameWindow = null;
      }
      if (frameWindow && frameWindow === source) return id;
    }
    return null;
  }

  function dirtyIds() {
    return [...dirty.entries()].filter(([, value]) => value).map(([id]) => id);
  }

  function isRetainable(appId) {
    const app = ownerApp(appId);
    return Boolean(app?.retain && panels.get(appId)?.state === "ready") || dirty.get(appId) === true;
  }

  /** A panel the host loaded ahead of the owner reaching it. */
  function isWarm(appId) {
    return panels.get(appId)?.preloaded === true;
  }

  /**
   * A panel is protected only once the owner has taken it up, or when it reports
   * unsaved work. Preloaded panels sit in the background from the moment the
   * workspace mounts, and counting those would make every unload warn about a
   * mailbox nobody opened.
   */
  function isProtected(appId) {
    if (dirty.get(appId) === true) return true;
    return Boolean(panels.get(appId)?.activated) && isRetainable(appId);
  }

  function announcement(text) {
    if (typeof onStateChange === "function") onStateChange({ active, text });
  }

  function setGuard(message, actions) {
    guard.replaceChildren();
    if (!message) {
      guard.hidden = true;
      return;
    }
    const copy = make(doc, "p", "owner-app-guard-copy", message);
    const row = make(doc, "div", "owner-app-guard-actions");
    for (const action of actions) {
      const button = make(doc, "button", action.primary ? "owner-app-guard-primary" : "owner-app-guard-secondary", action.label);
      button.type = "button";
      button.addEventListener("click", () => {
        setGuard(null, []);
        try { action.run(); } finally { pending = null; }
      });
      row.append(button);
    }
    guard.append(copy, row);
    guard.hidden = false;
    row.querySelector?.("button")?.focus?.({ preventScroll: true });
  }

  function cancelPending() {
    pending = null;
    setGuard(null, []);
  }

  function destroyPanel(appId) {
    const entry = panels.get(appId);
    if (!entry) return;
    entry.node.remove?.();
    panels.delete(appId);
    retainedOrder = retainedOrder.filter((id) => id !== appId);
    announcement(`${ownerApp(appId)?.label || appId} panel closed.`);
  }

  function retainPanel(appId) {
    const entry = panels.get(appId);
    if (!entry) return;
    entry.retained = true;
    entry.node.hidden = true;
    entry.node.dataset.retained = "true";
    entry.frame?.setAttribute?.("aria-hidden", "true");
    entry.frame?.setAttribute?.("tabindex", "-1");
    retainedOrder = [...retainedOrder.filter((id) => id !== appId), appId];
  }

  function activatePanel(appId) {
    const entry = panels.get(appId);
    if (!entry) return;
    entry.retained = false;
    entry.node.hidden = false;
    delete entry.node.dataset.retained;
    entry.frame?.removeAttribute?.("aria-hidden");
    entry.frame?.removeAttribute?.("tabindex");
    retainedOrder = retainedOrder.filter((id) => id !== appId);
  }

  /**
   * Park the panel that is being replaced. The host still shows one application
   * at a time, and a warm panel is parked rather than destroyed, so hiding it is
   * what keeps the workspace honest while the document stays alive.
   */
  function parkActive() {
    if (!active || !panels.has(active)) return;
    retainPanel(active);
  }

  function createPanel(app) {
    const node = make(doc, "section", "owner-app-panel");
    node.dataset.app = app.id;
    node.dataset.state = "checking";
    node.setAttribute("aria-labelledby", `owner-app-title-${app.id}`);
    const bar = make(doc, "header", "owner-app-bar");
    const ident = make(doc, "div", "owner-app-ident");
    const title = make(doc, "h2", "owner-app-title", app.label);
    title.id = `owner-app-title-${app.id}`;
    title.tabIndex = -1;
    const truth = make(doc, "p", "owner-app-source", `${app.detail} · ${app.nativeLabel}`);
    ident.append(title, truth);
    const actions = make(doc, "div", "owner-app-actions");
    const chip = make(doc, "span", "home-status-pill owner-app-chip", "Checking");
    chip.setAttribute("role", "status");
    chip.setAttribute("aria-live", "polite");
    const reload = make(doc, "button", "owner-app-action", "Reload panel");
    reload.type = "button";
    reload.addEventListener("click", () => requestReload(app.id));
    actions.append(chip, reload);
    bar.append(ident, actions);
    const body = make(doc, "div", "owner-app-body");
    node.append(bar, body);
    const entry = { node, body, frame: null, state: "checking", retained: false, checkedAt: null, chip, reload, title, framePath: "", controller: null, activated: false, preloaded: false };
    panels.set(app.id, entry);
    region.append(node);
    return entry;
  }

  function updateChrome(entry, state) {
    entry.node.dataset.state = state.state;
    entry.chip.textContent = state.chip || state.state;
    entry.chip.className = `home-status-pill owner-app-chip status-${state.state === "ready" ? (state.status || "ready") : state.state}`;
    entry.reload.disabled = state.state === "checking";
  }

  function renderBody(entry, app, state) {
    entry.body.replaceChildren();
    updateChrome(entry, state);
    const box = make(doc, "div", "operate-empty owner-app-state");
    if (state.state === "checking") {
      box.append(make(doc, "strong", "", `Checking ${app.label}…`), make(doc, "span", "", "Frank asks the server whether this application can be shown here."));
      entry.body.append(box);
      return;
    }
    if (state.state === "ready") {
      const heading = make(doc, "strong", "", `${app.label} is open in Frank.`);
      const note = make(doc, "span", "", state.status === "attention" ? "The source reported attention. The application stays authoritative." : "The native application stays authoritative for this work.");
      box.append(heading, note);
      entry.body.append(box);
      return;
    }
    const titles = {
      blocked: `${app.label} is not shown inside Frank yet.`,
      unavailable: `${app.label} is not enabled in this release.`,
      unauthorized: `Frank is not authorized to show ${app.label}.`,
      error: `Frank could not check ${app.label}.`,
      offline: `You are offline, so ${app.label} cannot be checked.`,
    };
    box.append(make(doc, "strong", "", titles[state.state] || `${app.label} is unavailable.`));
    if (state.detail) box.append(make(doc, "span", "", state.detail));
    if (state.reason) box.append(make(doc, "span", "owner-app-reason", `Reason: ${state.reason}`));
    const row = make(doc, "div", "owner-app-state-actions");
    const retry = make(doc, "button", "owner-app-action", "Check again");
    retry.type = "button";
    retry.addEventListener("click", () => check(app.id));
    const connect = make(doc, "button", "owner-app-action", "Connect inside Frank");
    connect.type = "button";
    connect.addEventListener("click", () => connectNative(app.id, true));
    row.append(retry, connect);
    box.append(row);
    entry.body.append(box);
  }

  function mountFrame(entry, app, url) {
    if (entry.frame && entry.frame.src === url) return;
    const frame = make(doc, "iframe", "owner-app-frame");
    frame.title = `${app.label} (${app.nativeLabel})`;
    frame.setAttribute("data-app", app.id);
    // No `sandbox`: the native application must keep its own cookies, CSRF
    // tokens, redirects, assets, attachments and streaming. Framing is allowed
    // by the ingress only for approved Frank parent origins, which the identity
    // package owns; nothing here widens that.
    frame.src = url;
    entry.frame?.remove?.();
    entry.frame = frame;
    entry.body.replaceChildren(frame);
  }

  function check(appId) {
    const run = runCheck(appId).finally(() => { inflight.delete(run); });
    inflight.add(run);
    return run;
  }

  /**
   * Load and keep every registered native application warm.
   *
   * Called as soon as the owner workspace mounts, so opening a section lands on
   * an already-checked panel instead of starting a readiness check and a native
   * sign-in round trip. Panels are parked, not shown: nothing here changes which
   * application the owner is looking at.
   */
  function preload() {
    if (disposed) return Promise.resolve([]);
    const runs = [];
    for (const app of OWNER_APPS) {
      if (!panels.has(app.id)) createPanel(app);
      panels.get(app.id).preloaded = true;
      retainPanel(app.id);
      runs.push(check(app.id));
    }
    return Promise.allSettled(runs);
  }

  async function runCheck(appId) {
    const app = ownerApp(appId);
    const entry = panels.get(appId);
    if (!app || !entry || disposed) return null;
    // Each panel owns its abort handle: preloading checks every application at
    // once, and one panel's check must never cancel another's.
    entry.controller?.abort?.();
    entry.controller = typeof AbortController === "function" ? new AbortController() : null;
    const signal = entry.controller?.signal;
    entry.state = "checking";
    renderBody(entry, app, { state: "checking" });
    // Preloading checks every panel at once; only the visible one may speak for
    // the workspace bar.
    if (appId === active) announcement(`Checking ${app.label}.`);
    let state;
    try {
      const response = await fetchImpl(readinessEndpoint(app.id), {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      state = panelStateFromResponse(app.id, response.status, payload, now());
    } catch (error) {
      if (error?.name === "AbortError") return null;
      state = panelStateFromFailure(app.id, error, { online: isOnline(), checkedAt: now() });
    }
    if (disposed || panels.get(appId) !== entry) return null;
    entry.state = state.state;
    entry.checkedAt = state.checkedAt;
    entry.node.dataset.reason = state.reason || "";
    if (state.reason === "owner_session_required" || (state.state === "ready" && state.url)) {
      entry.state = "checking";
      mountFrame(entry, app, app.origin + "/frank/bridge?app=" + app.id);
      updateChrome(entry, {state: "checking", chip: "Connecting"});
    } else {
      entry.frame?.remove?.();
      entry.frame = null;
      renderBody(entry, app, state);
    }
    if (appId === active) announcement(`${app.label}: ${entry.chip.textContent}.`);
    return state;
  }

  /**
   * A warm background panel that needs a native sign-in is parked, never
   * navigated: the sign-in round trip leaves Frank, so it is only offered once
   * the owner actually opens that section.
   */
  function markNeedsConnection(appId) {
    const entry = panels.get(appId);
    if (!entry) return;
    entry.state = "blocked";
    // The bridge frame has done its job and reported that it needs a sign-in.
    // Dropping it means opening the section later re-runs the check and can
    // offer the same-tab sign-in round trip.
    entry.frame?.remove?.();
    entry.frame = null;
    renderBody(entry, ownerApp(appId), {
      state: "blocked",
      chip: "Needs connection",
      reason: "owner_session_required",
      detail: "Frank needs to sign this application in. Open the section to connect.",
    });
  }

  function connectNative(appId, explicit = false) {
    const url = nativeLoginUrl(appId);
    if (!url) return;
    const key = "frank.native-connect." + appId;
    const previous = Number(win.sessionStorage?.getItem(key) || 0);
    if (!explicit && Date.now() - previous < 60000) {
      const entry = panels.get(appId);
      entry.state = "blocked";
      renderBody(entry, ownerApp(appId), {
        state: "blocked", chip: "Needs connection",
        detail: "The application did not finish signing in. Try connecting again.",
      });
      return;
    }
    const run = () => {
      win.sessionStorage?.setItem(key, String(Date.now()));
      // The workspace warning was explicitly accepted (or no panel needed it).
      approvedNativeNavigation = true;
      win.location.assign(url);
      win.setTimeout?.(() => {
        approvedNativeNavigation = false;
        const entry = panels.get(appId);
        if (!disposed && entry?.state === "checking") {
          entry.state = "blocked";
          renderBody(entry, ownerApp(appId), {
            state: "blocked", chip: "Needs connection",
            detail: "Sign-in did not finish. Choose Connect inside Frank to try again.",
          });
        }
      }, 12000);
    };
    if (hasUnsavedWork()) {
      setGuard("Connecting will briefly leave Frank. Save any open draft first.", [
        {label: "Stay here", primary: true, run: () => {}},
        {label: "Continue sign-in", run},
      ]);
    } else run();
  }

  function requestReload(appId) {
    const app = ownerApp(appId);
    if (!app) return;
    // A reload replaces the panel, so the replacement inherits the owner's claim
    // on it: the mailbox the owner asked to reload is still the mailbox Frank
    // must not discard silently on the way out.
    const reopen = () => {
      const wasPreloaded = isWarm(appId);
      destroyPanel(appId);
      const replacement = createPanel(app);
      replacement.activated = true;
      replacement.preloaded = wasPreloaded;
      if (active === appId) void check(appId);
    };
    if (reloadNeedsConfirmation(appId, { dirty: dirtyIds(), retainable: isProtected })) {
      pending = { kind: "reload", app: appId, next: appId, run: reopen };
      setGuard(guardMessage(app, "reload"), [
        { label: `Keep ${app.label} open`, primary: true, run: () => {} },
        { label: `Reload ${app.label}`, run: () => pending?.run?.() },
      ]);
      return;
    }
    reopen();
  }

  function applyPlan(plan) {
    for (const id of plan.evict) destroyPanel(id);
    for (const id of plan.retain) retainPanel(id);
  }

  function activate(app, { path = null, from = "" } = {}) {
    if (!panels.has(app.id)) createPanel(app);
    const entry = panels.get(app.id);
    if (from) entry.node.dataset.from = from;
    else delete entry.node.dataset.from;
    // The panel being replaced is parked, not destroyed: a preloaded application
    // must still be live when the owner comes back to it.
    if (active && active !== app.id) parkActive();
    active = app.id;
    entry.activated = true;
    activatePanel(app.id);
    // A requested drill-down path is applied to the panel; without one the
    // panel opens its own work list. Nothing is stored: the path only lives in
    // the panel, so a refresh lands on the application's own default view.
    if (path) entry.requestedPath = path;
    if (entry.frame && entry.requestedPath && entry.frame.dataset.path !== entry.requestedPath) {
      const url = allowedNativeUrl(app.id, entry.requestedPath);
      if (url) {
        entry.frame.dataset.path = entry.requestedPath;
        entry.frame.src = url;
      }
    }
    // Opening a section must not restart work that preloading already did: a warm
    // panel keeps its live frame and its in-flight session request. A panel with
    // no frame is checked, which is how a parked panel that needs a native
    // sign-in is retried.
    if (!entry.frame || (entry.state === "checking" && !isWarm(app.id))) void check(app.id);
    announcement(`${app.label} panel opened.`);
    return true;
  }

  function show(appId, { path = null, from = "" } = {}) {
    const app = ownerApp(appId);
    if (!app || disposed) return false;
    if (!panels.has(appId)) createPanel(app);

    if (active && active !== appId) {
      const plan = planPanelSwitch({
        current: active,
        next: appId,
        retained: [...retainedOrder],
        dirty: dirtyIds(),
        retainable: isRetainable,
        keepAlive: isWarm,
      });
      if (plan.action === "confirm") {
        const protectedApp = ownerApp(plan.warning.app);
        // The approved plan is applied on confirmation, never re-derived: the
        // same answer must not be asked twice.
        pending = {
          kind: "switch",
          app: plan.warning.app,
          next: appId,
          run: () => {
            applyPlan(plan);
            activate(app, { path, from });
          },
        };
        setGuard(guardMessage(protectedApp, "switch", app.label), [
          { label: `Keep ${protectedApp?.label || "it"} open`, primary: true, run: () => {} },
          { label: `Close ${protectedApp?.label || "it"} and open ${app.label}`, run: () => pending?.run?.() },
        ]);
        return false;
      }
      applyPlan(plan);
    } else if (active === appId) {
      activatePanel(appId);
      return true;
    }
    return activate(app, { path, from });
  }

  function hideAll() {
    if (!active) return true;
    const leaving = active;
    const plan = planPanelSwitch({
      current: leaving,
      next: null,
      retained: [...retainedOrder],
      dirty: dirtyIds(),
      retainable: isRetainable,
      keepAlive: isWarm,
    });
    if (plan.action === "confirm") {
      pending = { kind: "hide", app: plan.warning.app, next: null, run: () => { applyPlan(plan); active = null; } };
      setGuard(guardMessage(ownerApp(plan.warning.app), "hide"), [
        { label: `Keep ${ownerApp(plan.warning.app)?.label || "it"} open`, primary: true, run: () => {} },
        { label: "Close it and continue", run: () => pending?.run?.() },
      ]);
      return false;
    }
    applyPlan(plan);
    // Leaving the applications for a read model parks the open panel. A warm
    // panel is not destroyed by the plan, so it must still be hidden: the host
    // shows one application at a time.
    if (!plan.evict.includes(leaving)) parkActive();
    active = null;
    return true;
  }

  function handleBridge(event) {
    if (disposed) return;
    const appId = appForBridgeSource(event.source);
    if (!appId) return;
    const payload = parseAppBridgeMessage(event, frameFor(appId), appId);
    if (!payload) return;
    bridgeSeen.add(appId);
    const entry = panels.get(appId);
    if (!entry) return;
    const label = ownerApp(appId)?.label || appId;
    const visible = appId === active;
    if (payload.type === "session_required") {
      // Only the panel the owner is looking at may leave Frank for a sign-in
      // round trip; a warm background panel is parked until it is opened.
      if (visible) connectNative(appId);
      else markNeedsConnection(appId);
      return;
    }
    if (payload.type === "ready") {
      entry.state = "ready";
      const app = ownerApp(appId);
      win.sessionStorage?.removeItem("frank.native-connect." + appId);
      mountFrame(entry, app, allowedNativeUrl(appId, entry.requestedPath || (appId === "mail" ? "/" : app.home)));
      updateChrome(entry, {state: "ready", chip: "Connected"});
      if (visible) announcement(`${label}: Connected.`);
      return;
    }
    if (payload.type === "dirty") {
      dirty.set(appId, payload.dirty);
      entry.node.dataset.dirty = payload.dirty ? "true" : "false";
      announcement(payload.dirty ? `${label} reports unsaved work.` : `${label} reports no unsaved work.`);
      return;
    }
    if (payload.type === "route" && entry.frame) {
      entry.frame.dataset.path = payload.path;
      if (visible) announcement(`${label} moved to ${payload.path}.`);
    }
  }

  function handleOnline() {
    if (disposed) return;
    if (active && ["offline", "error"].includes(panels.get(active)?.state)) void check(active);
    announcement("Connection restored. Frank rechecks the open panel.");
  }

  /**
   * Whether the host is holding work that only the application can save.
   *
   * Defined in the closure rather than on the returned API because the unload
   * guard needs it too: it previously existed only as a method on the returned
   * object, so `handleBeforeUnload` referenced a name that was not in scope and
   * threw on every unload, which disabled the guard entirely.
   */
  function hasUnsavedWork() {
    if (dirtyIds().length) return true;
    // A panel the owner has actually opened counts too. Leaving the workspace
    // destroys the live panel, so an open retainable application (the mailbox)
    // is exactly the case the warning exists for. A preloaded panel the owner
    // never reached does not, or every unload would warn about a mailbox nobody
    // opened.
    if (active && isProtected(active)) return true;
    return retainedOrder.some((id) => isProtected(id));
  }

  function handleBeforeUnload(event) {
    if (approvedNativeNavigation || !hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = "";
    return "";
  }

  return {
    element: region,
    mount(target) {
      host = target;
      host.replaceChildren(guard, region);
      win?.addEventListener?.("message", handleBridge);
      win?.addEventListener?.("online", handleOnline);
      win?.addEventListener?.("beforeunload", handleBeforeUnload);
      return this;
    },
    show,
    preload,
    reload: requestReload,
    check,
    focusHeading() {
      const entry = active ? panels.get(active) : null;
      entry?.title?.focus?.({ preventScroll: true });
    },
    cancelPending,
    pendingWarning() {
      if (!pending) return null;
      return Object.freeze({ kind: pending.kind, app: pending.app || null, next: pending.next || null });
    },
    confirmPending() {
      const action = pending?.run;
      pending = null;
      setGuard(null, []);
      if (typeof action === "function") action();
    },
    panelState(appId) {
      return panels.get(appId)?.state || "idle";
    },
    preloadedIds() {
      return [...panels.entries()].filter(([, entry]) => entry.preloaded).map(([id]) => id);
    },
    retainedIds() {
      return [...retainedOrder];
    },
    dirtyIds() {
      return [...dirty.entries()].filter(([, value]) => value).map(([id]) => id);
    },
    bridgeSeen(appId) {
      return bridgeSeen.has(appId);
    },
    activeApp() {
      return active;
    },
    hasUnsavedWork,
    hideAll,
    whenSettled() {
      return inflight.size ? Promise.allSettled([...inflight]).then(() => null) : Promise.resolve(null);
    },
    dispose() {
      disposed = true;
      for (const entry of panels.values()) entry.controller?.abort?.();
      win?.removeEventListener?.("message", handleBridge);
      win?.removeEventListener?.("online", handleOnline);
      win?.removeEventListener?.("beforeunload", handleBeforeUnload);
      panels.clear();
      retainedOrder = [];
      dirty.clear();
      active = null;
      region.remove?.();
      guard.remove?.();
    },
  };
}

/**
 * The allowlisted path for one native record, or null.
 *
 * The record kind and identifier are both checked here rather than in the
 * caller, so a caller cannot build a path the application did not declare.
 * Identifiers are validated against a conservative grammar and encoded, so a
 * crafted identifier cannot add a segment or escape the declared prefix.
 */
export function nativeRecordPath(appId, kind, identifier) {
  const app = ownerApp(appId);
  if (!app || !app.records) return null;
  const prefix = app.records[String(kind || "")];
  if (!prefix) return null;
  const value = String(identifier || "").trim();
  // Real records carry names, not slugs: the installed CRM serves
  // /crm/contacts/John%20Doe. So a space and a few ordinary name characters are
  // allowed and then percent-encoded. Everything that could act as a separator,
  // a scheme, a traversal segment or a control character is still refused, and
  // the value is encoded rather than concatenated, so it can never add a path
  // segment or escape the declared prefix.
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'+()-]{0,127}$/u.test(value)) return null;
  if (value.includes("..") || value.includes("/") || value.includes("\\")) return null;
  return `${prefix}/${encodeURIComponent(value)}`;
}

/** The allowlisted path for one native list screen, or null. */
export function nativeListPath(appId, which) {
  const app = ownerApp(appId);
  if (!app) return null;
  const wanted = String(which || "");
  if (app.lists && app.lists.includes(wanted)) return wanted;
  if (wanted === "home" || wanted === "") return app.home;
  return null;
}
