export function parseSseBlock(block) {
  let event = "message";
  const lines = [];
  String(block || "").split(/\r?\n/).forEach((raw) => {
    if (!raw || raw.startsWith(":")) return;
    if (raw.startsWith("event:")) event = raw.slice(6).trim() || "message";
    if (raw.startsWith("data:")) lines.push(raw.slice(5).replace(/^ /, ""));
  });
  if (!lines.length) return null;
  const joined = lines.join("\n");
  if (joined === "[DONE]") return { event: "done", data: {} };
  try { return { event, data: JSON.parse(joined) }; }
  catch (_error) { return { event, data: { text: joined } }; }
}
export function eventType(event, data) {
  return String((data && data.type) || event || "");
}

export function isAssistantCompleted(event, data) {
  return ["assistant.completed", "response.output_text.done"].includes(eventType(event, data));
}

export function streamPiece(event, data) {
  const type = eventType(event, data);
  const text = [data && data.delta, data && data.content, data && data.text, data && data.message]
    .find((value) => typeof value === "string" && value) || "";
  if (["assistant.delta", "response.output_text.delta", "delta", "token"].includes(type)) {
    return { mode: "append", text };
  }
  if (isAssistantCompleted(event, data)) return { mode: "replace", text };
  if (type === "error" || event === "error") throw new Error(text || "The guide could not reply.");
  return { mode: "ignore", text: "" };
}
