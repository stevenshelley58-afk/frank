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
//   * bounded retained state, so a native draft is not destroyed by a switch
//   * the dirty-state guard and the conservative warning before destruction
//
// Nothing here reads an application document, copies application content into
// Frank browser storage, or frames an origin that is not declared below.

export const OWNER_APP_BRIDGE_CHANNEL = "frank.owner-app";
export const OWNER_APP_BRIDGE_VERSION = 1;
export const OWNER_APP_BRIDGE_TYPES = Object.freeze(["ready", "dirty", "route"]);
// Bounded retained state: one hidden native panel, never every app forever.
export const MAX_RETAINED_NATIVE_PANELS = 1;
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
    home: "/",
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
    home: "/crm/leads",
    nativeLabel: "crm.frank.fail",
    retain: false,
  }),
  Object.freeze({
    id: "support",
    label: "Support",
    detail: "Frappe Helpdesk",
    origin: "https://crm.frank.fail",
    pathPrefixes: Object.freeze(["/helpdesk/", "/assets/", "/files/"]),
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
    home: "/s/campaigns",
    nativeLabel: "marketing.frank.fail",
    retain: false,
  }),
]);

const APP_INDEX = new Map(OWNER_APPS.map((app) => [app.id, app]));

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
  return Object.freeze({ type: "ready" });
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
 */
export function planPanelSwitch({ current = null, next = null, retained = [], dirty = [], retainable = null, maxRetained = MAX_RETAINED_NATIVE_PANELS } = {}) {
  const dirtySet = new Set(dirty);
  const isRetainable = (id) => (typeof retainable === "function" ? Boolean(retainable(id)) : false) || dirtySet.has(id);
  const plan = { action: "activate", retain: [], evict: [], warning: null };
  if (!current || current === next) return plan;
  const keep = isRetainable(current) ? [current] : [];
  const after = [...retained.filter((id) => id !== current), ...keep.filter((id) => !retained.includes(id))];
  const evictable = after.filter((id) => !keep.includes(id));
  const evict = [];
  // The outgoing panel is destroyed unless it earned the retained slot, so no
  // application keeps running forever in a hidden frame.
  if (!keep.includes(current)) evict.push(current);
  let overflow = after.length - Math.max(0, Number(maxRetained) || 0);
  for (const id of evictable) {
    if (overflow <= 0) break;
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
  let retainedOrder = [];
  let active = null;
  let pending = null; // { kind: "switch"|"reload", app, next, onConfirm }
  let controller = null;
  let disposed = false;
  let host = null;
  let checkPromise = null;
  let onStateChange = deps.onStateChange || null;

  function frameFor(appId) {
    const entry = panels.get(appId);
    return entry?.frame || null;
  }

  function dirtyIds() {
    return [...dirty.entries()].filter(([, value]) => value).map(([id]) => id);
  }

  function isRetainable(appId) {
    const app = ownerApp(appId);
    return Boolean(app?.retain) || dirty.get(appId) === true;
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
        pending = null;
        action.run();
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
    const entry = { node, body, frame: null, state: "checking", retained: false, checkedAt: null, chip, reload, title, framePath: "" };
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
    const escape = make(doc, "a", "owner-app-escape", `Open ${app.nativeLabel} in a browser tab`);
    escape.href = app.origin + app.home;
    escape.target = "_blank";
    escape.rel = "noopener noreferrer";
    escape.referrerPolicy = "no-referrer";
    row.append(retry, escape);
    box.append(row);
    box.append(make(doc, "p", "home-truth", "Frank never frames an application it has not been authorized to show, and this link leaves Frank and signs in separately."));
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
    checkPromise = runCheck(appId).finally(() => { checkPromise = null; });
    return checkPromise;
  }

  async function runCheck(appId) {
    const app = ownerApp(appId);
    const entry = panels.get(appId);
    if (!app || !entry || disposed) return null;
    controller?.abort?.();
    controller = typeof AbortController === "function" ? new AbortController() : null;
    const signal = controller?.signal;
    entry.state = "checking";
    renderBody(entry, app, { state: "checking" });
    announcement(`Checking ${app.label}.`);
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
    if (state.state === "ready" && state.url) {
      const wanted = entry.requestedPath ? allowedNativeUrl(app.id, entry.requestedPath) : null;
      mountFrame(entry, app, wanted || state.url);
      if (wanted) entry.frame.dataset.path = entry.requestedPath;
      updateChrome(entry, state);
    } else {
      entry.frame?.remove?.();
      entry.frame = null;
      renderBody(entry, app, state);
    }
    announcement(`${app.label}: ${entry.chip.textContent}.`);
    return state;
  }

  function requestReload(appId) {
    const app = ownerApp(appId);
    if (!app) return;
    if (reloadNeedsConfirmation(appId, { dirty: dirtyIds(), retainable: (id) => Boolean(ownerApp(id)?.retain) })) {
      pending = {
        kind: "reload",
        app: appId,
        next: appId,
        run: () => {
          destroyPanel(appId);
          createPanel(app);
          if (active === appId) void check(appId);
        },
      };
      setGuard(guardMessage(app, "reload"), [
        { label: `Keep ${app.label} open`, primary: true, run: () => {} },
        { label: `Reload ${app.label}`, run: () => pending?.run?.() },
      ]);
      return;
    }
    destroyPanel(appId);
    createPanel(app);
    if (active === appId) void check(appId);
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
    active = app.id;
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
    if (!entry.frame || entry.state === "checking") void check(app.id);
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
        retainable: (id) => Boolean(ownerApp(id)?.retain),
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
      retainable: (id) => Boolean(ownerApp(id)?.retain),
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
    active = null;
    return true;
  }

  function handleBridge(event) {
    if (!active || disposed) return;
    const payload = parseAppBridgeMessage(event, frameFor(active), active);
    if (!payload) return;
    bridgeSeen.add(active);
    const entry = panels.get(active);
    if (payload.type === "dirty") {
      dirty.set(active, payload.dirty);
      entry.node.dataset.dirty = payload.dirty ? "true" : "false";
      announcement(payload.dirty ? `${ownerApp(active)?.label} reports unsaved work.` : `${ownerApp(active)?.label} reports no unsaved work.`);
      return;
    }
    if (payload.type === "route" && entry.frame) {
      entry.frame.dataset.path = payload.path;
      announcement(`${ownerApp(active)?.label} moved to ${payload.path}.`);
    }
  }

  function handleOnline() {
    if (disposed) return;
    if (active && ["offline", "error"].includes(panels.get(active)?.state)) void check(active);
    announcement("Connection restored. Frank rechecks the open panel.");
  }

  function handleBeforeUnload(event) {
    if (!hasUnsavedWork()) return;
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
    hasUnsavedWork() {
      if (this.dirtyIds().length) return true;
      return retainedOrder.some((id) => isRetainable(id));
    },
    hideAll,
    whenSettled() {
      return checkPromise ? checkPromise.catch(() => null) : Promise.resolve(null);
    },
    dispose() {
      disposed = true;
      controller?.abort?.();
      controller = null;
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
