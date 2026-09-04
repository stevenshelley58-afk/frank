const objectValue = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const STATUS_RANK = { queued: 0, started: 1, running: 2, completed: 3, failed: 3, cancelled: 3 };
const STAGE_RANK = { source: 0, build: 1, render: 2, compare: 3, "final-check": 4, live: 5 };

function mergeRecordedObject(previous, incoming) {
  const merged = { ...objectValue(previous) };
  Object.entries(objectValue(incoming)).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  });
  return merged;
}

function mergeRecordedArray(previous, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return Array.isArray(previous) ? previous : [];
  return incoming;
}

export function mergeIterationHistory(previous, incoming) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(incoming) ? incoming : [];
  if (!after.length) return before;
  const records = new Map();
  before.forEach((record) => records.set(Number(record?.iteration), record));
  after.forEach((record) => {
    const iteration = Number(record?.iteration);
    const current = objectValue(records.get(iteration));
    const next = objectValue(record);
    records.set(iteration, {
      ...current,
      ...next,
      comparison: { ...objectValue(current.comparison), ...objectValue(next.comparison) },
      previews: mergeRecordedArray(current.previews, next.previews),
    });
  });
  return [...records.values()].sort((left, right) => Number(left?.iteration) - Number(right?.iteration));
}

export function mergeAdStudioRun(previous, incoming) {
  const current = objectValue(previous);
  const next = objectValue(incoming);
  if (!Object.keys(current).length) return next;
  if (!Object.keys(next).length || (current.id && next.id && current.id !== next.id)) return current;
  const currentUpdated = Number(current.updated_at || 0);
  const nextUpdated = Number(next.updated_at || 0);
  // Hermes timestamps are second-based. On equality, keep the already-rendered
  // snapshot authoritative for conflicts while still accepting missing fields.
  const incomingIsStale = nextUpdated <= currentUpdated;
  const topLevel = incomingIsStale
    ? { ...next, ...current }
    : { ...current, ...next };
  if (incomingIsStale) {
    if ((STATUS_RANK[next.status] ?? -1) > (STATUS_RANK[current.status] ?? -1)) topLevel.status = next.status;
    if ((STAGE_RANK[next.stage] ?? -1) > (STAGE_RANK[current.stage] ?? -1)) topLevel.stage = next.stage;
    topLevel.progress = Math.max(Number(current.progress || 0), Number(next.progress || 0));
    topLevel.updated_at = Math.max(currentUpdated, nextUpdated);
  }
  const currentOutput = objectValue(current.output);
  const nextOutput = objectValue(next.output);
  const earlierOutput = incomingIsStale ? nextOutput : currentOutput;
  const laterOutput = incomingIsStale ? currentOutput : nextOutput;
  const output = {
    ...earlierOutput,
    ...laterOutput,
    iterations: mergeIterationHistory(earlierOutput.iterations, laterOutput.iterations),
  };
  if (earlierOutput.previews || laterOutput.previews) output.previews = mergeRecordedArray(earlierOutput.previews, laterOutput.previews);
  if (earlierOutput.final_review || laterOutput.final_review) output.final_review = mergeRecordedObject(earlierOutput.final_review, laterOutput.final_review);
  const earlierSource = incomingIsStale ? objectValue(next.source) : objectValue(current.source);
  const laterSource = incomingIsStale ? objectValue(current.source) : objectValue(next.source);
  const earlierUsage = incomingIsStale ? objectValue(next.usage) : objectValue(current.usage);
  const laterUsage = incomingIsStale ? objectValue(current.usage) : objectValue(next.usage);
  return {
    ...topLevel,
    source: mergeRecordedObject(earlierSource, laterSource),
    usage: mergeRecordedObject(earlierUsage, laterUsage),
    model_profile: mergeRecordedObject(current.model_profile, next.model_profile),
    output,
  };
}

export function mergeAdStudioRunList(previous, incoming) {
  const before = Array.isArray(previous) ? previous.filter((run) => run?.id) : [];
  const after = Array.isArray(incoming) ? incoming.filter((run) => run?.id) : [];
  // A list response is a polling snapshot, not a deletion ledger. Hermes can
  // briefly return an empty or truncated page while recovering, so only an
  // explicit operator action may remove durable history from the UI session.
  if (!after.length) return before;
  const recorded = new Map(before.map((run) => [run.id, run]));
  after.forEach((run) => recorded.set(run.id, mergeAdStudioRun(recorded.get(run.id), run)));
  return [...recorded.values()].sort((left, right) => Number(right?.created_at || 0) - Number(left?.created_at || 0));
}

export function runListRenderSignature(runs) {
  return JSON.stringify((Array.isArray(runs) ? runs : []).map((run) => [
    run?.id || "",
    run?.title || "",
    run?.project_id || "",
    run?.status || "",
    Math.floor(Number(run?.updated_at || 0) / 60),
  ]));
}
