/* One reliable Hub turn: submit, consume Frank's normalized stream, resume,
   dedupe, reconcile, and expose every contracted state. The framing parser
   (../chat-stream.js) only chunks SSE bytes; every frame is normalized
   (events.js) and every normalized envelope reaches the activity registry.
   Owns its assistant bubble DOM with an explicit mount/dispose interface. */

import { SseEventParser } from "../chat-stream.js";
import { ActivityTimeline, describeEvent } from "./activity-timeline.js";
import { EventDeduper, normalizeEvent } from "./events.js";
import * as api from "./api.js";
import { escapeHtml, renderMd } from "./render.js";

export const TURN_STATES = {
  CONNECTING: "connecting",
  WORKING: "working",
  WAITING: "waiting",
  STOPPING: "stopping",
  COMPLETE: "complete",
  CANCELLED: "cancelled",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
};

const STATE_LABELS = {
  connecting: "Connecting",
  working: "Working",
  waiting: "Waiting for you",
  stopping: "Stopping…",
  complete: "Done",
  cancelled: "Cancelled",
  failed: "Failed",
  interrupted: "Reconnecting",
};

function friendlySubmitError(error) {
  const raw = String(error?.message || "");
  if (/busy|lease|locked|in progress|already running/i.test(raw)) {
    return `Hermes is already working in this workspace: ${raw} Nothing was sent twice; try again when it finishes.`;
  }
  if (/queued/i.test(raw)) return `Hermes queued this turn: ${raw}`;
  return raw || "The turn could not be started.";
}

export class TurnStreamController {
  constructor({ announce } = {}) {
    this.announce = announce || (() => {});
    this.timeline = new ActivityTimeline({ announce });
    this.disposed = false;
    this.active = false;
    this.abort = null;
    this.onStateChange = () => {};
    this.runId = "";
  }

  mount(host) {
    this.host = host;
    this.el = document.createElement("div");
    this.el.className = "msg msg-hub";
    this.el.innerHTML = '<div class="bub"><div class="md"></div></div>';
    host.append(this.el);
    this.bubble = this.el.querySelector(".bub");
    this.content = this.el.querySelector(".md");
    this.content.classList.add("is-stream");
    this.timeline.mount(this.bubble);
    return this.el;
  }

