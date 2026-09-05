export const PROJECT_REFRESH_CONCURRENCY = 4;
export const PROJECT_REFRESH_UNAVAILABLE = "Couldn't update just now.";

function cleanProjectText(value, limit = 6000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, limit);
}

export function jobNextAction(job) {
  if (!job) return "Open this work to see where things are up to.";
  if (job.stage === "ready") return "Open the result or ask for a change.";
  if (job.stage === "needs_attention") return job.retry_available ? "There is one thing to try again." : "There is one thing to review.";
  if (job.stage === "queued") return "Your solution is queued.";
  if (job.stage === "checking") return "Giving it a final check.";
  if (job.stage === "working") return "We’re putting it together.";
  return "Open this work to see what happens next.";
}

export function receiptViewModel(job, { formatDate, formatDateTime }) {
  const stage = cleanProjectText(job && job.stage, 80);
  const hasTimestamp = (value) => Number(value) > 0;
  const now = stage === "needs_attention"
    ? "Needs you"
    : ["queued", "working", "checking"].includes(stage)
      ? "Working"
      : stage === "ready"
        ? "Ready to use"
        : "Saved";
  return {
    aim: cleanProjectText(job && job.problem, 400) || "Not recorded",
    now,
    next: jobNextAction(job),
    updated: hasTimestamp(job && job.updated_at) ? formatDateTime(job.updated_at) : "",
    availability: hasTimestamp(job && job.available_until) ? formatDate(job.available_until) : "",
    ready: stage === "ready" && Boolean(job && job.result),
  };
}

export function ownerReturnEvent(prior, job) {
  if (!prior || !prior.last_opened_stage) return "";
  const wasReadyWithResult = prior.last_opened_stage === "ready" && Boolean(prior.last_opened_had_result);
  const isReadyWithResult = job && job.stage === "ready" && Boolean(job.result);
  if (isReadyWithResult && !wasReadyWithResult) return "ready";
  if (job && job.stage === "needs_attention" && prior.last_opened_stage !== "needs_attention") return "needs_attention";
  return "";
}

export function jobRenderPolicy(source) {
  return { focusReceipt: source === "work", scrollToEnd: source === "start" };
}

export function workStatusLabel(item, labels) {
  if (item.return_event === "ready") return "Ready since you last opened it";
  if (item.return_event === "needs_attention") return "Needs you since you last opened it";
  return item.refresh_status === "unavailable" ? "Saved details" : (labels[item.stage] || "Saved");
}

export function workFreshness(item) {
  if (item.refresh_status === "unavailable") return "Showing saved information — couldn't refresh just now.";
  if (item.refresh_status === "live") return "Checked just now.";
  return "Saved in this browser.";
}

export function workNextAction(item) {
  return item.refresh_status === "unavailable" ? "Try opening this work again." : jobNextAction(item);
}

export function workRowAccessibleName(item, labels) {
  const title = cleanProjectText(item.title, 180) || "Your solution";
  return cleanProjectText(`Open ${title}. ${workStatusLabel(item, labels)}. ${workFreshness(item)} Next: ${workNextAction(item)}`, 500);
}

export function isCurrentProjectAccess(current, access, generation, currentGeneration) {
  return generation === currentGeneration
    && Boolean(current)
    && current.id === access.id
    && current.claim === access.claim;
}

export async function mapWithConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Number(limit) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

export function reconcileProjectRefresh(snapshot, outcomes, createLiveProject) {
  const stored = [];
  const display = [];
  outcomes.forEach((outcome, index) => {
    const prior = snapshot[index];
    if (!prior || !outcome || outcome.kind === "missing") return;
    const project = outcome.kind === "live"
      ? createLiveProject(prior, outcome.job)
      : { ...prior, refresh_status: "unavailable", refresh_error: PROJECT_REFRESH_UNAVAILABLE };
    stored.push(project);
    display.push({ ...project, return_event: outcome.returnEvent || "" });
  });
  return { stored, display };
}

export function canPersistProjectRefresh(initial, current) {
  return initial.revision === current.revision && initial.raw === current.raw;
}
