const DEFAULT_DEADLINE_MS = 15000;

function text(value, limit = 500) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, limit);
}

function key() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `mini-${globalThis.crypto.randomUUID()}`;
  }
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    return `mini-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("Mini Frank needs secure browser randomness.");
}

function version(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value == null ? "" : value), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function commandPayload(payload, options = {}) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  const baseVersion = version(options.baseVersion ?? options.base_version);
  if (baseVersion !== null) body.base_version = baseVersion;
  return body;
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
  if (typeof fetchImpl !== "function") throw new Error("Frank needs a browser fetch implementation.");

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
    if (isMutation && !headers["Idempotency-Key"]) {
      headers["Idempotency-Key"] = text(options.idempotencyKey, 200) || key();
    }
    const baseVersion = version(options.baseVersion ?? options.base_version);
    if (isMutation && baseVersion !== null && !headers["X-Mini-Base-Version"]) {
      headers["X-Mini-Base-Version"] = String(baseVersion);
      headers["If-Match"] = `"${baseVersion}"`;
    }
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
        throw new MiniApiError(text(body.error) || "Something went wrong. Review this page before trying again.", {
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
          callerCancelled ? "I stopped waiting. Review this conversation before trying again." : "Couldn’t finish that request. Review this conversation before trying again.",
          { name: callerCancelled ? "AbortError" : "DeadlineError", code: callerCancelled ? "cancelled" : "deadline_exceeded" },
        );
      }
      throw new MiniApiError("I could not reach Frank. Review this conversation before trying again.", {
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
    createIntake: (conversation, options = {}) => request("/api/mini/intakes", {
      ...options,
      method: "POST",
      headers: {
        ...(text(options.accountClaim, 300) ? { "X-Mini-Account-Claim": text(options.accountClaim, 300) } : {}),
        ...(options.headers || {}),
      },
      json: commandPayload(conversation.length ? { conversation } : {}, options),
    }),
    readIntake: (access) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}`, access),
    abandonIntake: (access) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}`, access, { method: "DELETE" }),
    uploadIntake: (access, files) => {
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      return collection(`/api/mini/intakes/${encodeURIComponent(access.id)}/attachments`, access, { method: "POST", body: form });
    },
    removeIntakeAttachment: (access, attachmentId) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}/attachments/${encodeURIComponent(attachmentId)}`, access, { method: "DELETE" }),
    submitIntake: (access, payload, options = {}) => collection(`/api/mini/intakes/${encodeURIComponent(access.id)}/submit`, access, { ...options, method: "POST", json: commandPayload(payload, options) }),
    readJob: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}`, access),
    retryJob: (access, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/dispatch`, access, { ...options, method: "POST" }),
    uploadJob: (access, files) => {
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      return collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/attachments`, access, { method: "POST", body: form });
    },
    removeJobAttachment: (access, attachmentId) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/attachments/${encodeURIComponent(attachmentId)}`, access, { method: "DELETE" }),
    changeJob: (access, change, attachmentIds = [], options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/changes`, access, { ...options, method: "POST", json: commandPayload({ change, attachment_ids: attachmentIds }, options) }),
    feedbackJob: (access, feedback, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/feedback`, access, { ...options, method: "POST", json: commandPayload(feedback, options) }),
    readGuidance: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/guidance`, access),
    readSelfHostGuide: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/self-host-guide`, access),
    readSharing: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/sharing`, access),
    updateSharing: (access, sharing, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/sharing`, access, { ...options, method: "PATCH", json: commandPayload(sharing, options) }),
    createShare: (access, share, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/shares`, access, { ...options, method: "POST", json: commandPayload(share, options) }),
    rotateShare: (access, shareId, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/shares/${encodeURIComponent(shareId)}/rotate`, access, { ...options, method: "POST", json: commandPayload({}, options) }),
    revokeShare: (access, shareId, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/shares/${encodeURIComponent(shareId)}`, access, { ...options, method: "DELETE", json: commandPayload({}, options) }),
    readShared: (token) => request(`/api/mini/shares/${encodeURIComponent(token)}`),
    readPublished: (jobId) => request(`/api/mini/published/${encodeURIComponent(jobId)}`),
    readSharedComments: (token) => request(`/api/mini/shares/${encodeURIComponent(token)}/comments`),
    createSharedComment: (token, comment, options = {}) => request(`/api/mini/shares/${encodeURIComponent(token)}/comments`, { ...options, method: "POST", json: commandPayload(comment, options) }),
    readServiceOptions: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/service-options`, access),
    readServiceRequests: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/service-requests`, access),
    createServiceRequest: (access, service, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/service-requests`, access, { ...options, method: "POST", json: commandPayload(service, options) }),
    tipConfig: () => request("/api/mini/tips/config"),
    createTip: (tip, options = {}) => request("/api/mini/tips/intents", { ...options, method: "POST", json: commandPayload(tip, options) }),
    createJobTip: (access, tip, options = {}) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/tips/intents`, access, { ...options, method: "POST", json: commandPayload(tip, options) }),
    deleteJob: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}`, access, { method: "DELETE" }),
    revokeJob: (access) => collection(`/api/mini/jobs/${encodeURIComponent(access.id)}/revoke`, access, { method: "POST" }),
  };
}
