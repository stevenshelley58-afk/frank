import { mount, mountAll } from "./registry.js";
import "./widgets.js";
import { clearHomeActions, closeHomeEditors, openConnections, openEntityHome, openProjectHome, openWidgetBuilder, setupHomePlatform } from "./homes.js";
import { classifyChatStreamEvent, SseEventParser } from "./chat-stream.js";
import { mountAdStudio } from "./ad-studio.js?v=20260830-builder-escalation-v1";
import { mountAdRadar, unmountAdRadar } from "./ad-radar.js?v=20260831-observation-timeline-v1";
import { pathForView, viewForPath } from "./view-routing.js?v=20260831-ad-radar-v1";
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
  "ad-radar": ["Ad Radar", "Public creative observation and evidence"],
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
  if (id !== "ad-radar") unmountAdRadar();
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
    else if (v === "ad-radar") { show(v); void mountAdRadar(); }
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

window.addEventListener("frank:ad-radar", () => {
  show("ad-radar");
  void mountAdRadar();
});

function openPathView() {
  const id = viewForPath(window.location.pathname);
  show(id, { syncHistory: false });
  if (id === "ad-studio") mountAdStudio();
  if (id === "ad-radar") void mountAdRadar();
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
      const files = sources.filter((source) => source?.kind === "local" && source.file instanceof File).map((source) => source.file);
      const projectId = String(detail.projectId || "").trim();
      if (files.length !== 1) throw new Error("Choose exactly one source image from this device.");
      if (!projectId) throw new Error("Choose a project.");
      const fallbackName = String(sources[0]?.name || "source image").replace(/\.[^.]+$/, "");
      const jobName = String(detail.name || fallbackName).replace(/\s+/g, " ").trim().slice(0, 60);
      const uploaded = await uploadFiles(files.map((file) => ({ file, path: file.name })));
      if (uploaded.length !== 1) throw new Error("The source image was not accepted.");
    const response = await fetch("/api/ad-studio/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        name: jobName,
        brief: String(detail.brief || "").trim(),
        attachments: uploaded.map(attachmentPayload),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.run?.id) throw new Error(data.error || "Hermes did not start the background job.");
    detail.resolve?.({ run: data.run, runs: data.runs || [data.run], batchId: data.batch_id });
  })().catch((error) => detail.reject?.(error));
});

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
const DT = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
function fmtDate(sec) { try { return DT.format(new Date(sec * 1000)); } catch { return ""; } }
const TM = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit" });
function fmtTime(sec) { try { return TM.format(new Date(sec * 1000)); } catch { return ""; } }
function typeLabel(e) {
  if (e.dir) return "File folder";
  if (!e.ext) return "File";
  return e.ext.toUpperCase() + " File";
}
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3-1-6Z"/></svg>';

/* ---------------- chat — window only, Hermes thinks ---------------- */

const FALLBACK_MODELS = [
  { id: "qwen3.8-max", provider: "custom", note: "default" },
  { id: "deepseek-v4-flash", provider: "deepseek", note: "fast · cheap" },
  { id: "deepseek-v4-pro", provider: "deepseek", note: "stronger" },
  { id: "grok-4.6", provider: "xai", note: "escalate" },
  { id: "gpt-5.6-sol", provider: "custom", note: "escalate" },
  { id: "claude-fable-5", provider: "custom", note: "escalate" },
];
let models = FALLBACK_MODELS;
let chatModel = localStorage.getItem("frank.model") || "qwen3.8-max";
let chatProvider = localStorage.getItem("frank.provider") || "custom";
let currentChatId = localStorage.getItem("frank.chat") || "";
let chatSessions = [];
let chatAtts = [];
let uploadsInFlight = 0;
let turnAbort = null;
let turnQueue = Promise.resolve();
let chatPinnedToBottom = true;
let loadedChatVersion = "";
let modelUpdate = Promise.resolve();
let renderModelPicker = () => {};

