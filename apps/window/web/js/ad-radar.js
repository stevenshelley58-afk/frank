const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const PIPELINE = ["discover", "resolve", "capture", "normalize", "classify", "media-qa", "publish"];
const TERMINAL = new Set(["published", "completed", "failed", "cancelled"]);
const LIVE = new Set(["queued", "ready", "running", "paused", "retryable_failure", "quarantined", "awaiting_approval", "cancelling"]);
const EVENT_TYPES = new Set([
  "command.accepted", "run.started", "run.paused", "run.cancelled", "run.failed",
  "run.interrupted", "run.quarantined", "run.completed", "run.activity",
  "stage.started", "stage.completed", "stage.failed", "stage.retrying",
  "creative.observed", "creative.normalized", "classification.recorded",
  "media-qa.recorded", "approval.requested", "approval.approved",
  "approval.rejected", "release.published", "publish.completed",
  "run-started", "stage-completed", "run-quarantined", "publish-completed",
  "settings-validation-completed", "settings-revision-activated", "connection-check-completed",
  "run-paused", "run-resumed", "run-cancelled", "run-completed", "stage-started",
  "stage-retry-scheduled", "stage-failed", "health-snapshot-recorded",
  "creative-observed", "advertiser-resolved", "evidence-captured", "creative-normalized",
  "creative-recapture-completed", "creative-reclassified", "creative-archived", "creative-restored",
  "classification-completed", "media-qa-completed", "creative-quarantined", "creative-approved",
  "creative-rejected", "quarantine-resolved", "approval-requested", "approval-recorded",
  "publish-started", "publish-failed", "release-verified", "release-superseded",
]);
const EVENT_LIMIT = 300;

let mounted = false;
let active = false;
let projects = [];
let selectedProjectId = "";
let contract = null;
let contractError = "";
let runs = [];
let selectedRunId = "";
let selectedCreativeId = "";
let selectedObservationKey = "";
let activePanel = "timeline";
let timelineFilter = "all";
let runEvents = [];
let compareIds = new Set();
let comparisonOpen = false;
let stream = null;
let streamRunId = "";
let streamCursor = -1;
let reconnectTimer = 0;
let reconnectAttempt = 0;
let pendingOperation = null;
let lastInspectorTrigger = null;
const requests = new Set();

const clean = (value) => String(value ?? "").trim();

