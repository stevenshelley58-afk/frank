// Ads decisions: the Overview screen's judgement, as pure functions.
//
// The Overview answers exactly three questions and then stops: what needs the
// owner, where spend is producing useful outcomes, and what to test next.
// Everything that decides one of those answers lives here rather than in the
// screen, for three reasons:
//
//   * a rule can be tested without a browser, which is the only way to hold a
//     ranking still while the rendering around it changes;
//   * every number a rule uses is read from a row the reader returned, so an
//     invented figure has nowhere to enter. A counter that is absent is
//     `null`, and `null` never becomes zero;
//   * identity is the only join. Every item carries the immutable id of every
//     record it concerns, and every lookup here is by id — never by a name, a
//     position, or a truncated label.
//
// Nothing in this module formats currency, reads a clock, or touches the DOM.
// The screen renders; this module decides.
//
// Two contract rules run through the whole file:
//
//   1. A provider-attributed number and an observed number are different
//      facts. They are ranked in separate lanes and are never added together.
//   2. Below the evidence floor there is no ranking. `evidenceFor()` decides
//      when a rate may be read at all and `compareRates()` decides when one row
//      has actually beaten another; no other function here is allowed to say
//      "better".

import {
  ATTRIBUTION_SETTLE_DAYS,
  DELIVERY_PROOF_STATES,
  EVIDENCE_FLOOR,
  compareRates,
  evidenceFor,
  metricValue,
  num,
  rowKey,
  rowName,
  stateOf,
} from "./ads-contracts.js";
import { fingerprintDigest, sourceFingerprint } from "./ads-identity.js";

// ---------------------------------------------------------------------------
// Sources and coverage
// ---------------------------------------------------------------------------

// What each reader contributes, in the words the screen uses when it has to say
// that one of them did not answer. A missing source is never silently treated
// as an empty one: it becomes a named blind spot instead.
const SOURCE_LABELS = Object.freeze({
  context: "the account and its sync state",
  overview: "the window totals",
  creatives: "the creative rows",
  blogs: "the article rows",
  tracking: "the tracking findings",
  queue: "the publishing queue",
});

const ENTITY_LEVEL_LABELS = Object.freeze({
  campaign: "the campaign rows",
  adset: "the ad set rows",
  ad: "the ad rows",
});

/** Statuses that mean the read answered. `empty` is an answer: there were no
 *  rows. `not_connected` is a statement about the build, not an empty result. */
const ANSWERED = Object.freeze(["ready", "empty"]);
const FAILED = Object.freeze(["throttled", "error", "stale", "syncing"]);

/**
 * Every envelope the screen holds, flattened into one list.
 *
 * The entities reader answers one level at a time, so it contributes three
 * entries. Keeping them separate matters: "the ad rows did not answer" and "the
 * campaign rows did not answer" are different blind spots, and a screen that
 * merged them could not say which one to retry.
 */
export function sourceEntries(sources = {}) {
  const entries = [];
  for (const [id, label] of Object.entries(SOURCE_LABELS)) {
    if (id === "context" || id === "overview" || id === "creatives" || id === "blogs" || id === "tracking" || id === "queue") {
      entries.push({ key: id, reader: id, label, source: sources?.[id] || null });
    }
  }
  for (const level of ["campaign", "adset", "ad"]) {
    entries.push({
      key: `entities.${level}`,
      reader: "entities",
      level,
      label: ENTITY_LEVEL_LABELS[level],
      source: sources?.entities?.[level] || null,
    });
  }
  return entries;
}

/** Rows a source carried, or an empty list. A source that answered with a
 *  record rather than rows contributes none. */
export function rowsOf(source) {
  return Array.isArray(source?.data?.rows) ? source.data.rows : [];
}

/** The record a reader answered with, but only when it carries one of the
 *  fields that reader is documented to return. Reading `validation` off a
 *  metadata object that never had it would invent a finding of "none". */
export function recordWith(source, fields) {
  const meta = source?.data?.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return fields.some((field) => field in meta) ? meta : null;
}

export function observedAtOf(source) {
  return Number.isFinite(source?.fetchedAt) ? source.fetchedAt : null;
}

export function statusOf(source) {
  return String(source?.status || "not_connected");
}

/**
 * What the screen can and cannot see, as data.
 *
 * `complete` is the only condition under which the screen may say "nothing
 * needs you". If a read failed, the honest answer is that the screen could not
 * check that part of the account — not that it found nothing there.
 */
export function readCoverage(sources = {}) {
  const entries = sourceEntries(sources).map((entry) => {
    const status = statusOf(entry.source);
    return Object.freeze({
      key: entry.key,
      reader: entry.reader,
      level: entry.level || "",
      label: entry.label,
      status,
      answered: ANSWERED.includes(status),
      failed: FAILED.includes(status),
      // `stale` means the reader kept an earlier copy: the rows are still there
      // and still dated, which is a different fact from an empty answer.
      retained: status === "stale",
      detail: String(entry.source?.detail || ""),
      observedAt: observedAtOf(entry.source),
      rows: Array.isArray(entry.source?.data?.rows) ? entry.source.data.rows.length : null,
    });
  });
  const unknowns = entries.filter((entry) => !entry.answered).map((entry) => entry.key);
  const failed = entries.filter((entry) => entry.failed).map((entry) => entry.key);
  const missing = entries.filter((entry) => entry.status === "not_connected").map((entry) => entry.key);
  return Object.freeze({
    entries: Object.freeze(entries),
    complete: unknowns.length === 0,
    anyFailed: failed.length > 0,
    allMissing: entries.every((entry) => entry.status === "not_connected"),
    unknowns: Object.freeze(unknowns),
    failed: Object.freeze(failed),
    missing: Object.freeze(missing),
  });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** A reader row with its rollup lifted to the top level, exactly as the
 *  campaigns table does it, so `metricValue()` reads the same number in both
 *  places. The level is taken from the caller when the row does not say. */
export function normalizeEntity(row, level = "") {
  const merged = { ...row, ...(row?.totals || {}) };
  return { ...merged, level: String(row?.level || level || "") };
}

export function entityRows(sources = {}, level = "campaign") {
  return rowsOf(sources?.entities?.[level]).map((row) => normalizeEntity(row, level));
}

/** Reader rows whose rollup sits under `totals` (creatives, articles) lifted the
 *  same way, so one metric reads identically wherever a row came from. */
export function normalizedRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeEntity(row));
}

/** An index from immutable id to row, so every join in this module is a lookup
 *  by identity rather than a scan that could match on a name. */
export function indexById(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const id = rowKey(row);
    if (id && !index.has(id)) index.set(id, row);
  }
  return index;
}

export function spendOf(row) {
  return num(row?.spend);
}

/**
 * The three outcome counters, kept apart.
 *
 * `noOutcomeObserved` is only true when at least one counter actually answered
 * and none of them is positive. A row whose reads returned no outcome figures
 * at all is silent, not empty-handed, and the two must not be rendered the
 * same way.
 */
export function outcomeReading(row) {
  const counters = [
    { metric: "results", measurement: "provider_attributed", value: num(row?.results) },
    { metric: "siteConversions", measurement: "site_observed", value: num(row?.siteConversions) },
    { metric: "qualifiedLeads", measurement: "crm_observed", value: num(row?.qualifiedLeads) },
  ].map((counter) => Object.freeze({ ...counter, present: counter.value !== null }));
  const answered = counters.filter((counter) => counter.present);
  const positive = answered.filter((counter) => counter.value > 0);
  return Object.freeze({
    counters: Object.freeze(counters),
    answeredCount: answered.length,
    positiveCount: positive.length,
    noOutcomeObserved: answered.length > 0 && positive.length === 0,
    silent: answered.length === 0,
  });
}

/** One line of evidence. `kind` tells the screen how to render the value, so a
 *  number is never turned into prose here and a missing value stays missing. */
export function evidenceRow(label, value, { kind = "text", metric = "", measurement = "", note = "" } = {}) {
  return Object.freeze({ label, value: value === undefined ? null : value, kind, metric, measurement, note });
}

// ---------------------------------------------------------------------------
// Identity joins
// ---------------------------------------------------------------------------

// Every drill-down the brief names is here, and every one of them joins on an
// immutable id: a campaign to its ads through the ad set's parent, an ad to its
// creative through `creativeId`, an article to the ads promoting it through the
// creative ids the article names. Renaming anything changes none of them.

