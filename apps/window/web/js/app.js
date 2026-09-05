import { mount, mountAll } from "./registry.js";
import "./widgets.js";
import { clearHomeActions, closeHomeEditors, openConnections, openEntityHome, openProjectHome, openWidgetBuilder, setupHomePlatform } from "./homes.js";
import { SseEventParser } from "./chat-stream.js";
import * as hubApi from "./chat/api.js";
import { attachmentDTO, AttachmentController, VPS_DRAG_TYPE } from "./chat/attachment-controller.js";
import { DictationController } from "./chat/dictation-controller.js";
import { ModelSelector } from "./chat/model-selector.js";
import { renderBlockingInput, TurnStreamController, TURN_STATES } from "./chat/turn-stream.js";
import { escapeHtml, fmtDate, fmtSize, fmtTime, renderMd, safeUrl } from "./chat/render.js";
import { mountAdStudio } from "./ad-studio.js?v=20260905-ready-review-v1";
import { adStudioBriefValidation } from "./ad-studio-brief.js?v=20260904-brief-roundtrip-v1";
import { pathForView, viewForPath } from "./view-routing.js?v=20260830-ad-studio-route-v1";
import { mountLive } from "./live.js?v=20260830-step5";
import { mountMap } from "./map.js?v=20260830-step5";
import { mountControl } from "./control.js?v=20260830-step5";

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const TITLES = {
  hub: ["Hub", ""],
  project: ["Project", ""],
  files: ["Files", ""],
  tools: ["Tools", "Start a factory, watch its trace"],
  "ad-studio": ["Ad Studio", "Source image → ad template"],
  "entity-home": ["Home", "Live, capability-aware widgets"],
  "widget-builder": ["Widget Builder", "Reusable widgets for every Frank home"],
  connections: ["Connections", "Recorded provider setup and capabilities"],
  accounts: ["Accounts", "Customer directory; provider actions connect through Hermes later"],
  trace: ["Trace", "One run, fully visible"],
  releases: ["Releases", "Signed and verified"],
  live: ["Live", "Pinned AgentTrail activity"],
  map: ["Map", "Validated Archify projections"],
  control: ["Control", "Evidence-backed read-only records"],
};

let projects = { projects: [] };

function syncViewLocation(id) {
  const target = pathForView(id);
  if (window.location.pathname !== target) window.history.pushState({ view: id }, "", target);
}

function show(id, { syncHistory = true } = {}) {
  const editorWasOpen = closeHomeEditors({ restoreFocus: false });
  if (id !== "project" && id !== "entity-home") clearHomeActions();
  const [title, sub] = TITLES[id] || TITLES.hub;
  $("#view-title").textContent = id === "project" ? currentProject.name : title;
  $("#view-sub").textContent = id === "hub"
    ? (chatSessions.find((chat) => chat.id === currentChatId)?.title || "")
    : sub;
  const railView = ["accounts", "entity-home", "widget-builder", "connections"].includes(id) ? "tools" : id;
  $$(".rail-item[data-view]").forEach((b) => b.classList.toggle("is-on", b.dataset.view === railView));
  $$(".rail-item[data-project]").forEach((b) => b.classList.toggle("is-on", false));
  $$(".view[data-view]").forEach((v) => v.classList.toggle("is-on", v.dataset.view === id));
  if (id === "project") $$(".rail-item[data-project]").forEach((b) => b.classList.toggle("is-on", b.dataset.project === currentProject.id));
  if (syncHistory) syncViewLocation(id);
  $$(".operate-tab").forEach((button) => button.classList.toggle("is-on", button.dataset.view === id));
  if (id === "live") void mountLive($("#operate-live"));
  if (id === "map") void mountMap($("#operate-map"));
  if (id === "control") void mountControl($("#operate-control"));
  if (editorWasOpen) $("#view-title")?.focus({ preventScroll: true });
}

let currentProject = { id: "blockwise", name: "Blockwise" };

function renderProjectNav() {
  const nav = $("#project-nav");
  if (!nav) return;
  nav.replaceChildren();
  for (const project of projects.projects || []) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "rail-item";
    control.dataset.project = project.id;
    control.setAttribute("aria-label", project.name || project.id);
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.dataset.status = project.setup_state || "starting";
    const label = document.createElement("span");
    label.textContent = project.name || project.id;
    control.append(dot, label);
    control.addEventListener("click", () => showProject(project.id));
    nav.append(control);
  }
}

function showProject(id) {
  currentProject = projects.projects.find((x) => x.id === id) || { id, name: id };
  show("project");
  openProjectHome(currentProject);
}

$$(`.operate-tab[data-view]`).forEach((button) => button.addEventListener("click", () => show(button.dataset.view)));

$$(".rail-item[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    const v = b.dataset.view;
    if (v === "files") { show(v); explorerFocus(); }
    else if (v === "hub") {
      show(v);
      $("#view-sub").textContent = chatSessions.find((chat) => chat.id === currentChatId)?.title || "";
      chatScrollBottom();
    }
    else if (v === "ad-studio") { show(v); mountAdStudio(); }
    else { show(v); if (v === "tools") mountAll("tools", $("#slot-tools"), {}); if (v === "trace") mountAll("trace", $("#slot-trace"), {}); if (v === "releases") mountAll("releases", $("#slot-releases"), {}); }
  })
);

$$(".chip").forEach((c) => {
  c.addEventListener("click", () => {
    const id = c.dataset.slide;
    const open = c.classList.contains("is-on");
    $$(".chip").forEach((x) => x.classList.remove("is-on"));
    $$(".slide").forEach((s) => s.classList.remove("is-on"));
    if (open) return;
    c.classList.add("is-on");
    const sl = $("#slide-" + id);
    if (!sl) return;
    sl.classList.add("is-on");
    const slot = sl.querySelector("[data-widget]");
    if (slot) mount(slot.dataset.widget, slot, {});
  });
});

window.addEventListener("frank:view", (event) => {
  if (event.detail === "accounts") {
    show("accounts");
    loadAccounts();
  } else if (event.detail === "connections") {
    show("connections");
    openConnections();
  }
});

window.addEventListener("frank:entity-home", (event) => {
  const entity = event.detail || {};
  if (!entity.kind || !entity.id) return;
  show("entity-home");
  $("#view-title").textContent = entity.name || entity.id;
  openEntityHome(entity);
});

window.addEventListener("frank:widget-builder", () => {
  show("widget-builder");
  openWidgetBuilder();
});

window.addEventListener("frank:ad-studio", () => {
  show("ad-studio");
  mountAdStudio();
});

function openPathView() {
  const id = viewForPath(window.location.pathname);
  show(id, { syncHistory: false });
  if (id === "ad-studio") mountAdStudio();
  const canonicalPath = pathForView(id);
  if (window.location.pathname !== canonicalPath) window.history.replaceState({ view: id }, "", `${canonicalPath}${window.location.search}`);
}
window.addEventListener("popstate", openPathView);

window.addEventListener("frank:connections", (event) => {
  show("connections");
  openConnections(event.detail || {});
});

window.addEventListener("frank:open-chat-session", async (event) => {
  const sessionId = event.detail?.id;
  if (!sessionId) return;
  show("hub");
  await selectChat(sessionId);
  $("#chat-input")?.focus();
});

window.addEventListener("frank:new-project-chat", (event) => {
  const projectId = String(event.detail?.project_id || "");
  void createChat(projectId).catch((error) => addChatMsg({ role: "sys", text: error.message || "Could not start a project chat.", ts: Date.now() / 1000 | 0 }));
});

