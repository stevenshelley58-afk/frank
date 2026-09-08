import { blockwiseTemplateUrl } from "./view-routing.js?v=20260906-ad-template-generator-v1";
import { groupAdTemplateGeneratorRuns, mergeAdTemplateGeneratorRun, mergeAdTemplateGeneratorRunList, readyAdTemplateGeneratorReviewRuns, runListRenderSignature, runTimestamp } from "./ad-template-generator-state.js?v=20260905-ready-review-v1";
import { AD_TEMPLATE_GENERATOR_BRIEF_MAX_CHARACTERS, adTemplateGeneratorBriefValidation } from "./ad-template-generator-brief.js?v=20260904-brief-roundtrip-v1";
import { approveAdTemplateGeneratorTemplate, cancelAdTemplateGeneratorRun, discardAdTemplateGeneratorTemplate, getAdTemplateGeneratorRun, listAdTemplateGeneratorRuns, requestAdTemplateGeneratorTemplateChanges, retryAdTemplateGeneratorRun, postAdReviewMessage, getAdReviewRevisions, undoAdReviewRevision } from "./ad-template-generator-api.js?v=20260908-review-chat-v1";
import { placementScore, reviewArtifactPurpose, reviewModelProfile, reviewOverallScore, reusableValidationChecks, selectMetaPreview, selectReusableReviewArtifact, selectFaithfulReviewArtifact, selectReviewArtifact } from "./ad-template-generator-review.js?v=20260905-ready-review-v1";
import { normalizeRect, pointerToNormalized, safeAnnotationText, serializeAnnotations } from "./ad-review-annotations.js?v=20260908-review-annotations-v1";

const TOOL_ID = "ad-template-generator";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let mounted = false;
let projects = [];
let runs = [];
let selectedRunId = "";
let selectedReviewRunId = "";
let reviewPlacement = "feed";
let reviewView = "template";
let reviewZoom = "fit";
let reviewAnnotating = false;
let reviewActionPending = false;
let reviewActionMessage = "";
const reviewDraftAnnotations = new Map();
const reviewDraftText = new Map();
const reviewRevisionState = new Map();
const reviewRequestKeys = new Map();
const reviewInFlight = new Set();
let runSelectionRevision = 0;
let runListRevision = 0;
let selectedStage = null;
let graphHandle = null;
let selectedFiles = [];
let graphMountPromise = null;
let graphMountRevision = 0;
let batchStarting = false;
let runRefreshPending = false;
const localRunInputs = new Map();
const previewUrls = new Set();
let runEvents = [];
let eventStream = null;
let adTemplateGeneratorModels = [];
let adTemplateGeneratorImageModels = [];
let adTemplateGeneratorModelPolicy = null;
let adTemplateGeneratorModelsReady = false;
let modelLoadSequence = 0;
let eventReconnectTimer = null;
let refreshTimer = null;
let active = false;
let ready = false;
const runEventCache = new Map();
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"]);
const MAX_BATCH_SOURCES = 20;

function stopRunEvents() {
  eventStream?.close();
  eventStream = null;
  if (eventReconnectTimer) window.clearTimeout(eventReconnectTimer);
  eventReconnectTimer = null;
}

