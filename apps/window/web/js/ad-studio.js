import { mountGraphWorkbench } from "../graph/graph-workbench.bundle.js?v=20260822-ad-studio";

const TOOL_ID = "ad-template-generator";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let mounted = false;
let projects = [];
let runs = [];
let selectedRunId = "";
let selectedStage = null;
let graphHandle = null;
let selectedFiles = [];
let vpsPath = "";
let vpsEntries = [];
const selectedVpsFiles = new Map();
const localRunInputs = new Map();
const previewUrls = new Set();
let runEvents = [];
let eventStream = null;
let activePolicy = null;
let modelCatalog = [];
let searchTimer = null;
let modelEditMode = "default";
let remainingRunId = "";
let pendingPolicyOverride = null;
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);

const clean = (value) => String(value || "").trim();
const escapeHtml = (value) => clean(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function runStatusLabel(status) {
  return ({ queued: "Queued", started: "Starting", running: "Running", waiting_for_approval: "Needs approval", completed: "Complete", failed: "Failed", cancelled: "Cancelled", unavailable: "Status unavailable" })[status] || "Starting";
}

function dateLabel(seconds) {
  if (!seconds) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000));
  } catch { return ""; }
}

function activate(tab) {
  $$("[data-ad-tab]").forEach((button) => button.classList.toggle("is-on", button.dataset.adTab === tab));
  $$("[data-ad-panel]").forEach((panel) => panel.classList.toggle("is-on", panel.dataset.adPanel === tab));
  if (tab === "runs") void refreshRunsSafe();
  if (tab === "pipeline") { void refreshRunsSafe(); mountPipeline(); }
  if (tab === "models") void loadModelSettings();
}

function fillProjects() {
  for (const select of [$("#ad-run-project"), $("#ad-pipeline-project"), $("#ad-model-project")]) {
    if (!select) continue;
    const previous = select.value;
    select.replaceChildren();
    for (const project of projects) select.append(new Option(project.name || project.id, project.id));
    if (projects.some((project) => project.id === previous)) select.value = previous;
    else if (projects.some((project) => project.id === "blockwise")) select.value = "blockwise";
  }
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  if (!response.ok) throw new Error("Projects are unavailable");
  const data = await response.json();
  projects = Array.isArray(data.projects) ? data.projects : [];
  fillProjects();
}

function renderSourcePreview() {
  const host = $("#ad-source-preview");
  host.replaceChildren();
  host.classList.toggle("has-items", selectedFiles.length > 0);
  $("#ad-run-mode").textContent = selectedFiles.length > 1 ? `Batch · ${selectedFiles.length}` : "Single";
  selectedFiles.slice(0, 8).forEach((source) => {
    const item = document.createElement("div");
    item.className = "ad-source-item";
    const image = document.createElement("img");
    image.src = source.previewUrl;
    image.alt = source.name;
    const label = document.createElement("span");
    label.textContent = source.kind === "vps" ? `VPS · ${source.name}` : source.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${source.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      selectedFiles = selectedFiles.filter((item) => item.key !== source.key);
      if (source.kind === "local") {
        URL.revokeObjectURL(source.previewUrl);
        previewUrls.delete(source.previewUrl);
      }
      renderSourcePreview();
    });
    item.append(image, label, remove);
    host.append(item);
  });
}

function addLocalFiles(files) {
  const additions = Array.from(files || []).filter((file) => String(file.type || "").startsWith("image/")).map((file) => {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.add(previewUrl);
    return { kind: "local", key: `local:${file.name}:${file.size}:${file.lastModified}`, name: file.name, size: file.size, type: file.type, file, previewUrl };
  });
  const existing = new Set(selectedFiles.map((source) => source.key));
  for (const source of additions) {
    if (existing.has(source.key)) {
      URL.revokeObjectURL(source.previewUrl);
      previewUrls.delete(source.previewUrl);
      continue;
    }
    selectedFiles.push(source);
    existing.add(source.key);
  }
  selectedFiles = selectedFiles.slice(0, 100);
  renderSourcePreview();
}

function vpsPreviewUrl(entry) {
  return `/api/file?root=vps&path=${encodeURIComponent(entry.path)}&raw=1`;
}

function renderVpsCrumbs() {
  const host = $("#ad-source-crumbs");
  host.replaceChildren();
  const root = document.createElement("button");
  root.type = "button";
  root.textContent = "VPS";
  root.addEventListener("click", () => void loadVpsFolder(""));
  host.append(root);
  let accumulated = "";
  for (const segment of vpsPath.split("/").filter(Boolean)) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    const path = accumulated;
    const separator = document.createElement("span");
    separator.textContent = "›";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = segment;
    button.addEventListener("click", () => void loadVpsFolder(path));
    host.append(separator, button);
  }
}

