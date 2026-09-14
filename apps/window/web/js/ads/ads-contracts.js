// Ads workspace contracts: metric definitions, controlled vocabularies and the
// shapes the screens read.
//
// Phase 1 of the frontend-first build. Nothing here calls Meta. The dashboard
// reads saved reporting rows that a scheduled sync has already written; every
// screen renders the shape declared in this file and nothing else. When a
// reader is missing, the screen says so instead of inventing a number.
//
// Two rules are encoded here rather than left to each screen:
//
// 1. A provider-attributed number and an observed number are different facts.
//    Meta reporting conversion counts and website/CRM-observed outcomes never
//    share a column, a total or a label. See `MEASUREMENT_SOURCES`.
// 2. Low volume is not a winner. `evidenceFor` refuses a verdict until the
//    interval separates, and the caller renders "insufficient evidence".

// ---------------------------------------------------------------------------
// Controlled vocabularies
// ---------------------------------------------------------------------------

/** The three levels a buyer actually manages. Kept as one ordered list so a
 *  level switch never invents a fourth. */
export const ENTITY_LEVELS = Object.freeze(["campaign", "adset", "ad"]);

export const ENTITY_LEVEL_LABELS = Object.freeze({
  campaign: "Campaigns",
  adset: "Ad sets",
  ad: "Ads",
});

/** Delivery state as the provider reports it, plus the two states an operator
 *  needs and the provider never emits: `uncertain` (we wrote and do not know)
 *  and `not_delivering` (approved, no delivery). */
export const DELIVERY_STATES = Object.freeze([
  "draft",
  "queued",
  "uploading",
  "submitted",
  "in_review",
  "delivering",
  "paused",
  "rejected",
  "uncertain",
  "archived",
]);

export const DELIVERY_STATE_LABELS = Object.freeze({
  draft: "Draft",
  queued: "Queued",
  uploading: "Uploading",
  submitted: "Submitted",
  in_review: "In review",
  delivering: "Delivering",
  paused: "Paused",
  rejected: "Rejected",
  uncertain: "Uncertain",
  archived: "Archived",
});

/** A state is proof of delivery only when the provider has actually served the
 *  ad. `submitted` is a write acknowledgement, not delivery, and the UI says so
 *  wherever it shows the word. */
export const DELIVERY_PROOF_STATES = Object.freeze(["delivering", "paused"]);

/** States where a retry could duplicate a write. The queue reconciles these
 *  before it offers any retry. */
export const UNCERTAIN_WRITE_STATES = Object.freeze(["uploading", "submitted", "in_review", "uncertain"]);

export function isUncertainWrite(state) {
  return UNCERTAIN_WRITE_STATES.includes(String(state || ""));
}

/** Which fact a number is. Never merged, never summed across kinds. */
export const MEASUREMENT_SOURCES = Object.freeze(["provider_attributed", "site_observed", "crm_observed"]);

export const MEASUREMENT_SOURCE_LABELS = Object.freeze({
  provider_attributed: "Meta-attributed",
  site_observed: "Website-observed",
  crm_observed: "CRM-observed",
});

export const MEASUREMENT_SOURCE_NOTES = Object.freeze({
  provider_attributed:
    "Counted by Meta under the selected attribution setting. It is a claim about Meta's own reporting, not a measurement of the business.",
  site_observed:
    "Counted by the site's own analytics from the landing session. It can disagree with Meta in either direction.",
  crm_observed:
    "Counted by the CRM after a human-qualified stage. This is the only source that can speak to qualified demand.",
});

/** Queue row states beyond delivery: the operator's own workflow state. */
export const QUEUE_ROW_STATES = Object.freeze([
  "draft",
  "validated",
  "blocked",
  "queued",
  "uploading",
  "submitted",
  "in_review",
  "delivering",
  "paused",
  "rejected",
  "uncertain",
  "failed",
]);

/** Where a classification tag came from. `prompt` describes intent, not the
 *  finished asset, so it is never presented as a description of the image. */
