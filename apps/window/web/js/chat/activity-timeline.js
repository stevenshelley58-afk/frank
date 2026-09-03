/* Versioned Hermes activity renderer registry (contract v0.21 §3).
   Keyed by normalized Frank derived_label; unknown labels fall through to a
   safe "Other Hermes activity" row plus a redacted advanced detail view.
   Everything renders through the shared markdown/text helpers — never native
   event HTML. Exposes pure descriptor functions for tests. */

import { escapeHtml, fmtTime, renderMd } from "./render.js";

export const REGISTRY_VERSION = "1";

/* --- redaction for the advanced raw view (redacted JSON only) --- */
const SECRET_KEY_PATTERN = /(key|token|secret|password|passwd|authorization|credential|api[-_]?key|session[-_]?token)/i;
const MAX_RAW_STRING = 240;

export function redactValue(value, depth = 0) {
  if (depth > 6) return "…";
  if (typeof value === "string") {
    if (value.length > MAX_RAW_STRING) return `${value.slice(0, MAX_RAW_STRING)}…`;
    return value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(item, depth + 1);
  }
  return out;
}

export function redactJson(payload) {
  try {
    return JSON.stringify(redactValue(payload), null, 2);
  } catch {
    return "[unrenderable payload]";
  }
}

/* --- friendly tool failure, derived only from completion/status fields --- */
function toolFailureText(payload) {
  if (payload.ok !== false && payload.status !== "failed" && payload.status !== "error") return "";
  const detail = typeof payload.message === "string" ? payload.message
    : typeof payload.error === "string" ? payload.error : "";
  return detail ? ` — ${detail}` : "";
}

function checklistItems(payload) {
  const source = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.todos) ? payload.todos : [];
  return source
    .filter((item) => item && typeof item === "object" || typeof item === "string")
    .map((item) => typeof item === "string"
      ? { text: item, done: false }
      : { text: String(item.text || item.title || item.content || ""), done: Boolean(item.done || item.completed) })
    .filter((item) => item.text);
}

const BLOCKING_KINDS = {
  approval: { noun: "approval", question: "Hermes is asking for your approval." },
  clarify: { noun: "clarification", question: "Hermes is asking a clarifying question." },
  sudo: { noun: "sudo confirmation", question: "Hermes is asking for sudo confirmation." },
  secret: { noun: "secret", question: "Hermes is asking for a secret." },
};

/* Renderer registry: derived_label (+ payload refinement) → descriptor.
   Descriptor: { title, html?, text?, tone?, kind?, interactive?, raw? }.
   `interactive` rows carry ids for the blocking-input controller in the
   message area; the timeline only references them, never collects input. */
