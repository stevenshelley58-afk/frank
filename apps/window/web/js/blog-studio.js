import { mountGraphWorkbench } from "../graph/graph-workbench.bundle.js?v=20260822-blog-studio";

const TOOL_ID = "content-factory";
const MAX_SOURCE_FILES = 20;
const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EVENT_HISTORY = 250;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clean = (value) => String(value ?? "").trim();
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

const STAGES = ["source", "research", "brief", "draft", "edit", "package", "qa", "human-approval", "release"];
const STAGE_LABELS = {
  source: "Source",
  research: "Research",
  brief: "Brief",
  draft: "Draft",
  edit: "Edit",
  package: "Package",
  qa: "Quality",
  "human-approval": "Review",
  release: "Release",
};
const STAGE_ALIASES = {
  intake: "source", assignment: "source", outline: "brief", writing: "draft", article: "draft",
  editing: "edit", format: "package", seo: "package", media: "package", companions: "package", quality: "qa", compliance: "qa", review: "human-approval",
  approval: "human-approval", "immutable-release": "release", publish: "release", published: "release",
};
const ACTIVE_STATUSES = new Set(["queued", "accepted", "started", "running", "resuming", "rerunning", "releasing"]);
const REVIEW_STATUSES = new Set(["waiting_review", "awaiting_review", "review", "review_requested", "needs_review", "pending_approval"]);
const TERMINAL_STATUSES = new Set(["completed", "released", "published", "failed", "cancelled", "rejected", "quarantined", "withdrawn"]);
const EVENT_KINDS = [
  "command.accepted", "command.queued", "run.started", "run.recovered", "run.interrupted", "run.resumed", "run.rerun", "run.completed",
  "run.failed", "run.cancelled", "run.quarantined", "stage.started", "stage.completed", "artifact.created", "review.requested", "review.approved",
  "review.recorded", "review.changes-requested", "review.rejected", "provider.attempt", "provider.fallback", "tool.started", "tool.completed",
  "subagent.start", "subagent.complete", "release.created", "release.published", "release.withdrawn",
];

let mounted = false;
let projects = [];
let runs = [];
let selectedRunId = "";
let selectedReviewId = "";
let selectedStage = null;
let selectedFiles = [];
let graphHandle = null;
let eventStream = null;
let eventRunId = "";
const eventsByRun = new Map();

function canonicalStage(value) {
  const id = clean(value).toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  return STAGES.includes(id) ? id : (STAGE_ALIASES[id] || "source");
}

function statusLabel(value) {
  const id = clean(value).toLowerCase();
  return ({
    queued: "Queued", accepted: "Queued", started: "Starting", running: "Running", resuming: "Resuming", rerunning: "Rerunning",
    waiting_review: "Awaiting review", awaiting_review: "Awaiting review", review_requested: "Awaiting review", needs_review: "Awaiting review", pending_approval: "Awaiting review",
    changes_requested: "Changes requested", releasing: "Releasing", unavailable: "Unavailable", completed: "Complete", released: "Released", published: "Published", failed: "Failed", cancelled: "Cancelled",
    rejected: "Rejected", quarantined: "Quarantined", withdrawn: "Withdrawn",
  })[id] || (id ? id.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Recorded");
}

function dateLabel(value, withSeconds = false) {
  const numeric = Number(value || 0);
  if (!numeric) return "";
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  try {
    return new Intl.DateTimeFormat("en-AU", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}),
    }).format(new Date(milliseconds));
  } catch { return ""; }
}

function listLines(value) {
  return clean(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    return ![...url.searchParams.keys()].some((key) => /token|secret|signature|apikey|api_key|authorization/i.test(key));
  } catch { return false; }
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCost(run) {
  const raw = run.cost?.actual_usd ?? run.cost?.reported_usd ?? run.cost?.usd ?? run.cost ?? run.usage?.cost_usd;
  const cost = Number(raw);
  return Number.isFinite(cost) ? `$${cost.toFixed(cost < 1 ? 3 : 2)}` : "Pending";
}

function progressValue(run) {
  const value = Number(run.progress);
  if (Number.isFinite(value)) return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  const stageIndex = STAGES.indexOf(canonicalStage(run.stage));
  return run.status === "completed" || run.status === "released" ? 1 : Math.max(0, stageIndex / Math.max(1, STAGES.length - 1));
}

function artifactItems(run) {
  if (Array.isArray(run.artifacts)) return run.artifacts;
  if (run.artifacts && typeof run.artifacts === "object") {
    return Object.entries(run.artifacts).map(([name, value]) => typeof value === "string" ? { name, value } : { name, ...(value || {}) });
  }
  return [];
}

function stageItems(run) {
  if (Array.isArray(run.stages)) return run.stages;
  if (run.stages && typeof run.stages === "object") {
    return Object.entries(run.stages).map(([id, value]) => typeof value === "string" ? { id, status: value } : { id, ...(value || {}) });
  }
  return [];
}

function runNeedsReview(run) {
  const status = clean(run.status).toLowerCase();
  const reviewStatus = clean(run.review?.status || run.review?.decision).toLowerCase();
  return REVIEW_STATUSES.has(status) || canonicalStage(run.stage) === "human-approval" && !["approve", "approved", "reject", "rejected", "quarantine", "quarantined"].includes(reviewStatus);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.detail || `Request failed (HTTP ${response.status})`);
  return data;
}

