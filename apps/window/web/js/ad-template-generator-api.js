const RUNS_ROOT = "/api/ad-template-generator/runs";

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;
  const message = payload?.error?.message || payload?.message || payload?.error || `Request failed (${response.status})`;
  throw new Error(String(message));
}

export async function listAdTemplateGeneratorRuns({ projectId = "", limit = 100 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (projectId) query.set("project_id", projectId);
  const payload = await responseJson(await fetch(`${RUNS_ROOT}?${query}`));
  return Array.isArray(payload.runs) ? payload.runs : [];
}

export async function getAdTemplateGeneratorRun(runId) {
  const payload = await responseJson(await fetch(`${RUNS_ROOT}/${encodeURIComponent(runId)}`));
  return payload.run || null;
}

async function runAction(runId, action, body = {}) {
  const payload = await responseJson(await fetch(`${RUNS_ROOT}/${encodeURIComponent(runId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return payload.run || null;
}

export const retryAdTemplateGeneratorRun = (runId) => runAction(runId, "retry");
export const cancelAdTemplateGeneratorRun = (runId, reason = "") => runAction(runId, "cancel", reason ? { reason } : {});
export const approveAdTemplateGeneratorTemplate = (runId) => runAction(runId, "approve");
export const requestAdTemplateGeneratorTemplateChanges = (runId, instructions) => runAction(runId, "request-changes", { instructions });
export const discardAdTemplateGeneratorTemplate = (runId, reason = "") => runAction(runId, "discard", reason ? { reason } : {});

function safeRecordedMessage(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(api[-_ ]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[redacted]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function adTemplateGeneratorStartError(error) {
  const code = String(error?.code || "");
  const recorded = safeRecordedMessage(error?.message);
  if (code === "hermes_rejected") {
    return recorded && !recorded.startsWith("[object")
      ? recorded
      : "Hermes rejected this run. Check the model setup and try again.";
  }
  return ({
    source_missing: "This image is no longer available. Add it again.",
    empty_file: "This image is empty. Choose another file.",
    unsupported_type: "This file is not a supported image.",
    type_mismatch: "This file is not a supported image.",
    invalid_image: "This file does not appear to be a valid image.",
    file_too_large: "This image is too large.",
    batch_too_large: "These images are too large to start together.",
    hermes_unavailable: "This image could not be started just now. Try again.",
    invalid_hermes_response: "This image could not be started. Try again.",
  })[code] || (recorded && !recorded.startsWith("[object") ? recorded : "This image could not be started. Try again.");
}
