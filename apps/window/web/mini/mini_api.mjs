const DEFAULT_DEADLINE_MS = 15000;

function text(value, limit = 500) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, limit);
}

function key() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `mini-${globalThis.crypto.randomUUID()}`;
  }
  return `mini-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class MiniApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = options.name || "MiniApiError";
    this.status = options.status;
    this.code = options.code || "";
  }
}

export function createMiniApi({ fetchImpl = globalThis.fetch, deadlineMs = DEFAULT_DEADLINE_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Mini Frank needs a browser fetch implementation.");

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.deadlineMs || deadlineMs);
    const externalSignal = options.signal;
    const abortFromCaller = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };
    if (isMutation && !headers["Idempotency-Key"]) headers["Idempotency-Key"] = key();
    const requestOptions = {
      cache: "no-store",
      credentials: "omit",
      method,
      headers,
      signal: controller.signal,
    };
    if (options.json !== undefined) {
      requestOptions.body = JSON.stringify(options.json);
      requestOptions.headers["Content-Type"] = "application/json";
    } else if (options.body !== undefined) {
      requestOptions.body = options.body;
    }
    try {
      const response = await fetchImpl(path, requestOptions);
      let body = {};
      try { body = await response.json(); }
      catch (_error) { body = {}; }
      if (!response.ok) {
        throw new MiniApiError(text(body.error) || "Something went wrong. Your work is still safe.", {
          status: response.status,
          code: text(body.code || body.error_code, 100),
        });
      }
      return body;
    } catch (error) {
      if (error instanceof MiniApiError) throw error;
      if (controller.signal.aborted) {
        const callerCancelled = Boolean(externalSignal && externalSignal.aborted);
        throw new MiniApiError(
          callerCancelled ? "I stopped waiting. Your messages and files are still here." : "That request took too long. Your messages and files are still here.",
          { name: callerCancelled ? "AbortError" : "DeadlineError", code: callerCancelled ? "cancelled" : "deadline_exceeded" },
        );
      }
      throw new MiniApiError("I could not reach Mini Frank. Your messages and files are still here.", {
        name: "NetworkError",
        code: "network_error",
      });
    } finally {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener("abort", abortFromCaller);
    }
  }

  function accessHeaders(access) {
    const claim = text(access && access.claim, 300);
    return {
      "X-Mini-Claim": claim,
      ...(claim ? { Authorization: `Bearer ${claim}` } : {}),
    };
  }

  function collection(path, access, options = {}) {
    return request(path, { ...options, headers: { ...accessHeaders(access), ...(options.headers || {}) } });
  }

  return {
    config: () => request("/api/mini/config"),
    createIntake: (conversation) => request("/api/mini/intakes", {
      method: "POST",
      json: conversation.length ? { conversation } : {},
    }),
    readIntake: (access) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}`, access),
    abandonIntake: (access) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}`, access, { method: "DELETE" }),
    uploadIntake: (access, files) => {
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      return collection(`/api/mini/intakes/${encodeURIComponent(access.id)}/attachments`, access, { method: "POST", body: form });
    },
    removeIntakeAttachment: (access, attachmentId) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}/attachments/${encodeURIComponent(attachmentId)}`, access, { method: "DELETE" }),
    submitIntake: (access, payload, options = {}) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}/submit`, access, { ...options, method: "POST", json: payload }),
    readJob: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}`, access),
    retryJob: (access, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/dispatch`, access, { ...options, method: "POST" }),
    uploadJob: (access, files) => {
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      return collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/attachments`, access, { method: "POST", body: form });
    },
    removeJobAttachment: (access, attachmentId) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/attachments/${encodeURIComponent(attachmentId)}`, access, { method: "DELETE" }),
    changeJob: (access, change, attachmentIds = [], options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/changes`, access, { ...options, method: "POST", json: { change, attachment_ids: attachmentIds } }),
    feedbackJob: (access, payload) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/feedback`, access, { method: "POST", json: payload }),
    deleteJob: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}`, access, { method: "DELETE" }),
    revokeJob: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/revoke`, access, { method: "POST" }),
  };
}