export function adsForAdset(adsetId, ads = []) {
  const id = String(adsetId || "");
  if (!id) return [];
  return ads.filter((ad) => String(ad?.parentId || "") === id);
}

export function adsForCampaign(campaignId, adsets = [], ads = []) {
  const id = String(campaignId || "");
  if (!id) return [];
  const within = adsets.filter((adset) => String(adset?.parentId || "") === id).map((adset) => rowKey(adset));
  const wanted = new Set(within);
  return ads.filter((ad) => wanted.has(String(ad?.parentId || "")));
}

export function adsForCreative(creativeId, ads = []) {
  const id = String(creativeId || "");
  if (!id) return [];
  return ads.filter((ad) => String(ad?.creativeId || "") === id);
}

export function creativeForAd(ad, creatives = []) {
  const id = String(ad?.creativeId || "");
  if (!id) return null;
  return creatives.find((creative) => rowKey(creative) === id) || null;
}

/**
 * The ads promoting an article.
 *
 * The article names the creatives it is attached to; the ads are found through
 * those ids. Two articles with the same slug, or two ads with the same
 * headline, stay separate records because nothing here compares a label.
 */
export function adsForArticle(article, ads = [], creatives = []) {
  const ids = new Set((Array.isArray(article?.creativeIds) ? article.creativeIds : []).map((id) => String(id)));
  if (!ids.size) return [];
  const creativeKeys = new Set(creatives.filter((creative) => ids.has(rowKey(creative))).map((creative) => rowKey(creative)));
  return ads.filter((ad) => creativeKeys.has(String(ad?.creativeId || "")));
}

/** The ad sets that run a creative, found through the ads that carry it. */
export function adsetsForCreative(creativeId, ads = [], adsets = []) {
  const parents = new Set(adsForCreative(creativeId, ads).map((ad) => String(ad?.parentId || "")));
  return adsets.filter((adset) => parents.has(rowKey(adset)));
}

/**
 * A creative's rendition identity.
 *
 * Versions are content-addressed (see `ads-identity.js`): the same asset at the
 * same crop and format is the same version. The digest is stable for a reader
 * row, which is what lets the drawer show a version fingerprint without minting
 * a new identity on every render — an id allocated per render would be a
 * different version every time the drawer opened.
 */
