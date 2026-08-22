const $ = (selector, root = document) => root.querySelector(selector);
import { mountGraphWorkbench } from "../graph/graph-workbench.bundle.js";
import { mountMemoryInspector } from "./memory-inspector.js";

const graphMounts = new WeakMap();

function destroyGraphMount(body) {
  const handle = graphMounts.get(body);
  if (!handle) return;
  try { handle.destroy?.(); } finally { graphMounts.delete(body); }
}

function destroyGraphMounts(root) {
  if (!root) return;
  root.querySelectorAll?.(".home-widget-body").forEach(destroyGraphMount);
}

const homeState = {
  generation: 0,
  controller: null,
  home: null,
  draft: [],
  catalog: [],
  connections: [],
  editing: false,
  gallery: false,
  host: null,
  savePending: false,
  refreshTimer: null,
  grid: null,
  memoryInspector: null,
  memoryOpen: false,
};

const PROJECT_GRID_COLUMNS = 12;
const PROJECT_DEFAULT_LAYOUTS = {
  "project-signal": { x: 0, y: 0, w: 4, h: 2 },
  "accounts-summary": { x: 4, y: 0, w: 2, h: 2 },
  "connections-summary": { x: 6, y: 0, w: 2, h: 2 },
  "repository-pulse": { x: 8, y: 0, w: 4, h: 2 },
  "project-attention": { x: 0, y: 2, w: 5, h: 3 },
  "project-activity": { x: 5, y: 2, w: 4, h: 3 },
  "project-quick-paths": { x: 9, y: 2, w: 3, h: 3 },
};

function isProjectHome() {
  return homeState.home?.entity?.kind === "project";
}

function destroyHomeGrid() {
  destroyGraphMounts(homeState.host);
  if (!homeState.grid) return;
  homeState.grid.destroy(false);
  homeState.grid = null;
}

function projectLayout(instance) {
  if (instance?.layout && ["x", "y", "w", "h"].every((key) => Number.isInteger(instance.layout[key]))) {
    return { ...instance.layout };
  }
  if (PROJECT_DEFAULT_LAYOUTS[instance?.widget_id]) return { ...PROJECT_DEFAULT_LAYOUTS[instance.widget_id] };
  const width = instance?.size === "wide" ? 12 : instance?.size === "small" ? 3 : 6;
  return { x: 0, y: 0, w: width, h: 2 };
}

let builderEditId = "";
let connectionEditId = "";
const editorReturnFocus = new Map();
const editorBackground = new Map();

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(label, handler, className = "home-action") {
  const control = node("button", className, label);
  control.type = "button";
  control.addEventListener("click", handler);
  return control;
}

function editorMain(editor) {
  return editor?.closest(".tool-workspace")?.querySelector(".tool-workspace-main");
}

function focusable(editor) {
  return [...editor.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.offsetParent !== null);
}