function updateVpsSelectionStatus() {
  const count = selectedVpsFiles.size;
  $("#ad-source-vps-status").textContent = count ? `${count} VPS image${count === 1 ? "" : "s"} selected` : "No VPS images selected";
  $("#ad-source-add-vps").disabled = !count;
}

function renderVpsEntries() {
  const host = $("#ad-source-vps-list");
  const query = clean($("#ad-source-vps-search").value).toLowerCase();
  const entries = vpsEntries;
  host.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "ad-source-vps-empty";
    empty.textContent = query ? "No matching images in the approved VPS folders." : "No folders or images in this folder.";
    host.append(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement(entry.dir ? "button" : "label");
    row.className = "ad-source-vps-row";
    if (entry.dir) row.type = "button";
    const icon = document.createElement("span");
    icon.className = "ad-source-icon";
    icon.textContent = entry.dir ? "▰" : "▧";
    const name = document.createElement("strong");
    name.textContent = entry.name;
    if (entry.dir) {
      const hint = document.createElement("small");
      hint.textContent = "Open";
      row.append(icon, name, hint);
      row.addEventListener("click", () => void loadVpsFolder(entry.path));
    } else {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedVpsFiles.has(entry.path);
      checkbox.setAttribute("aria-label", `Select ${entry.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedVpsFiles.set(entry.path, entry);
        else selectedVpsFiles.delete(entry.path);
        updateVpsSelectionStatus();
      });
      row.append(icon, name, checkbox);
    }
    host.append(row);
  }
}

async function loadVpsFolder(path) {
  vpsPath = path;
  $("#ad-source-vps-search").value = "";
  $("#ad-source-vps-list").innerHTML = '<div class="ad-source-vps-empty">Loading VPS…</div>';
  renderVpsCrumbs();
  try {
    const response = await fetch(`/api/tree?root=vps&path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error("VPS folder unavailable");
    const data = await response.json();
    vpsEntries = (data.entries || []).filter((entry) => entry.dir || IMAGE_EXTENSIONS.has(String(entry.ext || "").toLowerCase()));
    renderVpsEntries();
  } catch {
    vpsEntries = [];
    $("#ad-source-vps-list").innerHTML = '<div class="ad-source-vps-empty">Frank could not read this VPS folder.</div>';
  }
}

async function searchVpsImages(query) {
  if (query.length < 2) {
    await loadVpsFolder(vpsPath);
    return;
  }
  $("#ad-source-vps-list").innerHTML = '<div class="ad-source-vps-empty">Searching the VPS…</div>';
  try {
    const response = await fetch(`/api/tree/search?root=vps&q=${encodeURIComponent(query)}&limit=100`);
    if (!response.ok) throw new Error("search unavailable");
    const data = await response.json();
    vpsEntries = Array.isArray(data.entries) ? data.entries : [];
    renderVpsEntries();
  } catch {
    $("#ad-source-vps-list").innerHTML = '<div class="ad-source-vps-empty">VPS image search is unavailable.</div>';
  }
}

function addSelectedVpsFiles() {
  const existing = new Set(selectedFiles.map((source) => source.key));
  for (const entry of selectedVpsFiles.values()) {
    const key = `vps:${entry.path}`;
    if (existing.has(key)) continue;
    selectedFiles.push({ kind: "vps", key, root: "vps", path: entry.path, name: entry.name, size: entry.size, type: `image/${entry.ext || "unknown"}`, previewUrl: vpsPreviewUrl(entry) });
    existing.add(key);
  }
  selectedFiles = selectedFiles.slice(0, 100);
  selectedVpsFiles.clear();
  updateVpsSelectionStatus();
  renderSourcePreview();
  $("#ad-source-dialog").close();
}

function openSourceDialog() {
  const dialog = $("#ad-source-dialog");
  if (!dialog.open) dialog.showModal();
  void loadVpsFolder(vpsPath);
}

function renderRunOptions() {
  const select = $("#ad-pipeline-run");
  const previous = selectedRunId || select.value;
  select.replaceChildren(new Option("No run selected", ""));
  for (const run of runs) select.append(new Option(run.title || "Ad Studio job", run.id));
  if (runs.some((run) => run.id === previous)) select.value = previous;
  selectedRunId = select.value;
}

function renderRuns() {
  const host = $("#ad-runs-list");
  host.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "ad-empty";
    empty.innerHTML = "<strong>No jobs yet</strong><span>Run a source image to create the first real Ad Studio job.</span>";
    host.append(empty);
    renderRunOptions();
    return;
  }
  for (const run of runs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ad-run-row${run.id === selectedRunId ? " is-on" : ""}`;
    const dot = document.createElement("i");
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "ad-run-row-copy";
    const title = document.createElement("strong");
    title.textContent = String(run.title || "Ad Studio job").replace(/^Ad Studio\s*[·|-]?\s*/, "") || "Job";
    const meta = document.createElement("span");
    const project = projects.find((item) => item.id === run.project_id);
    meta.textContent = `${project?.name || run.project_id || "Workspace"} · ${runStatusLabel(run.status)}`;
    copy.append(title, meta);
    const time = document.createElement("time");
    time.textContent = dateLabel(run.updated_at);
    button.append(dot, copy, time);
    button.addEventListener("click", () => void selectRun(run.id));
    host.append(button);
  }
  renderRunOptions();
}

async function refreshRuns() {
  const projectId = clean($("#ad-run-project")?.value || $("#ad-pipeline-project")?.value);
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`/api/ad-studio/runs${query}`);
  if (!response.ok) throw new Error("Hermes job history is unavailable");
  const data = await response.json();
  runs = (Array.isArray(data.runs) ? data.runs : []).sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  renderRuns();
}

async function refreshRunsSafe() {
  try {
    await refreshRuns();
  } catch {
    const host = $("#ad-runs-list");
    if (host && !host.children.length) host.innerHTML = '<div class="ad-empty"><strong>Jobs unavailable</strong><span>Frank cannot reach Hermes right now.</span></div>';
  }
}

async function selectRun(runId) {
  selectedRunId = runId;
  renderRuns();
  let run = runs.find((item) => item.id === runId);
  if (!run) return;
  try {
    const response = await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}`);
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.run) {
      run = { ...run, ...data.run };
      runs = runs.map((item) => item.id === run.id ? run : item);
      renderRuns();
    }
  } catch { /* keep the last visible status */ }
  renderRunDetail(run);
  connectRunEvents(run);
}

