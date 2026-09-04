import { mountGraphWorkbench } from "../graph/graph-workbench.bundle.js?v=20260822-ad-studio";
import { blockwiseTemplateUrl } from "./view-routing.js?v=20260830-ad-studio-route-v1";
import { groupAdStudioRuns, mergeAdStudioRun, mergeAdStudioRunList, runListRenderSignature, runTimestamp } from "./ad-studio-state.js?v=20260904-run-history-v1";
import { AD_STUDIO_BRIEF_MAX_CHARACTERS, adStudioBriefValidation } from "./ad-studio-brief.js?v=20260904-brief-roundtrip-v1";

const TOOL_ID = "ad-template-generator";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let mounted = false;
let projects = [];
let runs = [];
let selectedRunId = "";
let runSelectionRevision = 0;
let runListRevision = 0;
let selectedStage = null;
let graphHandle = null;
let selectedFiles = [];
let batchStarting = false;
let runRefreshPending = false;
const localRunInputs = new Map();
const previewUrls = new Set();
let runEvents = [];
let eventStream = null;
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"]);
const MAX_BATCH_SOURCES = 20;
const SOURCE_STATUS = {
  queued: "Ready",
  uploading: "Uploading…",
  starting: "Starting…",
  started: "Job started",
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


function runStatusLabel(status) {
  return ({ queued: "Running", started: "Running", running: "Running", completed: "Complete", failed: "Failed", cancelled: "Cancelled", unavailable: "Status unavailable" })[status] || "Running";
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
    count.textContent = batchStarting ? "Starting jobs…" : `${runnable} image${runnable === 1 ? "" : "s"} ready to run`;
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
  status.textContent = "Add one or more images. Each image becomes its own background job.";
}

function updateRunControls() {
  const submit = $("#ad-run-submit");
  if (!submit) return;
  const runnable = selectedFiles.filter((source) => ["queued", "error"].includes(source.status)).length;
  submit.disabled = batchStarting || runnable === 0;
  submit.textContent = batchStarting ? "Starting…" : runnable ? `Run ${runnable} job${runnable === 1 ? "" : "s"}` : "Run jobs";
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
  for (const group of groupAdStudioRuns(runs)) {
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
  title.textContent = String(run.title || "Ad Studio job").replace(/^Ad Studio\s*[·|-]?\s*/, "") || "Job";
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
    empty.innerHTML = "<strong>No jobs yet</strong><span>Run a source image to create the first real Ad Studio job.</span>";
    host.append(empty);
    renderRunOptions();
    return;
  }
  for (const group of groupAdStudioRuns(runs)) {
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
  const query = new URLSearchParams({ limit: "100" });
  if (projectId) query.set("project_id", projectId);
  const response = await fetch(`/api/ad-studio/runs?${query}`);
  if (!response.ok) throw new Error("Hermes job history is unavailable");
  const data = await response.json();
  if (refreshRevision !== runListRevision) return;
  const previousSignature = runListRenderSignature(runs);
  runs = mergeAdStudioRunList(runs, data.runs);
  if (runListRenderSignature(runs) !== previousSignature) renderRuns();
}

async function refreshRunsSafe() {
  if (runRefreshPending) return;
  runRefreshPending = true;
  try {
    await refreshRuns();
  } catch {
    const host = $("#ad-runs-list");
    if (host && !host.children.length) host.innerHTML = '<div class="ad-empty"><strong>Jobs unavailable</strong><span>Frank cannot reach Hermes right now.</span></div>';
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
    const response = await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}`);
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.run) {
      if (selectionRevision !== runSelectionRevision || selectedRunId !== runId) return;
      run = mergeAdStudioRun(runs.find((item) => item.id === run.id), data.run);
      runs = runs.map((item) => item.id === run.id ? run : item);
      renderRuns();
    }
  } catch { /* keep the last visible status */ }
  if (selectionRevision !== runSelectionRevision || selectedRunId !== runId) return;
  run = runs.find((item) => item.id === runId) || run;
  renderRunDetail(run);
  connectRunEvents(run);
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
  heading.textContent = run.title || "Ad Studio job";
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
      open.target = "_blank"; open.rel = "noopener noreferrer"; open.textContent = "Open in Blockwise"; readySection.append(open);
    }
    detail.append(readySection);
  }

  if (run.attention || run.error) {
    const attention = document.createElement("div"); attention.className = "ad-attention";
    attention.textContent = run.error || "This job needs attention."; detail.append(attention);
  }
  renderPreviewGallery(run, detail);
  renderGenerationHistory(run, detail);

  const activity = document.createElement("details");
  activity.className = "ad-live-activity";
  activity.innerHTML = '<summary>All recorded activity</summary><div id="ad-run-events"></div>';
  detail.append(activity);
  if (!["completed", "cancelled"].includes(run.status)) {
    const actions = document.createElement("div"); actions.className = "ad-run-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ad-text-button"; cancel.textContent = "Cancel job";
    cancel.addEventListener("click", async () => { cancel.disabled = true; try { const response = await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!response.ok) throw new Error("Cancel failed"); await selectRun(run.id); } catch { cancel.textContent = "Cancel failed — retry"; cancel.disabled = false; } });
    if (run.status === "failed") {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "ad-primary"; retry.textContent = "Retry from checkpoint";
      retry.addEventListener("click", async () => { retry.disabled = true; try { const response = await fetch(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_stage: run.stage }) }); if (!response.ok) throw new Error("Retry failed"); await selectRun(run.id); } catch { retry.textContent = "Retry failed — try again"; retry.disabled = false; } });
      actions.append(retry);
    }
    actions.append(cancel); detail.append(actions);
  }
  $("#ad-pipeline-run").value = run.id;
  updateEvidence();
  renderEventViews();
}

const EVENT_KINDS = ["command.accepted", "run.recovered", "run.interrupted", "run.failed", "run.cancelled", "stage.started", "tool.started", "tool.completed", "subagent.start", "subagent.complete", "iteration.started", "iteration.rendered", "iteration.compared", "iteration.revised", "builder.escalated", "final-review.started", "final-review.completed", "template.imported"];

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
      url: `/api/ad-studio/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(preview.name || "")}`,
    }));
  }
  if (item.kind === "iteration.compared") {
    record.comparison = { score: firstNumber(data.score), reason: String(data.reason || "") };
    record.decision = data.decision || (Number(data.score) >= 9.5 ? "accepted" : "revise");
  }
  run.output.iterations = records.sort((a, b) => Number(a.iteration) - Number(b.iteration));
}

function connectRunEvents(run) {
  eventStream?.close();
  runEvents = [];
  renderEventViews();
  const stream = new EventSource(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/events?after=-1`);
  eventStream = stream;
  const receive = (event) => {
    try {
      if (eventStream !== stream || selectedRunId !== run.id) return;
      const item = JSON.parse(event.data);
      if (!runEvents.some((existing) => existing.sequence === item.sequence)) {
        runEvents.push(item);
        runEvents.sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
      }
      run = mergeAdStudioRun(runs.find((candidate) => candidate.id === run.id), run);
      if (["iteration.rendered", "iteration.compared"].includes(item.kind)) mergeIterationEvent(run, item);
      if (item.kind === "stage.started" && item.node_id) {
        run.stage = canonicalStage(item.node_id);
        run.progress = Math.max(Number(run.progress || 0), Math.max(0, PIPELINE_STAGES.indexOf(run.stage)) / PIPELINE_STAGES.length);
      }
      runs = runs.map((candidate) => candidate.id === run.id ? run : candidate);
      renderRunDetail(run);
      if (["run.failed", "run.cancelled", "template.imported"].includes(item.kind)) void refreshRunsSafe().then(() => {
        if (eventStream !== stream || selectedRunId !== run.id) return;
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

async function loadProcessMonitors() {
  const archStatus = $("#ad-archify-status");
  const archLink = $("#ad-archify-link");
  const trailStatus = $("#ad-agenttrail-status");
  const trailBoard = $("#ad-agenttrail-board");
  try {
    const response = await fetch("/api/ad-studio/architecture");
    const data = await response.json();
    archStatus.textContent = data.available ? `Archify typed-IR artifact ready | ${data.revision || "pinned"}` : (data.message || "Archify artifact unavailable.");
    if (data.available && data.artifact_url) { archLink.href = data.artifact_url; archLink.hidden = false; }
  } catch (error) { archStatus.textContent = "Archify status unavailable."; }
  try {
    const response = await fetch("/api/ad-studio/implementation-activity");
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
  if (!root || !panel.classList.contains("is-on")) return;
  void loadProcessMonitors();
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
    const validation = adStudioBriefValidation(briefInput.value);
    briefLimit.textContent = validation.valid
      ? `Up to ${AD_STUDIO_BRIEF_MAX_CHARACTERS.toLocaleString("en-AU")} characters · ${validation.length.toLocaleString("en-AU")} used`
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
  $("#ad-run-project").addEventListener("change", () => { void refreshRunsSafe(); });
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
    const briefValidation = adStudioBriefValidation(brief);
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
      const result = await requestEvent("frank:ad-studio-run", {
        sources, projectId: $("#ad-run-project").value,
        name: clean($("#ad-run-name").value), brief,
        onProgress: ({ key, status: nextStatus, run, error }) => updateSourceStatus(key, nextStatus, { run, error }),
      });
      const started = Array.isArray(result.runs) ? result.runs : [];
      const failed = Array.isArray(result.failures) ? result.failures : [];
      for (const source of sources) {
        if (!source.run?.id) continue;
        localRunInputs.set(source.run.id, { url: source.previewUrl, name: source.name });
      }
      status.textContent = failed.length
        ? `${started.length} job${started.length === 1 ? "" : "s"} started. ${failed.length} image${failed.length === 1 ? " needs" : "s need"} attention.`
        : `${started.length} background job${started.length === 1 ? "" : "s"} started. You can close Frank; Hermes will keep working.`;
      status.classList.toggle("is-error", failed.length > 0);
      await refreshRunsSafe();
      if (started.length) {
        selectedRunId = started[0].id;
        activate("runs");
        await selectRun(started[0].id);
      }
    } catch (error) {
      status.textContent = error.message || "The job could not be started.";
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

export function mountAdStudio() {
  if (mounted) { void refreshRunsSafe(); return; }
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
    await refreshRunsSafe();
    if ($("[data-ad-panel=\"pipeline\"]").classList.contains("is-on")) mountPipeline();
  }).catch((error) => {
    $("#ad-run-status").textContent = error.message || "Ad Studio could not load.";
    $("#ad-run-status").classList.add("is-error");
  });
  window.addEventListener("beforeunload", () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
  window.addEventListener("online", () => void refreshRunsSafe());
  window.setInterval(() => {
    if (!document.hidden) void refreshRunsSafe();
  }, 5_000);
}