export const TAG_SOURCES = Object.freeze(["prompt", "image", "copy", "manual", "lineage"]);

export const TAG_SOURCE_LABELS = Object.freeze({
  prompt: "From prompt",
  image: "From image",
  copy: "From copy",
  manual: "Manual",
  lineage: "From lineage",
});

/** The classification fields carried by a creative. The first block is read
 *  from the generation prompt (intent); the second from the finished asset. */
export const CREATIVE_TAG_FIELDS = Object.freeze([
  "concept",
  "angle",
  "hook",
  "audience",
  "offer",
  "funnel_stage",
  "format",
  "visual_style",
  "subject",
  "composition",
  "cta",
  "destination",
  "blog_topic",
]);

export const CREATIVE_TAG_LABELS = Object.freeze({
  concept: "Concept",
  angle: "Angle",
  hook: "Hook",
  audience: "Audience",
  offer: "Offer",
  funnel_stage: "Funnel stage",
  format: "Format",
  visual_style: "Visual style",
  subject: "Image subject",
  composition: "Composition",
  cta: "CTA",
  destination: "Destination",
  blog_topic: "Blog topic",
});

/** Grouping axes the creative screen compares along. */
export const CREATIVE_DIMENSIONS = Object.freeze([
  "concept",
  "hook",
  "format",
  "visual_style",
  "audience",
  "funnel_stage",
  "blog_topic",
]);

export const CREATIVE_DIMENSION_LABELS = Object.freeze({
  concept: "Concept",
  hook: "Hook",
  format: "Format",
  visual_style: "Image style",
  audience: "Audience",
  funnel_stage: "Funnel stage",
  blog_topic: "Blog topic",
});

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