function operationId() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error("Secure operation IDs are unavailable in this browser.");
  if (typeof cryptoApi.randomUUID === "function") return `op_${cryptoApi.randomUUID().replaceAll("-", "")}`;
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return `op_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function splitList(value, limit = 50) {
  const seen = new Set();
  const output = [];
  for (const raw of clean(value).split(",")) {
    const item = raw.replace(/\s+/g, " ").trim();
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

export function appendBoundedEvent(events, event, limit = EVENT_LIMIT) {
  if (!event || typeof event !== "object") return events.slice(-limit);
  const sequence = Number(event.sequence);
  if (Number.isFinite(sequence) && events.some((item) => Number(item.sequence) === sequence && item._runId === event._runId)) {
    return events.slice(-limit);
  }
  return [...events, event]
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .slice(-limit);
}

function timestampNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function creativeStatus(creative, run) {
  const declared = clean(creative?.lifecycle?.status).toLowerCase();
  if (["recorded", "active", "new", "changed", "quarantined", "approved", "stopped", "published"].includes(declared)) return declared;
  if (run?.status === "quarantined" || run?.status === "failed") return "quarantined";
  if (run?.status === "published" || run?.release?.status === "released") return "published";
  if (run?.status === "paused" || run?.status === "cancelled") return "stopped";
  return "recorded";
}

function eventChange(event) {
  const declared = clean(event?.data?.change).toLowerCase();
  if (declared) return declared;
  const kind = clean(event?.kind);
  if (kind.includes("quarantin")) return "quarantined";
  if (kind.includes("approval.approved") || kind.includes("creative-approved") || kind.includes("approval-recorded")) return "approved";
  if (kind.includes("publish") || kind.includes("release")) return "published";
  if (kind.includes("pause") || kind.includes("cancel")) return "stopped";
  if (kind.includes("creative.observed") || kind.includes("creative-observed")) return "new";
  return "changed";
}

function eventSummary(event) {
  if (clean(event?.data?.summary)) return clean(event.data.summary);
  const kind = clean(event?.kind);
  const summaries = {
    "creative.observed": "New public creative observed.",
    "creative.normalized": "Public creative normalized and recorded.",
    "classification.recorded": "Classification evidence recorded.",
    "media-qa.recorded": "Media quality checks recorded.",
    "run.quarantined": "Run requires attention before release.",
    "approval.requested": "Publish approval is required.",
    "approval.approved": "Publish candidate approved.",
    "release.published": "Immutable public release published.",
    "publish.completed": "Immutable public release published.",
  };
  return summaries[kind] || kind.replaceAll(".", " ").replaceAll("-", " ") || "Run activity recorded.";
}

function allCreatives(inputRuns = runs) {
  const byId = new Map();
  const ordered = [...inputRuns].sort((a, b) => timestampNumber(a.updated_at) - timestampNumber(b.updated_at));
  for (const run of ordered) {
    for (const creative of Array.isArray(run.creatives) ? run.creatives : []) {
      if (!clean(creative?.id)) continue;
      byId.set(creative.id, { ...creative, _run: run, _status: creativeStatus(creative, run) });
    }
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = timestampNumber(a.observed?.last_seen || a._run?.updated_at);
    const bTime = timestampNumber(b.observed?.last_seen || b._run?.updated_at);
    return bTime - aTime;
  });
}

export function deriveTimelineItems(inputRuns, events) {
  const creatives = allCreatives(inputRuns);
  const byId = new Map(creatives.map((item) => [item.id, item]));
  const eventCreativeIds = new Set();
  const items = [];

  for (const event of Array.isArray(events) ? events : []) {
    const creativeId = clean(event?.data?.creative_id);
    const creative = byId.get(creativeId) || null;
    if (creativeId) eventCreativeIds.add(creativeId);
    if (!creativeId && ![
      "run.quarantined", "approval.requested", "approval.approved", "release.published",
      "publish.completed", "run.paused", "run.cancelled",
      "run-quarantined", "approval-requested", "approval-recorded", "publish-completed",
      "run-paused", "run-cancelled", "release-verified", "release-superseded",
    ].includes(clean(event?.kind))) continue;
    items.push({
      key: `event:${clean(event?._runId)}:${Number(event?.sequence || 0)}`,
      creativeId,
      runId: clean(event?._runId || creative?._run?.id),
      status: eventChange(event),
      timestamp: timestampNumber(event?.timestamp),
      advertiser: clean(event?.data?.advertiser || creative?.advertiser) || "Run activity",
      summary: eventSummary(event),
      sourceId: clean(event?.data?.source_id),
      creative,
      event,
    });
  }

  for (const creative of creatives) {
    if (eventCreativeIds.has(creative.id)) continue;
    const headline = clean(creative.copy?.headline || creative.copy?.body);
    items.push({
      key: `creative:${creative.id}`,
      creativeId: creative.id,
      runId: clean(creative._run?.id),
      status: creative._status,
      timestamp: timestampNumber(creative.observed?.last_seen || creative._run?.updated_at),
      advertiser: clean(creative.advertiser) || "Public creative",
      summary: headline || "Public creative observation recorded.",
      sourceId: "",
      creative,
      event: null,
    });
  }
  return items.sort((a, b) => b.timestamp - a.timestamp || a.key.localeCompare(b.key));
}

export function filterCreatives(creatives, { query = "", status = "all", media = "all" } = {}) {
  const needle = clean(query).toLocaleLowerCase();
  return (Array.isArray(creatives) ? creatives : []).filter((creative) => {
    if (status !== "all" && creative._status !== status) return false;
    if (media !== "all" && !(creative.media || []).some((item) => item.kind === media)) return false;
    if (!needle) return true;
    return [
      creative.advertiser, creative.market, creative.category,
      creative.copy?.headline, creative.copy?.body, creative.copy?.cta,
      creative.classification?.label,
    ].some((value) => clean(value).toLocaleLowerCase().includes(needle));
  });
}

function make(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function emptyState(host, title, body) {
  const empty = make("div", "radar-empty");
  empty.append(make("strong", "", title), make("span", "", body));
  host.replaceChildren(empty);
}

function label(value) {
  const text = clean(value).replaceAll("_", " ").replaceAll("-", " ");
  return text ? text.replace(/^./, (character) => character.toUpperCase()) : "Unknown";
}

function formatDate(value, options = {}) {
  const seconds = timestampNumber(value);
  if (!seconds) return "Not recorded";
  try {
    return new Intl.DateTimeFormat("en-AU", options).format(new Date(seconds * 1000));
  } catch {
    return "Not recorded";
  }
}

function clock(value) {
  return formatDate(value, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function dateTime(value) {
  return formatDate(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function safePublicUrl(value) {
  try {
    const url = new URL(clean(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function previewFor(creative) {
  const run = creative?._run || runs.find((item) => (item.creatives || []).some((entry) => entry.id === creative?.id));
  const preview = (run?.previews || []).find((item) => item.creative_id === creative?.id);
  const url = clean(preview?.url);
  const kind = clean(preview?.kind);
  if (!/^\/api\/ad-radar\/runs\/[A-Za-z0-9_.~-]+\/artifacts\/[A-Za-z0-9_.~-]+\?project_id=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url)) return null;
  return ["image", "video"].includes(kind) ? { url, kind } : null;
}

function mediaNode(creative, className) {
  const host = make("div", className);
  const preview = previewFor(creative);
  if (!preview) {
    host.append(make("span", "radar-media-placeholder", "Preview unavailable"));
    return host;
  }
  const mediaLabel = `${clean(creative.advertiser) || "Public creative"} normalized media`;
  const media = make(preview.kind === "video" ? "video" : "img");
  media.src = preview.url;
  if (preview.kind === "video") {
    media.preload = "metadata";
    media.muted = true;
    media.playsInline = true;
    media.controls = className === "radar-inspector-media";
    media.setAttribute("aria-label", mediaLabel);
  } else {
    media.alt = mediaLabel;
  }
  media.addEventListener("error", () => host.replaceChildren(make("span", "radar-media-placeholder", "Preview unavailable")), { once: true });
  host.append(media);
  return host;
}

function notice(message = "", tone = "") {
  const host = $("#radar-notice");
  if (!host) return;
  host.textContent = message;
  host.hidden = !message;
  if (tone) host.dataset.tone = tone;
  else delete host.dataset.tone;
}

function inspectorIsModal() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function setInspectorBackgroundInert(inert) {
  for (const node of $$(".radar-commandbar, .radar-notice, [data-radar-panel], .radar-compare", $("#ad-radar"))) {
    node.inert = inert;
  }
}

function setInspectorOpen(open, trigger = null) {
  const root = $("#ad-radar");
  const inspector = $("#radar-inspector");
  if (open) {
    lastInspectorTrigger = trigger || document.activeElement;
    root.classList.add("inspector-open");
    if (inspectorIsModal()) {
      inspector.setAttribute("role", "dialog");
      inspector.setAttribute("aria-modal", "true");
      setInspectorBackgroundInert(true);
      window.requestAnimationFrame(() => inspector.focus());
    }
    return;
  }
  root.classList.remove("inspector-open");
  inspector.setAttribute("role", "complementary");
  inspector.removeAttribute("aria-modal");
  setInspectorBackgroundInert(false);
  const fallback = $$('[data-observation-key]').find((node) => node.dataset.observationKey === selectedObservationKey)
    || $$('[data-creative-id]').find((node) => node.dataset.creativeId === selectedCreativeId);
  const restore = lastInspectorTrigger?.isConnected ? lastInspectorTrigger : fallback;
  if (restore instanceof HTMLElement) restore.focus();
  lastInspectorTrigger = null;
}

function trapInspectorFocus(event) {
  if (event.key !== "Tab" || !inspectorIsModal() || !$("#ad-radar").classList.contains("inspector-open")) return;
  const inspector = $("#radar-inspector");
  const focusable = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])', inspector)
    .filter((node) => !node.hidden);
  if (!focusable.length) {
    event.preventDefault();
    inspector.focus();
    return;
  }
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

function setFreshness() {
  const latest = runs.reduce((value, run) => Math.max(value, timestampNumber(run.updated_at)), 0);
  $("#radar-freshness").textContent = latest ? `Last recorded ${dateTime(latest)}` : "No observations recorded";
  $("#radar-owner").textContent = runs.some((run) => LIVE.has(run.status)) ? "Hermes run live" : "Hermes owns execution";
}

async function requestJSON(url, options = {}) {
  const controller = new AbortController();
  requests.add(controller);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
    return body;
  } finally {
    requests.delete(controller);
  }
}

function abortRequests() {
  for (const controller of requests) controller.abort();
  requests.clear();
}

function fillProjects() {
  const select = $("#radar-project");
  const previous = selectedProjectId;
  select.replaceChildren();
  for (const project of projects) select.append(new Option(project.name || project.id, project.id));
  if (projects.some((project) => project.id === previous)) selectedProjectId = previous;
  else if (projects.some((project) => project.id === "blockwise")) selectedProjectId = "blockwise";
  else selectedProjectId = clean(projects[0]?.id);
  select.value = selectedProjectId;
  select.disabled = !projects.length;
}

async function loadFoundation() {
  const [projectResult, contractResult] = await Promise.allSettled([
    requestJSON("/api/projects"),
    requestJSON("/api/ad-radar/contract"),
  ]);
  if (projectResult.status === "rejected") throw projectResult.reason;
  projects = Array.isArray(projectResult.value.projects) ? projectResult.value.projects : [];
  contract = contractResult.status === "fulfilled" ? contractResult.value : null;
  contractError = contract ? "" : "The Ad Radar contract is unavailable; live event coverage is limited until it reloads.";
  fillProjects();
  renderPipeline();
}

async function refreshRuns({ keepSelection = true } = {}) {
  if (!selectedProjectId) {
    runs = [];
    selectedRunId = "";
    runEvents = [];
    renderAll();
    return;
  }
  const projectId = selectedProjectId;
  const data = await requestJSON(`/api/ad-radar/runs?project_id=${encodeURIComponent(projectId)}&limit=50`);
  if (projectId !== selectedProjectId) return;
  runs = (Array.isArray(data.runs) ? data.runs : [])
    .filter((run) => run && typeof run === "object")
    .sort((a, b) => timestampNumber(b.updated_at || b.created_at) - timestampNumber(a.updated_at || a.created_at));
  const preferred = keepSelection && runs.some((run) => run.id === selectedRunId) ? selectedRunId : clean(runs[0]?.id);
  if (preferred !== selectedRunId) {
    selectedRunId = preferred;
    selectedCreativeId = "";
    selectedObservationKey = "";
    runEvents = [];
    streamCursor = -1;
  }
  renderAll();
  if (selectedRunId) await selectRun(selectedRunId, { preserveEvents: true });
  else closeStream();
}

async function refreshAll() {
  notice("Loading Ad Radar…");
  try {
    if (!projects.length || !contract) await loadFoundation();
    await refreshRuns();
    notice(contractError, contractError ? "error" : "");
  } catch (error) {
    if (error?.name === "AbortError") return;
    notice(`${error.message || "Ad Radar is unavailable."} Check the Hermes connection and retry.`, "error");
    renderAll();
  }
}

async function selectRun(runId, { preserveEvents = false } = {}) {
  if (!clean(runId)) return;
  const projectId = selectedProjectId;
  const changed = runId !== selectedRunId;
  selectedRunId = runId;
  if (changed && !preserveEvents) {
    runEvents = [];
    streamCursor = -1;
  }
  renderRunList();
  renderRunDetail();
  renderPipeline();
  renderReleaseQueue();
  try {
    const data = await requestJSON(`/api/ad-radar/runs/${encodeURIComponent(runId)}?project_id=${encodeURIComponent(projectId)}`);
    if (projectId !== selectedProjectId || runId !== selectedRunId) return;
    if (data.run) {
      runs = runs.map((run) => run.id === runId ? { ...run, ...data.run } : run);
      if (!runs.some((run) => run.id === runId)) runs.unshift(data.run);
      renderAll();
    }
  } catch (error) {
    if (error?.name !== "AbortError") notice(`${error.message || "Run details are unavailable."} Showing the last recorded state.`, "error");
  }
  const selected = runs.find((run) => run.id === runId);
  if (active && selectedRunId === runId && !TERMINAL.has(selected?.status)) connectRunEvents(runId, changed ? -1 : streamCursor);
}

function closeStream() {
  if (stream) stream.close();
  stream = null;
  streamRunId = "";
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = 0;
}

export function applyRunEvent(run, event) {
  if (!run || !event) return run;
  if (event.node_id && PIPELINE.includes(event.node_id)) run.stage = event.node_id;
  const kind = clean(event.kind);
  if (kind === "run.paused" || kind === "run-paused") run.status = "paused";
  else if (kind === "run.quarantined" || kind === "run-quarantined") run.status = "quarantined";
  else if (kind === "approval.requested" || kind === "approval-requested") run.status = "awaiting_approval";
  else if (kind === "release.published" || kind === "publish.completed" || kind === "publish-completed") run.status = "published";
  else if (kind === "run.failed" || kind === "publish-failed") run.status = "failed";
  else if (kind === "stage.failed" || kind === "stage-failed") run.status = "retryable_failure";
  else if (kind === "run.cancelled" || kind === "run-cancelled") run.status = "cancelled";
  else if (kind === "run.completed" || kind === "run-completed") run.status = "completed";
  else if (["run.started", "run-started", "run-resumed", "stage.started", "stage-started", "stage-retry-scheduled", "publish-started", "approval-recorded"].includes(kind)) run.status = "running";
  if (["run.quarantined", "run-quarantined", "approval.requested", "approval-requested", "run.failed", "publish-failed", "stage.failed", "stage-failed"].includes(kind)) run.attention = true;
  if (["run-resumed", "run.completed", "run-completed", "release.published", "publish.completed", "publish-completed"].includes(kind)) run.attention = false;
  run.updated_at = event.timestamp || run.updated_at;
  return run;
}

function applyEventToRun(event) {
  const run = runs.find((item) => item.id === event._runId);
  if (run) applyRunEvent(run, event);
}

function receiveEvent(runId, raw) {
  let event;
  try {
    event = JSON.parse(raw.data);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  event._runId = runId;
  const sequence = Number(event.sequence);
  if (Number.isFinite(sequence) && runEvents.some((item) => item._runId === runId && Number(item.sequence) === sequence)) return;
  if (Number.isFinite(sequence)) streamCursor = Math.max(streamCursor, sequence);
  runEvents = appendBoundedEvent(runEvents, event);
  applyEventToRun(event);
  renderTimeline();
  renderRunList();
  renderRunDetail();
  renderPipeline();
  renderReleaseQueue();
  renderInspector();
  setFreshness();
  const run = runs.find((item) => item.id === runId);
  if (run && TERMINAL.has(run.status)) {
    closeStream();
    void refreshRuns({ keepSelection: true });
  }
}

function connectRunEvents(runId, after = -1) {
  closeStream();
  if (!active || !runId || typeof EventSource === "undefined") return;
  if (TERMINAL.has(runs.find((run) => run.id === runId)?.status)) return;
  streamRunId = runId;
  const cursor = Number.isFinite(Number(after)) ? Number(after) : -1;
  const query = new URLSearchParams({ project_id: selectedProjectId, after: String(cursor) });
  stream = new EventSource(`/api/ad-radar/runs/${encodeURIComponent(runId)}/events?${query}`);
  const types = new Set([...EVENT_TYPES, ...(contract?.event_kinds || [])]);
  for (const type of types) stream.addEventListener(type, (event) => receiveEvent(runId, event));
  stream.addEventListener("disconnected", () => scheduleReconnect(runId));
  stream.onopen = () => {
    reconnectAttempt = 0;
    notice("");
    setFreshness();
  };
  stream.onerror = () => scheduleReconnect(runId);
}

function scheduleReconnect(runId) {
  if (!active || runId !== selectedRunId) return;
  if (TERMINAL.has(runs.find((run) => run.id === runId)?.status)) {
    closeStream();
    return;
  }
  if (stream) stream.close();
  stream = null;
  if (reconnectTimer) return;
  const delay = Math.min(12000, 1000 * (2 ** Math.min(4, reconnectAttempt++)));
  notice("Live observations are reconnecting. Recorded run state remains available.");
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = 0;
    connectRunEvents(runId, streamCursor);
  }, delay);
}

function activatePanel(panel, { focus = false } = {}) {
  activePanel = ["timeline", "library", "runs", "control"].includes(panel) ? panel : "timeline";
  const root = $("#ad-radar");
  root.dataset.activePanel = activePanel;
  $$('[data-radar-tab]').forEach((button) => {
    const selected = button.dataset.radarTab === activePanel;
    button.classList.toggle("is-on", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  $$('[data-radar-panel]').forEach((panelNode) => {
    const selected = panelNode.dataset.radarPanel === activePanel;
    panelNode.classList.toggle("is-on", selected);
    panelNode.hidden = !selected;
  });
  if (["runs", "control"].includes(activePanel)) root.classList.remove("inspector-open");
  renderCompare();
  renderInspector();
  if (activePanel === "runs") renderRunDetail();
  if (activePanel === "control") {
    renderPipeline();
    renderReleaseQueue();
  }
}

function timelineItems() {
  return deriveTimelineItems(runs, runEvents).filter((item) => timelineFilter === "all" || item.status === timelineFilter);
}

function renderTimeline() {
  const host = $("#radar-timeline");
  const items = timelineItems();
  $("#radar-timeline-summary").textContent = items.length
    ? `${items.length} recorded observation${items.length === 1 ? "" : "s"}`
    : "No observations loaded";
  if (!items.length) {
    emptyState(host, "No observations yet", runs.length ? "This run has no public creative observations to display yet." : "Create a project-scoped run. New and changed public creative will appear here as Hermes records it.");
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = make("button", `radar-observation${item.key === selectedObservationKey ? " is-on" : ""}`);
    row.type = "button";
    row.dataset.observationKey = item.key;
    row.append(make("time", "", clock(item.timestamp)), make("span", "radar-observation-dot"), make("span", "radar-status", item.status));
    const copy = make("span", "radar-observation-copy");
    copy.append(make("strong", "", item.advertiser), make("span", "", item.summary));
    const source = item.creative?.source_ref || item.sourceId;
    copy.append(make("small", "", [item.creative?.market, source ? "Public source" : "Hermes ledger"].filter(Boolean).join(" · ")));
    const refs = make("span", "radar-observation-refs");
    refs.append(make("span", "", item.creativeId ? `Creative ${item.creativeId}` : `Run ${item.runId || "recorded"}`));
    if (item.sourceId) refs.append(make("span", "", `Source ${item.sourceId}`));
    row.append(copy, refs);
    row.addEventListener("click", () => selectObservation(item, row));
    fragment.append(row);
  }
  host.replaceChildren(fragment);
}

function currentLibraryFilters() {
  return {
    query: $("#radar-library-search")?.value || "",
    status: $("#radar-library-status")?.value || "all",
    media: $("#radar-library-media")?.value || "all",
  };
}

function renderLibrary() {
  const host = $("#radar-library");
  const creatives = filterCreatives(allCreatives(), currentLibraryFilters());
  $("#radar-library-summary").textContent = creatives.length
    ? `${creatives.length} public creative${creatives.length === 1 ? "" : "s"}`
    : "No approved public creative";
  if (!creatives.length) {
    emptyState(host, "No creative matches this view", runs.length ? "Clear a filter or wait for a sanitized public export." : "Run research first. The library never substitutes synthetic records for a missing source.");
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const creative of creatives) {
    const card = make("button", `radar-creative-card${creative.id === selectedCreativeId ? " is-on" : ""}`);
    card.type = "button";
    card.dataset.creativeId = creative.id;
    card.append(mediaNode(creative, "radar-creative-media"));
    const meta = make("span", "radar-creative-meta");
    meta.append(make("strong", "", clean(creative.advertiser) || "Public creative"));
    const media = creative.media?.[0]?.kind ? label(creative.media[0].kind) : "Media pending";
    meta.append(make("span", "", [media, creative.market, label(creative._status)].filter(Boolean).join(" · ")));
    card.append(meta);
    card.addEventListener("click", () => selectCreative(creative, card));
    fragment.append(card);
  }
  host.replaceChildren(fragment);
}

function selectObservation(item, trigger = null) {
  selectedObservationKey = item.key;
  selectedCreativeId = item.creativeId || "";
  comparisonOpen = false;
  if (item.runId && item.runId !== selectedRunId) void selectRun(item.runId);
  renderTimeline();
  renderLibrary();
  renderInspector(item);
  setInspectorOpen(true, trigger);
}

function selectCreative(creative, trigger = null) {
  selectedCreativeId = creative.id;
  selectedObservationKey = `creative:${creative.id}`;
  selectedRunId = creative._run?.id || selectedRunId;
  comparisonOpen = false;
  renderTimeline();
  renderLibrary();
  renderRunList();
  renderInspector();
  setInspectorOpen(true, trigger);
}

function evidenceSection(title, pairs) {
  const section = make("section", "radar-evidence-section");
  section.append(make("h4", "", title));
  const list = make("dl");
  for (const [term, raw] of pairs) {
    const value = clean(raw);
    if (!value) continue;
    list.append(make("dt", "", term), make("dd", "", value));
  }
  if (!list.children.length) list.append(make("dt", "", "State"), make("dd", "", "Not recorded"));
  section.append(list);
  return section;
}

function receiptSection(creative) {
  const section = make("section", "radar-evidence-section");
  section.append(make("h4", "", "Receipts and provenance"));
  const list = make("ul", "radar-receipt-list");
  const refs = [
    ...(creative.classification?.receipt_refs || []).map((ref) => ["Classification", ref]),
    ...(creative.classification?.provenance_refs || []).map((ref) => ["Provenance", ref]),
    ...(creative.lifecycle?.receipt_refs || []).map((ref) => ["Lifecycle", ref]),
  ];
  for (const [kind, ref] of refs) {
    const row = make("li");
    row.append(make("span", "", kind), make("code", "", ref));
    list.append(row);
  }
  if (!refs.length) list.append(make("li", "", "No public receipt references recorded."));
  section.append(list);
  return section;
}

function selectedCreative() {
  return allCreatives().find((item) => item.id === selectedCreativeId) || null;
}

function renderInspector(explicitItem = null) {
  if (comparisonOpen) {
    renderComparison();
    return;
  }
  const body = $("#radar-inspector-body");
  const creative = selectedCreative();
  const item = explicitItem || deriveTimelineItems(runs, runEvents).find((entry) => entry.key === selectedObservationKey);
  if (!creative && !item) {
    $("#radar-inspector-status").textContent = "Evidence inspector";
    $("#radar-inspector-title").textContent = "Select an observation";
    emptyState(body, "No observation selected", "Choose a timeline row or creative to inspect its public evidence and receipts.");
    return;
  }
  const status = item?.status || creative?._status || "recorded";
  $("#radar-inspector-status").textContent = `${label(status)}${item?.timestamp ? ` · ${clock(item.timestamp)}` : ""}`;
  $("#radar-inspector-title").textContent = clean(creative?.advertiser || item?.advertiser) || "Run activity";
  if (!creative) {
    const wrapper = make("div");
    wrapper.append(
      evidenceSection("Hermes event", [
        ["Summary", item.summary],
        ["Run", item.runId],
        ["Stage", item.event?.node_id],
        ["Recorded", item.timestamp ? dateTime(item.timestamp) : ""],
        ["Observation", item.event?.data?.observation_id],
        ["Receipt", item.event?.data?.receipt_id || item.event?.data?.receipt_ref],
      ]),
    );
    body.replaceChildren(wrapper);
    return;
  }

  const wrapper = make("div");
  wrapper.append(mediaNode(creative, "radar-inspector-media"));
  const actions = make("div", "radar-inspector-actions");
  const compare = make("button", "radar-primary", compareIds.has(creative.id) ? "Remove from compare" : "Add to compare");
  compare.type = "button";
  compare.addEventListener("click", () => toggleCompare(creative.id));
  actions.append(compare);
  const sourceUrl = safePublicUrl(creative.source_ref);
  if (sourceUrl) {
    const source = make("a", "", "Open public record");
    source.href = sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    actions.append(source);
  }
  wrapper.append(actions);
  wrapper.append(evidenceSection("Public source observation", [
    ["Source", sourceUrl ? new URL(sourceUrl).hostname : "Public source reference"],
    ["Source ref", creative.source_ref],
    ["Observation", creative.lifecycle?.observation_id],
    ["Advertiser", creative.advertiser],
    ["Market", creative.market],
    ["First seen", dateTime(creative.observed?.first_seen)],
    ["Last seen", dateTime(creative.observed?.last_seen)],
  ]));
  wrapper.append(evidenceSection("Classification", [
    ["Category", creative.category],
    ["Label", creative.classification?.label],
    ["Confidence", Number.isFinite(Number(creative.classification?.confidence)) ? `${Math.round(Number(creative.classification.confidence) * 100)}%` : ""],
    ["Headline", creative.copy?.headline],
    ["Call to action", creative.copy?.cta],
  ]));
  const media = creative.media?.[0] || {};
  wrapper.append(evidenceSection("Media QA", [
    ["Type", media.kind ? label(media.kind) : ""],
    ["Dimensions", media.width && media.height ? `${media.width} × ${media.height}` : ""],
    ["Status", media.qa_status ? label(media.qa_status) : ""],
    ["Asset ref", media.asset_ref],
  ]));
  wrapper.append(receiptSection(creative));
  body.replaceChildren(wrapper);
}

function toggleCompare(creativeId) {
  if (compareIds.has(creativeId)) compareIds.delete(creativeId);
  else if (compareIds.size < 4) compareIds.add(creativeId);
  else notice("Compare accepts up to four creatives. Remove one before adding another.");
  comparisonOpen = false;
  renderCompare();
  renderInspector();
}

function renderCompare() {
  const root = $("#ad-radar");
  const tray = $("#radar-compare");
  const visible = compareIds.size > 0 && ["timeline", "library"].includes(activePanel);
  tray.hidden = !visible;
  root.classList.toggle("has-compare", visible);
  $("#radar-compare-count").textContent = String(compareIds.size);
  const host = $("#radar-compare-items");
  const fragment = document.createDocumentFragment();
  for (const creative of allCreatives().filter((item) => compareIds.has(item.id))) {
    const item = make("div", "radar-compare-item");
    item.append(mediaNode(creative, "radar-compare-thumb"));
    const copy = make("div", "radar-compare-copy");
    copy.append(make("strong", "", clean(creative.advertiser) || "Public creative"), make("span", "", [creative.market, creative.media?.[0]?.kind].filter(Boolean).join(" · ")));
    const remove = make("button", "radar-compare-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${clean(creative.advertiser) || creative.id} from compare`);
    remove.addEventListener("click", () => toggleCompare(creative.id));
    item.append(copy, remove);
    fragment.append(item);
  }
  host.replaceChildren(fragment);
}