function stopLiveUpdates() {
  stopRunEvents();
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function resumeLiveUpdates() {
  if (!active || document.hidden || !ready) return;
  void refreshRunsSafe();
  if (selectedRunId && !eventStream) {
    const selected = runs.find((run) => run.id === selectedRunId);
    if (selected) connectRunEvents(selected);
  }
  if (!refreshTimer) refreshTimer = window.setInterval(() => { if (active && !document.hidden) void refreshRunsSafe(); }, 5_000);
  if ($("[data-ad-panel=\"pipeline\"]")?.classList.contains("is-on") && !graphHandle) void mountPipeline();
}

export function setAdTemplateGeneratorActive(nextActive) {
  active = Boolean(nextActive);
  if (!active || document.hidden) {
    stopLiveUpdates();
    graphMountRevision += 1;
    graphHandle?.destroy?.();
    graphHandle = null;
    return;
  }
  resumeLiveUpdates();
}

const SOURCE_STATUS = {
  queued: "Ready",
  uploading: "Uploading…",
  starting: "Starting…",
  started: "Run started",
  error: "Needs attention",
};

const clean = (value) => String(value || "").trim();
const escapeHtml = (value) => clean(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const PIPELINE_STAGES = ["source", "build", "render", "compare", "final-check", "live"];
const PIPELINE_LABELS = {
  source: "Source", build: "Build", render: "Render", compare: "Compare/revise",
  "final-check": "Final check", live: "Live/import",
};
const STAGE_ALIASES = {
  analyse: "build", analyze: "build", decompose: "build", restyle: "build", "story-draft": "build",
  qa: "compare", "visual-review": "compare", check: "compare", "subject-invariance": "compare", "studio-qa": "compare",
  "final-review": "final-check", ready: "final-check", import: "live", release: "live",
};
const canonicalStage = (stage) => {
  const value = clean(stage).toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  return PIPELINE_STAGES.includes(value) ? value : (STAGE_ALIASES[value] || "source");
};

const IMAGE_MODEL_STAGE = "aspect-reference-image";
const MODEL_ROLE_FIELDS = {
  [IMAGE_MODEL_STAGE]: "#ad-model-photo-assets",
  analyse: "#ad-model-builder",
  compare: "#ad-model-comparator",
  "final-review-a": "#ad-model-reviewer-a",
  "final-review-b": "#ad-model-reviewer-b",
  "quality-escalation": "#ad-model-diagnosis",
};

function modelName(item) {
  if (!item) return "Model unavailable";
  return `${item.model} · ${item.provider}`;
}

function modelsForStage(stageId) {
  return stageId === IMAGE_MODEL_STAGE ? adTemplateGeneratorImageModels : adTemplateGeneratorModels;
}

function modelIndex(candidate, stageId) {
  if (!candidate) return -1;
  return modelsForStage(stageId).findIndex((item) => item.provider === candidate.provider && item.model === candidate.model);
}

function selectedModel(indexValue, stageId) {
  const index = Number(indexValue);
  return Number.isInteger(index) && index >= 0 ? modelsForStage(stageId)[index] : null;
}

function modelCandidate(item, stageId) {
  const imageStage = stageId === IMAGE_MODEL_STAGE;
  return {
    provider: item.provider,
    model: item.model,
    capability_verified: true,
    capabilities: [imageStage ? item.capability : "vision_structured"],
    supports_vision: true,
    supports_tools: !imageStage,
  };
}

function currentModelPolicy() {
  if (!adTemplateGeneratorModelsReady || !adTemplateGeneratorModelPolicy) throw new Error("Wait for Hermes to load the Ad Template Generator models.");
  const policy = structuredClone(adTemplateGeneratorModelPolicy);
  for (const [stageId, selector] of Object.entries(MODEL_ROLE_FIELDS)) {
    const select = $(selector);
    const model = selectedModel(select?.value, stageId);
    if (stageId === "quality-escalation" && !model) {
      delete policy.stages[stageId];
      continue;
    }
    if (!model || !model.available || !model.credential_ready) {
      const label = stageId === IMAGE_MODEL_STAGE ? "photo assets" : stageId.replaceAll("-", " ");
      throw new Error(`Choose an available ${label} model.`);
    }
    policy.stages[stageId].capability = stageId === IMAGE_MODEL_STAGE ? model.capability : "vision_structured";
    policy.stages[stageId].primary = modelCandidate(model, stageId);
  }
  const first = policy.stages["final-review-a"].primary;
  const second = policy.stages["final-review-b"].primary;
  if (first.provider === second.provider && first.model === second.model) {
    throw new Error("Completion reviewers A and B must use different model routes.");
  }
  return policy;
}

function validateModelControls() {
  const status = $("#ad-model-status");
  if (!adTemplateGeneratorModelsReady) return false;
  try {
    currentModelPolicy();
    status.textContent = "This model setup is independent of Hub chat and will be locked to every Run in the batch.";
    status.classList.remove("is-error");
    return true;
  } catch (error) {
    status.textContent = error.message || "Choose a valid Ad Template Generator model setup.";
    status.classList.add("is-error");
    return false;
  }
}

function populateModelControls(policy) {
  const stages = policy?.stages || {};
  for (const [stageId, selector] of Object.entries(MODEL_ROLE_FIELDS)) {
    const select = $(selector);
    select.replaceChildren();
    if (stageId === "quality-escalation") select.append(new Option("Off", "-1"));
    modelsForStage(stageId).forEach((item, index) => {
      const option = new Option(modelName(item), String(index));
      option.disabled = !item.available || !item.credential_ready;
      select.append(option);
    });
    const selected = modelIndex(stages[stageId]?.primary, stageId);
    select.value = selected >= 0 ? String(selected) : (stageId === "quality-escalation" ? "-1" : "");
    select.disabled = false;
  }
  validateModelControls();
  updateRunControls();
}

async function loadAdTemplateGeneratorModels() {
  const sequence = ++modelLoadSequence;
  const status = $("#ad-model-status");
  adTemplateGeneratorModelsReady = false;
  status.textContent = "Reading verified vision models from Hermes…";
  status.classList.remove("is-error");
  updateRunControls();
  const projectId = clean($("#ad-run-project")?.value);
  const query = new URLSearchParams();
  if (projectId) query.set("project_id", projectId);
  try {
    const response = await fetch(`/api/ad-template-generator/models${query.size ? `?${query}` : ""}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Hermes model catalogue is unavailable.");
    if (sequence !== modelLoadSequence) return;
    adTemplateGeneratorModels = Array.isArray(data.models) ? data.models : [];
    adTemplateGeneratorImageModels = Array.isArray(data.image_models) ? data.image_models : [];
    adTemplateGeneratorModelPolicy = data.policy && typeof data.policy === "object" ? data.policy : null;
    if (!adTemplateGeneratorModels.length || !adTemplateGeneratorImageModels.length || !adTemplateGeneratorModelPolicy) throw new Error("Hermes has no verified Ad Template Generator models available.");
    adTemplateGeneratorModelsReady = true;
    populateModelControls(adTemplateGeneratorModelPolicy);
  } catch (error) {
    if (sequence !== modelLoadSequence) return;
    adTemplateGeneratorModels = [];
    adTemplateGeneratorImageModels = [];
    adTemplateGeneratorModelPolicy = null;
    status.textContent = error.message || "Hermes model catalogue is unavailable.";
    status.classList.add("is-error");
    Object.values(MODEL_ROLE_FIELDS).forEach((selector) => { $(selector).disabled = true; });
    updateRunControls();
  }
}


function runStatusLabel(status) {
  return ({ queued: "Running", started: "Running", running: "Running", ready_for_review: "Ready for review", approved: "Approved", active: "Live", completed: "Complete", discarded: "Discarded", failed: "Failed", cancelled: "Cancelled", unavailable: "Status unavailable" })[status] || "Running";
}

function dateLabel(value) {
  const timestamp = runTimestamp(value);
  if (!timestamp) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch { return ""; }
}

function activate(tab) {
  $$("[data-ad-tab]").forEach((button) => {
    const active = button.dataset.adTab === tab;
    button.classList.toggle("is-on", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $$("[data-ad-panel]").forEach((panel) => {
    const active = panel.dataset.adPanel === tab;
    panel.classList.toggle("is-on", active);
    panel.hidden = !active;
  });
  if (tab === "runs") void refreshRunsSafe();
  if (tab === "review") void refreshRunsSafe().then(() => {
    renderReviewQueue();
    const ready = readyAdTemplateGeneratorReviewRuns(runs);
    if (!selectedReviewRunId && ready[0]) void selectReviewRun(ready[0].id);
  });
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
  const runnable = selectedFiles.filter((source) => ["queued", "error"].includes(source.status)).length;
  $("#ad-run-mode").textContent = selectedFiles.length ? `${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"}` : "No images";
  selectedFiles.forEach((source) => {
    const item = document.createElement("div");
    item.className = "ad-source-item";
    item.dataset.status = source.status;
    const image = document.createElement("img");
    image.src = source.previewUrl;
    image.alt = source.name;
    const copy = document.createElement("div");
    copy.className = "ad-source-item-copy";
    const label = document.createElement("strong");
    label.textContent = source.name;
    label.title = source.name;
    const state = document.createElement("span");
    state.textContent = source.error || SOURCE_STATUS[source.status] || SOURCE_STATUS.queued;
    state.title = source.error || "";
    copy.append(label, state);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ad-source-remove";
    remove.setAttribute("aria-label", `Remove ${source.name}`);
    remove.textContent = "×";
    remove.disabled = ["uploading", "starting"].includes(source.status);
    remove.addEventListener("click", () => {
      removeSource(source.key);
      renderSourcePreview();
    });
    item.append(image, copy, remove);
    host.append(item);
  });
  if (selectedFiles.length) {
    const summary = document.createElement("div");
    summary.className = "ad-source-summary";
    const count = document.createElement("span");
    count.textContent = batchStarting ? "Starting runs…" : `${runnable} image${runnable === 1 ? "" : "s"} ready to run`;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ad-source-clear";
    clear.textContent = "Clear queue";
    clear.disabled = selectedFiles.some((source) => ["uploading", "starting"].includes(source.status));
    clear.addEventListener("click", () => {
      clearSourceQueue();
      renderSourcePreview();
    });
    summary.append(count, clear);
    host.append(summary);
  }
  updateRunControls();
}

function addLocalFiles(files) {
  const offered = Array.from(files || []);
  const images = offered.filter((file) => {
    const extension = String(file.name || "").toLowerCase().split(".").pop();
    return IMAGE_EXTENSIONS.has(extension);
  });
  const existing = new Set(selectedFiles.map((source) => source.key));
  const additions = images.map((file) => {
    const key = `local:${file.name}:${file.size}:${file.lastModified}`;
    if (existing.has(key)) return null;
    existing.add(key);
    const previewUrl = URL.createObjectURL(file);
    previewUrls.add(previewUrl);
    return { kind: "local", key, name: file.name, size: file.size, type: file.type, file, previewUrl, status: "queued", error: "" };
  }).filter(Boolean);
  const capacity = Math.max(0, MAX_BATCH_SOURCES - selectedFiles.length);
  const accepted = additions.slice(0, capacity);
  additions.slice(capacity).forEach((source) => {
    URL.revokeObjectURL(source.previewUrl);
    previewUrls.delete(source.previewUrl);
  });
  selectedFiles.push(...accepted);
  const ignored = offered.length - images.length;
  const duplicates = images.length - additions.length;
  const overflow = additions.length - accepted.length;
  const notes = [];
  if (accepted.length) notes.push(`${accepted.length} image${accepted.length === 1 ? "" : "s"} added.`);
  if (duplicates) notes.push(`${duplicates} duplicate${duplicates === 1 ? " was" : "s were"} already in the queue.`);
  if (ignored) notes.push(`${ignored} non-image file${ignored === 1 ? " was" : "s were"} skipped.`);
  if (overflow) notes.push(`A batch can contain up to ${MAX_BATCH_SOURCES} images.`);
  const status = $("#ad-run-status");
  status.classList.toggle("is-error", !accepted.length && (ignored > 0 || overflow > 0));
  if (notes.length) status.textContent = notes.join(" ");
  renderSourcePreview();
}

function removeSource(key) {
  const source = selectedFiles.find((item) => item.key === key);
  selectedFiles = selectedFiles.filter((item) => item.key !== key);
  if (source?.kind === "local") {
    URL.revokeObjectURL(source.previewUrl);
    previewUrls.delete(source.previewUrl);
  }
}

function clearSourceQueue() {
  selectedFiles.forEach((source) => {
    if (source.kind === "local") {
      URL.revokeObjectURL(source.previewUrl);
      previewUrls.delete(source.previewUrl);
    }
  });
  selectedFiles = [];
  const status = $("#ad-run-status");
  status.classList.remove("is-error");
  status.textContent = "Add one or more images. Each image becomes its own Run.";
}

function updateRunControls() {
  const submit = $("#ad-run-submit");
  if (!submit) return;
  const runnable = selectedFiles.filter((source) => ["queued", "error"].includes(source.status)).length;
  const modelsValid = adTemplateGeneratorModelsReady && validateModelControls();
  submit.disabled = batchStarting || runnable === 0 || !modelsValid;
  submit.textContent = batchStarting ? "Starting…" : runnable ? `Start ${runnable} run${runnable === 1 ? "" : "s"}` : "Start runs";
}

function updateSourceStatus(key, status, options = {}) {
  const source = selectedFiles.find((item) => item.key === key);
  if (!source) return;
  source.status = status;
  source.error = clean(options.error);
  if (options.run?.id) source.run = options.run;
  renderSourcePreview();
}

function renderRunOptions() {
  const select = $("#ad-pipeline-run");
  if (!select) return;
  const previous = selectedRunId || select.value;
  select.replaceChildren(new Option("No run selected", ""));
  for (const group of groupAdTemplateGeneratorRuns(runs)) {
    const options = document.createElement("optgroup");
    options.label = [group.sourceLabel, group.templateLabel].filter(Boolean).join(" · ");
    const supersededIds = new Set(group.superseded.map((run) => run.id));
    group.attempts.forEach((run, index) => {
      const historyState = index === 0 ? "Current" : (supersededIds.has(run.id) ? "Superseded" : "Previous");
      const date = dateLabel(run.updated_at || run.created_at);
      options.append(new Option([historyState, runStatusLabel(run.status), date].filter(Boolean).join(" · "), run.id));
    });
    select.append(options);
  }
  if (runs.some((run) => run.id === previous)) select.value = previous;
}

function clearRunSelection() {
  runSelectionRevision += 1;
  selectedRunId = "";
  eventStream?.close();
  eventStream = null;
  if (eventReconnectTimer) window.clearTimeout(eventReconnectTimer);
  eventReconnectTimer = null;
  runEvents = [];
  const detail = $("#ad-run-detail");
  if (detail) detail.innerHTML = '<div class="ad-empty"><strong>Select a run</strong><span>Open a run to inspect every iteration, comparator score and final review.</span></div>';
  updateEvidence();
}

function createRunRow(run, { current = false, superseded = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ad-run-row${run.id === selectedRunId ? " is-on" : ""}`;
  button.dataset.status = clean(run.status).toLowerCase();
  button.dataset.historyState = current ? "current" : (superseded ? "superseded" : "previous");
  const dot = document.createElement("i");
  dot.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "ad-run-row-copy";
  const title = document.createElement("strong");
  title.textContent = String(run.title || "Ad Template Generator Run").replace(/^(?:Ad Template Generator|Ad Studio)\s*[·|-]?\s*/, "") || "Run";
  const meta = document.createElement("span");
  const project = projects.find((item) => item.id === run.project_id);
  meta.textContent = [project?.name || run.project_id || "Workspace", runStatusLabel(run.status), current ? "Current" : ""].filter(Boolean).join(" · ");
  copy.append(title, meta);
  const time = document.createElement("time");
  time.textContent = dateLabel(run.updated_at || run.created_at);
  button.append(dot, copy, time);
  button.addEventListener("click", () => void selectRun(run.id));
  return button;
}

function renderRuns() {
  const host = $("#ad-runs-list");
  host.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "ad-empty";
    empty.innerHTML = "<strong>No runs yet</strong><span>Run a source image to create the first Ad Template Generator run.</span>";
    host.append(empty);
    renderRunOptions();
    return;
  }
  for (const group of groupAdTemplateGeneratorRuns(runs)) {
    const section = document.createElement("section");
    section.className = "ad-run-group";
    const heading = document.createElement("div");
    heading.className = "ad-run-group-heading";
    const source = document.createElement("strong");
    source.textContent = group.sourceLabel;
    source.title = group.sourceLabel;
    const context = document.createElement("span");
    const attempts = `${group.attempts.length} attempt${group.attempts.length === 1 ? "" : "s"}`;
    context.textContent = [attempts, group.templateLabel].filter(Boolean).join(" · ");
    heading.append(source, context);
    section.append(heading, createRunRow(group.primary, { current: true }));
    group.history.forEach((run) => section.append(createRunRow(run)));
    if (group.superseded.length) {
      const disclosure = document.createElement("details");
      disclosure.className = "ad-run-superseded";
      disclosure.open = group.superseded.some((run) => run.id === selectedRunId);
      const summary = document.createElement("summary");
      summary.textContent = `Superseded attempts (${group.superseded.length})`;
      const attemptsList = document.createElement("div");
      attemptsList.className = "ad-run-superseded-list";
      group.superseded.forEach((run) => attemptsList.append(createRunRow(run, { superseded: true })));
      disclosure.append(summary, attemptsList);
      section.append(disclosure);
    }
    host.append(section);
  }
  renderRunOptions();
}

async function refreshRuns() {
  const refreshRevision = ++runListRevision;
  const projectId = clean($("#ad-run-project")?.value || $("#ad-pipeline-project")?.value);
  const incoming = await listAdTemplateGeneratorRuns({ projectId, limit: 100 });
  if (refreshRevision !== runListRevision) return;
  const previousSignature = runListRenderSignature(runs);
  runs = mergeAdTemplateGeneratorRunList(runs, incoming);
  if (runListRenderSignature(runs) !== previousSignature) renderRuns();
  renderReviewQueue();
}

async function refreshRunsSafe() {
  if (runRefreshPending) return;
  runRefreshPending = true;
  try {
    await refreshRuns();
  } catch {
    const host = $("#ad-runs-list");
    if (host && !host.children.length) host.innerHTML = '<div class="ad-empty"><strong>Runs unavailable</strong><span>Frank cannot reach Hermes right now.</span></div>';
    const reviewHost = $("#ad-review-list");
    if (reviewHost && !reviewHost.children.length) reviewHost.innerHTML = '<div class="ad-empty"><strong>Review queue unavailable</strong><span>Frank will reconnect to Hermes automatically.</span></div>';
  } finally {
    runRefreshPending = false;
  }
}

async function selectRun(runId) {
  const selectionRevision = ++runSelectionRevision;
  selectedRunId = runId;
  renderRuns();
  let run = runs.find((item) => item.id === runId);
  if (!run) return;
  try {
    const detail = await getAdTemplateGeneratorRun(run.id);
    if (detail) {
      if (selectionRevision !== runSelectionRevision || selectedRunId !== runId) return;
      run = mergeAdTemplateGeneratorRun(runs.find((item) => item.id === run.id), detail);
      runs = runs.map((item) => item.id === run.id ? run : item);
      renderRuns();
      renderReviewQueue();
    }
  } catch { /* keep the last visible status */ }
  if (selectionRevision !== runSelectionRevision || selectedRunId !== runId) return;
  run = runs.find((item) => item.id === runId) || run;
  renderRunDetail(run);
  connectRunEvents(run);
}

function reviewScoreLabel(value) {
  return value === null ? "—" : Number(value).toFixed(1);
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "Not reported";
  if (value < 60) return `${Math.round(value)} sec`;
  const minutes = Math.floor(value / 60);
  const remainder = Math.round(value % 60);
  return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
}

function renderReviewQueue() {
  const host = $("#ad-review-list");
  const count = $("#ad-review-count");
  if (!host || !count) return;
  const ready = readyAdTemplateGeneratorReviewRuns(runs);
  count.textContent = String(ready.length);
  count.hidden = ready.length === 0;
  host.replaceChildren();
  if (!ready.length) {
    host.innerHTML = '<div class="ad-empty"><strong>Nothing waiting</strong><span>Templates appear here only after final reviews and the Blockwise smoke test are recorded.</span></div>';
    return;
  }
  ready.forEach((run) => {
    const summary = run.output?.review_summary || {};
    const preview = selectReviewArtifact(summary, "feed", "template") || summary.source;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ad-review-row${run.id === selectedReviewRunId ? " is-on" : ""}`;
    if (preview?.url) {
      const image = document.createElement("img");
      image.src = preview.url;
      image.alt = "";
      button.append(image);
    } else {
      const missing = document.createElement("span");
      missing.className = "ad-review-row-missing";
      missing.textContent = "No preview";
      button.append(missing);
    }
    const copy = document.createElement("span");
    copy.className = "ad-review-row-copy";
    const title = document.createElement("strong");
    title.textContent = String(run.title || run.source?.name || "Template review").replace(/^(?:Ad Template Generator|Ad Studio)\s*[·|-]?\s*/, "") || "Template review";
    const source = document.createElement("span");
    source.textContent = run.source?.name || "Source recorded in Hermes";
    const scores = document.createElement("small");
    scores.textContent = `Overall ${reviewScoreLabel(reviewOverallScore(summary))} · Feed ${reviewScoreLabel(placementScore(summary, "feed"))} · Story ${reviewScoreLabel(placementScore(summary, "story"))}`;
    copy.append(title, source, scores);
    const time = document.createElement("time");
    time.textContent = dateLabel(run.updated_at || run.created_at);
    button.append(copy, time);
    button.addEventListener("click", () => void selectReviewRun(run.id));
    host.append(button);
  });
}

async function selectReviewRun(runId) {
  const selectionRevision = ++runSelectionRevision;
  selectedReviewRunId = runId;
  selectedRunId = runId;
  reviewActionMessage = "";
  renderRuns();
  renderReviewQueue();
  let run = runs.find((item) => item.id === runId);
  if (!run) return;
  renderReviewDetail(run, { loading: true });
  try {
    const detail = await getAdTemplateGeneratorRun(runId);
    if (detail && selectionRevision === runSelectionRevision && selectedReviewRunId === runId) {
      run = mergeAdTemplateGeneratorRun(run, detail);
      runs = runs.map((item) => item.id === runId ? run : item);
    }
  } catch { /* retain the safe summary already in the list response */ }
  if (selectionRevision !== runSelectionRevision || selectedReviewRunId !== runId) return;
  renderRuns();
  renderReviewQueue();
  renderReviewDetail(run);
  connectRunEvents(run);
}

function makeSegment(label, value, selected, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = selected === value ? "is-on" : "";
  button.setAttribute("aria-pressed", String(selected === value));
  button.addEventListener("click", () => onSelect(value));
  return button;
}

function appendReviewImage(host, artifact, label) {
  host.replaceChildren();
  if (!artifact?.url) {
    const missing = document.createElement("div");
    missing.className = "ad-review-artifact-missing";
    missing.innerHTML = `<strong>${escapeHtml(label)} not supplied</strong><span>Hermes has not recorded this evidence for the selected placement.</span>`;
    host.append(missing);
    return;
  }
  const image = document.createElement("img");
  image.src = artifact.url;
  image.alt = `${label} for ${reviewPlacement} placement`;
  image.dataset.zoom = reviewZoom;
  host.append(image);
}

function appendReviewFacts(parent, summary) {
  const smoke = summary.smoke_test || {};
  const facts = [
    ["Overall", reviewScoreLabel(reviewOverallScore(summary))],
    ["Iterations", Number.isInteger(summary.iterations) ? String(summary.iterations) : "Not reported"],
    ["Elapsed", formatDuration(summary.elapsed_seconds)],
    ["Cost", Number.isFinite(Number(summary.cost_usd)) ? `$${Number(summary.cost_usd).toFixed(3)}` : "Not reported"],
    ["Blockwise smoke", smoke.passed === true ? "Passed" : smoke.passed === false ? "Failed" : "Not recorded"],
    ["Reusable validation", reusableValidationChecks(summary).length
      ? reusableValidationChecks(summary).map((item) => (item.status === "passed" ? "Passed" : item.status === "failed" ? "Failed" : "Not recorded") + ": " + item.label)
      : ["Not recorded"]],
  ];
  const list = document.createElement("dl");
  list.className = "ad-review-facts";
  facts.forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = value;
    item.append(term, description); list.append(item);
  });
  parent.append(list);
}

function appendMetaPreviews(parent, summary) {
  const section = document.createElement("section");
  section.className = "ad-review-section";
  section.innerHTML = '<div class="ad-inline-heading"><strong>Meta placement previews</strong><span>Recorded output, not a simulated fallback.</span></div>';
  const grid = document.createElement("div");
  grid.className = "ad-review-meta-grid";
  for (const placement of ["feed", "story"]) {
    const artifact = selectMetaPreview(summary, placement);
    const figure = document.createElement("figure");
    if (artifact?.url) {
      const image = document.createElement("img"); image.src = artifact.url; image.alt = `${placement} Meta ad preview`;
      figure.append(image);
    } else {
      const missing = document.createElement("div"); missing.className = "ad-review-artifact-missing"; missing.textContent = "Meta preview not supplied"; figure.append(missing);
    }
    const caption = document.createElement("figcaption"); caption.textContent = placement === "feed" ? "Feed" : "Story"; figure.append(caption);
    grid.append(figure);
  }
  section.append(grid); parent.append(section);
}

function appendReviewEvidence(parent, run, summary) {
  const grid = document.createElement("div"); grid.className = "ad-review-compare-grid";
  for (const [label, artifact] of [["Source", selectReviewArtifact(summary, reviewPlacement, "source")], ["Faithful reconstruction", selectFaithfulReviewArtifact(summary, reviewPlacement)]]) {
    const figure = document.createElement("figure");
    const title = document.createElement("figcaption"); title.textContent = label;
    figure.append(title); appendReviewImage(figure, artifact, label); grid.append(figure);
  }
  parent.append(grid);
}

function createAnnotatedViewport(run, artifact, label, placement, { enabled = false } = {}) {
  const viewport = document.createElement("div"); viewport.className = "ad-review-viewport ad-review-annotated-viewport";
  const stage = document.createElement("div"); stage.className = "ad-review-image-stage";
  const comments = document.createElement("div"); comments.className = "ad-review-annotation-comments";
  if (!artifact?.url) { appendReviewImage(stage, artifact, label); viewport.append(stage, comments); return viewport; }
  const image = document.createElement("img"); image.src = artifact.url; image.alt = `${label} for ${placement} placement`; image.draggable = false; stage.append(image);
  const overlay = document.createElement("div"); overlay.className = "ad-review-annotation-layer";
  overlay.setAttribute("aria-label", `${placement} annotation canvas`);
  overlay.style.pointerEvents = enabled && reviewAnnotating ? "auto" : "none";
  stage.append(overlay);
  const key = `${run.id}:${placement}`;
  let annotations = serializeAnnotations(reviewDraftAnnotations.get(key) || []);
  const draw = () => {
    overlay.replaceChildren(); comments.replaceChildren();
    annotations.forEach((annotation, index) => {
      const box = document.createElement("div"); box.className = "ad-review-annotation-box"; box.dataset.testid = "draft-annotation";
      Object.assign(box.style, {left:`${annotation.x*100}%`, top:`${annotation.y*100}%`, width:`${annotation.width*100}%`, height:`${annotation.height*100}%`});
      const number = document.createElement("span"); number.textContent = String(index+1); box.append(number); overlay.append(box);
      const field = document.createElement("label"); field.className = "ad-review-area-field";
      const heading = document.createElement("span"); heading.textContent = `${placement === "feed" ? "Feed" : "Story"} · Area ${index+1}`;
      const input = document.createElement("input"); input.maxLength = 200; input.value = annotation.comment || ""; input.disabled = !enabled;
      input.dataset.annotationIndex = String(index); input.placeholder = "What should change here?";
      input.addEventListener("input", () => { annotation.comment = input.value; reviewDraftAnnotations.set(key, annotations); });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.disabled = !enabled;
      remove.setAttribute("aria-label", `Remove annotation ${index+1}`);
      remove.addEventListener("click", () => { annotations.splice(index,1); reviewDraftAnnotations.set(key,annotations); draw(); });
      field.append(heading,input,remove); comments.append(field);
    });
    comments.hidden = annotations.length === 0;
  };
  draw();
  if (enabled) {
    let start = null;
    const clear = event => { start = null; overlay.removeAttribute("data-drawing"); if (overlay.hasPointerCapture?.(event.pointerId)) overlay.releasePointerCapture(event.pointerId); };
    overlay.addEventListener("pointerdown", event => {
      if (!reviewAnnotating || event.button !== 0 || event.target !== overlay) return;
      if ([...reviewDraftAnnotations.entries()].filter(([id]) => id.startsWith(`${run.id}:`)).reduce((sum,[,items]) => sum+items.length,0) >= 8) return;
      event.preventDefault(); start = pointerToNormalized(event,viewport,image); overlay.setPointerCapture(event.pointerId);
    });
    overlay.addEventListener("pointermove", event => {
      if (!start) return;
      const point = pointerToNormalized(event,viewport,image); if (!point) return;
      const rect = normalizeRect(start,point);
      for (const [name,value] of Object.entries({left:rect.x,top:rect.y,width:rect.width,height:rect.height})) overlay.style.setProperty(`--draft-${name}`,`${value*100}%`);
      overlay.dataset.drawing = "true";
    });
    overlay.addEventListener("pointercancel", clear);
    overlay.addEventListener("pointerup", event => {
      if (!start) return;
      const origin = start, end = pointerToNormalized(event,viewport,image); clear(event); if (!end) return;
      let rect = normalizeRect(origin,end);
      if (rect.width < .01 && rect.height < .01) rect = {x:Math.max(0,Math.min(.88,end.x-.06)),y:Math.max(0,Math.min(.92,end.y-.04)),width:.12,height:.08};
      if (rect.width < .005 || rect.height < .005) return;
      annotations.push({...rect,comment:""}); reviewDraftAnnotations.set(key,annotations); draw();
      comments.querySelector(`input[data-annotation-index="${annotations.length-1}"]`)?.focus();
    });
  }
  viewport.append(stage,comments); return viewport;
}

function appendReviewWorkspace(parent, run, summary) {
  const workspace = document.createElement("div"); workspace.className = "ad-review-workspace";
  const canvas = document.createElement("section"); canvas.className = "ad-review-canvas-panel";
  const toolbar = document.createElement("div"); toolbar.className = "ad-review-toolbar";
  const placements = document.createElement("div"); placements.className = "ad-review-segments"; placements.setAttribute("aria-label","Placement");
  for (const place of ["feed","story"]) placements.append(makeSegment(place === "feed" ? "Feed" : "Story",place,reviewPlacement,value => {reviewPlacement=value;renderReviewDetail(run);}));
  const annotate = document.createElement("button"); annotate.type = "button"; annotate.className = "ad-annotate-button"; annotate.dataset.testid = "review-annotate";
  annotate.textContent = reviewAnnotating ? "✓ Done annotating" : "+ Annotate"; annotate.setAttribute("aria-pressed", String(reviewAnnotating));
  const editable = run.status === "ready_for_review" && !reviewInFlight.has(run.id);
  annotate.disabled = !editable;
  annotate.addEventListener("click", () => { reviewAnnotating = !reviewAnnotating; renderReviewDetail(run); document.querySelector('[data-testid="review-annotate"]')?.focus(); });
  toolbar.append(placements,annotate);
  const instruction = document.createElement("p"); instruction.className = "ad-annotation-instruction"; instruction.setAttribute("role","status");
  instruction.textContent = !editable ? "Editing is locked for this run." : reviewAnnotating ? "Click a spot or drag a box on the ad. Then describe the correction." : "Choose Annotate to mark a change on the ad.";
  const card = document.createElement("article"); card.className = "ad-review-compare-card ad-review-primary-artwork";
  const label = document.createElement("strong"); label.textContent = "Reusable template"; label.className = "ad-review-artwork-label";
  const viewport = createAnnotatedViewport(run,selectReusableReviewArtifact(summary,reviewPlacement),"Reusable template",reviewPlacement,{enabled:editable});
  card.append(label,viewport); canvas.append(toolbar,instruction,card);
  const side = document.createElement("aside"); side.className = "ad-review-comment-panel";
  const title = document.createElement("h3"); title.textContent = "Corrections"; side.append(title);
  const comments = viewport.querySelector(".ad-review-annotation-comments"); if (comments) side.append(comments);
  appendReviewChat(side,run);
  workspace.append(canvas,side); parent.append(workspace);
  workspace.addEventListener("keydown",event => { if (event.key === "Escape" && reviewAnnotating) {reviewAnnotating=false;renderReviewDetail(run); document.querySelector('[data-testid="review-annotate"]')?.focus();} });
}

function appendRecordedDetails(parent, run, summary) {
  const grid = document.createElement("div");
  grid.className = "ad-review-record-grid";
  const reviewers = Array.isArray(summary.scores?.reviewers) ? summary.scores.reviewers : [];
  const checks = Array.isArray(summary.smoke_test?.checks) ? summary.smoke_test.checks : [];
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  const substitutions = Array.isArray(summary.font_substitution) ? summary.font_substitution : [];
  const profile = reviewModelProfile(run);
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const entries = [
    ["Final reviewers", reviewers.length ? reviewers.map((item, index) => `${item.label || `Reviewer ${index + 1}`}: ${reviewScoreLabel(Number.isFinite(Number(item.score)) ? Number(item.score) : null)}${item.decision ? ` · ${item.decision}` : ""}`) : ["No reviewer results supplied"]],
    ["Warnings", warnings.length ? warnings.map((item) => item.message) : ["No warnings recorded"]],
    ["Font substitutions", substitutions.length ? substitutions.map((item) => `${item.source || "Original font"} → ${item.replacement || "Replacement not recorded"}${item.reason ? ` · ${item.reason}` : ""}`) : ["None recorded"]],
    ["Models", roles.length ? roles.map((item) => `${item.label || item.role}: ${item.model} · ${item.provider}`) : ["Model profile not supplied"]],
    ["Blockwise smoke", checks.length ? checks.map((item) => `${item.passed === true ? "Passed" : item.passed === false ? "Failed" : "Recorded"}: ${item.label}`) : [summary.smoke_test?.passed === true ? "Passed" : "No smoke checks supplied"]],
  ];
  entries.forEach(([title, lines]) => {
    const section = document.createElement("section");
    const heading = document.createElement("strong"); heading.textContent = title;
    const list = document.createElement("ul");
    lines.forEach((line) => { const item = document.createElement("li"); item.textContent = line; list.append(item); });
    section.append(heading, list); grid.append(section);
  });
  parent.append(grid);

  const layers = Array.isArray(summary.layers) ? summary.layers : [];
  const layerSection = document.createElement("details");
  layerSection.className = "ad-review-layers";
  const layerSummary = document.createElement("summary");
  layerSummary.textContent = layers.length ? `Editable layer inventory · ${layers.length}` : "Editable layer inventory · not supplied";
  layerSection.append(layerSummary);
  if (layers.length) {
    const list = document.createElement("div");
    layers.forEach((layer) => {
      const row = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = layer.name || layer.id || "Layer";
      const meta = document.createElement("span"); meta.textContent = [layer.placement, layer.type, layer.role, layer.editable === false ? "Locked" : "Editable"].filter(Boolean).join(" · ");
      row.append(name, meta); list.append(row);
    });
    layerSection.append(list);
  }
  parent.append(layerSection);
}

function reviewIdempotencyKey() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function revisionRequestKey(runId, action, payload) {
  const fingerprint = JSON.stringify(payload);
  const id = `${runId}:${action}`;
  let saved = reviewRequestKeys.get(id);
  if (!saved || saved.fingerprint !== fingerprint) {
    saved = { fingerprint, key: reviewIdempotencyKey() };
    reviewRequestKeys.set(id, saved);
  }
  return saved.key;
}

function appendRevisionEvidence(parent, run, records) {
  if (!records.length) return;
  const section = document.createElement("section"); section.className = "ad-review-revisions";
  const title = document.createElement("h4"); title.textContent = "Before and after";
  const select = document.createElement("select"); select.setAttribute("aria-label", "Revision to compare");
  records.forEach((item, index) => select.append(new Option(`Revision ${item.revision}`, String(index))));
  select.value = String(records.length - 1);
  const grid = document.createElement("div"); grid.className = "ad-review-before-after";
  const draw = () => {
    grid.replaceChildren();
    const item = records[Number(select.value)];
    for (const label of ["before", "after"]) {
      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption"); caption.textContent = `${label === "before" ? "Before" : "After"} · ${reviewPlacement === "feed" ? "Feed" : "Story"}`;
      figure.append(caption);
      const name = item?.[label]?.[reviewPlacement];
      if (typeof name === "string" && /^rrev_[a-f0-9]{32}-(before|after)-(feed|story)\.png$/.test(name)) {
        const image = document.createElement("img");
        image.src = `/api/ad-template-generator/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(name)}`;
        image.alt = `${caption.textContent}, revision ${item.revision}`;
        image.dataset.reviewSnapshot = label;
        const frame = document.createElement("div"); frame.className = "ad-review-snapshot-stage"; frame.append(image);
        if (label === "before") (item.annotations || []).filter(area => area.placement === reviewPlacement).forEach((area, index) => {
          const mark = document.createElement("span"); mark.className = "ad-review-saved-area"; mark.textContent = String(index + 1);
          mark.style.left = `${area.x * 100}%`; mark.style.top = `${area.y * 100}%`;
          mark.style.width = `${area.width * 100}%`; mark.style.height = `${area.height * 100}%`;
          mark.title = area.message || item.message; frame.append(mark);
        });
        figure.append(frame);
      } else {
        const note = document.createElement("p"); note.textContent = label === "after" ? "Available when revision checks pass." : "Snapshot unavailable.";
        figure.append(note);
      }
      grid.append(figure);
    }
  };
  select.addEventListener("change", draw);
  section.append(title, select, grid); parent.append(section); draw();
}

function appendReviewChat(parent, run) {
  const section = document.createElement("section"); section.className = "ad-review-chat"; section.dataset.testid = "review-chat";
  const heading = document.createElement("h3"); heading.textContent = "Review chat";
  const state = document.createElement("p"); state.setAttribute("role", "status");
  const thread = document.createElement("div"); thread.className = "ad-review-chat-thread"; thread.setAttribute("aria-live", "polite");
  const evidence = document.createElement("div");
  const form = document.createElement("form"); form.className = "ad-review-chat-form";
  const label = document.createElement("label"); label.textContent = "What should change?";
  const input = document.createElement("textarea"); input.rows = 3; input.maxLength = 1200; input.dataset.testid = "review-chat-input";
  input.placeholder = "Describe a correction, or annotate the ad.";
  input.value = reviewDraftText.get(run.id) || "";
  input.addEventListener("input", () => { reviewDraftText.set(run.id, input.value); input.setCustomValidity(""); });
  label.append(input);
  const send = document.createElement("button"); send.type = "submit"; send.className = "ad-primary"; send.textContent = "Send correction"; send.dataset.testid = "review-chat-send";
  const undo = document.createElement("button"); undo.type = "button"; undo.className = "ad-text-button"; undo.textContent = "Undo last revision"; undo.dataset.testid = "review-undo";
  form.append(label, send); const history = document.createElement("details"); history.className = "ad-review-history";
  const historyLabel = document.createElement("summary"); historyLabel.textContent = "Previous corrections"; history.append(historyLabel,thread,evidence,undo);
  section.append(heading,state,form,history); parent.append(section);
  let loaded = false;
  let latest = reviewRevisionState.get(run.id);
  const currentStatus = () => (runs.find(item => item.id === run.id) || run).status;
  const readyForEdit = () => loaded && currentStatus() === "ready_for_review" && !reviewInFlight.has(run.id);
  const controls = () => {
    const ready = readyForEdit(); input.disabled = !ready; send.disabled = !ready;
    undo.hidden = !latest?.revisions?.some(item => item.revision === latest.current_revision && item.status === "ready_for_review");
    undo.disabled = !ready;
  };
  const drawHistory = data => {
    latest = data; reviewRevisionState.set(run.id, data);
    thread.replaceChildren(); evidence.replaceChildren();
    const records = Array.isArray(data.revisions) ? data.revisions : [];
    if (!records.length) thread.textContent = "No corrections yet.";
    for (const record of records) {
      const row = document.createElement("article"); row.dataset.testid = "review-comment-item";
      const body = document.createElement("p"); body.textContent = record.message || "Marked-area correction";
      const status = document.createElement("small");
      status.textContent = ({pending: "Revision queued or running", ready_for_review: "Checks passed. Ready for review", failed: "Revision needs attention", cancelled: "Revision cancelled"})[record.status] || record.status;
      row.append(body, status);
      for (const area of record.annotations || []) {
        const note = document.createElement("p"); note.textContent = `${area.placement === "story" ? "Story" : "Feed"} area: ${area.message || "See correction above"}`; row.append(note);
      }
      thread.append(row);
    }
    appendRevisionEvidence(evidence, run, records);
    controls();
  };
  const load = async () => {
    state.textContent = "Loading saved review…"; controls();
    try {
      const data = await getAdReviewRevisions(run.id, run.project_id);
      if (!section.isConnected) return;
      loaded = true; drawHistory(data);
      state.textContent = currentStatus() === "ready_for_review" ? "Corrections run through the template checks before approval." : "Editing is locked while this run is processing or already approved.";
    } catch (error) {
      state.textContent = error.message || "Review history is unavailable. Reload to try again.";
    }
    controls();
  };
  const submit = async action => {
    if (!readyForEdit()) return;
    const message = safeAnnotationText(input.value);
    const annotations = ["feed", "story"].flatMap(placement => serializeAnnotations(reviewDraftAnnotations.get(`${run.id}:${placement}`) || []).map(({comment, ...rect}) => ({...rect, placement, message: comment})));
    if (action === "message" && ((!message && !annotations.some(a => a.message)) || annotations.length > 8)) {
      input.setCustomValidity(annotations.length > 8 ? "Use at most eight marked areas across Feed and Story." : "Describe the correction or add a comment to a marked area."); input.reportValidity(); return;
    }
    const payload = {runId: run.id, projectId: run.project_id, expectedRevision: latest.current_revision};
    if (action === "message") Object.assign(payload, {message, annotations});
    payload.idempotencyKey = revisionRequestKey(run.id, action, payload);
    reviewInFlight.add(run.id); controls(); state.textContent = "Sending correction…";
    try {
      const result = await (action === "message" ? postAdReviewMessage(payload) : undoAdReviewRevision(payload));
      reviewRequestKeys.delete(`${run.id}:${action}`);
      if (action === "message") {
        reviewDraftText.delete(run.id);
        for (const placement of ["feed", "story"]) reviewDraftAnnotations.delete(`${run.id}:${placement}`);
      }
      runs = runs.map(item => item.id === run.id ? {...item, status: result.status || "queued", review_status: "revision_requested"} : item);
      const detail = await getAdTemplateGeneratorRun(run.id).catch(() => null);
      if (detail) runs = runs.map(item => item.id === run.id ? mergeAdTemplateGeneratorRun(item, detail) : item);
      reviewInFlight.delete(run.id);
      const current = runs.find(item => item.id === run.id) || run;
      renderReviewDetail(current); connectRunEvents(current);
    } catch (error) {
      state.textContent = error.message || "Could not confirm the correction. Retry sends the same request safely.";
      reviewInFlight.delete(run.id); controls();
    }
  };
  form.addEventListener("submit", event => { event.preventDefault(); void submit("message"); });
  undo.addEventListener("click", () => void submit("undo"));
  if (latest) drawHistory(latest);
  void load();
}

function appendReviewActions(parent, run) {
  const section = document.createElement("section");
  section.className = "ad-review-actions";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = reviewActionMessage || "Approval publishes this reviewed template to Blockwise.";
  const currentStatus = clean(run.review_status || run.output?.review_summary?.status || run.status).toLowerCase().replaceAll("-", "_");
  if (currentStatus !== "ready_for_review") {
    status.textContent = reviewActionMessage || `This review is now ${runStatusLabel(currentStatus).toLowerCase()}.`;
    section.append(status);
    parent.append(section);
    return;
  }
  const editorUrl = blockwiseTemplateUrl(run.output?.import);
  if (editorUrl) {
    const editor = document.createElement("a");
    editor.className = "ad-primary";
    editor.href = editorUrl;
    editor.target = "_blank";
    editor.rel = "noopener noreferrer";
    editor.textContent = "Edit in Blockwise";
    editor.setAttribute("aria-label", "Edit imported template in Blockwise");
    section.append(editor);
  }
  const buttons = document.createElement("div");
  const request = document.createElement("button"); request.type = "button"; request.className = "ad-text-button"; request.textContent = "Request Changes";
  const discard = document.createElement("button"); discard.type = "button"; discard.className = "ad-text-button ad-review-discard"; discard.textContent = "Discard";
  const approve = document.createElement("button"); approve.type = "button"; approve.className = "ad-primary"; approve.textContent = "Approve & Publish Template";
  [request, discard, approve].forEach((button) => { button.disabled = reviewActionPending; });
  buttons.append(request, discard, approve);
  section.append(status, buttons);
  const formHost = document.createElement("div"); formHost.className = "ad-review-action-form"; section.append(formHost);

  const act = async (callback, pendingLabel) => {
    reviewActionPending = true; reviewActionMessage = pendingLabel; renderReviewDetail(run);
    try {
      const updated = await callback();
      if (updated) {
        const merged = mergeAdTemplateGeneratorRun(runs.find((item) => item.id === run.id), updated);
        runs = runs.map((item) => item.id === run.id ? merged : item);
        run = merged;
      }
      reviewActionMessage = pendingLabel === "Publishing…" ? "Approved and sent to Blockwise." : pendingLabel === "Sending changes…" ? "Changes requested. Hermes will continue this run." : "Template discarded.";
      await refreshRunsSafe();
    } catch (error) {
      reviewActionMessage = error?.message || "The action failed. Try again.";
    } finally {
      reviewActionPending = false; renderRuns(); renderReviewQueue(); renderReviewDetail(run);
    }
  };

  approve.addEventListener("click", () => void act(() => approveAdTemplateGeneratorTemplate(run.id), "Publishing…"));
  request.addEventListener("click", () => $("[data-testid=review-chat-input]")?.focus());
  discard.addEventListener("click", () => {
    formHost.replaceChildren();
    const form = document.createElement("form");
    const label = document.createElement("label"); label.textContent = "Discard reason (optional)";
    const textarea = document.createElement("textarea"); textarea.maxLength = 1000; textarea.rows = 3;
    label.append(textarea);
    const row = document.createElement("div");
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ad-text-button"; cancel.textContent = "Keep template"; cancel.addEventListener("click", () => formHost.replaceChildren());
    const submit = document.createElement("button"); submit.type = "submit"; submit.className = "ad-primary ad-danger-button"; submit.textContent = "Confirm discard";
    row.append(cancel, submit); form.append(label, row); formHost.append(form); textarea.focus();
    form.addEventListener("submit", (event) => { event.preventDefault(); void act(() => discardAdTemplateGeneratorTemplate(run.id, clean(textarea.value)), "Discarding…"); });
  });
  parent.append(section);
}

function renderReviewDetail(run, { loading = false } = {}) {
  const detail = $("#ad-review-detail");
  if (!detail || !run) return;
  detail.replaceChildren();
  const review = { ...(run.output?.review_summary || {}) };
  if (!review.reusable_validation && run.output?.reusable_validation) review.reusable_validation = run.output.reusable_validation;
  const heading = document.createElement("header");
  heading.className = "ad-review-detail-head";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("span"); eyebrow.textContent = loading ? "Loading recorded evidence…" : "Ready for your review";
  const title = document.createElement("h3"); title.textContent = run.title || run.source?.name || "Template review";
  const source = document.createElement("p"); source.textContent = run.source?.name || "Source recorded in Hermes";
  copy.append(eyebrow, title, source);
  const score = document.createElement("div"); score.className = "ad-review-hero-score"; score.innerHTML = `<strong>${reviewScoreLabel(reviewOverallScore(review))}</strong><span>likeness</span>`;
  heading.append(copy, score); detail.append(heading);
  appendReviewWorkspace(detail, run, review);
  const checks = document.createElement("details"); checks.className = "ad-review-secondary";
  const checksTitle = document.createElement("summary"); checksTitle.textContent = "Comparison and quality checks"; checks.append(checksTitle);
  appendReviewFacts(checks,review); appendReviewEvidence(checks,run,review); appendMetaPreviews(checks,review); appendRecordedDetails(checks,run,review); detail.append(checks);
  appendReviewActions(detail, run);
}

function formatCost(run) {
  const reported = firstNumber(run.cost, run.usage?.reported_cost_usd, run.output?.cost?.actual_usd, run.output?.cost?.reported_usd);
  if (reported !== null) return `$${reported.toFixed(3)} reported`;
  const estimated = firstNumber(run.usage?.estimated_cost_usd);
  return estimated !== null ? `$${estimated.toFixed(3)} estimated` : "Cost not reported";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(number)) return number;
  }
  return null;
}