export const renderers = {
  assistant_message(envelope) {
    const phase = envelope.payload?.phase;
    if (phase === "complete") return { title: "Run completed", tone: "ok", kind: "run-complete" };
    if (phase === "cancelled") return { title: "Run cancelled", tone: "muted", kind: "run-cancel" };
    if (phase === "delta") return { title: "Reply streaming", tone: "hidden", kind: "stream-delta" };
    if (phase === "final") return { title: "Reply received", tone: "hidden", kind: "stream-final" };
    return { title: "Reply activity", tone: "hidden", kind: "stream-other" };
  },

  reasoning_delta(envelope) {
    const phase = envelope.payload?.phase;
    if (phase === "status") {
      const text = String(envelope.payload?.text || "").trim();
      if (!text) return null;
      return { title: "Status", text, tone: "muted", kind: "status", live: true };
    }
    const text = String(envelope.payload?.text || "");
    return {
      title: "Provider reasoning summary",
      html: renderMd(text),
      tone: "reasoning",
      kind: phase === "replace" ? "reasoning-replace" : "reasoning-delta",
      streaming: true,
    };
  },

  tool_progress(envelope) {
    const phase = envelope.payload?.phase || "progress";
    const tool = String(envelope.payload?.tool || envelope.payload?.name || "tool");
    if (phase === "started") return { title: `Running ${tool}`, tone: "work", kind: "tool-start", key: `tool:${tool}:${envelope.payload?.tool_call_id || ""}` };
    if (phase === "completed") {
      const failed = envelope.payload?.ok === false || envelope.payload?.status === "failed" || envelope.payload?.status === "error";
      return {
        title: failed ? `${tool} failed${toolFailureText(envelope.payload)}` : `${tool} finished`,
        tone: failed ? "bad" : "ok",
        kind: "tool-done",
        key: `tool:${tool}:${envelope.payload?.tool_call_id || ""}`,
      };
    }
    const detail = String(envelope.payload?.detail || "").trim();
    return { title: `${tool}: ${detail || "working"}`, tone: "work", kind: "tool-progress", key: `tool:${tool}:${envelope.payload?.tool_call_id || ""}` };
  },

  approval_required(envelope) {
    const kind = BLOCKING_KINDS[envelope.payload?.blocking] || BLOCKING_KINDS[envelope.payload?.kind] || BLOCKING_KINDS.approval;
    const phase = String(envelope.payload?.phase || "request");
    const requestId = String(envelope.payload?.request_id || "");
    const question = String(envelope.payload?.question || envelope.payload?.prompt || kind.question);
    if (phase === "received") return { title: `Your ${kind.noun} was received`, tone: "ok", kind: "input-received", key: requestId };
    if (phase === "resolved") return { title: `The ${kind.noun} was resolved`, tone: "ok", kind: "input-resolved", key: requestId };
    if (phase === "expired") {
      const label = envelope.payload?.blocking === "approval" ? "approval" : kind.noun;
      return { title: `The ${label} request expired`, tone: "bad", kind: "input-expired", key: requestId };
    }
    if (phase === "restored") {
      return { title: `A ${kind.noun} request is still waiting for you`, tone: "wait", kind: "input-wait", key: requestId, interactive: true, requestId, blocking: envelope.payload?.blocking || "approval" };
    }
    return { title: question, tone: "wait", kind: "input-wait", key: requestId, interactive: true, requestId, blocking: envelope.payload?.blocking || "approval" };
  },

  todo_updated(envelope) {
    const items = checklistItems(envelope.payload);
    if (!items.length) return { title: "Checklist updated", tone: "muted", kind: "todo-empty" };
    return {
      title: "Checklist",
      html: `<ul class="activity-checklist">${items.map((item) =>
        `<li class="${item.done ? "is-done" : ""}"><span aria-hidden="true">${item.done ? "✓" : "○"}</span>${escapeHtml(item.text)}</li>`).join("")}</ul>`,
      kind: "todo",
      key: "todo",
      replace: true,
    };
  },

  subagent_lifecycle(envelope) {
    const phase = String(envelope.payload?.phase || envelope.payload?.state || "");
    const id = String(envelope.payload?.subagent_id || envelope.payload?.id || "");
    const label = id ? `Helper task ${id.slice(0, 8)}` : "Helper task";
    if (phase === "started" || phase === "start") return { title: `${label} started`, tone: "work", kind: "subagent-start", key: `subagent:${id}` };
    if (phase === "steer") return { title: `${label} was steered`, tone: "work", kind: "subagent-steer", key: `subagent:${id}` };
    if (phase === "stop" || phase === "stopped") return { title: `${label} was stopped`, tone: "muted", kind: "subagent-stop", key: `subagent:${id}` };
    if (phase === "complete" || phase === "completed") return { title: `${label} finished`, tone: "ok", kind: "subagent-complete", key: `subagent:${id}` };
    if (phase === "failed" || phase === "failure") return { title: `${label} failed`, tone: "bad", kind: "subagent-failed", key: `subagent:${id}` };
    return { title: `${label}: ${phase || "activity"}`, tone: "work", kind: "subagent-other", key: `subagent:${id}` };
  },

  terminal_error(envelope) {
    const text = String(envelope.payload?.text || envelope.payload?.error || "The run failed.");
    return { title: "The run failed", text, tone: "bad", kind: "terminal-error" };
  },

  provider_error(envelope) {
    const text = String(envelope.payload?.text || envelope.payload?.message || "Hermes reported an error.");
    return { title: "Hermes reported an error", text, tone: "bad", kind: "provider-error" };
  },

  unknown(envelope) {
    return {
      title: "Other Hermes activity",
      text: `Recorded native event: ${envelope.nativeEvent}`,
      tone: "muted",
      kind: "unknown",
      raw: true,
    };
  },
};

export function describeEvent(envelope) {
  const render = renderers[envelope.derivedLabel] || renderers.unknown;
  const descriptor = render(envelope);
  return descriptor ? { ...descriptor, label: envelope.derivedLabel } : null;
}

/* --- DOM timeline --- */
export class ActivityTimeline {
  #rawPayload = null;