window.addEventListener("frank:ad-studio-run", (event) => {
  const detail = event.detail || {};
  void (async () => {
    const sources = Array.isArray(detail.sources) ? detail.sources : [];
    const localSources = sources.filter((source) => source?.kind === "local" && source.file instanceof File);
    const projectId = String(detail.projectId || "").trim();
    const brief = typeof detail.brief === "string" ? detail.brief : "";
    const settled = new Set();
    const progress = (source, status, options = {}) => {
      if (["started", "error"].includes(status)) settled.add(source.key);
      detail.onProgress?.({ key: source.key, name: source.name, status, ...options });
    };
    try {
      if (localSources.length < 1 || localSources.length > 20 || localSources.length !== sources.length) {
        throw new Error("Choose between 1 and 20 source images from this device.");
      }
      if (!projectId) throw new Error("Choose a project.");
      const briefValidation = adStudioBriefValidation(brief);
      if (!briefValidation.valid) throw new Error(briefValidation.message);
      const fallbackName = String(localSources[0]?.name || "source image").replace(/\.[^.]+$/, "");
      const jobName = String(detail.name || fallbackName).replace(/\s+/g, " ").trim().slice(0, 60);
      localSources.forEach((source) => progress(source, "uploading"));
      const uploaded = await hubApi.uploadFiles(localSources.map((source) => ({ file: source.file, path: source.file.name })));
      if (uploaded.length !== localSources.length) throw new Error("One or more source images were not accepted.");
      localSources.forEach((source) => progress(source, "starting"));
      const response = await fetch("/api/ad-studio/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: jobName,
          brief,
          attachments: uploaded.map(attachmentPayload),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(data.results)) {
        const message = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(message || "Hermes did not start the background jobs.");
      }
      const runs = Array.isArray(data.runs) ? data.runs.filter((run) => run?.id) : (data.run?.id ? [data.run] : []);
      const orderedResults = Array.isArray(data.results) ? data.results : [];
      const failures = [];
      const usedRuns = new Set();
      localSources.forEach((source, index) => {
        const result = orderedResults[index] || {};
        const accepted = result.status === "accepted";
        const run = result.run?.id ? result.run : ((accepted || !orderedResults.length) ? runs.find((item) => !usedRuns.has(item.id)) : null);
        if (run?.id) {
          usedRuns.add(run.id);
          progress(source, "started", { run });
          return;
        }
        const errorCode = String(result.error?.code || "");
        const error = ({
          source_missing: "This image is no longer available. Add it again.",
          empty_file: "This image is empty. Choose another file.",
          unsupported_type: "This file is not a supported image.",
          type_mismatch: "This file is not a supported image.",
          invalid_image: "This file does not appear to be a valid image.",
          file_too_large: "This image is too large.",
          batch_too_large: "These images are too large to start together.",
          hermes_rejected: "This image could not be started. Try again.",
          hermes_unavailable: "This image could not be started just now. Try again.",
          invalid_hermes_response: "This image could not be started. Try again.",
        })[errorCode] || (String(result.error?.message || result.error || "").startsWith("[object") ? "" : String(result.error?.message || result.error || "")) || "This image could not be started. Try again.";
        failures.push({ name: source.name, error });
        progress(source, "error", { error });
      });
      if (!runs.length && !failures.length) throw new Error(data.error || "Hermes did not start the background jobs.");
      detail.resolve?.({ run: runs[0], runs, failures, results: orderedResults, batchId: data.batch_id });
    } catch (error) {
      localSources.filter((source) => !settled.has(source.key)).forEach((source) => progress(source, "error", { error: error.message || "This image could not be started." }));
      detail.reject?.(error);
    }
  })();
});

/* ---------------- chat — window only, Hermes thinks ---------------- */

let chatSessions = [];
let currentChatId = localStorage.getItem("frank.chat") || "";
let chatPinnedToBottom = true;
let loadedChatVersion = "";
let turnQueue = Promise.resolve();
let turnStream = null;
let attachments = null;
let modelSelector = null;
let dictation = null;
let lastTurn = null;

function chatVersion(chat) {
  return chat ? `${chat.id}:${chat.updated_at || 0}:${chat.message_count || 0}` : "";
}
function typeLabel(e) {
  if (e.dir) return "File folder";
  if (!e.ext) return "File";
  return e.ext.toUpperCase() + " File";
}
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3-1-6Z"/></svg>';

function chatDate(sec) {
  if (!sec) return "";
  const then = new Date(sec * 1000);
  const now = new Date();
  if (then.toDateString() === now.toDateString()) return fmtTime(sec);
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(then);
}
function renderChatNav() {
  const nav = $("#chat-nav");
  nav.innerHTML = chatSessions.map((chat) => {
    const project = projects.projects.find((item) => item.id === chat.project_id);
    return `
    <button type="button" class="chat-nav-item ${chat.id === currentChatId ? "is-on" : ""}" data-chat-id="${escapeHtml(chat.id)}" title="${escapeHtml(chat.title || "New chat")}">
      <span class="chat-nav-copy"><strong>${escapeHtml(chat.title || "New chat")}</strong><small>${project ? `<em>${escapeHtml(project.name)}</em> · ` : ""}${escapeHtml(chat.preview || "No messages yet")}</small></span>
      <time>${chatDate(chat.updated_at)}</time>
    </button>`;
  }).join("");
  $$(".chat-nav-item", nav).forEach((button) => button.addEventListener("click", () => {
    if (turnStream?.active) return;
    void selectChat(button.dataset.chatId);
  }));
}
async function fetchChatSessions() {
  chatSessions = await hubApi.fetchSessions();
  renderChatNav();
  return chatSessions;
}
async function loadChatMessages(chatId) {
  const wrap = $("#chat-msgs");
  const empty = $("#chat-empty");
  wrap.innerHTML = "";
  empty.classList.remove("is-hidden");
  const data = await hubApi.fetchHistory(chatId);
  for (const message of data.messages) addChatMsg(message);
  if (!data.messages.length) empty.classList.remove("is-hidden");
  loadedChatVersion = chatVersion(chatSessions.find((chat) => chat.id === chatId));
  chatPinnedToBottom = true;
  chatScrollBottom(true);
}
async function selectChat(chatId, { navigate = true } = {}) {
  if (!chatId) return;
  const switchingChats = chatId !== currentChatId;
  if (switchingChats && attachments?.items.length) void attachments.remove(attachments.items.slice());
  currentChatId = chatId;
  localStorage.setItem("frank.chat", chatId);
  renderChatNav();
  const selected = chatSessions.find((chat) => chat.id === chatId);
  modelSelector?.applySession(selected);
  modelSelector && (modelSelector.activeChatId = chatId);
  if (navigate) show("hub");
  await loadChatMessages(chatId);
}
async function createChat(projectId = "", title = "New chat") {
  if (turnStream?.active) return;
  await modelSelector?.pendingRequest?.catch(() => {});
  const data = await hubApi.createSession({
    title,
    model: modelSelector?.current.model || "",
    provider: modelSelector?.current.provider || "",
    projectId,
  });
  await fetchChatSessions();
  await selectChat(data.session.id);
  $("#chat-input").focus();
  return data.session;
}