function renderComparison() {
  const creatives = allCreatives().filter((item) => compareIds.has(item.id));
  $("#radar-inspector-status").textContent = "Creative comparison";
  $("#radar-inspector-title").textContent = `${creatives.length} selected`;
  const body = $("#radar-inspector-body");
  const wrapper = make("div");
  for (const creative of creatives) {
    const section = make("section", "radar-evidence-section");
    section.append(make("h4", "", clean(creative.advertiser) || "Public creative"));
    section.append(mediaNode(creative, "radar-inspector-media"));
    section.append(evidenceSection("Comparison facts", [
      ["Market", creative.market],
      ["Category", creative.category],
      ["Format", creative.media?.[0]?.kind],
      ["Classification", creative.classification?.label],
      ["Last seen", dateTime(creative.observed?.last_seen)],
    ]));
    wrapper.append(section);
  }
  body.replaceChildren(wrapper);
}

function renderRunList() {
  const host = $("#radar-run-list");
  if (!runs.length) {
    emptyState(host, "No runs yet", "Start a project-scoped public creative research run from Control.");
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const row = make("button", `radar-run-row${run.id === selectedRunId ? " is-on" : ""}${LIVE.has(run.status) ? " is-live" : ""}`);
    row.type = "button";
    const dot = make("i");
    dot.setAttribute("aria-hidden", "true");
    const copy = make("span");
    copy.append(make("strong", "", clean(run.title) || "Ad Radar research"), make("span", "", `${label(run.status)} · ${label(run.stage)}`));
    row.append(dot, copy, make("time", "", dateTime(run.updated_at || run.created_at)));
    row.addEventListener("click", () => void selectRun(run.id));
    fragment.append(row);
  }
  host.replaceChildren(fragment);
}

