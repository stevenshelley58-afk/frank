/* Hub API adapter — the single seam between the Hub browser modules and Frank.
   Every Hub fetch lives here so central route wiring (Session 1) changes one file.
   All mutations are non-GET with the contracted JSON content type, same-origin only.
   The browser never sees Hermes credentials, native event HTML, or private paths. */

const JSON_TYPE = "application/json";

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

async function errorFrom(response, fallback) {
  let message = fallback || `Frank returned HTTP ${response.status}.`;
  try {
    const data = await response.json();
    message = data.error || data.message || message;
  } catch { /* plain status text only */ }
  const error = new Error(message);
  error.status = response.status;
  return error;
}

/* Same-origin JSON mutation. Relative URLs are same-origin by construction;
   the strict Origin/Content-Type rejection itself is enforced server-side. */
async function mutate(url, body, { method = "POST", signal } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": JSON_TYPE },
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

async function readJson(url, fallbackError) {
  const response = await fetch(url);
  if (!response.ok) throw await errorFrom(response, fallbackError);
  return response.json();
}

export const routes = {
  sessions: "/api/chat/sessions",
  sessionModel: (chatId) => `/api/chat/sessions/${encodeURIComponent(chatId)}/model`,
  history: (chatId) => `/api/chat?session_id=${encodeURIComponent(chatId)}`,
  turn: "/api/chat/turn",
  stop: "/api/chat/stop",
  respond: "/api/chat/respond",
  steer: "/api/chat/steer",
  replay: (chatId, afterSeq) => `/api/chat/events?session_id=${encodeURIComponent(chatId)}&after=${encodeURIComponent(afterSeq)}`,
  uploads: "/api/chat/uploads",
  vpsAttach: "/api/chat/attachments/vps",
  models: "/api/models",
  transcribe: "/api/audio/transcribe",
};

/* One stable identity per logical submission. Retried turns deliberately
   mint a NEW id; ambiguous replays reuse the ORIGINAL id (contract §2). */
export function newTurnId() {
  return uuid();
}

export async function fetchSessions() {
  const data = await readJson(routes.sessions, "Could not load chats");
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function createSession({ title = "New chat", model = "", provider = "", projectId = "" } = {}) {
  return mutate(routes.sessions, {
    title,
    model: model || undefined,
    provider: provider || undefined,
    project_id: projectId || undefined,
  });
}

export async function setSessionModel(chatId, { model, provider }) {
  return mutate(routes.sessionModel(chatId), { model, provider });
}

export async function fetchHistory(chatId) {
  const data = await readJson(routes.history(chatId), "Could not load this chat");
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    projectId: data.project_id || "",
  };
}

/* Submit one turn. `turnId` is the stable Frank turn identity; the same value
   doubles as the upstream durable idempotency key. 409-class conflicts are
   already-accepted submissions, surfaced to the caller via `replayed`. */
export async function submitTurn({ chatId, text, attachments, turnId, model, provider, signal }) {
  const response = await fetch(routes.turn, {
    method: "POST",
    headers: {
      "Content-Type": JSON_TYPE,
      "Idempotency-Key": turnId,
    },
    signal,
    body: JSON.stringify({
      chat_id: chatId,
      text,
      attachments,
      turn_id: turnId,
      model: model || undefined,
      provider: provider || undefined,
    }),
  });
  if (response.status === 409) return { replayed: true, response };
  if (!response.ok || !response.body) throw await errorFrom(response, "Hub did not accept the turn");
  return { replayed: false, response };
}

export async function stopRun({ chatId, runId }) {
  return mutate(routes.stop, { chat_id: chatId, run_id: runId || undefined });
}

/* One response per native request identity. kind: approval | clarify | sudo | secret. */
export async function respondInput({ chatId, runId, requestId, kind, value }) {
  return mutate(routes.respond, {
    chat_id: chatId,
    run_id: runId || undefined,
    request_id: requestId,
    kind,
    value,
  });
}

export async function steerSubagent({ chatId, runId, subagentId, instruction }) {
  return mutate(routes.steer, {
    chat_id: chatId,
    run_id: runId || undefined,
    subagent_id: subagentId,
    instruction,
  });
}

/* Durable event replay after reconnect/reload. When this route is not yet
   wired the caller reconciles from the authoritative transcript instead. */
export async function replayEvents(chatId, afterSeq, signal) {
  const response = await fetch(routes.replay(chatId, afterSeq), { signal });
  if (response.status === 404) return { available: false };
  if (!response.ok) throw await errorFrom(response, "Could not resume the activity stream");
  return { available: true, response };
}

export async function fetchModels() {
  const data = await readJson(routes.models, "Could not load models");
  return Array.isArray(data.models) ? data.models : [];
}

/* Attachments: upload multipart, detach by id. The browser only ever handles
   the browser-safe DTO {id, name, size, mime, project_ref}. */
export async function uploadFiles(items) {
  if (!items.length) return [];
  const form = new FormData();
  for (const item of items) {
    form.append("files", item.file, item.file.name);
    form.append("paths", item.path || item.file.webkitRelativePath || item.file.name);
  }
  const response = await fetch(routes.uploads, { method: "POST", body: form });
  if (!response.ok) throw await errorFrom(response, "Upload failed");
  const data = await response.json();
  return Array.isArray(data.attachments) ? data.attachments : [];
}

export async function detachUploads(ids) {
  if (!ids.length) return { deleted: [], missing: [] };
  return mutate(routes.uploads, { ids }, { method: "DELETE" });
}

/* Attach a VPS Explorer selection. The browser sends only the typed selection
   identity {root, path, kind}; the server resolves it against the attachment
   manifest and returns the browser-safe DTO or an explicit refusal. */
export async function attachVpsSelection({ root, path, kind, chatId }) {
  return mutate(routes.vpsAttach, { root, path, kind, chat_id: chatId || undefined });
}

/* Speech to text. {data_url, mime_type?} per contract §6; language is
   server-configured; silence is HTTP 200 {ok:true,transcript:""}. */
export async function transcribe({ dataUrl, mimeType, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Transcription timed out.", "TimeoutError")), 90_000);
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  try {
    return await mutate(routes.transcribe, { data_url: dataUrl, mime_type: mimeType || undefined }, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