export function renditionOf(creative) {
  if (!creative) return null;
  const fingerprint = sourceFingerprint(creative);
  const versions = Array.isArray(creative.versions) ? creative.versions : [];
  const match = versions.find((version) => version?.fingerprint === fingerprint) || null;
  return Object.freeze({
    fingerprint,
    digest: fingerprintDigest(fingerprint),
    versionId: String(match?.versionId || ""),
    format: String(creative?.format || ""),
    ratio: String(creative?.preview?.ratio || creative?.ratio || ""),
    assetKey: String(creative?.assetKey || creative?.internalId || creative?.id || ""),
  });
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

/**
 * The kinds of thing that need the owner, with the weight that orders them.
 *
 * The weight is "what it costs to ignore", and it is a decision this file
 * states rather than a number derived from the data: a broken tracking URL
 * invalidates every number that depends on it, an uncertain write can
 * duplicate an ad if it is retried, and a low-volume campaign is a question
 * rather than a loss.
 */
export const ATTENTION_KINDS = Object.freeze({
  tracking_broken: Object.freeze({ weight: 100, severity: "error", label: "Tracking is broken" }),
  write_uncertain: Object.freeze({ weight: 95, severity: "error", label: "A write is uncertain" }),
  write_failed: Object.freeze({ weight: 90, severity: "error", label: "A write failed" }),
  budget_waste: Object.freeze({ weight: 80, severity: "warning", label: "Budget is at risk of being wasted" }),
  account_stale: Object.freeze({ weight: 70, severity: "warning", label: "This reading is not current" }),
  learning_limited: Object.freeze({ weight: 60, severity: "warning", label: "Learning limited" }),
  spend_no_outcome: Object.freeze({ weight: 50, severity: "warning", label: "Spend with no observed outcome" }),
  delivery_blocked: Object.freeze({ weight: 45, severity: "error", label: "Delivery is blocked" }),
  entity_flag: Object.freeze({ weight: 40, severity: "info", label: "Flagged by the read model" }),
  source_unavailable: Object.freeze({ weight: 30, severity: "info", label: "Part of the account could not be read" }),
});

// The read model's own issue kinds, mapped onto the decision they imply. An
// unmapped kind is not dropped: it becomes `entity_flag` with the reader's own
// sentence as its evidence, because hiding a flag the reader raised would be a
// bigger lie than showing one this module does not fully understand.
const ISSUE_KINDS = Object.freeze({
  tracking: "tracking_broken",
  frequency: "budget_waste",
  audience_overlap: "budget_waste",
  learning_limited: "learning_limited",
  rejected: "delivery_blocked",
});

function attentionItem(kind, { id, title, detail, entity = null, records = [], evidence = [], source = null, reader = "", spendMinor = 0, action = null }) {
  const spec = ATTENTION_KINDS[kind] || ATTENTION_KINDS.entity_flag;
  return Object.freeze({
    id: `${kind}:${id}`,
    kind,
    severity: spec.severity,
    label: spec.label,
    weight: spec.weight,
    title,
    detail,
    entity,
    records: Object.freeze(records.filter(Boolean)),
    evidence: Object.freeze(evidence.filter(Boolean)),
    reader,
    observedAt: observedAtOf(source),
    spendMinor,
    action,
  });
}

function recordFor(kind, row, extra = {}) {
  const id = rowKey(row);
  return Object.freeze({ kind, id, name: rowName(row), level: String(row?.level || ""), ...extra });
}

function sortAttention(items) {
  return items.slice().sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.spendMinor !== a.spendMinor) return b.spendMinor - a.spendMinor;
    const at = a.observedAt || 0;
    const bt = b.observedAt || 0;
    if (bt !== at) return bt - at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** "Tracking is broken", from the tracking reader's own findings and from the
 *  tracking flag a row carries. The failing URL is the evidence, because it is
 *  the thing a person can look at and disagree with. */
function trackingAttention({ sources, findings, rows }) {
  const items = [];
  const seen = new Set();
  const source = sources?.tracking;

  for (const finding of findings) {
    if (!["error", "warning"].includes(String(finding?.severity || ""))) continue;
    const adId = String(finding?.adId || "");
    const key = adId || String(finding?.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const ad = rows.ads.find((row) => rowKey(row) === adId) || null;
    items.push(
      attentionItem("tracking_broken", {
        id: key,
        title: ad ? rowName(ad) : String(finding?.adName || finding?.kind || "A tracking finding"),
        entity: ad ? recordFor("ad", ad) : adId ? Object.freeze({ kind: "ad", id: adId, name: String(finding?.adName || ""), level: "ad" }) : null,
        records: [ad ? recordFor("ad", ad) : adId ? Object.freeze({ kind: "ad", id: adId, name: String(finding?.adName || ""), level: "ad" }) : null],
        detail: String(finding?.detail || "A tracking parameter on this destination does not resolve to one value."),
        evidence: [
          evidenceRow("Failing URL", String(finding?.url || ""), { kind: "url" }),
          evidenceRow("Finding", String(finding?.kind || ""), { kind: "text" }),
          evidenceRow("Severity reported by the read model", String(finding?.severity || ""), { kind: "text" }),
        ],
        source,
        reader: "tracking",
        spendMinor: ad ? minor(spendOf(ad)) : 0,
        action: ad ? { kind: "open_record", label: "Inspect the ad this URL belongs to", record: recordFor("ad", ad) } : null,
      }),
    );
  }

  for (const { row, level } of rows.all) {
    for (const issue of Array.isArray(row?.issues) ? row.issues : []) {
      if (ISSUE_KINDS[issue?.kind] !== "tracking_broken") continue;
      const id = rowKey(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push(
        attentionItem("tracking_broken", {
          id,
          title: rowName(row),
          entity: recordFor(level, row),
          records: [recordFor(level, row)],
          detail: String(issue?.detail || "The read model flagged a tracking defect on this row."),
          evidence: [
            evidenceRow("Spend in this window", spendOf(row), { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
            evidenceRow("Flag", String(issue?.kind || ""), { kind: "text" }),
          ],
          source: sources?.entities?.[level],
          reader: "entities",
          spendMinor: minor(spendOf(row)),
          action: { kind: "open_record", label: `Inspect the ${level}`, record: recordFor(level, row) },
        }),
      );
    }
  }
  return items;
}

/** A failed or uncertain write, from the publishing queue. */
function queueAttention({ sources }) {
  const items = [];
  const record = recordWith(sources?.queue, ["batches"]);
  if (!record) return items;
  const batches = Array.isArray(record.batches) ? record.batches : [];
  const source = sources?.queue;

  for (const batch of batches) {
    const batchId = rowKey(batch);
    const state = String(batch?.state || "");
    const rows = Array.isArray(batch?.rows) ? batch.rows : [];
    const uncertainRows = rows.filter((row) => String(row?.state || "") === "uncertain");
    const failedRows = rows.filter((row) => ["failed", "rejected"].includes(String(row?.state || "")));

    if (state === "uncertain" || uncertainRows.length) {
      const subject = uncertainRows[0] || batch;
      items.push(
        attentionItem("write_uncertain", {
          id: batchId,
          title: rowName(batch) || batchId,
          entity: Object.freeze({ kind: "batch", id: batchId, name: rowName(batch), level: "batch" }),
          records: [
            Object.freeze({ kind: "batch", id: batchId, name: rowName(batch), level: "batch" }),
            ...uncertainRows.map((row) => Object.freeze({ kind: "queue_row", id: rowKey(row), name: rowName(row), level: "ad" })),
          ],
          detail:
            "A write was acknowledged and delivery was never confirmed. Reconcile it against the account before anything else is sent: sending the same write twice is how a duplicate ad gets created. Nothing in this browser can reconcile it.",
          evidence: [
            evidenceRow("Batch state", state || "—", { kind: "text" }),
            evidenceRow("Writes in this state", uncertainRows.length || num(batch?.failures), { kind: "count" }),
            evidenceRow("Attempts recorded", num(subject?.attempts), { kind: "count" }),
            evidenceRow("Last detail", String(subject?.detail || batch?.lastError || ""), { kind: "text" }),
          ],
          source,
          reader: "queue",
          action: { kind: "open_record", label: "Open the batch in the queue", record: Object.freeze({ kind: "batch", id: batchId, name: rowName(batch), level: "batch" }) },
        }),
      );
      continue;
    }

    if (state === "failed" || state === "rejected" || failedRows.length) {
      items.push(
        attentionItem("write_failed", {
          id: batchId,
          title: rowName(batch) || batchId,
          entity: Object.freeze({ kind: "batch", id: batchId, name: rowName(batch), level: "batch" }),
          records: [
            Object.freeze({ kind: "batch", id: batchId, name: rowName(batch), level: "batch" }),
            ...failedRows.map((row) => Object.freeze({ kind: "queue_row", id: rowKey(row), name: rowName(row), level: "ad" })),
          ],
          detail: "A staged write did not complete. The failure is listed against the row it belongs to, so the rest of the batch does not have to run again.",
          evidence: [
            evidenceRow("Batch state", state || "—", { kind: "text" }),
            evidenceRow("Rows that failed", failedRows.length || num(batch?.failures), { kind: "count" }),
            evidenceRow("Last error", String(batch?.lastError || failedRows[0]?.detail || ""), { kind: "text" }),
          ],
          source,
          reader: "queue",
          action: { kind: "open_record", label: "Open the batch in the queue", record: Object.freeze({ kind: "batch", id: batchId, name: rowName(batch), level: "batch" }) },
        }),
      );
    }
  }
  return items;
}

/** The reader's own flags, mapped to the decision each one implies. */
function issueAttention({ sources, rows }) {
  const items = [];
  for (const { row, level } of rows.all) {
    const issues = Array.isArray(row?.issues) ? row.issues : [];
    const seen = new Set();
    for (const issue of issues) {
      const kind = ISSUE_KINDS[issue?.kind] || "entity_flag";
      if (kind === "tracking_broken") continue; // handled above, with its own evidence
      const key = `${kind}:${issue?.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const evidence = [
        evidenceRow("Spend in this window", spendOf(row), { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
        evidenceRow("Results in this window", num(row?.results), { kind: "count", metric: "results", measurement: "provider_attributed" }),
        evidenceRow("Flag", String(issue?.kind || ""), { kind: "text" }),
      ];
      const frequency = metricValue("frequency", row);
      if (frequency !== null) evidence.push(evidenceRow("Frequency", frequency, { kind: "ratio", metric: "frequency" }));
      items.push(
        attentionItem(kind, {
          id: `${rowKey(row)}:${issue?.kind || "flag"}`,
          title: rowName(row),
          entity: recordFor(level, row),
          records: [recordFor(level, row)],
          detail: String(issue?.detail || "The read model flagged this row."),
          evidence,
          source: sources?.entities?.[level],
          reader: "entities",
          spendMinor: minor(spendOf(row)),
          action: { kind: "open_record", label: `Inspect the ${level}`, record: recordFor(level, row) },
        }),
      );
    }

    // A rejected ad is a provider fact, not a flag: it is not delivering, and
    // no amount of budget will change that until the creative is fixed.
    if (String(row?.state || row?.status || "") === "rejected" && !issues.some((issue) => ISSUE_KINDS[issue?.kind] === "delivery_blocked")) {
      items.push(
        attentionItem("delivery_blocked", {
          id: rowKey(row),
          title: rowName(row),
          entity: recordFor(level, row),
          records: [recordFor(level, row)],
          detail: "The provider reports this row as rejected, so it is not serving. Fixing it means changing the asset or the copy, not the budget.",
          evidence: [
            evidenceRow("State reported by the provider", "rejected", { kind: "text" }),
            evidenceRow("Spend in this window", spendOf(row), { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
          ],
          source: sources?.entities?.[level],
          reader: "entities",
          spendMinor: minor(spendOf(row)),
          action: { kind: "open_record", label: `Inspect the ${level}`, record: recordFor(level, row) },
        }),
      );
    }
  }
  return items;
}

/**
 * Spend that no measured outcome has answered.
 *
 * The floor is the contract's own spend floor, not a new number: below it
 * `evidenceFor()` already refuses to read a rate, so below it there is nothing
 * to conclude either way. The item fires only when a counter actually answered
 * and none of them is positive — a read that returned no outcome figures at all
 * is silent, and silence is not a zero.
 */
function spendWithoutOutcomeAttention({ sources, rows }) {
  const items = [];
  for (const { row, level } of rows.all) {
    const spend = spendOf(row);
    if (spend === null || spend <= 0) continue;
    if (minor(spend) < EVIDENCE_FLOOR.spendMinor) continue;
    const reading = outcomeReading(row);
    if (!reading.noOutcomeObserved) continue;
    items.push(
      attentionItem("spend_no_outcome", {
        id: rowKey(row),
        title: rowName(row),
        entity: recordFor(level, row),
        records: [recordFor(level, row)],
        detail: `This row has spend in the window and no observed outcome yet. That is not the same as a zero: ${describeSilence(reading)}`,
        evidence: [
          evidenceRow("Spend in this window", spend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
          ...reading.counters.map((counter) =>
            evidenceRow(outcomeLabel(counter.metric), counter.value, {
              kind: counter.present ? "count" : "missing",
              metric: counter.metric,
              measurement: counter.measurement,
              note: counter.present ? "" : "Not in this read",
            }),
          ),
          evidenceRow("Spend floor this check uses", EVIDENCE_FLOOR.spendMinor / 100, { kind: "currency" }),
        ],
        source: sources?.entities?.[level],
        reader: "entities",
        spendMinor: minor(spend),
        action: { kind: "open_record", label: `Inspect the ${level}`, record: recordFor(level, row) },
      }),
    );
  }
  return items;
}

/**
 * A staged budget increase aimed at something with nothing coming back.
 *
 * This is the attention item the owner can still stop: the change is a local
 * draft, so reading it here costs nothing and undoing it costs nothing.
 */
function stagedBudgetAttention({ sources, drafts }) {
  const items = [];
  if (!Array.isArray(drafts)) return items;
  const lookup = new Map();
  for (const key of ["campaign", "adset", "ad"]) {
    for (const row of rowsOf(sources?.entities?.[key])) lookup.set(rowKey(row), { row: normalizeEntity(row, key), level: key });
  }
  for (const draft of drafts) {
    if (String(draft?.kind || "") !== "budget") continue;
    if (!(num(draft?.changes?.percent) > 0)) continue;
    const targets = (Array.isArray(draft?.changes?.rows) ? draft.changes.rows : [])
      .map((change) => ({ change, found: lookup.get(String(change?.key || "")) || null }))
      .filter((entry) => entry.found);
    const flagged = targets.filter((entry) => {
      const spend = spendOf(entry.found.row);
      if (spend === null || spend <= 0 || minor(spend) < EVIDENCE_FLOOR.spendMinor) return false;
      return outcomeReading(entry.found.row).noOutcomeObserved;
    });
    if (!flagged.length) continue;
    const first = flagged[0];
    const id = String(draft?.id || "");
    items.push(
      attentionItem("budget_waste", {
        id: id || rowKey(first.found.row),
        title: rowName(first.found.row),
        entity: recordFor(first.found.level, first.found.row),
        records: [
          { kind: "draft", id, name: String(draft?.title || ""), level: String(draft?.kind || "") },
          ...flagged.map((entry) => recordFor(entry.found.level, entry.found.row)),
        ],
        detail: `A staged budget increase of +${num(draft?.changes?.percent)}% targets ${flagged.length} row${
          flagged.length === 1 ? "" : "s"
        } with spend and no observed outcome yet. The change is staged locally and has not been sent.`,
        evidence: [
          evidenceRow("Staged change", `+${num(draft?.changes?.percent)}% budget`, { kind: "text" }),
          evidenceRow("Spend in this window", spendOf(first.found.row), { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
          ...outcomeReading(first.found.row).counters.map((counter) =>
            evidenceRow(outcomeLabel(counter.metric), counter.value, {
              kind: counter.present ? "count" : "missing",
              metric: counter.metric,
              measurement: counter.measurement,
              note: counter.present ? "" : "Not in this read",
            }),
          ),
        ],
        source: sources?.entities?.[first.found.level],
        reader: "drafts",
        spendMinor: minor(spendOf(first.found.row)),
        action: { kind: "open_draft", label: "Open the staged change", draftId: id },
      }),
    );
  }
  return items;
}

/** A source that did not answer is an attention item about the reading itself:
 *  the owner cannot act on rows the read model never produced. */
function sourceAttention({ sources, coverage }) {
  const items = [];
  for (const entry of coverage.entries) {
    if (entry.answered) continue;
    const source = sourceEntries(sources).find((candidate) => candidate.key === entry.key)?.source || null;
    const retained = entry.retained;
    items.push(
      attentionItem("source_unavailable", {
        id: entry.key,
        title: entry.label,
        entity: null,
        records: [],
        detail: retained
          ? `This read did not complete, so the rows kept on screen are from an earlier one. ${entry.detail || ""}`.trim()
          : `${entry.detail || "This read did not answer."} Nothing that depends on it could be checked.`,
        evidence: [
          evidenceRow("Read status", entry.status, { kind: "text" }),
          evidenceRow("Rows kept on screen", entry.rows, { kind: entry.rows === null ? "missing" : "count" }),
        ],
        source,
        reader: entry.reader,
        action: { kind: "refresh", label: "Re-read the saved rows" },
      }),
    );
  }
  return items;
}

/** The account's own freshness: a throttle or a failed sync makes every other
 *  answer on the screen older than it looks. */
function accountAttention({ sources }) {
  const items = [];
  const source = sources?.context;
  const record = recordWith(source, ["sync", "account"]) || {};
  const sync = record?.sync || {};
  const state = String(sync?.status || "");
  const status = statusOf(source);
  const staleRead = FAILED.includes(status);
  if (!staleRead && !["throttled", "error", "stale"].includes(state)) return items;
  items.push(
    attentionItem("account_stale", {
      id: "context",
      title: state === "throttled" ? "The provider is rate limiting the sync" : "The reporting sync is not current",
      entity: null,
      records: [],
      detail:
        "Every number on this screen comes from saved rows. While the sync is not current they describe an earlier reading, not the live account.",
      evidence: [
        evidenceRow("Sync state", state || status, { kind: "text" }),
        evidenceRow("Last successful sync", String(sync?.lastSuccessAt || ""), { kind: "when" }),
        evidenceRow("Read status", status, { kind: "text" }),
      ],
      source,
      reader: "context",
      action: { kind: "refresh", label: "Re-read the saved rows" },
    }),
  );
  return items;
}

/**
 * The ranked attention list.
 *
 * Returns the items plus whether every source answered. `complete` is what the
 * screen reads before it is allowed to say "nothing needs you": an unread part
 * of the account is not a clean bill of health.
 */
export function attentionReport({ sources = {}, drafts = [] } = {}) {
  const coverage = readCoverage(sources);
  const rows = {
    campaigns: entityRows(sources, "campaign"),
    adsets: entityRows(sources, "adset"),
    ads: entityRows(sources, "ad"),
  };
  const all = [
    ...rows.campaigns.map((row) => ({ row, level: "campaign" })),
    ...rows.adsets.map((row) => ({ row, level: "adset" })),
    ...rows.ads.map((row) => ({ row, level: "ad" })),
  ];
  const indices = { campaigns: indexById(rows.campaigns), adsets: indexById(rows.adsets), ads: indexById(rows.ads) };

  const findings = (() => {
    const record = recordWith(sources?.tracking, ["validation", "templates", "history"]);
    return Array.isArray(record?.validation) ? record.validation : [];
  })();

  const items = [
    ...trackingAttention({ sources, findings, rows: { ...rows, all } }),
    ...queueAttention({ sources }),
    ...issueAttention({ sources, rows: { ...rows, all } }),
    ...spendWithoutOutcomeAttention({ sources, rows: { ...rows, all } }),
    ...stagedBudgetAttention({ sources, drafts }),
    ...accountAttention({ sources }),
    ...sourceAttention({ sources, coverage }),
    ...readerAttention({ sources, rows: { ...rows, all }, indices }),
  ];

  // One item per thing. Dedupe on the identity the item is about, not on its
  // title: two campaigns with the same name are two campaigns.
  const seen = new Set();
  const unique = [];
  for (const item of sortAttention(items)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }

  return Object.freeze({
    items: Object.freeze(unique),
    complete: coverage.complete,
    coverage,
  });
}

/**
 * The read model's own attention entries.
 *
 * A row-level flag already produced an item above; an entry about something
 * this module did not compute (or a live endpoint that only carries its
 * findings here) is kept rather than dropped, with the reader's sentence as its
 * evidence and the record looked up by id.
 */
function readerAttention({ sources, rows, indices }) {
  const items = [];
  const record = recordWith(sources?.overview, ["attention"]);
  if (!record || !Array.isArray(record.attention)) return items;
  const known = new Set();
  for (const entry of rows.all) {
    for (const issue of Array.isArray(entry.row?.issues) ? entry.row.issues : []) known.add(`${rowKey(entry.row)}:${issue?.kind}`);
  }
  for (const entry of record.attention) {
    const entityId = String(entry?.entityId || "");
    const kind = ISSUE_KINDS[entry?.kind] || "entity_flag";
    if (entityId && known.has(`${entityId}:${entry?.kind}`)) continue;
    // The record is looked up by id across the levels that were read. A prefix
    // is not enough: `cmp_001_set_1_ad_1` starts with the campaign prefix.
    const found = indices.campaigns.get(entityId) || indices.adsets.get(entityId) || indices.ads.get(entityId) || null;
    items.push(
      attentionItem(kind, {
        id: `${entityId || String(entry?.id || entry?.title || "reader")}:${String(entry?.kind || "")}`,
        title: String(entry?.title || entityId || "Flagged by the read model"),
        entity: found ? recordFor(found.level, found) : entityId ? Object.freeze({ kind: "", id: entityId, name: String(entry?.title || ""), level: "" }) : null,
        records: found ? [recordFor(found.level, found)] : [],
        detail: String(entry?.detail || ""),
        evidence: [
          evidenceRow("Reported by", String(entry?.kind || ""), { kind: "text" }),
          evidenceRow("Entity id", entityId, { kind: entityId ? "id" : "missing", note: entityId ? "" : "The entry names no record" }),
        ],
        source: sources?.overview,
        reader: "overview",
        action: found ? { kind: "open_record", label: `Inspect the ${found.level}`, record: recordFor(found.level, found) } : null,
      }),
    );
  }
  return items;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * The two lanes, and the metric each one ranks.
 *
 * They are ranked separately because they are different facts: a
 * provider-attributed result is Meta's own claim under an attribution setting,
 * and a CRM-qualified lead is a record a human moved. Adding them together
 * would produce a number that describes neither.
 */
export const RANK_LANES = Object.freeze({
  provider_attributed: Object.freeze({
    id: "provider_attributed",
    measurement: "provider_attributed",
    metric: "results",
    denominator: "linkClicks",
    label: "Meta-attributed results",
    noun: "results",
    rateLabel: "Results per unit of spend",
    costLabel: "Cost per result",
  }),
  crm_observed: Object.freeze({
    id: "crm_observed",
    measurement: "crm_observed",
    metric: "qualifiedLeads",
    denominator: "linkClicks",
    label: "CRM-qualified leads",
    noun: "qualified leads",
    rateLabel: "Qualified leads per unit of spend",
    costLabel: "Cost per qualified lead",
  }),
});

function minor(value) {
  return value === null ? 0 : Math.round(value * 100);
}

function outcomeLabel(metric) {
  if (metric === "results") return "Meta-attributed results";
  if (metric === "siteConversions") return "Website-observed conversions";
  if (metric === "qualifiedLeads") return "CRM-qualified leads";
  return metric;
}

function describeSilence(reading) {
  const silent = reading.counters.filter((counter) => !counter.present).map((counter) => outcomeLabel(counter.metric));
  if (!silent.length) return "every outcome counter answered, and none of them counted anything.";
  return `${silent.join(", ")} did not come back in this read at all.`;
}

/**
 * The evidence floor, applied to the metric actually being ranked.
 *
 * `evidenceFor()` judges a count against the floor and a spend floor, and it
 * reads the count from `row.results`. An observed metric is handed to it in
 * that shape so the same floor is applied to the number being ranked, and the
 * reason is written here with the right noun — "3 of the 25 qualified leads"
 * rather than a sentence about a different metric.
 */
export function rankedEvidence(row, lane, spendMinor = null) {
  const successes = num(row?.[lane.metric]);
  const trials = num(row?.[lane.denominator]);
  const base = evidenceFor({ results: successes, linkClicks: trials, spend: undefined }, { metric: "results", spendMinor });
  const reason =
    base.level === "insufficient"
      ? base.trials === null || base.trials <= 0
        ? `No denominator in this read, so no rate can be computed for ${lane.noun}.`
        : base.successes === null || base.successes <= 0
          ? `No ${lane.noun} observed in this window.`
          : `${base.successes} of the ${EVIDENCE_FLOOR.results} ${lane.noun} this window needs before a ranking means anything.`
      : base.level === "directional"
        ? `Enough ${lane.noun} to look at, too little spend for the rate to be stable.`
        : `${base.successes} ${lane.noun} over ${base.trials} ${lane.denominator === "impressions" ? "impressions" : lane.denominator === "siteSessions" ? "sessions" : "clicks"}.`;
  return Object.freeze({
    level: base.level,
    label: base.label,
    successes: base.successes,
    trials: base.trials,
    interval: base.interval,
    floor: EVIDENCE_FLOOR.results,
    spendFloorMinor: EVIDENCE_FLOOR.spendMinor,
    reason,
  });
}

/** One row's place in a lane. A row is rankable only when the floor let it
 *  through and there is spend and an outcome to divide by. */
export function laneEntry(row, lane, level = "") {
  const spend = spendOf(row);
  const outcome = num(row?.[lane.metric]);
  const spendMinor = spend === null ? null : minor(spend);
  const evidence = rankedEvidence(row, lane, spendMinor);
  const rankable = evidence.level !== "insufficient" && spend !== null && spend > 0 && outcome !== null;
  // A row that carries no delivery state has no delivery state. `stateOf()`
  // falls back to `draft` for rows that never had one, and calling an article a
  // draft would be a claim its reader never made.
  const reported = String(row?.state || row?.status || "");
  return Object.freeze({
    id: rowKey(row),
    name: rowName(row),
    level: String(row?.level || level || ""),
    state: reported ? stateOf(row) : "",
    proofOfDelivery: reported ? DELIVERY_PROOF_STATES.includes(stateOf(row)) : false,
    spend,
    spendReported: spend !== null,
    outcome,
    outcomeReported: outcome !== null,
    noOutcomeYet: outcome === 0,
    trials: num(row?.[lane.denominator]),
    perSpend: spend === null || spend <= 0 || outcome === null ? null : outcome / spend,
    costPerOutcome: outcome === null || outcome <= 0 || spend === null ? null : spend / outcome,
    evidence,
    rankable,
    row,
  });
}

/** Whether one entry has actually beaten another, on the lane's own metric. */
export function compareLaneEntries(a, b, lane) {
  return compareRates(
    { results: a?.outcome, linkClicks: a?.trials, spend: a?.spend },
    { results: b?.outcome, linkClicks: b?.trials, spend: b?.spend },
    { metric: "results", denominator: "linkClicks" },
  );
}

/**
 * One lane: the rows the floor lets through, ranked by outcome per unit of
 * spend, then the rows it does not, kept visible with their numbers and the
 * reason they are not ranked.
 *
 * The leader is only named when `compareRates()` separates it from the runner
 * up. A point estimate that happens to be higher is not a winner.
 */
export function outcomeLane({ sources = {}, level = "campaign", laneId = "", lane = null, rows = null, rowLabel = "" }) {
  const spec = lane || RANK_LANES[laneId];
  const source = Array.isArray(rows) ? rows : entityRows(sources, level);
  const nounForLevel = rowLabel || level;
  const entries = source.map((row) => laneEntry(row, spec, spec.level || level));
  const graded = entries.filter((entry) => entry.evidence.level !== "insufficient");
  const rankable = graded
    .filter((entry) => entry.rankable)
    .sort((a, b) => (b.perSpend !== a.perSpend ? b.perSpend - a.perSpend : b.spend - a.spend || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  const belowFloor = entries
    .filter((entry) => entry.evidence.level === "insufficient")
    .sort((a, b) => (b.spend || 0) - (a.spend || 0) || (a.id < b.id ? -1 : 1));
  const unmeasured = entries
    .filter((entry) => entry.evidence.level !== "insufficient" && !entry.rankable)
    .sort((a, b) => (b.spend || 0) - (a.spend || 0));

  let leader = null;
  let leaderReason = "";
  if (!rankable.length) {
    leaderReason = source.length
      ? `No ${nounForLevel} cleared the evidence floor for ${spec.noun} in this window, so nothing here is ranked.`
      : `No ${nounForLevel} rows came back for this window.`;
  } else if (rankable.length === 1) {
    leader = rankable[0];
    leaderReason = `Only one ${nounForLevel} cleared the evidence floor, so it is the only row a rate can be read from.`;
  } else {
    const verdict = compareLaneEntries(rankable[0], rankable[1], spec);
    if (verdict.verdict === "a") {
      leader = rankable[0];
      leaderReason = `Separated from the next row: ${verdict.reason}`;
    } else if (verdict.verdict === "b") {
      leader = rankable[1];
      leaderReason = `Separated from the top point estimate: ${verdict.reason}`;
    } else {
      leaderReason = `The top two are inside each other's confidence interval, so this window has no separated leader. ${verdict.reason}`;
    }
  }

  return Object.freeze({
    id: spec.id,
    measurement: spec.measurement,
    metric: spec.metric,
    denominator: spec.denominator,
    label: spec.label,
    noun: spec.noun,
    rateLabel: spec.rateLabel,
    costLabel: spec.costLabel,
    level: spec.level || level,
    ranked: Object.freeze(rankable.map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }))),
    belowFloor: Object.freeze(belowFloor.map((entry) => Object.freeze({ ...entry, rank: null }))),
    unmeasured: Object.freeze(unmeasured.map((entry) => Object.freeze({ ...entry, rank: null }))),
    leader: leader ? Object.freeze({ ...leader, rank: rankable.indexOf(leader) + 1 }) : null,
    leaderReason,
    rowCount: source.length,
  });
}

/**
 * How an outcome cell reads.
 *
 * A missing counter says so. A counter that answered zero says "no observed
 * outcome yet", because it is a statement about a window, not a zero result —
 * and a reader who sees "0" concludes the ad produced nothing, which the window
 * cannot know.
 */
export function outcomeText(entry) {
  if (!entry) return "—";
  if (entry.outcome === null || entry.outcome === undefined) return "Not in this read";
  if (entry.outcome === 0) return "No observed outcome yet";
  return String(entry.outcome);
}

/** Spend is never rendered as zero when the read did not carry it. */
export function spendText(entry) {
  if (!entry) return "—";
  if (entry.spend === null || entry.spend === undefined) return "Not in this read";
  if (entry.spend === 0) return "No spend recorded in this window";
  return String(entry.spend);
}

export function outcomeLanes({ sources = {}, level = "campaign" } = {}) {
  return Object.freeze([outcomeLane({ sources, level, laneId: "provider_attributed" }), outcomeLane({ sources, level, laneId: "crm_observed" })]);
}

/**
 * The destination lane: articles, ranked on CRM-qualified leads per unit of the
 * spend that promoted them.
 *
 * It is a separate lane rather than a column on the campaign lanes because an
 * article's spend and its outcomes come from different readers, and because the
 * rows are only advertised when the article is one an ad points at. Articles
 * with no spend in this read are not ranked — there is nothing to divide by —
 * and they are counted rather than dropped.
 */
export const DESTINATION_LANE = Object.freeze({
  id: "destinations",
  measurement: "crm_observed",
  metric: "qualifiedLeads",
  denominator: "siteSessions",
  label: "CRM-qualified leads per article",
  noun: "qualified leads",
  rateLabel: "Qualified leads per unit of spend",
  costLabel: "Cost per qualified lead",
  level: "blog",
});

export function destinationLane({ sources = {} } = {}) {
  const all = normalizedRows(rowsOf(sources?.blogs));
  const promoted = all.filter((row) => (spendOf(row) || 0) > 0);
  const lane = outcomeLane({ lane: DESTINATION_LANE, rows: promoted, rowLabel: "article" });
  const unpromoted = all.length - promoted.length;
  return Object.freeze({
    ...lane,
    articleCount: all.length,
    promotedCount: promoted.length,
    unpromotedCount: unpromoted,
    missingSpendCount: all.filter((row) => spendOf(row) === null).length,
  });
}

/**
 * How much of the window is still moving.
 *
 * Attribution keeps settling after a click, so the last few days of a window
 * are provisional. Saying so is the difference between a number and a promise.
 */
export function settlementNote({ params = {}, now = Date.now() } = {}) {
  const to = String(params?.to || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(end)) return null;
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((start - end) / 86400000);
  if (days < 0 || days > ATTRIBUTION_SETTLE_DAYS) return null;
  return Object.freeze({
    days,
    settleDays: ATTRIBUTION_SETTLE_DAYS,
    message: `The window ends ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}, so attribution is still settling. These rows are re-fetched for about ${ATTRIBUTION_SETTLE_DAYS} days and the last few days can still move.`,
  });
}

// ---------------------------------------------------------------------------
// Test recommendations
// ---------------------------------------------------------------------------

export const RECOMMENDATION_KINDS = Object.freeze({
  consolidate_duplicates: Object.freeze({ weight: 90, label: "Consolidate two near-duplicate creatives" }),
  fix_tracking_first: Object.freeze({ weight: 85, label: "Fix the tracking before judging this creative" }),
  scale_winner: Object.freeze({ weight: 80, label: "A proven winner is a candidate to scale" }),
  check_destination: Object.freeze({ weight: 70, label: "Traffic is arriving and nothing converts" }),
  needs_volume: Object.freeze({ weight: 60, label: "A strong rate with too little volume to rank" }),
  use_as_control: Object.freeze({ weight: 50, label: "Readable and unremarkable: use it as the control" }),
  keep_running: Object.freeze({ weight: 40, label: "Below the evidence floor: keep running, do not judge it yet" }),
});

// The signature the creative screen also uses to call two creatives possible
// near-duplicates. Kept in one place conceptually: if these three agree, the
// two rows were asked for the same thing.
const DUPLICATE_SIGNATURE = Object.freeze(["concept", "hook", "format"]);

function text(value) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function recommendation(kind, { id, title, detail, entity = null, records = [], evidence = [], source = null, reader = "", action = null, whatWouldChange = [], spend = null }) {
  const spec = RECOMMENDATION_KINDS[kind];
  return Object.freeze({
    id: `${kind}:${id}`,
    kind,
    label: spec.label,
    weight: spec.weight,
    title,
    detail,
    entity,
    records: Object.freeze(records.filter(Boolean)),
    evidence: Object.freeze(evidence.filter(Boolean)),
    reader,
    observedAt: observedAtOf(source),
    action,
    whatWouldChange: Object.freeze(whatWouldChange.filter(Boolean)),
    spendMinor: minor(spend),
  });
}

export function duplicatePairs(creatives = []) {
  const pairs = new Map();
  const bySignature = new Map();
  const note = (key, other, kind) => {
    pairs.set([key, other].sort().join("→"), { a: key, b: other, kind });
  };
  for (const row of creatives) {
    const key = rowKey(row);
    const marked = text(row?.nearDuplicateOf);
    if (marked && marked !== key && !pairs.has([key, marked].sort().join("→"))) note(key, marked, "marked");
    const parts = DUPLICATE_SIGNATURE.map((dimension) => text(row?.[dimension]));
    if (parts.every(Boolean)) {
      const signature = parts.join(" · ").toLowerCase();
      if (!bySignature.has(signature)) bySignature.set(signature, { parts, keys: [] });
      bySignature.get(signature).keys.push(key);
    }
  }
  for (const { parts, keys } of bySignature.values()) {
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const pairKey = [keys[i], keys[j]].sort().join("→");
        if (!pairs.has(pairKey)) pairs.set(pairKey, { a: keys[i], b: keys[j], kind: "shared", signature: parts.join(" · ") });
      }
    }
  }
  return Array.from(pairs.values());
}

