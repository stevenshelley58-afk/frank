const RUNS_ROOT = "/api/ad-studio/runs";

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;
  const message = payload?.error?.message || payload?.message || payload?.error || `Request failed (${response.status})`;
  throw new Error(String(message));
}

export async function listAdStudioRuns({ projectId = "", limit = 100 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (projectId) query.set("project_id", projectId);
  const payload = await responseJson(await fetch(`${RUNS_ROOT}?${query}`));
  return Array.isArray(payload.runs) ? payload.runs : [];
}

export async function getAdStudioRun(runId) {
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

export const retryAdStudioRun = (runId, fromStage = "") => runAction(runId, "retry", fromStage ? { from_stage: fromStage } : {});
export const cancelAdStudioRun = (runId, reason = "") => runAction(runId, "cancel", reason ? { reason } : {});
export const approveAdStudioTemplate = (runId) => runAction(runId, "approve");
export const requestAdStudioTemplateChanges = (runId, instructions) => runAction(runId, "request-changes", { instructions });
export const discardAdStudioTemplate = (runId, reason = "") => runAction(runId, "discard", reason ? { reason } : {});