function slugifyProject(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function setupProjects() {
  const dialog = $("#new-project-dialog");
  const form = $("#new-project-form");
  const name = $("#project-name");
  const id = $("#project-id");
  let idEdited = false;
  const close = () => { if (dialog.open) dialog.close(); };
  $("#new-project")?.addEventListener("click", () => {
    form.reset();
    idEdited = false;
    $("#new-project-error").textContent = "";
    dialog.showModal();
    name.focus();
  });
  $("#new-project-close")?.addEventListener("click", close);
  $("#new-project-cancel")?.addEventListener("click", close);
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  id?.addEventListener("input", () => { idEdited = Boolean(id.value); });
  name?.addEventListener("input", () => { if (!idEdited) id.value = slugifyProject(name.value); });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("#new-project-submit");
    const error = $("#new-project-error");
    submit.disabled = true;
    submit.textContent = "Connecting Hermes…";
    error.textContent = "";
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.value,
          id: id.value,
          blurb: $("#project-blurb").value,
          repository_url: $("#project-repository").value,
          live: $("#project-live").value,
          model: modelSelector?.current.model || "",
          provider: modelSelector?.current.provider || "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Could not create this project");
      close();
      await fetchProjects();
      await fetchChatSessions();
      await selectChat(data.session.id);
      if (data.bootstrap_prompt) await enqueueTurn(data.bootstrap_prompt, []);
    } catch (reason) {
      error.textContent = reason.message || "Could not create this project.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Create project";
    }
  });
}

async function fetchProjects() {
  const response = await fetch("/api/projects");
  if (!response.ok) throw new Error("Could not load projects");
  projects = await response.json();
  renderProjectNav();
  renderChatNav();
  return projects.projects;
}

async function refreshChatSessions(reloadCurrent = false) {
  try {
    await fetchChatSessions();
    const selected = chatSessions.find((chat) => chat.id === currentChatId);
    if (selected) {
      $("#view-sub").textContent = selected.title || "";
      if (reloadCurrent && !turnStream?.active && chatVersion(selected) !== loadedChatVersion) {
        await loadChatMessages(selected.id);
      }
    }
  } catch { /* the active chat remains usable */ }
}

function chatScrollBottom(force = false) {
  const sc = $("#chat-scroll");
  if (sc && (force || chatPinnedToBottom)) sc.scrollTop = sc.scrollHeight;
}
function attachmentChip(a) {
  const url = safeUrl(a.url || "");
  const image = String(a.type || "").startsWith("image/");
  if (image && url) {
    const name = escapeHtml(a.name || "Image");
    return `<span class="att-image-message">
      <button type="button" data-preview-url="${escapeHtml(url)}" aria-label="Preview ${name}" title="Open image preview"><img src="${escapeHtml(url)}" alt="${name}" loading="lazy"></button>
      <a href="${escapeHtml(url)}?download=1" aria-label="Download ${name}" title="Download image">↓</a>
    </span>`;
  }
  const label = `${escapeHtml(a.relative_path || a.name)} <em>${fmtSize(a.size)}</em>`;
  if (!url) return `<span class="att-chip">${label}</span>`;
  return `<span class="att-chip linked"><button type="button" ${image ? `data-preview-url="${escapeHtml(url)}"` : `data-open-url="${escapeHtml(url)}"`}>${label}</button><a href="${escapeHtml(url)}?download=1" aria-label="Download ${escapeHtml(a.name)}" title="Download">↓</a></span>`;
}
function chatBubble(m) {
  const atts = (m.attachments || []).map(attachmentChip).join("");
  const text = m.text ? (m.role === "user" ? `<p>${escapeHtml(m.text).replace(/\n/g, "<br>")}</p>` : `<div class="md">${renderMd(m.text)}</div>`) : "";
  const tools = (m.tools || []).map((t) => `<div class="tool-line">${escapeHtml(t)}</div>`).join("");
  return `<div class="msg msg-${m.role === "user" ? "user" : m.role === "sys" ? "sys" : "hub"}${m.error ? " is-error" : ""}">
    <div class="bub">${text}${tools}${atts ? `<div class="atts">${atts}</div>` : ""}<span class="when">${fmtTime(m.ts)}</span>${m.role !== "user" && m.text ? `<div class="msg-actions"><button type="button" data-copy-message>Copy response</button></div>` : ""}</div>
  </div>`;
}
function addChatMsg(m) {
  const wrap = $("#chat-msgs");
  wrap.insertAdjacentHTML("beforeend", chatBubble(m));
  $("#chat-empty").classList.add("is-hidden");
  chatScrollBottom();
  return wrap.lastElementChild;
}
function setBusy(on) {
  $("#send").classList.toggle("is-hidden", on);
  $("#stop").classList.toggle("is-hidden", !on);
  $("#chat-nav").classList.toggle("is-busy", on);
  $("#new-chat").disabled = on;
}
function notify(text, error = false) {
  addChatMsg({ role: "sys", text, error, ts: Date.now() / 1000 | 0 });
}
const TERMINAL_STATES = new Set([TURN_STATES.COMPLETE, TURN_STATES.CANCELLED, TURN_STATES.FAILED]);

/* Ad Studio run payloads carry only server-side attachment fields. */
function attachmentPayload(attachment) {
  const { status, previewUrl, upload, uploadError, batchKey, discarded, file, ...payload } = attachment;
  return payload;
}

function enqueueTurn(text, atts) {
  turnQueue = turnQueue.catch(() => {}).then(() => sendTurn(text, atts));
  return turnQueue;
}

function offerRetry(bubble, text, turnAttachments) {
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => {
    actions.remove();
    enqueueTurn(text, turnAttachments);
  });
  actions.append(retry);
  bubble.append(actions);
}

async function sendTurn(text, atts) {
  if (!currentChatId) await createChat();
  await modelSelector?.pendingRequest?.catch(() => {});
  const turnChatId = currentChatId;
  const turnAttachments = (atts || []).map(attachmentDTO);
  chatPinnedToBottom = true;
  addChatMsg({ role: "user", text, attachments: atts, model: modelSelector?.current.model || "", ts: Date.now() / 1000 | 0 });
  const controller = new TurnStreamController({});
  controller.mount($("#chat-msgs"));
  $("#chat-empty").classList.add("is-hidden");
  controller.onScroll = chatScrollBottom;
  controller.onStateChange = (state) => setBusy(!TERMINAL_STATES.has(state));
  controller.onBlocking = (descriptor) => {
    const form = renderBlockingInput({
      descriptor,
      onSubmit: async (payload, formEl) => {
        try {
          await hubApi.respondInput({
            chatId: turnChatId,
            runId: controller.runId,
            requestId: payload.requestId,
            kind: payload.kind,
            value: payload.value,
          });
          const question = formEl.querySelector(".input-question");
          if (question) question.textContent = "Response sent.";
          formEl.classList.add("is-sent");
        } catch (error) {
          const question = formEl.querySelector(".input-question");
          if (question) question.textContent = error.message || "The response was not accepted.";
        }
      },
      onCancel: (payload, formEl) => { formEl.remove(); },
    });
    controller.bubble.append(form);
  };
  turnStream = controller;
  setBusy(true);
  let finalState = await controller.run({
    chatId: turnChatId,
    text,
    attachments: turnAttachments,
    turnId: hubApi.newTurnId(),
    model: modelSelector?.current.model || "",
    provider: modelSelector?.current.provider || "",
  });
  if (finalState === TURN_STATES.INTERRUPTED) finalState = await controller.reconcile();
  if (controller === turnStream) turnStream = null;
  setBusy(false);
  if (finalState === TURN_STATES.FAILED || finalState === TURN_STATES.CANCELLED) {
    lastTurn = { text, attachments: turnAttachments };
    offerRetry(controller.bubble, text, turnAttachments);
  } else {
    lastTurn = null;
  }
  chatScrollBottom();
  void refreshChatSessions(true);
  return finalState;
}