function formatCost(run) {
  const cost = run.cost ?? run.usage?.cost_usd ?? run.output?.cost?.actual_usd ?? run.output?.cost?.reported_usd;
  return Number.isFinite(Number(cost)) ? `$${Number(cost).toFixed(3)}` : "Cost pending";
}

function renderRunDetail(run) {
  const detail = $("#ad-run-detail");
  detail.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "ad-run-summary";
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = run.title || "Ad Studio job";
  const meta = document.createElement("p");
  meta.textContent = `${runStatusLabel(run.status)} · ${run.stage || "source"} · ${Math.round(Number(run.progress || 0) * (Number(run.progress || 0) <= 1 ? 100 : 1))}% · ${formatCost(run)}`;
  copy.append(heading, meta);
  const live = document.createElement("span");
  live.className = "ad-live-state";
  live.textContent = ["completed", "failed", "cancelled"].includes(run.status) ? "Recorded" : "Live";
  summary.append(copy, live);
  detail.append(summary);
  const overview = document.createElement("div");
  overview.className = "ad-overview-grid";
  for (const [label, value] of [["Stage", run.stage || "Source"], ["Policy", run.policy_revision ? `Revision ${run.policy_revision}` : "Pinned"], ["Model", run.current_model || "Deterministic / pending"], ["Trace", run.trace_id ? run.trace_id.slice(0, 12) : "Pending"]]) {
    const card = document.createElement("div");
    const small = document.createElement("span"); small.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    card.append(small, strong); overview.append(card);
  }
  detail.append(overview);
  if (run.status === "completed" && run.output?.template_pack_ref) {
    const release = document.createElement("section"); release.className = "ad-approval";
    const title = document.createElement("strong"); title.textContent = "Portable TemplatePack released";
    const evidence = document.createElement("p"); evidence.textContent = `Checksum ${run.output.sha256 || run.output.checksum || "unavailable"} · signature ${typeof run.output.signature === "object" ? run.output.signature.key_id || run.output.signature.algorithm || "recorded" : "recorded"} · ${Array.isArray(run.output.compatibility) ? run.output.compatibility.join(", ") : "compatibility recorded"}`;
    const download = document.createElement("a"); download.className = "ad-primary"; download.href = `/api/ad-studio/runs/${encodeURIComponent(run.id)}/download`; download.textContent = "Download TemplatePack";
    release.append(title, evidence, download); detail.append(release);
  }
  if (run.attention || run.error) {
    const attention = document.createElement("div"); attention.className = "ad-attention";
    attention.textContent = run.error || "This job needs attention."; detail.append(attention);
  }
  const preview = run.output?.preview || run.output?.previews?.[0];
  if (preview?.url || typeof preview === "string") {
    const image = document.createElement("img"); image.className = "ad-latest-preview";
    image.src = preview.url || preview; image.alt = "Latest generated preview"; detail.append(image);
  }
  const activity = document.createElement("section");
  activity.className = "ad-live-activity";
  activity.innerHTML = '<div class="ad-section-heading"><div><span>Live activity</span><h3>What Hermes is doing</h3></div></div><div id="ad-run-events"></div>';
  detail.append(activity);
  if (run.status === "waiting_for_approval") {
    const gate = document.createElement("form"); gate.className = "ad-approval";
    gate.innerHTML = '<strong>Studio QA approval</strong><label><input type="checkbox" required> I inspected the previews at 100% zoom</label><textarea maxlength="600" placeholder="Approval note (optional)"></textarea><button class="ad-primary" type="submit">Approve and release</button>';
    gate.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve", confirm_100_percent: true, reason: clean(gate.querySelector("textarea").value) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Approval failed");
      await selectRun(run.id);
    });
    detail.append(gate);
  }
  if (!["completed", "cancelled"].includes(run.status)) {
    const actions = document.createElement("div"); actions.className = "ad-run-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ad-text-button"; cancel.textContent = "Cancel job";
    cancel.addEventListener("click", async () => { await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await selectRun(run.id); });
    const models = document.createElement("button"); models.type = "button"; models.className = "ad-text-button"; models.textContent = "Change remaining models";
    models.addEventListener("click", () => { modelEditMode = "remaining"; remainingRunId = run.id; activePolicy = { revision: run.policy_revision, policy: structuredClone(run.policy) }; activate("models"); });
    if (run.status === "failed") {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "ad-primary"; retry.textContent = "Retry from checkpoint";
      retry.addEventListener("click", async () => { await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_stage: run.stage }) }); await selectRun(run.id); });
      actions.append(retry);
    }
    actions.append(models, cancel); detail.append(actions);
  }
  $("#ad-pipeline-run").value = run.id;
  updateEvidence();
  renderEventViews();
}