function selectedRun() {
  return runs.find((run) => run.id === selectedRunId) || null;
}

function runActionButton(text, handler, { primary = false, disabled = false } = {}) {
  const button = make("button", primary ? "radar-primary" : "radar-quiet-button", text);
  button.type = "button";
  button.disabled = disabled;
  button.addEventListener("click", handler);
  return button;
}

function renderRunDetail() {
  const host = $("#radar-run-detail");
  const run = selectedRun();
  if (!run) {
    emptyState(host, "Select a run", "Inspect its stage, public results, usage, receipts, and attention state.");
    return;
  }
  const wrapper = make("div");
  const summary = make("header", "radar-run-summary");
  const copy = make("div");
  copy.append(make("h3", "", clean(run.title) || "Ad Radar research"), make("p", "", `${label(run.status)} · ${label(run.stage)} · settings revision ${run.settings_revision || 1}`));
  summary.append(copy, make("span", "radar-status", run.attention ? "Attention" : label(run.status)));
  wrapper.append(summary);
  const facts = make("dl", "radar-run-facts");
  for (const [term, value] of [
    ["Run", run.id], ["Project", run.project_id], ["Started", dateTime(run.created_at)], ["Updated", dateTime(run.updated_at)],
  ]) {
    const group = make("div");
    group.append(make("dt", "", term), make("dd", "", clean(value) || "Not recorded"));
    facts.append(group);
  }
  wrapper.append(facts);
  const metrics = make("dl", "radar-run-metrics");
  for (const key of ["discovered", "resolved", "captured", "normalized", "classified", "media_ready", "quarantined", "published"]) {
    const group = make("div");
    group.append(make("dt", "", label(key)), make("dd", "", String(Number(run.metrics?.[key] || 0))));
    metrics.append(group);
  }
  wrapper.append(metrics);
  const progress = make("div", "radar-run-progress");
  const fill = make("i");
  fill.style.width = `${Math.max(0, Math.min(100, Number(run.progress || 0) * 100))}%`;
  progress.append(fill);
  wrapper.append(progress);
  const events = runEvents.filter((event) => event._runId === run.id).slice(-40).reverse();
  const log = make("section", "radar-event-log");
  log.append(make("h4", "", "Durable activity"));
  if (!events.length) log.append(make("p", "radar-field-help", "No public activity events recorded in this browser session."));
  for (const event of events) {
    const row = make("div", "radar-event-row");
    row.append(make("time", "", clock(event.timestamp)), make("span", "", label(event.kind)), make("p", "", clean(event.data?.summary) || eventSummary(event)));
    log.append(row);
  }
  wrapper.append(log);
  host.replaceChildren(wrapper);
}