function setupChatActions() {
  const viewer = $("#media-viewer");
  const closeViewer = () => { viewer.hidden = true; $("#media-stage").innerHTML = ""; };
  document.addEventListener("click", async (event) => {
    const copyCode = event.target.closest("[data-copy-code]");
    if (copyCode) {
      const code = copyCode.closest(".code-block")?.querySelector("code")?.textContent || "";
      await navigator.clipboard.writeText(code);
      copyCode.textContent = "Copied";
      setTimeout(() => { copyCode.textContent = "Copy"; }, 1500);
      return;
    }
    const copyMessage = event.target.closest("[data-copy-message]");
    if (copyMessage) {
      const text = copyMessage.closest(".bub")?.querySelector(":scope > .md")?.innerText || "";
      await navigator.clipboard.writeText(text);
      copyMessage.textContent = "Copied";
      setTimeout(() => { copyMessage.textContent = "Copy response"; }, 1500);
      return;
    }
    const preview = event.target.closest("[data-preview-url]");
    if (preview) {
      const url = preview.dataset.previewUrl;
      $("#media-open").href = url;
      $("#media-stage").innerHTML = `<img src="${escapeHtml(url)}" alt="Preview">`;
      viewer.hidden = false;
      return;
    }
    const open = event.target.closest("[data-open-url]");
    if (open) window.open(open.dataset.openUrl, "_blank", "noopener,noreferrer");
  });
  $("#media-close").addEventListener("click", closeViewer);
  viewer.addEventListener("click", (event) => { if (event.target === viewer) closeViewer(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !viewer.hidden) closeViewer(); });
}

function setupChat() {
  setupChatActions();
  const bar = $("#bar");
  const input = $("#chat-input");
  const mic = $("#mic");
  const composer = $("#chat-composer");
  const chatScroll = $("#chat-scroll");

  attachments = new AttachmentController({
    row: $("#att-row"),
    fileInput: $("#file-input"),
    folderInput: $("#folder-input"),
    composer,
    onNotice: (text) => notify(text),
    onVpsEntry: (entry) => { void attachExplorerEntry(entry); },
    canAccept: () => $(".view[data-view=hub]").classList.contains("is-on"),
  });
  attachments.mount();

  modelSelector = new ModelSelector({
    button: $("#model-btn"),
    name: $("#model-name"),
    menu: $("#model-menu"),
  });
  modelSelector.mount({ onNotice: (text) => notify(text) });

  dictation = new DictationController({
    button: mic,
    onTranscript: (text) => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      const cursor = start + text.length;
      input.setSelectionRange(cursor, cursor);
      input.dispatchEvent(new Event("input"));
      input.focus();
    },
    onNotice: (text) => notify(text),
  });
  mic.addEventListener("click", () => dictation.toggle());

  $("#new-chat").addEventListener("click", () => {
    void createChat().catch((error) => notify(error.message || "Could not start a new chat.", true));
  });

  chatScroll.addEventListener("scroll", () => {
    chatPinnedToBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 72;
  }, { passive: true });

  const grow = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  };
  input.addEventListener("input", grow);

  const attachMenu = $("#attach-menu");
  $("#attach").addEventListener("click", (event) => { event.stopPropagation(); attachMenu.classList.toggle("is-open"); });
  document.addEventListener("click", (event) => { if (!event.target.closest("#attach-pick")) attachMenu.classList.remove("is-open"); });
  $("#pick-files").addEventListener("click", () => { attachMenu.classList.remove("is-open"); $("#file-input").click(); });
  $("#pick-folder").addEventListener("click", () => { attachMenu.classList.remove("is-open"); $("#folder-input").click(); });

  let preparingTurn = false;
  bar.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (preparingTurn || turnStream?.active) return;
    const text = input.value.trim();
    if (!text && !attachments.items.length) return;
    const selected = attachments.items.slice();
    preparingTurn = true;
    bar.classList.add("is-preparing");
    $("#send").disabled = true;
    try {
      const waits = [...new Set(selected.map((attachment) => attachment.upload).filter(Boolean))];
      await Promise.allSettled(waits);
      const ready = selected.filter((attachment) => attachment.status === "ready" && !attachment.discarded);
      if (!text && !ready.length) {
        if (selected.some((attachment) => attachment.status === "error")) {
          notify("A failed attachment was not sent. Remove it or upload it again.");
        }
        return;
      }
      const readyItems = attachments.takeReady().filter((attachment) => ready.includes(attachment));
      input.value = "";
      grow();
      enqueueTurn(text, readyItems);
    } finally {
      preparingTurn = false;
      bar.classList.remove("is-preparing");
      $("#send").disabled = false;
      input.focus();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      bar.requestSubmit();
    } else if (e.key === "Escape" && dictation?.state === "recording") {
      e.preventDefault();
      void dictation.cancel();
    }
  });
  $("#stop").addEventListener("click", () => { void turnStream?.stop(); });

  fetchChatSessions().then(async (sessions) => {
    const selected = sessions.find((chat) => chat.id === currentChatId) || sessions[0];
    if (selected) await selectChat(selected.id, { navigate: false });
  }).catch(() => {
    notify("Chats could not be loaded.", true);
  });
  window.setInterval(() => {
    if (!turnStream?.active) void refreshChatSessions(true);
  }, 5000);
}

/* ---------------- files explorer (Windows-style) ---------------- */

const TEXT_EXTS = new Set(["md", "txt", "json", "py", "js", "ts", "tsx", "jsx", "css", "html", "svg", "yaml", "yml", "toml", "csv", "log", "sh", "env", "sql", "xml"]);
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);

const EXPLORER_PINS_KEY = "frank.explorer.pins.v1";