const EVENT_KINDS = ["command.accepted", "command.queued", "command.cancel-requested", "run.recovered", "run.interrupted", "run.failed", "run.cancelled", "stage.started", "provider.attempt", "provider.fallback", "tool.started", "tool.completed", "subagent.start", "subagent.complete", "approval.requested", "approval.approved", "approval.rejected", "model-policy.changed", "release.published"];

const SAFE_TOOL_LABELS = {
  terminal: "VPS command",
  exec_command: "VPS command",
  execute_code: "VPS calculation",
  read_file: "Inspect private artifact",
  write_file: "Create private artifact",
  search_files: "Find builder assets",
  skill_view: "Load builder instructions",
  browser: "Browser check",
};

function redactOperatorText(value) {
  return clean(value)
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[private path]")
    .replace(/\/(?:home|srv|opt|projects|root|tmp|var|etc)\/[^\s"']+/g, "[private path]")
    .replace(/\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .slice(0, 240);
}

function safeEventData(event) {
  const data = event?.data || {};
  if (event.kind === "provider.attempt") return { attempt: data.attempt, provider: data.provider, model: data.model, timeout_seconds: data.timeout_seconds };
  if (event.kind === "provider.fallback") return { attempt: data.attempt, from_model: data.from_model, to_model: data.to_model, reason: redactOperatorText(data.reason) };
  if (event.kind === "stage.started") return { summary: `Started ${String(event.node_id || "pipeline stage").replaceAll("-", " ")}` };
  if (event.kind === "tool.started" || event.kind === "tool.completed") return { tool: SAFE_TOOL_LABELS[data.tool] || "VPS builder tool", duration_seconds: data.duration_seconds, error: Boolean(data.error) };
  if (event.kind === "run.failed") return { error: redactOperatorText(data.error) || "Run failed; protected diagnostics remain in Hermes." };
  if (event.kind === "release.published") return { release_id: data.release_id, template_pack_ref: data.template_pack_ref, sha256: data.sha256, compatibility: data.compatibility };
  return Object.fromEntries(Object.entries(data).filter(([key]) => ["attempt", "provider", "model", "cost_usd", "input_tokens", "output_tokens", "gate", "choices", "policy_revision", "will_resume", "release_id", "sha256", "compatibility"].includes(key)));
}

function safeEventSummary(event) {
  const data = safeEventData(event);
  if (event.kind === "tool.started" || event.kind === "tool.completed") return data.tool;
  if (event.kind === "stage.started") return data.summary;
  if (event.kind === "provider.attempt") return `${data.provider || "provider"} · ${data.model || "model"} · attempt ${data.attempt || 1}`;
  if (event.kind === "provider.fallback") return `${data.from_model || "model"} → ${data.to_model || "fallback"}`;
  if (event.kind === "run.failed") return data.error;
  return event.node_id || data.gate || data.release_id || "Recorded";
}

function safeEventForTrace(event) {
  return { sequence: event.sequence, timestamp: event.timestamp, kind: event.kind, status: event.status, node_id: event.node_id, trace_id: event.trace_id, data: safeEventData(event) };
}

function renderEventViews() {
  const host = $("#ad-run-events");
  if (host) {
    host.replaceChildren();
    const visible = runEvents.slice(-24);
    if (!visible.length) host.innerHTML = '<p class="ad-evidence-empty">Waiting for the first durable event…</p>';
    for (const event of visible) {
      const row = document.createElement("div"); row.className = `ad-event ad-event-${event.status || "ok"}`;
      const time = document.createElement("time"); time.textContent = new Date(Number(event.timestamp || 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const copy = document.createElement("div");
      const strong = document.createElement("strong"); strong.textContent = String(event.kind || "activity").replaceAll(".", " · ");
      const p = document.createElement("p"); p.textContent = safeEventSummary(event);
      copy.append(strong, p); row.append(time, copy); host.append(row);
    }
  }
  const trace = $("#ad-full-trace");
  if (trace) trace.textContent = runEvents.length ? JSON.stringify(runEvents.map(safeEventForTrace), null, 2) : "No events have been recorded for this run yet.";
  updateEvidence();
}

function connectRunEvents(run) {
  eventStream?.close();
  runEvents = [];
  renderEventViews();
  const stream = new EventSource(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/events?after=-1`);
  eventStream = stream;
  const receive = (event) => {
    try {
      const item = JSON.parse(event.data);
      if (!runEvents.some((existing) => existing.sequence === item.sequence)) runEvents.push(item);
      if (item.kind === "stage.started" && item.node_id) {
        run.stage = item.node_id;
        const order = ["source", "analyse", "decompose", "restyle", "story-draft", "check", "subject-invariance", "studio-qa", "ready", "release"];
        run.progress = Math.max(Number(run.progress || 0), Math.max(0, order.indexOf(item.node_id)) / order.length);
      }
      if (item.kind === "provider.attempt") { run.current_model = item.data?.model || run.current_model; run.current_provider = item.data?.provider || run.current_provider; }
      renderRunDetail(run);
      if (["run.failed", "run.cancelled", "approval.requested", "release.published"].includes(item.kind)) void refreshRunsSafe().then(() => {
        const updated = runs.find((candidate) => candidate.id === run.id);
        if (updated) renderRunDetail(updated);
      });
    } catch { /* a keepalive contains no event data */ }
  };
  for (const kind of EVENT_KINDS) stream.addEventListener(kind, receive);
  stream.onopen = () => { const state = $("#ad-live-state"); if (state) state.textContent = "Live"; };
  stream.onerror = () => { const state = $("#ad-live-state"); if (state) state.textContent = "Reconnecting…"; };
}

async function loadScopedGraph({ entityId, lens }) {
  const projectId = clean($("#ad-pipeline-project").value);
  if (!projectId) throw new Error("Choose a project to view this pipeline.");
  const query = new URLSearchParams({ lens, scope_kind: "project", scope_id: projectId });
  const response = await fetch(`/api/graphs/tool/${encodeURIComponent(entityId)}?${query}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Pipeline is unavailable.");
  return payload;
}

function mountPipeline() {
  const root = $("#ad-pipeline-graph");
  const panel = $("[data-ad-panel=\"pipeline\"]");
  if (!root || !panel.classList.contains("is-on")) return;
  graphHandle?.destroy();
  graphHandle = mountGraphWorkbench(root, {
    entityId: TOOL_ID,
    title: "Pipeline",
    load: loadScopedGraph,
    onSelect(node) {
      selectedStage = node;
      $("#ad-stage-name").textContent = node.label;
      $("#ad-stage-kind").textContent = node.kind;
      updateEvidence();
    },
  });
}

function updateEvidence() {
  const input = $("#ad-stage-input");
  const output = $("#ad-stage-output");
  input.replaceChildren();
  output.replaceChildren();
  const local = localRunInputs.get(selectedRunId);
  const stageEvents = runEvents.filter((event) => !selectedStage || event.node_id === selectedStage.source_id);
  if (selectedStage?.source_id === "source" && local?.url) {
    const image = document.createElement("img");
    image.src = local.url;
    image.alt = local.name || "Source image";
    input.append(image);
  } else {
    input.textContent = selectedStage && selectedRunId ? "Private inputs stay in Hermes; only safe evidence is shown here." : "Select a real run and stage to see its safe evidence.";
  }
  output.textContent = stageEvents.length ? JSON.stringify(stageEvents.map((event) => ({ kind: event.kind, status: event.status, data: event.data })), null, 2) : "No correlated output is available yet.";
  const inspector = $("#ad-stage-events");
  if (inspector) inspector.textContent = stageEvents.length ? `${stageEvents.length} correlated event${stageEvents.length === 1 ? "" : "s"} recorded for this stage.` : "No events recorded for this stage yet.";
}

function requestEvent(name, detail) {
  return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, resolve, reject } })));
}

function setupRunForm() {
  const input = $("#ad-source-files");
  const drop = $("#ad-drop");
  input.addEventListener("change", () => {
    addLocalFiles(input.files);
    input.value = "";
    $("#ad-source-dialog").close();
  });
  drop.addEventListener("click", openSourceDialog);
  $("#ad-source-device").addEventListener("click", () => input.click());
  $("#ad-source-close").addEventListener("click", () => $("#ad-source-dialog").close());
  $("#ad-source-cancel").addEventListener("click", () => $("#ad-source-dialog").close());
  $("#ad-source-add-vps").addEventListener("click", addSelectedVpsFiles);
  $("#ad-source-vps-search").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void searchVpsImages(clean(event.target.value).toLowerCase()), 250);
  });
  $("#ad-run-project").addEventListener("change", () => { void loadActivePolicy(); void refreshRunsSafe(); });
  $("#ad-run-models").addEventListener("click", () => { modelEditMode = "one-run"; remainingRunId = ""; activate("models"); });
  for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("is-drag"); });
  for (const type of ["dragleave", "drop"]) drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("is-drag");
    if (type === "drop") addLocalFiles(event.dataTransfer?.files);
  });
  $("#ad-run-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#ad-run-status");
    const submit = $("#ad-run-submit");
    status.classList.remove("is-error");
    if (!selectedFiles.length) {
      status.textContent = "Choose at least one source image.";
      status.classList.add("is-error");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Starting…";
    status.textContent = "Uploading sources and starting Hermes…";
    try {
      const placements = $$('input[name="ad-placement"]:checked').map((item) => item.value);
      const result = await requestEvent("frank:ad-studio-run", {
        sources: selectedFiles.slice(), projectId: $("#ad-run-project").value,
        name: clean($("#ad-run-name").value), brief: clean($("#ad-run-brief").value), placements,
        policyRevision: clean($("#ad-run-policy-revision").value), policyOverride: pendingPolicyOverride,
      });
      const run = result.run;
      const first = selectedFiles[0];
      localRunInputs.set(run.id, { url: first.previewUrl, name: first.name });
      selectedRunId = run.id;
      pendingPolicyOverride = null;
      status.textContent = `${result.runs.length} background job${result.runs.length === 1 ? "" : "s"} started. You can close Frank; Hermes will keep working.`;
      await refreshRunsSafe();
      activate("runs");
      await selectRun(run.id);
    } catch (error) {
      status.textContent = error.message || "The job could not be started.";
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Run job";
    }
  });
}