function projectQuery(run, values = {}) {
  const projectId = clean(run?.project_id || $("#blog-runs-project")?.value || $("#blog-run-project")?.value || $("#blog-workflow-project")?.value);
  const query = new URLSearchParams(values);
  if (projectId) query.set("project_id", projectId);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function artifactUrl(run, artifact) {
  const explicit = clean(artifact.url || artifact.href);
  if (explicit.startsWith("/api/blog-studio/") || explicit.startsWith("/api/chat/uploads/")) return explicit;
  const name = clean(artifact.name || artifact.id || artifact.path).split(/[\\/]/).pop();
  return name ? `/api/blog-studio/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(name)}${projectQuery(run)}` : "";
}

function activate(tab, { focus = false } = {}) {
  if (tab !== "create" && $("#blog-proof-rail")?.classList.contains("is-open")) setProofOpen(false, { restoreFocus: false });
  const tabs = $$('[data-blog-tab]');
  for (const button of tabs) {
    const active = button.dataset.blogTab === tab;
    button.classList.toggle("is-on", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  }
  for (const panel of $$('[data-blog-panel]')) {
    const active = panel.dataset.blogPanel === tab;
    panel.classList.toggle("is-on", active);
    panel.hidden = !active;
  }
  if (tab === "runs" || tab === "review") void refreshRunsSafe().then(() => {
    if (tab === "review") renderReviewList();
  });
  if (tab === "workflow") {
    void refreshRunsSafe().then(renderWorkflowRunOptions);
    mountWorkflow();
  }
}

function fillProjectSelects() {
  const selects = [$("#blog-run-project"), $("#blog-runs-project"), $("#blog-workflow-project")];
  for (const select of selects) {
    if (!select) continue;
    const previous = select.value;
    select.replaceChildren();
    if (!projects.length) select.append(new Option("No projects available", ""));
    for (const project of projects) select.append(new Option(project.name || project.id, project.id));
    const preferred = projects.some((project) => project.id === previous) ? previous
      : projects.some((project) => project.id === "blockwise") ? "blockwise"
        : clean(projects[0]?.id);
    select.value = preferred;
  }
}

async function loadProjects() {
  const data = await requestJson("/api/projects");
  projects = Array.isArray(data.projects) ? data.projects : [];
  fillProjectSelects();
}

function renderAttachmentList() {
  const host = $("#blog-attachment-list");
  host.replaceChildren();
  for (const source of selectedFiles) {
    const row = document.createElement("div");
    row.className = "blog-attachment-row";
    const name = document.createElement("strong");
    name.textContent = source.file.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(source.file.size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${source.file.name}`);
    remove.addEventListener("click", () => {
      selectedFiles = selectedFiles.filter((item) => item.key !== source.key);
      renderAttachmentList();
      syncCreateProof();
    });
    row.append(name, size, remove);
    host.append(row);
  }
  syncCreateProof();
}

function sourceFileIssue(file) {
  if (Number(file.size) > MAX_SOURCE_FILE_BYTES) return `${file.name} is larger than 20 MB.`;
  const type = clean(file.type).toLowerCase();
  const supported = type.startsWith("text/") || [
    "application/pdf", "application/json", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].includes(type) || /\.(txt|md|pdf|json|docx)$/i.test(file.name);
  return supported ? "" : `${file.name} is not a supported source file.`;
}

function addFiles(fileList) {
  const known = new Set(selectedFiles.map((item) => item.key));
  let issue = "";
  for (const file of Array.from(fileList || [])) {
    const fileIssue = sourceFileIssue(file);
    issue ||= fileIssue;
    if (fileIssue) continue;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!known.has(key)) selectedFiles.push({ key, file });
    known.add(key);
  }
  if (selectedFiles.length > MAX_SOURCE_FILES) issue ||= `Blog Studio accepts up to ${MAX_SOURCE_FILES} source files.`;
  selectedFiles = selectedFiles.slice(0, MAX_SOURCE_FILES);
  renderAttachmentList();
  const status = $("#blog-create-status");
  if (issue) {
    status.textContent = issue;
    status.classList.add("is-error");
  } else if (fileList?.length) {
    status.textContent = `${selectedFiles.length} evidence file${selectedFiles.length === 1 ? "" : "s"} ready.`;
    status.classList.remove("is-error");
  }
}

function syncCreateProof() {
  const assignmentReady = Boolean(
    clean($("#blog-topic")?.value) || clean($("#blog-audience")?.value) || clean($("#blog-outcome")?.value)
    || clean($("#blog-cta")?.value) || clean($("#blog-must-include")?.value) || clean($("#blog-must-avoid")?.value) || clean($("#blog-slug")?.value)
  );
  const sourcesReady = Boolean(clean($("#blog-source-text")?.value) || listLines($("#blog-source-urls")?.value).length || selectedFiles.length);
  const items = $$("#blog-create-proof li");
  items[0]?.classList.toggle("is-ready", assignmentReady);
  items[1]?.classList.toggle("is-ready", sourcesReady);
  const state = $("#blog-create-state");
  if (state) state.textContent = assignmentReady || sourcesReady ? "Ready" : "Draft";
}

function requestEvent(name, detail) {
  return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, resolve, reject } })));
}

function createPayload() {
  return {
    projectId: clean($("#blog-run-project").value),
    jobName: clean($("#blog-job-name").value),
    topic: clean($("#blog-topic").value),
    sourceText: clean($("#blog-source-text").value),
    sourceUrls: listLines($("#blog-source-urls").value),
    files: selectedFiles.map((item) => item.file),
    direction: {
      audience: clean($("#blog-audience").value),
      outcome: clean($("#blog-outcome").value),
      cta: clean($("#blog-cta").value),
      locale: clean($("#blog-locale").value) || "en-AU",
      must_include: clean($("#blog-must-include").value),
      must_avoid: clean($("#blog-must-avoid").value),
      slug: clean($("#blog-slug").value),
    },
    clientRequestId: globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    outputs: {
      length: $("#blog-length").value,
      research_mode: $("#blog-research-mode").value,
      media: $("#blog-media").value,
      companions: $$('[name="blog-companion"]:checked').map((input) => input.value),
      publication_target_id: clean($("#blog-publication-target").value),
    },
  };
}

function setupCreateForm() {
  const input = $("#blog-source-files");
  const drop = $("#blog-attach-drop");
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  drop.addEventListener("click", () => input.click());
  for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("is-drag");
  });
  for (const type of ["dragleave", "drop"]) drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("is-drag");
    if (type === "drop") addFiles(event.dataTransfer?.files);
  });
  $("#blog-create-form").addEventListener("input", syncCreateProof);
  $("#blog-create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#blog-create-status");
    const submit = $("#blog-create-submit");
    const payload = createPayload();
    status.classList.remove("is-error");
    const hasDirection = Boolean(payload.topic || payload.direction.audience || payload.direction.outcome || payload.direction.cta
      || payload.direction.must_include || payload.direction.must_avoid || payload.direction.slug);
    const hasSources = Boolean(payload.sourceText || payload.sourceUrls.length || payload.files.length);
    if (!payload.projectId || !hasDirection && !hasSources) {
      status.textContent = "Choose a project and add a topic, source material, or editorial direction.";
      status.classList.add("is-error");
      return;
    }
    if (payload.sourceUrls.length > 12) {
      status.textContent = "Add no more than 12 source URLs.";
      status.classList.add("is-error");
      return;
    }
    if (payload.sourceUrls.some((url) => url.length > 1500 || !safeSourceUrl(url))) {
      status.textContent = "Source links must be bounded HTTP or HTTPS URLs without credentials or secret query parameters.";
      status.classList.add("is-error");
      return;
    }
    if (payload.outputs.publication_target_id && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(payload.outputs.publication_target_id)) {
      status.textContent = "The publication target must be an opaque Connections target ID.";
      status.classList.add("is-error");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Starting…";
    status.textContent = payload.files.length ? "Uploading evidence and starting Hermes…" : "Starting the durable Hermes run…";
    try {
      const result = await requestEvent("frank:blog-studio-run", payload);
      const run = result.run;
      if (!run?.id) throw new Error("Hermes did not return a run identity.");
      runs = [run, ...runs.filter((item) => item.id !== run.id)];
      selectedRunId = run.id;
      status.textContent = "Run started. You can leave this view; Hermes will keep working.";
      renderRuns();
      activate("runs", { focus: true });
      await selectRun(run.id, { destination: "runs" });
    } catch (error) {
      status.textContent = error.message || "The run could not be started.";
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Start run";
    }
  });
}

async function refreshRuns() {
  const projectId = clean($("#blog-runs-project")?.value || $("#blog-run-project")?.value || $("#blog-workflow-project")?.value);
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const data = await requestJson(`/api/blog-studio/runs${query}`);
  runs = (Array.isArray(data.runs) ? data.runs : []).sort((left, right) => Number(right.updated_at || right.created_at || 0) - Number(left.updated_at || left.created_at || 0));
  if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) clearRunDetail("runs");
  if (selectedReviewId && !runs.some((run) => run.id === selectedReviewId && runNeedsReview(run))) clearRunDetail("review");
  if (eventRunId && !runs.some((run) => run.id === eventRunId)) closeRunEvents();
  renderRuns();
  renderReviewList();
  renderWorkflowRunOptions();
}

function closeRunEvents() {
  eventStream?.close();
  eventStream = null;
  eventRunId = "";
}

function clearRunDetail(destination) {
  const review = destination === "review";
  if (review) selectedReviewId = "";
  else selectedRunId = "";
  $(`.blog-${review ? "review" : "runs"}-layout`)?.classList.remove("is-detail");
  const host = $(`#blog-${review ? "review" : "run"}-detail`);
  if (host) host.innerHTML = review
    ? '<div class="blog-empty"><strong>Select an article</strong><span>Review its exact candidate, quality evidence and artifact versions.</span></div>'
    : '<div class="blog-empty"><strong>Select a run</strong><span>Inspect its brief, stages, evidence, article and release state.</span></div>';
}

function resetRunContext() {
  closeRunEvents();
  eventsByRun.clear();
  clearRunDetail("runs");
  clearRunDetail("review");
}

async function refreshRunsSafe() {
  try { await refreshRuns(); }
  catch (error) {
    const host = $("#blog-run-list");
    if (host && !host.children.length) host.innerHTML = `<div class="blog-empty"><strong>Runs unavailable</strong><span>${escapeHtml(error.message || "Frank cannot reach Hermes.")}</span></div>`;
  }
}

function renderRuns() {
  const host = $("#blog-run-list");
  if (!host) return;
  host.replaceChildren();
  $("#blog-runs-count").textContent = String(runs.length);
  if (!runs.length) {
    host.innerHTML = '<div class="blog-empty"><strong>No runs yet</strong><span>Create the first evidence-backed article run.</span></div>';
    return;
  }
  for (const run of runs) host.append(runRow(run, selectedRunId, () => void selectRun(run.id, { destination: "runs" })));
}

function runRow(run, selectedId, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `blog-run-row${run.id === selectedId ? " is-on" : ""}`;
  button.dataset.status = clean(run.status).toLowerCase();
  button.setAttribute("aria-current", run.id === selectedId ? "true" : "false");
  const dot = document.createElement("i");
  dot.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "blog-run-row-copy";
  const title = document.createElement("strong");
  title.textContent = run.title || run.job_name || run.topic || "Untitled article";
  const meta = document.createElement("span");
  meta.textContent = `${statusLabel(run.status)} · ${STAGE_LABELS[canonicalStage(run.stage)]}`;
  const time = document.createElement("time");
  time.textContent = dateLabel(run.updated_at || run.created_at);
  copy.append(title, meta);
  button.append(dot, copy, time);
  button.addEventListener("click", handler);
  return button;
}

function renderReviewList() {
  const host = $("#blog-review-list");
  if (!host) return;
  const reviewRuns = runs.filter(runNeedsReview);
  $("#blog-review-count").textContent = String(reviewRuns.length);
  host.replaceChildren();
  if (!reviewRuns.length) {
    host.innerHTML = '<div class="blog-empty"><strong>Queue clear</strong><span>No article is waiting for a decision.</span></div>';
    return;
  }
  for (const run of reviewRuns) host.append(runRow(run, selectedReviewId, () => void selectRun(run.id, { destination: "review" })));
}

async function selectRun(runId, { destination = "runs" } = {}) {
  if (destination === "review") selectedReviewId = runId;
  else selectedRunId = runId;
  $(`.blog-${destination === "review" ? "review" : "runs"}-layout`)?.classList.add("is-detail");
  renderRuns();
  renderReviewList();
  let run = runs.find((item) => item.id === runId);
  if (!run) return;
  try {
    const data = await requestJson(`/api/blog-studio/runs/${encodeURIComponent(runId)}${projectQuery(run)}`);
    if (data.run) run = { ...run, ...data.run };
    else if (data.id) run = { ...run, ...data };
    runs = runs.map((item) => item.id === run.id ? run : item);
  } catch { /* retain the latest projection already on screen */ }
  renderRuns();
  renderReviewList();
  if (destination === "review") renderReviewDetail(run);
  else renderRunDetail(run);
  connectRunEvents(run);
  renderWorkflowRunOptions();
  if (window.matchMedia("(max-width: 800px)").matches) {
    requestAnimationFrame(() => $(`#blog-panel-${destination} .blog-mobile-back`)?.focus());
  }
}

function renderFacts(run, parent) {
  const facts = [
    ["Run", run.id || "—"],
    ["Stage", STAGE_LABELS[canonicalStage(run.stage)]],
    ["Research", clean(run.research?.mode || run.outputs?.research_mode || run.output?.research_mode) || "Recorded"],
    ["Cost", formatCost(run)],
  ];
  const list = document.createElement("dl");
  list.className = "blog-facts";
  for (const [label, value] of facts) {
    const item = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = value; description.title = value;
    item.append(term, description); list.append(item);
  }
  parent.append(list);
}

function renderStageRail(run, parent) {
  const records = new Map(stageItems(run).map((stage) => [canonicalStage(stage.id || stage.stage || stage.name), stage]));
  const current = canonicalStage(run.stage);
  const currentIndex = STAGES.indexOf(current);
  const section = document.createElement("section");
  section.className = "blog-detail-section";
  section.innerHTML = '<div class="blog-inline-heading"><strong>Lifecycle</strong><span>Select a stage to inspect its evidence.</span></div>';
  const rail = document.createElement("div");
  rail.className = "blog-stage-rail";
  STAGES.forEach((id, index) => {
    const record = records.get(id);
    const status = clean(record?.status || record?.state).toLowerCase();
    const done = ["complete", "completed", "passed", "approved", "released"].includes(status) || run.status === "completed" || index < currentIndex;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `blog-stage${done ? " is-done" : ""}${id === current ? " is-current" : ""}`;
    button.innerHTML = `<i aria-hidden="true"></i><span>${escapeHtml(STAGE_LABELS[id])}</span>`;
    button.setAttribute("aria-label", `${STAGE_LABELS[id]}${done ? ", complete" : id === current ? ", current" : ""}`);
    button.addEventListener("click", () => {
      selectedStage = { source_id: id, label: STAGE_LABELS[id], kind: record?.kind || "stage" };
      $("#blog-workflow-run").value = run.id;
      selectedRunId = run.id;
      activate("workflow");
      updateWorkflowEvidence();
    });
    rail.append(button);
  });
  section.append(rail);
  parent.append(section);
}

function plainSummary(value, fallback = "Recorded") {
  if (typeof value === "string") return clean(value) || fallback;
  if (Array.isArray(value)) return value.length ? `${value.length} item${value.length === 1 ? "" : "s"} recorded` : fallback;
  if (!value || typeof value !== "object") return fallback;
  return clean(value.summary || value.status || value.decision || value.title || value.name) || `${Object.keys(value).length} fields recorded`;
}

function evidenceCard(label, value, detail = "") {
  const card = document.createElement("article");
  card.className = "blog-evidence-card";
  const kicker = document.createElement("span"); kicker.textContent = label;
  const title = document.createElement("strong"); title.textContent = value;
  card.append(kicker, title);
  if (detail) { const copy = document.createElement("p"); copy.textContent = detail; card.append(copy); }
  return card;
}

function renderEvidence(run, parent) {
  const section = document.createElement("section");
  section.className = "blog-detail-section";
  section.innerHTML = '<div class="blog-inline-heading"><strong>Evidence</strong><span>Safe run projections only; prompts and private paths stay out.</span></div>';
  const grid = document.createElement("div");
  grid.className = "blog-evidence-grid";
  const sourceUrlCount = Number(run.source?.url_count ?? (run.source?.urls || []).length);
  const sourceAttachmentCount = Number(run.source?.attachment_count ?? (run.source?.attachments || []).length);
  const sourceDetail = run.source ? `${Number(run.source.text_length || 0).toLocaleString()} source characters · ${sourceUrlCount} link${sourceUrlCount === 1 ? "" : "s"} · ${sourceAttachmentCount} file${sourceAttachmentCount === 1 ? "" : "s"}` : "Input bundle is recorded with Hermes";
  grid.append(
    evidenceCard("Source bundle", run.source?.has_text ? "Source text recorded" : "Structured sources", sourceDetail),
    evidenceCard("Research", plainSummary(run.research, "Not recorded yet"), clean(run.research?.evidence_summary || run.research?.note)),
    evidenceCard("Outline", plainSummary(run.outline || run.brief, "Not recorded yet")),
    evidenceCard("SEO", plainSummary(run.seo, "Not recorded yet"), clean(run.seo?.primary_keyword || run.seo?.description)),
    evidenceCard("Quality", plainSummary(run.quality, "Not recorded yet"), clean(run.quality?.summary || run.quality?.note)),
  );
  for (const url of Array.isArray(run.source?.urls) ? run.source.urls : []) {
    if (!safeSourceUrl(url)) continue;
    const card = evidenceCard("Input source", new URL(url).hostname, url);
    const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open input ↗"; card.append(link);
    grid.append(card);
  }
  for (const attachment of Array.isArray(run.source?.attachments) ? run.source.attachments : []) {
    grid.append(evidenceCard("Input file", clean(attachment.name || "Source file"), [clean(attachment.media_type), attachment.size ? formatBytes(attachment.size) : ""].filter(Boolean).join(" · ")));
  }
  for (const source of Array.isArray(run.research?.sources) ? run.research.sources.slice(0, 6) : []) {
    if (!safeSourceUrl(source.url)) continue;
    const card = evidenceCard("Research source", clean(source.title || source.publisher || "Source"), [source.publisher, source.published_at].filter(Boolean).join(" · "));
    const link = document.createElement("a"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open source ↗"; card.append(link);
    grid.append(card);
  }
  for (const question of Array.isArray(run.research?.open_questions) ? run.research.open_questions.slice(0, 8) : []) {
    grid.append(evidenceCard("Open question", clean(question), "Research follow-up"));
  }
  for (const item of Array.isArray(run.outline) ? run.outline.slice(0, 12) : []) {
    grid.append(evidenceCard("Outline section", clean(item), "Argument map"));
  }
  if (run.seo?.title || run.seo?.description || run.seo?.slug) {
    grid.append(evidenceCard("SEO package", clean(run.seo.title || run.seo.slug || "Metadata recorded"), [clean(run.seo.description), clean(run.seo.slug ? `/${run.seo.slug}` : "")].filter(Boolean).join(" · ")));
  }
  if (Array.isArray(run.seo?.keywords) && run.seo.keywords.length) {
    grid.append(evidenceCard("SEO keywords", run.seo.keywords.slice(0, 12).map(clean).filter(Boolean).join(" · "), clean(run.seo.schema_type)));
  }
  for (const [label, values] of [["Quality blocker", run.quality?.blockers], ["Quality warning", run.quality?.warnings], ["Quality issue", run.quality?.issues]]) {
    for (const value of Array.isArray(values) ? values.slice(0, 8) : []) grid.append(evidenceCard(label, clean(value), "Quality receipt"));
  }
  for (const claim of Array.isArray(run.quality?.claims) ? run.quality.claims.slice(0, 10) : []) {
    grid.append(evidenceCard("Checked claim", clean(claim.text || claim.id || "Claim"), [statusLabel(claim.status), ...(Array.isArray(claim.evidence_refs) ? claim.evidence_refs.slice(0, 4) : [])].filter(Boolean).join(" · ")));
  }
  for (const [label, values] of [["Review blocker", run.review?.blockers], ["Review warning", run.review?.warnings]]) {
    for (const value of Array.isArray(values) ? values.slice(0, 8) : []) grid.append(evidenceCard(label, clean(value), "Human gate"));
  }
  for (const artifact of artifactItems(run)) {
    const name = clean(artifact.label || artifact.name || artifact.id || "Artifact");
    const card = evidenceCard("Artifact", name, clean(artifact.version ? `Version ${artifact.version}` : artifact.sha256 ? `SHA-256 ${String(artifact.sha256).slice(0, 12)}…` : artifact.kind));
    const url = artifactUrl(run, artifact);
    if (url) {
      const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open artifact ↗"; card.append(link);
    }
    grid.append(card);
  }
  if (run.release && Object.keys(run.release).length) {
    const release = evidenceCard("Release", statusLabel(run.release.status || run.status), clean(run.release.sha256 ? `SHA-256 ${String(run.release.sha256).slice(0, 16)}… · version ${run.release.version || 1}` : run.release.release_id));
    const url = clean(run.release.download_url || run.release.url);
    if (url && (url.startsWith("/api/blog-studio/") || safeSourceUrl(url))) {
      const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open release ↗"; release.append(link);
    }
    grid.append(release);
  }
  section.append(grid);
  parent.append(section);
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(value) {
  const lines = clean(value).split(/\r?\n/);
  const output = [];
  let list = "";
  const closeList = () => { if (list) { output.push(`</${list}>`); list = ""; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) { closeList(); const level = heading[1].length; output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`); continue; }
    const unordered = line.match(/^[-*]\s+(.+)/);
    const ordered = line.match(/^\d+[.)]\s+(.+)/);
    if (unordered || ordered) {
      const nextList = ordered ? "ol" : "ul";
      if (list !== nextList) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    if (line.startsWith("> ")) { closeList(); output.push(`<blockquote><p>${renderInlineMarkdown(line.slice(2))}</p></blockquote>`); continue; }
    closeList(); output.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("");
}

function articleBody(run) {
  if (typeof run.article === "string") return run.article;
  return clean(run.article?.markdown || run.article?.body || run.article?.content || run.article?.text || run.output?.article);
}

function renderArticle(run, parent, headingLabel = "Latest article") {
  const body = articleBody(run);
  if (!body) return;
  const section = document.createElement("section");
  section.className = "blog-detail-section";
  section.innerHTML = `<div class="blog-inline-heading"><strong>${escapeHtml(headingLabel)}</strong><span>${escapeHtml(clean(run.article?.version ? `Version ${run.article.version}` : "Run projection"))}</span></div>`;
  const article = document.createElement("article");
  article.className = "blog-article-preview";
  article.innerHTML = renderMarkdown(body);
  section.append(article);
  parent.append(section);
}

function renderReviewState(run, parent) {
  if (!run.review) return;
  const section = document.createElement("section");
  section.className = "blog-detail-section blog-review-state";
  const title = document.createElement("strong");
  title.textContent = `Review · ${statusLabel(run.review.decision || run.review.status)}`;
  const copy = document.createElement("p");
  copy.textContent = clean(run.review.note || run.review.reason || "Decision evidence recorded.");
  section.append(title, copy);
  parent.append(section);
}

function renderRunDetail(run) {
  const host = $("#blog-run-detail");
  if (!host) return;
  host.replaceChildren();
  const head = document.createElement("div");
  head.className = "blog-detail-head";
  const copy = document.createElement("div");
  const title = document.createElement("h3"); title.textContent = run.title || run.job_name || run.topic || "Untitled article";
  const meta = document.createElement("p"); meta.textContent = `${statusLabel(run.status)} · ${STAGE_LABELS[canonicalStage(run.stage)]} · updated ${dateLabel(run.updated_at || run.created_at) || "now"}`;
  const progress = document.createElement("div"); progress.className = "blog-progress"; progress.setAttribute("aria-label", `${Math.round(progressValue(run) * 100)}% complete`); progress.innerHTML = `<i style="width:${Math.round(progressValue(run) * 100)}%"></i>`;
  copy.append(title, meta, progress);
  const state = document.createElement("span"); state.className = "blog-status-pill"; state.innerHTML = `<i aria-hidden="true"></i>${escapeHtml(statusLabel(run.status))}`;
  head.append(copy, state);
  host.append(head);
  renderFacts(run, host);
  renderStageRail(run, host);
  if (run.error) { const error = document.createElement("div"); error.className = "blog-error"; error.textContent = clean(run.error.message || run.error); host.append(error); }
  renderEvidence(run, host);
  renderArticle(run, host);
  renderReviewState(run, host);
  renderRunActions(run, host);
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function postRunAction(run, action, payload = {}) {
  const data = await requestJson(`/api/blog-studio/runs/${encodeURIComponent(run.id)}/${action}${projectQuery(run)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const updated = data.run || data;
  if (updated?.id) runs = runs.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
  await selectRun(run.id, { destination: selectedReviewId === run.id && $('[data-blog-panel="review"]')?.classList.contains("is-on") ? "review" : "runs" });
}

function renderRunActions(run, parent) {
  const actions = document.createElement("div");
  actions.className = "blog-action-strip";
  const status = clean(run.status).toLowerCase();
  if (ACTIVE_STATUSES.has(status)) {
    actions.append(actionButton("Cancel run", "blog-secondary", async (event) => {
      event.currentTarget.disabled = true;
      try { await postRunAction(run, "cancel", { reason: "Cancelled from Blog Studio" }); }
      catch { event.currentTarget.textContent = "Cancel failed · retry"; event.currentTarget.disabled = false; }
    }));
  }
  if (["failed", "cancelled", "paused", "interrupted"].includes(status)) {
    actions.append(actionButton("Resume from checkpoint", "blog-primary", async (event) => {
      event.currentTarget.disabled = true;
      try { await postRunAction(run, "resume", { from_stage: run.stage || undefined }); }
      catch { event.currentTarget.textContent = "Resume failed · retry"; event.currentTarget.disabled = false; }
    }));
  }
  if (clean(run.release?.status).toLowerCase() === "published" && status !== "withdrawn") {
    actions.append(actionButton("Withdraw release", "blog-secondary", () => renderWithdrawForm(run, parent)));
  }
  const rerun = actionButton("Rerun from stage", "blog-secondary", () => renderRerunForm(run, parent));
  actions.append(rerun);
  parent.append(actions);
}

function renderWithdrawForm(run, parent) {
  parent.querySelector(".blog-action-form")?.remove();
  const form = document.createElement("form");
  form.className = "blog-action-form";
  form.innerHTML = '<h4>Withdraw this release</h4><p>The published artifact will be withdrawn and a durable tombstone will remain.</p><label>Reason<textarea name="reason" required maxlength="2000" placeholder="Why must this release be withdrawn?"></textarea></label><div class="blog-action-strip"><button type="button" class="blog-secondary" data-close>Cancel</button><button type="submit" class="blog-primary">Record withdrawal</button></div>';
  form.querySelector("[data-close]").addEventListener("click", () => form.remove());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try { await postRunAction(run, "withdraw", { reason: clean(form.elements.reason.value) }); }
    catch (error) { submit.textContent = error.message || "Withdrawal failed"; submit.disabled = false; }
  });
  parent.append(form);
  form.elements.reason.focus();
}

function renderRerunForm(run, parent) {
  parent.querySelector(".blog-action-form")?.remove();
  const form = document.createElement("form");
  form.className = "blog-action-form";
  const rerunStages = STAGES.slice(0, STAGES.indexOf("human-approval"));
  const selected = rerunStages.includes(canonicalStage(run.stage)) ? canonicalStage(run.stage) : "qa";
  form.innerHTML = `<h4>Rerun from a recorded stage</h4><p>The existing run remains durable. Hermes creates a new version from this checkpoint.</p><label>Stage<select name="stage">${rerunStages.map((id) => `<option value="${id}"${id === selected ? " selected" : ""}>${escapeHtml(STAGE_LABELS[id])}</option>`).join("")}</select></label><label>Instructions<textarea name="instructions" required placeholder="What should change in the next version?"></textarea></label><div class="blog-action-strip"><button type="button" class="blog-secondary" data-close>Cancel</button><button type="submit" class="blog-primary">Start rerun</button></div>`;
  form.querySelector("[data-close]").addEventListener("click", () => form.remove());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try { await postRunAction(run, "rerun", { from_stage: form.elements.stage.value, instructions: clean(form.elements.instructions.value) }); }
    catch (error) { submit.textContent = error.message || "Rerun failed"; submit.disabled = false; }
  });
  parent.append(form);
  form.elements.instructions.focus();
}

function reviewArtifactVersions(run) {
  const versions = {};
  for (const artifact of artifactItems(run)) {
    const name = clean(artifact.name || artifact.id);
    const version = artifact.version ?? artifact.sha256 ?? artifact.hash;
    if (name && version !== undefined) versions[name] = version;
  }
  return versions;
}

function renderReviewDetail(run) {
  const host = $("#blog-review-detail");
  if (!host) return;
  host.replaceChildren();
  const head = document.createElement("div");
  head.className = "blog-detail-head";
  head.innerHTML = `<div><h3>${escapeHtml(run.title || run.job_name || run.topic || "Untitled article")}</h3><p>${escapeHtml(plainSummary(run.quality, "Quality evidence pending"))} · ${escapeHtml(artifactItems(run).length)} artifact${artifactItems(run).length === 1 ? "" : "s"}</p></div><span class="blog-status-pill"><i aria-hidden="true"></i>Decision required</span>`;
  host.append(head);
  renderFacts(run, host);
  renderEvidence(run, host);
  renderArticle(run, host, "Article under review");
  renderReviewState(run, host);

  const form = document.createElement("form");
  form.className = "blog-review-form";
  form.innerHTML = '<h4>Record an editorial decision</h4><p>Approval makes Hermes copy these exact reviewed bytes into an immutable release. The model cannot rewrite them after this decision.</p><label>Decision note<textarea name="note" maxlength="4000" placeholder="What passed, what must change, or why this should not release."></textarea></label><div class="blog-review-actions"><button type="submit" class="blog-primary" data-decision="approve">Approve &amp; release exact bytes</button><button type="submit" class="blog-decision" data-decision="request_changes">Request changes</button><button type="submit" class="blog-decision" data-decision="reject">Reject</button><button type="submit" class="blog-decision" data-decision="quarantine">Quarantine</button></div><p role="status" data-review-status></p>';
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const decision = button?.dataset.decision;
    if (!decision) return;
    const note = clean(form.elements.note.value);
    if (decision !== "approve" && !note) {
      form.querySelector("[data-review-status]").textContent = "Add a note for this decision.";
      form.elements.note.focus();
      return;
    }
    $$('button[type="submit"]', form).forEach((item) => { item.disabled = true; });
    form.querySelector("[data-review-status]").textContent = "Recording decision…";
    try {
      await postRunAction(run, "review", {
        decision, note: note || undefined, from_stage: decision === "request_changes" ? "edit" : undefined,
        artifact_versions: reviewArtifactVersions(run),
      });
    } catch (error) {
      form.querySelector("[data-review-status]").textContent = error.message || "Decision could not be recorded.";
      $$('button[type="submit"]', form).forEach((item) => { item.disabled = false; });
    }
  });
  host.append(form);
}

function safeEventSummary(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const value = clean(data.summary || data.message || data.status || data.decision || event.summary);
  if (value) return value.slice(0, 240);
  if (event.kind?.includes("stage")) return `${STAGE_LABELS[canonicalStage(event.node_id || event.stage)]} ${event.kind.includes("completed") ? "completed" : "started"}`;
  return clean(event.kind || "Activity").replaceAll(".", " ").replaceAll("-", " ");
}

function connectRunEvents(run) {
  if (!run?.id || eventRunId === run.id && eventStream) return;
  eventStream?.close();
  eventRunId = run.id;
  const items = eventsByRun.get(run.id) || [];
  eventsByRun.set(run.id, items);
  const stream = new EventSource(`/api/blog-studio/runs/${encodeURIComponent(run.id)}/events${projectQuery(run, { after: "-1" })}`);
  eventStream = stream;
  const receive = (message) => {
    try {
      const event = JSON.parse(message.data);
      const key = event.sequence ?? `${event.kind}:${event.timestamp}:${event.node_id || event.stage || ""}`;
      if (!items.some((existing) => existing._key === key)) {
        items.push({ ...event, _key: key });
        if (items.length > MAX_EVENT_HISTORY) items.splice(0, items.length - MAX_EVENT_HISTORY);
      }
      if (String(event.kind).includes("stage") && (event.node_id || event.stage)) run.stage = canonicalStage(event.node_id || event.stage);
      const eventStatus = {
        "command.accepted": "queued", "command.queued": "queued", "run.started": "running", "run.recovered": "running", "run.resumed": "running",
        "run.rerun": "running", "review.requested": "waiting_review", "review.changes-requested": "changes_requested", "review.approved": "releasing",
        "release.created": "releasing", "run.failed": "failed", "run.cancelled": "cancelled", "run.quarantined": "quarantined",
        "review.rejected": "failed", "release.published": "published", "release.withdrawn": "withdrawn",
      }[event.kind];
      if (eventStatus) run.status = eventStatus;
      runs = runs.map((item) => item.id === run.id ? { ...item, ...run } : item);
      renderRuns();
      renderReviewList();
      if ($('[data-blog-panel="runs"]')?.classList.contains("is-on") && selectedRunId === run.id) renderRunDetail(run);
      if ($('[data-blog-panel="review"]')?.classList.contains("is-on") && selectedReviewId === run.id) renderReviewDetail(run);
      if ($('[data-blog-panel="workflow"]')?.classList.contains("is-on")) updateWorkflowEvidence();
      if (TERMINAL_STATUSES.has(run.status) || ["run.completed", "review.requested", "review.recorded", "review.changes-requested", "review.approved", "release.created"].includes(event.kind)) void refreshRunsSafe();
    } catch { /* keepalive or malformed event: retain the last durable projection */ }
  };
  stream.onmessage = receive;
  for (const kind of EVENT_KINDS) stream.addEventListener(kind, receive);
  stream.onerror = () => { /* EventSource retries automatically. */ };
}

function renderWorkflowRunOptions() {
  const select = $("#blog-workflow-run");
  if (!select) return;
  const previous = selectedRunId || select.value;
  select.replaceChildren(new Option("No run selected", ""));
  for (const run of runs) select.append(new Option(run.title || run.job_name || run.topic || "Untitled article", run.id));
  if (runs.some((run) => run.id === previous)) select.value = previous;
}

async function loadWorkflowGraph({ entityId, lens }) {
  const projectId = clean($("#blog-workflow-project").value);
  if (!projectId) throw new Error("Choose a project to inspect its content factory.");
  const query = new URLSearchParams({ lens, scope_kind: "project", scope_id: projectId });
  return requestJson(`/api/graphs/tool/${encodeURIComponent(entityId)}?${query}`);
}

function mountWorkflow() {
  const root = $("#blog-workflow-graph");
  if (!root || !$('[data-blog-panel="workflow"]')?.classList.contains("is-on")) return;
  graphHandle?.destroy();
  graphHandle = mountGraphWorkbench(root, {
    entityId: TOOL_ID,
    title: "Content factory",
    load: loadWorkflowGraph,
    onSelect(node) {
      selectedStage = node;
      updateWorkflowEvidence();
    },
  });
}

function updateWorkflowEvidence() {
  const host = $("#blog-workflow-evidence");
  if (!host) return;
  const runId = clean($("#blog-workflow-run")?.value || selectedRunId);
  const run = runs.find((item) => item.id === runId);
  const stageId = canonicalStage(selectedStage?.source_id || selectedStage?.id || selectedStage?.label);
  $("#blog-workflow-stage").textContent = selectedStage?.label || STAGE_LABELS[stageId] || "Select a stage";
  $("#blog-workflow-kind").textContent = selectedStage?.kind || "—";
  if (!run) {
    $("#blog-workflow-summary").textContent = "Choose a durable run to pair with the declared graph.";
    host.innerHTML = '<div class="blog-empty"><strong>No run selected</strong><span>Observed evidence appears when a run is selected.</span></div>';
    return;
  }
  const record = stageItems(run).find((stage) => canonicalStage(stage.id || stage.stage || stage.name) === stageId);
  const events = (eventsByRun.get(run.id) || []).filter((event) => canonicalStage(event.node_id || event.stage) === stageId);
  $("#blog-workflow-summary").textContent = `${statusLabel(record?.status || record?.state || (stageId === canonicalStage(run.stage) ? "running" : "recorded"))} · ${events.length} live event${events.length === 1 ? "" : "s"}`;
  host.replaceChildren();
  const grid = document.createElement("div"); grid.className = "blog-evidence-grid";
  grid.append(
    evidenceCard("Run", run.title || run.job_name || run.topic || run.id, statusLabel(run.status)),
    evidenceCard("Stage", STAGE_LABELS[stageId] || stageId, plainSummary(record, stageId === canonicalStage(run.stage) ? "Current stage" : "No stage receipt yet")),
  );
  const stageArtifacts = artifactItems(run).filter((artifact) => !artifact.stage || canonicalStage(artifact.stage) === stageId);
  for (const artifact of stageArtifacts) {
    const card = evidenceCard("Artifact", clean(artifact.label || artifact.name || artifact.id || "Recorded artifact"), clean(artifact.version ? `Version ${artifact.version}` : artifact.kind));
    const url = artifactUrl(run, artifact);
    if (url) { const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open artifact ↗"; card.append(link); }
    grid.append(card);
  }
  host.append(grid);
  if (events.length) {
    const list = document.createElement("div"); list.className = "blog-event-list";
    for (const event of events.slice(-30)) {
      const row = document.createElement("div"); row.className = "blog-event-row";
      const time = document.createElement("time"); time.textContent = dateLabel(event.timestamp, true);
      const copy = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = clean(event.kind || "activity").replaceAll(".", " ").replaceAll("-", " ");
      const summary = document.createElement("p"); summary.textContent = safeEventSummary(event);
      copy.append(title, summary); row.append(time, copy); list.append(row);
    }
    host.append(list);
  }
}

function setupTabs() {
  const tabs = $$('[data-blog-tab]');
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => activate(button.dataset.blogTab));
    button.addEventListener("keydown", (event) => {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[nextIndex].dataset.blogTab, { focus: true });
    });
  });
}

