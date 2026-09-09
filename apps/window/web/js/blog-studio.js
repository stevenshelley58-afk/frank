const TOOL_ID = "content-factory";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let mounted = false;
let projects = [];
let runs = [];
let selectedRunId = "";
let eventStream = null;
let runEvents = [];
let sectionObserver = null;

const MAX_SOURCES = 5;
const MAX_SOURCE_BYTES = 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(["md", "markdown", "txt"]);
const EVENT_LIMIT = 40;
const PIPELINE_STAGES = ["source", "research", "brief", "draft", "edit", "package", "qa", "human-approval", "release"];
const STAGE_LABELS = {
  source: "Source", research: "Research", brief: "Brief", draft: "Draft", edit: "Edit",
  package: "Package", qa: "QA", "human-approval": "Review", release: "Release",
};
const RUN_STATUS = {
  queued: "Queued", running: "Running", blocked: "Needs attention", waiting_review: "Awaiting review",
  quarantined: "Quarantined", completed: "Released", failed: "Failed", rejected: "Rejected",
  cancelling: "Cancelling", cancelled: "Cancelled",
};

const clean = (value) => String(value || "").trim();
const escapeHtml = (value) => clean(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function redactOperatorText(value) {
  return clean(value)
    .replace(/\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/(?:\/(?:home|root|Users|srv|var|tmp|mnt)\/[^\s"']+)/g, "[path]");
}

function runStatusLabel(status) {
  return RUN_STATUS[status] || "Starting";
}

function dateLabel(seconds) {
  if (!seconds) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000));
  } catch { return ""; }
}

function activate(tab) {
  const tabs = $$("[data-blog-tab]");
  tabs.forEach((button) => {
    const on = button.dataset.blogTab === tab;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
    const panel = $(`[data-blog-panel="${button.dataset.blogTab}"]`);
    if (panel) {
      panel.classList.toggle("is-on", on);
      panel.hidden = !on;
    }
  });
}

function fillProjects() {
  const options = ['<option value="">Choose a project…</option>']
    .concat(projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name || project.id)}</option>`));
  for (const select of $$("#blog-run-project, #blog-pipeline-project")) {
    select.replaceChildren();
    const template = document.createElement("template");
    template.innerHTML = options.join("");
    select.append(...template.content.children);
  }
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  if (!response.ok) throw new Error("Frank could not load your projects.");
  const data = await response.json().catch(() => ({}));
  projects = (Array.isArray(data.projects) ? data.projects : []).filter((project) => project?.id);
  fillProjects();
}

function selectedProjectId() {
  return clean($("#blog-run-project")?.value);
}

function sourceFiles() {
  return Array.from($("#blog-source-files")?.files || []);
}

function updateRunControls() {
  const files = sourceFiles();
  const hasInput = clean($("#blog-run-topic")?.value) || clean($("#blog-run-direction")?.value) || files.length > 0;
  const submit = $("#blog-run-submit");
  if (submit) submit.disabled = !selectedProjectId() || !hasInput;
  const mode = $("#blog-run-mode");
  if (mode) {
    const parts = [];
    if (clean($("#blog-run-topic")?.value)) parts.push("topic");
    if (files.length) parts.push(files.length === 1 ? "1 source" : `${files.length} sources`);
    if (clean($("#blog-run-direction")?.value)) parts.push("direction");
    mode.textContent = parts.length ? `From ${parts.join(" + ")}` : "Choose a topic, sources, or a direction";
  }
}

function renderSourceList() {
  const list = $("#blog-source-list");
  if (!list) return;
  const files = sourceFiles();
  list.replaceChildren();
  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    list.append(item);
  }
}

function validateSourcesLocally(files) {
  if (files.length > MAX_SOURCES) return `Choose up to ${MAX_SOURCES} source documents.`;
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SOURCE_EXTENSIONS.has(extension)) return `${file.name} is not a supported text document (.md, .markdown, .txt).`;
    if (file.size > MAX_SOURCE_BYTES) return `${file.name} is too large (limit 1 MB).`;
    if (file.size === 0) return `${file.name} is empty.`;
  }
  return "";
}

function renderRuns() {
  const list = $("#blog-runs-list");
  if (!list) return;
  list.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "blog-empty-runs";
    empty.textContent = "No Blog Studio runs yet for this project.";
    list.append(empty);
    return;
  }
  for (const run of runs) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "blog-run-item";
    item.dataset.runId = run.id;
    if (run.id === selectedRunId) item.classList.add("is-on");
    const title = document.createElement("strong");
    title.textContent = run.title || "Blog run";
    const meta = document.createElement("span");
    meta.textContent = `${runStatusLabel(run.status)} · ${dateLabel(run.updated_at || run.created_at)}`;
    if (run.attention) item.classList.add("is-attention");
    item.append(title, meta);
    item.addEventListener("click", () => void selectRun(run.id));
    list.append(item);
  }
}

async function refreshRuns() {
  const projectId = selectedProjectId();
  const query = new URLSearchParams({ tool_id: TOOL_ID, limit: "60" });
  if (projectId) query.set("project_id", projectId);
  const response = await fetch(`/api/blog-studio/runs?${query}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Hermes is unavailable, so run history cannot be shown.");
  runs = Array.isArray(data.runs) ? data.runs : [];
  if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) selectedRunId = "";
  renderRuns();
  renderRunOptions();
  if (selectedRunId) {
    const fresh = runs.find((run) => run.id === selectedRunId);
    if (fresh) renderRunDetail(fresh);
  } else {
    renderRunDetail(null);
  }
}