function setupPipelineForm() {
  $("#ad-pipeline-project").addEventListener("change", mountPipeline);
  $("#ad-pipeline-run").addEventListener("change", (event) => { selectedRunId = event.target.value; if (selectedRunId) void selectRun(selectedRunId); else updateEvidence(); });
}

function normalizeModels(payload) {
  const inventory = payload?.data || payload?.models || payload?.options || [];
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const capabilities = Array.isArray(payload?.ad_studio_capabilities) ? payload.ad_studio_capabilities : [];
  const providerModels = providers.flatMap((provider) => {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    return models.map((model) => ({
      model: typeof model === "string" ? model : (model?.model || model?.id || model?.name),
      provider: provider.slug || provider.id || provider.name,
      available: provider.authenticated ?? provider.configured ?? false,
      capabilities: typeof model === "object" ? (model.capabilities || []) : [],
    }));
  });
  const source = [...providerModels, ...(Array.isArray(inventory) ? inventory : []), ...capabilities];
  const normalized = source.map((item) => ({
    model: clean(item.model || item.id || item.value || item.name),
    provider: clean(item.provider || item.provider_id || item.gateway || "custom"),
    available: item.available ?? item.configured ?? null,
    capabilities: item.capabilities || item.input_modalities || [],
    price: item.estimated_price || item.price || item.pricing || null,
    checkedAt: item.price_checked_at || item.pricing_checked_at || "",
    pricingStale: item.pricing_stale === true,
  })).filter((item) => item.model);
  const merged = new Map();
  for (const item of normalized) {
    const key = `${item.provider}/${item.model}`;
    const previous = merged.get(key) || {};
    merged.set(key, { ...previous, ...item, available: item.available ?? previous.available ?? null, capabilities: item.capabilities?.length ? item.capabilities : (previous.capabilities || []) });
  }
  return [...merged.values()];
}