/** The pooled rate across a set of rows: the line a single row is compared
 *  against, built from the same counters the rows carry. The keys are named for
 *  the metric and the denominator being pooled, so `compareRates()` can read the
 *  pool exactly as it reads a row. */
export function pooledRate(rows = [], { successKey = "results", trialKey = "linkClicks" } = {}) {
  let successes = 0;
  let trials = 0;
  let measured = false;
  for (const row of rows) {
    const k = num(row?.[successKey]);
    const n = num(row?.[trialKey]);
    if (k === null || n === null) continue;
    measured = true;
    successes += k;
    trials += n;
  }
  if (!measured || trials <= 0) return null;
  return Object.freeze({ [successKey]: successes, [trialKey]: trials, successes, trials });
}

/**
 * What to test next.
 *
 * Every recommendation has to answer three things in the drawer it opens: what
 * the evidence is, what action it proposes, and what would change the
 * conclusion. A recommendation that cannot state the third is an opinion, and
 * this function is not allowed to produce one.
 */
export function testRecommendations({ sources = {} } = {}) {
  const coverage = readCoverage(sources);
  const creatives = normalizedRows(rowsOf(sources?.creatives));
  const ads = entityRows(sources, "ad");
  const adsets = entityRows(sources, "adset");
  const campaigns = entityRows(sources, "campaign");
  const creativeIndex = indexById(creatives);
  const source = sources?.creatives;
  const items = [];

  if (!coverage.entries.find((entry) => entry.key === "creatives")?.answered) {
    return Object.freeze({ items: Object.freeze([]), complete: false, coverage });
  }

  const pool = pooledRate(creatives, { successKey: "results", trialKey: "linkClicks" });
  // The comparison a below-floor creative can actually be judged against. The
  // results floor is what stops it being ranked, so asking whether its *rate* is
  // strong has to use the counter that does have evidence behind it: link
  // clicks against impressions. Calling that a hook rate would be a claim the
  // rows do not support, so it is named for what it is.
  const clickPool = pooledRate(creatives, { successKey: "linkClicks", trialKey: "impressions" });

  // ---------------------------------------------------------- duplicates ---
  const byId = creativeIndex;
  for (const pair of duplicatePairs(creatives)) {
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    if (!a || !b) continue; // a marker pointing at a row outside this read is not a recommendation
    const combinedSpend = (spendOf(a) || 0) + (spendOf(b) || 0);
    const verdict = compareRates(a, b, { metric: "results", denominator: "linkClicks" });
    const separated = verdict.verdict === "a" || verdict.verdict === "b";
    const weaker = separated ? (verdict.verdict === "a" ? b : a) : null;
    const stronger = separated ? (verdict.verdict === "a" ? a : b) : null;
    // A pause is staged against a row that can actually be paused: the ads
    // running the weaker rendition, or the ad sets if no ad row came back.
    const weakerTargets = weaker
      ? adsForCreative(rowKey(weaker), ads).length
        ? adsForCreative(rowKey(weaker), ads).map((ad) => recordFor("ad", ad))
        : adsetsForCreative(rowKey(weaker), ads, adsets).map((adset) => recordFor("adset", adset))
      : [];
    items.push(
      recommendation("consolidate_duplicates", {
        id: [pair.a, pair.b].sort().join("→"),
        title: `${rowName(a)} and ${rowName(b)}`,
        detail: separated
          ? "These two are the same idea, and one of them is measurably the weaker rendition. Consolidate the library on the stronger one and move the weaker one's budget to it."
          : "These two are the same idea, and this window does not separate them. Consolidate the creatives rather than the ads: running both splits the volume that would make either one rankable.",
        entity: recordFor("creative", stronger || a),
        records: [recordFor("creative", a), recordFor("creative", b)],
        evidence: [
          evidenceRow("Matched on", pair.kind === "marked" ? "an explicit near-duplicate marker" : text(pair.signature) || DUPLICATE_SIGNATURE.join(" · "), { kind: "text" }),
          evidenceRow("Creative A", `${pair.a} · ${rowName(a)}`, { kind: "id" }),
          evidenceRow("Creative B", `${pair.b} · ${rowName(b)}`, { kind: "id" }),
          evidenceRow("Combined spend in this window", combinedSpend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
          evidenceRow("A: results", num(a?.results), { kind: "count", metric: "results", measurement: "provider_attributed" }),
          evidenceRow("B: results", num(b?.results), { kind: "count", metric: "results", measurement: "provider_attributed" }),
          evidenceRow("Comparison", separated ? "Separated" : "Not separated", { kind: "text", note: verdict.reason }),
        ],
        source,
        reader: "creatives",
        spend: combinedSpend,
        action: {
          kind: separated && weakerTargets.length ? "stage_pause" : "open_record",
          label: separated && weakerTargets.length ? "Stage a pause of the weaker rendition" : "Inspect both renditions",
          targets: separated ? weakerTargets : [],
          record: recordFor("creative", a),
        },
        whatWouldChange: [
          "If the two differ in asset, format or crop, they are two versions of one creative rather than a duplicate — the version policy is the test.",
          separated
            ? "If the confidence intervals meet in the next window, the weaker one is no longer measurably weaker and nothing should be paused."
            : "If one of them separates from the other next window, it becomes a scale candidate instead of a consolidation.",
        ],
      }),
    );
  }

  // -------------------------------------------------------- per creative ---
  for (const creative of creatives) {
    const id = rowKey(creative);
    const evidence = rankedEvidence(creative, RANK_LANES.provider_attributed, minor(spendOf(creative)));
    const spend = spendOf(creative);
    const results = num(creative?.results);
    const clicks = num(creative?.linkClicks);
    const runAds = adsForCreative(id, ads);
    const runAdsets = adsetsForCreative(id, ads, adsets);
    const targets = runAdsets.map((adset) => recordFor("adset", adset));

    // Broken tracking first: a URL that does not resolve to one value makes
    // every number below it unsafe to act on.
    const findings = [];
    for (const ad of runAds) {
      const record = recordWith(sources?.tracking, ["validation", "templates", "history"]);
      for (const finding of Array.isArray(record?.validation) ? record.validation : []) {
        if (String(finding?.adId || "") === rowKey(ad) && ["error", "warning"].includes(String(finding?.severity || ""))) findings.push({ ad, finding });
      }
    }
    if (findings.length) {
      items.push(
        recommendation("fix_tracking_first", {
          id,
          title: rowName(creative),
          detail: "An ad running this creative has a tracking parameter that does not resolve to one value. Until that is fixed the outcomes cannot be attributed to it, so no test of this creative can be read.",
          entity: recordFor("creative", creative),
          records: [recordFor("creative", creative), ...findings.map(({ ad }) => recordFor("ad", ad))],
          evidence: [
            evidenceRow("Failing URL", String(findings[0].finding?.url || ""), { kind: "url" }),
            evidenceRow("Finding", String(findings[0].finding?.detail || ""), { kind: "text" }),
            evidenceRow("Ads running this creative", runAds.length, { kind: "count" }),
          ],
          source: sources?.tracking,
          reader: "tracking",
          spend,
          action: { kind: "open_record", label: "Inspect the ad carrying this URL", record: recordFor("ad", findings[0].ad) },
          whatWouldChange: [
            "Once the URL resolves to a single value per parameter, this creative can be judged on the outcomes the read model reports.",
          ],
        }),
      );
      // The tracking problem is the finding; a volume verdict on top of it
      // would be a judgement about numbers that cannot be trusted yet.
      continue;
    }

    if (spend !== null && spend > 0) {
      if (evidence.level === "comparable" && pool) {
        const verdict = compareRates(creative, pool, { metric: "results", denominator: "linkClicks" });
        const runnerUp = creatives
          .filter((other) => rowKey(other) !== id)
          .map((other) => laneEntry(other, RANK_LANES.provider_attributed))
          .filter((entry) => entry.rankable)
          .sort((x, y) => y.perSpend - x.perSpend)[0];
        const beatsRunner = runnerUp ? compareLaneEntries(laneEntry(creative, RANK_LANES.provider_attributed), runnerUp, RANK_LANES.provider_attributed) : null;
        if (verdict.verdict === "a" && (!runnerUp || beatsRunner?.verdict === "a")) {
          items.push(
            recommendation("scale_winner", {
              id,
              title: rowName(creative),
              detail: "This creative beats both the account's pooled rate and the next comparable creative on Meta-attributed results, with enough volume behind it to mean something. It is a candidate to scale.",
              entity: recordFor("creative", creative),
              records: [recordFor("creative", creative), ...targets],
              evidence: [
                evidenceRow("Results", results, { kind: "count", metric: "results", measurement: "provider_attributed" }),
                evidenceRow("Spend in this window", spend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
                evidenceRow("Cost per result", results > 0 ? spend / results : null, { kind: "currency", metric: "costPerResult", measurement: "provider_attributed" }),
                evidenceRow("Against the pooled rate", "Higher", { kind: "text", note: verdict.reason }),
                !runnerUp ? evidenceRow("Next comparable creative", "None this window", { kind: "missing" }) : null,
              ],
              source,
              reader: "creatives",
              spend,
              action: {
                ...(targets.length
                  ? { kind: "stage_budget", label: "Stage a budget increase on the ad set running it", targets, percents: [10, 25, 50] }
                  : { kind: "open_record", label: "Inspect the creative", record: recordFor("creative", creative) }),
                // A budget change is one way to give a row more room; a fresh
                // launch seeded with the same creative is the other, and the
                // launch flow is where that draft is built.
                launchSeed: { creativeIds: [id] },
              },
              whatWouldChange: [
                "If the next window's interval overlaps the runner-up's, the difference was noise and the increase is not justified.",
                "If the ad set's own results stay flat after the increase, the rate was not the constraint — the audience or the budget cap is.",
              ],
            }),
          );
        } else {
          // Comparable, and not separated from the account's own pooled rate.
          // That is the definition of a control: it is the row a new test
          // should be measured against, not a row to scale.
          items.push(
            recommendation("use_as_control", {
              id,
              title: rowName(creative),
              detail: "This creative has enough volume behind its rate to be read, and it is not measurably better than the account's pooled rate. It is the honest control for the next test rather than a scale candidate.",
              entity: recordFor("creative", creative),
              records: [recordFor("creative", creative), ...targets],
              evidence: [
                evidenceRow("Results", results, { kind: "count", metric: "results", measurement: "provider_attributed" }),
                evidenceRow("Spend in this window", spend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
                evidenceRow("Cost per result", results > 0 ? spend / results : null, { kind: "currency", metric: "costPerResult", measurement: "provider_attributed" }),
                evidenceRow("Against the pooled rate", verdict.verdict === "b" ? "Lower" : "Not separated", { kind: "text", note: verdict.reason }),
              ],
              source,
              reader: "creatives",
              spend,
              action: {
                kind: "open_record",
                label: "Inspect the creative, then start the next test against it",
                record: recordFor("creative", creative),
                launchSeed: { creativeIds: [id] },
              },
              whatWouldChange: [
                "If the next window separates it above the pooled rate, it becomes a scale candidate.",
                "If it separates below, the next test should replace it rather than be measured against it.",
              ],
            }),
          );
        }
      } else if (evidence.level === "insufficient" && clicks !== null && clicks >= EVIDENCE_FLOOR.clicks && results === 0) {
        const clickVerdict = clickPool ? compareRates(creative, clickPool, { metric: "linkClicks", denominator: "impressions" }) : null;
        items.push(
          recommendation("check_destination", {
            id,
            title: rowName(creative),
            detail: "This creative has enough clicks to be past the click floor and no Meta-attributed result at all. That points at the destination or the tracking rather than at volume: more spend on the same path buys the same clicks.",
            entity: recordFor("creative", creative),
            records: [recordFor("creative", creative), ...targets],
            evidence: [
              evidenceRow("Link clicks", clicks, { kind: "count", metric: "linkClicks" }),
              evidenceRow("Results", results, { kind: "count", metric: "results", measurement: "provider_attributed" }),
              evidenceRow("Click-through rate", metricValue("ctr", creative), { kind: "percent", metric: "ctr" }),
              clickPool
                ? evidenceRow("Against the pooled click rate", clickVerdict?.verdict === "a" ? "Higher" : clickVerdict?.verdict === "b" ? "Lower" : "Not separated", { kind: "text", note: clickVerdict?.reason || "" })
                : null,
              evidenceRow("Destination", String(runAds[0]?.destination || ""), { kind: "url" }),
            ],
            source,
            reader: "creatives",
            spend,
            action: { kind: "open_record", label: "Inspect the ad and its destination", record: runAds[0] ? recordFor("ad", runAds[0]) : recordFor("creative", creative) },
            whatWouldChange: [
              `If results arrive after attribution settles — the window is re-fetched for about ${ATTRIBUTION_SETTLE_DAYS} days — this becomes a volume question instead.`,
              "If the destination's own site-observed sessions are also flat, the problem is the offer or the page, not the ad.",
            ],
          }),
        );
      } else if (evidence.level === "insufficient" && clicks !== null && clicks >= EVIDENCE_FLOOR.clicks && results !== null && results > 0) {
        const clickVerdict = clickPool ? compareRates(creative, clickPool, { metric: "linkClicks", denominator: "impressions" }) : null;
        if (clickVerdict?.verdict === "a") {
          items.push(
            recommendation("needs_volume", {
              id,
              title: rowName(creative),
              detail: `This creative earns clicks at a better rate than the account's pooled rate but has not reached the ${EVIDENCE_FLOOR.results} results a ranking needs. It needs volume, not a verdict.`,
              entity: recordFor("creative", creative),
              records: [recordFor("creative", creative), ...targets],
              evidence: [
                evidenceRow("Results", results, { kind: "count", metric: "results", measurement: "provider_attributed" }),
                evidenceRow("Results the floor needs", EVIDENCE_FLOOR.results, { kind: "count" }),
                evidenceRow("Link clicks", clicks, { kind: "count", metric: "linkClicks" }),
                clickPool ? evidenceRow("Against the pooled click rate", "Higher", { kind: "text", note: clickVerdict.reason }) : null,
                evidenceRow("Spend in this window", spend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
              ],
              source,
              reader: "creatives",
              spend,
              action: {
                ...(targets.length
                  ? { kind: "stage_budget", label: "Stage a budget increase on the ad set running it", targets, percents: [10, 25, 50] }
                  : { kind: "open_record", label: "Inspect the creative", record: recordFor("creative", creative) }),
                // A budget change is one way to give a row more room; a fresh
                // launch seeded with the same creative is the other, and the
                // launch flow is where that draft is built.
                launchSeed: { creativeIds: [id] },
              },
              whatWouldChange: [
                `Reaching ${EVIDENCE_FLOOR.results} results at this rate would make it rankable; the interval would then say whether the rate held.`,
                "If the click rate falls back to the pooled rate as volume grows, the extra spend is not buying anything and the increase should be undone.",
              ],
            }),
          );
        } else {
          // Enough clicks to be read, some results, still under the floor, and
          // not measurably better than the pool. That is a row to leave alone
          // and keep watching — not one to crown and not one to kill.
          items.push(
            recommendation("keep_running", {
              id,
              title: rowName(creative),
              detail: `This creative is past the click floor and under the ${EVIDENCE_FLOOR.results}-result floor, and this window does not separate its click rate from the account's pooled rate. Judging it now would be reading noise.`,
              entity: recordFor("creative", creative),
              records: [recordFor("creative", creative), ...targets],
              evidence: [
                evidenceRow("Results", results, { kind: "count", metric: "results", measurement: "provider_attributed" }),
                evidenceRow("Results the floor needs", EVIDENCE_FLOOR.results, { kind: "count" }),
                evidenceRow("Link clicks", clicks, { kind: "count", metric: "linkClicks" }),
                evidenceRow("Spend in this window", spend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
                clickPool ? evidenceRow("Against the pooled click rate", clickVerdict?.verdict === "b" ? "Lower" : "Not separated", { kind: "text", note: clickVerdict?.reason || "" }) : null,
              ],
              source,
              reader: "creatives",
              spend,
              action: { kind: "open_record", label: "Inspect the creative", record: recordFor("creative", creative) },
              whatWouldChange: [
                `Reaching ${EVIDENCE_FLOOR.results} results would let the interval decide, instead of the point estimate.`,
                "If its rate separates below the pooled rate first, the next test should replace it.",
              ],
            }),
          );
        }
      } else if (evidence.level === "insufficient") {
        items.push(
          recommendation("keep_running", {
            id,
            title: rowName(creative),
            detail: "This creative has not reached the evidence floor, so this window cannot say whether it works. Below the floor the honest reading is that it is unjudged, not that it lost.",
            entity: recordFor("creative", creative),
            records: [recordFor("creative", creative), ...targets],
            evidence: [
              evidenceRow("Results", results, { kind: results === null ? "missing" : "count", metric: "results", measurement: "provider_attributed", note: results === null ? "Not in this read" : "" }),
              evidenceRow("Results the floor needs", EVIDENCE_FLOOR.results, { kind: "count" }),
              evidenceRow("Link clicks", clicks, { kind: clicks === null ? "missing" : "count", metric: "linkClicks" }),
              evidenceRow("Spend in this window", spend, { kind: "currency", metric: "spend", measurement: "provider_attributed" }),
              evidenceRow("Why it is not ranked", evidence.reason, { kind: "text" }),
            ],
            source,
            reader: "creatives",
            spend,
            action: { kind: "open_record", label: "Inspect the creative", record: recordFor("creative", creative) },
            whatWouldChange: [
              `Reaching ${EVIDENCE_FLOOR.results} results, or ${EVIDENCE_FLOOR.clicks} link clicks with no result, would move this out of "unjudged" and into a comparison.`,
              "If the spend keeps rising while the counters stay where they are, it becomes a spend-without-outcome question instead.",
            ],
          }),
        );
      }
    }
  }

  const seen = new Set();
  const sorted = items
    .slice()
    .sort((a, b) => b.weight - a.weight || b.spendMinor - a.spendMinor || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

  return Object.freeze({
    items: Object.freeze(sorted),
    complete: coverage.complete,
    coverage,
    pooled: pool,
    creativeCount: creatives.length,
    adCount: ads.length,
    adsetCount: adsets.length,
    campaignCount: campaigns.length,
  });
}

// ---------------------------------------------------------------------------
// The whole decision set
// ---------------------------------------------------------------------------

/**
 * Everything the Overview screen renders, decided once.
 *
 * The screen passes the envelopes it holds; this returns the three answers plus
 * the coverage that says which parts of the account could not be checked.
 */
export function buildDecisions({ sources = {}, drafts = [], level = "campaign", params = {}, now = Date.now() } = {}) {
  const coverage = readCoverage(sources);
  const attention = attentionReport({ sources, drafts });
  const lanes = outcomeLanes({ sources, level });
  const destinations = destinationLane({ sources });
  const recommendations = testRecommendations({ sources });
  return Object.freeze({
    coverage,
    attention,
    outcomes: Object.freeze({
      level,
      lanes,
      destinations,
      settling: settlementNote({ params, now }),
      rowCount: lanes[0]?.rowCount || 0,
    }),
    recommendations,
  });
}

export const __internals = Object.freeze({ minor, describeSilence, ISSUE_KINDS, DUPLICATE_SIGNATURE, SOURCE_LABELS });