function chatVersion(chat) {
  return chat ? `${chat.id}:${chat.updated_at || 0}:${chat.message_count || 0}` : "";
}
function savedSessionModels() {
  try {
    const value = JSON.parse(localStorage.getItem("frank.session-models") || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function rememberSessionModel(chatId, model, provider) {
  if (!chatId) return;
  const value = savedSessionModels();
  value[chatId] = { model, provider };
  localStorage.setItem("frank.session-models", JSON.stringify(value));
}
function applySessionModel(chat) {
  if (!chat) return;
  const saved = savedSessionModels()[chat.id] || {};
  const id = saved.model || chat.model;
  if (!id) return;
  const hit = models.find((item) => item.id === id);
  chatModel = id;
  chatProvider = saved.provider || hit?.provider || chatProvider;
  localStorage.setItem("frank.model", chatModel);
  localStorage.setItem("frank.provider", chatProvider);
  renderModelPicker();
}

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
    if (turnAbort) return;
    void selectChat(button.dataset.chatId);
  }));
}
async function fetchChatSessions() {
  const response = await fetch("/api/chat/sessions");
  if (!response.ok) throw new Error("Could not load chats");
  const data = await response.json();
  chatSessions = Array.isArray(data.sessions) ? data.sessions : [];
  renderChatNav();
  return chatSessions;
}
async function loadChatMessages(chatId) {
  const wrap = $("#chat-msgs");
  const empty = $("#chat-empty");
  wrap.innerHTML = "";
  empty.classList.remove("is-hidden");
  const response = await fetch(`/api/chat?session_id=${encodeURIComponent(chatId)}`);
  if (!response.ok) throw new Error("Could not load this chat");
  const data = await response.json();
  for (const message of data.messages || []) addChatMsg(message);
  if (!(data.messages || []).length) empty.classList.remove("is-hidden");
  loadedChatVersion = chatVersion(chatSessions.find((chat) => chat.id === chatId));
  chatPinnedToBottom = true;
  chatScrollBottom(true);
}
async function selectChat(chatId, { navigate = true } = {}) {
  if (!chatId) return;
  const switchingChats = chatId !== currentChatId;
  if (switchingChats && chatAtts.length) void discardAttachments(chatAtts.slice(), true);
  currentChatId = chatId;
  localStorage.setItem("frank.chat", chatId);
  renderChatNav();
  const selected = chatSessions.find((chat) => chat.id === chatId);
  applySessionModel(selected);
  if (navigate) show("hub");
  await loadChatMessages(chatId);
}
async function createChat(projectId = "", title = "New chat") {
  if (turnAbort) return;
  await modelUpdate.catch(() => {});
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, model: chatModel, provider: chatProvider, project_id: projectId || undefined }),
  });
  if (!response.ok) throw new Error("Could not start a new chat");
  const data = await response.json();
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
          model: chatModel,
          provider: chatProvider,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || "Could not create this project");
      close();
      await fetchProjects();
      await fetchChatSessions();
      await selectChat(data.session.id);
      if (data.bootstrap_prompt) await sendTurn(data.bootstrap_prompt, []);
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
      if (reloadCurrent && !turnAbort && chatVersion(selected) !== loadedChatVersion) {
        await loadChatMessages(selected.id);
      }
    }
  } catch { /* the active chat remains usable */ }
}