function formatScore(value) {
  return value === null ? "Not recorded" : Number(value).toFixed(1);
}

function renderPhaseTimeline(run, parent) {
  const section = document.createElement("section");
  section.className = "ad-phase-section";
  const heading = document.createElement("div");
  heading.className = "ad-inline-heading";
  heading.innerHTML = "<strong>Run lifecycle</strong><span>Select a stage to inspect its evidence.</span>";
  const stages = document.createElement("div");
  stages.className = "ad-phase-rail";
  const current = canonicalStage(run.stage);
  const currentIndex = PIPELINE_STAGES.indexOf(current);
  const recorded = new Set(runEvents.filter((event) => event.kind === "stage.started").map((event) => canonicalStage(event.node_id)));
  PIPELINE_STAGES.forEach((id, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const completed = run.status === "completed" || (currentIndex >= 0 && index < currentIndex);
    const active = id === current;
    button.className = `ad-phase${completed ? " is-done" : ""}${active ? " is-current" : ""}${recorded.has(id) ? " is-recorded" : ""}`;
    button.innerHTML = `<i aria-hidden="true"></i><span>${escapeHtml(PIPELINE_LABELS[id] || id)}</span>`;
    button.setAttribute("aria-label", `${PIPELINE_LABELS[id] || id}${active ? ", current stage" : completed ? ", completed" : ""}`);
    button.addEventListener("click", () => {
      selectedStage = { source_id: id, label: PIPELINE_LABELS[id] || id, kind: "stage" };
      activate("pipeline");
      updateEvidence();
    });
    stages.append(button);
  });
  section.append(heading, stages);
  parent.append(section);
}