function setupFilters() {
  $("#blog-run-project").addEventListener("change", (event) => {
    $("#blog-runs-project").value = event.target.value;
    $("#blog-workflow-project").value = event.target.value;
    resetRunContext();
    void refreshRunsSafe();
  });
  $("#blog-runs-project").addEventListener("change", (event) => {
    $("#blog-run-project").value = event.target.value;
    $("#blog-workflow-project").value = event.target.value;
    resetRunContext();
    void refreshRunsSafe();
  });
  $("#blog-workflow-project").addEventListener("change", (event) => {
    $("#blog-run-project").value = event.target.value;
    $("#blog-runs-project").value = event.target.value;
    resetRunContext();
    void refreshRunsSafe();
    mountWorkflow();
  });
  $("#blog-workflow-run").addEventListener("change", (event) => {
    selectedRunId = event.target.value;
    const run = runs.find((item) => item.id === selectedRunId);
    if (run) connectRunEvents(run);
    updateWorkflowEvidence();
  });
  $("#blog-refresh-runs").addEventListener("click", (event) => {
    event.currentTarget.disabled = true;
    void refreshRunsSafe().finally(() => { event.currentTarget.disabled = false; });
  });
}

function setProofOpen(open, { restoreFocus = true } = {}) {
  const mobile = window.matchMedia("(max-width: 800px)").matches;
  const expanded = Boolean(open && mobile);
  const rail = $("#blog-proof-rail");
  const trigger = $("#blog-proof-trigger");
  const scrim = $("#blog-proof-scrim");
  const form = $("#blog-create-form");
  rail.classList.toggle("is-open", expanded);
  rail.setAttribute("aria-hidden", String(mobile && !expanded));
  if (mobile) {
    rail.setAttribute("role", "dialog");
    rail.setAttribute("aria-modal", "true");
  } else {
    rail.removeAttribute("role");
    rail.removeAttribute("aria-modal");
  }
  trigger.setAttribute("aria-expanded", String(expanded));
  scrim.hidden = !expanded;
  for (const element of [$(".rail"), $(".topbar"), $(".blog-studio-head"), $(".blog-studio-tabs"), form]) element.inert = expanded;
  if (expanded) $("#blog-proof-close").focus();
  else if (restoreFocus && document.activeElement && rail.contains(document.activeElement)) trigger.focus();
}