  /* host: element the <details class="thinking-stream"> lives in.
     announce: optional(text) callback for the polite live region. */
  constructor({ announce } = {}) {
    this.announce = announce || (() => {});
    this.userToggled = false;
    this.rowKeys = new Map();
    this.disposed = false;
  }

  mount(host) {
    this.host = host;
    this.details = document.createElement("details");
    this.details.className = "thinking-stream";
    this.details.hidden = true;
    this.details.innerHTML = '<summary><span>Hermes activity</span><span class="thinking-state">Working</span></summary><div class="activity-rows"></div>';
    this.details.addEventListener("toggle", () => { this.userToggled = this.details.open; });
    host.append(this.details);
    this.rows = this.details.querySelector(".activity-rows");
    this.state = this.details.querySelector(".thinking-state");
    this.opened = false;
    return this.details;
  }

  ensureVisible() {
    if (this.details.hidden) this.details.hidden = false;
    if (!this.opened && !this.userToggled) {
      this.details.open = true;
      this.opened = true;
    }
  }

  /* Manual open/closed choice wins after the first auto-open. */
  setStatus(text) {
    if (!this.state) return;
    this.state.textContent = text;
  }

  #rowFor(descriptor) {
    const key = descriptor.key || null;
    if (key && this.rowKeys.has(key)) return this.rowKeys.get(key);
    const row = document.createElement("div");
    row.className = `activity-row is-${descriptor.tone || "muted"}`;
    if (descriptor.kind === "reasoning-delta" || descriptor.kind === "reasoning-replace") {
      row.classList.add("is-streaming");
    }
    this.rows.append(row);
    if (key) this.rowKeys.set(key, row);
    return row;
  }

  #paintRow(row, descriptor) {
    const heading = document.createElement("div");
    heading.className = "activity-title";
    heading.textContent = descriptor.title;
    row.replaceChildren(heading);
    if (descriptor.html) {
      const body = document.createElement("div");
      body.className = "activity-body md";
      body.innerHTML = descriptor.html;
      row.append(body);
    } else if (descriptor.text) {
      const body = document.createElement("div");
      body.className = "activity-body";
      body.textContent = descriptor.text;
      row.append(body);
    }
    if (descriptor.raw) {
      const raw = document.createElement("details");
      raw.className = "activity-raw";
      const summary = document.createElement("summary");
      summary.textContent = "Redacted detail";
      const pre = document.createElement("pre");
      pre.textContent = redactJson(this.#rawPayload);
      raw.append(summary, pre);
      row.append(raw);
    }
  }

  handle(envelope, { receivedAt } = {}) {
    if (this.disposed || !this.rows) return;
    const descriptor = describeEvent(envelope);
    if (!descriptor) return;
    if (descriptor.tone === "hidden") return;
    this.#rawPayload = envelope.payload;
    this.ensureVisible();
    const row = this.#rowFor(descriptor);
    if (descriptor.kind === "reasoning-delta") {
      const body = row.querySelector(".activity-body");
      if (body) body.innerHTML = descriptor.html;
      else this.#paintRow(row, descriptor);
      return;
    }
    if (descriptor.replace && descriptor.key && row.dataset.painted) {
      this.#paintRow(row, descriptor);
      row.dataset.painted = "1";
      return;
    }
    if (descriptor.kind === "reasoning-replace") {
      this.#paintRow(row, descriptor);
      return;
    }
    if (!row.dataset.painted || descriptor.key !== undefined) {
      this.#paintRow(row, descriptor);
      row.dataset.painted = "1";
      if (descriptor.tone === "wait" || descriptor.tone === "bad") {
        this.announce(descriptor.title);
      }
    }
    if (receivedAt && !row.querySelector(".activity-when")) {
      const when = document.createElement("span");
      when.className = "activity-when";
      when.textContent = fmtTime(receivedAt);
      row.append(when);
    }
  }

  /* Hydration: replay stored envelopes in chronological order. */
  hydrate(envelopes) {
    for (const envelope of envelopes) this.handle(envelope);
    this.details.hidden = !this.rows.children.length;
  }

  reset() {
    if (this.rows) this.rows.replaceChildren();
    this.rowKeys = new Map();
    this.userToggled = false;
    this.opened = false;
    if (this.details) this.details.hidden = true;
  }

  dispose() {
    this.disposed = true;
    this.details?.remove();
    this.details = null;
    this.rows = null;
    this.state = null;
  }
}