function loadExplorerPins() {
  try {
    const value = JSON.parse(localStorage.getItem(EXPLORER_PINS_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((item) => item && typeof item.path === "string" && typeof item.name === "string")
      : [];
  } catch {
    return [];
  }
}

const exp = {
  root: "vps",
  path: "",
  back: [],
  fwd: [],
  sort: "name",
  dir: 1,
  entries: [],
  selected: null,
  treeOpen: new Map(),
  treeKids: new Map(),
  treeLoading: new Set(),
  pins: loadExplorerPins(),
};

async function api(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function saveExplorerPins() {
  localStorage.setItem(EXPLORER_PINS_KEY, JSON.stringify(exp.pins));
}

function isPinned(path) {
  return exp.pins.some((item) => item.path === path);
}

function togglePin(entry) {
  if (!entry) return;
  if (isPinned(entry.path)) {
    exp.pins = exp.pins.filter((item) => item.path !== entry.path);
  } else {
    exp.pins.push({
      name: entry.name,
      path: entry.path,
      dir: Boolean(entry.dir),
      ext: entry.ext || null,
      size: entry.size ?? null,
      mtime: entry.mtime || 0,
    });
  }
  saveExplorerPins();
  renderTree();
  renderList();
}

function explorerFocus() {
  renderTree();
  loadList();
  $("#exp-list-w")?.focus();
}

async function loadList() {
  const list = $("#exp-rows");
  list.innerHTML = `<div class="exp-none">Loading…</div>`;
  let data;
  try {
    data = await api(`/api/tree?root=${encodeURIComponent(exp.root)}&path=${encodeURIComponent(exp.path)}`);
  } catch {
    list.innerHTML = `<div class="exp-none">Could not read this folder.</div>`;
    return;
  }
  if (data.missing) {
    list.innerHTML = `<div class="exp-none">Folder not on the box yet.</div>`;
    $("#exp-status").textContent = "";
    renderCrumbs();
    return;
  }
  exp.entries = data.entries || [];
  exp.treeKids.set(exp.path, exp.entries.filter((entry) => entry.dir));
  exp.selected = exp.entries.find((entry) => entry.path === exp.selected?.path) || null;
  renderList();
  renderCrumbs();
  renderTree();
}

function sortedEntries() {
  const q = $("#exp-search").value.trim().toLowerCase();
  let list = exp.entries;
  if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
  const [k, d] = [exp.sort, exp.dir];
  const cmp = (a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let r = 0;
    if (k === "name") r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    else if (k === "mtime") r = (a.mtime || 0) - (b.mtime || 0);
    else if (k === "type") r = typeLabel(a).localeCompare(typeLabel(b)) || a.name.localeCompare(b.name);
    else if (k === "size") r = (a.size || 0) - (b.size || 0);
    return r * d;
  };
  return list.slice().sort(cmp);
}

function selectEntry(e) {
  exp.selected = e;
  $$(".exp-row").forEach((r) => r.classList.toggle("is-sel", r.dataset.path === (e ? e.path : "")));
  renderStatus();
}

function renderList() {
  const list = $("#exp-rows");
  const rows = sortedEntries();
  const selPath = exp.selected ? exp.selected.path : null;
  if (!rows.length) {
    list.innerHTML = `<div class="exp-none">${$("#exp-search").value ? "No matches." : "This folder is empty."}</div>`;
  } else {
    list.innerHTML = rows.map((e) =>
      `<div class="exp-row ${e.dir ? "is-dir" : ""} ${selPath === e.path ? "is-sel" : ""}" data-path="${escapeHtml(e.path)}" data-dir="${e.dir ? 1 : 0}" tabindex="-1">
        <span class="c-name"><span class="ico">${e.dir ? ICON_FOLDER : ICON_FILE}</span><span class="nm">${escapeHtml(e.name)}</span></span>
        <span class="c-mtime">${fmtDate(e.mtime)}</span>
        <span class="c-type">${typeLabel(e)}</span>
        <span class="c-size">${e.dir ? "" : fmtSize(e.size)}</span>
        <button type="button" class="exp-pin ${isPinned(e.path) ? "is-on" : ""}" aria-label="${isPinned(e.path) ? "Unpin" : "Pin"} ${escapeHtml(e.name)}" aria-pressed="${isPinned(e.path)}" title="${isPinned(e.path) ? "Unpin" : "Pin"}">${ICON_PIN}</button>
      </div>`).join("");
  }
  $$(".exp-row", list).forEach((row) => {
    const path = row.dataset.path;
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      const e = exp.entries.find((item) => item.path === path);
      if (!e) return;
      /* Contracted typed payload: identity only, never a display string. */
      event.dataTransfer.setData(VPS_DRAG_TYPE, JSON.stringify({ root: exp.root, path: e.path, kind: e.dir ? "folder" : "file", name: e.name }));
      event.dataTransfer.effectAllowed = "copy";
    });
    row.querySelector(".exp-pin")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const entry = exp.entries.find((item) => item.path === path);
      if (entry) togglePin(entry);
    });
    row.addEventListener("click", () => {
      const e = exp.entries.find((x) => x.path === path);
      if (e) selectEntry(e);
    });
    row.addEventListener("dblclick", () => {
      const e = exp.entries.find((x) => x.path === path);
      if (e && e.dir) navigate(path);
      else if (e) openFilePreview(e);
    });
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const e = exp.entries.find((x) => x.path === path);
      if (e) selectEntry(e);
      openCtx(ev.clientX, ev.clientY);
    });
  });
  renderStatus();
}

function renderStatus() {
  const q = $("#exp-search").value.trim().toLowerCase();
  const shown = q ? exp.entries.filter((e) => e.name.toLowerCase().includes(q)).length : exp.entries.length;
  const sel = exp.selected;
  const st = $("#exp-status");
  const count = `${shown} item${shown === 1 ? "" : "s"}`;
  const selected = sel ? ` · ${sel.name}` : "";
  st.textContent = `${count}${selected} · Connected to VPS`;
}

function rootName() {
  return "VPS";
}

function renderCrumbs() {
  const c = $("#exp-crumbs");
  const segs = exp.path ? exp.path.split("/") : [];
  let html = `<button class="crumb" data-p="">${escapeHtml(rootName())}</button>`;
  let acc = "";
  segs.forEach((s) => {
    acc = acc ? acc + "/" + s : s;
    html += `<span class="crumb-sep">›</span><button class="crumb" data-p="${escapeHtml(acc)}">${escapeHtml(s)}</button>`;
  });
  c.innerHTML = html;
  $$(".crumb", c).forEach((b) => b.addEventListener("click", () => navigate(b.dataset.p)));
}

function navigate(path) {
  if (path === exp.path) return;
  exp.back.push(exp.path);
  exp.fwd = [];
  exp.selected = null;
  exp.path = path;
  $("#exp-search").value = "";
  revealTreePath(path);
  loadList();
  syncNav();
  renderTree();
}

function revealTreePath(path) {
  const segments = path.split("/").filter(Boolean);
  let current = "";
  segments.slice(0, -1).forEach((segment) => {
    current = current ? `${current}/${segment}` : segment;
    exp.treeOpen.set(current, true);
    if (!exp.treeKids.has(current)) void loadTreeKids(current);
  });
}

function syncNav() {
  $("#exp-back").disabled = !exp.back.length;
  $("#exp-fwd").disabled = !exp.fwd.length;
  $("#exp-up").disabled = !exp.path;
}

function renderTree() {
  const tree = $("#exp-tree");
  const pinned = exp.pins.length
    ? exp.pins.map((item) => `<div class="pin-tree-row" data-path="${escapeHtml(item.path)}">
        <button type="button" class="pin-tree-open" title="Open ${escapeHtml(item.name)}"><span class="ico">${item.dir ? ICON_FOLDER : ICON_FILE}</span><span>${escapeHtml(item.name)}</span></button>
        <button type="button" class="pin-tree-remove" aria-label="Unpin ${escapeHtml(item.name)}" title="Unpin">${ICON_PIN}</button>
      </div>`).join("")
    : `<div class="tree-empty">Pin files or folders for quick access.</div>`;
  const rootKids = exp.treeKids.get("") || [];
  tree.innerHTML = `<div class="tree-caption">Pinned</div><div class="tree-pinned">${pinned}</div>
    <div class="tree-caption tree-caption-vps">VPS</div>
    <div class="tree-root">
      <button type="button" class="tree-row ${!exp.path ? "is-sel" : ""}" data-path="">
        <span class="tw"><span class="cheve is-open">${ICON_CHEV}</span><span class="ico">${ICON_FOLDER}</span><span>/</span></span>
      </button>
    </div><div class="tree-branch" data-path="">${rootKids.map((item) => treeNode(item)).join("")}</div>`;

  $$(".pin-tree-row", tree).forEach((row) => {
    const item = exp.pins.find((pin) => pin.path === row.dataset.path);
    row.querySelector(".pin-tree-open")?.addEventListener("click", () => {
      if (!item) return;
      if (item.dir) navigate(item.path);
      else { selectEntry(item); openFilePreview(item); }
    });
    row.querySelector(".pin-tree-remove")?.addEventListener("click", () => togglePin(item));
  });
  $$(".tree-row", tree).forEach((row) => wireTreeRow(row));
  if (!exp.treeKids.has("")) void loadTreeKids("");
}

