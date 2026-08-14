const $ = (selector, root = document) => root.querySelector(selector);

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
};

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
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
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
  window.clearInterval(homeState.refreshTimer);
  homeState.refreshTimer = null;
  setTopActions();
}

function manifestFor(widgetId) {
  return homeState.catalog.find((item) => item.id === widgetId);
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
  if (homeState.home?.entity.kind === "tool" && homeState.home?.entity.id === "connections") {
    controls.push(button("Manage connections", () => window.dispatchEvent(new CustomEvent("frank:connections")), "home-action home-action-primary"));
  }
  if (!homeState.editing) {
    controls.push(button("Add widget", () => beginEditing(true)));
    controls.push(button("Edit layout", () => beginEditing(false), "home-action home-action-primary"));
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
  [homeState.draft[index], homeState.draft[next]] = [homeState.draft[next], homeState.draft[index]];
  renderHome();
}

function resizeInstance(instanceId) {
  const item = homeState.draft.find((entry) => entry.instance_id === instanceId);
  const manifest = manifestFor(item?.widget_id);
  if (!item || !manifest) return;
  const sizes = manifest.allowed_sizes || ["medium"];
  item.size = sizes[(sizes.indexOf(item.size) + 1) % sizes.length];
  renderHome();
}

function removeInstance(instanceId) {
  homeState.draft = homeState.draft.filter((item) => item.instance_id !== instanceId);
  renderHome();
}

function addInstance(widgetId) {
  const manifest = manifestFor(widgetId);
  if (!manifest || !manifest.surfaces?.includes(homeState.home.entity.kind)) return;
  if (!manifest.multiple && homeState.draft.some((item) => item.widget_id === widgetId)) {
    setHomeMessage(`${manifest.title} is already on this home.`, "error");
    return;
  }
  if (homeState.draft.length >= homeState.home.max_widgets) {
    setHomeMessage(`A home supports at most ${homeState.home.max_widgets} widgets.`, "error");
    return;
  }
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  homeState.draft.push({ instance_id: `${widgetId.slice(0, 60)}-${suffix}`, widget_id: widgetId, size: manifest.default_size, config: {} });
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
  for (const item of homeState.connections.filter((connection) => connection.scope_kind === "global" || (connection.scope_kind === homeState.home.entity.kind && connection.scope_id === homeState.home.entity.id))) {
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

function renderSnapshot(body, snapshot) {
  body.replaceChildren();
  const summary = node("p", "home-summary", snapshot.summary || "No summary available.");
  const status = node("span", `home-status-pill status-${snapshot.status || "unavailable"}`, String(snapshot.status || "unavailable").replaceAll("_", " "));
  body.append(status, summary);

  const data = snapshot.data || {};
  const metrics = [];
  if (Number.isInteger(data.customers)) metrics.push(["Customers", data.customers]);
  if (Number.isInteger(data.attention)) metrics.push(["Attention", data.attention]);
  if (Number.isInteger(data.running)) metrics.push(["Running", data.running]);
  if (Number.isInteger(data.waiting)) metrics.push(["Waiting", data.waiting]);
  if (data.branch) metrics.push(["Branch", data.branch]);
  if (metrics.length) {
    const grid = node("div", "home-metrics");
    for (const [label, value] of metrics) {
      const metric = node("div", "home-metric");
      metric.append(node("strong", "", String(value)), node("span", "", label));
      grid.append(metric);
    }
    body.append(grid);
  }
  if (data.description) body.append(node("p", "quiet", data.description));
  if (Array.isArray(data.connections) && data.connections.length) {
    const rows = node("ul", "home-data-rows");
    for (const item of data.connections) {
      const row = node("li");
      row.append(node("strong", "", item.name || item.provider), node("span", "", String(item.status || "").replace("_", " ")));
      rows.append(row);
    }
    body.append(rows);
  }
  if (data.status_is_recorded) body.append(node("p", "home-truth", "Recorded in Frank; the provider remains authoritative."));
  if (Array.isArray(snapshot.links) && snapshot.links.length) {
    const links = node("div", "home-links");
    for (const item of snapshot.links) {
      if (!String(item.url || "").startsWith("https://")) continue;
      const link = node("a", "tool-link", item.label || "Open");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      links.append(link);
    }
    body.append(links);
  }
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
    renderSnapshot(body, snapshot);
  } catch (error) {
    if (generation !== homeState.generation || !card.isConnected) return;
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
  const available = homeState.catalog.filter((item) => item.surfaces?.includes(homeState.home.entity.kind));
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

function renderHome() {
  if (!homeState.host || !homeState.home) return;
  homeControls();
  const host = homeState.host;
  host.replaceChildren();
  host.classList.add("home-grid");
  const instances = homeState.editing ? homeState.draft : homeState.home.instances;
  const generation = homeState.generation;
  if (!instances.length) {
    const empty = node("section", "home-empty");
    empty.append(node("h2", "", "This home is empty"), node("p", "", "Add a widget to start this home."), button("Add widget", () => beginEditing(true), "home-action home-action-primary"));
    host.append(empty);
  } else {
    instances.forEach((instance, index) => host.append(widgetCard(instance, index, generation)));
  }
  if (homeState.editing && homeState.gallery) host.append(gallery());
  scheduleHomeRefresh();
}

async function openHome(kind, id, host) {
  homeState.controller?.abort();
  window.clearInterval(homeState.refreshTimer);
  homeState.refreshTimer = null;
  const controller = new AbortController();
  const generation = ++homeState.generation;
  homeState.controller = controller;
  homeState.host = host;
  homeState.home = null;
  homeState.editing = false;
  homeState.gallery = false;
  homeState.savePending = false;
  host.classList.add("home-grid");
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
    host.replaceChildren(node("p", "home-error", error.message || "Home unavailable."));
    setHomeMessage("Home unavailable.", "error");
  }
}

export function openProjectHome(project) {
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

function renderConnections(payload) {
  const catalog = $("#connection-catalog");
  const saved = $("#connection-list");
  catalog.replaceChildren();
  saved.replaceChildren();
  for (const item of payload.catalog || []) {
    const card = node("article", "w-card connection-catalog-card");
    card.append(node("span", "home-provider", item.provider), node("h3", "", item.title), node("p", "", item.description));
    const capabilities = node("p", "connection-capabilities", (item.capabilities || []).join(" · "));
    const actions = node("div", "tool-actions");
    actions.append(button("Add connection", () => editConnection({ provider: item.provider, name: item.title, capabilities: item.capabilities }), "home-inline-button"));
    if (item.setup_url) {
      const link = node("a", "tool-link", "Secure setup");
      link.href = item.setup_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      actions.append(link);
    }
    if (item.provider === "activepieces") card.append(node("p", "home-truth", "Credentials are configured in Activepieces. A future Hermes adapter will read MCP status only."));
    card.append(capabilities, actions);
    catalog.append(card);
  }
  if (!(payload.connections || []).length) {
    saved.append(node("div", "connection-empty", "No connections recorded yet."));
  }
  for (const item of payload.connections || []) {
    const row = button("", () => editConnection(item), "connection-row");
    const primary = node("span", "connection-primary");
    primary.append(node("strong", "", item.name), node("span", "", `${item.provider} · ${item.scope_kind}${item.scope_id ? ` / ${item.scope_id}` : ""}`));
    const status = node("span", `connection-status status-${item.status}`, connectionStatusLabel(item.status));
    row.append(primary, status);
    saved.append(row);
  }
}

async function loadConnections() {
  const payload = await requestJson("/api/connections");
  renderConnections(payload);
  return payload;
}

function editConnection(item = null) {
  connectionEditId = item?.id || "";
  $("#connection-form-title").textContent = item?.id ? "Edit connection" : "Add connection";
  $("#connection-provider").value = item?.provider || "api";
  $("#connection-name").value = item?.name || "";
  $("#connection-scope-kind").value = item?.scope_kind || "global";
  $("#connection-scope-id").value = item?.scope_id || "";
  $("#connection-status-field").value = item?.status || "setup_needed";
  $("#connection-ref").value = item?.connection_ref || "";
  $("#connection-credential-ref").value = item?.credential_ref || "";
  $("#connection-admin-url").value = item?.admin_url || "";
  $("#connection-capabilities").value = (item?.capabilities || []).join(", ");
  $("#connection-notes").value = item?.notes || "";
  $("#connection-delete").hidden = !item?.id;
  syncConnectionScope();
  $("#connection-form-error").textContent = "";
  openToolEditor($("#connection-editor"), $("#connection-name"));
}

function syncConnectionScope() {
  const global = $("#connection-scope-kind").value === "global";
  $("#connection-scope-id").disabled = global;
  $("#connection-scope-id").required = !global;
  if (global) $("#connection-scope-id").value = "";
}

export async function openConnections() {
  setTopActions([button("Add connection", () => editConnection(), "home-action home-action-primary")]);
  $("#connections-status").textContent = "Loading connection catalog…";
  try {
    await loadConnections();
    $("#connections-status").textContent = "Statuses are recorded in Frank; provider systems remain authoritative.";
  } catch (error) {
    $("#connections-status").textContent = error.message;
  }
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
  $("#connection-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const capabilities = $("#connection-capabilities").value.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    const payload = {
      provider: $("#connection-provider").value,
      name: $("#connection-name").value,
      scope_kind: $("#connection-scope-kind").value,
      scope_id: $("#connection-scope-id").value,
      status: $("#connection-status-field").value,
      connection_ref: $("#connection-ref").value,
      credential_ref: $("#connection-credential-ref").value,
      admin_url: $("#connection-admin-url").value,
      capabilities,
      notes: $("#connection-notes").value,
    };
    try {
      await requestJson(connectionEditId ? `/api/connections/${encodeURIComponent(connectionEditId)}` : "/api/connections", {
        method: connectionEditId ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      closeToolEditor($("#connection-editor"));
      connectionEditId = "";
      await loadConnections();
      $("#connections-status").textContent = "Connection metadata saved. Provider configuration was not changed.";
    } catch (error) {
      $("#connection-form-error").textContent = error.message;
    }
  });
  $("#connection-delete")?.addEventListener("click", async () => {
    if (!connectionEditId || !window.confirm("Remove this connection record? Provider credentials and configuration are not changed.")) return;
    try {
      await requestJson(`/api/connections/${encodeURIComponent(connectionEditId)}`, { method: "DELETE" });
      closeToolEditor($("#connection-editor"));
      connectionEditId = "";
      await loadConnections();
      $("#connections-status").textContent = "Connection record removed. Provider configuration was not changed.";
    } catch (error) {
      $("#connection-form-error").textContent = error.message;
    }
  });
}