function renderPersistedSource(run, parent) {
  if (!run.source?.url) return;
  const section = document.createElement("section");
  section.className = "ad-preview-section ad-source-record";
  section.innerHTML = '<div class="ad-inline-heading"><strong>Source</strong><span>Saved with this run and available after reconnecting.</span></div>';
  const grid = document.createElement("div");
  grid.className = "ad-preview-grid";
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  image.src = run.source.url;
  image.alt = `${run.source.name || "Uploaded source"} source image`;
  const caption = document.createElement("figcaption");
  caption.textContent = run.source.name || "Uploaded source";
  figure.append(image, caption);
  grid.append(figure);
  section.append(grid);
  parent.append(section);
}

function renderPreviewGallery(run, parent) {
  const raw = Array.isArray(run.output?.previews) ? run.output.previews : (run.output?.preview ? [run.output.preview] : []);
  const previews = raw.map((item, index) => typeof item === "string" ? { url: item, label: `Preview ${index + 1}` } : { ...item, label: item.placement || item.label || item.name || `Preview ${index + 1}` }).filter((item) => item.url);
  if (!previews.length) return;
  const section = document.createElement("section");
  section.className = "ad-preview-section";
  section.innerHTML = '<div class="ad-inline-heading"><strong>Latest render</strong><span>Feed and Story are separate editable layouts.</span></div>';
  const grid = document.createElement("div");
  grid.className = "ad-preview-grid";
  previews.forEach((preview) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = preview.url;
    image.alt = `${preview.label} generated template preview`;
    const caption = document.createElement("figcaption");
    caption.textContent = preview.label;
    figure.append(image, caption);
    grid.append(figure);
  });
  section.append(grid);
  parent.append(section);
}