function treeNode(k) {
  const open = exp.treeOpen.has(k.path);
  const kids = exp.treeKids.get(k.path) || [];
  return `<div class="tree-node">
    <button type="button" class="tree-row ${k.path === exp.path ? "is-sel" : ""}" data-path="${escapeHtml(k.path)}" data-dir="1">
      <span class="tw"><span class="tree-toggle" role="button" tabindex="0" aria-label="${open ? "Collapse" : "Expand"} ${escapeHtml(k.name)}"><span class="cheve ${open ? "is-open" : ""}">${ICON_CHEV}</span></span><span class="ico">${ICON_FOLDER}</span><span>${escapeHtml(k.name)}</span></span>
    </button>
    <div class="tree-branch ${open ? "" : "is-closed"}" data-path="${escapeHtml(k.path)}">${open ? kids.map((item) => treeNode(item)).join("") : ""}</div>
  </div>`;
}

function loadTreeKids(path) {
  if (exp.treeLoading.has(path)) return Promise.resolve();
  exp.treeLoading.add(path);
  return api(`/api/tree?root=${encodeURIComponent(exp.root)}&path=${encodeURIComponent(path)}`)
    .then((d) => {
      const kids = (d.entries || []).filter((e) => e.dir);
      exp.treeKids.set(path, kids);
      renderTree();
    })
    .catch(() => { exp.treeKids.set(path, []); renderTree(); })
    .finally(() => exp.treeLoading.delete(path));
}

function wireTreeRow(row) {
  const path = row.dataset.path;
  row.addEventListener("click", () => {
    navigate(path);
  });
  const toggle = row.querySelector(".tree-toggle");
  toggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (exp.treeOpen.has(path)) exp.treeOpen.delete(path);
    else exp.treeOpen.set(path, true);
    if (exp.treeOpen.has(path) && !exp.treeKids.has(path)) void loadTreeKids(path);
    renderTree();
  });
  toggle?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") toggle.click();
  });
}

async function openFilePreview(e) {
  if (!e || e.dir) return;
  const isImg = IMG_EXTS.has(e.ext);
  const isText = TEXT_EXTS.has(e.ext);
  const url = `/api/file?root=${encodeURIComponent(exp.root)}&path=${encodeURIComponent(e.path)}`;
  const viewer = $("#media-viewer");
  const stage = $("#media-stage");
  const open = $("#media-open");
  viewer.hidden = false;
  open.href = `${url}&raw=1`;
  open.textContent = "Open";
  if (isImg) {
    stage.innerHTML = `<img src="${url}&raw=1" alt="${escapeHtml(e.name)}">`;
    return;
  }
  if (isText) {
    stage.innerHTML = `<div class="file-preview"><div class="file-preview-head"><span class="ico">${ICON_FILE}</span><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(typeLabel(e))} · ${escapeHtml(fmtSize(e.size))}</span></div><pre class="file-preview-text">Loading…</pre></div>`;
    fetch(url).then((r) => r.json()).then((d) => {
      const t = stage.querySelector(".file-preview-text");
      if (t) t.textContent = d.text || "";
    }).catch(() => {
      const t = stage.querySelector(".file-preview-text");
      if (t) t.textContent = "Could not read file.";
    });
    return;
  }
  stage.innerHTML = `<div class="file-preview file-preview-empty"><span class="ico">${ICON_FILE}</span><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(typeLabel(e))} · ${escapeHtml(fmtSize(e.size))}</span><p>No preview is available for this file type. Use Open to view or download it.</p></div>`;
}

function downloadSelected() {
  const e = exp.selected;
  if (!e || e.dir) return;
  const a = document.createElement("a");
  a.href = `/api/file?root=${encodeURIComponent(exp.root)}&path=${encodeURIComponent(e.path)}&download=1`;
  a.download = e.name;
  a.click();
}

/* Attach a VPS Explorer selection to the current Hub chat. The server owns
   path resolution and refusal; the browser renders only the safe DTO.
   A VPS folder is a live reference inside the current project workspace. */
async function attachExplorerEntry(entry) {
  if (!entry) return;
  if (!currentChatId) {
    try {
      await createChat();
    } catch (error) {
      notify(error.message || "Could not start a chat for this attachment.", true);
      return;
    }
  }
  try {
    const attachment = await hubApi.attachVpsSelection({
      root: exp.root,
      path: entry.path,
      kind: entry.dir ? "folder" : "file",
      chatId: currentChatId,
    });
    if (attachments.items.some((item) => item.id === attachment.id)) return;
    attachments.items.push({
      id: attachment.id,
      name: attachment.name || entry.name,
      relative_path: attachment.project_ref || attachment.name || entry.name,
      type: attachment.mime || attachment.type || (entry.dir ? "inode/directory" : "application/octet-stream"),
      size: attachment.size ?? null,
      url: attachment.url || "",
      source: "vps",
      status: "ready",
      batchKey: "",
      vps: true,
      live: Boolean(attachment.live),
    });
    attachments.render();
    attachments.onItemsChange();
    notify(entry.dir
      ? `Attached "${attachment.name || entry.name}" as a live VPS folder reference. Hermes receives a capped listing and can inspect deeper with tools.`
      : `Attached "${attachment.name || entry.name}" from the VPS.`);
  } catch (error) {
    const message = String(error?.message || "");
    if (error?.status === 404 || /not found|unknown route|404/i.test(message)) {
      notify("Attaching from the Files explorer is not available yet: the attachment service is not wired on this Frank build.", true);
    } else {
      notify(message || "This selection cannot be attached.", true);
    }
  }
}

function openCtx(x, y) {
  const ctx = $("#ctx");
  const pin = $("#ctx-pin");
  if (pin) {
    pin.textContent = exp.selected && isPinned(exp.selected.path) ? "Unpin" : "Pin";
    pin.disabled = !exp.selected;
  }
  ctx.hidden = false;
  ctx.style.left = Math.min(x, window.innerWidth - 180) + "px";
  ctx.style.top = Math.min(y, window.innerHeight - 180) + "px";
}

function closeCtx() { $("#ctx").hidden = true; }