async function refreshRunsSafe() {
  try {
    await refreshRuns();
  } catch { /* status stays truthful from the last successful load */ }
}

function renderRunOptions() {
  const select = $("#blog-pipeline-run");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = runs.length ? "No run selected" : "No runs yet";
  select.append(placeholder);
  for (const run of runs) {
    const option = document.createElement("option");
    option.value = run.id;
    option.textContent = `${run.title || "Blog run"} · ${runStatusLabel(run.status)}`;
    if (run.id === selectedRunId) option.selected = true;
    select.append(option);
  }
}

function renderStageProgress(run, parent) {
  const stages = document.createElement("ol");
  stages.className = "blog-stage-progress";
  const currentIndex = PIPELINE_STAGES.indexOf(clean(run.stage));
  PIPELINE_STAGES.forEach((stage, index) => {
    const item = document.createElement("li");
    item.dataset.stage = stage;
    const done = run.status === "completed" || (currentIndex > index && currentIndex !== -1);
    const active = currentIndex === index && ["queued", "running", "cancelling"].includes(run.status);
    item.classList.toggle("is-done", done);
    item.classList.toggle("is-active", active);
    item.textContent = STAGE_LABELS[stage];
    stages.append(item);
  });
  parent.append(stages);
}

function renderEventViews() {
  const container = $("#blog-event-log");
  if (!container) return;
  container.replaceChildren();
  const visible = runEvents.slice(-EVENT_LIMIT);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "blog-empty-events";
    empty.textContent = "No events recorded yet.";
    container.append(empty);
    return;
  }
  for (const event of visible) {
    const item = document.createElement("li");
    const kind = document.createElement("strong");
    kind.textContent = clean(event.kind);
    const summary = document.createElement("span");
    summary.textContent = safeEventSummary(event);
    item.append(kind, summary);
    container.append(item);
  }
  const bounded = document.createElement("li");
  bounded.className = "blog-events-bound";
  bounded.textContent = runEvents.length > EVENT_LIMIT
    ? `Showing the last ${EVENT_LIMIT} of ${runEvents.length} events.`
    : "";
  if (bounded.textContent) container.append(bounded);
}

function safeEventSummary(event) {
  const data = event && typeof event.data === "object" && event.data ? event.data : {};
  const value = (key) => clean(data[key]);
  if (event.kind === "research.evidence") return `${Number(value("finding_count")) || 0} sources verified`;
  if (event.kind === "package.pinned") return `package ${value("sha256").slice(0, 16)}`;
  if (event.kind === "review.requested") return `package ${value("package_sha256").slice(0, 16)}`;
  if (event.kind === "qa.failed") return clean(data.failures?.[0] || "quality checks failed");
  if (event.kind === "qa.passed") return `${value("word_count")} words, ${value("citation_count")} citations`;
  if (event.kind === "run.failed") return redactOperatorText(value("error")) || "Run failed; diagnostics remain in Hermes.";
  if (event.kind === "checkpoint.invalidated") return "downstream work cleared";
  if (event.kind === "rerun.queued") return `restarting from ${STAGE_LABELS[value("stage")] || clean(value("stage"))}`;
  if (event.kind === "release.withdrawn") return "release withdrawn; tombstone recorded";
  if (event.kind === "changes.requested") return redactOperatorText(value("feedback")).slice(0, 120);
  return "";
}