function renderGenerationHistory(run, parent) {
  const records = Array.isArray(run.output?.iterations) ? run.output.iterations : [];
  const finalReview = run.output?.final_review;
  const section = document.createElement("section"); section.className = "ad-generation-section";
  const heading = document.createElement("div"); heading.className = "ad-inline-heading";
  heading.innerHTML = "<strong>Iteration history</strong><span>" + (records.length ? records.length + " comparator" + (records.length === 1 ? "" : "s") + " recorded" : "Hermes will record each iteration.") + "</span>";
  section.append(heading);
  const list = document.createElement("div"); list.className = "ad-generation-list";
  records.forEach((record) => {
    const row = document.createElement("article"); row.className = "ad-generation-row";
    const comparison = record.comparison || {};
    const title = document.createElement("div"); title.innerHTML = "<strong>Iteration " + record.iteration + "</strong><span>" + escapeHtml(String(record.decision || "revise")) + "</span>";
    const scores = document.createElement("div"); scores.className = "ad-generation-scores";
    scores.innerHTML = "<span>Comparator <b>" + formatScore(comparison.score) + "</b></span>";
    const note = document.createElement("p"); note.textContent = comparison.reason || "No comparator note was recorded.";
    row.append(title, scores, note);
    const previews = Array.isArray(record.previews) ? record.previews : [];
    if (previews.length) {
      const gallery = document.createElement("div"); gallery.className = "ad-preview-grid ad-iteration-previews";
      previews.forEach((preview) => {
        if (!preview?.url) return;
        const figure = document.createElement("figure");
        const image = document.createElement("img"); image.src = preview.url; image.alt = `Iteration ${record.iteration} ${preview.placement || "template"} preview`;
        const caption = document.createElement("figcaption"); caption.textContent = (preview.placement || "template").replace(/^./, (char) => char.toUpperCase());
        figure.append(image, caption); gallery.append(figure);
      });
      if (gallery.children.length) row.append(gallery);
    }
    list.append(row);
  });
  if (finalReview && Array.isArray(finalReview.reviewers) && finalReview.reviewers.length) {
    const review = document.createElement("p"); review.className = "ad-review-summary";
    review.textContent = "Final review: " + finalReview.reviewers.map((item, index) => `Reviewer ${index + 1} ${formatScore(item.score)}`).join(" · ") + " · " + (finalReview.decision || "recorded");
    section.append(review);
  }
  section.append(list); parent.append(section);
}