function renderPipeline() {
  const host = $("#radar-pipeline");
  if (!host) return;
  const nodes = contract?.pipeline?.nodes?.length ? contract.pipeline.nodes.map((node) => node.id) : PIPELINE;
  const run = selectedRun();
  const current = nodes.indexOf(run?.stage);
  const fragment = document.createDocumentFragment();
  nodes.forEach((stage, index) => {
    const item = make("li", `${index < current || run?.status === "published" ? "is-done " : ""}${index === current ? "is-current" : ""}`.trim());
    item.append(make("i"));
    const copy = make("div");
    copy.append(make("strong", "", label(stage)), make("span", "", index === current ? label(run?.status) : index < current ? "Recorded" : "Pending"));
    item.append(copy, make("span", "", `${index + 1} / ${nodes.length}`));
    fragment.append(item);
  });
  host.replaceChildren(fragment);
  renderRunActions();
}

function renderRunActions() {
  const host = $("#radar-run-actions");
  const run = selectedRun();
  host.replaceChildren();
  if (!run) {
    host.append(make("span", "radar-field-help", "Select or create a run to expose recovery actions."));
    return;
  }
  if (["running", "queued", "ready"].includes(run.status)) host.append(runActionButton("Pause run", () => void runAction("pause", { reason: "Paused from Frank Ad Radar." })));
  if (run.status === "paused") host.append(runActionButton("Resume run", () => void runAction("resume", {}), { primary: true }));
  if (["retryable_failure", "quarantined", "failed", "cancelled"].includes(run.status)) host.append(runActionButton("Retry from stage", () => void runAction("retry", { from_stage: run.stage }), { primary: true }));
  if (!host.children.length) host.append(make("span", "radar-field-help", run.approval ? "Release candidate is ready in the checksum gate." : "No recovery action is required."));
}

