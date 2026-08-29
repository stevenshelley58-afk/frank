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
let sourcePreviewExpanded = false;
const localRunInputs = new Map();
const previewUrls = new Set();
let runEvents = [];
let eventStream = null;
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);

const clean = (value) => String(value || "").trim();
const escapeHtml = (value) => clean(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const PIPELINE_STAGES = ["source", "analyse", "decompose", "restyle", "story-draft", "render", "compare", "qa", "final-review", "import"];
const PIPELINE_LABELS = {
  source: "Source", analyse: "Analyse", decompose: "Layer", restyle: "Restyle",
  "story-draft": "Story", render: "Render", compare: "Compare", qa: "Check",
  "final-review": "Final review", import: "Import",
};


function runStatusLabel(status) {
  return ({ queued: "Queued", started: "Starting", running: "Running", completed: "Complete", failed: "Failed", cancelled: "Cancelled", unavailable: "Status unavailable" })[status] || "Starting";
}

function dateLabel(seconds) {
  if (!seconds) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000));
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
  $("#ad-run-mode").textContent = selectedFiles.length ? "Source selected" : "Awaiting source";
  sourcePreviewExpanded = false;
  const visibleSources = selectedFiles.slice(0, 1);
  visibleSources.forEach((source) => {
    const item = document.createElement("div");
    item.className = "ad-source-item";
    const image = document.createElement("img");
    image.src = source.previewUrl;
    image.alt = source.name;
    const label = document.createElement("span");
    label.textContent = source.name;
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
  const keep = additions[0];
  if (!keep) return;
  for (const source of additions.slice(1)) { URL.revokeObjectURL(source.previewUrl); previewUrls.delete(source.previewUrl); }
  selectedFiles.filter((source) => source.kind === "local").forEach((source) => { URL.revokeObjectURL(source.previewUrl); previewUrls.delete(source.previewUrl); });
  selectedFiles = [keep];
  renderSourcePreview();
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
  const current = run.stage;
  const currentIndex = PIPELINE_STAGES.indexOf(current);
  const recorded = new Set(runEvents.filter((event) => event.kind === "stage.started").map((event) => event.node_id));
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


function renderRunDetail(run) {
  const detail = $("#ad-run-detail");
  detail.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "ad-run-summary";
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = run.title || "Ad Studio job";
  const meta = document.createElement("p");
  meta.textContent = `${runStatusLabel(run.status)} · ${PIPELINE_LABELS[run.stage] || run.stage || "Source"} · ${formatCost(run)}`;
  copy.append(heading, meta);
  const live = document.createElement("span");
  live.className = "ad-live-state";
  live.textContent = ["completed", "failed", "cancelled"].includes(run.status) ? "Recorded" : "Live";
  summary.append(copy, live);
  detail.append(summary);
  const overview = document.createElement("dl");
  overview.className = "ad-run-facts";
  const facts = [["Run", run.id], ["Stage", run.stage || "source"]];
  if (run.output?.import?.template_id) facts.push(["Blockwise template", run.output.import.template_id]);
  for (const [label, value] of facts) {
    const item = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = value;
    if (label === "Run" || label === "Blockwise template") description.title = value;
    item.append(term, description); overview.append(item);
  }
  detail.append(overview);
  renderPhaseTimeline(run, detail);
  if (run.status === "completed" && ["imported", "ready", "ok"].includes(String(run.output?.import?.status || "").toLowerCase())) {
    const readySection = document.createElement("section"); readySection.className = "ad-template-ready";
    const title = document.createElement("strong"); title.textContent = "Template ready";
    const evidence = document.createElement("p"); evidence.textContent = "Feed and Story are live in Blockwise.";
    readySection.append(title, evidence); detail.append(readySection);
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

const EVENT_KINDS = ["command.accepted", "run.recovered", "run.interrupted", "run.failed", "run.cancelled", "stage.started", "tool.started", "tool.completed", "subagent.start", "subagent.complete", "iteration.started", "iteration.rendered", "iteration.compared", "iteration.revised", "final-review.started", "final-review.completed", "template.imported"];

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

function safeEventData(event) {
  const data = event?.data || {};
  if (event.kind === "stage.started") return { summary: `Started ${String(event.node_id || "pipeline stage").replaceAll("-", " ")}` };
  if (event.kind === "tool.started" || event.kind === "tool.completed") return { tool: SAFE_TOOL_LABELS[data.tool] || "Builder action", duration_seconds: data.duration_seconds, error: Boolean(data.error) };
  if (event.kind === "iteration.compared" || event.kind === "iteration.revised") return {
    iteration: firstNumber(data.iteration), score: firstNumber(data.score),
    reason: redactOperatorText(data.reason), decision: clean(data.decision),
  };
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
      const item = JSON.parse(event.data);
      if (!runEvents.some((existing) => existing.sequence === item.sequence)) runEvents.push(item);
      if (["iteration.rendered", "iteration.compared"].includes(item.kind)) mergeIterationEvent(run, item);
      if (item.kind === "stage.started" && item.node_id) {
        run.stage = item.node_id;
        run.progress = Math.max(Number(run.progress || 0), Math.max(0, PIPELINE_STAGES.indexOf(item.node_id)) / PIPELINE_STAGES.length);
      }
      renderRunDetail(run);
      if (["run.failed", "run.cancelled", "template.imported"].includes(item.kind)) void refreshRunsSafe().then(() => {
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
  input.addEventListener("change", () => {
    addLocalFiles(input.files);
    input.value = "";
    $("#ad-source-dialog").close();
  });
  drop.addEventListener("click", openSourceDialog);
  $("#ad-source-device").addEventListener("click", () => input.click());
  $("#ad-source-close").addEventListener("click", () => $("#ad-source-dialog").close());
  $("#ad-source-cancel").addEventListener("click", () => $("#ad-source-dialog").close());
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
    const submit = $("#ad-run-submit");
    status.classList.remove("is-error");
    if (!selectedFiles.length) {
      status.textContent = "Choose one source image.";
      status.classList.add("is-error");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Starting…";
    status.textContent = "Uploading source and starting Hermes…";
    try {
      const result = await requestEvent("frank:ad-studio-run", {
        sources: selectedFiles.slice(0, 1), projectId: $("#ad-run-project").value,
        name: clean($("#ad-run-name").value), brief: clean($("#ad-run-brief").value),
      });
      const run = result.run;
      const first = selectedFiles[0];
      localRunInputs.set(run.id, { url: first.previewUrl, name: first.name });
      selectedRunId = run.id;
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
}