function renderEvidence(run, parent) {
  const evidence = Array.isArray(run.output?.evidence) ? run.output.evidence : [];
  if (!evidence.length) return;
  const section = document.createElement("section");
  section.className = "blog-evidence";
  const heading = document.createElement("h4");
  heading.textContent = `Research evidence (${evidence.length})`;
  section.append(heading);
  const list = document.createElement("ul");
  for (const item of evidence) {
    const entry = document.createElement("li");
    const link = document.createElement("a");
    link.href = clean(item.url);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = clean(item.title) || clean(item.url);
    const excerpt = document.createElement("span");
    excerpt.textContent = clean(item.excerpt);
    entry.append(link, excerpt);
    list.append(entry);
  }
  section.append(list);
  parent.append(section);
}

function renderQa(run, parent) {
  const qa = run.output?.qa;
  if (!qa || typeof qa !== "object") return;
  const section = document.createElement("section");
  section.className = "blog-qa";
  const heading = document.createElement("h4");
  heading.textContent = qa.passed ? `Deterministic QA passed · ${qa.word_count} words · ${qa.citation_count} citations` : "Deterministic QA failed";
  section.append(heading);
  for (const failure of Array.isArray(qa.failures) ? qa.failures : []) {
    const item = document.createElement("p");
    item.className = "blog-qa-failure";
    item.textContent = clean(failure);
    section.append(item);
  }
  parent.append(section);
}

function renderReleaseProof(run, parent) {
  const release = run.output?.release;
  if (!release || typeof release !== "object") return;
  const section = document.createElement("section");
  section.className = "blog-release-proof";
  const heading = document.createElement("h4");
  heading.textContent = release.withdrawn ? "Release withdrawn" : "Published release";
  section.append(heading);
  const digest = document.createElement("p");
  digest.className = "blog-release-digest";
  digest.textContent = `package sha256 ${clean(release.package_sha256)}`;
  section.append(digest);
  const files = document.createElement("ul");
  for (const [name, checksum] of Object.entries(release.files || {})) {
    const item = document.createElement("li");
    item.textContent = `${name} · ${clean(checksum).slice(0, 16)}…`;
    files.append(item);
  }
  section.append(files);
  if (release.withdrawn) {
    const tombstone = document.createElement("p");
    tombstone.className = "blog-tombstone";
    tombstone.textContent = "A public tombstone records the withdrawal; the released bytes remain immutable.";
    section.append(tombstone);
  }
  parent.append(section);
}