// Every metric the dashboard may render. `derive` is a pure function of the
// row's base counters, so two screens can never disagree about the same number.
// `null` means "cannot be computed from what we have" and renders as a dash,
// never as zero.
export const METRICS = Object.freeze({
  spend: Object.freeze({
    id: "spend",
    label: "Spend",
    short: "Spend",
    kind: "currency",
    unit: "account",
    derive: (r) => num(r.spend),
    definition: "Amount delivered by the provider for the selected window, in the account currency.",
    higherIsBetter: null,
  }),
  impressions: Object.freeze({
    id: "impressions",
    label: "Impressions",
    short: "Impr.",
    kind: "count",
    derive: (r) => num(r.impressions),
    definition: "Times the ad was on screen. Not people.",
    higherIsBetter: null,
  }),
  reach: Object.freeze({
    id: "reach",
    label: "Reach",
    short: "Reach",
    kind: "count",
    derive: (r) => num(r.reach),
    definition: "Estimated distinct people. Provider-modelled, so it is not additive across rows.",
    higherIsBetter: null,
  }),
  frequency: Object.freeze({
    id: "frequency",
    label: "Frequency",
    short: "Freq.",
    kind: "ratio",
    derive: (r) => divide(num(r.impressions), num(r.reach)),
    definition: "Impressions per reached person. Derived, not provider-reported.",
    higherIsBetter: null,
  }),
  linkClicks: Object.freeze({
    id: "linkClicks",
    label: "Link clicks",
    short: "Clicks",
    kind: "count",
    derive: (r) => num(r.linkClicks),
    definition: "Clicks that landed on the destination. Excludes reactions, comments and expands.",
    higherIsBetter: true,
  }),
  ctr: Object.freeze({
    id: "ctr",
    label: "CTR (link)",
    short: "CTR",
    kind: "percent",
    derive: (r) => divide(num(r.linkClicks), num(r.impressions)),
    definition: "Link clicks divided by impressions.",
    higherIsBetter: true,
  }),
  cpc: Object.freeze({
    id: "cpc",
    label: "Cost per link click",
    short: "CPC",
    kind: "currency",
    unit: "account",
    derive: (r) => divide(num(r.spend), num(r.linkClicks)),
    definition: "Spend divided by link clicks.",
    higherIsBetter: false,
  }),
  cpm: Object.freeze({
    id: "cpm",
    label: "Cost per 1,000 impressions",
    short: "CPM",
    kind: "currency",
    unit: "account",
    derive: (r) => (num(r.spend) === null || num(r.impressions) === null ? null : divide(num(r.spend) * 1000, num(r.impressions))),
    definition: "Spend per thousand impressions. Mostly a media-cost signal, not a creative signal.",
    higherIsBetter: false,
  }),
  landingViews: Object.freeze({
    id: "landingViews",
    label: "Landing page views",
    short: "LP views",
    kind: "count",
    derive: (r) => num(r.landingViews),
    definition: "Sessions that reached the destination. Provider-reported.",
    higherIsBetter: true,
  }),
  results: Object.freeze({
    id: "results",
    label: "Results",
    short: "Results",
    kind: "count",
    derive: (r) => num(r.results),
    definition: "Conversions the provider attributed to the optimisation event under the selected attribution setting.",
    higherIsBetter: true,
  }),
  costPerResult: Object.freeze({
    id: "costPerResult",
    label: "Cost per result",
    short: "CPR",
    kind: "currency",
    unit: "account",
    derive: (r) => divide(num(r.spend), num(r.results)),
    definition: "Spend divided by provider-attributed results.",
    higherIsBetter: false,
  }),
  resultRate: Object.freeze({
    id: "resultRate",
    label: "Result rate",
    short: "Rate",
    kind: "percent",
    derive: (r) => divide(num(r.results), num(r.linkClicks)),
    definition: "Provider-attributed results per link click.",
    higherIsBetter: true,
  }),
  siteSessions: Object.freeze({
    id: "siteSessions",
    label: "Sessions",
    short: "Sessions",
    kind: "count",
    measurement: "site_observed",
    derive: (r) => num(r.siteSessions),
    definition: "Sessions the site's own analytics recorded against this ad's tracking parameters.",
    higherIsBetter: true,
  }),
  siteConversions: Object.freeze({
    id: "siteConversions",
    label: "Site conversions",
    short: "Site conv.",
    kind: "count",
    measurement: "site_observed",
    derive: (r) => num(r.siteConversions),
    definition: "Outcomes the site recorded itself. Independent of Meta's attribution.",
    higherIsBetter: true,
  }),
  qualifiedLeads: Object.freeze({
    id: "qualifiedLeads",
    label: "Qualified leads",
    short: "Qualified",
    kind: "count",
    measurement: "crm_observed",
    derive: (r) => num(r.qualifiedLeads),
    definition: "Records the CRM reached a human-qualified stage. The slowest and the most trustworthy number here.",
    higherIsBetter: true,
  }),
  costPerQualifiedLead: Object.freeze({
    id: "costPerQualifiedLead",
    label: "Cost per qualified lead",
    short: "CPQL",
    kind: "currency",
    unit: "account",
    measurement: "crm_observed",
    derive: (r) => divide(num(r.spend), num(r.qualifiedLeads)),
    definition: "Spend divided by CRM-qualified leads. Joins a provider cost to an observed outcome, so it is always labelled as a join.",
    higherIsBetter: false,
  }),
  onwardClicks: Object.freeze({
    id: "onwardClicks",
    label: "Onward clicks",
    short: "Onward",
    kind: "count",
    measurement: "site_observed",
    derive: (r) => num(r.onwardClicks),
    definition: "Clicks from an article to a next step. Measures whether the content did a job.",
    higherIsBetter: true,
  }),
  engagementRate: Object.freeze({
    id: "engagementRate",
    label: "Engagement rate",
    short: "Engage",
    kind: "percent",
    measurement: "site_observed",
    derive: (r) => divide(num(r.engagedSessions), num(r.siteSessions)),
    definition: "Sessions with a meaningful interaction, over sessions.",
    higherIsBetter: true,
  }),
});

export function metricValue(metricId, row) {
  const metric = METRICS[metricId];
  if (!metric || !row) return null;
  return metric.derive(row);
}