  #state(state, detail = "") {
    this.currentState = state;
    this.timeline.setStatus(STATE_LABELS[state] || state);
    this.onStateChange(state, detail);
  }

  /* Restore hydrated activity rows without touching the answer text. */
  hydrate(envelopes) {
    this.timeline.hydrate(envelopes);
  }

  #handleEnvelope(envelope) {
    if (this.disposed || !envelope) return;
    if (envelope.runId && !this.runId) this.runId = envelope.runId;
    const descriptor = describeEvent(envelope);
    if (envelope.derivedLabel === "assistant_message") {
      const phase = envelope.payload?.phase;
      if (phase === "delta") {
        const text = String(envelope.payload?.text || "");
        if (text && !envelope.payload?.already_streamed) {
          this.answer += text;
          this.content.innerHTML = renderMd(this.answer);
          this.onScroll?.();
        } else if (envelope.payload?.already_streamed && !this.answer) {
          /* interim reconciling against a final we have not seen yet */
          this.answer = String(envelope.payload?.text || this.answer);
          this.content.innerHTML = renderMd(this.answer);
        }
        return;
      }
      if (phase === "final") {
        const text = String(envelope.payload?.text || "");
        if (text && (!this.answer || envelope.payload?.already_streamed)) {
          this.answer = text;
          this.content.innerHTML = renderMd(this.answer);
          this.onScroll?.();
        }
        return;
      }
      if (phase === "complete") { this.#finish(TURN_STATES.COMPLETE); return; }
      if (phase === "cancelled") { this.#finish(TURN_STATES.CANCELLED); return; }
    }
    if (envelope.derivedLabel === "reasoning_delta") {
      const phase = envelope.payload?.phase;
      if (phase === "status" && String(envelope.payload?.text || "").trim()) {
        this.#state(TURN_STATES.WORKING);
      }
      this.timeline.handle(envelope);
      return;
    }
    if (envelope.derivedLabel === "approval_required") {
      const phase = String(envelope.payload?.phase || "request");
      if (["request", "restored"].includes(phase)) this.#state(TURN_STATES.WAITING);
      if (["received", "resolved"].includes(phase)) this.#state(TURN_STATES.WORKING);
      this.timeline.handle(envelope);
      if (["request", "restored"].includes(phase)) this.onBlocking?.(descriptor, envelope);
      else this.onBlockingResolved?.(envelope);
      return;
    }
    if (envelope.derivedLabel === "terminal_error" || envelope.derivedLabel === "provider_error") {
      const text = String(envelope.payload?.text || "").trim();
      if (text && !this.answer) {
        this.answer = text;
        this.content.innerHTML = renderMd(this.answer);
        this.content.classList.add("is-err");
      } else if (text && this.answer) {
        this.timeline.handle(envelope);
      }
      if (envelope.derivedLabel === "terminal_error") this.#finish(TURN_STATES.FAILED);
      this.timeline.handle(envelope);
      return;
    }
    this.timeline.handle(envelope);
  }

  async #consume(response, signal) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseEventParser();
    const deduper = new EventDeduper();
    const deliver = (event, data) => {
      const envelope = normalizeEvent(event, data);
      if (!envelope || !deduper.firstTime(envelope)) return;
      this.#handleEnvelope(envelope);
    };
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      for (const item of parser.push(decoder.decode(value, { stream: true }))) deliver(item.event, item.data);
    }
    for (const item of parser.finish(decoder.decode())) deliver(item.event, item.data);
  }

  async run({ chatId, text, attachments, turnId, model, provider }) {
    if (this.active) throw new Error("A turn is already running.");
    this.active = true;
    this.runId = "";
    this.answer = "";
    this.content.classList.remove("is-err");
    this.content.innerHTML = "";
    this.timeline.reset();
    this.turnId = turnId;
    this.chatId = chatId;
    this.abort = new AbortController();
    this.#state(TURN_STATES.CONNECTING);
    try {
      const { replayed, response } = await api.submitTurn({
        chatId, text, attachments, turnId, model, provider,
        signal: this.abort.signal,
      });
      if (replayed) {
        this.timeline.handle({
          seq: null, nativeEvent: "frank.turn.replayed", derivedLabel: "assistant_message",
          payload: { phase: "complete" }, frankOrigin: true,
        });
        this.#finish(TURN_STATES.COMPLETE, "This turn was already accepted; showing the recorded reply.");
        return this.currentState;
      }
      this.#state(TURN_STATES.WORKING);
      await this.#consume(response, this.abort.signal);
      if (this.currentState !== TURN_STATES.STOPPING) {
        if (!this.answer) {
          this.content.textContent = "No reply from hub.";
          this.content.classList.add("is-err");
          this.#finish(TURN_STATES.FAILED);
        } else {
          this.#finish(TURN_STATES.COMPLETE);
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        /* stopRun drives the terminal state; the stream simply ends. */
        if (this.currentState !== TURN_STATES.STOPPING) this.#finish(TURN_STATES.CANCELLED);
      } else if (error instanceof TypeError) {
        /* network loss mid-turn: real server state is reconciled on return */
        this.#state(TURN_STATES.INTERRUPTED);
        this.onInterrupted?.(error);
      } else {
        this.content.textContent = friendlySubmitError(error);
        this.content.classList.add("is-err");
        this.#finish(TURN_STATES.FAILED);
      }
    } finally {
      this.#settle();
    }
    return this.currentState;
  }

  /* Stop sends the exact active run/session identity upstream; the UI stays
     "Stopping…" until a terminal event or stream end arrives. */
  async stop() {
    if (!this.active || this.currentState === TURN_STATES.STOPPING) return;
    this.#state(TURN_STATES.STOPPING);
    try {
      await api.stopRun({ chatId: this.chatId, runId: this.runId });
    } catch (error) {
      this.announce(String(error?.message || "Stop was not accepted yet."));
    }
  }

  #finish(state, detail = "") {
    if ([TURN_STATES.COMPLETE, TURN_STATES.CANCELLED, TURN_STATES.FAILED].includes(this.currentState) && state !== this.currentState) return;
    this.#state(state, detail);
  }

  #settle() {
    this.content.classList.remove("is-stream");
    if (this.answer && this.currentState === TURN_STATES.COMPLETE) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      actions.innerHTML = '<button type="button" data-copy-message>Copy response</button>';
      this.bubble.append(actions);
    }
    if (this.currentState === TURN_STATES.INTERRUPTED) return;
    this.active = false;
    this.abort = null;
  }

  /* Reconnect after an interruption: hydrate from authoritative history and
     finish the turn honestly. Never implies work stopped when it did not. */
  async reconcile() {
    if (this.currentState !== TURN_STATES.INTERRUPTED) return this.currentState;
    try {
      const { messages } = await api.fetchHistory(this.chatId);
      const last = messages.filter((message) => message.role === "assistant").at(-1);
      if (last?.text && !this.answer) {
        this.answer = last.text;
        this.content.innerHTML = renderMd(this.answer);
      }
      this.#finish(last?.text ? TURN_STATES.COMPLETE : TURN_STATES.INTERRUPTED);
      if (!last?.text) {
        this.content.textContent = "Hermes is still working. Reopen this chat to see the live state.";
        this.active = false;
      }
    } catch {
      this.content.textContent = "Could not reach hub. Your turn is recorded; reopen this chat to see its state.";
      this.content.classList.add("is-err");
      this.active = false;
    }
    return this.currentState;
  }

  dispose() {
    this.disposed = true;
    this.abort?.abort(new DOMException("disposed", "AbortError"));
    this.timeline.dispose();
    this.el?.remove();
    this.el = null;
    this.active = false;
  }
}