function setupExplorer() {
  $("#exp-back").addEventListener("click", () => {
    if (!exp.back.length) return;
    exp.fwd.push(exp.path);
    exp.path = exp.back.pop();
    exp.selected = null;
    $("#exp-search").value = "";
    revealTreePath(exp.path);
    loadList(); syncNav(); renderTree();
  });
  $("#exp-fwd").addEventListener("click", () => {
    if (!exp.fwd.length) return;
    exp.back.push(exp.path);
    exp.path = exp.fwd.pop();
    exp.selected = null;
    $("#exp-search").value = "";
    revealTreePath(exp.path);
    loadList(); syncNav(); renderTree();
  });
  $("#exp-up").addEventListener("click", () => {
    if (!exp.path) return;
    navigate(exp.path.split("/").slice(0, -1).join("/"));
  });
  $("#exp-refresh").addEventListener("click", () => { exp.treeKids.clear(); exp.treeLoading.clear(); loadList(); renderTree(); });
  $("#exp-search").addEventListener("input", () => { renderList(); });
  $$("#exp-cols .exp-col").forEach((c) =>
    c.addEventListener("click", () => {
      const k = c.dataset.sort;
      if (exp.sort === k) exp.dir *= -1;
      else { exp.sort = k; exp.dir = 1; }
      $$("#exp-cols .exp-col").forEach((x) => x.classList.toggle("is-sort", x === c));
      c.classList.toggle("is-desc", exp.dir === -1);
      renderList();
    })
  );
  const listW = $("#exp-list-w");
  listW.addEventListener("keydown", (e) => {
    const rows = sortedEntries();
    const idx = rows.findIndex((x) => exp.selected && x.path === exp.selected.path);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = rows[Math.min(rows.length - 1, idx + 1)] || rows[0];
      if (n) {
        selectEntry(n);
        $(`.exp-row[data-path="${CSS.escape(n.path)}"]`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = rows[Math.max(0, idx - 1)] || rows[0];
      if (n) {
        selectEntry(n);
        $(`.exp-row[data-path="${CSS.escape(n.path)}"]`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Enter" && exp.selected) {
      e.preventDefault();
      if (exp.selected.dir) navigate(exp.selected.path);
      else openFilePreview(exp.selected);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (exp.path) navigate(exp.path.split("/").slice(0, -1).join("/"));
    } else if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      exp.treeKids.clear(); exp.treeLoading.clear(); loadList(); renderTree();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && exp.selected) {
      navigator.clipboard?.writeText("/" + exp.selected.path);
    } else if (e.key.toLowerCase() === "a" && exp.selected && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void attachExplorerEntry(exp.selected);
    }
  });

  $("#ctx").addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (!act) return;
    const sel = exp.selected;
    if (act === "open" && sel?.dir) navigate(sel.path);
    if (act === "open" && sel && !sel.dir) openFilePreview(sel);
    if (act === "preview" && sel) openFilePreview(sel);
    if (act === "download") downloadSelected();
    if (act === "copy" && sel) navigator.clipboard?.writeText("/" + sel.path);
    if (act === "attach" && sel) void attachExplorerEntry(sel);
    if (act === "pin" && sel) togglePin(sel);
    if (act === "refresh") { exp.treeKids.clear(); exp.treeLoading.clear(); loadList(); renderTree(); }
    closeCtx();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#ctx")) closeCtx(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCtx(); });
  $("#exp-list-w").addEventListener("contextmenu", (e) => {
    if (e.target.closest(".exp-row")) return;
    e.preventDefault();
    exp.selected = null;
    $$(".exp-row").forEach((r) => r.classList.remove("is-sel"));
    openCtx(e.clientX, e.clientY);
  });
  syncNav();
}

/* ---------------- accounts tool ---------------- */

const ACCOUNT_STATUS_LABELS = {
  planned: "Planned",
  setup: "Setup needed",
  ready: "Ready",
  attention: "Needs attention",
  disabled: "Disabled",
};
const ACCOUNT_MODE_LABELS = { selfserve: "Self-serve", managed: "Managed", internal: "Internal" };
const AUTH_STATUS_LABELS = { not_connected: "Not connected", invited: "Invited", active: "Active", suspended: "Suspended", closed: "Closed" };
const BILLING_STATUS_LABELS = { not_connected: "Not connected", trial: "Trial", active: "Active", past_due: "Past due", canceled: "Canceled" };
let accountState = { items: [], scope: "all", query: "", emailTools: null, loading: false, error: "" };

function accountProjects() {
  const known = [
    ...(projects.projects || []).map((project) => ({ id: project.id, name: project.name })),
    ...$$('.rail-item[data-project]').map((button) => ({ id: button.dataset.project, name: button.getAttribute("aria-label") || button.dataset.project })),
  ];
  const unique = new Map([["main", { id: "main", name: "Main" }]]);
  known.forEach((project) => { if (!unique.has(project.id)) unique.set(project.id, project); });
  return [...unique.values()];
}

function accountProjectName(id) {
  return accountProjects().find((project) => project.id === id)?.name || id || "Main";
}

async function accountRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = "The account could not be saved.";
    try {
      const text = await response.text();
      const match = text.match(/<p>([^<]+)<\/p>/i);
      if (match?.[1]) message = match[1];
    } catch { /* use the plain fallback */ }
    throw new Error(message);
  }
  return response.json();
}

function renderAccountScopes() {
  const host = $("#account-scopes");
  if (!host) return;
  const scopes = [{ id: "all", name: "All accounts" }, ...accountProjects()];
  host.innerHTML = scopes.map((scope) => {
    const count = scope.id === "all"
      ? accountState.items.length
      : accountState.items.filter((item) => item.project_id === scope.id).length;
    const selected = accountState.scope === scope.id;
    return `<button type="button" class="account-scope${selected ? " is-on" : ""}" data-account-scope="${escapeHtml(scope.id)}" aria-pressed="${selected}">
      <span>${escapeHtml(scope.name)}</span><small>${count}</small>
    </button>`;
  }).join("");
  host.querySelectorAll("[data-account-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      accountState.scope = button.dataset.accountScope;
      renderAccounts();
    });
  });
}

function connectorLabel(status) {
  return ({ ready: "Ready", configured: "Configured", error: "Needs attention" })[status] || "Setup needed";
}

function renderEmailStack() {
  const host = $("#email-stack");
  if (!host) return;
  const emailCount = accountState.items.filter((item) => item.kind === "email").length;
  const resend = accountState.emailTools?.resend;
  const mautic = accountState.emailTools?.mautic;
  const customers = accountState.items.filter((item) => item.kind === "customer");
  const customerProjects = new Set(customers.map((item) => item.project_id)).size;
  const activeAuth = customers.filter((item) => item.auth_status === "active").length;
  const activeBilling = customers.filter((item) => ["trial", "active"].includes(item.billing_status)).length;
  host.innerHTML = `
    <div class="email-stack-item"><strong>Customers</strong><span>${customers.length ? `${customers.length} across ${customerProjects} project${customerProjects === 1 ? "" : "s"}` : "None registered"}</span></div>
    <div class="email-stack-item"><strong>Recorded auth</strong><span>${customers.length ? `${activeAuth} active` : "No customer auth"}</span></div>
    <div class="email-stack-item"><strong>Recorded billing</strong><span>${customers.length ? `${activeBilling} trial or active` : "No customer billing"}</span></div>
    <div class="email-stack-item"><strong>Mail operations</strong><span>${emailCount ? `${emailCount} identities · ` : ""}Resend ${connectorLabel(resend?.status).toLowerCase()} · Mautic ${connectorLabel(mautic?.status).toLowerCase()}</span></div>`;
}