function chatScrollBottom(force = false) {
  const sc = $("#chat-scroll");
  if (sc && (force || chatPinnedToBottom)) sc.scrollTop = sc.scrollHeight;
}
function safeUrl(raw) {
  try {
    const url = new URL(String(raw).trim(), location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) || url.origin === location.origin ? url.href : "";
  } catch { return ""; }
}
function inlineMd(source) {
  const tokens = [];
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = String(source)
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (_, alt, raw) => {
      const url = safeUrl(raw);
      return url ? hold(`<button type="button" class="md-image" data-preview-url="${escapeHtml(url)}" aria-label="Preview ${escapeHtml(alt || "image")}"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"></button>`) : escapeHtml(alt);
    })
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (_, label, raw) => {
      const url = safeUrl(raw);
      return url ? hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`) : escapeHtml(label);
    });
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || "");
}
function renderMd(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      const language = fence[1].trim() || "code";
      out.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(language)}</span><button type="button" data-copy-code>Copy</button></div><pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { const level = heading[1].length; out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`); i += 1; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inlineMd(quote.join("<br>"))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(`<li>${inlineMd(lines[i++].replace(/^\s*[-*+]\s+/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(`<li>${inlineMd(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((cell) => `<th>${inlineMd(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,4}\s|^\s*>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[i])) paragraph.push(lines[i++]);
    out.push(`<p>${paragraph.map(inlineMd).join("<br>")}</p>`);
  }
  return out.join("");
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
  $("#chat-input").disabled = on;
  $("#chat-nav").classList.toggle("is-busy", on);
  $("#new-chat").disabled = on;
}
function addChatAtt(f) {
  return stageFiles([{ file: f, path: f.webkitRelativePath || f.name }]);
}
function releaseAttachmentPreview(attachment) {
  if (attachment?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
}
function attachmentPayload(attachment) {
  const { status, previewUrl, uploadPromise, uploadError, batchKey, discarded, ...payload } = attachment;
  return payload;
}
function pendingAttachment(attachment, index) {
  const image = String(attachment.type || "").startsWith("image/");
  if (image && attachment.previewUrl) {
    const name = escapeHtml(attachment.name || "Image");
    return `<span class="att-image-pending is-${escapeHtml(attachment.status || "ready")}">
      <img src="${escapeHtml(attachment.previewUrl)}" alt="${name}">
      ${attachment.status === "uploading" ? '<span class="att-uploading" aria-label="Uploading"></span>' : ""}
      ${attachment.status === "error" ? '<span class="att-failed" title="Upload failed">!</span>' : ""}
      <button type="button" class="att-x" data-i="${index}" aria-label="Remove ${name}">×</button>
    </span>`;
  }
  const state = attachment.status === "uploading" ? " · uploading" : attachment.status === "error" ? " · failed" : "";
  return `<span class="att-chip big ${attachment.status === "error" ? "is-error" : ""}">${escapeHtml(attachment.relative_path || attachment.name)} <em>${fmtSize(attachment.size)}${state}</em>
    <button type="button" class="att-x" data-i="${index}" aria-label="Remove">×</button></span>`;
}
function composerFolderKey(attachment) {
  const path = String(attachment.relative_path || "").replace(/\\/g, "/");
  const slash = path.indexOf("/");
  return slash > 0 ? encodeURIComponent(`${attachment.batchKey || "batch"}|${path.slice(0, slash)}`) : "";
}
function pendingFolder(group) {
  const uploading = group.items.some((attachment) => attachment.status === "uploading");
  const failed = group.items.some((attachment) => attachment.status === "error");
  const state = failed ? "failed" : uploading ? "uploading" : "ready";
  const detail = `${group.items.length} item${group.items.length === 1 ? "" : "s"}${uploading ? " · uploading" : failed ? " · some failed" : ""}`;
  return `<span class="att-folder-pending is-${state}">
    <span class="att-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"/></svg></span>
    <span class="att-folder-copy"><strong>${escapeHtml(group.name)}</strong><em>${detail}</em></span>
    ${uploading ? '<span class="att-folder-spin" aria-label="Uploading folder"></span>' : ""}
    <button type="button" class="att-x att-group-x" data-group-key="${escapeHtml(group.key)}" aria-label="Remove folder ${escapeHtml(group.name)}">×</button>
  </span>`;
}
async function deleteUploadedAttachments(attachments) {
  const ids = [...new Set(attachments.map((attachment) => attachment.id).filter(Boolean))];
  if (!ids.length) return;
  const response = await fetch("/api/chat/uploads", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) throw new Error(`Cleanup failed (HTTP ${response.status})`);
}
async function discardAttachments(attachments, silent = false) {
  const removing = attachments.filter(Boolean);
  if (!removing.length) return;
  const removingSet = new Set(removing);
  removing.forEach((attachment) => {
    attachment.discarded = true;
    releaseAttachmentPreview(attachment);
  });
  chatAtts = chatAtts.filter((attachment) => !removingSet.has(attachment));
  renderAtts();
  const waits = [...new Set(removing.map((attachment) => attachment.uploadPromise).filter(Boolean))];
  await Promise.allSettled(waits);
  try {
    await deleteUploadedAttachments(removing);
  } catch {
    if (!silent) addChatMsg({ role: "sys", text: "Removed from the draft, but Frank could not clear the background upload.", ts: Date.now() / 1000 | 0 });
  }
}
function renderAtts() {
  const row = $("#att-row");
  const rendered = [];
  const folders = new Map();
  chatAtts.forEach((attachment, index) => {
    const key = composerFolderKey(attachment);
    if (!key) {
      rendered.push({ kind: "item", html: pendingAttachment(attachment, index) });
      return;
    }
    let group = folders.get(key);
    if (!group) {
      const path = String(attachment.relative_path || "").replace(/\\/g, "/");
      group = { kind: "folder", key, name: path.slice(0, path.indexOf("/")), items: [] };
      folders.set(key, group);
      rendered.push(group);
    }
    group.items.push(attachment);
  });
  row.innerHTML = rendered.map((entry) => entry.kind === "folder" ? pendingFolder(entry) : entry.html).join("");
  row.classList.toggle("has-items", chatAtts.length > 0);
  $$(".att-x", row).forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.groupKey) {
      void discardAttachments(chatAtts.filter((attachment) => composerFolderKey(attachment) === button.dataset.groupKey));
    } else {
      void discardAttachments([chatAtts[Number(button.dataset.i)]]);
    }
  }));
}
async function uploadFiles(items) {
  if (!items.length) return [];
  const selected = items.slice(0, 500);
  const form = new FormData();
  for (const item of selected) {
    form.append("files", item.file, item.file.name);
    form.append("paths", item.path || item.file.webkitRelativePath || item.file.name);
  }
  const response = await fetch("/api/chat/uploads", { method: "POST", body: form });
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status})`);
  const data = await response.json();
  return Array.isArray(data.attachments) ? data.attachments : [];
}
async function stageFiles(items) {
  const selected = items.slice(0, 500);
  if (!selected.length) return;
  const batchKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const staged = selected.map(({ file, path }) => ({
    name: file.name,
    relative_path: path || file.webkitRelativePath || file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    status: "uploading",
    previewUrl: String(file.type || "").startsWith("image/") ? URL.createObjectURL(file) : "",
    uploadPromise: null,
    batchKey,
  }));
  chatAtts.push(...staged);
  uploadsInFlight += staged.length;
  renderAtts();
  const uploadPromise = uploadFiles(selected).then((uploaded) => {
    staged.forEach((attachment, index) => {
      if (uploaded[index]) Object.assign(attachment, uploaded[index], { status: "ready" });
      else Object.assign(attachment, { status: "error", uploadError: "The file was not accepted." });
    });
  }).catch((error) => {
    staged.forEach((attachment) => Object.assign(attachment, { status: "error", uploadError: error.message || "Upload failed" }));
    addChatMsg({ role: "sys", text: error.message || "The files could not be uploaded.", ts: Date.now() / 1000 | 0 });
  }).finally(() => {
    uploadsInFlight = Math.max(0, uploadsInFlight - staged.length);
    renderAtts();
  });
  staged.forEach((attachment) => { attachment.uploadPromise = uploadPromise; });
  await uploadPromise;
}
function enqueueTurn(text, atts) {
  turnQueue = turnQueue.catch(() => {}).then(() => sendTurn(text, atts));
  return turnQueue;
}
function currentModel() {
  return models.find((m) => m.id === chatModel) || { id: chatModel, provider: chatProvider, note: "" };
}
function setupModelPicker() {
  const menu = $("#model-menu");
  const paint = () => {
    menu.innerHTML = models.map((m) =>
      `<button type="button" class="model-opt ${m.id === chatModel ? "is-on" : ""}" data-id="${m.id}" data-provider="${m.provider || ""}" role="menuitem">
        <span class="mo-name">${escapeHtml(m.id)}</span><span class="mo-note">${escapeHtml(m.note || m.provider || "")}</span>
      </button>`).join("");
    $("#model-name").textContent = chatModel;
    $$(".model-opt", menu).forEach((o) =>
      o.addEventListener("click", () => {
        const previous = { model: chatModel, provider: chatProvider };
        chatModel = o.dataset.id;
        chatProvider = o.dataset.provider || "";
        localStorage.setItem("frank.model", chatModel);
        localStorage.setItem("frank.provider", chatProvider);
        menu.classList.remove("is-open");
        paint();
        if (!currentChatId) return;
        const selected = chatSessions.find((chat) => chat.id === currentChatId);
        if (selected) selected.model = chatModel;
        const requested = { model: chatModel, provider: chatProvider };
        modelUpdate = fetch(`/api/chat/sessions/${encodeURIComponent(currentChatId)}/model`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requested),
        }).then(async (response) => {
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Hermes did not accept that model");
          }
          rememberSessionModel(currentChatId, requested.model, requested.provider);
        }).catch((error) => {
          chatModel = previous.model;
          chatProvider = previous.provider;
          if (selected) selected.model = previous.model;
          localStorage.setItem("frank.model", chatModel);
          localStorage.setItem("frank.provider", chatProvider);
          paint();
          addChatMsg({ role: "sys", text: error.message || "Could not change the Hermes model.", error: true, ts: Date.now() / 1000 | 0 });
          return false;
        });
      })
    );
  };
  renderModelPicker = paint;
  paint();
  $("#model-btn").addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("is-open"); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#model-pick")) menu.classList.remove("is-open"); });
  fetch("/api/models").then((r) => r.json()).then((d) => {
    if (Array.isArray(d.models) && d.models.length) models = d.models;
    if (!models.some((m) => m.id === chatModel)) chatModel = models[0].id;
    const hit = models.find((m) => m.id === chatModel);
    if (hit) chatProvider = hit.provider || chatProvider;
    paint();
  }).catch(() => paint());
}

