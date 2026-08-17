const TEXT_DELTA_EVENTS = new Set(["assistant.delta", "response.output_text.delta"]);
const REASONING_DELTA_EVENTS = new Set(["reasoning.delta"]);
const REASONING_SNAPSHOT_EVENTS = new Set(["reasoning.available"]);

function eventText(data, ...fields) {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export function classifyChatStreamEvent(event, data) {
  const type = String(data?.type || event || "");
  if (TEXT_DELTA_EVENTS.has(type) || TEXT_DELTA_EVENTS.has(event)) {
    return { kind: "assistant.delta", text: eventText(data, "delta", "content", "text") };
  }
  if (REASONING_DELTA_EVENTS.has(type) || REASONING_DELTA_EVENTS.has(event)) {
    return { kind: "reasoning.delta", text: eventText(data, "delta", "text", "content") };
  }
  if (REASONING_SNAPSHOT_EVENTS.has(type) || REASONING_SNAPSHOT_EVENTS.has(event)) {
    return { kind: "reasoning.replace", text: eventText(data, "text", "delta", "preview", "content") };
  }
  if ((type === "tool.progress" || event === "tool.progress") && data?.tool_name === "_thinking") {
    return { kind: "reasoning.replace", text: eventText(data, "delta", "preview", "text", "content") };
  }
  if (type === "thinking.delta" || event === "thinking.delta") {
    return { kind: "thinking.status", text: eventText(data, "text", "delta", "content") };
  }
  if (type === "response.output_item.done" && data?.item?.type === "function_call") {
    return { kind: "tool.started", name: data.item.name || "tool" };
  }
  if (event === "tool.started" || type === "tool.started") {
    return { kind: "tool.started", name: data?.tool_name || data?.name || "tool" };
  }
  if (event === "assistant.completed" || type === "assistant.completed") {
    return { kind: "assistant.completed", text: eventText(data, "content", "text") };
  }
  if (event === "error" || type === "error") {
    return { kind: "error", text: eventText(data, "content", "message") || "Hermes returned an error." };
  }
  if (event === "done" || type === "done" || event === "run.completed" || type === "run.completed") {
    return { kind: "done" };
  }
  return { kind: "other" };
}

function parseBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export class SseEventParser {
  constructor() {
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += String(chunk || "");
    return this.#drain(false);
  }

  finish(chunk = "") {
    this.buffer += String(chunk || "");
    return this.#drain(true);
  }

  #drain(final) {
    const events = [];
    let match = /\r?\n\r?\n/.exec(this.buffer);
    while (match) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
      match = /\r?\n\r?\n/.exec(this.buffer);
    }
    if (final && this.buffer.trim()) {
      const parsed = parseBlock(this.buffer);
      if (parsed) events.push(parsed);
      this.buffer = "";
    }
    return events;
  }
}