function renderActions(run) {
  const actions = $("#blog-run-actions");
  if (!actions) return;
  actions.replaceChildren();
  actions.hidden = false;
  const button = (label, className, handler) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.textContent = label;
    control.addEventListener("click", handler);
    actions.append(control);
    return control;
  };
  const postAction = (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    void (async () => {
      try {
        const response = await fetch(`/api/blog-studio/runs/${encodeURIComponent(run.id)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Hermes rejected the action.");
        await refreshRuns();
      } catch (error) {
        setRunError(error.message || "The action failed.");
      }
    })();
  };
  if (run.status === "waiting_review") {
    button("Approve and release the exact reviewed bytes", "blog-primary", () => postAction(
      { action: "approve", package_sha256: clean(run.output?.package?.sha256) },
      "Release the exact reviewed bytes? The release is immutable and pins the reviewed package.",
    ));
    button("Request changes", "blog-secondary", () => openFeedbackDrawer(run));
    button("Reject", "blog-danger", () => postAction({ action: "reject" }, "Reject this run? It cannot be resumed afterwards."));
  }
  if (["failed", "cancelled", "blocked", "quarantined", "rejected"].includes(run.status)) {
    button("Resume", "blog-secondary", () => postAction({ action: "resume" }));
  }
  if (run.output?.release && !run.output.release.withdrawn) {
    button("Withdraw release", "blog-danger", () => postAction(
      { action: "withdraw" },
      "Withdraw the published release? A public tombstone will record the withdrawal.",
    ));
  }
  if (!["running", "queued", "cancelling"].includes(run.status)) {
    button("Rerun from edit", "blog-secondary", () => postAction(
      { action: "rerun", stage: "edit" },
      "Rerun from edit? Every later checkpoint (including QA and any release) is invalidated.",
    ));
  }
  if (["queued", "running"].includes(run.status)) {
    button("Cancel", "blog-secondary", () => postAction({ action: "cancel" }));
  }
}

function setRunError(message) {
  const status = $("#blog-run-error");
  if (!status) return;
  status.textContent = message ? redactOperatorText(message) : "";
  status.hidden = !message;
}

function renderRunDetail(run) {
  const detail = $("#blog-run-detail");
  if (!detail) return;
  detail.replaceChildren();
  if (!run) {
    const empty = document.createElement("div");
    empty.className = "blog-empty";
    empty.innerHTML = "<strong>Select a run</strong><span>Open a run to inspect its stages, evidence, QA and release proof.</span>";
    detail.append(empty);
    $("#blog-run-actions").hidden = true;
    setRunError("");
    return;
  }
  const heading = document.createElement("h3");
  heading.textContent = run.title || "Blog run";
  const status = document.createElement("p");
  status.className = "blog-run-status";
  status.textContent = `${runStatusLabel(run.status)} · stage ${STAGE_LABELS[clean(run.stage)] || clean(run.stage) || "—"} · ${dateLabel(run.updated_at || run.created_at)}`;
  detail.append(heading, status);
  if (run.status === "waiting_review") {
    const notice = document.createElement("p");
    notice.className = "blog-review-notice";
    notice.textContent = "Hermes is waiting for your decision. Approval releases the exact reviewed bytes and nothing else.";
    detail.append(notice);
  }
  if (run.status === "failed") {
    const notice = document.createElement("p");
    notice.className = "blog-run-failed";
    notice.textContent = redactOperatorText(run.error) || "This run failed; diagnostics remain in Hermes.";
    detail.append(notice);
  }
  renderStageProgress(run, detail);
  const brief = run.output?.brief;
  if (brief && typeof brief === "object") {
    const section = document.createElement("section");
    section.className = "blog-brief";
    const briefHeading = document.createElement("h4");
    briefHeading.textContent = clean(brief.angle) || "Brief";
    section.append(briefHeading);
    const list = document.createElement("ul");
    for (const item of Array.isArray(brief.outline) ? brief.outline : []) {
      const entry = document.createElement("li");
      entry.textContent = clean(item);
      list.append(entry);
    }
    section.append(list);
    detail.append(section);
  }
  renderEvidence(run, detail);
  renderQa(run, detail);
  const articleLink = document.createElement("p");
  articleLink.className = "blog-article-link";
  const artifactUrl = `/api/blog-studio/runs/${encodeURIComponent(run.id)}/artifacts/final.md`;
  articleLink.innerHTML = `<a href="${escapeHtml(artifactUrl)}" target="_blank" rel="noopener noreferrer">Open final article</a>`;
  if (run.output?.title) detail.append(articleLink);
  renderReleaseProof(run, detail);
  const events = document.createElement("div");
  events.className = "blog-events";
  const eventsHeading = document.createElement("h4");
  eventsHeading.textContent = "Event log";
  const eventList = document.createElement("ol");
  eventList.id = "blog-event-log";
  events.append(eventsHeading, eventList);
  detail.append(events);
  renderEventViews();
  renderActions(run);
}

async function selectRun(runId) {
  selectedRunId = clean(runId);
  renderRuns();
  renderRunOptions();
  try {
    const response = await fetch(`/api/blog-studio/runs/${encodeURIComponent(selectedRunId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Hermes did not return this run.");
    const run = data.run || {};
    runEvents = [];
    renderRunDetail(run);
    connectRunEvents(run);
    setRunError("");
  } catch (error) {
    setRunError(error.message || "Could not open the run.");
  }
}

function connectRunEvents(run) {
  if (eventStream) { eventStream.close(); eventStream = null; }
  if (!run?.id) return;
  const stream = new EventSource(`/api/blog-studio/runs/${encodeURIComponent(run.id)}/events?after=-1`);
  eventStream = stream;
  stream.addEventListener("event", (message) => {
    try {
      const data = JSON.parse(message.data || "{}");
      if (data.kind) {
        runEvents.push(data);
        renderEventViews();
      }
    } catch { /* ignore malformed keepalives */ }
  });
  stream.addEventListener("status", (message) => {
    try {
      const data = JSON.parse(message.data || "{}");
      if (data.status && ["completed", "failed", "cancelled", "rejected", "waiting_review"].includes(data.status)) {
        void refreshRunsSafe();
      }
    } catch { /* ignore */ }
  });
  stream.addEventListener("disconnected", () => { /* trailing reload covers gaps */ });
}

function openFeedbackDrawer(run) {
  const drawer = $("#blog-feedback-drawer");
  const backdrop = $("#blog-drawer-backdrop");
  if (!drawer || !backdrop) return;
  drawer.hidden = false;
  backdrop.hidden = false;
  drawer.dataset.runId = run.id;
  $("#blog-feedback-text").value = "";
  $("#blog-feedback-error").textContent = "";
  $("#blog-feedback-text").focus();
  document.addEventListener("keydown", drawerKeydown, true);
}

function closeFeedbackDrawer({ restoreFocus = true } = {}) {
  const drawer = $("#blog-feedback-drawer");
  const backdrop = $("#blog-drawer-backdrop");
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.removeEventListener("keydown", drawerKeydown, true);
  if (restoreFocus) $("#blog-run-actions")?.querySelector("button")?.focus();
}

function drawerKeydown(event) {
  const drawer = $("#blog-feedback-drawer");
  if (!drawer || drawer.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeFeedbackDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = $$("button, textarea, [tabindex]", drawer).filter((element) => !element.hidden && element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function submitFeedback() {
  const drawer = $("#blog-feedback-drawer");
  const runId = clean(drawer?.dataset.runId);
  const feedback = clean($("#blog-feedback-text")?.value);
  const error = $("#blog-feedback-error");
  if (!feedback) {
    if (error) error.textContent = "Describe the changes you want.";
    return;
  }
  if (feedback.length > 4000) {
    if (error) error.textContent = "Feedback must stay under 4000 characters.";
    return;
  }
  closeFeedbackDrawer();
  void (async () => {
    try {
      const response = await fetch(`/api/blog-studio/runs/${encodeURIComponent(runId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_changes", feedback }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Hermes rejected the change request.");
      await refreshRuns();
    } catch (requestError) {
      setRunError(requestError.message || "The change request failed.");
    }
  })();
}

function setupRunForm() {
  const form = $("#blog-run-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const files = sourceFiles();
    const localError = validateSourcesLocally(files);
    if (localError) {
      setRunError(localError);
      return;
    }
    setRunError("");
    const submit = $("#blog-run-submit");
    if (submit) submit.disabled = true;
    void (async () => {
      try {
        const result = await new Promise((resolve, reject) => {
          window.dispatchEvent(new CustomEvent("frank:blog-studio-run", {
            detail: {
              form: {
                projectId: selectedProjectId(),
                topic: clean($("#blog-run-topic")?.value),
                direction: clean($("#blog-run-direction")?.value),
                files,
              },
              resolve,
              reject,
            },
          }));
        });
        if ($("#blog-source-files")) $("#blog-source-files").value = "";
        if ($("#blog-run-topic")) $("#blog-run-topic").value = "";
        if ($("#blog-run-direction")) $("#blog-run-direction").value = "";
        renderSourceList();
        updateRunControls();
        setRunError("");
        activate("runs");
        if (result?.run?.id) await selectRun(result.run.id);
        await refreshRunsSafe();
      } catch (error) {
        setRunError(error.message || "Hermes could not start the run.");
      } finally {
        if (submit) submit.disabled = false;
        updateRunControls();
      }
    })();
  });
  for (const input of $$("#blog-run-topic, #blog-run-direction")) {
    input.addEventListener("input", () => { updateRunControls(); setRunError(""); });
  }
  $("#blog-run-project")?.addEventListener("change", () => { updateRunControls(); void refreshRunsSafe(); });
  $("#blog-source-files")?.addEventListener("change", () => {
    const localError = validateSourcesLocally(sourceFiles());
    if (localError) {
      $("#blog-source-files").value = "";
      setRunError(localError);
    }
    renderSourceList();
    updateRunControls();
  });
  $("#blog-source-drop")?.addEventListener("click", () => $("#blog-source-files")?.click());
  $("#blog-feedback-cancel")?.addEventListener("click", () => closeFeedbackDrawer());
  $("#blog-feedback-submit")?.addEventListener("click", () => submitFeedback());
  $("#blog-drawer-backdrop")?.addEventListener("click", () => closeFeedbackDrawer());
}

function setupPipelineForm() {
  $("#blog-pipeline-project")?.addEventListener("change", () => void refreshRunsSafe());
  $("#blog-pipeline-run")?.addEventListener("change", (event) => {
    const runId = clean(event.target.value);
    if (runId) void selectRun(runId);
  });
}

function watchSectionVisibility() {
  const section = $('[data-view="blog-studio"]');
  if (!section || sectionObserver) return;
  sectionObserver = new MutationObserver(() => {
    if (!section.classList.contains("is-on")) {
      closeFeedbackDrawer({ restoreFocus: false });
      if (eventStream) { eventStream.close(); eventStream = null; }
    }
  });
  sectionObserver.observe(section, { attributes: true, attributeFilter: ["class"] });
}

export function mountBlogStudio() {
  if (mounted) { void refreshRunsSafe(); return; }
  mounted = true;
  const tabs = $$("[data-blog-tab]");
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => { activate(button.dataset.blogTab); });
    button.addEventListener("keydown", (event) => {
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      activate(next.dataset.blogTab);
      next.focus();
    });
  });
  setupRunForm();
  setupPipelineForm();
  watchSectionVisibility();
  void loadProjects().then(() => refreshRunsSafe()).catch((error) => {
    setRunError(error.message || "Blog Studio could not load.");
  });
}