async function sendTurn(text, atts) {
  if (!currentChatId) await createChat();
  await modelUpdate.catch(() => {});
  const turnChatId = currentChatId;
  chatPinnedToBottom = true;
  addChatMsg({ role: "user", text, attachments: atts, model: chatModel, ts: Date.now() / 1000 | 0 });
  const hubEl = addChatMsg({ role: "assistant", text: "", tools: [], ts: Date.now() / 1000 | 0 });
  const content = hubEl.querySelector(".md") || (() => {
    const n = document.createElement("div");
    n.className = "md";
    hubEl.querySelector(".bub").prepend(n);
    return n;
  })();
  content.classList.add("is-stream");
  content.textContent = "";
  const thinking = document.createElement("details");
  thinking.className = "thinking-stream";
  thinking.hidden = true;
  thinking.open = true;
  thinking.innerHTML = '<summary><span>Thinking</span><span class="thinking-state">Working</span></summary><div class="thinking-copy md" aria-live="polite"></div>';
  content.before(thinking);
  const thinkingCopy = thinking.querySelector(".thinking-copy");
  const thinkingState = thinking.querySelector(".thinking-state");
  setBusy(true);
  turnAbort = new AbortController();
  let acc = "";
  let reasoning = "";
  let sawThinking = false;
  const showThinking = (value, replace = false) => {
    if (value) reasoning = replace ? value : reasoning + value;
    if (!value && !reasoning) return;
    sawThinking = true;
    thinking.hidden = false;
    thinking.open = true;
    thinkingCopy.innerHTML = renderMd(reasoning);
    chatScrollBottom();
  };
  const applyEvent = (event, data) => {
    const item = classifyChatStreamEvent(event, data);
    if (item.kind === "assistant.delta") {
      acc += item.text;
      content.innerHTML = renderMd(acc);
      chatScrollBottom();
    } else if (item.kind === "reasoning.delta") {
      showThinking(item.text);
    } else if (item.kind === "reasoning.replace") {
      showThinking(item.text, true);
    } else if (item.kind === "thinking.status") {
      if (!item.text) return;
      sawThinking = true;
      thinking.hidden = false;
      thinking.open = true;
      thinkingState.textContent = item.text;
      chatScrollBottom();
    } else if (item.kind === "tool.started") {
      const line = document.createElement("div");
      line.className = "tool-line";
      line.textContent = item.name;
      content.after(line);
    } else if (item.kind === "assistant.completed" && !acc && item.text) {
      acc = item.text;
      content.innerHTML = renderMd(acc);
    } else if (item.kind === "error") {
      acc = acc || item.text;
      content.innerHTML = renderMd(acc);
      content.classList.add("is-err");
    }
  };
  try {
    const res = await fetch("/api/chat/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: turnAbort.signal,
      body: JSON.stringify({
        text,
        attachments: atts,
        model: chatModel,
        provider: currentModel().provider,
        chat_id: turnChatId,
      }),
    });
    if (!res.ok || !res.body) throw new Error("Hub did not accept the turn");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const parser = new SseEventParser();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const item of parser.push(dec.decode(value, { stream: true }))) applyEvent(item.event, item.data);
    }
    for (const item of parser.finish(dec.decode())) applyEvent(item.event, item.data);
    if (!acc) content.textContent = "No reply from hub.";
  } catch (err) {
    if (err.name === "AbortError") {
      if (!acc) content.textContent = "Stopped.";
    } else {
      content.textContent = err.message || "Could not reach hub.";
      content.classList.add("is-err");
    }
  } finally {
    content.classList.remove("is-stream");
    if (sawThinking) {
      thinkingState.textContent = "Done";
      thinking.open = false;
    }
    if (acc) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      actions.innerHTML = '<button type="button" data-copy-message>Copy response</button>';
      hubEl.querySelector(".bub").append(actions);
    }
    setBusy(false);
    turnAbort = null;
    chatScrollBottom();
    void refreshChatSessions(true);
  }
}