function editorKeydown(event) {
  const editor = event.currentTarget;
  if (event.key === "Escape") {
    event.preventDefault();
    closeToolEditor(editor);
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusable(editor);
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function inertModalBackground(editor) {
  const view = editor.closest(".view");
  const nodes = [
    $(".rail"),
    $(".topbar"),
    editorMain(editor),
    ...[...document.querySelectorAll(".content > .view")].filter((candidate) => candidate !== view),
  ].filter(Boolean);
  const unique = [...new Set(nodes)];
  const previous = unique.map((element) => ({ element, wasInert: element.hasAttribute("inert") }));
  previous.forEach(({ element }) => element.setAttribute("inert", ""));
  editorBackground.set(editor.id, previous);
}

function restoreModalBackground(editor) {
  const previous = editorBackground.get(editor.id) || [];
  previous.forEach(({ element, wasInert }) => {
    if (!wasInert) element.removeAttribute("inert");
  });
  editorBackground.delete(editor.id);
}

function openToolEditor(editor, focusTarget) {
  if (!editor || !editor.hidden) return;
  editorReturnFocus.set(editor.id, document.activeElement);
  editor.hidden = false;
  inertModalBackground(editor);
  editor.addEventListener("keydown", editorKeydown);
  requestAnimationFrame(() => (focusTarget || focusable(editor)[0])?.focus());
}

function closeToolEditor(editor, { restoreFocus = true } = {}) {
  if (!editor || editor.hidden) return false;
  if (editor.id === "connection-editor") clearConnectionSecret();
  editor.hidden = true;
  editor.removeEventListener("keydown", editorKeydown);
  restoreModalBackground(editor);
  const returnTarget = editorReturnFocus.get(editor.id);
  editorReturnFocus.delete(editor.id);
  if (restoreFocus && returnTarget?.isConnected && !returnTarget.hidden && returnTarget.offsetParent !== null) returnTarget.focus();
  return true;
}

export function closeHomeEditors(options = {}) {
  return [
    closeToolEditor($("#widget-builder-editor"), options),
    closeToolEditor($("#connection-editor"), options),
  ].some(Boolean);
}

async function requestJson(url, options = {}) {
  const { idempotencyKey, ...requestOptions } = options;
  const headers = { "Content-Type": "application/json", ...(requestOptions.headers || {}) };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(url, {
    ...requestOptions,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.description || body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function freshIdempotencyKey(prefix = "frank") {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

function validateHome(payload, kind, id) {
  if (payload?.schema !== "schema://frank.home/v1") throw new Error("Unexpected home response");
  if (payload.entity?.kind !== kind || payload.entity?.id !== id) throw new Error("Home identity mismatch");
  if (!Number.isInteger(payload.revision) || !Array.isArray(payload.instances)) throw new Error("Invalid home layout");
  return payload;
}

function setHomeMessage(message, tone = "") {
  const target = $(".view.is-on [data-home-status]") || $("[data-home-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}

function setTopActions(controls = []) {
  const host = $("#top-actions");
  if (host) host.replaceChildren(...controls);
}

export function clearHomeActions() {
  homeState.controller?.abort();
  homeState.memoryInspector?.dispose?.();
  homeState.memoryInspector = null;
  homeState.memoryOpen = false;
  window.clearInterval(homeState.refreshTimer);
  homeState.refreshTimer = null;
  destroyHomeGrid();
  clearConnectionSecret();
  setTopActions();
}

function manifestFor(widgetId) {
  return homeState.catalog.find((item) => item.id === widgetId);
}

function manifestCompatible(manifest) {
  if (!manifest?.surfaces?.includes(homeState.home?.entity?.kind)) return false;
  const scope = manifest.entity_scope;
  return !scope || (scope.kind === homeState.home.entity.kind && scope.id === homeState.home.entity.id);
}

async function refreshCatalog(signal) {
  const [catalog, connections] = await Promise.all([
    requestJson("/api/widgets", { signal }),
    requestJson("/api/connections", { signal }),
  ]);
  homeState.catalog = catalog.widgets || [];
  homeState.connections = connections.connections || [];
}

function homeEndpoint(home = homeState.home) {
  return `/api/homes/${encodeURIComponent(home.entity.kind)}/${encodeURIComponent(home.entity.id)}`;
}

function homeControls() {
  const controls = [];
  const isConnectionsHome = homeState.home?.entity.kind === "tool" && homeState.home?.entity.id === "connections";
  const isProject = homeState.home?.entity.kind === "project";
  if (isProject && homeState.memoryOpen) {
    controls.push(button("Back to dashboard", closeMemoryInspector, "home-action home-action-primary"));
    controls.push(button("Refresh memory", () => homeState.memoryInspector?.refresh?.()));
    setTopActions(controls);
    return;
  }
  if (isProject) {
    controls.push(button("New project chat", () => window.dispatchEvent(new CustomEvent("frank:new-project-chat", { detail: { project_id: homeState.home.entity.id } })), "home-action home-action-primary"));
    controls.push(button("Memory", openMemoryInspector));
  }
  if (isConnectionsHome) {
    controls.push(button("Manage connections", () => window.dispatchEvent(new CustomEvent("frank:connections")), "home-action home-action-primary"));
  }
  if (!homeState.editing) {
    controls.push(button("Add widget", () => beginEditing(true)));
    controls.push(button("Edit layout", () => beginEditing(false), (isConnectionsHome || isProject) ? "home-action" : "home-action home-action-primary"));
  } else {
    controls.push(button("Add widget", () => { homeState.gallery = true; renderHome(); }));
    controls.push(button("Reset", resetHome));
    controls.push(button("Discard", discardHome));
    const save = button(homeState.savePending ? "Saving…" : "Save", saveHome, "home-action home-action-primary");
    save.disabled = homeState.savePending;
    controls.push(save);
  }
  setTopActions(controls);
}

function openMemoryInspector() {
  if (!isProjectHome() || homeState.memoryOpen) return;
  homeState.memoryOpen = true;
  homeState.editing = false;
  homeState.gallery = false;
  window.clearInterval(homeState.refreshTimer);
  homeState.refreshTimer = null;
  destroyHomeGrid();
  homeState.memoryInspector?.dispose?.();
  homeState.memoryInspector = mountMemoryInspector({
    host: homeState.host,
    project: homeState.home.entity,
    setStatus: setHomeMessage,
  });
  homeControls();
}

function closeMemoryInspector() {
  homeState.memoryInspector?.dispose?.();
  homeState.memoryInspector = null;
  homeState.memoryOpen = false;
  renderHome();
}

function beginEditing(openGallery) {
  homeState.editing = true;
  homeState.gallery = openGallery;
  homeState.draft = structuredClone(homeState.home.instances);
  setHomeMessage("Layout changes are private until Save.");
  renderHome();
}

function discardHome() {
  homeState.editing = false;
  homeState.gallery = false;
  homeState.draft = structuredClone(homeState.home.instances);
  setHomeMessage("Changes discarded.");
  renderHome();
}

async function saveHome() {
  if (homeState.savePending) return;
  homeState.savePending = true;
  setHomeMessage("Saving layout…");
  homeControls();
  const identity = { kind: homeState.home.entity.kind, id: homeState.home.entity.id, revision: homeState.home.revision };
  try {
    const saved = validateHome(await requestJson(homeEndpoint(), {
      method: "PUT",
      body: JSON.stringify({ expected_revision: identity.revision, instances: homeState.draft }),
    }), identity.kind, identity.id);
    if (homeState.home.entity.kind !== identity.kind || homeState.home.entity.id !== identity.id) return;
    homeState.home = saved;
    homeState.draft = structuredClone(saved.instances);
    homeState.editing = false;
    homeState.gallery = false;
    setHomeMessage("Layout saved.", "success");
  } catch (error) {
    if (error.status === 409 && error.body?.current) {
      setHomeMessage("This layout changed elsewhere. Discard to load the latest version.", "error");
    } else {
      setHomeMessage(error.message || "Layout could not be saved.", "error");
    }
  } finally {
    homeState.savePending = false;
    renderHome();
  }
}

async function resetHome() {
  if (!window.confirm("Reset this home to its default widgets?")) return;
  homeState.savePending = true;
  setHomeMessage("Resetting layout…");
  homeControls();
  const identity = { kind: homeState.home.entity.kind, id: homeState.home.entity.id, revision: homeState.home.revision };
  try {
    const reset = validateHome(await requestJson(`${homeEndpoint()}/reset`, {
      method: "POST",
      body: JSON.stringify({ expected_revision: identity.revision }),
    }), identity.kind, identity.id);
    if (homeState.home.entity.kind !== identity.kind || homeState.home.entity.id !== identity.id) return;
    homeState.home = reset;
    homeState.draft = structuredClone(reset.instances);
    homeState.editing = false;
    homeState.gallery = false;
    setHomeMessage("Default layout restored.", "success");
  } catch (error) {
    setHomeMessage(error.status === 409 ? "The layout changed elsewhere. Reload this home and try again." : error.message, "error");
  } finally {
    homeState.savePending = false;
    renderHome();
  }
}

function moveInstance(instanceId, delta) {
  const index = homeState.draft.findIndex((item) => item.instance_id === instanceId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= homeState.draft.length) return;
  if (isProjectHome()) {
    const currentLayout = projectLayout(homeState.draft[index]);
    const nextLayout = projectLayout(homeState.draft[next]);
    homeState.draft[index].layout = nextLayout;
    homeState.draft[next].layout = currentLayout;
  }
  [homeState.draft[index], homeState.draft[next]] = [homeState.draft[next], homeState.draft[index]];
  renderHome();
}

function resizeInstance(instanceId) {
  const item = homeState.draft.find((entry) => entry.instance_id === instanceId);
  const manifest = manifestFor(item?.widget_id);
  if (!item || !manifest) return;
  const sizes = manifest.allowed_sizes || ["medium"];
  item.size = sizes[(sizes.indexOf(item.size) + 1) % sizes.length];
  if (isProjectHome()) {
    const layout = projectLayout(item);
    layout.w = item.size === "wide" ? 12 : item.size === "small" ? 3 : 6;
    layout.x = Math.min(layout.x, PROJECT_GRID_COLUMNS - layout.w);
    item.layout = layout;
  }
  renderHome();
}

function removeInstance(instanceId) {
  homeState.draft = homeState.draft.filter((item) => item.instance_id !== instanceId);
  renderHome();
}

function addInstance(widgetId) {
  const manifest = manifestFor(widgetId);
  if (!manifest || !manifestCompatible(manifest)) return;
  if (!manifest.multiple && homeState.draft.some((item) => item.widget_id === widgetId)) {
    setHomeMessage(`${manifest.title} is already on this home.`, "error");
    return;
  }
  if (homeState.draft.length >= homeState.home.max_widgets) {
    setHomeMessage(`A home supports at most ${homeState.home.max_widgets} widgets.`, "error");
    return;
  }
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const instance = { instance_id: `${widgetId.slice(0, 60)}-${suffix}`, widget_id: widgetId, size: manifest.default_size, config: {} };
  if (isProjectHome()) {
    const bottom = homeState.draft.reduce((maximum, entry) => {
      const layout = projectLayout(entry);
      return Math.max(maximum, layout.y + layout.h);
    }, 0);
    instance.layout = {
      x: 0,
      y: bottom,
      w: manifest.default_size === "wide" ? 12 : manifest.default_size === "small" ? 3 : 6,
      h: 2,
    };
  }
  homeState.draft.push(instance);
  homeState.gallery = false;
  setHomeMessage(`${manifest.title} added. Save to connect its data.`);
  renderHome();
}

function connectionOptions(instance, manifest) {
  const label = node("label", "home-connection-select");
  label.append(node("span", "", "Data connection"));
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Automatic / none";
  select.append(none);
  const isCentralConnections = homeState.home.entity.kind === "tool" && homeState.home.entity.id === "connections";
  const availableConnections = isCentralConnections
    ? homeState.connections
    : homeState.connections.filter((connection) => connection.scope_kind === "global" || (connection.scope_kind === homeState.home.entity.kind && connection.scope_id === homeState.home.entity.id));
  for (const item of availableConnections) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} · ${String(item.status || "").replace("_", " ")}`;
    select.append(option);
  }
  select.value = instance.config?.connection_id || "";
  select.addEventListener("change", () => {
    instance.config = { ...(instance.config || {}) };
    if (select.value) instance.config.connection_id = select.value;
    else delete instance.config.connection_id;
    setHomeMessage(`${manifest.title} connection changed. Save to apply.`);
  });
  label.append(select);
  return label;
}

const SNAPSHOT_STATUSES = new Set(["ready", "recorded", "verified", "empty", "setup_needed", "attention", "error", "unavailable"]);
const INTERNAL_VIEWS = new Set(["hub", "files", "tools", "trace", "releases", "project", "entity-home", "accounts", "connections", "widget-builder", "campaigns"]);
const INTERNAL_KINDS = new Set(["project", "tool", "agent", "service"]);

function displayStatus(value) {
  const status = String(value || "unavailable").toLowerCase();
  return SNAPSHOT_STATUSES.has(status) ? status : "unavailable";
}

function displayValue(value, unit = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

function scalarValue(value) {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value) ? value : "";
}

function safeTimestamp(value) {
  if (!value) return null;
  const numeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) ? Number(value) : NaN;
  const normalized = Number.isFinite(numeric) ? (Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric) : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.valueOf())) return null;
  const time = node("time", "home-timestamp", date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
  time.dateTime = date.toISOString();
  return time;
}

function appendStatusNote(body, snapshot) {
  const status = displayStatus(snapshot.status);
  const messages = {
    recorded: "Recorded in Frank; the provider remains authoritative.",
    verified: "Verified by the configured provider adapter.",
    setup_needed: "Setup is required before live data is available.",
    attention: "This provider needs attention before it can be treated as healthy.",
    error: "The provider returned an error; check the linked setup or service status.",
    empty: "No records are available yet.",
    unavailable: "Live data is unavailable from this provider.",
  };
  if (snapshot.data?.status_is_recorded || messages[status]) body.append(node("p", "home-truth", messages[status] || "Recorded in Frank; the provider remains authoritative."));
}

function validInternalTarget(item) {
  const target = item?.target;
  if (!target || typeof target !== "object") return null;
  if (target.view && INTERNAL_VIEWS.has(target.view)) {
    const internal = { view: target.view };
    if (target.view === "connections" && target.action === "add") internal.action = "add";
    if (target.view === "connections" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(target.provider || ""))) internal.provider = String(target.provider);
    return internal;
  }
  if (!INTERNAL_KINDS.has(target.kind) || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(target.id || ""))) return null;
  return { kind: target.kind, id: String(target.id), name: String(target.name || target.id) };
}

function safeExternalUrl(value) {
  try {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const url = new URL(raw, window.location.href);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function appendSnapshotAction(parent, item) {
  const label = String(item?.label || "Open").slice(0, 120);
  const internal = validInternalTarget(item);
  if (item?.kind === "internal" && internal) {
    const action = button(label, () => {
      if (internal.view === "connections" && (internal.action || internal.provider)) {
        window.dispatchEvent(new CustomEvent("frank:connections", { detail: internal }));
      } else if (internal.view) window.dispatchEvent(new CustomEvent("frank:view", { detail: internal.view }));
      else window.dispatchEvent(new CustomEvent("frank:entity-home", { detail: internal }));
    }, "home-inline-button");
    parent.append(action);
    return true;
  }
  if (item?.kind !== "external") return false;
  const url = safeExternalUrl(item.url);
  if (!url) return false;
  const link = node("a", "tool-link", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  parent.append(link);
  return true;
}

function disposeProjectCharts(body) {
  body.querySelectorAll("[data-project-chart]").forEach((host) => {
    host._resizeObserver?.disconnect();
    host._chart?.dispose();
  });
}

function updateProjectHeading(snapshot) {
  const badge = $("#project-dashboard-status");
  const dot = $("#project-dashboard-dot");
  const setup = $("#project-dashboard-setup");
  if (!badge || !dot) return;
  const status = displayStatus(snapshot.status);
  badge.textContent = status === "ready" ? "Application live" : status === "error" ? "Needs attention" : "Setup in progress";
  badge.dataset.status = status;
  dot.dataset.status = status;
  if (setup) {
    const count = Number(snapshot.data?.setup_items || 0);
    setup.textContent = `${count} setup item${count === 1 ? "" : "s"}`;
  }
}

function renderProjectSignal(body, snapshot) {
  updateProjectHeading(snapshot);
  const data = snapshot.data || {};
  const status = displayStatus(snapshot.status);
  const signal = node("div", "project-signal-line");
  signal.append(node("span", "project-signal-ring", status === "ready" ? "OK" : status === "error" ? "!" : "…"));
  const copy = node("div", "project-signal-copy");
  copy.append(node("strong", "", scalarValue(snapshot.summary) || "Project status"));
  copy.append(node("span", "", scalarValue(data.health_summary) || "Provider status is available."));
  signal.append(copy);
  const footer = node("div", "project-signal-footer");
  for (const [value, label] of [
    [data.branch || "unknown", "branch"],
    [Number(data.live_services || 0), "live service"],
    [Number(data.setup_items || 0), "setup items"],
  ]) {
    const item = node("span");
    item.append(node("strong", "", String(value)), document.createTextNode(` ${label}${label === "live service" && value !== 1 ? "s" : ""}`));
    footer.append(item);
  }
  body.append(signal, footer);
}

function renderRepositoryPulse(body, snapshot) {
  const data = snapshot.data || {};
  const points = Array.isArray(data.points) ? data.points.filter((item) => item && Number.isFinite(item.value)) : [];
  if (!points.length) {
    body.append(node("span", `home-status-pill status-${displayStatus(snapshot.status)}`, displayStatus(snapshot.status).replaceAll("_", " ")));
    body.append(node("p", "home-summary", scalarValue(snapshot.summary) || "No repository activity yet."));
    return;
  }
  const chartHost = node("div", "project-pulse-chart");
  chartHost.dataset.projectChart = "repository-pulse";
  chartHost.setAttribute("role", "img");
  chartHost.setAttribute("aria-label", `Repository activity: ${points.map((item) => `${item.label}, ${item.value}`).join("; ")}`);
  body.append(chartHost);
  const echarts = window.FrankDashboardVendor?.echarts;
  if (!echarts) {
    const fallback = node("div", "project-pulse-fallback");
    const maximum = Math.max(...points.map((item) => item.value), 1);
    for (const item of points) {
      const bar = node("span");
      bar.style.height = `${Math.max(8, Math.round((item.value / maximum) * 100))}%`;
      bar.title = `${item.label}: ${item.value}`;
      fallback.append(bar);
    }
    chartHost.append(fallback);
    return;
  }
  requestAnimationFrame(() => {
    if (!chartHost.isConnected) return;
    const chart = echarts.init(chartHost, null, { renderer: "svg" });
    chartHost._chart = chart;
    chart.setOption({
      animationDuration: 450,
      aria: { enabled: true, decal: { show: false } },
      grid: { top: 8, right: 4, bottom: 18, left: 4 },
      tooltip: { trigger: "axis", backgroundColor: "#111", borderWidth: 0, textStyle: { color: "#fff", fontSize: 10 } },
      xAxis: {
        type: "category", boundaryGap: false, data: points.map((item) => item.label),
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#6b6b6b", fontSize: 9 },
      },
      yAxis: { type: "value", show: false, minInterval: 1 },
      series: [{
        name: "Repository events", type: "line", smooth: 0.35, symbol: "none",
        data: points.map((item) => item.value),
        lineStyle: { color: "#111", width: 2 }, areaStyle: { color: "rgba(17,17,17,.08)" },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartHost);
    chartHost._resizeObserver = observer;
  });
}

function renderProjectMetric(body, snapshot, widgetId) {
  const data = snapshot.data || {};
  let value = 0;
  let label = "records";
  if (widgetId === "accounts-summary") {
    value = Number(data.total || 0);
  } else {
    const counts = data.counts && typeof data.counts === "object" ? data.counts : {};
    const total = ["setup_needed", "connected", "verified", "error"].reduce((sum, key) => sum + Number(counts[key] || 0), 0);
    value = `${Number(counts.verified || 0)}/${total}`;
    label = "verified";
  }
  body.append(node("strong", "project-metric-value", String(value)));
  body.append(node("span", "project-metric-label", label));
  const state = node("span", `project-metric-state status-${displayStatus(snapshot.status)}`,
    displayStatus(snapshot.status) === "ready" ? "Ready" : scalarValue(snapshot.summary) || "Setup available");
  body.append(state);
}

function renderProjectAttention(body, snapshot) {
  const rows = Array.isArray(snapshot.data?.rows) ? snapshot.data.rows : [];
  if (!rows.length) {
    body.append(node("p", "project-clear-state", "Nothing needs attention."));
    return;
  }
  const list = node("ul", "project-attention-list");
  rows.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = node("li", "project-attention-row");
    row.append(node("i", `project-attention-dot status-${displayStatus(item.status)}`));
    const copy = node("div", "project-attention-copy");
    copy.append(node("strong", "", scalarValue(item.subject) || "Setup item"));
    copy.append(node("span", "", scalarValue(item.detail) || "Review this project setting."));
    row.append(copy);
    if (item.link) appendSnapshotAction(row, item.link);
    list.append(row);
  });
  body.append(list);
}

function renderProjectActivity(body, snapshot) {
  const timeline = Array.isArray(snapshot.data?.timeline) ? snapshot.data.timeline : [];
  const list = node("ol", "project-activity-list");
  timeline.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = node("li", "project-activity-row");
    row.append(node("i", `project-activity-dot status-${displayStatus(item.status)}`));
    const copy = node("div", "project-activity-copy");
    copy.append(node("strong", "", scalarValue(item.title) || "Project event"));
    const detail = scalarValue(item.detail);
    if (detail) copy.append(node("span", "", detail));
    row.append(copy);
    const timestamp = safeTimestamp(item.timestamp || item.at);
    if (timestamp) row.append(timestamp);
    list.append(row);
  });
  body.append(list);
}

function renderProjectQuickPaths(body, snapshot) {
  const links = node("div", "project-quick-links");
  (snapshot.links || []).forEach((item) => appendSnapshotAction(links, item));
  body.append(links);
  const ready = Number(snapshot.data?.ready || 0);
  const total = Math.max(1, Number(snapshot.data?.total || 4));
  const coverage = node("div", "project-coverage");
  const label = node("div", "project-coverage-label");
  label.append(node("span", "", "Widget coverage"), node("span", "", `${ready} of ${total} ready`));
  const track = node("div", "project-coverage-track");
  const value = node("span");
  value.style.width = `${Math.min(100, Math.round((ready / total) * 100))}%`;
  track.append(value);
  coverage.append(label, track);
  body.append(coverage);
}

function renderProjectSnapshot(body, snapshot, widgetId) {
  if (!isProjectHome()) return false;
  if (widgetId === "project-signal") renderProjectSignal(body, snapshot);
  else if (widgetId === "accounts-summary" || widgetId === "connections-summary") renderProjectMetric(body, snapshot, widgetId);
  else if (widgetId === "repository-pulse") renderRepositoryPulse(body, snapshot);
  else if (widgetId === "project-attention") renderProjectAttention(body, snapshot);
  else if (widgetId === "project-activity") renderProjectActivity(body, snapshot);
  else if (widgetId === "project-quick-paths") renderProjectQuickPaths(body, snapshot);
  else return false;
  return true;
}

function renderSnapshot(body, snapshot, widgetId = "") {
  disposeProjectCharts(body);
  destroyGraphMount(body);
  body.replaceChildren();
  if (widgetId === "entity-graph" && snapshot.data?.graph && typeof snapshot.data.graph === "object") {
    const handle = mountGraphWorkbench(body, {
      kind: snapshot.entity_kind || "tool",
      entityId: snapshot.entity_id || "",
      title: "Graph",
      load: async () => snapshot.data.graph,
    });
    graphMounts.set(body, handle);
    return;
  }
  if (renderProjectSnapshot(body, snapshot, widgetId)) return;
  const summary = node("p", "home-summary", scalarValue(snapshot.summary) || "No summary available.");
  const statusValue = displayStatus(snapshot.status);
  const status = node("span", `home-status-pill status-${statusValue}`, statusValue.replaceAll("_", " "));
  body.append(status, summary);

  const data = snapshot.data || {};
  const metrics = [];
  const metricKeys = ["customers", "attention", "running", "waiting", "files", "folders", "custom", "recorded", "verified", "configured", "setup_needed", "error", "total"];
  for (const metric of Array.isArray(data.metrics) ? data.metrics : []) {
    if (!metric || typeof metric !== "object" || !metric.label) continue;
    const value = scalarValue(metric.value);
    if (value !== "") metrics.push([String(metric.label), displayValue(value, metric.unit)]);
  }
  for (const key of metricKeys) if (Number.isFinite(data[key]) && Number.isInteger(data[key])) metrics.push([key.replaceAll("_", " "), data[key]]);
  if (data.counts && typeof data.counts === "object" && !Array.isArray(data.counts)) {
    for (const key of ["recorded", "verified", "configured", "connected", "setup_needed", "error", "total"]) {
      if (Number.isFinite(data.counts[key]) && Number.isInteger(data.counts[key])) metrics.push([key.replaceAll("_", " "), data.counts[key]]);
    }
  }
  if (scalarValue(data.branch)) metrics.push(["Branch", data.branch]);
  if (metrics.length) {
    const grid = node("div", "home-metrics");
    for (const [label, value] of metrics) {
      const metric = node("div", "home-metric");
      metric.append(node("strong", "", String(value)), node("span", "", label));
      grid.append(metric);
    }
    body.append(grid);
  }
  if (scalarValue(data.description)) body.append(node("p", "quiet", data.description));
  const rowsData = [
    ...(Array.isArray(data.rows) ? data.rows : []),
    ...(Array.isArray(data.connections) ? data.connections : []),
    ...(Array.isArray(data.recent) ? data.recent : []),
  ];
  if (widgetId === "provider-catalog" && rowsData.length) {
    const providers = node("div", "home-provider-grid");
    for (const item of rowsData) {
      if (!item || typeof item !== "object") continue;
      const name = String(item.name || item.provider || "Provider");
      const provider = /^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(item.provider || "")) ? String(item.provider) : "";
      const tile = node("button", "home-provider-tile");
      tile.type = "button";
      tile.setAttribute("aria-label", `Add ${name} connection`);
      tile.addEventListener("click", () => window.dispatchEvent(new CustomEvent("frank:connections", {
        detail: { action: "add", provider, name, capabilities: Array.isArray(item.capabilities) ? item.capabilities : [] },
      })));
      const mark = node("span", "home-provider-mark", name.slice(0, 1).toUpperCase());
      mark.setAttribute("aria-hidden", "true");
      const copy = node("div", "home-provider-copy");
      copy.append(node("strong", "", name));
      const capabilityCount = Array.isArray(item.capabilities) ? item.capabilities.length : 0;
      const foundation = item.open_source ? "Open source" : (item.open_standard ? "Open standard" : "");
      const capabilityLabel = `${capabilityCount} capabilit${capabilityCount === 1 ? "y" : "ies"}`;
      copy.append(node("span", "", foundation ? `${foundation} · ${capabilityLabel}` : capabilityLabel));
      tile.append(mark, copy);
      providers.append(tile);
    }
    if (providers.childElementCount) body.append(providers);
  } else if (rowsData.length) {
    const rows = node("ul", "home-data-rows");
    for (const item of rowsData) {
      if (!item || typeof item !== "object") continue;
      const row = node("li");
      const primaryValue = scalarValue(item.subject || item.name || item.title || item.provider || item.label || "Item");
      const detailValue = scalarValue(item.author || item.detail || item.status || item.kind || item.value || "");
      const primary = node("strong", "", primaryValue);
      const detail = node("span", "", String(detailValue).replaceAll("_", " "));
      row.append(primary, detail);
      const timestamp = safeTimestamp(item.timestamp || item.updated_at || item.created_at);
      if (timestamp) row.append(timestamp);
      rows.append(row);
    }
    body.append(rows);
  }
  if (Array.isArray(data.timeline) && data.timeline.length) {
    const timeline = node("ol", "home-data-rows home-timeline");
    for (const item of data.timeline) {
      if (!item || typeof item !== "object") continue;
      const row = node("li");
      row.append(node("strong", "", String(item.title || item.label || item.event || "Event")));
      const detail = scalarValue(item.detail || item.description);
      if (detail) row.append(node("span", "", detail));
      const timestamp = safeTimestamp(item.timestamp || item.at);
      if (timestamp) row.append(timestamp);
      timeline.append(row);
    }
    if (timeline.childElementCount) body.append(timeline);
  }
  appendStatusNote(body, snapshot);
  const actions = [
    ...(Array.isArray(snapshot.links) ? snapshot.links : []),
    ...(Array.isArray(snapshot.actions) ? snapshot.actions : []),
  ];
  if (actions.length) {
    const links = node("div", "home-links");
    actions.forEach((item) => appendSnapshotAction(links, item));
    if (links.childElementCount) body.append(links);
  }
  const generated = safeTimestamp(snapshot.generated_at);
  if (generated) body.append(generated);
}

async function loadSnapshot(card, body, instance, generation) {
  const saved = homeState.home.instances.some((item) => item.instance_id === instance.instance_id);
  if (!saved) {
    body.append(node("p", "quiet", "Save the layout to connect this widget."));
    return;
  }
  try {
    const snapshot = await requestJson(`${homeEndpoint()}/widgets/${encodeURIComponent(instance.instance_id)}`);
    if (generation !== homeState.generation || !card.isConnected) return;
    if (snapshot.entity_kind !== homeState.home.entity.kind || snapshot.entity_id !== homeState.home.entity.id || snapshot.instance_id !== instance.instance_id || snapshot.widget_id !== instance.widget_id) {
      throw new Error("Widget identity mismatch");
    }
    renderSnapshot(body, snapshot, instance.widget_id);
  } catch (error) {
    if (generation !== homeState.generation || !card.isConnected) return;
    destroyGraphMount(body);
    body.replaceChildren(node("p", "home-error", error.message || "Widget unavailable."));
    body.append(button("Retry", () => loadSnapshot(card, body, instance, generation), "home-inline-button"));
  }
}

function refreshPollingWidgets() {
  if (!homeState.home || homeState.editing || !homeState.host?.closest(".view")?.classList.contains("is-on")) return;
  const generation = homeState.generation;
  for (const instance of homeState.home.instances) {
    if (manifestFor(instance.widget_id)?.freshness !== "poll") continue;
    const card = homeState.host.querySelector(`[data-instance-id="${CSS.escape(instance.instance_id)}"]`);
    const body = card?.querySelector(".home-widget-body");
    if (card && body) loadSnapshot(card, body, instance, generation);
  }
}

function scheduleHomeRefresh() {
  window.clearInterval(homeState.refreshTimer);
  homeState.refreshTimer = null;
  const instances = homeState.editing ? [] : (homeState.home?.instances || []);
  if (!instances.some((instance) => manifestFor(instance.widget_id)?.freshness === "poll")) return;
  homeState.refreshTimer = window.setInterval(refreshPollingWidgets, 30_000);
}

function widgetCard(instance, index, generation) {
  const manifest = manifestFor(instance.widget_id);
  const card = node("section", `w-card home-widget home-size-${instance.size}`);
  if (isProjectHome()) card.classList.add("project-widget");
  card.dataset.instanceId = instance.instance_id;
  card.dataset.widgetId = instance.widget_id;
  const heading = node("div", "home-widget-head");
  const titles = node("div");
  titles.append(node("h3", "", manifest?.title || instance.widget_id));
  if (manifest?.provider) titles.append(node("span", "home-provider", manifest.provider));
  heading.append(titles);
  if (homeState.editing) {
    const controls = node("div", "home-widget-controls");
    const left = button("←", () => moveInstance(instance.instance_id, -1), "home-icon-button");
    left.setAttribute("aria-label", `Move ${manifest?.title || instance.widget_id} left`);
    left.disabled = index === 0;
    const right = button("→", () => moveInstance(instance.instance_id, 1), "home-icon-button");
    right.setAttribute("aria-label", `Move ${manifest?.title || instance.widget_id} right`);
    right.disabled = index === homeState.draft.length - 1;
    const resize = button(instance.size, () => resizeInstance(instance.instance_id), "home-size-button");
    resize.setAttribute("aria-label", `Resize ${manifest?.title || instance.widget_id}; currently ${instance.size}`);
    const remove = button("×", () => removeInstance(instance.instance_id), "home-icon-button home-remove-button");
    remove.setAttribute("aria-label", `Remove ${manifest?.title || instance.widget_id}`);
    controls.append(left, right, resize, remove);
    heading.append(controls);
  }
  const body = node("div", "w-body home-widget-body");
  card.append(heading);
  if (homeState.editing && manifest?.accepts_connection) card.append(connectionOptions(instance, manifest));
  card.append(body);
  if (!manifest) body.append(node("p", "home-error", "This widget is no longer registered. Remove it while editing."));
  else loadSnapshot(card, body, instance, generation);
  return card;
}

function gallery() {
  const panel = node("section", "home-gallery");
  const head = node("div", "home-gallery-head");
  const copy = node("div");
  copy.append(node("span", "home-kicker", "Widget gallery"), node("h2", "", `Add to ${homeState.home.entity.name}`));
  head.append(copy, button("Close", () => { homeState.gallery = false; renderHome(); }, "home-inline-button"));
  panel.append(head);
  const grid = node("div", "home-gallery-grid");
  const available = homeState.catalog.filter((item) => manifestCompatible(item));
  for (const manifest of available) {
    const item = node("article", "home-gallery-item");
    item.append(node("h3", "", manifest.title), node("p", "", manifest.description || "Reusable widget."));
    const meta = node("p", "home-gallery-meta", `${manifest.provider} · ${manifest.default_size}`);
    const already = !manifest.multiple && homeState.draft.some((entry) => entry.widget_id === manifest.id);
    const add = button(already ? "Already added" : "Add", () => addInstance(manifest.id), "home-inline-button");
    add.disabled = already;
    item.append(meta, add);
    grid.append(item);
  }
  panel.append(grid);
  return panel;
}

function syncProjectGridLayout() {
  if (!homeState.grid || !homeState.editing) return;
  const byId = new Map(homeState.draft.map((item) => [item.instance_id, item]));
  for (const gridNode of homeState.grid.engine.nodes || []) {
    const instanceId = gridNode.el?.dataset.instanceId;
    const instance = byId.get(instanceId);
    if (!instance || ![gridNode.x, gridNode.y, gridNode.w, gridNode.h].every(Number.isInteger)) continue;
    instance.layout = { x: gridNode.x, y: gridNode.y, w: gridNode.w, h: gridNode.h };
    instance.size = gridNode.w >= 9 ? "wide" : gridNode.w >= 5 ? "medium" : "small";
  }
}

function renderProjectGrid(host, instances, generation) {
  const GridStack = window.FrankDashboardVendor?.GridStack;
  host.classList.add("project-signal-grid", "grid-stack");
  instances.forEach((instance, index) => {
    const layout = projectLayout(instance);
    const frame = node("div", "grid-stack-item");
    frame.dataset.instanceId = instance.instance_id;
    frame.setAttribute("gs-x", String(layout.x));
    frame.setAttribute("gs-y", String(layout.y));
    frame.setAttribute("gs-w", String(layout.w));
    frame.setAttribute("gs-h", String(layout.h));
    const card = widgetCard(instance, index, generation);
    card.classList.add("grid-stack-item-content");
    frame.append(card);
    host.append(frame);
  });
  if (homeState.editing && homeState.gallery) {
    const frame = node("div", "grid-stack-item project-gallery-frame");
    frame.dataset.instanceId = "widget-gallery";
    frame.setAttribute("gs-x", "0");
    frame.setAttribute("gs-y", "99");
    frame.setAttribute("gs-w", "12");
    frame.setAttribute("gs-h", "6");
    const panel = gallery();
    panel.classList.add("grid-stack-item-content");
    frame.append(panel);
    host.append(frame);
  }
  if (!GridStack) {
    host.classList.add("project-grid-fallback");
    return;
  }
  homeState.grid = GridStack.init({
    column: PROJECT_GRID_COLUMNS,
    cellHeight: 82,
    margin: 10,
    staticGrid: !homeState.editing,
    animate: true,
    float: false,
    columnOpts: { breakpoints: [{ w: 700, c: 1 }, { w: 1100, c: 6 }, { w: 1400, c: 12 }] },
  }, host);
  if (homeState.editing) {
    homeState.grid.on("change dragstop resizestop", syncProjectGridLayout);
    syncProjectGridLayout();
  }
}

function renderHome() {
  if (!homeState.host || !homeState.home) return;
  destroyHomeGrid();
  homeControls();
  const host = homeState.host;
  destroyGraphMounts(host);
  host.replaceChildren();
  host.classList.add("home-grid");
  host.classList.toggle("project-signal-grid", isProjectHome());
  host.classList.toggle("grid-stack", isProjectHome());
  host.classList.remove("project-grid-fallback");
  host.dataset.homeKind = homeState.home.entity.kind;
  host.dataset.homeId = homeState.home.entity.id;
  const instances = homeState.editing ? homeState.draft : homeState.home.instances;
  const generation = homeState.generation;
  if (!instances.length) {
    const empty = node("section", "home-empty");
    empty.append(node("h2", "", "This home is empty"), node("p", "", "Add a widget to start this home."), button("Add widget", () => beginEditing(true), "home-action home-action-primary"));
    host.append(empty);
  } else if (isProjectHome()) {
    renderProjectGrid(host, instances, generation);
  } else {
    instances.forEach((instance, index) => host.append(widgetCard(instance, index, generation)));
  }
  if (!isProjectHome() && homeState.editing && homeState.gallery) host.append(gallery());
  scheduleHomeRefresh();
}

async function openHome(kind, id, host) {
  homeState.controller?.abort();
  homeState.memoryInspector?.dispose?.();
  window.clearInterval(homeState.refreshTimer);
  homeState.refreshTimer = null;
  destroyHomeGrid();
  const controller = new AbortController();
  const generation = ++homeState.generation;
  homeState.controller = controller;
  homeState.host = host;
  homeState.home = null;
  homeState.editing = false;
  homeState.gallery = false;
  homeState.savePending = false;
  homeState.memoryInspector = null;
  homeState.memoryOpen = false;
  host.classList.add("home-grid");
  destroyGraphMounts(host);
  host.replaceChildren(node("p", "home-loading", "Loading home…"));
  setTopActions();
  setHomeMessage("Loading live widget connections…");
  try {
    await refreshCatalog(controller.signal);
    const home = validateHome(await requestJson(`/api/homes/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { signal: controller.signal }), kind, id);
    if (generation !== homeState.generation) return;
    homeState.home = home;
    homeState.draft = structuredClone(home.instances);
    setHomeMessage(home.updated_at ? `Shared layout revision ${home.revision}.` : "Default layout. Save changes to publish it.");
    renderHome();
  } catch (error) {
    if (error.name === "AbortError" || generation !== homeState.generation) return;
    destroyGraphMounts(host);
    host.replaceChildren(node("p", "home-error", error.message || "Home unavailable."));
    setHomeMessage("Home unavailable.", "error");
  }
}

export function openProjectHome(project) {
  $("#project-dashboard-name").textContent = project.name || project.id;
  $("#project-dashboard-blurb").textContent = project.blurb || "Project workspace.";
  const status = $("#project-dashboard-status");
  const setup = $("#project-dashboard-setup");
  const dot = $("#project-dashboard-dot");
  status.textContent = "Loading status";
  status.dataset.status = "setup_needed";
  setup.textContent = "Checking setup";
  dot.dataset.status = "setup_needed";
  const open = $("#project-dashboard-open");
  const liveUrl = safeExternalUrl(project.live);
  open.hidden = !liveUrl;
  if (liveUrl) open.href = liveUrl;
  else open.removeAttribute("href");
  return openHome("project", project.id, $("#slot-project"));
}

export function openEntityHome(entity) {
  $("#entity-home-name").textContent = entity.name || entity.id;
  $("#entity-home-kind").textContent = entity.kind;
  return openHome(entity.kind, entity.id, $("#slot-entity-home"));
}

function renderWidgetBuilder(catalog) {
  const host = $("#widget-catalog");
  host.replaceChildren();
  const custom = (catalog.widgets || []).filter((item) => item.custom);
  const builtins = (catalog.widgets || []).filter((item) => !item.custom);
  for (const [label, items] of [["Frank widgets", builtins], ["Your widgets", custom]]) {
    const group = node("section", "builder-group");
    group.append(node("h2", "", label));
    const grid = node("div", "builder-grid");
    for (const item of items) {
      const card = node("article", "w-card builder-card");
      card.append(node("span", "home-provider", `${item.provider} · v${item.version}`), node("h3", "", item.title), node("p", "", item.description));
      card.append(node("p", "builder-surfaces", (item.surfaces || []).join(" · ")));
      if (item.custom) {
        const actions = node("div", "tool-actions");
        actions.append(button("Edit", () => editWidget(item), "home-inline-button"), button("Remove", () => deleteWidget(item), "home-inline-button danger-text"));
        card.append(actions);
      }
      grid.append(card);
    }
    if (!items.length) grid.append(node("p", "quiet", "No custom widgets yet."));
    group.append(grid);
    host.append(group);
  }
}

async function loadWidgetBuilder() {
  const catalog = await requestJson("/api/widgets");
  renderWidgetBuilder(catalog);
  return catalog;
}

function editWidget(item = null) {
  builderEditId = item?.id || "";
  $("#widget-form-title").textContent = item ? "Edit widget" : "New widget";
  $("#widget-kind").value = item?.kind || "note";
  $("#widget-title").value = item?.title || "";
  $("#widget-description").value = item?.description || "";
  $("#widget-body").value = item?.definition?.body || "";
  $("#widget-label").value = item?.definition?.label || "";
  $("#widget-url").value = item?.definition?.url || "";
  document.querySelectorAll("[name=widget-surface]").forEach((input) => { input.checked = !item || item.surfaces?.includes(input.value); });
  $("#widget-form-error").textContent = "";
  openToolEditor($("#widget-builder-editor"), $("#widget-title"));
}

async function deleteWidget(item) {
  if (!window.confirm(`Remove ${item.title}?`)) return;
  try {
    await requestJson(`/api/widgets/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    await loadWidgetBuilder();
    $("#builder-status").textContent = "Widget removed.";
  } catch (error) {
    $("#builder-status").textContent = error.message;
  }
}

export async function openWidgetBuilder() {
  setTopActions([button("New widget", () => editWidget(), "home-action home-action-primary")]);
  $("#builder-status").textContent = "Loading widget catalog…";
  try {
    await loadWidgetBuilder();
    $("#builder-status").textContent = "Widgets are reusable across compatible homes.";
  } catch (error) {
    $("#builder-status").textContent = error.message;
  }
}

function connectionStatusLabel(value) {
  return ({ setup_needed: "Setup needed", connected: "Connected", verified: "Verified", error: "Error" })[value] || value;
}

/* Connections workspace: one screen for safe metadata, provider truth, and receipts. */
let connectionWorkspace = { payload: null, vault: null, providers: null, bindings: null, attention: [], activity: [] };
let connectionEditItem = null;
let connectionRequestPending = false;

function clearConnectionSecret() {
  const input = $("#connection-secret");
  if (input) input.value = "";
}

function setConnectionBusy(value) {
  connectionRequestPending = Boolean(value);
  document.querySelectorAll("#connection-editor button, #connection-catalog button, #connection-list button, #connection-vault-health button, #connection-agent-open").forEach((control) => {
    control.disabled = connectionRequestPending;
  });
}

function formatConnectionTime(value) {
  if (!value) return "";
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function connectionActionLabel(action) {
  return ({ create: "Create", update: "Update", verify: "Verify", sync: "Sync", revoke: "Revoke", delete: "Remove" })[action] || action;
}

function connectionCapabilities(provider) {
  const item = (connectionWorkspace.providers?.providers || []).find((entry) => entry.provider === provider)
    || (connectionWorkspace.payload?.catalog || []).find((entry) => entry.provider === provider);
  return Array.isArray(item?.capabilities) ? item.capabilities : [];
}

function safeVaultRefId(ref) {
  const match = /^vault:\/\/frank\/([a-f0-9]{32})$/i.exec(String(ref || ""));
  return match ? match[1] : "";
}

function renderConnectionOverview(payload, vault, providers) {
  const host = $("#connection-overview");
  if (!host) return;
  const items = payload?.connections || [];
  const counts = Object.fromEntries(["setup_needed", "connected", "verified", "error"].map((status) => [status, items.filter((item) => item.status === status).length]));
  const cards = [
    ["Configured", counts.connected, "connected", "Connected means configured and awaiting verification."],
    ["Verified", counts.verified, "verified", "Only a provider receipt can move a connection here."],
    ["Setup needed", counts.setup_needed, "setup_needed", "No provider-ready credential is recorded."],
    ["Errors", counts.error, "error", "Safe provider code/category only; details stay upstream."],
    ["Vault", String(vault?.status || "setup_needed").replaceAll("_", " "), `vault-${vault?.status || "setup_needed"}`, vault?.message || "Vault status is unavailable."],
  ];
  host.replaceChildren(...cards.map(([label, value, status, note]) => {
    const card = node("article", "connection-summary-card");
    card.append(node("span", "home-provider", label), node("strong", `connection-summary-value status-${status}`, String(value)), node("span", "connection-summary-note", note));
    return card;
  }));
  const configuredProviders = (providers?.providers || []).filter((item) => item.status === "ready").length;
  const footer = node("p", "connection-summary-foot", `${items.length} binding${items.length === 1 ? "" : "s"} · ${configuredProviders} provider adapter${configuredProviders === 1 ? "" : "s"} available · status remains provider-owned`);
  host.append(footer);
}

function renderConnectionAttention(items) {
  const host = $("#connection-attention");
  if (!host) return;
  host.replaceChildren();
  if (!items.length) {
    host.append(node("p", "connection-empty", "No open attention items."));
    return;
  }
  for (const item of items.slice(0, 8)) {
    const row = node("div", "connection-attention-row");
    const label = item.target?.provider || item.target?.connection_id || "Connection operation";
    const detail = item.result?.error_category || item.result?.error_code || item.state || "attention";
    row.append(node("strong", "", label), node("span", "", `${connectionActionLabel(item.action)} · ${String(detail).replaceAll("_", " ")}`));
    host.append(row);
  }
}

function renderVaultHealth(vault, bindings, secrets) {
  const host = $("#connection-vault-health");
  if (!host) return;
  host.replaceChildren();
  const state = String(vault?.status || "setup_needed");
  const card = node("div", "connection-vault-card");
  card.append(node("span", `connection-status status-${state}`, state.replaceAll("_", " ")), node("p", "", vault?.message || "Secure vault status is unavailable."));
  card.append(node("p", "home-truth", `${(bindings?.bindings || []).length} opaque provider binding${(bindings?.bindings || []).length === 1 ? "" : "s"}. Frank cannot reveal secret values.`));
  const inventory = node("div", "connection-vault-inventory");
  inventory.append(node("h3", "", "Vault metadata inventory"));
  const records = secrets?.secrets || [];
  if (!records.length) inventory.append(node("p", "connection-empty", "No vault metadata recorded."));
  for (const record of records) {
    const row = node("div", "connection-vault-row");
    row.append(node("strong", "", record.secret_name || "Write-only secret"), node("span", "", `${record.provider || "unbound"} · ${record.scope_kind || "global"} · v${record.version || 0} · ${record.status || "recorded"}`), node("code", "", record.ref || "opaque ref"));
    if (safeVaultRefId(record.ref)) row.append(button("Delete vault secret", () => deleteVaultSecret({ name: record.secret_name || "this secret", credential_ref: record.ref }), "home-inline-button danger-text"));
    inventory.append(row);
  }
  card.append(inventory);
  const bindingList = node("div", "connection-binding-list");
  bindingList.append(node("h3", "", "Provider bindings"));
  const providerBindings = bindings?.bindings || [];
  if (!providerBindings.length) bindingList.append(node("p", "connection-empty", "No provider bindings recorded."));
  for (const binding of providerBindings) {
    const row = node("div", "connection-vault-row");
    row.append(node("strong", "", binding.provider || "Provider"), node("span", "", `${binding.consumer || "consumer"} · ${(binding.capabilities || []).join(" · ")}`), node("code", "", binding.ref || "opaque ref"));
    bindingList.append(row);
  }
  card.append(bindingList);
  host.append(card);
}

function renderConnectionActivity(items) {
  const host = $("#connection-activity");
  if (!host) return;
  host.replaceChildren();
  if (!items.length) {
    host.append(node("p", "connection-empty", "No connection activity yet."));
    return;
  }
  for (const item of items.slice(0, 12)) {
    const row = node("article", "connection-activity-row");
    const heading = node("div", "connection-activity-heading");
    heading.append(node("strong", "", `${item.actor || item.source || "Frank"} · ${connectionActionLabel(item.action)}`), node("span", `connection-status status-${item.state || "planned"}`, String(item.state || "planned").replaceAll("_", " ")));
    const detail = item.result?.error_category || item.result?.error_code || item.result?.provider_receipt || item.result?.outcome || "Recorded action";
    row.append(heading, node("p", "", `${item.target?.provider || item.target?.connection_id || "workspace"} · ${detail}`), node("time", "quiet", formatConnectionTime(item.updated_at)));
    host.append(row);
  }
}

function renderConnections(payload, providerPayload = {}, vault = {}, bindings = {}, attention = [], activity = [], secrets = {}) {
  connectionWorkspace = { payload, providers: providerPayload, vault, bindings, attention, activity };
  renderConnectionOverview(payload, vault, providerPayload);
  renderConnectionAttention(attention);
  renderVaultHealth(vault, bindings, secrets);
  renderConnectionActivity(activity);
  const catalog = $("#connection-catalog");
  const saved = $("#connection-list");
  catalog?.replaceChildren();
  saved?.replaceChildren();
  const baseCatalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const brokerByProvider = new Map((providerPayload.providers || []).map((item) => [item.provider, item]));
  const providers = baseCatalog.map((item) => {
    const broker = brokerByProvider.get(item.provider);
    if (!broker) return item;
    return {
      ...item,
      ...(Object.hasOwn(broker, "status") ? { status: broker.status } : {}),
      ...(Object.hasOwn(broker, "setup_mode") ? { setup_mode: broker.setup_mode } : {}),
      ...(Object.hasOwn(broker, "setup_url") ? { setup_url: broker.setup_url } : {}),
      ...(Object.hasOwn(broker, "setup_note") ? { setup_note: broker.setup_note } : {}),
    };
  });
  for (const item of providers) {
    const card = node("article", "w-card connection-catalog-card");
    const status = item.status || item.setup_mode || "setup_needed";
    card.append(node("span", "home-provider", item.provider), node("h3", "", item.title || item.provider), node("p", "", item.setup_note || item.description || "Provider capability boundary."));
    card.append(node("span", `connection-status status-${status}`, String(status).replaceAll("_", " ")));
    card.append(node("p", "connection-capabilities", (item.capabilities || []).join(" · ") || "No capabilities advertised."));
    const actions = node("div", "tool-actions");
    actions.append(button("Add connection", () => editConnection({ provider: item.provider, name: item.title || item.provider, capabilities: item.capabilities }), "home-inline-button"));
    const setupUrl = safeExternalUrl(item.setup_url);
    if (setupUrl) {
      const link = node("a", "tool-link", "Secure setup");
      link.href = setupUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; actions.append(link);
    }
    card.append(actions); catalog?.append(card);
  }
  const connections = payload.connections || [];
  if (!connections.length) saved?.append(node("div", "connection-empty", "No connections recorded yet. Add a provider binding to begin."));
  for (const item of connections) {
    const row = node("article", "connection-row");
    const primary = node("div", "connection-primary");
    primary.append(node("strong", "", item.name), node("span", "", `${item.provider} · ${item.scope_kind}${item.scope_id ? ` / ${item.scope_id}` : ""}`));
    const state = node("div", "connection-row-state");
    state.append(node("span", `connection-status status-${item.status}`, connectionStatusLabel(item.status)), node("span", "connection-row-revision", `rev ${item.revision || 0}`));
    const actions = node("div", "connection-row-actions");
    for (const [label, handler, className] of [
      ["Edit", () => editConnection(item), "home-inline-button"],
      ["Verify", () => runConnectionAction("verify", item), "home-inline-button"],
      ["Sync", () => runConnectionAction("sync", item), "home-inline-button"],
      ["Revoke provider access", () => runConnectionAction("revoke", item), "home-inline-button danger-text"],
      ["Remove Frank record", () => runConnectionAction("delete", item), "home-inline-button danger-text"],
    ]) {
      const control = button(label, handler, className); control.dataset.connectionAction = "true"; actions.append(control);
    }
    if (safeVaultRefId(item.credential_ref)) {
      const control = button("Delete vault secret", () => deleteVaultSecret(item), "home-inline-button danger-text");
      control.dataset.connectionAction = "true"; actions.append(control);
    }
    row.append(primary, state, actions); saved?.append(row);
  }
}

async function loadConnections() {
  const [payload, vault, providers, bindings, secrets, attention, activity] = await Promise.all([
    requestJson("/api/connections"),
    requestJson("/api/vault/status").catch(() => ({ status: "unavailable", message: "Secure vault status is unavailable." })),
    requestJson("/api/provider-broker/catalog").catch(() => ({ providers: [] })),
    requestJson("/api/provider-broker/bindings").catch(() => ({ bindings: [] })),
    requestJson("/api/vault/secrets").catch(() => ({ secrets: [] })),
    requestJson("/api/connections/attention?limit=50").catch(() => ({ items: [] })),
    requestJson("/api/connections/activity?limit=50&latest=1").catch(() => ({ items: [] })),
  ]);
  renderConnections(payload, providers, vault, bindings, attention.items || [], activity.items || [], secrets);
  return payload;
}

function syncConnectionScope() {
  clearConnectionSecret();
  const global = $("#connection-scope-kind")?.value === "global";
  const scope = $("#connection-scope-id");
  if (!scope) return;
  scope.disabled = global; scope.required = !global;
  if (global) scope.value = "";
}

function editConnection(item = null) {
  connectionEditId = item?.id || "";
  connectionEditItem = item;
  $("#connection-form-title").textContent = item?.id ? "Edit connection" : "Add connection";
  $("#connection-provider").value = item?.provider || "api";
  $("#connection-name").value = item?.name || "";
  $("#connection-scope-kind").value = item?.scope_kind || "global";
  $("#connection-scope-id").value = item?.scope_id || "";
  $("#connection-ref").value = item?.connection_ref || "";
  $("#connection-admin-url").value = item?.admin_url || "";
  $("#connection-notes").value = item?.notes || "";
  clearConnectionSecret();
  const resend = $("#connection-provider").value === "resend";
  $("#connection-secret-row").hidden = !resend;
  $("#connection-secret-label").firstChild.textContent = item?.id ? "Rotate Resend API key " : "Resend API key ";
  $("#connection-delete").hidden = !item?.id;
  $("#connection-form-error").textContent = "";
  syncConnectionScope();
  openToolEditor($("#connection-editor"), $("#connection-name"));
}

async function applyConnectionPlan(action, item, body = {}) {
  const target = { provider: body.provider || item?.provider || "", connection_id: item?.id || "", project: body.scope_id || item?.scope_id || "", environment: "live" };
  const plan = await requestJson("/api/connections/plan", {
    method: "POST", idempotencyKey: freshIdempotencyKey(`plan-${action}`),
    body: JSON.stringify({ action, target, body, expected_revision: item?.revision ?? null }),
  });
  if (plan.plan?.confirmation_required) {
    const confirmed = window.confirm(`${connectionActionLabel(action)} ${item?.name || "this connection"}? This cannot be undone from Frank.`);
    if (!confirmed) return { cancelled: true };
  }
  const applied = await requestJson("/api/connections/apply", {
    method: "POST", idempotencyKey: freshIdempotencyKey(`apply-${action}`),
    body: JSON.stringify({ plan_id: plan.plan.plan_id, confirmation_token: plan.plan.confirmation_token || "" }),
  });
  const initial = applied.action || {};
  if (applied.pending || ["waiting_for_provider", "running"].includes(initial.state)) {
    $("#connections-status").textContent = "Waiting for Hermes provider receipt…";
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const latest = await requestJson("/api/connections/activity?limit=50&latest=1").catch(() => ({ items: [] }));
      const match = (latest.items || []).find((entry) => entry.correlation_id === initial.correlation_id || entry.correlation_id === plan.plan.plan_id);
      if (match && !["waiting_for_provider", "running", "planned", "awaiting_confirmation"].includes(match.state)) return match;
    }
    return initial;
  }
  return initial;
}

async function runConnectionAction(action, item) {
  if (connectionRequestPending) return;
  setConnectionBusy(true);
  try {
    $("#connections-status").textContent = `${connectionActionLabel(action)} queued…`;
    const result = await applyConnectionPlan(action, item, {});
    if (result?.cancelled) return false;
    await loadConnections();
    $("#connections-status").textContent = `${connectionActionLabel(action)} recorded. Provider truth will appear in the receipt.`;
    return true;
  } catch (error) {
    $("#connections-status").textContent = error.message || "Connection action failed.";
    return false;
  } finally {
    setConnectionBusy(false);
  }
}

async function deleteVaultSecret(item) {
  if (connectionRequestPending) return;
  const refId = safeVaultRefId(item.credential_ref);
  if (!refId) return;
  setConnectionBusy(true);
  let confirmationToken = "";
  let receiptId = "";
  let deletePayload = null;
  try {
    const plan = await requestJson(`/api/vault/secrets/${refId}/delete-plan`, {
      method: "POST", idempotencyKey: freshIdempotencyKey("vault-delete-plan"), body: JSON.stringify({}),
    });
    confirmationToken = typeof plan.confirmation_token === "string" ? plan.confirmation_token : "";
    receiptId = typeof plan.receipt_id === "string" ? plan.receipt_id : "";
    if (!confirmationToken || !receiptId) throw new Error("Secure vault did not return a delete confirmation.");
    const confirmed = window.confirm(`Delete the vault secret for ${item.name}? This removes the secret from the secure vault and leaves the Frank record for reconciliation.`);
    if (!confirmed) return;
    deletePayload = { confirmation_token: confirmationToken, provider_receipt: { receipt_id: receiptId } };
    await requestJson(`/api/vault/secrets/${refId}`, {
      method: "DELETE", idempotencyKey: freshIdempotencyKey("vault-delete"), body: JSON.stringify(deletePayload),
    });
    confirmationToken = "";
    receiptId = "";
    deletePayload.confirmation_token = "";
    deletePayload.provider_receipt = null;
    $("#connections-status").textContent = "Vault secret deleted. The Frank record remains for review.";
    await loadConnections();
  } catch (error) {
    $("#connections-status").textContent = error.message || "Vault secret could not be deleted.";
  } finally {
    confirmationToken = "";
    receiptId = "";
    if (deletePayload) {
      deletePayload.confirmation_token = "";
      deletePayload.provider_receipt = null;
    }
    setConnectionBusy(false);
  }
}

async function rotateResendSecret(item, value) {
  const refId = safeVaultRefId(item?.credential_ref);
  if (!refId) throw new Error("This connection has no vault secret to rotate.");
  await requestJson(`/api/vault/secrets/${refId}/rotate`, { method: "POST", idempotencyKey: freshIdempotencyKey("vault-rotate"), body: JSON.stringify({ secret_value: value }) });
}

async function createResendSecret(fields, value) {
  const scopeKind = fields.scope_kind;
  if (!["global", "project"].includes(scopeKind)) throw new Error("Resend secrets support only Frank-wide or project scope.");
  const scopeId = scopeKind === "project" ? String(fields.scope_id || "").trim() : "";
  if (scopeKind === "project" && !scopeId) throw new Error("Project scope requires a project id.");
  const response = await requestJson("/api/vault/secrets", {
    method: "POST", idempotencyKey: freshIdempotencyKey("vault-create"),
    body: JSON.stringify({ project_id: "frank", environment: "live", secret_path: "/frank/connections", secret_name: "RESEND_API_KEY", scope_kind: scopeKind, scope_id: scopeId, provider: "resend", capabilities: ["email.send", "email.status"], secret_value: value }),
  });
  const ref = response.secret?.ref || "";
  if (!ref) throw new Error("Secure vault did not return an opaque reference.");
  try {
    await requestJson("/api/provider-broker/bindings", {
      method: "POST", idempotencyKey: freshIdempotencyKey("vault-bind"),
      body: JSON.stringify({ vault_ref: ref, provider: "resend", capabilities: ["email.send", "email.status"] }),
    });
  } catch (error) {
    const reconciliation = new Error("Attention: the vault secret was stored but provider binding did not complete. Reconcile the opaque vault reference from Connections.");
    reconciliation.reconciliationRef = ref;
    reconciliation.cause = error;
    throw reconciliation;
  }
  return ref;
}

async function submitConnectionForm(event) {
  event.preventDefault();
  if (connectionRequestPending) return;
  setConnectionBusy(true);
  const secretInput = $("#connection-secret");
  const secret = secretInput?.value || "";
  clearConnectionSecret();
  const fields = {
    provider: $("#connection-provider").value,
    name: $("#connection-name").value,
    scope_kind: $("#connection-scope-kind").value,
    scope_id: $("#connection-scope-id").value,
    connection_ref: $("#connection-ref").value,
    admin_url: $("#connection-admin-url").value,
    capabilities: connectionCapabilities($("#connection-provider").value),
    notes: $("#connection-notes").value,
  };
  try {
    $("#connection-form-error").textContent = "";
    $("#connections-status").textContent = "Preparing secure connection update…";
    if (secret && connectionEditItem?.id) {
      await rotateResendSecret(connectionEditItem, secret);
    } else if (secret && fields.provider !== "resend") {
      throw new Error("Only Resend key entry is supported here; configure other providers in their secure UI.");
    } else if (secret) {
      fields.credential_ref = await createResendSecret(fields, secret);
      fields.status = "connected";
    } else if (!connectionEditId) {
      fields.status = "setup_needed";
    }
    const result = await applyConnectionPlan(connectionEditId ? "update" : "create", connectionEditItem, fields);
    if (result?.cancelled) return;
    closeToolEditor($("#connection-editor"));
    connectionEditId = ""; connectionEditItem = null;
    await loadConnections();
    $("#connections-status").textContent = "Metadata saved. Configured and verified remain separate.";
  } catch (error) {
    $("#connection-form-error").textContent = error.message || "Connection could not be saved.";
    const reconciliationRef = error.reconciliationRef || fields.credential_ref;
    if (reconciliationRef) {
      $("#connections-status").textContent = `Attention: secure vault metadata needs reconciliation. Opaque ref: ${reconciliationRef}`;
    }
  } finally {
    clearConnectionSecret();
    setConnectionBusy(false);
  }
}

async function openConnectionsAgent() {
  try {
    const sessions = await requestJson("/api/chat/sessions");
    let session = (sessions.sessions || []).find((item) => item.title === "Connections Agent");
    if (!session) {
      const created = await requestJson("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title: "Connections Agent" }) });
      session = created.session;
    }
    window.dispatchEvent(new CustomEvent("frank:open-chat-session", { detail: { id: session.id } }));
  } catch (error) { $("#connections-status").textContent = error.message || "Connections Agent session unavailable."; }
}

export async function openConnections(options = {}) {
  clearConnectionSecret();
  setTopActions([button("Add connection", () => editConnection(), "home-action home-action-primary")]);
  $("#connections-status").textContent = "Loading workspace…";
  requestAnimationFrame(() => $("#connections-heading")?.focus({ preventScroll: true }));
  try {
    const payload = await loadConnections();
    $("#connections-status").textContent = "Statuses are recorded in Frank; provider systems and Hermes receipts remain authoritative.";
    if (options?.action === "add" || options?.provider) {
      const provider = String(options.provider || "");
      const catalogItem = (payload.catalog || []).find((item) => item.provider === provider);
      editConnection(catalogItem ? {
        provider: catalogItem.provider,
        name: String(options.name || catalogItem.title || catalogItem.provider),
        capabilities: catalogItem.capabilities || [],
      } : null);
    }
  } catch (error) { $("#connections-status").textContent = error.message || "Connections workspace unavailable."; }
}

export function setupHomePlatform() {
  $("#widget-builder-close")?.addEventListener("click", () => closeToolEditor($("#widget-builder-editor")));
  $("#widget-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const surfaces = [...document.querySelectorAll("[name=widget-surface]:checked")].map((input) => input.value);
    const payload = {
      kind: $("#widget-kind").value,
      title: $("#widget-title").value,
      description: $("#widget-description").value,
      body: $("#widget-body").value,
      label: $("#widget-label").value,
      url: $("#widget-url").value,
      surfaces,
    };
    try {
      await requestJson(builderEditId ? `/api/widgets/${encodeURIComponent(builderEditId)}` : "/api/widgets", {
        method: builderEditId ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      closeToolEditor($("#widget-builder-editor"));
      builderEditId = "";
      await loadWidgetBuilder();
      $("#builder-status").textContent = "Widget saved.";
    } catch (error) {
      $("#widget-form-error").textContent = error.message;
    }
  });
  $("#connection-editor-close")?.addEventListener("click", () => closeToolEditor($("#connection-editor")));
  $("#connection-scope-kind")?.addEventListener("change", syncConnectionScope);
  $("#connection-provider")?.addEventListener("change", () => {
    clearConnectionSecret();
    const resend = $("#connection-provider").value === "resend";
    $("#connection-secret-row").hidden = !resend;
  });
  $("#connection-form")?.addEventListener("submit", submitConnectionForm);
  $("#connection-delete")?.addEventListener("click", async () => {
    if (!connectionEditId || !connectionEditItem) return;
    if (await runConnectionAction("delete", connectionEditItem)) closeToolEditor($("#connection-editor"));
  });
  $("#connection-agent-open")?.addEventListener("click", openConnectionsAgent);
}