function modelReadiness(candidate) {
  const match = modelCatalog.find((item) => item.model === candidate.model && (!candidate.provider || item.provider === candidate.provider));
  if (!match) return "Custom model · compatibility checked when saved";
  const price = match.price ? ` · price ${typeof match.price === "string" ? match.price : "available"}` : " · price unknown";
  const readiness = match.available === true ? "Credential ready" : match.available === false ? "Credential not ready" : "Credential readiness unknown";
  const timestamp = match.checkedAt ? ` · ${match.pricingStale ? "price last checked" : "checked"} ${match.checkedAt}` : "";
  return `${readiness}${price}${timestamp}`;
}

function renderActivePolicySummary() {
  const host = $("#ad-run-policy-summary");
  if (!host) return;
  const strong = host.querySelector("strong");
  if (!activePolicy) { strong.textContent = "Policy unavailable"; return; }
  const policy = activePolicy.policy || {};
  const ceiling = Object.values(policy.stages || {}).reduce((sum, stage) => sum + Number(stage.max_cost_usd || 0), 0);
  strong.textContent = `${policy.name || policy.preset || "Ad Studio policy"} · revision ${activePolicy.revision} · cost ceiling $${ceiling.toFixed(2)}`;
  $("#ad-run-policy-revision").value = activePolicy.revision || "";
}