function setupResponsiveDrillIns() {
  $("#blog-proof-trigger").addEventListener("click", () => setProofOpen(true));
  $("#blog-proof-close").addEventListener("click", () => setProofOpen(false));
  $("#blog-proof-scrim").addEventListener("click", () => setProofOpen(false));
  $("#blog-proof-rail").addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); setProofOpen(false); return; }
    if (event.key !== "Tab" || !event.currentTarget.classList.contains("is-open")) return;
    const focusable = Array.from(event.currentTarget.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hidden && element.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  $$('[data-blog-back]').forEach((button) => button.addEventListener("click", () => {
    const destination = button.dataset.blogBack;
    const layout = $(`.blog-${destination === "review" ? "review" : "runs"}-layout`);
    layout?.classList.remove("is-detail");
    const panel = destination === "review" ? $("#blog-panel-review") : $("#blog-panel-runs");
    requestAnimationFrame(() => panel?.querySelector('.blog-run-row[aria-current="true"]')?.focus());
  }));
  const media = window.matchMedia("(max-width: 800px)");
  const syncProofMode = () => setProofOpen(false, { restoreFocus: false });
  media.addEventListener?.("change", syncProofMode);
  syncProofMode();
}

export function mountBlogStudio() {
  if (mounted) { void refreshRunsSafe(); return; }
  mounted = true;
  setupTabs();
  setupCreateForm();
  setupFilters();
  setupResponsiveDrillIns();
  syncCreateProof();
  void loadProjects().then(refreshRunsSafe).catch((error) => {
    const status = $("#blog-create-status");
    status.textContent = error.message || "Blog Studio could not load projects.";
    status.classList.add("is-error");
  });
  window.addEventListener("online", () => void refreshRunsSafe());
  window.addEventListener("frank:view-changed", (event) => {
    if (event.detail?.id !== "blog-studio") setProofOpen(false, { restoreFocus: false });
  });
  window.addEventListener("beforeunload", () => eventStream?.close(), { once: true });
}