function filteredAccounts() {
  const query = accountState.query.trim().toLowerCase();
  return accountState.items.filter((item) => {
    if (accountState.scope !== "all" && item.project_id !== accountState.scope) return false;
    if (!query) return true;
    return [item.name, item.identity, item.provider, item.purpose, item.auth_provider, item.billing_provider, item.plan_name, accountProjectName(item.project_id)]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderAccountList() {
  const host = $("#account-list");
  if (!host) return;
  const status = $("#account-results-status");
  if (accountState.loading) {
    host.innerHTML = `<div class="account-empty"><h2>Loading accounts…</h2></div>`;
    if (status) status.textContent = "Loading accounts";
    return;
  }
  if (accountState.error) {
    host.innerHTML = `<div class="account-empty"><h2>Accounts unavailable</h2><p>${escapeHtml(accountState.error)}</p></div>`;
    if (status) status.textContent = "Accounts unavailable";
    return;
  }
  const items = filteredAccounts();
  if (status) status.textContent = `${items.length} account${items.length === 1 ? "" : "s"} shown`;
  if (!items.length) {
    const scoped = accountState.scope !== "all" || accountState.query;
    host.innerHTML = `<div class="account-empty"><h2>${scoped ? "No matching accounts" : "No accounts yet"}</h2><p>${scoped ? "Change the project or search." : "Add the first customer, email identity or service account."}</p></div>`;
    return;
  }
  host.innerHTML = `<div class="account-list-head"><span>Account</span><span>Project</span><span>Access / billing</span><span>Status</span></div>${items.map((item) => `
    <button type="button" class="account-row" data-account-id="${escapeHtml(item.id)}">
      <span class="account-primary"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.kind === "customer" ? `${item.identity} · ${ACCOUNT_MODE_LABELS[item.account_mode] || "Self-serve"} · ${item.environment === "live" ? "Live" : "Test"}` : item.identity)}</span></span>
      <span class="account-cell">${escapeHtml(accountProjectName(item.project_id))}</span>
      <span class="account-cell">${escapeHtml(item.kind === "customer" ? `${AUTH_STATUS_LABELS[item.auth_status] || "Not connected"} auth · ${BILLING_STATUS_LABELS[item.billing_status] || "Not connected"}` : (item.provider || item.kind))}</span>
      <span class="account-status" data-status="${escapeHtml(item.status)}">${escapeHtml(ACCOUNT_STATUS_LABELS[item.status] || item.status)}</span>
    </button>`).join("")}`;
  host.querySelectorAll("[data-account-id]").forEach((button) => {
    button.addEventListener("click", () => openAccountEditor(accountState.items.find((item) => item.id === button.dataset.accountId)));
  });
}

function renderAccounts() {
  renderAccountScopes();
  renderEmailStack();
  renderAccountList();
}

function renderAccountProjectOptions(selected = "main") {
  const select = $("#account-project");
  select.innerHTML = accountProjects().map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("");
  select.value = accountProjects().some((project) => project.id === selected) ? selected : "main";
}

function syncAccountKindFields() {
  const customer = $("#account-kind").value === "customer";
  $("#account-customer-fields").hidden = !customer;
  $("#account-operations-fields").hidden = customer;
  $("#account-identity").type = customer || $("#account-kind").value === "email" ? "email" : "text";
  $("#account-name").placeholder = customer ? "Blockwise Test Customer" : "Blockwise main";
  $("#account-identity").placeholder = customer ? "customer@example.invalid" : "hello@blockwise.sale";
}

let accountEditorReturnFocus = null;

function accountEditorKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeAccountEditor();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...$("#account-editor").querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.hidden);
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

function openAccountEditor(item = null) {
  accountEditorReturnFocus = document.activeElement;
  const form = $("#account-form");
  form.reset();
  $("#account-error").textContent = "";
  $("#account-id").value = item?.id || "";
  renderAccountProjectOptions(item?.project_id || (accountState.scope !== "all" ? accountState.scope : "main"));
  $("#account-kind").value = item?.kind || "customer";
  $("#account-status").value = item?.status || "planned";
  $("#account-name").value = item?.name || "";
  $("#account-identity").value = item?.identity || "";
  $("#account-provider").value = item?.provider || "";
  $("#account-purpose").value = item?.purpose || "";
  $("#account-url").value = item?.admin_url || "";
  $("#account-credential").value = item?.credential_ref || "";
  $("#account-mode").value = item?.account_mode || "selfserve";
  $("#account-environment").value = item?.environment || "test";
  $("#account-auth-status").value = item?.auth_status || "not_connected";
  $("#account-auth-provider").value = item?.auth_provider || "";
  $("#account-auth-ref").value = item?.auth_user_ref || "";
  $("#account-billing-status").value = item?.billing_status || "not_connected";
  $("#account-billing-provider").value = item?.billing_provider || "";
  $("#account-billing-customer-ref").value = item?.billing_customer_ref || "";
  $("#account-billing-subscription-ref").value = item?.billing_subscription_ref || "";
  $("#account-plan").value = item?.plan_name || "";
  $("#account-notes").value = item?.notes || "";
  $("#account-form-title").textContent = item ? "Edit account" : "Add account";
  $("#account-delete").hidden = !item;
  syncAccountKindFields();
  $("#account-editor").hidden = false;
  $(".account-scopes").inert = true;
  $(".accounts-browser").inert = true;
  $("#accounts").classList.add("is-editing");
  $("#account-name").focus();
}

function closeAccountEditor() {
  $("#account-editor").hidden = true;
  $(".account-scopes").inert = false;
  $(".accounts-browser").inert = false;
  $("#accounts").classList.remove("is-editing");
  $("#account-error").textContent = "";
  const returnTarget = accountEditorReturnFocus?.isConnected ? accountEditorReturnFocus : $("#account-add");
  accountEditorReturnFocus = null;
  returnTarget?.focus();
}

async function loadAccounts() {
  accountState.loading = true;
  accountState.error = "";
  renderAccountList();
  try {
    const [accountsResult, toolsResult] = await Promise.allSettled([
      accountRequest("/api/accounts"),
      accountRequest("/api/email-tools"),
    ]);
    if (accountsResult.status === "rejected") throw accountsResult.reason;
    accountState.items = accountsResult.value.accounts || [];
    accountState.emailTools = toolsResult.status === "fulfilled" ? toolsResult.value : null;
  } catch (error) {
    accountState.items = [];
    accountState.error = error.message || "Try again.";
  } finally {
    accountState.loading = false;
    renderAccounts();
  }
}

function setupAccounts() {
  $("#accounts-back")?.addEventListener("click", () => { closeAccountEditor(); show("tools"); mountAll("tools", $("#slot-tools"), {}); });
  $("#account-add")?.addEventListener("click", () => openAccountEditor());
  $("#account-cancel")?.addEventListener("click", closeAccountEditor);
  $("#account-editor")?.addEventListener("keydown", accountEditorKeydown);
  $("#account-kind")?.addEventListener("change", syncAccountKindFields);
  $("#account-search")?.addEventListener("input", (event) => { accountState.query = event.target.value; renderAccountList(); });
  $("#account-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#account-id").value;
    const customer = $("#account-kind").value === "customer";
    const payload = {
      project_id: $("#account-project").value,
      kind: $("#account-kind").value,
      status: $("#account-status").value,
      name: $("#account-name").value,
      identity: $("#account-identity").value,
      provider: customer ? "" : $("#account-provider").value,
      purpose: customer ? "" : $("#account-purpose").value,
      admin_url: $("#account-url").value,
      credential_ref: customer ? "" : $("#account-credential").value,
      account_mode: customer ? $("#account-mode").value : "selfserve",
      environment: customer ? $("#account-environment").value : "test",
      auth_status: customer ? $("#account-auth-status").value : "not_connected",
      auth_provider: customer ? $("#account-auth-provider").value : "",
      auth_user_ref: customer ? $("#account-auth-ref").value : "",
      billing_status: customer ? $("#account-billing-status").value : "not_connected",
      billing_provider: customer ? $("#account-billing-provider").value : "",
      billing_customer_ref: customer ? $("#account-billing-customer-ref").value : "",
      billing_subscription_ref: customer ? $("#account-billing-subscription-ref").value : "",
      plan_name: customer ? $("#account-plan").value : "",
      notes: $("#account-notes").value,
    };
    const submit = event.submitter;
    submit.disabled = true;
    $("#account-error").textContent = "";
    try {
      await accountRequest(id ? `/api/accounts/${id}` : "/api/accounts", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeAccountEditor();
      await loadAccounts();
    } catch (error) {
      $("#account-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  $("#account-delete")?.addEventListener("click", async () => {
    const id = $("#account-id").value;
    if (!id || !window.confirm("Remove this account record? Credentials in the vault will not be changed.")) return;
    try {
      await accountRequest(`/api/accounts/${id}`, { method: "DELETE" });
      closeAccountEditor();
      await loadAccounts();
    } catch (error) {
      $("#account-error").textContent = error.message;
    }
  });
}

/* ---------------- boot ---------------- */

setupChat();
setupExplorer();
setupAccounts();
setupHomePlatform();
setupProjects();

fetchProjects()
  .then(openPathView)
  .catch(openPathView);
