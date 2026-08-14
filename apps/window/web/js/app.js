import { mount, mountAll } from "./registry.js";
import "./widgets.js";

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const TITLES = {
  hub: ["Hub", ""],
  project: ["Project", ""],
  files: ["Files", ""],
  tools: ["Tools", "Start a factory, watch its trace"],
  trace: ["Trace", "One run, fully visible"],
  releases: ["Releases", "Signed and verified"],
};

let projects = { projects: [] };

function show(id) {
  const [title, sub] = TITLES[id] || TITLES.hub;
  $("#view-title").textContent = id === "project" ? currentProject.name : title;
  $("#view-sub").textContent = id === "hub"
    ? (chatSessions.find((chat) => chat.id === currentChatId)?.title || "")
    : sub;
  $$(".rail-item[data-view]").forEach((b) => b.classList.toggle("is-on", b.dataset.view === id));
  $$(".rail-item[data-project]").forEach((b) => b.classList.toggle("is-on", false));
  $$(".view[data-view]").forEach((v) => v.classList.toggle("is-on", v.dataset.view === id));
  if (id === "project") $$(".rail-item[data-project]").forEach((b) => b.classList.toggle("is-on", b.dataset.project === currentProject.id));
}

let currentProject = { id: "blockwise", name: "Blockwise" };

function showProject(id) {
  currentProject = projects.projects.find((x) => x.id === id) || { id, name: id };
  mountAll("project-home", $("#slot-project"), { project: currentProject, root: currentProject.root || id });
  show("project");
}

$$(".rail-item[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    const v = b.dataset.view;
    if (v === "files") { show(v); explorerFocus(); }
    else if (v === "hub") {
      show(v);
      $("#view-sub").textContent = chatSessions.find((chat) => chat.id === currentChatId)?.title || "";
      chatScrollBottom();
    }
    else { show(v); if (v === "tools") mountAll("tools", $("#slot-tools"), {}); if (v === "trace") mountAll("trace", $("#slot-trace"), {}); if (v === "releases") mountAll("releases", $("#slot-releases"), {}); }
  })
);

$$(".rail-item[data-project]").forEach((b) =>
  b.addEventListener("click", () => showProject(b.dataset.project))
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

function chatDate(sec) {
  if (!sec) return "";
  const then = new Date(sec * 1000);
  const now = new Date();
  if (then.toDateString() === now.toDateString()) return fmtTime(sec);
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(then);
}
function renderChatNav() {
  const nav = $("#chat-nav");
  nav.innerHTML = chatSessions.map((chat) => `
    <button type="button" class="chat-nav-item ${chat.id === currentChatId ? "is-on" : ""}" data-chat-id="${escapeHtml(chat.id)}" title="${escapeHtml(chat.title || "New chat")}">
      <span class="chat-nav-copy"><strong>${escapeHtml(chat.title || "New chat")}</strong><small>${escapeHtml(chat.preview || "No messages yet")}</small></span>
      <time>${chatDate(chat.updated_at)}</time>
    </button>`).join("");
  $$(".chat-nav-item", nav).forEach((button) => button.addEventListener("click", () => {
    if (turnAbort || button.dataset.chatId === currentChatId) return;
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
  chatPinnedToBottom = true;
  chatScrollBottom(true);
}
async function selectChat(chatId) {
  if (!chatId) return;
  currentChatId = chatId;
  localStorage.setItem("frank.chat", chatId);
  chatAtts.forEach(releaseAttachmentPreview);
  chatAtts = [];
  renderAtts();
  renderChatNav();
  const selected = chatSessions.find((chat) => chat.id === chatId);
  $("#view-sub").textContent = selected?.title || "";
  await loadChatMessages(chatId);
}
async function createChat() {
  if (turnAbort) return;
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New chat" }),
  });
  if (!response.ok) throw new Error("Could not start a new chat");
  const data = await response.json();
  await fetchChatSessions();
  await selectChat(data.session.id);
  $("#chat-input").focus();
}
async function refreshChatSessions() {
  try {
    await fetchChatSessions();
    const selected = chatSessions.find((chat) => chat.id === currentChatId);
    if (selected) $("#view-sub").textContent = selected.title || "";
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
  const { status, previewUrl, uploadPromise, uploadError, ...payload } = attachment;
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
function renderAtts() {
  const row = $("#att-row");
  row.innerHTML = chatAtts.map(pendingAttachment).join("");
  row.classList.toggle("has-items", chatAtts.length > 0);
  $$(".att-x", row).forEach((button) => button.addEventListener("click", () => {
    const [removed] = chatAtts.splice(Number(button.dataset.i), 1);
    releaseAttachmentPreview(removed);
    renderAtts();
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
  const staged = selected.map(({ file, path }) => ({
    name: file.name,
    relative_path: path || file.webkitRelativePath || file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    status: "uploading",
    previewUrl: String(file.type || "").startsWith("image/") ? URL.createObjectURL(file) : "",
    uploadPromise: null,
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
        chatModel = o.dataset.id;
        chatProvider = o.dataset.provider || "";
        localStorage.setItem("frank.model", chatModel);
        localStorage.setItem("frank.provider", chatProvider);
        menu.classList.remove("is-open");
        paint();
      })
    );
  };
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
  setBusy(true);
  turnAbort = new AbortController();
  let acc = "";
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
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const block of parts) {
        let ev = "", data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let obj = null;
        try { obj = JSON.parse(data); } catch { continue; }
        if (obj.type === "frank.session" || ev === "frank.session") {
          // Frank has detached this chat from an invalid Hermes history and
          // retried the same turn. The visible Frank chat remains unchanged.
        } else if (obj.type === "response.output_text.delta" || ev === "response.output_text.delta") {
          acc += obj.delta || obj.content || "";
          content.innerHTML = renderMd(acc);
          chatScrollBottom();
        } else if (obj.type === "response.output_item.done" && obj.item?.type === "function_call") {
          const name = obj.item.name || "tool";
          const line = document.createElement("div");
          line.className = "tool-line";
          line.textContent = name;
          content.after(line);
        } else if (obj.type === "error" || ev === "error") {
          acc = acc || obj.content || "Hermes returned an error.";
          content.innerHTML = renderMd(acc);
          content.classList.add("is-err");
        }
      }
    }
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
    if (acc) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      actions.innerHTML = '<button type="button" data-copy-message>Copy response</button>';
      hubEl.querySelector(".bub").append(actions);
    }
    setBusy(false);
    turnAbort = null;
    chatScrollBottom();
    void refreshChatSessions();
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
      const text = copyMessage.closest(".bub")?.querySelector(".md")?.innerText || "";
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
    if (selected) await selectChat(selected.id);
  }).catch(() => {
    addChatMsg({ role: "sys", text: "Chats could not be loaded.", ts: Date.now() / 1000 | 0 });
  });
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

/* ---------------- boot ---------------- */

setupChat();
setupExplorer();

fetch("/api/projects")
  .then((r) => r.json())
  .then((d) => { projects = d; show("hub"); })
  .catch(() => show("hub"));
