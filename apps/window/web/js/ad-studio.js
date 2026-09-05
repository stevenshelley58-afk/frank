import { mountGraphWorkbench } from "../graph/graph-workbench.bundle.js?v=20260822-ad-studio";
import { blockwiseTemplateUrl } from "./view-routing.js?v=20260830-ad-studio-route-v1";
import { groupAdStudioRuns, mergeAdStudioRun, mergeAdStudioRunList, readyAdStudioReviewRuns, runListRenderSignature, runTimestamp } from "./ad-studio-state.js?v=20260905-ready-review-v1";
import { AD_STUDIO_BRIEF_MAX_CHARACTERS, adStudioBriefValidation } from "./ad-studio-brief.js?v=20260904-brief-roundtrip-v1";
import { approveAdStudioTemplate, cancelAdStudioRun, discardAdStudioTemplate, getAdStudioRun, listAdStudioRuns, requestAdStudioTemplateChanges, retryAdStudioRun } from "./ad-studio-api.js?v=20260905-ready-review-v1";
import { placementScore, reviewArtifactPurpose, reviewModelProfile, reviewOverallScore, selectMetaPreview, selectReusableReviewArtifact, selectReviewArtifact } from "./ad-studio-review.js?v=20260905-ready-review-v1";

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
let reviewActionPending = false;
let reviewActionMessage = "";
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
let eventReconnectTimer = null;
const runEventCache = new Map();
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
    const ready = readyAdStudioReviewRuns(runs);
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
  const incoming = await listAdStudioRuns({ projectId, limit: 100 });
  if (refreshRevision !== runListRevision) return;
  const previousSignature = runListRenderSignature(runs);
  runs = mergeAdStudioRunList(runs, incoming);
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
    if (host && !host.children.length) host.innerHTML = '<div class="ad-empty"><strong>Jobs unavailable</strong><span>Frank cannot reach Hermes right now.</span></div>';
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
    const detail = await getAdStudioRun(run.id);
    if (detail) {
      if (selectionRevision !== runSelectionRevision || selectedRunId !== runId) return;
      run = mergeAdStudioRun(runs.find((item) => item.id === run.id), detail);
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
  const ready = readyAdStudioReviewRuns(runs);
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
    title.textContent = String(run.title || run.source?.name || "Template review").replace(/^Ad Studio\s*[·|-]?\s*/, "") || "Template review";
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
    const detail = await getAdStudioRun(runId);
    if (detail && selectionRevision === runSelectionRevision && selectedReviewRunId === runId) {
      run = mergeAdStudioRun(run, detail);
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
  const section = document.createElement("section");
  section.className = "ad-review-section ad-review-evidence";
  const heading = document.createElement("div");
  heading.className = "ad-inline-heading";
  heading.innerHTML = '<strong>Visual evidence</strong><span>Compare at Fit or actual pixels.</span>';
  const toolbar = document.createElement("div");
  toolbar.className = "ad-review-toolbar";
  const placements = document.createElement("div");
  placements.className = "ad-review-segments";
  placements.setAttribute("aria-label", "Placement");
  placements.append(
    makeSegment("Feed", "feed", reviewPlacement, (value) => { reviewPlacement = value; renderReviewDetail(run); }),
    makeSegment("Story", "story", reviewPlacement, (value) => { reviewPlacement = value; renderReviewDetail(run); }),
  );
  const views = document.createElement("div");
  views.className = "ad-review-segments ad-review-views";
  views.setAttribute("aria-label", "Evidence view");
  for (const [label, value] of [["Source", "source"], ["Template", "template"], ["Overlay", "overlay"], ["Difference", "difference"]]) {
    views.append(makeSegment(label, value, reviewView, (next) => { reviewView = next; renderReviewDetail(run); }));
  }
  const zoom = document.createElement("div");
  zoom.className = "ad-review-segments";
  zoom.setAttribute("aria-label", "Zoom");
  zoom.append(
    makeSegment("Fit", "fit", reviewZoom, (value) => { reviewZoom = value; renderReviewDetail(run); }),
    makeSegment("100%", "actual", reviewZoom, (value) => { reviewZoom = value; renderReviewDetail(run); }),
  );
  toolbar.append(placements, views, zoom);
  const viewport = document.createElement("div");
  viewport.className = `ad-review-viewport is-${reviewZoom}`;
  const selectedArtifact = selectReviewArtifact(summary, reviewPlacement, reviewView);
  appendReviewImage(viewport, selectedArtifact, reviewView.replace(/^./, (value) => value.toUpperCase()));
  section.append(heading, toolbar, viewport); parent.append(section);
  if (reviewView === "template" && reviewArtifactPurpose(selectedArtifact) === "qa-source-filled") {
    const note = document.createElement("p");
    note.className = "ad-review-evidence-note";
    note.textContent = "QA fidelity render · filled with the source only for comparison. Source pixels do not ship in the reusable template.";
    section.append(note);
  }
  const reusable = selectReusableReviewArtifact(summary, reviewPlacement);
  if (reviewView === "template" && reusable && reusable.name !== selectedArtifact?.name) {
    const reusableSection = document.createElement("section");
    reusableSection.className = "ad-review-reusable";
    const copy = document.createElement("div");
    copy.innerHTML = "<strong>Reusable customer default</strong><span>This exact neutral render is imported into Blockwise.</span>";
    const image = document.createElement("img"); image.src = reusable.url; image.alt = `${reviewPlacement} reusable customer default`;
    reusableSection.append(copy, image); section.append(reusableSection);
  }
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
        const merged = mergeAdStudioRun(runs.find((item) => item.id === run.id), updated);
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

  approve.addEventListener("click", () => void act(() => approveAdStudioTemplate(run.id), "Publishing…"));
  request.addEventListener("click", () => {
    formHost.replaceChildren();
    const form = document.createElement("form");
    const label = document.createElement("label"); label.textContent = "What must change?";
    const textarea = document.createElement("textarea"); textarea.required = true; textarea.maxLength = 2000; textarea.rows = 4; textarea.placeholder = "Be specific about the visual difference to correct.";
    label.append(textarea);
    const row = document.createElement("div");
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ad-text-button"; cancel.textContent = "Cancel"; cancel.addEventListener("click", () => formHost.replaceChildren());
    const submit = document.createElement("button"); submit.type = "submit"; submit.className = "ad-primary"; submit.textContent = "Send changes";
    row.append(cancel, submit); form.append(label, row); formHost.append(form); textarea.focus();
    form.addEventListener("submit", (event) => { event.preventDefault(); const instructions = clean(textarea.value); if (instructions) void act(() => requestAdStudioTemplateChanges(run.id, instructions), "Sending changes…"); });
  });
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
    form.addEventListener("submit", (event) => { event.preventDefault(); void act(() => discardAdStudioTemplate(run.id, clean(textarea.value)), "Discarding…"); });
  });
  parent.append(section);
}