function renderModelProfile(run, parent) {
  const profile = run.model_profile && typeof run.model_profile === "object" ? run.model_profile : {};
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const usage = run.usage && typeof run.usage === "object" ? run.usage : {};
  if (!roles.length && !usage.source) return;
  const section = document.createElement("section");
  section.className = "ad-model-profile";
  const heading = document.createElement("div");
  heading.className = "ad-inline-heading";
  const title = document.createElement("strong");
  title.textContent = "Models and usage";
  const source = document.createElement("span");
  source.textContent = `${profile.source || usage.source || "Hermes run ledger"}${profile.revision ? ` · revision ${profile.revision}` : ""}`;
  heading.append(title, source);
  section.append(heading);
  if (roles.length) {
    const grid = document.createElement("div");
    grid.className = "ad-model-role-grid";
    roles.forEach((role) => {
      const item = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = role.label || role.role || "Model role";
      const model = document.createElement("strong");
      model.textContent = role.model || "Not recorded";
      const provider = document.createElement("small");
      provider.textContent = role.provider || "Provider not recorded";
      item.append(label, model, provider);
      grid.append(item);
    });
    section.append(grid);
  }
  const usageLine = document.createElement("p");
  usageLine.className = "ad-usage-source";
  const tokens = firstNumber(usage.total_tokens);
  const tokenLabel = tokens === null ? "Tokens not reported" : `${Math.round(tokens).toLocaleString()} tokens`;
  usageLine.textContent = `${tokenLabel} · ${formatCost(run)} · ${usage.billing || "Billing source not reported"}`;
  section.append(usageLine);
  parent.append(section);
}