/* Blocking input form (approval / clarification / sudo / secret).
   Rendered in the message area with existing button/field styles. Values are
   bound to the exact native request_id, submitted once, cleared immediately,
   and never persisted or redisplayed. */
export function renderBlockingInput({ descriptor, onSubmit, onCancel }) {
  const kind = descriptor.blocking || "approval";
  const requestId = descriptor.requestId || "";
  const form = document.createElement("form");
  form.className = "input-request";
  form.dataset.requestId = requestId;
  form.dataset.kind = kind;
  const title = document.createElement("p");
  title.className = "input-question";
  title.textContent = descriptor.title;
  form.append(title);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn";
  const lock = () => {
    submit.disabled = true;
    form.querySelectorAll("input, textarea, button").forEach((el) => { if (el !== submit) el.disabled = true; });
  };

  if (kind === "approval") {
    const row = document.createElement("div");
    row.className = "input-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn";
    approve.textContent = "Approve";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn input-secondary";
    reject.textContent = "Deny";
    approve.addEventListener("click", () => { lock(); onSubmit({ requestId, kind, value: "approve" }, form); });
    reject.addEventListener("click", () => { lock(); onSubmit({ requestId, kind, value: "deny" }, form); });
    row.append(approve, reject);
    form.append(row);
  } else {
    const label = document.createElement("label");
    label.className = "input-field";
    label.textContent = kind === "clarify" ? "Your answer" : kind === "sudo" ? "Sudo password" : "Secret";
    let field;
    if (kind === "clarify") {
      field = document.createElement("textarea");
      field.rows = 2;
      field.maxLength = 4000;
    } else {
      field = document.createElement("input");
      field.type = "password";
      field.autocomplete = "off";
      field.spellcheck = false;
    }
    field.required = true;
    field.name = "value";
    label.append(field);
    const row = document.createElement("div");
    row.className = "input-actions";
    submit.textContent = kind === "clarify" ? "Send answer" : "Send";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn input-secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { lock(); onCancel?.({ requestId, kind }, form); });
    row.append(submit, cancel);
    form.append(label, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const value = field.value;
      lock();
      field.value = "";
      onSubmit({ requestId, kind, value }, form);
    });
  }
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); onCancel?.({ requestId, kind }, form); }
  });
  return form;
}

export function stateLabel(state) {
  return STATE_LABELS[state] || state;
}

export { escapeHtml };