function renderReviewDetail(run, { loading = false } = {}) {
  const detail = $("#ad-review-detail");
  if (!detail || !run) return;
  detail.replaceChildren();
  const review = run.output?.review_summary || {};
  const heading = document.createElement("header");
  heading.className = "ad-review-detail-head";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("span"); eyebrow.textContent = loading ? "Loading recorded evidence…" : "Ready for your review";
  const title = document.createElement("h3"); title.textContent = run.title || run.source?.name || "Template review";
  const source = document.createElement("p"); source.textContent = run.source?.name || "Source recorded in Hermes";
  copy.append(eyebrow, title, source);
  const score = document.createElement("div"); score.className = "ad-review-hero-score"; score.innerHTML = `<strong>${reviewScoreLabel(reviewOverallScore(review))}</strong><span>likeness</span>`;
  heading.append(copy, score); detail.append(heading);
  appendReviewFacts(detail, review);
  appendReviewEvidence(detail, run, review);
  appendMetaPreviews(detail, review);
  appendRecordedDetails(detail, run, review);
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
    cancel.addEventListener("click", async () => { cancel.disabled = true; try { await cancelAdStudioRun(run.id); await selectRun(run.id); } catch { cancel.textContent = "Cancel failed — retry"; cancel.disabled = false; } });
    if (run.status === "failed") {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "ad-primary"; retry.textContent = "Retry from checkpoint";
      retry.addEventListener("click", async () => { retry.disabled = true; try { await retryAdStudioRun(run.id, run.stage); await selectRun(run.id); } catch { retry.textContent = "Retry failed — try again"; retry.disabled = false; } });
      actions.append(retry);
    }
    actions.append(cancel); detail.append(actions);
  }
  $("#ad-pipeline-run").value = run.id;
  updateEvidence();
  renderEventViews();
}