async function runAction(action, payload) {
  const run = selectedRun();
  if (!run) return;
  const projectId = selectedProjectId;
  notice(`${label(action)} requested…`);
  try {
    const data = await requestJSON(`/api/ad-radar/runs/${encodeURIComponent(run.id)}/${action}?project_id=${encodeURIComponent(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    if (projectId !== selectedProjectId || run.id !== selectedRunId) return;
    if (data.run) runs = runs.map((item) => item.id === run.id ? { ...item, ...data.run } : item);
    notice("");
    renderAll();
    if (!TERMINAL.has(data.run?.status)) connectRunEvents(run.id, streamCursor);
  } catch (error) {
    if (error?.name !== "AbortError") notice(`${error.message || "The action failed."} Review the run and retry.`, "error");
  }
}

async function approveRun(run) {
  if (!run?.approval) return;
  await runAction("approve", {
    reason: "Public export, QA, sanitization, and checksum reviewed in Frank.",
    expected_checksum: run.approval.expected_checksum,
    expected_settings_revision: run.approval.expected_settings_revision,
  });
}

function renderReleaseQueue() {
  const host = $("#radar-release-queue");
  const relevant = runs.filter((run) => run.approval || run.release);
  if (!relevant.length) {
    emptyState(host, "No release candidate", "Hermes will place a checksum-bound candidate here after every mandatory stage and scan passes.");
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const run of relevant) {
    const item = make("article", "radar-release-item");
    item.append(make("strong", "", clean(run.title) || "Ad Radar release"));
    if (run.release) {
      item.append(make("span", "", `Released ${dateTime(run.release.released_at)}`), make("code", "", run.release.release_hash));
    } else {
      item.append(make("span", "", run.approval.summary || "Awaiting explicit publish approval"), make("code", "", run.approval.expected_checksum));
      item.append(runActionButton("Approve publish", () => void approveRun(run), { primary: true }));
    }
    fragment.append(item);
  }
  host.replaceChildren(fragment);
}

async function submitRun(event) {
  event.preventDefault();
  const submit = $("#radar-run-submit");
  const status = $("#radar-run-form-status");
  const payload = {
    project_id: selectedProjectId,
    name: $("#radar-run-name").value,
    markets: splitList($("#radar-run-markets").value, 20),
    advertisers: splitList($("#radar-run-advertisers").value, 50),
    query_terms: splitList($("#radar-run-queries").value, 30),
    source_ids: splitList($("#radar-run-sources").value, 20),
    settings_revision: Number($("#radar-run-revision").value),
    include_surrounding: $("#radar-run-surrounding").checked,
  };
  const projectId = selectedProjectId;
  if (![payload.markets, payload.advertisers, payload.query_terms, payload.source_ids].some((items) => items.length)) {
    status.textContent = "Add a market, advertiser, query term, or source.";
    $("#radar-run-markets").focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = "Starting Hermes…";
  status.textContent = "";
  try {
    const fingerprint = JSON.stringify(payload);
    if (!pendingOperation || pendingOperation.fingerprint !== fingerprint) {
      pendingOperation = { fingerprint, id: operationId() };
    }
    payload.operation_id = pendingOperation.id;
    const data = await requestJSON("/api/ad-radar/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (projectId !== selectedProjectId) return;
    if (data.run) {
      runs = [data.run, ...runs.filter((run) => run.id !== data.run.id)];
      selectedRunId = data.run.id;
      runEvents = [];
      streamCursor = -1;
      renderAll();
      activatePanel("runs");
      connectRunEvents(data.run.id, -1);
      status.textContent = "Run accepted by Hermes.";
      pendingOperation = null;
    }
  } catch (error) {
    if (error?.name !== "AbortError") status.textContent = `${error.message || "Could not start the run."} Check the scope and retry.`;
  } finally {
    submit.disabled = false;
    submit.textContent = "Start Hermes run";
  }
}

function renderAll() {
  setFreshness();
  renderTimeline();
  renderLibrary();
  renderRunList();
  renderRunDetail();
  renderPipeline();
  renderReleaseQueue();
  renderCompare();
  renderInspector();
}

function bind() {
  $$('[data-radar-tab]').forEach((button, index, buttons) => {
    button.addEventListener("click", () => activatePanel(button.dataset.radarTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      activatePanel(buttons[next].dataset.radarTab, { focus: true });
    });
  });
  $("#radar-project").addEventListener("change", async (event) => {
    abortRequests();
    selectedProjectId = event.target.value;
    selectedRunId = "";
    selectedCreativeId = "";
    selectedObservationKey = "";
    compareIds.clear();
    runEvents = [];
    streamCursor = -1;
    closeStream();
    notice("Loading the selected project…");
    try {
      await refreshRuns({ keepSelection: false });
      notice("");
    } catch (error) {
      if (error?.name !== "AbortError") notice(`${error.message || "Project runs are unavailable."} Retry when Hermes is reachable.`, "error");
    }
  });
  $("#radar-refresh").addEventListener("click", () => void refreshAll());
  $$('[data-radar-timeline-filter]').forEach((button) => button.addEventListener("click", () => {
    timelineFilter = button.dataset.radarTimelineFilter;
    $$('[data-radar-timeline-filter]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-on", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    renderTimeline();
  }));
  $("#radar-timeline-clear").addEventListener("click", () => {
    timelineFilter = "all";
    $$('[data-radar-timeline-filter]').forEach((button) => {
      const selected = button.dataset.radarTimelineFilter === "all";
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    renderTimeline();
  });
  for (const control of [$("#radar-library-search"), $("#radar-library-status"), $("#radar-library-media")]) {
    control.addEventListener(control.tagName === "INPUT" ? "input" : "change", renderLibrary);
  }
  $("#radar-library-clear").addEventListener("click", () => {
    $("#radar-library-search").value = "";
    $("#radar-library-status").value = "all";
    $("#radar-library-media").value = "all";
    renderLibrary();
  });
  $$('[data-radar-open-control]').forEach((button) => button.addEventListener("click", () => activatePanel("control")));
  $("#radar-run-form").addEventListener("submit", submitRun);
  $("#radar-inspector-close").addEventListener("click", () => setInspectorOpen(false));
  $("#radar-compare-clear").addEventListener("click", () => {
    compareIds.clear();
    comparisonOpen = false;
    renderCompare();
    renderInspector();
  });
  $("#radar-compare-open").addEventListener("click", () => {
    comparisonOpen = true;
    renderInspector();
    setInspectorOpen(true, $("#radar-compare-open"));
  });
  $("#radar-compare-toggle").addEventListener("click", () => {
    comparisonOpen = true;
    renderInspector();
    setInspectorOpen(true, $("#radar-compare-toggle"));
  });
  document.addEventListener("keydown", (event) => {
    if (!active) return;
    trapInspectorFocus(event);
    if (event.key === "Escape" && $("#ad-radar").classList.contains("inspector-open")) setInspectorOpen(false);
  });
  window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
    const inspector = $("#radar-inspector");
    if (!$("#ad-radar").classList.contains("inspector-open")) return;
    if (inspectorIsModal()) {
      inspector.setAttribute("role", "dialog");
      inspector.setAttribute("aria-modal", "true");
      setInspectorBackgroundInert(true);
    } else {
      inspector.setAttribute("role", "complementary");
      inspector.removeAttribute("aria-modal");
      setInspectorBackgroundInert(false);
    }
  });
}

export async function mountAdRadar() {
  active = true;
  if (!mounted) {
    mounted = true;
    bind();
    activatePanel("timeline");
  }
  await refreshAll();
}

export function unmountAdRadar() {
  active = false;
  if ($("#ad-radar")?.classList.contains("inspector-open")) setInspectorOpen(false);
  closeStream();
  abortRequests();
}
