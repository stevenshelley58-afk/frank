import { isAssistantCompleted, parseSseBlock, streamPiece } from "./mini_stream.mjs";
import { MiniApiError, createMiniApi } from "./mini_api.mjs";

(function () {
  "use strict";

  const PROJECT_STORE = "mini_frank_projects_v1";
  const DRAFT_STORE = "mini_frank_conversation_v2";
  const MAX_SAVED_MESSAGES = 80;
  const MESSAGE_MAX_LENGTH = 4000;
  const GUIDE_IDLE_TIMEOUT_MS = 60000;
  const STATUS_POLL_BASE_MS = 8000;
  const STATUS_POLL_HIDDEN_MS = 30000;
  const STATUS_POLL_OFFLINE_MS = 60000;
  const DEFAULT_LIMITS = {
    max_count: 10,
    max_file_bytes: 20 * 1024 * 1024,
    max_total_bytes: 50 * 1024 * 1024,
  };

  const conversation = document.getElementById("conversation");
  const thread = document.getElementById("thread");
  const welcome = document.getElementById("welcome");
  const messages = document.getElementById("messages");
  const endMarker = document.getElementById("end-marker");
  const composer = document.getElementById("composer");
  const messageInput = document.getElementById("message");
  const fileInput = document.getElementById("file-input");
  const attachmentList = document.getElementById("attachment-list");
  const attachButton = composer.querySelector('[data-action="attach"]');
  const sendButton = composer.querySelector(".send-button");
  const brandMark = document.querySelector(".brand-mark");
  const drawer = document.getElementById("work-drawer");
  const workList = document.getElementById("work-list");
  const toast = document.getElementById("toast");
  const replyAnnouncement = document.getElementById("reply-announcement");
  const draftDeleteButton = document.querySelector('[data-action="delete-draft"]');

  let intakePromise = null;
  let uploadChain = Promise.resolve();
  let guideController = null;
  let guideAbortReason = "";
  let mutationController = null;
  let mutationAbortReason = "";

  const state = {
    config: {
      attachments: { ...DEFAULT_LIMITS },
    },
    phase: "problem",
    intake: null,
    attachments: [],
    transcript: [],
    problem: "",
    pendingChange: "",
    userTurns: 0,
    refining: false,
    busy: false,
    generation: 0,
    timer: null,
    current: null,
    jobMessage: null,
    lastStage: "",
    pollFailures: 0,
    workRefreshing: false,
    feedbackOpen: false,
  };

  const api = createMiniApi();

  const fileIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v5h5"/></svg>';
  const closeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  const sendIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 12 6-6 6 6M12 6v12"/></svg>';
  const stopIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 8h8v8H8z"/></svg>';

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanText(value, limit = 6000) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, limit);
  }

  function formatDate(value) {
    const timestamp = Number(value);
    if (!timestamp) return "Not provided";
    try {
      return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000));
    } catch (_error) {
      return "Not provided";
    }
  }

  function formatDateTime(value) {
    const timestamp = Number(value);
    if (!timestamp) return "Not provided";
    try {
      return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp * 1000));
    } catch (_error) {
      return "Not provided";
    }
  }

  function jobNextAction(job) {
    if (job && job.next_action) return cleanText(job.next_action, 180);
    if (!job) return "Open this work to refresh its status.";
    if (job.stage === "ready") return "Open the result or ask for a change.";
    if (job.stage === "needs_attention") return "Review the update and ask me to try again.";
    if (job.stage === "queued") return "I’ll start it automatically when capacity is available.";
    if (job.stage === "checking") return "I’m checking the finished work now.";
    if (job.stage === "working") return "I’m continuing in the background.";
    return "Open this work to see what happens next.";
  }

  function jobCanDelete(job) {
    return Boolean(state.config.delete_available || (job && (job.delete_available || job.can_delete)));
  }

  function jobCanRevoke(job) {
    return Boolean(state.config.revoke_available || (job && (job.revoke_available || job.can_revoke)));
  }

  function validId(value) {
    return /^[A-Za-z0-9_-]{6,120}$/.test(String(value || ""));
  }

  function validClaim(value) {
    return /^[A-Za-z0-9_-]{20,300}$/.test(String(value || ""));
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      const sameOrigin = url.origin === location.origin;
      const trustedPreview = url.protocol === "https:" && url.host === "preview.frank.fail";
      if (!sameOrigin && !trustedPreview) return "";
      if (url.username || url.password) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function cleanFiles(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 30).map((item) => ({
      id: cleanText(item && item.id, 180),
      name: cleanText(item && item.name, 240) || "Attached file",
      type: cleanText(item && item.type, 120) || "application/octet-stream",
      size: Math.max(0, Number(item && item.size) || 0),
      status: "ready",
    })).filter((item) => item.id || item.name);
  }

  function cleanTranscript(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(-MAX_SAVED_MESSAGES).map((item) => ({
      role: item && item.role === "assistant" ? "assistant" : "user",
      text: cleanText(item && item.text),
      files: cleanFiles(item && item.files).map(({ name, type, size }) => ({ name, type, size })),
    })).filter((item) => item.text || item.files.length);
  }

  function conversationPayload() {
    return state.transcript.map((item) => ({ role: item.role, text: item.text })).filter((item) => item.text);
  }

  function projects() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROJECT_STORE) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && validId(item.id) && validClaim(item.claim)).map((item) => ({
        ...item,
        transcript: cleanTranscript(item.transcript),
      }));
    } catch (_error) {
      return [];
    }
  }

  function saveProject(job, claim, transcriptOverride = null) {
    if (!job || !validId(job.id) || !validClaim(claim)) return false;
    const prior = projects().find((item) => item.id === job.id);
    const list = projects().filter((item) => item.id !== job.id);
    list.unshift({
      id: job.id,
      claim,
      title: job.title || (job.result && job.result.title) || "Your solution",
      problem: job.problem || state.problem || "Private project",
      stage: job.stage || "saved",
      created_at: job.created_at,
      updated_at: job.updated_at,
      available_until: job.available_until,
      next_action: jobNextAction(job),
      refresh_status: "live",
      refresh_error: "",
      transcript: Array.isArray(transcriptOverride)
        ? cleanTranscript(transcriptOverride)
        : state.transcript.length ? cleanTranscript(state.transcript) : cleanTranscript(prior && prior.transcript),
    });
    try {
      localStorage.setItem(PROJECT_STORE, JSON.stringify(list.slice(0, 50)));
      return true;
    } catch (_error) {
      notify("Your private link still works, but this browser could not save it.");
      return false;
    }
  }

  function forgetProject(id) {
    try { localStorage.setItem(PROJECT_STORE, JSON.stringify(projects().filter((item) => item.id !== id))); }
    catch (_error) { /* Keep the stale local entry rather than affecting anything else. */ }
  }

  function saveDraft() {
    if (!state.intake || !validId(state.intake.id) || !validClaim(state.intake.claim) || state.current) return;
    const value = {
      intake: { id: state.intake.id, claim: state.intake.claim },
      phase: state.phase,
      problem: state.problem,
      userTurns: state.userTurns,
      refining: state.refining,
      attachments: state.attachments.filter((item) => item.status === "ready").map(({ id, name, type, size }) => ({ id, name, type, size })),
      transcript: cleanTranscript(state.transcript),
    };
    try { localStorage.setItem(DRAFT_STORE, JSON.stringify(value)); }
    catch (_error) { /* The server still has the private intake. */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_STORE); }
    catch (_error) { /* Nothing user-facing depends on this cleanup. */ }
  }

  function restoredDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_STORE) || "null");
      if (!value || !validId(value.intake && value.intake.id) || !validClaim(value.intake && value.intake.claim)) return null;
      const legacyStartPhase = ["email", "delivery"].includes(value.phase);
      const transcript = cleanTranscript(value.transcript).filter((item) => !(legacyStartPhase && item.role === "user" && (/^\S+@\S+\.\S+$/.test(item.text) || /^start building\.$/i.test(item.text))));
      while (legacyStartPhase && transcript.length && transcript[transcript.length - 1].role === "assistant" && /(where should i send|private link when it’s ready|start your free solution)/i.test(transcript[transcript.length - 1].text)) transcript.pop();
      return {
        intake: { id: value.intake.id, claim: value.intake.claim },
        phase: legacyStartPhase ? "decision" : ["problem", "guiding", "decision"].includes(value.phase) ? value.phase : "guiding",
        problem: cleanText(value.problem),
        userTurns: Math.max(0, Math.min(20, Number(value.userTurns) || 0)),
        refining: Boolean(value.refining),
        attachments: cleanFiles(value.attachments),
        transcript,
      };
    } catch (_error) {
      return null;
    }
  }

  function intakeFrom(body, claimFallback = "") {
    const item = body && body.intake && typeof body.intake === "object" ? body.intake : body || {};
    const claim = cleanText(body && (body.claim_token || body.claim), 300) || claimFallback;
    if (!validId(item.id) || !validClaim(claim)) throw new Error("Your private conversation could not be started. Please try again.");
    return {
      id: item.id,
      claim,
      status: item.status || "draft",
      attachments: cleanFiles(item.attachments),
    };
  }

  function updateIntake(body) {
    if (!state.intake || !body || !body.intake) return;
    state.intake = intakeFrom(body, state.intake.claim);
  }

  async function ensureIntake() {
    if (state.intake) return state.intake;
    if (intakePromise) return intakePromise;
    const generation = state.generation;
    const pending = (async () => {
      const body = await api.createIntake(conversationPayload());
      const intake = intakeFrom(body);
      if (generation !== state.generation) {
        api.abandonIntake(intake).catch(() => {});
        const error = new Error("That conversation was replaced by a newer one.");
        error.name = "AbortError";
        throw error;
      }
      state.intake = intake;
      setDraftDeleteVisibility();
      saveDraft();
      return intake;
    })();
    intakePromise = pending;
    try {
      return await pending;
    } finally {
      if (intakePromise === pending) intakePromise = null;
    }
  }

  function notify(message) {
    clearTimeout(notify.timer);
    toast.textContent = message;
    toast.hidden = false;
    notify.timer = setTimeout(() => { toast.hidden = true; }, 4600);
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    conversation.setAttribute("aria-busy", String(state.busy));
    brandMark.classList.toggle("is-working", state.busy);
    updateSendButton();
  }

  function setDraftDeleteVisibility() {
    if (draftDeleteButton) draftDeleteButton.hidden = !(state.intake && !state.current);
  }

  function cancelMutation() {
    if (!mutationController) return;
    mutationAbortReason = "user";
    mutationController.abort();
  }

  function stopResponse() {
    if (guideController) {
      guideAbortReason = "user";
      guideController.abort();
    }
    if (mutationController) {
      mutationAbortReason = "user";
      mutationController.abort();
    }
  }

  function nearBottom() {
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 170;
  }

  function scrollToEnd(force = false) {
    if (!force && !nearBottom()) return;
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      endMarker.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
    });
  }

  function hideWelcome() {
    welcome.hidden = true;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function fileKind(file) {
    const type = String(file.type || "").toLowerCase();
    const extension = String(file.name || "").split(".").pop();
    if (type.startsWith("image/")) return "IMG";
    if (type === "application/pdf") return "PDF";
    return cleanText(extension, 4).toUpperCase() || "FILE";
  }

  function fileSummary(files) {
    if (!files || !files.length) return "";
    return `<div class="message-file-summary">${files.map((file) => `<span class="message-file">${fileIcon}<span>${esc(file.name)}</span></span>`).join("")}</div>`;
  }

  function addMessage(role, text, options = {}) {
    hideWelcome();
    const follow = nearBottom();
    const item = document.createElement("article");
    item.className = `message message-${role === "assistant" ? "assistant" : "user"}`;
    item.setAttribute("aria-label", role === "assistant" ? "Frank" : "You");
    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = `<p class="message-text">${esc(text)}</p>${fileSummary(options.files || [])}`;
    if (role === "assistant") item.append(Object.assign(document.createElement("span"), { className: "speaker-mark" }), body);
    else item.append(body);
    messages.append(item);
    if (options.record !== false) {
      state.transcript.push({ role, text: cleanText(text), files: cleanFiles(options.files || []).map(({ name, type, size }) => ({ name, type, size })) });
      state.transcript = state.transcript.slice(-MAX_SAVED_MESSAGES);
      saveDraft();
    }
    if (options.forceScroll || follow) scrollToEnd(true);
    return item;
  }

  function addThinking() {
    hideWelcome();
    const item = document.createElement("article");
    item.className = "message message-assistant";
    item.setAttribute("aria-label", "Frank is thinking");
    item.innerHTML = `<span class="speaker-mark"></span><div class="message-body"><div class="thinking"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="thinking-copy">Working on it…</span></div></div>`;
    messages.append(item);
    scrollToEnd(true);
    return item;
  }

  function startStreamMessage() {
    const item = addMessage("assistant", "", { record: false });
    item.querySelector(".message-text").setAttribute("aria-live", "off");
    return item;
  }

  function recordAssistant(text) {
    state.transcript.push({ role: "assistant", text: cleanText(text), files: [] });
    state.transcript = state.transcript.slice(-MAX_SAVED_MESSAGES);
    saveDraft();
  }

  function actionsFor(message, html) {
    const body = message && message.querySelector(".message-body");
    if (!body) return null;
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = html;
    body.append(actions);
    scrollToEnd(true);
    return actions;
  }

  function attachDecision(message) {
    if (!message || message.querySelector('[data-action="start-build"]')) return;
    actionsFor(message, '<button class="primary-button" type="button" data-action="start-build">Build this version</button>');
    state.phase = "decision";
    setComposer({ placeholder: "Add a detail or file (optional)…", attachments: true });
    saveDraft();
  }

  function consumeActions(button) {
    const group = button && button.closest(".message-actions");
    if (!group) return;
    group.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  }

  function renderAttachmentList() {
    attachmentList.innerHTML = state.attachments.map((item) => `<div class="attachment-chip${item.status === "uploading" ? " is-uploading" : ""}${item.status === "error" ? " is-error" : ""}">
      <span class="attachment-preview" aria-hidden="true">${esc(fileKind(item))}</span>
      <span class="attachment-info"><span class="attachment-name">${esc(item.name)}</span><span class="attachment-size">${item.status === "uploading" ? "Adding…" : item.status === "error" ? "Couldn’t add" : esc(formatBytes(item.size))}</span></span>
      <button class="attachment-remove" type="button" data-remove-file="${esc(item.localId || item.id)}" aria-label="Remove ${esc(item.name)}"${item.status === "uploading" ? " disabled" : ""}>${closeIcon}</button>
    </div>`).join("");
    updateSendButton();
  }

  function updateSendButton() {
    const usableFiles = state.attachments.some((item) => item.status === "ready");
    const waitingFiles = state.attachments.some((item) => item.status === "uploading");
    const hasText = Boolean(messageInput.value.trim());
    const acceptsFiles = ["problem", "guiding", "decision"].includes(state.phase) || (state.phase === "ready" && jobAttachmentsAvailable());
    const canStop = Boolean(state.busy && (guideController || mutationController));
    sendButton.type = canStop ? "button" : "submit";
    sendButton.classList.toggle("is-stop", canStop);
    sendButton.setAttribute("aria-label", canStop ? "Stop response" : "Send message");
    sendButton.title = canStop ? "Stop response" : "Send message";
    sendButton.innerHTML = canStop ? stopIcon : sendIcon;
    sendButton.dataset.action = canStop ? "stop-response" : "send-message";
    sendButton.disabled = canStop ? false : state.busy || messageInput.disabled || waitingFiles || (!hasText && !(acceptsFiles && usableFiles));
  }

  function resizeComposer() {
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 156)}px`;
    updateSendButton();
  }

  function setComposer(options = {}) {
    const locked = Boolean(options.locked);
    const attachments = options.attachments !== false && !locked;
    messageInput.disabled = locked;
    messageInput.placeholder = options.placeholder || (locked ? "" : "Tell me what’s not working…");
    messageInput.setAttribute("inputmode", options.inputmode || "text");
    messageInput.setAttribute("autocomplete", options.autocomplete || "off");
    messageInput.maxLength = options.maxlength || MESSAGE_MAX_LENGTH;
    attachButton.hidden = !attachments;
    fileInput.disabled = !attachments;
    composer.classList.toggle("is-locked", locked);
    updateSendButton();
  }

  function resetComposerValue() {
    messageInput.value = "";
    resizeComposer();
  }

  function jobAttachmentsAvailable() {
    const job = state.current && state.current.job;
    return Boolean(state.config.job_attachments || state.config.job_attachment_uploads || state.config.change_attachments || (job && (job.attachment_uploads_available || job.accepts_attachments || job.can_upload_attachments || job.change_attachments_available)));
  }

  function jobAttachmentsFrom(body) {
    if (body && body.job && Array.isArray(body.job.pending_change_attachments)) return cleanFiles(body.job.pending_change_attachments);
    if (body && body.job && Array.isArray(body.job.attachments)) return cleanFiles(body.job.attachments);
    if (body && Array.isArray(body.pending_change_attachments)) return cleanFiles(body.pending_change_attachments);
    if (body && Array.isArray(body.attachments)) return cleanFiles(body.attachments);
    return [];
  }

  function stageFiles(fileValues) {
    const files = Array.from(fileValues || []).filter((file) => file && typeof file.name === "string");
    if (!files.length) return;
    fileInput.value = "";
    if (state.busy) {
      return;
    }
    if (state.current && !jobAttachmentsAvailable()) {
      notify("Files can’t be added to this change yet. Tell me the change in a message.");
      return;
    }
    const limits = { ...DEFAULT_LIMITS, ...(state.config.attachments || {}) };
    const readyCount = state.attachments.filter((item) => item.status !== "error").length;
    if (readyCount + files.length > Number(limits.max_count || DEFAULT_LIMITS.max_count)) {
      notify(`You can add up to ${Number(limits.max_count || DEFAULT_LIMITS.max_count)} files.`);
      return;
    }
    const tooLarge = files.find((file) => file.size > Number(limits.max_file_bytes || DEFAULT_LIMITS.max_file_bytes));
    if (tooLarge) {
      notify(`${tooLarge.name} is too large. Keep each file under ${formatBytes(limits.max_file_bytes)}.`);
      return;
    }
    const currentBytes = state.attachments.reduce((total, item) => total + (Number(item.size) || 0), 0);
    const newBytes = files.reduce((total, file) => total + file.size, 0);
    if (currentBytes + newBytes > Number(limits.max_total_bytes || DEFAULT_LIMITS.max_total_bytes)) {
      notify(`Those files are too large together. Keep the total under ${formatBytes(limits.max_total_bytes)}.`);
      return;
    }

    const batch = files.map((file, index) => ({
      localId: `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      status: "uploading",
    }));
    state.attachments.push(...batch);
    renderAttachmentList();
    const generation = state.generation;
    const jobAccess = state.current && jobAttachmentsAvailable()
      ? { id: state.current.id, claim: state.current.claim }
      : null;
    uploadChain = uploadChain.catch(() => {}).then(async () => {
      if (generation !== state.generation) return;
      let priorAttachments = [];
      let target = jobAccess;
      try {
        if (target) {
          priorAttachments = [
            ...jobAttachmentsFrom({ job: state.current && state.current.job }),
            ...cleanFiles(state.attachments.filter((item) => item.status === "ready" && !batch.includes(item))),
          ];
        } else {
          target = await ensureIntake();
          if (generation !== state.generation) return;
          priorAttachments = cleanFiles(target.attachments);
        }
        const beforeIds = new Set(priorAttachments.map((item) => item.id));
      const body = jobAccess ? await api.uploadJob(target, files) : await api.uploadIntake(target, files);
        if (generation !== state.generation) return;
        let savedAttachments;
        if (jobAccess) {
          if (!state.current || state.current.id !== jobAccess.id || state.current.claim !== jobAccess.claim) return;
          if (body.job) state.current.job = body.job;
          savedAttachments = jobAttachmentsFrom(body);
        } else {
          updateIntake(body);
          savedAttachments = cleanFiles(state.intake && state.intake.attachments);
        }
        const added = savedAttachments.filter((item) => !beforeIds.has(item.id));
        batch.forEach((item, index) => {
          const saved = added[index] || savedAttachments.find((candidate) => candidate.name === item.name && candidate.size === item.size && !state.attachments.some((existing) => existing !== item && existing.id === candidate.id));
          if (saved) Object.assign(item, saved, { status: "ready", file: undefined });
          else item.status = "error";
        });
        renderAttachmentList();
        if (!jobAccess) saveDraft();
        if (batch.some((item) => item.status === "error")) notify("One file could not be added. Remove it and try again.");
      } catch (error) {
        if (generation !== state.generation) return;
        batch.forEach((item) => { item.status = "error"; item.file = undefined; });
        renderAttachmentList();
        notify(error.message || "Those files could not be added. Your message is still here.");
      }
    });
  }

  async function removeFile(key) {
    const item = state.attachments.find((file) => (file.localId || file.id) === key);
    if (!item || item.status === "uploading") return;
    const generation = state.generation;
    const jobAccess = state.current && jobAttachmentsAvailable()
      ? { id: state.current.id, claim: state.current.claim }
      : null;
    const intakeAccess = state.intake ? { id: state.intake.id, claim: state.intake.claim } : null;
    if (item.id && (state.intake || (state.current && jobAttachmentsAvailable()))) {
      item.status = "uploading";
      renderAttachmentList();
      try {
        if (jobAccess) {
          const body = await api.removeJobAttachment(jobAccess, item.id);
          if (generation !== state.generation || !state.current || state.current.id !== jobAccess.id || state.current.claim !== jobAccess.claim) return;
          if (body.job) state.current.job = body.job;
        } else {
          const body = await api.removeIntakeAttachment(intakeAccess, item.id);
          if (generation !== state.generation || !state.intake || state.intake.id !== intakeAccess.id || state.intake.claim !== intakeAccess.claim) return;
          updateIntake(body);
        }
      } catch (error) {
        if (generation !== state.generation) return;
        item.status = "ready";
        renderAttachmentList();
        notify(error.message || "That file could not be removed. Please try again.");
        return;
      }
    }
    if (generation !== state.generation) return;
    state.attachments = state.attachments.filter((file) => file !== item);
    renderAttachmentList();
    saveDraft();
  }

  function extractReply(body) {
    const source = body && body.reply && typeof body.reply === "object" ? body.reply : body || {};
    return cleanText(
      typeof body === "string" ? body :
        source.text || source.content || source.message || source.reply || source.assistant_message || source.next_question || "",
      12000,
    );
  }

  async function sendGuideTurn(text, onUpdate, signal, onActivity) {
    const intake = await ensureIntake();
    onActivity();
    const response = await fetch(`/api/mini/intakes/${encodeURIComponent(intake.id)}/chat`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
        "X-Mini-Claim": intake.claim,
        Authorization: `Bearer ${intake.claim}`,
        "Idempotency-Key": `mini-guide-${intake.id}-${Date.now()}`,
      },
      body: JSON.stringify({ text }),
      signal,
    });
    onActivity();
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (_error) { body = {}; }
      const error = new Error(cleanText(body.error, 500) || "The guide is taking a moment.");
      error.status = response.status;
      throw error;
    }
    const contentType = String(response.headers.get("content-type") || "");
    if (contentType.includes("application/json")) return extractReply(await response.json());
    if (!response.body) return "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let completed = false;
    const apply = (block) => {
      const item = parseSseBlock(block);
      if (!item) return;
      const piece = streamPiece(item.event, item.data);
      if (isAssistantCompleted(item.event, item.data)) completed = true;
      if (!piece.text) return;
      if (piece.mode === "append") answer += piece.text;
      else if (!answer || piece.text.length >= answer.length) answer = piece.text;
      onUpdate(cleanText(answer, 12000));
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true });
      let match = /\r?\n\r?\n/.exec(buffer);
      while (match) {
        apply(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = /\r?\n\r?\n/.exec(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) apply(buffer);
    if (answer && !completed) throw new Error("The reply ended before it was complete.");
    return cleanText(answer, 12000);
  }

  async function guideAfter(text, files) {
    const generation = state.generation;
    setBusy(true);
    const thinking = addThinking();
    let streamMessage = null;
    let reply = "";
    let failure = null;
    const controller = new AbortController();
    guideController = controller;
    guideAbortReason = "";
    let idleTimer = null;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (guideController === controller) {
          thinking.classList.add("is-slow");
          const thinkingCopy = thinking.querySelector(".thinking-copy");
          if (thinkingCopy) thinkingCopy.textContent = "Still working…";
        }
      }, GUIDE_IDLE_TIMEOUT_MS);
    };
    updateSendButton();
    touch();
    try {
      reply = await sendGuideTurn(text, (partial) => {
        if (generation !== state.generation || !partial) return;
        thinking.remove();
        if (!streamMessage) {
          streamMessage = startStreamMessage();
        }
        streamMessage.querySelector(".message-text").textContent = partial;
        scrollToEnd();
      }, controller.signal, touch);
    } catch (error) {
      failure = error;
      reply = "";
    } finally {
      clearTimeout(idleTimer);
      if (guideController === controller) guideController = null;
    }
    if (generation !== state.generation) return;
    thinking.remove();
    if (!reply) {
      if (streamMessage) streamMessage.remove();
      const unavailable = addMessage(
        "assistant",
        guideAbortReason === "user"
          ? "Stopped. Your message and files are safe. You can continue whenever you’re ready."
          : `${cleanText(failure && failure.message, 180) || "I’m reconnecting to finish this."} Your message and files are safe. You can continue here.`,
        { record: false },
      );
      attachDecision(unavailable);
      setBusy(false);
      saveDraft();
      return;
    }
    let assistantMessage = streamMessage;
    if (assistantMessage) {
      assistantMessage.querySelector(".message-text").textContent = reply;
      const actions = assistantMessage.querySelector(".message-actions");
      if (actions) actions.remove();
    }
    else assistantMessage = addMessage("assistant", reply, { record: false });
    const finalText = assistantMessage.querySelector(".message-text");
    finalText.removeAttribute("aria-live");
    replyAnnouncement.textContent = "";
    requestAnimationFrame(() => {
      if (generation === state.generation) replyAnnouncement.textContent = `Frank: ${reply}`;
    });
    recordAssistant(reply);
    attachDecision(assistantMessage);
    setBusy(false);
    saveDraft();
  }

  async function submitProblemOrAnswer() {
    if (state.busy) return;
    const text = cleanText(messageInput.value);
    const files = state.attachments.filter((item) => item.status === "ready");
    if (!text && !files.length) return;
    if (text && text.length < 10) {
      notify("Tell me just a little more.");
      return;
    }
    setBusy(true);
    try {
      await ensureIntake();
    } catch (error) {
      setBusy(false);
      if (error.name !== "AbortError") notify(error.message);
      return;
    }
    const spokenText = text || (files.length === 1 ? "I need help with this file." : "I need help with these files.");
    addMessage("user", spokenText, { files, forceScroll: true });
    if (!state.problem) state.problem = spokenText;
    state.userTurns += 1;
    state.attachments = state.attachments.filter((item) => item.status !== "ready");
    renderAttachmentList();
    resetComposerValue();
    setBusy(false);
    await startFreeWork("new");
  }

  function startBuild(button) {
    if (state.busy) return;
    consumeActions(button);
    addMessage("user", "Build this version.", { forceScroll: true });
    setComposer({ locked: true, hint: "Starting your free solution…", attachments: false });
    saveDraft();
    startFreeWork("new");
  }

  function intakeDraft() {
    const laterAnswers = state.transcript
      .filter((item, index) => item.role === "user" && index > 0 && !/^(build this version\.|help me refine it\.)$/i.test(item.text))
      .map((item) => item.text)
      .join(" ")
      .slice(0, 1000);
    return {
      problem: state.problem,
      outcome: laterAnswers,
      people: "",
      current_way: "",
    };
  }

  async function submitIntake(options = {}) {
    const payload = {
      ...intakeDraft(),
      conversation: conversationPayload(),
    };
    return api.submitIntake(state.intake, payload, options);
  }

  async function startFreeWork(context = "new", button = null) {
    if (state.busy || (button && button.disabled)) return;
    if (context === "change" && !state.current) return;
    if (button) consumeActions(button);
    setBusy(true);
    const generation = state.generation;
    const submittedTranscript = cleanTranscript(state.transcript);
    const changeAccess = context === "change" && state.current
      ? { id: state.current.id, claim: state.current.claim }
      : null;
    const changeAttachmentIds = state.attachments.filter((item) => item.status === "ready").map((item) => item.id);
    setComposer({ locked: true, hint: context === "change" ? "Saving your change…" : "Starting your solution…", attachments: false });
    const thinking = addThinking();
    const controller = new AbortController();
    mutationController = controller;
    mutationAbortReason = "";
    updateSendButton();
    try {
      const body = context === "change"
        ? await api.changeJob(changeAccess, state.pendingChange, changeAttachmentIds, { signal: controller.signal })
        : await submitIntake({ signal: controller.signal });
      if (mutationController === controller) mutationController = null;
      thinking.remove();
      const job = body.job;
      const claim = context === "change" ? changeAccess.claim : cleanText(body.claim_token, 300);
      if (!job || !validId(job.id) || !validClaim(claim)) throw new Error("Your work was accepted, but the private link was incomplete.");
      if (generation !== state.generation) {
        saveProject(job, claim, submittedTranscript);
        return;
      }
      state.current = { id: job.id, claim, job };
      state.intake = null;
      setDraftDeleteVisibility();
      state.attachments = [];
      state.pendingChange = "";
      clearDraft();
      setHash(state.current, true);
      if (saveProject(job, claim)) setHash(state.current, false);
      setBusy(false);
      renderJobUpdate(job, true);
    } catch (error) {
      if (generation !== state.generation) return;
      if (mutationController === controller) mutationController = null;
      thinking.remove();
      setBusy(false);
      const cancelled = mutationAbortReason === "user" || error.code === "cancelled";
      const copy = cancelled
        ? "I stopped waiting. Your messages and files are still safe."
        : `${cleanText(error.message, 400) || "I couldn’t start that just yet."} Your conversation and files are still safe.`;
      const reply = addMessage("assistant", copy, { record: false });
      actionsFor(reply, `<button class="primary-button" type="button" data-action="start-free" data-context="${context}">${context === "change" ? "Try that change again" : "Build this version"}</button>`);
      state.phase = context === "change" ? "ready" : "decision";
      setComposer(context === "change" ? { placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() } : { locked: true, hint: "Your request is safe.", attachments: false });
    }
  }

  function accessFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const id = params.get("project");
    const claim = params.get("key");
    if (!validId(id)) return null;
    if (validClaim(claim)) return { id, claim };
    const saved = projects().find((item) => item.id === id);
    return saved ? { id, claim: saved.claim } : null;
  }

  function setHash(access, includeKey = false) {
    const values = { project: access.id };
    if (includeKey) values.key = access.claim;
    history.replaceState(null, "", `#${new URLSearchParams(values)}`);
  }

  function privateLink(access) {
    const url = new URL("/mini/", location.origin);
    url.hash = new URLSearchParams({ project: access.id, key: access.claim }).toString();
    return url.href;
  }

  async function copyPrivateLink() {
    if (!state.current) return;
    const value = privateLink(state.current);
    try {
      await navigator.clipboard.writeText(value);
    } catch (_error) {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    notify("Private link copied. Keep it somewhere safe.");
  }

  function resultArtifacts(result) {
    if (Array.isArray(result && result.artifacts)) {
      return result.artifacts.map((item) => ({
        kind: item && item.kind === "download" ? "download" : "interactive",
        label: cleanText(item && (item.label || item.title || item.name), 100) || "Your solution",
        url: safeUrl(item && (item.url || item.href || item.download_url || item.open_url)),
        mediaType: cleanText(item && item.media_type, 120),
      })).filter((item) => item.url);
    }
    const legacy = [];
    const artifactUrl = safeUrl(result && result.artifact_url);
    const sourceUrl = safeUrl(result && result.source_url);
    if (artifactUrl) legacy.push({ kind: "interactive", label: "Your solution", url: artifactUrl, mediaType: "text/html" });
    if (sourceUrl) legacy.push({ kind: "download", label: "A copy to keep", url: sourceUrl, mediaType: "application/zip" });
    return legacy;
  }

  function resultChecks(result) {
    const values = (value) => Array.isArray(value)
      ? value.map((item) => typeof item === "string" ? item : item && (item.label || item.name || item.summary)).filter(Boolean)
      : value && typeof value === "object" ? Object.entries(value).map(([name, status]) => `${name}: ${status}`) : [];
    const checkItems = values(result && result.checks);
    const limitationItems = values(result && result.limitations);
    return `<details class="result-details"><summary>Checks and limitations</summary><div class="result-detail-grid">
      <div><h4>Checks</h4>${checkItems.length ? `<ul>${checkItems.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p>Not supplied with this result.</p>"}</div>
      <div><h4>Limitations</h4>${limitationItems.length ? `<ul>${limitationItems.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p>Not supplied with this result.</p>"}</div>
    </div></details>`;
  }

  function feedbackMarkup() {
    return `<div class="result-feedback" aria-labelledby="feedback-title">
      <p id="feedback-title">Does this help?</p>
      <div class="feedback-actions"><button class="quiet-button" type="button" data-feedback="useful">Useful</button><button class="quiet-button" type="button" data-feedback="not-yet" aria-expanded="false" aria-controls="feedback-form">Not yet</button></div>
      <form class="feedback-form" id="feedback-form" data-feedback-form hidden>
        <fieldset><legend>What needs attention?</legend>
          <label><input type="radio" name="feedback-reason" value="missing_piece"> It is missing something I need</label>
          <label><input type="radio" name="feedback-reason" value="wrong_format"> It is in the wrong format</label>
          <label><input type="radio" name="feedback-reason" value="needs_more_context"> It needs more context</label>
          <label><input type="radio" name="feedback-reason" value="hard_to_use"> It is hard to use</label>
          <label><input type="radio" name="feedback-reason" value="other"> Something else</label>
        </fieldset>
        <button class="secondary-button" type="button" data-action="submit-feedback">Send feedback</button>
      </form>
    </div>`;
  }

  function accessControls(job) {
    return `<button class="quiet-button" type="button" data-action="copy-link">Copy private link</button>${jobCanRevoke(job) ? '<button class="quiet-button danger-button" type="button" data-action="revoke-access">Revoke link access</button>' : ""}${jobCanDelete(job) ? '<button class="quiet-button danger-button" type="button" data-action="delete-work">Delete private work</button>' : ""}`;
  }

  function artifactAction(item, index, total) {
    const isDownload = item.kind === "download";
    let label = item.label;
    if (total === 1 && /^your solution$/i.test(label)) label = "solution";
    const verb = isDownload ? "Download" : "Open";
    return `<a class="${index === 0 ? "primary-button" : "artifact-link"}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"${isDownload ? " download" : ""}>${verb} ${esc(label)}</a>`;
  }

  function artifactCard(job) {
    const result = job.result || {};
    const artifacts = resultArtifacts(result);
    const actions = artifacts.map((item, index) => artifactAction(item, index, artifacts.length)).join("");
    const preview = safeUrl(result.preview_url) || artifacts.find((item) => item.kind === "interactive")?.url || "";
    const detailsUrl = safeUrl(result.details_url);
    const availableUntil = Number(job.available_until) > 0
      ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
        .format(new Date(Number(job.available_until) * 1000))
      : "";
    return `<div class="artifact-card">
      <div class="artifact-top"><span class="ready-label">Ready for you</span></div>
      <div class="artifact-content">
        <h3>${esc(result.title || job.title || "Your solution")}</h3>
        <p>${esc(result.summary || "Your working result is ready.")}</p>
        ${preview ? `<div class="artifact-preview-wrap"><iframe class="artifact-preview" src="${esc(preview)}" title="Safe preview of ${esc(result.title || job.title || "your result")}" sandbox loading="lazy"></iframe><p class="preview-note">This preview is static and sandboxed. Use the open or download action below for the full result.</p></div>` : ""}
        <div class="artifact-actions">${actions || ""}${detailsUrl ? `<a class="artifact-link" href="${esc(detailsUrl)}" target="_blank" rel="noopener noreferrer">Open build notes</a>` : ""}<button class="secondary-button" type="button" data-action="request-change">Ask for a change</button></div>
        ${resultChecks(result)}
        <div class="artifact-meta"><span>${availableUntil ? `Available here until ${esc(availableUntil)}` : "Availability date not provided"}</span><span>This link keeps your work available if you leave.</span></div>
        <div class="artifact-actions artifact-secondary-actions"><button class="secondary-button" type="button" data-action="make-another">Make another like this</button>${accessControls(job)}</div>
        ${feedbackMarkup()}
      </div>
    </div>`;
  }

  async function sendFeedback(rating, reason = "") {
    if (!state.current || !state.current.job) return;
    const access = { id: state.current.id, claim: state.current.claim };
    try {
      await api.feedbackJob(access, { rating, reason: reason || undefined });
      const panel = state.jobMessage && state.jobMessage.querySelector(".result-feedback");
      if (panel) panel.innerHTML = `<p class="feedback-confirmation">Thanks. I’ll use that to improve the next version.</p>`;
      notify(rating === "useful" ? "Thanks — I’m glad this is useful." : "Thanks. I’ll use that feedback for the next version.");
    } catch (error) {
      notify(error.message || "I could not save that feedback. Your result is still here.");
    }
  }

  function makeAnother() {
    const prompt = state.problem ? `${state.problem}\n\nMake another like this.` : "Make another like this.";
    newConversation(true);
    messageInput.value = prompt;
    resizeComposer();
    messageInput.focus();
    notify("I kept the original work. Add any new files before sending.");
  }

  async function deletePrivateWork(button) {
    if (!state.current || !jobCanDelete(state.current.job)) return;
    if (!window.confirm("Delete this private work? Its conversation, files, and result will be removed if the server supports deletion.")) return;
    button.disabled = true;
    const access = { id: state.current.id, claim: state.current.claim };
    try {
      await api.deleteJob(access);
      forgetProject(access.id);
      newConversation(false);
      notify("Your private work was deleted.");
    } catch (error) {
      button.disabled = false;
      notify(error.message || "I could not delete this work. Nothing was changed.");
    }
  }

  async function deleteDraft() {
    if (!state.intake || state.current) return;
    if (!window.confirm("Delete this draft and its uploaded files now?")) return;
    const access = { id: state.intake.id, claim: state.intake.claim };
    try {
      await api.abandonIntake(access);
      newConversation(false);
      notify("Your draft and uploaded files were deleted.");
    } catch (error) {
      notify(error.message || "I could not delete this draft. Nothing was changed.");
    }
  }

  async function revokeAccess(button) {
    if (!state.current || !jobCanRevoke(state.current.job)) return;
    if (!window.confirm("Revoke this private link? Anyone using the link will lose access.")) return;
    button.disabled = true;
    const access = { id: state.current.id, claim: state.current.claim };
    try {
      await api.revokeJob(access);
      forgetProject(access.id);
      newConversation(false);
      notify("Link access was revoked.");
    } catch (error) {
      button.disabled = false;
      notify(error.message || "I could not revoke this link. Nothing was changed.");
    }
  }

  const stageCopy = {
    queued: ["Working on it…", "Your request is saved. I’ll start automatically."],
    working: ["Working on it…", "I’ll keep working in the background."],
    checking: ["Almost ready…", "I’m checking the finished work now."],
    needs_attention: ["Needs another pass", "Your request is safe. I can start another run from here."],
    ready: ["I finished the work.", "The result is not available from this link yet."],
  };

  function statusCard(job) {
    const copy = stageCopy[job.stage] || stageCopy.queued;
    const canRetry = job.stage === "needs_attention" && Boolean(job.retry_available);
    const queuedCopy = job.stage === "queued" && job.automatic_retry_at
      ? `I’ll retry automatically around ${formatDateTime(job.automatic_retry_at)}.`
      : copy[1];
    const offlineCopy = navigator.onLine ? "" : " You’re offline, so I’ll check again when you’re back online.";
    return `<div class="status-card" role="status">
      <span class="status-light${job.stage === "needs_attention" ? " attention" : ""}" aria-hidden="true"></span>
      <div class="status-copy"><strong>${esc(copy[0])}</strong><p>${esc(queuedCopy + offlineCopy)}</p><p class="status-retention">This link keeps your work available if you leave.</p>
        <div class="message-actions">${canRetry ? '<button class="secondary-button" type="button" data-action="retry">Try again now</button>' : ""}${accessControls(job)}</div>
      </div>
    </div>`;
  }

  function jobMessageText(job) {
    if (job.stage === "ready") return "It’s ready. I’ve put the finished work here for you.";
    return stageCopy[job.stage]?.[0] || stageCopy.queued[0];
  }

  function jobBody(job) {
    return job.stage === "ready" && job.result ? artifactCard(job) : statusCard(job);
  }

  function renderJobUpdate(job, forceNew = false) {
    if (!job) return;
    const sameStage = state.lastStage === job.stage;
    if (!forceNew && sameStage && state.jobMessage && state.jobMessage.isConnected) {
      state.jobMessage.querySelector(".message-body").innerHTML = jobBody(job);
    } else {
      const item = addMessage("assistant", jobMessageText(job), { record: false });
      item.querySelector(".message-body").innerHTML = jobBody(job);
      state.jobMessage = item;
      state.lastStage = job.stage;
    }
    state.current.job = job;
    state.problem = job.problem || state.problem;
    const locallySaved = saveProject(job, state.current.claim);
    setHash(state.current, !locallySaved);
    if (job.stage === "ready" && job.result) {
      stopPolling();
      state.phase = "ready";
      setComposer({ placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() });
    } else {
      state.phase = "job";
      setComposer({ locked: true, hint: "Your private link brings you back here.", attachments: false });
      pollLater();
    }
    setBusy(false);
    scrollToEnd(true);
  }

  function stopPolling() {
    clearTimeout(state.timer);
    state.timer = null;
  }

  function pollLater() {
    pollLaterWithDelay(null);
  }

  function pollLaterWithDelay(delay) {
    stopPolling();
    const generation = state.generation;
    const job = state.current && state.current.job;
    const stageDelay = job && job.stage === "checking" ? 5000 : job && job.stage === "working" ? STATUS_POLL_BASE_MS : STATUS_POLL_BASE_MS * 1.5;
    const backoff = Math.min(60000, stageDelay * (2 ** Math.min(state.pollFailures, 3)));
    const wait = delay == null
      ? (!navigator.onLine ? STATUS_POLL_OFFLINE_MS : (document.hidden ? STATUS_POLL_HIDDEN_MS : backoff))
      : delay;
    state.timer = setTimeout(async () => {
      if (generation !== state.generation || !state.current) return;
      if (!navigator.onLine) {
        pollLaterWithDelay(STATUS_POLL_OFFLINE_MS);
        return;
      }
      try {
        const body = await api.readJob(state.current);
        if (generation !== state.generation || !state.current) return;
        state.pollFailures = 0;
        renderJobUpdate(body.job);
      } catch (error) {
        if (error.status === 404) {
          forgetProject(state.current.id);
          history.replaceState(null, "", location.pathname + location.search);
          newConversation(false);
          addMessage("assistant", "I couldn’t open that private link. It may be incomplete or no longer available.");
        } else {
          state.pollFailures += 1;
          pollLaterWithDelay(null);
        }
      }
    }, wait);
  }

  function refreshNetworkState() {
    if (state.current && state.current.job && state.current.job.stage !== "ready") {
      if (state.jobMessage && state.jobMessage.isConnected) state.jobMessage.querySelector(".message-body").innerHTML = jobBody(state.current.job);
      pollLaterWithDelay(navigator.onLine ? 0 : STATUS_POLL_OFFLINE_MS);
    }
  }

  function resetState() {
    stopPolling();
    if (guideController) guideController.abort();
    guideController = null;
    guideAbortReason = "";
    intakePromise = null;
    state.generation += 1;
    state.phase = "problem";
    state.intake = null;
    state.attachments = [];
    state.transcript = [];
    state.problem = "";
    state.pendingChange = "";
    state.userTurns = 0;
    state.refining = false;
    state.busy = false;
    state.current = null;
    state.jobMessage = null;
    state.lastStage = "";
    state.pollFailures = 0;
    mutationAbortReason = "";
    if (mutationController) mutationController.abort();
    mutationController = null;
    setDraftDeleteVisibility();
    replyAnnouncement.textContent = "";
  }

  function newConversation(clearStored = true) {
    const abandoned = clearStored && state.intake && !state.current
      ? { id: state.intake.id, claim: state.intake.claim }
      : null;
    resetState();
    if (abandoned) api.abandonIntake(abandoned).catch(() => {});
    if (clearStored) clearDraft();
    history.replaceState(null, "", location.pathname + location.search);
    messages.replaceChildren();
    welcome.hidden = false;
    renderAttachmentList();
    resetComposerValue();
    setComposer({ placeholder: "Tell me what’s not working…", hint: "No tech words needed.", attachments: true });
    setBusy(false);
    if (drawer.open) drawer.close();
    thread.scrollTop = 0;
  }

  function confirmDiscardDraft() {
    const hasDraft = !state.current && Boolean(
      state.intake
      || state.attachments.length
      || state.transcript.length
      || messageInput.value.trim()
    );
    return !hasDraft || window.confirm(
      "Start a new conversation? Your current draft and uploaded files will be removed."
    );
  }

  async function openProject(access) {
    resetState();
    const generation = state.generation;
    state.current = { ...access, job: null };
    setHash(access, true);
    messages.replaceChildren();
    welcome.hidden = true;
    const saved = projects().find((item) => item.id === access.id);
    if (saved && saved.transcript.length) {
      state.transcript = cleanTranscript(saved.transcript);
      state.transcript.forEach((item) => addMessage(item.role, item.text, { files: item.files, record: false }));
      state.problem = saved.problem || "";
    } else if (saved && saved.problem && saved.problem !== "Private project") {
      state.problem = saved.problem;
      addMessage("user", saved.problem, { record: false });
    }
    setComposer({ locked: true, hint: "Opening your private work…", attachments: false });
    setBusy(true);
    const thinking = addThinking();
    try {
      const body = await api.readJob(access);
      if (generation !== state.generation) return;
      thinking.remove();
      state.current.job = body.job;
      if (Array.isArray(body.job.conversation)) {
        state.transcript = cleanTranscript(body.job.conversation);
        messages.replaceChildren();
        state.transcript.forEach((item) => addMessage(item.role, item.text, { files: item.files, record: false }));
      }
      state.problem = body.job.problem || state.problem;
      if (!state.transcript.some((item) => item.role === "user") && body.job.problem) {
        state.transcript = [{ role: "user", text: cleanText(body.job.problem), files: [] }];
        addMessage("user", body.job.problem, { record: false });
      }
      renderJobUpdate(body.job, true);
    } catch (error) {
      if (generation !== state.generation) return;
      thinking.remove();
      setBusy(false);
      const savedAccess = projects().find((item) => item.id === access.id);
      if (error.status === 404 && (!savedAccess || savedAccess.claim === access.claim)) forgetProject(access.id);
      history.replaceState(null, "", location.pathname + location.search);
      state.current = null;
      addMessage("assistant", error.status === 404 ? "I couldn’t open that private link. It may be incomplete or no longer available." : "I couldn’t open your work just now. Please try the private link again in a moment.");
      setComposer({ placeholder: "Start with a new problem…", hint: "Your other work has not been changed.", attachments: true });
      state.phase = "problem";
    }
  }

  async function retryJob(button) {
    if (!state.current || state.busy) return;
    const generation = state.generation;
    const access = { id: state.current.id, claim: state.current.claim };
    consumeActions(button);
    setBusy(true);
    try {
      const body = await api.retryJob(access);
      if (generation !== state.generation || !state.current || state.current.id !== access.id || state.current.claim !== access.claim) return;
      renderJobUpdate(body.job, true);
    } catch (error) {
      if (generation !== state.generation || !state.current || state.current.id !== access.id || state.current.claim !== access.claim) return;
      setBusy(false);
      notify(error.message || "I couldn’t restart it just yet. Your place is still saved.");
      renderJobUpdate(state.current.job, true);
    }
  }

  function requestChange() {
    if (!state.current || state.current.job.stage !== "ready") return;
    state.phase = "ready";
    addMessage("assistant", "Tell me what you’d like changed. I’ll keep the parts that are already working.", { record: false, forceScroll: true });
    setComposer({ placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() });
    messageInput.focus();
  }

  async function beginChange() {
    if (state.busy) return;
    const text = cleanText(messageInput.value, 2000);
    const files = state.attachments.filter((item) => item.status === "ready");
    if (text.length < 5 && !files.length) {
      notify("Tell me a little more about what should change.");
      return;
    }
    state.pendingChange = text || (files.length === 1 ? "Use this file for the change." : "Use these files for the change.");
    resetComposerValue();
    addMessage("user", state.pendingChange, { files, forceScroll: true });
    addMessage("assistant", "I’ll make that change now.", { record: false });
    setComposer({ locked: true, hint: "Saving your change…", attachments: false });
    await startFreeWork("change");
  }

  async function refreshProjects() {
    const list = projects();
    if (!list.length) return list;
    const refreshed = await Promise.all(list.map(async (item) => {
      try {
        const body = await api.readJob({ id: item.id, claim: item.claim });
        const job = body && body.job;
        if (!job) throw new MiniApiError("The server returned no work status.");
        saveProject(job, item.claim, item.transcript);
        return { ...item, ...job, refresh_status: "live", refresh_error: "", next_action: jobNextAction(job) };
      } catch (error) {
        if (error.status === 404) {
          forgetProject(item.id);
          return null;
        }
        return { ...item, refresh_status: "unavailable", refresh_error: cleanText(error.message, 180) };
      }
    }));
    return refreshed.filter(Boolean);
  }

  function renderWorkList(list = projects()) {
    const labels = {
      queued: "Waiting",
      working: "In progress",
      checking: "Almost ready",
      ready: "Ready",
      needs_attention: "Needs attention",
      saved: "Saved",
      unavailable: "Could not refresh",
    };
    workList.innerHTML = list.length ? list.map((item) => `<button class="work-row" type="button" data-project-id="${esc(item.id)}" aria-label="Open ${esc(item.title || "your private work")}">
      <strong>${esc(item.title || "Your solution")}</strong><small class="work-status">${esc(item.refresh_status === "unavailable" ? labels.unavailable : (labels[item.stage] || "Saved"))}</small>
      <span>${esc(item.problem || "Private work")}</span>
      <small class="work-meta">Updated ${esc(formatDateTime(item.updated_at || item.created_at))} · ${item.available_until ? `Available until ${esc(formatDate(item.available_until))}` : "Availability date not provided"}</small>
      <small class="work-next">Next: ${esc(item.refresh_status === "unavailable" ? "Try opening this work again when you are online." : jobNextAction(item))}</small>
    </button>`).join("") : `<div class="empty-work"><strong>Nothing here yet.</strong><p>Your first solution will be saved here in this browser.</p></div>`;
  }

  async function openWork() {
    if (state.workRefreshing) return;
    state.workRefreshing = true;
    const workButton = document.querySelector('[data-action="work"]');
    if (workButton) {
      workButton.disabled = true;
      workButton.setAttribute("aria-busy", "true");
    }
    workList.innerHTML = '<div class="empty-work" role="status"><strong>Refreshing your work…</strong><p>I’m checking each private link for its current status.</p></div>';
    try {
      renderWorkList(await refreshProjects());
      if (typeof drawer.showModal === "function") drawer.showModal();
      else drawer.setAttribute("open", "");
    } finally {
      state.workRefreshing = false;
      if (workButton) {
        workButton.disabled = false;
        workButton.setAttribute("aria-busy", "false");
      }
    }
  }

  function finishDraftRestore() {
    messages.replaceChildren();
    state.transcript.forEach((item) => addMessage(item.role, item.text, { files: item.files, record: false }));
    renderAttachmentList();
    const assistantMessages = messages.querySelectorAll(".message-assistant");
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    if (state.phase === "decision") {
      const decisionMessage = lastAssistant || addMessage("assistant", "I have enough to build a useful first version.", { record: false });
      attachDecision(decisionMessage);
    } else setComposer({ placeholder: state.phase === "problem" ? "Tell me what’s not working…" : "Type your answer…", hint: state.phase === "problem" ? "No tech words needed." : "A rough answer is fine.", attachments: true });
    if (state.transcript.length) {
      hideWelcome();
      scrollToEnd(true);
    }
    setBusy(false);
  }

  async function restoreConversation(draft) {
    state.intake = draft.intake;
    setDraftDeleteVisibility();
    state.phase = draft.phase;
    state.problem = draft.problem;
    state.userTurns = draft.userTurns;
    state.refining = draft.refining;
    state.attachments = draft.attachments;
    state.transcript = draft.transcript;
    setComposer({ locked: true, hint: "Opening your private conversation…", attachments: false });
    setBusy(true);
    const generation = state.generation;
    try {
      const body = await api.readIntake(state.intake);
      if (generation !== state.generation) return;
      updateIntake(body);
      const serverIntake = body && body.intake ? body.intake : body;
      if (Array.isArray(serverIntake && serverIntake.conversation)) {
        state.transcript = cleanTranscript(serverIntake.conversation);
        const firstProblem = state.transcript.find((item) => item.role === "user" && item.text);
        state.problem = firstProblem ? firstProblem.text : state.problem;
      }
      state.attachments = cleanFiles(serverIntake && serverIntake.attachments);
      saveDraft();
    } catch (error) {
      if (generation !== state.generation) return;
      if (error.status === 404) {
        clearDraft();
        newConversation(false);
        addMessage("assistant", "I couldn’t reopen that draft. Start again here and I’ll keep the new conversation safe.", { record: false });
        return;
      }
      notify("I couldn’t check the saved copy just now. The copy on this device is still here.");
    }
    finishDraftRestore();
  }

  function handleSubmit() {
    if (state.phase === "ready") beginChange();
    else if (["problem", "guiding", "decision"].includes(state.phase)) submitProblemOrAnswer();
  }

  document.addEventListener("click", (event) => {
    const projectRow = event.target.closest("[data-project-id]");
    if (projectRow) {
      const item = projects().find((project) => project.id === projectRow.dataset.projectId);
      if (item) {
        if (drawer.open) drawer.close();
        openProject(item);
      }
      return;
    }
    const remove = event.target.closest("[data-remove-file]");
    if (remove) {
      removeFile(remove.dataset.removeFile);
      return;
    }
    const feedback = event.target.closest("[data-feedback]");
    if (feedback) {
      const panel = feedback.closest(".result-feedback");
      if (feedback.dataset.feedback === "useful") {
        sendFeedback("useful");
        return;
      }
      if (panel) {
        const form = panel.querySelector("[data-feedback-form]");
        form.hidden = false;
        feedback.setAttribute("aria-expanded", "true");
        form.querySelector("input")?.focus();
      }
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "attach") fileInput.click();
    else if (action === "stop-response") stopResponse();
    else if (action === "new") {
      if (state.busy && !guideController) notify("I’m saving this first. It’ll only take a moment.");
      else if (confirmDiscardDraft()) newConversation(true);
    }
    else if (action === "work") openWork();
    else if (action === "close-work" && drawer.open) drawer.close();
    else if (action === "start-build") startBuild(button);
    else if (action === "stop-guide" && guideController) {
      guideAbortReason = "user";
      button.disabled = true;
      guideController.abort();
    }
    else if (action === "cancel-mutation") {
      button.disabled = true;
      cancelMutation();
    }
    else if (action === "start-free") startFreeWork(button.dataset.context === "change" ? "change" : "new", button);
    else if (action === "copy-link") copyPrivateLink();
    else if (action === "retry") retryJob(button);
    else if (action === "request-change") requestChange();
    else if (action === "make-another") makeAnother();
    else if (action === "submit-feedback") {
      const form = button.closest("[data-feedback-form]");
      const reason = form && form.querySelector("input[name='feedback-reason']:checked")?.value;
      if (!reason) notify("Choose what needs attention first.");
      else sendFeedback("not_yet", reason);
    }
    else if (action === "delete-work") deletePrivateWork(button);
    else if (action === "revoke-access") revokeAccess(button);
    else if (action === "delete-draft") deleteDraft();
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSubmit();
  });

  messageInput.addEventListener("input", resizeComposer);
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!sendButton.disabled) composer.requestSubmit();
    }
  });

  fileInput.addEventListener("change", () => stageFiles(fileInput.files));

  ["dragenter", "dragover"].forEach((name) => composer.addEventListener(name, (event) => {
    if (fileInput.disabled) return;
    event.preventDefault();
    composer.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((name) => composer.addEventListener(name, (event) => {
    if (fileInput.disabled) return;
    event.preventDefault();
    composer.classList.remove("is-dragging");
    if (name === "drop") stageFiles(event.dataTransfer && event.dataTransfer.files);
  }));

  composer.addEventListener("paste", (event) => {
    if (fileInput.disabled) return;
    const files = Array.from((event.clipboardData && event.clipboardData.files) || []);
    if (files.length) stageFiles(files);
  });

  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) drawer.close();
  });

  window.addEventListener("hashchange", () => {
    const access = accessFromHash();
    if (access && (access.id !== state.current?.id || access.claim !== state.current?.claim)) openProject(access);
  });

  window.addEventListener("online", refreshNetworkState);
  window.addEventListener("offline", refreshNetworkState);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshNetworkState();
  });

  function syncVisualHeight() {
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    const offsetTop = viewport ? viewport.offsetTop : 0;
    document.documentElement.style.setProperty("--mini-height", `${Math.round(height)}px`);
    document.documentElement.style.setProperty("--mini-offset-top", `${Math.max(0, Math.round(offsetTop))}px`);
  }

  syncVisualHeight();
  window.addEventListener("resize", syncVisualHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncVisualHeight);
    window.visualViewport.addEventListener("scroll", syncVisualHeight);
  }

  resizeComposer();
  api.config().then((config) => {
    state.config = {
      ...state.config,
      ...config,
      attachments: { ...DEFAULT_LIMITS, ...(config.attachments || {}) },
    };
    if (state.phase === "ready" && state.current) {
      setComposer({ placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() });
    }
  }).catch(() => {});

  const initialAccess = accessFromHash();
  if (initialAccess) openProject(initialAccess);
  else {
    const draft = restoredDraft();
    if (draft) restoreConversation(draft);
    else newConversation(false);
  }
}());
