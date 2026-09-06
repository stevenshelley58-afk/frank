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

export const retryAdTemplateGeneratorRun = (runId, fromStage = "") => runAction(runId, "retry", fromStage ? { from_stage: fromStage } : {});
export const cancelAdTemplateGeneratorRun = (runId, reason = "") => runAction(runId, "cancel", reason ? { reason } : {});
export const approveAdTemplateGeneratorTemplate = (runId) => runAction(runId, "approve");
export const requestAdTemplateGeneratorTemplateChanges = (runId, instructions) => runAction(runId, "request-changes", { instructions });
export const discardAdTemplateGeneratorTemplate = (runId, reason = "") => runAction(runId, "discard", reason ? { reason } : {});