const EVENT_KINDS = ["command.accepted", "run.recovered", "run.interrupted", "run.failed", "run.cancelled", "stage.started", "tool.started", "tool.completed", "subagent.start", "subagent.complete", "iteration.started", "iteration.rendered", "iteration.compared", "iteration.revised", "builder.escalated", "final-review.started", "final-review.completed", "template.ready_for_review", "template.revision_requested", "template.approved", "template.discarded", "smoke.completed", "template.imported"];

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
    record.decision = data.decision || (Number(data.score) >= 9.8 ? "accepted" : "revise");
  }
  run.output.iterations = records.sort((a, b) => Number(a.iteration) - Number(b.iteration));
}

function connectRunEvents(run) {
  eventStream?.close();
  if (eventReconnectTimer) window.clearTimeout(eventReconnectTimer);
  eventReconnectTimer = null;
  runEvents = [...(runEventCache.get(run.id) || [])];
  renderEventViews();
  const connect = () => {
    if (selectedRunId !== run.id) return;
    const cursor = runEvents.reduce((last, item) => Math.max(last, Number(item.sequence ?? -1)), -1);
    const stream = new EventSource(`/api/ad-studio/runs/${encodeURIComponent(run.id)}/events?after=${encodeURIComponent(cursor)}`);
    eventStream = stream;
  const receive = (event) => {
    try {
      if (eventStream !== stream || selectedRunId !== run.id) return;
      const item = JSON.parse(event.data);
      if (!runEvents.some((existing) => existing.sequence === item.sequence)) {
        runEvents.push(item);
        runEvents.sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
        runEventCache.set(run.id, [...runEvents]);
      }
      run = mergeAdStudioRun(runs.find((candidate) => candidate.id === run.id), run);
      if (["iteration.rendered", "iteration.compared"].includes(item.kind)) mergeIterationEvent(run, item);
      if (item.kind === "stage.started" && item.node_id) {
        run.stage = canonicalStage(item.node_id);
        run.progress = Math.max(Number(run.progress || 0), Math.max(0, PIPELINE_STAGES.indexOf(run.stage)) / PIPELINE_STAGES.length);
      }
      runs = runs.map((candidate) => candidate.id === run.id ? run : candidate);
      if (selectedReviewRunId === run.id) renderReviewDetail(run);
      else renderRunDetail(run);
      renderReviewQueue();
      if (["run.failed", "run.cancelled", "template.ready_for_review", "template.revision_requested", "template.approved", "template.discarded", "smoke.completed", "template.imported"].includes(item.kind)) void refreshRunsSafe().then(() => {
        if (eventStream !== stream || selectedRunId !== run.id) return;
        const updated = runs.find((candidate) => candidate.id === run.id);
        if (updated && selectedReviewRunId === run.id) renderReviewDetail(updated);
        else if (updated) renderRunDetail(updated);
      });
    } catch { /* a keepalive contains no event data */ }
  };
  for (const kind of EVENT_KINDS) stream.addEventListener(kind, receive);
  stream.onopen = () => {
    for (const selector of ["#ad-live-state", "#ad-review-live-state"]) { const state = $(selector); if (state) state.textContent = "Live"; }
  };
  stream.onerror = () => {
    if (eventStream !== stream) return;
    stream.close();
    for (const selector of ["#ad-live-state", "#ad-review-live-state"]) { const state = $(selector); if (state) state.textContent = "Reconnecting…"; }
    eventReconnectTimer = window.setTimeout(connect, 1_500);
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
