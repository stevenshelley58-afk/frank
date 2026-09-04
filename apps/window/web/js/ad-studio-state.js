const objectValue = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const STATUS_RANK = { queued: 0, started: 1, running: 2, completed: 3, failed: 3, cancelled: 3 };
const STAGE_RANK = { source: 0, build: 1, render: 2, compare: 3, "final-check": 4, live: 5 };
const SUPERSEDED_STATUSES = new Set(["failed", "cancelled"]);

const cleanPart = (value) => String(value ?? "").trim().toLowerCase();

function templateId(run) {
  return String(
    run?.output?.import?.template_id
      || run?.output?.template_id
      || run?.output?.template_pack?.template_id
      || "",
  ).trim();
}

export function runTimestamp(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareRunRecency(left, right) {
  const updated = runTimestamp(right?.updated_at) - runTimestamp(left?.updated_at);
  if (updated) return updated;
  const created = runTimestamp(right?.created_at) - runTimestamp(left?.created_at);
  if (created) return created;
  return String(right?.id || "").localeCompare(String(left?.id || ""));
}

export function runHistoryGroupKey(run) {
  const project = cleanPart(run?.project_id) || "workspace";
  const sourceIdentity = cleanPart(run?.source?.sha256 || run?.source?.content_hash || run?.source?.ref);
  if (sourceIdentity) return [project, "source-id", sourceIdentity].join("::");
  const sourceName = cleanPart(run?.source?.name);
  if (sourceName) {
    return [project, "source", sourceName, cleanPart(run?.source?.size), cleanPart(run?.source?.media_type)].join("::");
  }
  const template = cleanPart(templateId(run));
  if (template) return [project, "template", template].join("::");
  return [project, "run", cleanPart(run?.id || run?.title) || "unknown"].join("::");
}

export function groupAdStudioRuns(runs) {
  const grouped = new Map();
  (Array.isArray(runs) ? runs : []).filter((run) => run?.id).forEach((run) => {
    const key = runHistoryGroupKey(run);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(run);
  });
  return [...grouped.entries()].map(([key, recorded]) => {
    const attempts = [...recorded].sort(compareRunRecency);
    const primary = attempts[0];
    const older = attempts.slice(1);
    return {
      key,
      primary,
      attempts,
      history: older.filter((run) => !SUPERSEDED_STATUSES.has(cleanPart(run?.status))),
      superseded: older.filter((run) => SUPERSEDED_STATUSES.has(cleanPart(run?.status))),
      sourceLabel: String(primary?.source?.name || primary?.title || "Untitled source").trim(),
      templateLabel: attempts.map(templateId).find(Boolean) || "",
    };
  }).sort((left, right) => compareRunRecency(left.primary, right.primary));
}

function mergeRecordedObject(previous, incoming) {
  const merged = { ...objectValue(previous) };
  Object.entries(objectValue(incoming)).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) merged[key] = mergeRecordedArray(merged[key], value);
    else if (objectValue(value) === value) merged[key] = mergeRecordedObject(merged[key], value);
    else merged[key] = value;
  });
  return merged;
}

function recordedValueKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const field of ["id", "artifact_id", "ref", "sha256", "content_hash", "url", "path"]) {
      const stable = String(value[field] ?? "").trim();
      if (stable) return `${field}:${stable}`;
    }
  }
  try { return `value:${JSON.stringify(value)}`; } catch { return `value:${String(value)}`; }
}

function mergeRecordedArray(previous, incoming) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(incoming) ? incoming : [];
  if (!after.length) return before;
  const recorded = new Map(before.map((value) => [recordedValueKey(value), value]));
  const beforeKeys = before.map(recordedValueKey);
  const afterKeys = [];
  after.forEach((value) => {
    const key = recordedValueKey(value);
    if (!afterKeys.includes(key)) afterKeys.push(key);
    if (objectValue(value) === value) recorded.set(key, mergeRecordedObject(recorded.get(key), value));
    else recorded.set(key, value);
  });
  return [...afterKeys, ...beforeKeys.filter((key) => !afterKeys.includes(key))].map((key) => recorded.get(key));
}

export function mergeIterationHistory(previous, incoming) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(incoming) ? incoming : [];
  if (!after.length) return before;
  const records = new Map();
  const iterationKey = (record) => {
    const iteration = Number(record?.iteration);
    return Number.isFinite(iteration) ? `iteration:${iteration}` : `record:${recordedValueKey(record)}`;
  };
  before.forEach((record) => records.set(iterationKey(record), record));
  after.forEach((record) => {
    const key = iterationKey(record);
    records.set(key, mergeRecordedObject(records.get(key), record));
  });
  return [...records.values()].sort((left, right) => {
    const leftIteration = Number(left?.iteration);
    const rightIteration = Number(right?.iteration);
    if (Number.isFinite(leftIteration) && Number.isFinite(rightIteration)) return leftIteration - rightIteration;
    if (Number.isFinite(leftIteration)) return -1;
    if (Number.isFinite(rightIteration)) return 1;
    return 0;
  });
}

export function mergeAdStudioRun(previous, incoming) {
  const current = objectValue(previous);
  const next = objectValue(incoming);
  if (!Object.keys(current).length) return next;
  if (!Object.keys(next).length || (current.id && next.id && current.id !== next.id)) return current;
  const currentUpdated = runTimestamp(current.updated_at);
  const nextUpdated = runTimestamp(next.updated_at);
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
    topLevel.updated_at = current.updated_at || next.updated_at || 0;
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
  return [...recorded.values()].sort(compareRunRecency);
}

export function runListRenderSignature(runs) {
  return JSON.stringify((Array.isArray(runs) ? runs : []).map((run) => [
    run?.id || "",
    run?.title || "",
    run?.project_id || "",
    run?.status || "",
    Math.floor(runTimestamp(run?.updated_at) / 60_000),
    runHistoryGroupKey(run),
    templateId(run),
  ]));
}