function renderRunDetail(run) {
  const detail = $("#ad-run-detail");
  detail.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "ad-run-summary";
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = run.title || "Ad Template Generator Run";
  const meta = document.createElement("p");
  const visibleStage = canonicalStage(run.stage);
  meta.textContent = `${runStatusLabel(run.status)} · ${PIPELINE_LABELS[visibleStage]} · ${formatCost(run)}`;
  copy.append(heading, meta);
  const live = document.createElement("span");
  live.className = "ad-live-state";
  live.textContent = ["completed", "failed", "cancelled"].includes(run.status) ? "Recorded" : "Live";
  summary.append(copy, live);
  detail.append(summary);
  const overview = document.createElement("dl");
  overview.className = "ad-run-facts";
  const facts = [["Run", run.id], ["Stage", PIPELINE_LABELS[visibleStage]]];
  if (run.output?.import?.template_id) facts.push(["Blockwise template", run.output.import.template_id]);
  for (const [label, value] of facts) {
    const item = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = value;
    if (label === "Run" || label === "Blockwise template") description.title = value;
    item.append(term, description); overview.append(item);
  }
  detail.append(overview);
  renderModelProfile(run, detail);
  renderPersistedSource(run, detail);
  renderPhaseTimeline(run, detail);
  const importReady = run.status === "completed" && ["imported", "replayed", "ready", "ok"].includes(String(run.output?.import?.status || "").toLowerCase());
  if (importReady) {
    const readySection = document.createElement("section"); readySection.className = "ad-template-ready";
    const copy = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = "Template ready";
    const evidence = document.createElement("p"); evidence.textContent = "Feed and Story are live in Blockwise.";
    copy.append(title, evidence); readySection.append(copy);
    const editorUrl = blockwiseTemplateUrl(run.output?.import);
    if (editorUrl) {
      const open = document.createElement("a"); open.className = "ad-primary"; open.href = editorUrl;
      open.target = "_blank"; open.rel = "noopener noreferrer"; open.setAttribute("aria-label", "Edit imported template in Blockwise"); open.textContent = "Open in Blockwise"; readySection.append(open);
    }
    detail.append(readySection);
  }

  if (run.attention || run.error) {
    const attention = document.createElement("div"); attention.className = "ad-attention";
    attention.textContent = run.error || "This Run needs attention."; detail.append(attention);
  }
  renderPreviewGallery(run, detail);
  renderGenerationHistory(run, detail);

  const activity = document.createElement("details");
  activity.className = "ad-live-activity";
  activity.innerHTML = '<summary>All recorded activity</summary><div id="ad-run-events"></div>';
  detail.append(activity);
  if (!["completed", "cancelled"].includes(run.status)) {
    const actions = document.createElement("div"); actions.className = "ad-run-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ad-text-button"; cancel.textContent = "Cancel Run";
    cancel.addEventListener("click", async () => { cancel.disabled = true; try { await cancelAdTemplateGeneratorRun(run.id); await selectRun(run.id); } catch { cancel.textContent = "Cancel failed — retry"; cancel.disabled = false; } });
    if (run.status === "failed") {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "ad-primary"; retry.textContent = "Retry from checkpoint";
      retry.addEventListener("click", async () => { retry.disabled = true; try { await retryAdTemplateGeneratorRun(run.id); await selectRun(run.id); } catch { retry.textContent = "Retry failed — try again"; retry.disabled = false; } });
      actions.append(retry);
    }
    actions.append(cancel); detail.append(actions);
  }
  $("#ad-pipeline-run").value = run.id;
  updateEvidence();
  renderEventViews();
}

const EVENT_KINDS = ["command.accepted", "run.recovered", "run.interrupted", "run.failed", "run.cancelled", "stage.started", "tool.started", "tool.completed", "provider.attempt", "subagent.start", "subagent.complete", "iteration.started", "iteration.rendered", "iteration.compared", "iteration.revised", "builder.escalated", "final-review.started", "final-review.completed", "template.ready_for_review", "template.revision_requested", "template.approved", "template.discarded", "smoke.completed", "template.imported", "template.ready-for-review", "template.published"];

const SAFE_TOOL_LABELS = {
  terminal: "Builder action",
  exec_command: "Builder action",
  execute_code: "Layout calculation",
  read_file: "Inspect source artifact",
  write_file: "Create template artifact",
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

function safeBuilderEscalationData(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const value = (field) => Object.prototype.hasOwnProperty.call(data, field) ? data[field] : event?.[field];
  return {
    iteration: firstNumber(value("iteration")),
    from_provider: redactOperatorText(value("from_provider")),
    from_model: redactOperatorText(value("from_model")),
    to_provider: redactOperatorText(value("to_provider")),
    to_model: redactOperatorText(value("to_model")),
    reason: redactOperatorText(value("reason")),
    previous_score: firstNumber(value("previous_score")),
    score: firstNumber(value("score")),
  };
}

function builderLabel(provider, model, fallback) {
  const leaf = clean(model || provider).split("/").pop();
  if (!leaf) return fallback;
  const named = leaf.match(/(?:^|[-_.])(luna|sol)$/i);
  return named ? named[1][0].toUpperCase() + named[1].slice(1).toLowerCase() : leaf.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeEventData(event) {
  const data = event?.data || {};
  if (event.kind === "stage.started") return { summary: `Started ${String(event.node_id || "pipeline stage").replaceAll("-", " ")}` };
  if (event.kind === "tool.started" || event.kind === "tool.completed") return { tool: SAFE_TOOL_LABELS[data.tool] || "Builder action", duration_seconds: data.duration_seconds, error: Boolean(data.error) };
  if (event.kind === "iteration.compared" || event.kind === "iteration.revised") return {
    iteration: firstNumber(data.iteration), score: firstNumber(data.score),
    reason: redactOperatorText(data.reason), decision: clean(data.decision),
  };
  if (event.kind === "builder.escalated") return safeBuilderEscalationData(event);
  if (event.kind === "final-review.completed") return { decision: clean(data.decision), reviewer_count: data.reviewer_count };
  if (event.kind === "run.failed") return { error: redactOperatorText(data.error) || "Run failed; diagnostics remain in Hermes." };
  if (event.kind === "template.imported") return { status: "ready" };
  return Object.fromEntries(Object.entries(data).filter(([key]) => ["attempt", "cost_usd", "input_tokens", "output_tokens", "will_resume"].includes(key)));
}

function safeEventSummary(event) {
  const data = safeEventData(event);
  if (event.kind === "tool.started" || event.kind === "tool.completed") return data.tool;
  if (event.kind === "stage.started") return data.summary;
  if (event.kind === "iteration.compared" || event.kind === "iteration.revised") return "Iteration " + (data.iteration || "?") + " - " + formatScore(data.score) + " - " + (data.decision || "revise") + (data.reason ? " - " + data.reason : "");
  if (event.kind === "builder.escalated") {
    const from = builderLabel(data.from_provider, data.from_model, "previous builder");
    const to = builderLabel(data.to_provider, data.to_model, "stronger builder");
    const reason = data.reason === "regression" ? "quality regressed"
      : data.reason === "insufficient_improvement" ? "two consecutive gains below 0.5"
        : data.reason.replace(/[_-]+/g, " ");
    const scores = data.previous_score !== null && data.score !== null ? ` (${formatScore(data.previous_score)} → ${formatScore(data.score)})` : "";
    return `Builder escalated: ${from} → ${to}${reason ? ` — ${reason}` : ""}${scores}`;
  }
  if (event.kind === "final-review.completed") return "Two final reviewers - " + (data.decision || "recorded");
  if (event.kind === "run.failed") return data.error;
  if (event.kind === "template.imported") return "Template imported";
  return event.node_id || "Recorded";
}



function renderEventViews() {
  const host = $("#ad-run-events");
  if (host) {
    host.replaceChildren();
    const visible = runEvents.slice(-40);
    if (!visible.length) host.innerHTML = '<p class="ad-evidence-empty">Waiting for the first durable event…</p>';
    for (const event of visible) {
      const row = document.createElement("div"); row.className = `ad-event ad-event-${event.status || "ok"}`;
      const time = document.createElement("time"); time.textContent = new Date(Number(event.timestamp || 0) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const copy = document.createElement("div");
      const strong = document.createElement("strong"); strong.textContent = String(event.kind || "activity").replaceAll(".", " ");
      const p = document.createElement("p"); p.textContent = safeEventSummary(event);
      copy.append(strong, p); row.append(time, copy); host.append(row);
    }
  }
  updateEvidence();
}

function mergeIterationEvent(run, item) {
  const data = item?.data || {};
  const iteration = firstNumber(data.iteration);
  if (!iteration) return;
  run.output = run.output && typeof run.output === "object" ? run.output : {};
  const records = Array.isArray(run.output.iterations) ? [...run.output.iterations] : [];
  let record = records.find((candidate) => Number(candidate?.iteration) === iteration);
  if (!record) { record = { iteration, decision: "revise", comparison: {}, previews: [] }; records.push(record); }
  if (item.kind === "iteration.rendered") {
    record.previews = (Array.isArray(data.previews) ? data.previews : []).map((preview) => ({
      ...preview,
      url: `/api/ad-template-generator/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(preview.name || "")}`,
    }));
  }
  if (item.kind === "iteration.compared") {
    record.comparison = { score: firstNumber(data.score), reason: String(data.reason || "") };
    record.decision = data.decision || (Number(data.score) >= 9.5 ? "accepted" : "revise");
  }
  run.output.iterations = records.sort((a, b) => Number(a.iteration) - Number(b.iteration));
}

const QUIET_RUN_STATUSES = new Set(["ready_for_review", "completed", "approved", "published", "active", "failed", "cancelled", "discarded", "blocked"]);
const REFRESH_RUN_EVENTS = new Set(["run.failed", "run.cancelled", "template.ready_for_review", "template.ready-for-review", "template.revision_requested", "template.approved", "template.published", "template.discarded", "smoke.completed", "template.smoke-tested", "template.imported"]);
function runNeedsEvents(run) {
  return !QUIET_RUN_STATUSES.has(String(run?.status || "").toLowerCase().replaceAll("-", "_"));
}

function connectRunEvents(run) {
  stopRunEvents();
  runEvents = [...(runEventCache.get(run.id) || [])];
  renderEventViews();
  const selection = runSelectionRevision;
  const stillSelected = () => active && selectedRunId === run.id && selection === runSelectionRevision;
  const currentRun = () => runs.find((candidate) => candidate.id === run.id) || run;
  const showStatus = (message) => {
    const state = $(selectedReviewRunId === run.id ? "#ad-review-live-state" : "#ad-live-state");
    if (state) state.textContent = message || runStatusLabel(currentRun().status);
  };
  const redraw = () => {
    const current = currentRun();
    if (selectedReviewRunId === run.id) renderReviewDetail(current);
    else renderRunDetail(current);
    renderReviewQueue();
  };
  const connect = () => {
    eventReconnectTimer = null;
    if (!stillSelected()) return;
    if (!runNeedsEvents(currentRun())) { showStatus(); return; }
    const cursor = runEvents.reduce((last, item) => Math.max(last, Number(item.sequence ?? -1)), -1);
    const stream = new EventSource(`/api/ad-template-generator/runs/${encodeURIComponent(run.id)}/events?after=${encodeURIComponent(cursor)}`);
    eventStream = stream;
    const reconcile = async () => {
      try {
        const detail = await getAdTemplateGeneratorRun(run.id);
        if (!stillSelected() || eventStream !== stream || !detail) return;
        run = mergeAdTemplateGeneratorRun(currentRun(), detail);
        runs = runs.map((candidate) => candidate.id === run.id ? run : candidate);
        redraw();
        if (!runNeedsEvents(run)) { stopRunEvents(); showStatus(); }
      } catch { /* Retain the recorded view and retry on the next connection. */ }
    };
    const receive = (event) => {
      if (!stillSelected() || eventStream !== stream) return;
      let item;
      try { item = JSON.parse(event.data); } catch { return; }
      if (!runEvents.some((existing) => existing.sequence === item.sequence)) {
        runEvents.push(item);
        runEvents.sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
        runEventCache.set(run.id, [...runEvents]);
      }
      run = currentRun();
      if (["iteration.rendered", "iteration.compared"].includes(item.kind)) mergeIterationEvent(run, item);
      if (item.kind === "stage.started" && item.node_id) {
        run.stage = canonicalStage(item.node_id);
        run.progress = Math.max(Number(run.progress || 0), Math.max(0, PIPELINE_STAGES.indexOf(run.stage)) / PIPELINE_STAGES.length);
      }
      runs = runs.map((candidate) => candidate.id === run.id ? run : candidate);
      redraw();
      if (REFRESH_RUN_EVENTS.has(item.kind)) void reconcile();
    };
    for (const kind of new Set([...EVENT_KINDS, ...REFRESH_RUN_EVENTS])) stream.addEventListener(kind, receive);
    stream.onopen = () => {
      if (!stillSelected() || eventStream !== stream) return;
      if (!runNeedsEvents(currentRun())) { stopRunEvents(); showStatus(); return; }
      showStatus("Live");
    };
    stream.onerror = async () => {
      if (!stillSelected() || eventStream !== stream) return;
      stream.close();
      // Hermes deliberately ends streams at the review/terminal boundary.
      // Read that state before labelling a normal close as a lost connection.
      await reconcile();
      if (!stillSelected() || eventStream !== stream) return;
      eventStream = null;
      if (!runNeedsEvents(currentRun())) { showStatus(); return; }
      showStatus("Reconnecting…");
      eventReconnectTimer = window.setTimeout(connect, 1500);
    };
  };
  connect();
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

async function loadProcessMonitors() {
  const archStatus = $("#ad-archify-status");
  const archLink = $("#ad-archify-link");
  const trailStatus = $("#ad-agenttrail-status");
  const trailBoard = $("#ad-agenttrail-board");
  try {
    const response = await fetch("/api/ad-template-generator/architecture");
    const data = await response.json();
    archStatus.textContent = data.available ? `Archify typed-IR artifact ready | ${data.revision || "pinned"}` : (data.message || "Archify artifact unavailable.");
    if (data.available && data.artifact_url) { archLink.href = data.artifact_url; archLink.hidden = false; }
  } catch (error) { archStatus.textContent = "Archify status unavailable."; }
  try {
    const response = await fetch("/api/ad-template-generator/implementation-activity");
    const data = await response.json();
    if (!data.available) { trailStatus.textContent = data.message || "AgentTrail board unavailable."; return; }
    trailStatus.textContent = `Read-only AgentTrail board | ${data.revision || "pinned"}`;
    trailBoard.hidden = false;
    trailBoard.textContent = JSON.stringify(data.board, null, 2);
  } catch (error) { trailStatus.textContent = "AgentTrail status unavailable."; }
}

function mountPipeline() {
  const root = $("#ad-pipeline-graph");
  const panel = $("[data-ad-panel=\"pipeline\"]");
  if (!active || !root || !panel.classList.contains("is-on") || graphHandle) return;
  if (graphMountPromise) return graphMountPromise;
  const revision = ++graphMountRevision;
  graphMountPromise = import("../graph/graph-workbench.bundle.js").then(({ mountGraphWorkbench }) => {
    if (!active || revision !== graphMountRevision || !root.isConnected || !panel.classList.contains("is-on")) return;
    void loadProcessMonitors();
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
  }).catch((error) => {
    if (active && revision === graphMountRevision && root.isConnected) root.textContent = error.message || "Pipeline graph unavailable.";
  }).finally(() => {
    graphMountPromise = null;
    if (active && revision !== graphMountRevision && panel.classList.contains("is-on") && !graphHandle) mountPipeline();
  });
  return graphMountPromise;
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
    input.textContent = selectedStage && selectedRunId ? "Source and run evidence are recorded in Hermes." : "Select a real run and stage to see its evidence.";
  }
  output.classList.toggle("ad-evidence-empty", !stageEvents.length);
  if (!stageEvents.length) output.textContent = "No safe result has been recorded for this stage yet.";
  else {
    const list = document.createElement("div");
    list.className = "ad-observed-list";
    stageEvents.forEach((event) => {
      const row = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = String(event.kind || "activity").replaceAll(".", " ");
      const summary = document.createElement("span");
      summary.textContent = safeEventSummary(event);
      row.append(label, summary);
      list.append(row);
    });
    output.append(list);
  }
  const inspector = $("#ad-stage-events");
  if (inspector) inspector.textContent = stageEvents.length ? `${stageEvents.length} durable event${stageEvents.length === 1 ? "" : "s"} recorded. Internal prompts and paths are excluded.` : "No events recorded for this stage yet.";
  const summary = $("#ad-stage-summary");
  if (summary) summary.textContent = selectedStage ? `${stageEvents.length} observed event${stageEvents.length === 1 ? "" : "s"} for ${selectedStage.label}.` : "Select a run or stage to inspect its recorded evidence.";
}

function requestEvent(name, detail) {
  return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, resolve, reject } })));
}