/** The default column sets each table opens with. Deliberately short: a table
 *  that opens with every column is a table nobody reads. */
export const DEFAULT_COLUMNS = Object.freeze({
  campaign: Object.freeze(["name", "status", "spend", "results", "costPerResult", "ctr", "spendTrend"]),
  adset: Object.freeze(["name", "status", "spend", "results", "costPerResult", "frequency", "spendTrend"]),
  ad: Object.freeze(["name", "status", "spend", "results", "costPerResult", "ctr", "spendTrend"]),
  creative: Object.freeze(["name", "format", "spend", "results", "costPerResult", "ctr", "confidence"]),
  blog: Object.freeze(["name", "topic", "siteSessions", "qualifiedLeads", "spend", "onwardClicks", "evidence"]),
  queue: Object.freeze(["name", "state", "ads", "budgetDelta", "attempts", "updated"]),
});

/** Columns that may be added to each table, in menu order. */
export const COLUMN_CATALOG = Object.freeze({
  campaign: Object.freeze([
    "name", "status", "objective", "spend", "budget", "budgetDelta", "impressions", "reach", "frequency",
    "linkClicks", "ctr", "cpc", "cpm", "results", "costPerResult", "resultRate", "qualifiedLeads",
    "costPerQualifiedLead", "spendTrend", "lastEdit", "issues",
  ]),
  adset: Object.freeze([
    "name", "status", "optimisation", "audience", "placements", "spend", "budget", "budgetDelta",
    "impressions", "reach", "frequency", "linkClicks", "ctr", "cpc", "results", "costPerResult",
    "qualifiedLeads", "spendTrend", "schedule", "issues",
  ]),
  ad: Object.freeze([
    "name", "status", "creative", "destination", "spend", "impressions", "linkClicks", "ctr", "cpc",
    "results", "costPerResult", "resultRate", "qualifiedLeads", "costPerQualifiedLead", "spendTrend",
    "tracking", "issues",
  ]),
  creative: Object.freeze([
    "name", "format", "concept", "hook", "visual_style", "spend", "impressions", "ctr", "results",
    "costPerResult", "qualifiedLeads", "costPerQualifiedLead", "confidence", "source", "lineage", "spendTrend",
  ]),
  blog: Object.freeze([
    "name", "topic", "siteSessions", "paidSessions", "organicSessions", "engagementRate", "onwardClicks",
    "siteConversions", "qualifiedLeads", "spend", "costPerQualifiedLead", "evidence", "posts",
  ]),
  queue: Object.freeze([
    "name", "state", "level", "ads", "budgetDelta", "changes", "owner", "attempts", "lastError", "updated",
  ]),
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

// A conversion rate with a handful of conversions has a confidence interval
// wide enough to contain almost any competitor. These floors decide when the
// UI is allowed to rank at all. They are shown in the interface so the reader
// can disagree with them.
export const EVIDENCE_FLOOR = Object.freeze({
  results: 25,
  clicks: 100,
  spendMinor: 5000,
});

export const EVIDENCE_LABELS = Object.freeze({
  insufficient: "Insufficient evidence",
  directional: "Directional only",
  comparable: "Comparable",
});

/**
 * Wilson score interval for a proportion. Chosen over the normal approximation
 * because it stays sane at small n, which is exactly the case we must not
 * over-read.
 */
export function wilsonInterval(successes, trials, z = 1.96) {
  const n = num(trials);
  const k = num(successes);
  if (n === null || k === null || n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Object.freeze({
    low: Math.max(0, (centre - spread) / denom),
    high: Math.min(1, (centre + spread) / denom),
    point: p,
    n,
    k,
  });
}

/**
 * How much a row may be trusted for a ranking. Returns a verdict plus the
 * reason, because "insufficient evidence" without a reason is just a shrug.
 *
 * `metric` is `results` or `clicks`; `spendMinor` is the row's spend in minor
 * units of the account currency.
 */
export function evidenceFor(row, { metric = "results", spendMinor = null } = {}) {
  const successes = num(row?.[metric]);
  const trials = metric === "results" ? num(row?.linkClicks) : num(row?.impressions);
  const spend = spendMinor === null ? toMinor(row?.spend) : spendMinor;
  const floor = metric === "results" ? EVIDENCE_FLOOR.results : EVIDENCE_FLOOR.clicks;
  const interval = wilsonInterval(successes, trials);

  if (successes === null || trials === null || successes <= 0 || trials <= 0) {
    return Object.freeze({
      level: "insufficient",
      label: EVIDENCE_LABELS.insufficient,
      reason: "No measured outcomes in this window.",
      interval,
      successes,
      trials,
    });
  }
  if (successes < floor) {
    return Object.freeze({
      level: "insufficient",
      label: EVIDENCE_LABELS.insufficient,
      reason: `${successes} of the ${floor} ${metric} this window needs before a ranking means anything.`,
      interval,
      successes,
      trials,
    });
  }
  if (spend !== null && spend < EVIDENCE_FLOOR.spendMinor) {
    return Object.freeze({
      level: "directional",
      label: EVIDENCE_LABELS.directional,
      reason: "Enough outcomes to look at, too little spend for the rate to be stable.",
      interval,
      successes,
      trials,
    });
  }
  return Object.freeze({
    level: "comparable",
    label: EVIDENCE_LABELS.comparable,
    reason: `${successes} ${metric} over ${formatInt(trials)} ${metric === "results" ? "clicks" : "impressions"}.`,
    interval,
    successes,
    trials,
  });
}

/**
 * Compare two rows on a rate and refuse a verdict when the intervals overlap.
 * This is the only function allowed to produce a "better" claim.
 */
export function compareRates(a, b, { metric = "results", denominator = "linkClicks" } = {}) {
  const ia = wilsonInterval(num(a?.[metric]), num(a?.[denominator]));
  const ib = wilsonInterval(num(b?.[metric]), num(b?.[denominator]));
  const ea = evidenceFor(a, { metric });
  const eb = evidenceFor(b, { metric });
  if (!ia || !ib) {
    return Object.freeze({ verdict: "insufficient", reason: "One side has no denominator to compute a rate from." });
  }
  if (ea.level === "insufficient" || eb.level === "insufficient") {
    return Object.freeze({ verdict: "insufficient", reason: ea.level === "insufficient" ? ea.reason : eb.reason, a: ia, b: ib });
  }
  if (ia.low > ib.high) return Object.freeze({ verdict: "a", a: ia, b: ib, reason: "Confidence intervals do not overlap." });
  if (ib.low > ia.high) return Object.freeze({ verdict: "b", a: ia, b: ib, reason: "Confidence intervals do not overlap." });
  return Object.freeze({
    verdict: "tie",
    a: ia,
    b: ib,
    reason: "Confidence intervals overlap, so the difference is inside the noise.",
  });
}

// ---------------------------------------------------------------------------
// Attribution and comparison
// ---------------------------------------------------------------------------

// Attribution is a property of the data request, not a client-side filter.
// Changing it re-reads the saved window; it must never be applied by scaling a
// number in the browser.
export const ATTRIBUTION_WINDOWS = Object.freeze([
  Object.freeze({ id: "7d_click_1d_view", label: "7-day click, 1-day view", note: "Provider default for most objectives." }),
  Object.freeze({ id: "1d_click", label: "1-day click", note: "Strictest. Best for comparing creatives." }),
  Object.freeze({ id: "7d_click", label: "7-day click", note: "Click only, no view-through." }),
  Object.freeze({ id: "28d_click_1d_view", label: "28-day click, 1-day view", note: "Long windows flatter upper-funnel ads." }),
]);

export const DATE_PRESETS = Object.freeze([
  Object.freeze({ id: "last_7d", label: "Last 7 days", days: 7 }),
  Object.freeze({ id: "last_14d", label: "Last 14 days", days: 14 }),
  Object.freeze({ id: "last_28d", label: "Last 28 days", days: 28 }),
  Object.freeze({ id: "last_90d", label: "Last 90 days", days: 90 }),
  Object.freeze({ id: "mtd", label: "Month to date", days: null }),
  Object.freeze({ id: "custom", label: "Custom", days: null }),
]);

export const COMPARISON_MODES = Object.freeze([
  Object.freeze({ id: "previous_period", label: "Previous period" }),
  Object.freeze({ id: "previous_year", label: "Same period last year" }),
  Object.freeze({ id: "none", label: "No comparison" }),
]);

/** Re-fetching a recent window is how delayed attribution gets corrected. The
 *  UI states the lag rather than pretending a fresh number is final. */
export const ATTRIBUTION_SETTLE_DAYS = 3;

export const SYNC_STATES = Object.freeze(["ready", "syncing", "stale", "throttled", "error", "not_connected"]);

export const SYNC_STATE_LABELS = Object.freeze({
  ready: "Synced",
  syncing: "Syncing",
  stale: "Stale",
  throttled: "Throttled",
  error: "Sync failed",
  not_connected: "Not connected",
});

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Numbers arrive as numbers or numeric strings; anything else is missing. */
export function num(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/[, ]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function divide(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function toMinor(amount) {
  const value = num(amount);
  return value === null ? null : Math.round(value * 100);
}

export function formatInt(value) {
  const n = num(value);
  return n === null ? "—" : Math.round(n).toLocaleString("en-GB");
}

/** Rates render to one decimal; a rate computed from nothing renders as a dash. */
export function formatPercent(value, digits = 1) {
  const n = num(value);
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export function formatRatio(value, digits = 2) {
  const n = num(value);
  return n === null ? "—" : n.toFixed(digits);
}

export function formatMoney(value, currency = "GBP", { minor = false } = {}) {
  const n = num(value);
  if (n === null) return "—";
  const amount = minor ? n / 100 : n;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: amount < 100 ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Signs a delta so a reader never has to infer direction from colour alone. */
export function formatDelta(value, { kind = "percent", currency = "GBP" } = {}) {
  const n = num(value);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const magnitude = Math.abs(n);
  if (kind === "currency") return `${sign}${formatMoney(magnitude, currency)}`;
  if (kind === "count") return `${sign}${formatInt(magnitude)}`;
  return `${sign}${(magnitude * 100).toFixed(1)}%`;
}

export function isoDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function formatDay(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "—";
  const [y, m, d] = text.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatWhen(value, now = Date.now()) {
  const t = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(t)) return "—";
  const diff = Math.round((now - t) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Age of a cached read, in words, for the stale banner. Kept separate from
 * `formatWhen` because "stale" needs a threshold, not a duration.
 */
export function ageState(fetchedAt, now = Date.now(), freshMs = 15 * 60 * 1000) {
  const t = typeof fetchedAt === "number" ? fetchedAt : Date.parse(String(fetchedAt || ""));
  if (!Number.isFinite(t)) return Object.freeze({ level: "unknown", ageMs: null, label: "never synced" });
  const ageMs = Math.max(0, now - t);
  return Object.freeze({
    level: ageMs <= freshMs ? "fresh" : ageMs <= freshMs * 16 ? "stale" : "old",
    ageMs,
    label: formatWhen(t, now),
  });
}

// ---------------------------------------------------------------------------
// Display helpers shared by tables
// ---------------------------------------------------------------------------

/** A row's display name, never blank. */
export function rowName(row) {
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  return name || (row?.id ? String(row.id) : "Untitled");
}

/** Stable row identity. Reporting rows key on the provider id, never the name,
 *  because a rename must not break history. */
export function rowKey(row) {
  return String(row?.internalId || row?.id || row?.key || "");
}

export function stateOf(row) {
  const state = String(row?.state || row?.status || "").toLowerCase();
  return DELIVERY_STATES.includes(state) ? state : "draft";
}