async function loadActivePolicy() {
  const projectId = clean($("#ad-run-project")?.value || $("#ad-model-project")?.value);
  if (!projectId) return;
  const response = await fetch(`/api/ad-studio/model-policies?project_id=${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error("Model policy is unavailable");
  const data = await response.json();
  const records = Array.isArray(data.data) ? data.data : Array.isArray(data.policies) ? data.policies : [];
  activePolicy = records.find((item) => item.is_default) || records[0] || null;
  renderActivePolicySummary();
}

function renderModelSettings() {
  const host = $("#ad-model-stage-list");
  host.replaceChildren();
  const stages = activePolicy?.policy?.stages || {};
  const labels = { analyse: "Analyse and vision extraction", "masked-text-cleanup": "Masked text cleanup", "story-extend": "Optional story-margin extension", "visual-qa": "Visual QA and critic" };
  for (const [stageId, stage] of Object.entries(stages)) {
    const card = document.createElement("section");
    card.className = "ad-model-stage"; card.dataset.stage = stageId; card.dataset.capability = stage.capability;
    const fallbacks = (stage.fallbacks || []).map((item) => `${item.provider}/${item.model}`).join("\n");
    card.innerHTML = `
      <header><div><span>${stage.optional ? "Optional AI stage" : "AI stage"}</span><h4>${escapeHtml(labels[stageId] || stageId)}</h4></div><code>${escapeHtml(stage.capability)}</code></header>
      <div class="ad-model-grid">
        <label>Provider<input data-field="provider" value="${escapeHtml(stage.primary?.provider || "")}" maxlength="80" list="ad-provider-options"></label>
        <label>Primary model<input data-field="model" value="${escapeHtml(stage.primary?.model || "")}" maxlength="200" list="ad-model-options"></label>
        <label>Maximum attempts<input data-field="attempts" type="number" min="1" max="10" value="${stage.max_attempts || 1}"></label>
        <label>Timeout (seconds)<input data-field="timeout" type="number" min="1" value="${stage.timeout_seconds || 120}"></label>
        <label>Cost limit (USD)<input data-field="cost" type="number" min="0" step="0.01" value="${stage.max_cost_usd ?? 0}"></label>
      </div>
      <label>Fallbacks <span>one provider/model per line, in order</span><textarea data-field="fallbacks" rows="3">${escapeHtml(fallbacks)}</textarea></label>
      <p class="ad-model-readiness">${escapeHtml(modelReadiness(stage.primary || {}))}</p>`;
    host.append(card);
  }
  let datalist = $("#ad-model-options");
  if (!datalist) { datalist = document.createElement("datalist"); datalist.id = "ad-model-options"; document.body.append(datalist); }
  datalist.replaceChildren(...modelCatalog.map((item) => { const option = document.createElement("option"); option.value = item.model; option.label = `${item.provider} · ${item.available === true ? "ready" : item.available === false ? "not ready" : "readiness unknown"}`; return option; }));
  let providerList = $("#ad-provider-options");
  if (!providerList) { providerList = document.createElement("datalist"); providerList.id = "ad-provider-options"; document.body.append(providerList); }
  providerList.replaceChildren(...[...new Set(modelCatalog.map((item) => item.provider).filter(Boolean))].sort().map((provider) => { const option = document.createElement("option"); option.value = provider; return option; }));
}

function policyFromForm() {
  const policy = structuredClone(activePolicy.policy);
  const candidate = (provider, model) => {
    const result = { provider, model };
    const catalog = modelCatalog.find((item) => item.model === model && (!provider || item.provider === provider));
    if (catalog && Array.isArray(catalog.capabilities) && catalog.capabilities.length) {
      result.capabilities = catalog.capabilities;
      result.capability_verified = true;
    }
    return result;
  };
  policy.preset = $("[data-ad-preset].is-on")?.dataset.adPreset || "balanced";
  policy.name = `${policy.preset.replaceAll("-", " ")} routing`;
  for (const card of $$(".ad-model-stage")) {
    const get = (field) => clean(card.querySelector(`[data-field="${field}"]`).value);
    policy.stages[card.dataset.stage] = {
      ...policy.stages[card.dataset.stage], capability: card.dataset.capability,
      primary: candidate(get("provider"), get("model")),
      fallbacks: get("fallbacks").split(/\n+/).map(clean).filter(Boolean).map((line) => { const slash = line.indexOf("/"); return slash > 0 ? candidate(line.slice(0, slash).trim(), line.slice(slash + 1).trim()) : candidate("custom", line); }),
      max_attempts: Number(get("attempts")), timeout_seconds: Number(get("timeout")), max_cost_usd: Number(get("cost")),
    };
  }
  return policy;
}

async function loadModelSettings() {
  const status = $("#ad-model-status");
  try {
    const tasks = [fetch("/api/ad-studio/models")];
    if (modelEditMode !== "remaining") tasks.push(loadActivePolicy());
    const [modelsResponse] = await Promise.all(tasks);
    if (modelsResponse.ok) modelCatalog = normalizeModels(await modelsResponse.json());
    renderModelSettings();
    status.textContent = activePolicy ? (modelEditMode === "one-run" ? "Edit this routing, then use it once without changing the project default." : modelEditMode === "remaining" ? `Only stages not yet started in ${remainingRunId.slice(0, 14)}… will change.` : `Revision ${activePolicy.revision} is active. Pricing checked ${activePolicy.policy?.pricing_checked_at || "at an unknown time"}.`) : "No active model policy.";
  } catch (error) { status.textContent = error.message || "Model settings are unavailable"; status.classList.add("is-error"); }
}

function setupModelForm() {
  $("#ad-model-project").addEventListener("change", () => void loadModelSettings());
  for (const button of $$("[data-ad-preset]")) button.addEventListener("click", () => {
    $$("[data-ad-preset]").forEach((item) => item.classList.toggle("is-on", item === button));
  });
  $("#ad-model-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#ad-model-status"); status.classList.remove("is-error");
    const submit = event.submitter; submit.disabled = true;
    try {
      const policy = policyFromForm();
      if (modelEditMode === "one-run") {
        pendingPolicyOverride = policy;
        const summary = $("#ad-run-policy-summary strong");
        if (summary) summary.textContent = `${policy.name || "Custom routing"} · one-run override · project default unchanged`;
        status.textContent = "One-run override ready. It will be pinned when you start the next job.";
        modelEditMode = "default";
        activate("run");
        return;
      }
      const changingRemaining = modelEditMode === "remaining";
      const url = changingRemaining ? `/api/ad-studio/runs/${encodeURIComponent(remainingRunId)}/models` : "/api/ad-studio/model-policies";
      const body = changingRemaining ? { policy, reason: "Operator changed remaining stages in Frank" } : { project_id: $("#ad-model-project").value, policy };
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Policy could not be saved");
      if (changingRemaining) {
        const runId = remainingRunId; remainingRunId = ""; modelEditMode = "default";
        activate("runs"); await selectRun(runId);
      } else {
        activePolicy = data; renderActivePolicySummary(); renderModelSettings();
        status.textContent = `Revision ${data.revision} saved. Future jobs will pin it.`;
      }
    } catch (error) { status.textContent = error.message || "Policy could not be saved"; status.classList.add("is-error"); }
    finally { submit.disabled = false; }
  });
}

export function mountAdStudio() {
  if (mounted) { void refreshRunsSafe(); return; }
  mounted = true;
  $$("[data-ad-tab]").forEach((button) => button.addEventListener("click", () => { if (button.dataset.adTab === "models") { modelEditMode = "default"; remainingRunId = ""; } activate(button.dataset.adTab); }));
  setupRunForm();
  setupPipelineForm();
  setupModelForm();
  void loadProjects().then(async () => {
    await loadActivePolicy();
    await refreshRunsSafe();
    if ($("[data-ad-panel=\"pipeline\"]").classList.contains("is-on")) mountPipeline();
  }).catch((error) => {
    $("#ad-run-status").textContent = error.message || "Ad Studio could not load.";
    $("#ad-run-status").classList.add("is-error");
  });
  window.addEventListener("beforeunload", () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
  window.addEventListener("online", () => void refreshRunsSafe());
}
