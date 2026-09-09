/* Frank normalized event envelope handling (contract v0.21 §3).
   The SSE framing parser in ../chat-stream.js only chunks bytes; every event
   it emits reaches here and then the renderer registry. Nothing is classified,
   filtered or discarded at this layer: unknown native events are retained
   verbatim under derived_label "unknown", never dropped and never guessed. */

export const DERIVED_LABELS = new Set([
  "terminal_error",
  "provider_error",
  "approval_required",
  "tool_progress",
  "assistant_message",
  "reasoning_delta",
  "todo_updated",
  "subagent_lifecycle",
  "unknown",
]);

/* Legacy frames are the pre-envelope shapes Frank's current transport emits.
   They map onto the canonical envelope with frank_origin:false so the same
   renderer registry serves both. Native names stay verbatim. */
const LEGACY_TEXT_DELTAS = new Set(["assistant.delta", "response.output_text.delta"]);
const LEGACY_REASONING_DELTAS = new Set(["reasoning.delta"]);
const LEGACY_REASONING_SNAPSHOTS = new Set(["reasoning.available", "reasoning.snapshot"]);
const LEGACY_THINKING_STATUS = new Set(["thinking.delta", "thinking.status"]);

function payloadText(data, ...fields) {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function legacyEnvelope(event, data) {
  const type = String(data?.type || event || "");
  const payload = { ...data };
  if (LEGACY_TEXT_DELTAS.has(type) || LEGACY_TEXT_DELTAS.has(event)) {
    return { derivedLabel: "assistant_message", payload: { ...payload, phase: "delta", text: payloadText(data, "delta", "content", "text") } };
  }
  if (type === "assistant.completed" || event === "assistant.completed") {
    return { derivedLabel: "assistant_message", payload: { ...payload, phase: "final", text: payloadText(data, "content", "text") } };
  }
  if (LEGACY_REASONING_DELTAS.has(type) || LEGACY_REASONING_DELTAS.has(event)) {
    return { derivedLabel: "reasoning_delta", payload: { ...payload, phase: "delta", text: payloadText(data, "delta", "text", "content") } };
  }
  if (LEGACY_REASONING_SNAPSHOTS.has(type) || LEGACY_REASONING_SNAPSHOTS.has(event)) {
    return { derivedLabel: "reasoning_delta", payload: { ...payload, phase: "replace", text: payloadText(data, "text", "delta", "preview", "content") } };
  }
  if ((type === "tool.progress" || event === "tool.progress") && data?.tool_name === "_thinking") {
    return { derivedLabel: "reasoning_delta", payload: { ...payload, phase: "replace", text: payloadText(data, "delta", "preview", "text", "content") } };
  }
  if (LEGACY_THINKING_STATUS.has(type) || LEGACY_THINKING_STATUS.has(event)) {
    return { derivedLabel: "reasoning_delta", payload: { ...payload, phase: "status", text: payloadText(data, "text", "delta", "content") } };
  }
  if (type === "tool.started" || event === "tool.started" || (type === "response.output_item.done" && data?.item?.type === "function_call")) {
    return { derivedLabel: "tool_progress", payload: { phase: "started", tool: data?.tool_name || data?.item?.name || data?.name || "tool" } };
  }
  if (type === "tool.progress" || event === "tool.progress") {
    return { derivedLabel: "tool_progress", payload: { phase: "progress", tool: data?.tool_name || data?.name || "tool", detail: payloadText(data, "delta", "preview", "detail") } };
  }
  if (type === "tool.completed" || event === "tool.completed") {
    return { derivedLabel: "tool_progress", payload: { phase: "completed", tool: data?.tool_name || data?.name || "tool", ok: data?.ok !== false } };
  }
  if (type === "run.completed" || event === "run.completed" || type === "done" || event === "done") {
    return { derivedLabel: "assistant_message", payload: { phase: "complete" } };
  }
  if (type === "run.cancelled" || event === "run.cancelled" || type === "run.stopped" || event === "run.stopped") {
    return { derivedLabel: "assistant_message", payload: { phase: "cancelled" } };
  }
  if (type === "error" || event === "error") {
    return { derivedLabel: "provider_error", payload: { text: payloadText(data, "content", "message") || "Hermes returned an error." } };
  }
  if (type === "run.failed" || event === "run.failed") {
    return { derivedLabel: "terminal_error", payload: { text: payloadText(data, "error", "message") || "The run failed." } };
  }
  return null;
}

/* Map one SSE frame to the canonical envelope. Returns null only for frames
   with no data payload at all (SSE comments/keepalives). */
export function normalizeEvent(event, data) {
  if (data == null) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      seq: null,
      nativeEvent: String(event || "message"),
      derivedLabel: "unknown",
      runId: "",
      sessionId: "",
      timestamp: 0,
      payload: { raw: data },
      frankOrigin: false,
      malformed: true,
    };
  }
  if (data.seq != null && typeof data.derived_label === "string" && data.native_event != null) {
    const label = DERIVED_LABELS.has(data.derived_label) ? data.derived_label : "unknown";
    return {
      seq: Number(data.seq),
      nativeEvent: String(data.native_event),
      derivedLabel: label,
      runId: String(data.run_id || ""),
      sessionId: String(data.session_id || ""),
      timestamp: Number(data.timestamp || 0),
      payload: data.payload && typeof data.payload === "object" && !Array.isArray(data.payload) ? data.payload : { value: data.payload },
      frankOrigin: Boolean(data.frank_origin),
    };
  }
  const legacy = legacyEnvelope(event, data);
  if (legacy) {
    return {
      seq: data.seq != null ? Number(data.seq) : null,
      nativeEvent: String(data.type || event || "message"),
      derivedLabel: legacy.derivedLabel,
      runId: String(data.run_id || ""),
      sessionId: String(data.session_id || ""),
      timestamp: Number(data.timestamp || 0),
      payload: legacy.payload,
      frankOrigin: false,
    };
  }
  return {
    seq: data.seq != null ? Number(data.seq) : null,
    nativeEvent: String(data.type || event || "message"),
    derivedLabel: "unknown",
    runId: String(data.run_id || ""),
    sessionId: String(data.session_id || ""),
    timestamp: Number(data.timestamp || 0),
    payload: { ...data },
    frankOrigin: false,
  };
}

/* Exactly-once delivery: dedupe by seq (contract §3), falling back to
   native event identity for transports that do not number frames. */
export class EventDeduper {
  constructor() {
    this.seenSeq = new Set();
    this.seenEvent = new Set();
  }

  firstTime(envelope) {
    if (envelope.seq != null) {
      if (this.seenSeq.has(envelope.seq)) return false;
      this.seenSeq.add(envelope.seq);
      return true;
    }
    const id = envelope.payload?.event_id || `${envelope.nativeEvent}|${JSON.stringify(envelope.payload).slice(0, 200)}`;
    if (this.seenEvent.has(id)) return false;
    this.seenEvent.add(id);
    return true;
  }
}

export function highestSeq(envelopes) {
  let max = -1;
  for (const envelope of envelopes) {
    if (envelope.seq != null && envelope.seq > max) max = envelope.seq;
  }
  return max;
}
