import { mountGraphWorkbench } from "../graph/graph-workbench.bundle.js?v=20260822-ad-studio";

const TOOL_ID = "ad-template-generator";
const RUN_PREFIX = "Ad Studio";
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
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);

const clean = (value) => String(value || "").trim();

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
}

function fillProjects() {
  for (const select of [$("#ad-run-project"), $("#ad-pipeline-project")]) {
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
  const entries = vpsEntries.filter((entry) => !query || entry.name.toLowerCase().includes(query));
  host.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "ad-source-vps-empty";
    empty.textContent = query ? "No matching folders or images in this folder." : "No folders or images in this folder.";
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
    meta.textContent = project?.name || run.project_id || "Workspace";
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
  const response = await fetch("/api/chat/sessions");
  if (!response.ok) throw new Error("Jobs are unavailable");
  const data = await response.json();
  runs = (Array.isArray(data.sessions) ? data.sessions : []).filter((session) => clean(session.title).startsWith(RUN_PREFIX));
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

function openChatButton(run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ad-primary";
  button.textContent = "Open full job";
  button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("frank:open-chat-session", { detail: { id: run.id } })));
  return button;
}

async function selectRun(runId) {
  selectedRunId = runId;
  renderRuns();
  const run = runs.find((item) => item.id === runId);
  if (!run) return;
  const detail = $("#ad-run-detail");
  detail.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "ad-run-summary";
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = run.title || "Ad Studio job";
  const meta = document.createElement("p");
  meta.textContent = `${dateLabel(run.updated_at)} · ${run.message_count || 0} messages${run.model ? ` · ${run.model}` : ""}`;
  copy.append(heading, meta);
  summary.append(copy, openChatButton(run));
  detail.append(summary);
  try {
    const response = await fetch(`/api/chat?session_id=${encodeURIComponent(run.id)}`);
    if (!response.ok) throw new Error("Job conversation is unavailable");
    const data = await response.json();
    const list = document.createElement("div");
    list.className = "ad-message-list";
    for (const message of data.messages || []) {
      const card = document.createElement("article");
      card.className = "ad-message";
      const role = document.createElement("span");
      role.textContent = message.role === "user" ? "Request" : message.role === "sys" ? "System" : "Hermes";
      const body = document.createElement("p");
      body.textContent = message.text || "";
      card.append(role, body);
      if (Array.isArray(message.tools) && message.tools.length) {
        const tools = document.createElement("div");
        tools.className = "ad-message-tools";
        tools.textContent = `Tools · ${message.tools.join(" · ")}`;
        card.append(tools);
      }
      list.append(card);
    }
    if (!(data.messages || []).length) list.innerHTML = '<div class="ad-empty"><strong>Job started</strong><span>Hermes has not recorded a message yet.</span></div>';
    detail.append(list);
  } catch (error) {
    const empty = document.createElement("div");
    empty.className = "ad-empty";
    const strong = document.createElement("strong");
    strong.textContent = "Could not load this job";
    const message = document.createElement("span");
    message.textContent = clean(error.message);
    empty.append(strong, message);
    detail.append(empty);
  }
  const trace = document.createElement("div");
  trace.className = "ad-trace-notice";
  trace.innerHTML = "<strong>Full trace not correlated yet</strong><p>Frank will show the complete drill-down trace when Hermes supplies a versioned run record. Chat activity is not presented as synthetic Langfuse spans.</p>";
  detail.append(trace);
  $("#ad-pipeline-run").value = runId;
  updateEvidence();
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
  if (selectedStage?.source_id === "source" && local?.url) {
    const image = document.createElement("img");
    image.src = local.url;
    image.alt = local.name || "Source image";
    input.append(image);
  } else {
    input.textContent = selectedStage && selectedRunId ? "This stage has no correlated input record yet." : "Select a real run and stage to see its input image, text, or JSON.";
  }
  output.textContent = selectedStage && selectedRunId ? "This stage has no correlated output record yet." : "No correlated output is available yet.";
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
  $("#ad-source-vps-search").addEventListener("input", renderVpsEntries);
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
      const session = await requestEvent("frank:ad-studio-run", {
        sources: selectedFiles.slice(), projectId: $("#ad-run-project").value,
        name: clean($("#ad-run-name").value), brief: clean($("#ad-run-brief").value), placements,
      });
      const first = selectedFiles[0];
      localRunInputs.set(session.id, { url: first.previewUrl, name: first.name });
      selectedRunId = session.id;
      status.textContent = "Job started in Hermes.";
      void refreshRunsSafe();
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
  $("#ad-pipeline-run").addEventListener("change", (event) => { selectedRunId = event.target.value; updateEvidence(); });
  $("#ad-stage-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#ad-stage-status");
    status.classList.remove("is-error");
    if (!selectedStage) {
      status.textContent = "Select a pipeline stage first.";
      status.classList.add("is-error");
      return;
    }
    const prompt = clean($("#ad-stage-prompt").value);
    const model = clean($("#ad-stage-model").value);
    const settings = clean($("#ad-stage-settings").value);
    if (!prompt && !model && !settings) {
      status.textContent = "Describe at least one change.";
      status.classList.add("is-error");
      return;
    }
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await requestEvent("frank:ad-studio-change-request", {
        projectId: $("#ad-pipeline-project").value, stage: selectedStage.source_id,
        prompt, model, settings, runId: selectedRunId,
      });
      status.textContent = "Change request opened with Hermes.";
    } catch (error) {
      status.textContent = error.message || "The change request could not be opened.";
      status.classList.add("is-error");
    } finally { submit.disabled = false; }
  });
}

export function mountAdStudio() {
  if (mounted) { void refreshRunsSafe(); return; }
  mounted = true;
  $$("[data-ad-tab]").forEach((button) => button.addEventListener("click", () => activate(button.dataset.adTab)));
  $("#ad-runs-refresh").addEventListener("click", () => void refreshRunsSafe());
  setupRunForm();
  setupPipelineForm();
  void loadProjects().then(async () => {
    await refreshRunsSafe();
    if ($("[data-ad-panel=\"pipeline\"]").classList.contains("is-on")) mountPipeline();
  }).catch((error) => {
    $("#ad-run-status").textContent = error.message || "Ad Studio could not load.";
    $("#ad-run-status").classList.add("is-error");
  });
  window.addEventListener("beforeunload", () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
}