function setupRunForm() {
  const input = $("#ad-source-files");
  const drop = $("#ad-drop");
  const briefInput = $("#ad-run-brief");
  const briefLimit = $("#ad-run-brief-limit");
  const updateBriefLimit = () => {
    const validation = adTemplateGeneratorBriefValidation(briefInput.value);
    briefLimit.textContent = validation.valid
      ? `Up to ${AD_TEMPLATE_GENERATOR_BRIEF_MAX_CHARACTERS.toLocaleString("en-AU")} characters · ${validation.length.toLocaleString("en-AU")} used`
      : validation.message;
    briefLimit.classList.toggle("is-error", !validation.valid);
  };
  briefInput.addEventListener("input", updateBriefLimit);
  updateBriefLimit();
  input.addEventListener("change", () => {
    addLocalFiles(input.files);
    input.value = "";
  });
  drop.addEventListener("click", () => input.click());
  $("#ad-run-project").addEventListener("change", () => { void refreshRunsSafe(); void loadAdTemplateGeneratorModels(); });
  Object.values(MODEL_ROLE_FIELDS).forEach((selector) => {
    $(selector).addEventListener("change", () => { validateModelControls(); updateRunControls(); });
  });
  for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("is-drag"); });
  for (const type of ["dragleave", "drop"]) drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("is-drag");
    if (type === "drop") addLocalFiles(event.dataTransfer?.files);
  });
  $("#ad-run-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#ad-run-status");
    status.classList.remove("is-error");
    const brief = briefInput.value;
    const briefValidation = adTemplateGeneratorBriefValidation(brief);
    if (!briefValidation.valid) {
      status.textContent = briefValidation.message;
      status.classList.add("is-error");
      briefInput.focus();
      return;
    }
    const sources = selectedFiles.filter((source) => ["queued", "error"].includes(source.status));
    if (!sources.length) {
      status.textContent = selectedFiles.length ? "These images have already started. Clear the queue or add more." : "Add at least one source image.";
      status.classList.add("is-error");
      return;
    }
    batchStarting = true;
    sources.forEach((source) => { source.status = "uploading"; source.error = ""; });
    renderSourcePreview();
    status.textContent = `Uploading ${sources.length} image${sources.length === 1 ? "" : "s"}…`;
    try {
      const modelPolicyOverride = currentModelPolicy();
      const result = await requestEvent("frank:ad-template-generator-run", {
        sources, projectId: $("#ad-run-project").value,
        name: clean($("#ad-run-name").value), brief,
        modelPolicyOverride,
        onProgress: ({ key, status: nextStatus, run, error }) => updateSourceStatus(key, nextStatus, { run, error }),
      });
      const started = Array.isArray(result.runs) ? result.runs : [];
      const failed = Array.isArray(result.failures) ? result.failures : [];
      for (const source of sources) {
        if (!source.run?.id) continue;
        localRunInputs.set(source.run.id, { url: source.previewUrl, name: source.name });
      }
      status.textContent = failed.length
        ? `${started.length} run${started.length === 1 ? "" : "s"} started. ${failed.length} image${failed.length === 1 ? " needs" : "s need"} attention.`
        : `${started.length} run${started.length === 1 ? "" : "s"} started. You can close Frank; Hermes will keep working.`;
      status.classList.toggle("is-error", failed.length > 0);
      await refreshRunsSafe();
      if (started.length) {
        selectedRunId = started[0].id;
        activate("runs");
        await selectRun(started[0].id);
      }
    } catch (error) {
      status.textContent = error.message || "The Run could not be started.";
      status.classList.add("is-error");
    } finally {
      batchStarting = false;
      renderSourcePreview();
    }
  });
}

function setupPipelineForm() {
  $("#ad-pipeline-project").addEventListener("change", mountPipeline);
  $("#ad-pipeline-run").addEventListener("change", (event) => { const runId = event.target.value; if (runId) void selectRun(runId); else clearRunSelection(); });
  $$('[data-ad-open-pipeline]').forEach((button) => button.addEventListener("click", () => activate("pipeline")));
}

export function mountAdTemplateGenerator() {
  if (mounted) return;
  mounted = true;
  const tabs = $$("[data-ad-tab]");
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => { activate(button.dataset.adTab); });
    button.addEventListener("keydown", (event) => {
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      activate(next.dataset.adTab);
      next.focus();
    });
  });
  setupRunForm();
  setupPipelineForm();
  void loadProjects().then(async () => {
    await loadAdTemplateGeneratorModels();
    ready = true;
    resumeLiveUpdates();
  }).catch((error) => {
    $("#ad-run-status").textContent = error.message || "Ad Template Generator could not load.";
    $("#ad-run-status").classList.add("is-error");
  });
  window.addEventListener("beforeunload", () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
  window.addEventListener("online", () => resumeLiveUpdates());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLiveUpdates();
    else resumeLiveUpdates();
  });
}