function fileFromEntry(entry, parent = "") {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) return new Promise((resolve, reject) => entry.file((file) => resolve([{ file, path }]), reject));
  if (!entry.isDirectory) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();
    const children = [];
    const read = () => reader.readEntries(async (batch) => {
      if (!batch.length) {
        try { resolve((await Promise.all(children.map((child) => fileFromEntry(child, path)))).flat()); }
        catch (error) { reject(error); }
        return;
      }
      children.push(...batch);
      read();
    }, reject);
    read();
  });
}
async function filesFromTransfer(transfer) {
  const entries = Array.from(transfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) return (await Promise.all(entries.map((entry) => fileFromEntry(entry)))).flat();
  return Array.from(transfer.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
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
  setupModelPicker();
  setupChatActions();
  const bar = $("#bar");
  const input = $("#chat-input");
  const mic = $("#mic");
  const composer = $("#chat-composer");
  const chatScroll = $("#chat-scroll");

  $("#new-chat").addEventListener("click", () => {
    void createChat().catch((error) => addChatMsg({ role: "sys", text: error.message || "Could not start a new chat.", ts: Date.now() / 1000 | 0 }));
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
  $("#file-input").addEventListener("change", (event) => {
    void stageFiles(Array.from(event.target.files || []).map((file) => ({ file, path: file.name })));
    event.target.value = "";
  });
  $("#folder-input").addEventListener("change", (event) => {
    void stageFiles(Array.from(event.target.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name })));
    event.target.value = "";
  });

  let preparingTurn = false;
  bar.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (preparingTurn) return;
    const text = input.value.trim();
    if (!text && !chatAtts.length) return;
    const selected = chatAtts.slice();
    preparingTurn = true;
    bar.classList.add("is-preparing");
    input.disabled = true;
    $("#send").disabled = true;
    try {
      const waits = [...new Set(selected.map((attachment) => attachment.uploadPromise).filter(Boolean))];
      await Promise.allSettled(waits);
      const ready = selected.filter((attachment) => attachment.status === "ready");
      if (!text && !ready.length) return;
      const readySet = new Set(ready);
      chatAtts = chatAtts.filter((attachment) => !readySet.has(attachment));
      ready.forEach(releaseAttachmentPreview);
      renderAtts();
      input.value = "";
      grow();
      enqueueTurn(text, ready.map(attachmentPayload));
    } finally {
      preparingTurn = false;
      bar.classList.remove("is-preparing");
      input.disabled = false;
      $("#send").disabled = false;
      input.focus();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      bar.requestSubmit();
    }
  });
  $("#stop").addEventListener("click", () => { if (turnAbort) turnAbort.abort(); });

  ["dragenter", "dragover"].forEach((ev) =>
    composer.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.add("is-drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    composer.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && composer.contains(e.relatedTarget)) return;
      composer.classList.remove("is-drag");
    })
  );
  document.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", async (e) => {
    if (!$(".view[data-view=hub]").classList.contains("is-on")) return;
    if (!e.dataTransfer?.files?.length && !e.dataTransfer?.items?.length) return;
    e.preventDefault();
    composer.classList.remove("is-drag");
    void stageFiles(await filesFromTransfer(e.dataTransfer));
  });
  document.addEventListener("paste", (event) => {
    if (!$(".view[data-view=hub]").classList.contains("is-on")) return;
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void stageFiles(files.map((file) => ({ file, path: file.name })));
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const rec = new SR();
    rec.lang = "en-AU";
    rec.interimResults = true;
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = t;
      grow();
      input.focus();
    };
    rec.onend = () => mic.classList.remove("is-listening");
    rec.onerror = () => mic.classList.remove("is-listening");
    mic.addEventListener("click", () => {
      if (mic.classList.contains("is-listening")) { rec.stop(); mic.classList.remove("is-listening"); }
      else { mic.classList.add("is-listening"); try { rec.start(); } catch { mic.classList.remove("is-listening"); } }
    });
  } else {
    mic.style.display = "none";
  }

  fetchChatSessions().then(async (sessions) => {
    const selected = sessions.find((chat) => chat.id === currentChatId) || sessions[0];
    if (selected) await selectChat(selected.id, { navigate: false });
  }).catch(() => {
    addChatMsg({ role: "sys", text: "Chats could not be loaded.", ts: Date.now() / 1000 | 0 });
  });
  window.setInterval(() => {
    if (!turnAbort) void refreshChatSessions(true);
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
