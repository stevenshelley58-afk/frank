// Overview decision rules for the Ads workspace.
//
// The Overview answers three questions — what needs the owner, where spend is
// producing outcomes, and what to test next — and every one of those answers is
// decided by `ads-decisions.js`. These tests exist because each rule can be
// wrong quietly:
//
//   * a read that returned no outcome figures at all can be read as "zero
//     outcomes", which turns silence into a claim about the business;
//   * a ranking that ignores the evidence floor crowns a winner on three
//     results, and the confidence interval never gets a say;
//   * a join that matches on a name splits or merges the moment somebody
//     renames something;
//   * a recommendation that cannot say what would change its mind is an
//     opinion wearing evidence as a costume.
//
// Rule-level, no browser. The interactive journeys in acceptance/ads_journey.py
// drive the same modules through the real screens.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ATTENTION_KINDS,
  DESTINATION_LANE,
  RECOMMENDATION_KINDS,
  RANK_LANES,
  adsForArticle,
  adsForCampaign,
  adsForCreative,
  attentionReport,
  buildDecisions,
  compareLaneEntries,
  destinationLane,
  duplicatePairs,
  evidenceRow,
  laneEntry,
  outcomeLane,
  outcomeText,
  outcomeReading,
  rankedEvidence,
  readCoverage,
  renditionOf,
  settlementNote,
  spendText,
  testRecommendations,
} from "../web/js/ads/ads-decisions.js";
import { EVIDENCE_FLOOR } from "../web/js/ads/ads-contracts.js";

/* ------------------------------------------------------------- fixtures --- */

const envelope = (rows, { status = "ready", fetchedAt = 1_700_000_000_000, detail = "", failedStatus = "" } = {}) => ({
  status,
  data: { rows, meta: {} },
  detail,
  fetchedAt,
  failedStatus,
  origin: "live",
  cached: false,
});

const record = (payload, { status = "ready", fetchedAt = 1_700_000_000_000, detail = "" } = {}) => ({
  status,
  data: { rows: null, meta: payload },
  detail,
  fetchedAt,
  origin: "live",
  cached: false,
});

const emptyEntities = () => ({ campaign: envelope([]), adset: envelope([]), ad: envelope([]) });

const sources = (over = {}) => ({
  context: record({ account: { currency: "GBP" }, sync: { status: "ready", lastSuccessAt: "2026-09-14T07:00:00.000Z" } }),
  overview: record({ totals: { spend: 100, results: 40 }, series: [{ date: "2026-09-01", spend: 100, results: 40 }] }),
  entities: emptyEntities(),
  creatives: envelope([]),
  blogs: envelope([]),
  tracking: record({ templates: [], validation: [], history: [] }),
  queue: record({ batches: [], activity: [], changes: [] }),
  ...over,
});

/** A creative that clears the results floor: 40 results from 800 clicks for
 *  £120 of spend. */
const strongCreative = (over = {}) => ({
  id: "cr_0001",
  internalId: "cr_0001",
  name: "Cost of a missed call — question",
  concept: "Cost of a missed call",
  hook: "Question",
  format: "Single image",
  state: "delivering",
  results: 40,
  linkClicks: 800,
  impressions: 20000,
  spend: 120,
  ...over,
});

/** A creative below the results floor: 6 results is real work, not a verdict. */
const quietCreative = (over = {}) => ({
  id: "cr_0002",
  internalId: "cr_0002",
  name: "Same-day quote — statistic",
  concept: "Same-day quote",
  hook: "Statistic",
  format: "Short video",
  state: "delivering",
  results: 6,
  linkClicks: 400,
  impressions: 12000,
  spend: 90,
  ...over,
});

const campaign = (over = {}) => ({
  id: "cmp_001",
  internalId: "cmp_001",
  level: "campaign",
  name: "Leads — Always on 1",
  state: "delivering",
  spend: 200,
  results: 40,
  linkClicks: 900,
  impressions: 30000,
  qualifiedLeads: 30,
  ...over,
});

/* ------------------------------------------------------------- coverage --- */

test("an unanswered reader is a named blind spot, not an empty one", () => {
  const missing = readCoverage(sources({ tracking: envelope([], { status: "not_connected" }) }));
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.missing, ["tracking"]);
  assert.equal(missing.entries.find((entry) => entry.key === "tracking").answered, false);

  // `empty` is an answer — there were no rows — and it must not be confused
  // with a reader that has no implementation.
  const empty = readCoverage(sources({ tracking: envelope([], { status: "empty" }) }));
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.missing, []);

  // A stale answer keeps its rows and its original reading time.
  const stale = readCoverage(
    sources({ entities: { ...emptyEntities(), ad: envelope([{ id: "ad_1" }], { status: "stale", fetchedAt: 4242, failedStatus: "throttled" }) } }),
  );
  const adEntry = stale.entries.find((entry) => entry.key === "entities.ad");
  assert.equal(adEntry.retained, true);
  assert.equal(adEntry.observedAt, 4242);
  assert.equal(adEntry.rows, 1);
  assert.equal(stale.complete, false, "a retained read still did not answer");
});

test("nothing needs you is only sayable when every reader answered", () => {
  const clean = attentionReport({ sources: sources() });
  assert.equal(clean.items.length, 0);
  assert.equal(clean.complete, true);

  const partial = attentionReport({ sources: sources({ queue: envelope([], { status: "error", detail: "The read model answered 500." }) }) });
  assert.equal(partial.complete, false);
  assert.ok(partial.items.some((item) => item.kind === "source_unavailable"), "the failed read is itself an item");
});

/* ------------------------------------------------------------ attention --- */

test("a failing tracking URL is the evidence, and the ad id is the identity", () => {
  const report = attentionReport({
    sources: sources({
      tracking: record({
        templates: [],
        validation: [
          {
            id: "val_1",
            severity: "error",
            kind: "encoding",
            adId: "cmp_003_set_2_ad_1",
            adName: "Before and after — direct address",
            detail: "Unencoded space in utm_campaign.",
            url: "https://example.invalid/guides/regulations?utm_campaign=Q3 push",
          },
        ],
        history: [],
      }),
    }),
  });
  const item = report.items.find((entry) => entry.kind === "tracking_broken");
  assert.ok(item, "a tracking error is an attention item");
  assert.equal(item.entity.kind, "ad");
  assert.equal(item.entity.id, "cmp_003_set_2_ad_1", "the item is keyed on the immutable id");
  assert.equal(item.evidence.find((row) => row.label === "Failing URL").value, "https://example.invalid/guides/regulations?utm_campaign=Q3 push");
  assert.equal(item.severity, ATTENTION_KINDS.tracking_broken.severity);
  assert.ok(item.observedAt, "the item carries when the reading it came from was observed");
});

test("an uncertain write is reconciled, never retried blind", () => {
  const report = attentionReport({
    sources: sources({
      queue: record({
        batches: [
          {
            id: "batch_011",
            internalId: "batch_011",
            name: "Evergreen — July pack 11",
            state: "uncertain",
            failures: 1,
            rows: [{ id: "batch_011_row_1", name: "Customer story — statistic", state: "uncertain", attempts: 2, detail: "The write was accepted but delivery was never confirmed." }],
          },
        ],
        activity: [],
        changes: [],
      }),
    }),
  });
  const item = report.items.find((entry) => entry.kind === "write_uncertain");
  assert.ok(item);
  assert.equal(item.entity.id, "batch_011");
  assert.ok(item.records.some((entry) => entry.id === "batch_011_row_1"), "the row behind the batch is carried too");
  assert.match(item.detail, /reconcile/i);
  assert.match(item.detail, /duplicate ad/i, "the reason not to resend is stated");
  assert.equal(item.action.kind, "open_record", "the proposed action is to look, not to write");
  assert.doesNotMatch(item.action.label, /retry|resend/i);

  const failed = attentionReport({
    sources: sources({ queue: record({ batches: [{ id: "batch_012", name: "Launch pack", state: "failed", failures: 3, lastError: "Asset rejected." }], activity: [], changes: [] }) }),
  });
  assert.equal(failed.items.find((entry) => entry.kind === "write_failed").entity.id, "batch_012");
});

test("a learning-limited ad set is flagged against the ad set's own id", () => {
  const report = attentionReport({
    sources: sources({
      entities: {
        ...emptyEntities(),
        adset: envelope([
          {
            id: "cmp_001_set_2",
            internalId: "cmp_001_set_2",
            level: "adset",
            name: "Lookalike 1% 2",
            state: "delivering",
            spend: 300,
            results: 12,
            linkClicks: 500,
            issues: [{ kind: "learning_limited", detail: "Ad set left the learning phase with fewer than 50 results." }],
          },
        ]),
      },
    }),
  });
  const item = report.items.find((entry) => entry.kind === "learning_limited");
  assert.equal(item.entity.kind, "adset");
  assert.equal(item.entity.id, "cmp_001_set_2");
  assert.equal(item.detail, "Ad set left the learning phase with fewer than 50 results.");
});

test("spend with no observed outcome needs a counter that actually answered", () => {
  // A counter answered zero: the row spent money and nothing came back. That is
  // a fact about the window and it is worth the owner's attention.
  const answered = attentionReport({
    sources: sources({
      entities: { ...emptyEntities(), campaign: envelope([campaign({ results: 0, qualifiedLeads: 0, siteConversions: 0, spend: 900 })]) },
    }),
  });
  const item = answered.items.find((entry) => entry.kind === "spend_no_outcome");
  assert.ok(item, "a reported zero is a real observation");
  assert.match(item.detail, /no observed outcome yet/i);
  assert.doesNotMatch(item.detail, /\b0\b/, "the item never renders the outcome as 0");

  // Every outcome counter missing: the read said nothing, so neither does the
  // item. Silence is not a zero.
  const silent = attentionReport({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([{ id: "cmp_002", internalId: "cmp_002", level: "campaign", name: "Silent row", state: "delivering", spend: 900 }]),
      },
    }),
  });
  assert.equal(silent.items.find((entry) => entry.kind === "spend_no_outcome"), undefined);

  // Below the contract's own spend floor there is nothing to conclude either
  // way, so the item does not fire.
  const small = attentionReport({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([campaign({ id: "cmp_003", internalId: "cmp_003", spend: EVIDENCE_FLOOR.spendMinor / 100 - 1, results: 0, qualifiedLeads: 0 })]),
      },
    }),
  });
  assert.equal(small.items.find((entry) => entry.kind === "spend_no_outcome"), undefined);
});

test("outcome readings keep the three measurement kinds apart", () => {
  const reading = outcomeReading({ results: 0, qualifiedLeads: 4 });
  assert.equal(reading.noOutcomeObserved, false, "one positive counter is enough");
  assert.equal(reading.answeredCount, 2);
  assert.deepEqual(reading.counters.map((counter) => counter.measurement), ["provider_attributed", "site_observed", "crm_observed"]);
  assert.equal(reading.counters.find((counter) => counter.metric === "siteConversions").present, false);
});

test("a stale or throttled account is said out loud, with its last success", () => {
  const report = attentionReport({
    sources: sources({
      context: record(
        { account: { currency: "GBP" }, sync: { status: "throttled", lastSuccessAt: "2026-09-14T07:00:00.000Z" } },
        { status: "stale", detail: "The provider is rate limiting the sync." },
      ),
    }),
  });
  const item = report.items.find((entry) => entry.kind === "account_stale");
  assert.ok(item);
  assert.equal(item.reader, "context");
  assert.ok(item.evidence.some((row) => row.label === "Last successful sync"));
});

test("two rows with the same name are two rows", () => {
  const report = attentionReport({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([
          campaign({ id: "cmp_010", internalId: "cmp_010", name: "Retargeting", results: 0, qualifiedLeads: 0, spend: 900 }),
          campaign({ id: "cmp_011", internalId: "cmp_011", name: "Retargeting", results: 0, qualifiedLeads: 0, spend: 800 }),
        ]),
      },
    }),
  });
  const spendItems = report.items.filter((entry) => entry.kind === "spend_no_outcome");
  assert.equal(spendItems.length, 2, "a shared name must not collapse two rows into one");
  assert.deepEqual(spendItems.map((item) => item.entity.id).sort(), ["cmp_010", "cmp_011"]);
});

test("the reader's own attention entries are kept when nothing else covers them", () => {
  const covered = attentionReport({
    sources: sources({
      overview: record({
        totals: { spend: 1 },
        series: [],
        attention: [{ id: "att_1", kind: "tracking", severity: "warning", title: "Leads — Always on 1", detail: "Duplicate utm_source.", entityId: "cmp_001" }],
      }),
      entities: { ...emptyEntities(), campaign: envelope([campaign({ issues: [{ kind: "tracking", detail: "Duplicate utm_source." }] })]) },
    }),
  });
  assert.equal(covered.items.filter((item) => item.kind === "tracking_broken").length, 1, "the same defect is not listed twice");

  const uncovered = attentionReport({
    sources: sources({
      overview: record({
        totals: { spend: 1 },
        series: [],
        attention: [{ id: "att_9", kind: "budget_pacing", severity: "warning", title: "Leads — Q3 push 4", detail: "Spend pace is ahead of the window.", entityId: "cmp_004" }],
      }),
      entities: { ...emptyEntities(), campaign: envelope([campaign({ id: "cmp_004", internalId: "cmp_004", name: "Leads — Q3 push 4" })]) },
    }),
  });
  const kept = uncovered.items.find((item) => item.title === "Leads — Q3 push 4");
  assert.ok(kept, "an entry this module does not compute is not dropped");
  assert.equal(kept.entity.id, "cmp_004", "it is resolved to the record by id");
});

test("a staged budget increase aimed at a row with no outcome is stoppable", () => {
  const report = attentionReport({
    sources: sources({
      entities: { ...emptyEntities(), campaign: envelope([campaign({ results: 0, qualifiedLeads: 0, siteConversions: 0, spend: 900 })]) },
    }),
    drafts: [
      {
        id: "draft_1",
        kind: "budget",
        origin: "live",
        title: "+25% budget across 1 campaign",
        changes: { kind: "budget", percent: 25, rows: [{ key: "cmp_001", name: "Leads — Always on 1", level: "campaign", state: "delivering", before: 200, after: 250 }] },
      },
    ],
  });
  const item = report.items.find((entry) => entry.kind === "budget_waste" && entry.id.startsWith("budget_waste:draft_1"));
  assert.ok(item, "a staged increase on a silent row is an attention item");
  assert.equal(item.action.kind, "open_draft");
  assert.equal(item.action.draftId, "draft_1");
  assert.ok(item.records.some((entry) => entry.kind === "draft" && entry.id === "draft_1"));
});

/* -------------------------------------------------------------- ranking --- */

test("below the floor a row is listed with its numbers, never ranked", () => {
  const lane = outcomeLane({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([
          campaign({ id: "cmp_001", internalId: "cmp_001", name: "Readable", spend: 100, results: 40, linkClicks: 800 }),
          campaign({ id: "cmp_002", internalId: "cmp_002", name: "Too quiet", spend: 100, results: 3, linkClicks: 800 }),
        ]),
      },
    }),
    level: "campaign",
    laneId: "provider_attributed",
  });
  assert.deepEqual(lane.ranked.map((entry) => entry.id), ["cmp_001"]);
  assert.deepEqual(lane.belowFloor.map((entry) => entry.id), ["cmp_002"]);
  assert.equal(lane.belowFloor[0].rank, null, "a row below the floor has no rank");
  assert.equal(lane.belowFloor[0].outcome, 3, "its numbers are still shown");
  assert.match(lane.belowFloor[0].evidence.reason, /of the 25/);
});

test("rows are ranked by outcome per unit of spend, never by volume", () => {
  const lane = outcomeLane({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([
          campaign({ id: "cmp_001", internalId: "cmp_001", name: "Big spender", spend: 1000, results: 100, linkClicks: 3000 }),
          campaign({ id: "cmp_002", internalId: "cmp_002", name: "Efficient", spend: 100, results: 40, linkClicks: 900 }),
        ]),
      },
    }),
    level: "campaign",
    laneId: "provider_attributed",
  });
  assert.deepEqual(lane.ranked.map((entry) => entry.id), ["cmp_002", "cmp_001"], "fewer results at a tenth of the spend ranks first");
  assert.equal(lane.ranked[0].perSpend, 0.4);
});

test("the two measurement kinds are ranked in separate lanes and never summed", () => {
  const rows = [campaign({ id: "cmp_001", internalId: "cmp_001", spend: 100, results: 40, qualifiedLeads: 0, siteConversions: 0 })];
  const provider = outcomeLane({ sources: sources({ entities: { ...emptyEntities(), campaign: envelope(rows) } }), level: "campaign", laneId: "provider_attributed" });
  const observed = outcomeLane({ sources: sources({ entities: { ...emptyEntities(), campaign: envelope(rows) } }), level: "campaign", laneId: "crm_observed" });
  assert.equal(provider.measurement, "provider_attributed");
  assert.equal(observed.measurement, "crm_observed");
  assert.equal(provider.ranked[0].outcome, 40);
  assert.equal(observed.ranked.length, 0, "no qualified leads means the observed lane cannot rank it");
  assert.equal(observed.belowFloor[0].outcome, 0);
  assert.equal(outcomeText(observed.belowFloor[0]), "No observed outcome yet", "a reported zero is not rendered as 0");
  assert.equal(outcomeText(provider.belowFloor[0] || provider.ranked[0]), "40");
  // A lane entry never carries a combined number.
  for (const entry of [...provider.ranked, ...observed.belowFloor]) {
    assert.equal("outcomes" in entry, false);
    assert.equal("total" in entry, false);
  }
});

test("a missing spend is not a zero spend", () => {
  const lane = outcomeLane({
    sources: sources({ entities: { ...emptyEntities(), campaign: envelope([campaign({ spend: null, results: 40, linkClicks: 900 })]) } }),
    level: "campaign",
    laneId: "provider_attributed",
  });
  const entry = lane.unmeasured[0];
  assert.equal(entry.spend, null);
  assert.equal(entry.rankable, false, "there is no spend to divide by");
  assert.equal(spendText(entry), "Not in this read");
  const zero = laneEntry({ id: "cmp_009", name: "No spend", spend: 0, results: 40, linkClicks: 900 }, RANK_LANES.provider_attributed);
  assert.equal(spendText(zero), "No spend recorded in this window");
});

test("a leader is named only when the intervals separate", () => {
  const overlapping = outcomeLane({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([
          campaign({ id: "cmp_001", internalId: "cmp_001", name: "A", spend: 300, results: 30, linkClicks: 1000 }),
          campaign({ id: "cmp_002", internalId: "cmp_002", name: "B", spend: 300, results: 26, linkClicks: 1000 }),
        ]),
      },
    }),
    level: "campaign",
    laneId: "provider_attributed",
  });
  assert.equal(overlapping.leader, null);
  assert.match(overlapping.leaderReason, /interval/i);

  const separated = outcomeLane({
    sources: sources({
      entities: {
        ...emptyEntities(),
        campaign: envelope([
          campaign({ id: "cmp_001", internalId: "cmp_001", name: "A", spend: 300, results: 100, linkClicks: 1000 }),
          campaign({ id: "cmp_002", internalId: "cmp_002", name: "B", spend: 300, results: 40, linkClicks: 1000 }),
        ]),
      },
    }),
    level: "campaign",
    laneId: "provider_attributed",
  });
  assert.equal(separated.leader.id, "cmp_001");
  assert.equal(separated.leader.rank, 1);
  assert.equal(compareLaneEntries(separated.ranked[0], separated.ranked[1], RANK_LANES.provider_attributed).verdict, "a");
});

test("the evidence floor is applied to the metric being ranked, not to results by habit", () => {
  const row = { spend: 200, linkClicks: 900, results: 3, qualifiedLeads: 40 };
  const observed = rankedEvidence(row, RANK_LANES.crm_observed, 20000);
  assert.equal(observed.level, "comparable", "40 qualified leads clears the floor");
  assert.match(observed.reason, /qualified leads/);
  assert.doesNotMatch(observed.reason, /3 of the/);

  const provider = rankedEvidence(row, RANK_LANES.provider_attributed, 20000);
  assert.equal(provider.level, "insufficient");
  assert.match(provider.reason, /3 of the 25 results/);
});

/* ------------------------------------------------------- recommendations --- */

const creatureSources = (creatives, over = {}) =>
  sources({ creatives: envelope(creatives), ...over });

test("a proven winner needs separated intervals before it is called a winner", () => {
  const winner = strongCreative({ id: "cr_0001", internalId: "cr_0001", results: 120, linkClicks: 1200, spend: 200 });
  const rest = [winner, quietCreative({ id: "cr_0002", internalId: "cr_0002", results: 4, linkClicks: 900, spend: 150 })];
  const report = testRecommendations({ sources: creatureSources(rest) });
  const scale = report.items.find((item) => item.kind === "scale_winner");
  assert.ok(scale, "a separated, comparable winner is a scale candidate");
  assert.equal(scale.entity.id, "cr_0001");
  assert.ok(scale.whatWouldChange.length >= 1, "a recommendation states what would change the conclusion");
  assert.deepEqual(scale.action.launchSeed.creativeIds, ["cr_0001"], "the launch seed names the creative by its own id");

  const noisy = testRecommendations({
    sources: creatureSources([
      strongCreative({ id: "cr_0001", internalId: "cr_0001", results: 30, linkClicks: 1000, spend: 200 }),
      strongCreative({ id: "cr_0002", internalId: "cr_0002", results: 26, linkClicks: 1000, spend: 200 }),
    ]),
  });
  assert.equal(noisy.items.find((item) => item.kind === "scale_winner"), undefined, "overlapping intervals are not a winner");
});

test("a creative below the floor keeps running rather than being judged", () => {
  const report = testRecommendations({
    sources: creatureSources([quietCreative({ results: 6, linkClicks: 60, spend: 90 })]),
  });
  const item = report.items.find((entry) => entry.kind === "keep_running");
  assert.ok(item);
  assert.match(item.label, /keep running/i);
  assert.ok(
    item.evidence.some((row) => row.label === "Results the floor needs" && row.value === EVIDENCE_FLOOR.results),
    "the floor is shown so the reader can disagree with it",
  );
  assert.equal(item.verdict, undefined, "no verdict is attached to an unjudged creative");
  assert.ok(item.whatWouldChange.some((line) => line.includes(String(EVIDENCE_FLOOR.results))));
});

test("a strong rate with too few results asks for volume, not a verdict", () => {
  const report = testRecommendations({
    sources: creatureSources([
      quietCreative({ id: "cr_0001", internalId: "cr_0001", results: 12, linkClicks: 150, spend: 60, impressions: 3000 }),
      quietCreative({ id: "cr_0002", internalId: "cr_0002", results: 1, linkClicks: 300, spend: 60, impressions: 30000 }),
    ]),
  });
  const item = report.items.find((entry) => entry.kind === "needs_volume");
  assert.ok(item, "a rate above the pooled rate is a volume case");
  assert.equal(item.entity.id, "cr_0001");
  assert.ok(item.evidence.some((row) => row.label === "Against the pooled click rate" && row.value === "Higher"));
});

test("two near-duplicates are one idea, and a winner is only named when separated", () => {
  const pair = [
    strongCreative({ id: "cr_0010", internalId: "cr_0010", concept: "Same-day quote", hook: "Statistic", format: "Single image", results: 40, linkClicks: 900 }),
    strongCreative({ id: "cr_0011", internalId: "cr_0011", concept: "Same-day quote", hook: "Statistic", format: "Single image", results: 39, linkClicks: 900 }),
  ];
  assert.equal(duplicatePairs(pair).length, 1);
  const report = testRecommendations({ sources: creatureSources(pair) });
  const item = report.items.find((entry) => entry.kind === "consolidate_duplicates");
  assert.ok(item);
  assert.deepEqual(item.records.map((entry) => entry.id).sort(), ["cr_0010", "cr_0011"], "both identities are carried");
  assert.equal(item.action.kind, "open_record", "nothing is paused while the intervals overlap");
  assert.match(item.detail, /does not separate them/i);

  const marked = testRecommendations({
    sources: creatureSources([strongCreative({ id: "cr_0020", internalId: "cr_0020", nearDuplicateOf: "cr_0021" }), strongCreative({ id: "cr_0021", internalId: "cr_0021" })]),
  });
  assert.ok(marked.items.find((item) => item.kind === "consolidate_duplicates"), "an explicit marker is a signal too");
});

test("a creative whose tracking is broken is not judged on outcomes at all", () => {
  const report = testRecommendations({
    sources: sources({
      creatives: envelope([strongCreative({ id: "cr_0030", internalId: "cr_0030" })]),
      entities: { ...emptyEntities(), ad: envelope([{ id: "cmp_001_set_1_ad_1", internalId: "cmp_001_set_1_ad_1", level: "ad", name: "Ad one", creativeId: "cr_0030", state: "delivering", spend: 120, results: 40, linkClicks: 900, destination: "https://example.invalid/x?utm_source=a&utm_source=b" }]) },
      tracking: record({
        templates: [],
        validation: [{ id: "val_1", severity: "error", kind: "duplicate_parameter", adId: "cmp_001_set_1_ad_1", detail: "utm_source appears twice.", url: "https://example.invalid/x?utm_source=a&utm_source=b" }],
        history: [],
      }),
    }),
  });
  assert.ok(report.items.find((item) => item.kind === "fix_tracking_first"));
  assert.equal(report.items.find((item) => item.id.startsWith("scale_winner")), undefined, "an untrustworthy number is not a scale case");
});

test("recommendations stop when the rows they need did not answer", () => {
  const report = testRecommendations({ sources: sources({ creatives: envelope([], { status: "not_connected" }) }) });
  assert.equal(report.items.length, 0);
  assert.equal(report.complete, false);
  assert.deepEqual(report.coverage.missing, ["creatives"]);
});

/* ----------------------------------------------------------------- joins --- */

test("an article is ranked on observed leads per unit of spend", () => {
  const lane = destinationLane({
    sources: sources({
      blogs: envelope([
        { id: "post_001", internalId: "post_001", name: "What a survey covers", promoted: true, totals: { spend: 200, siteSessions: 900, siteConversions: 12, qualifiedLeads: 40 } },
        { id: "post_002", internalId: "post_002", name: "Cost of a same-day callout", promoted: true, totals: { spend: 400, siteSessions: 800, siteConversions: 4, qualifiedLeads: 3 } },
        { id: "post_003", internalId: "post_003", name: "Never advertised", promoted: false, totals: { spend: 0, siteSessions: 5000, siteConversions: 2, qualifiedLeads: 1 } },
      ]),
    }),
  });
  assert.equal(lane.measurement, DESTINATION_LANE.measurement);
  assert.equal(lane.metric, "qualifiedLeads");
  assert.deepEqual(lane.ranked.map((entry) => entry.id), ["post_001"]);
  assert.equal(lane.ranked[0].costPerOutcome, 5);
  assert.deepEqual(lane.belowFloor.map((entry) => entry.id), ["post_002"]);
  assert.match(lane.belowFloor[0].evidence.reason, /3 of the 25 qualified leads/);
  assert.equal(lane.unpromotedCount, 1, "an article no ad promoted is counted, not ranked");
  assert.equal(lane.leader.id, "post_001");
});

test("a lane with no denominator says so instead of inventing a rate", () => {
  const lane = destinationLane({
    sources: sources({
      blogs: envelope([{ id: "post_001", internalId: "post_001", name: "Sessions missing", promoted: true, totals: { spend: 200, qualifiedLeads: 40 } }]),
    }),
  });
  assert.equal(lane.belowFloor[0].evidence.level, "insufficient");
  assert.match(lane.belowFloor[0].evidence.reason, /No denominator in this read/);
});

test("a campaign finds its ads through the ad set's parent, not through a name", () => {
  const adsets = [
    { id: "cmp_001_set_1", internalId: "cmp_001_set_1", level: "adset", name: "Broad", parentId: "cmp_001" },
    { id: "cmp_002_set_1", internalId: "cmp_002_set_1", level: "adset", name: "Broad", parentId: "cmp_002" },
  ];
  const ads = [
    { id: "ad_1", internalId: "ad_1", level: "ad", name: "Shared headline", parentId: "cmp_001_set_1", spend: 10, results: 1 },
    { id: "ad_2", internalId: "ad_2", level: "ad", name: "Shared headline", parentId: "cmp_002_set_1", spend: 20, results: 2 },
  ];
  assert.deepEqual(adsForCampaign("cmp_001", adsets, ads).map((ad) => ad.internalId), ["ad_1"]);

  // Renaming the campaign changes nothing: the join never reads a label.
  const renamed = adsets.map((adset) => (adset.parentId === "cmp_001" ? { ...adset, name: "Something else" } : adset));
  assert.deepEqual(adsForCampaign("cmp_001", renamed, ads).map((ad) => ad.internalId), ["ad_1"]);
  assert.deepEqual(adsForCreative("cr_1", [{ internalId: "ad_9", creativeId: "cr_1" }, { internalId: "ad_8", creativeId: "cr_2" }]).map((ad) => ad.internalId), ["ad_9"]);
});

test("an article finds the ads promoting it through the creative ids it names", () => {
  const creatives = [
    { id: "cr_1", internalId: "cr_1", name: "One" },
    { id: "cr_9", internalId: "cr_9", name: "The same name as an unrelated creative" },
  ];
  const ads = [
    { id: "ad_1", internalId: "ad_1", creativeId: "cr_1" },
    { id: "ad_2", internalId: "ad_2", creativeId: "cr_2" },
  ];
  const article = { id: "post_1", internalId: "post_1", name: "What a survey covers", creativeIds: ["cr_1"] };
  assert.deepEqual(adsForArticle(article, ads, creatives).map((ad) => ad.internalId), ["ad_1"], "a name is never the join");
  assert.deepEqual(adsForArticle({ creativeIds: [] }, ads, creatives), []);
});

test("a creative's rendition is content-addressed and stable across renders", () => {
  const creative = { id: "cr_1", internalId: "cr_1", format: "Single image", preview: { ratio: "4:5" } };
  const first = renditionOf(creative);
  const again = renditionOf({ ...creative, name: "Renamed" });
  assert.equal(first.digest, again.digest, "renaming is not a new rendition");
  assert.notEqual(first.digest, renditionOf({ ...creative, format: "Short video" }).digest, "a different format is");
  assert.equal(renditionOf(null), null);
});

/* ------------------------------------------------------------- the rest --- */

test("a window that is still settling says so", () => {
  const now = Date.parse("2026-09-14T09:00:00Z");
  const note = settlementNote({ params: { to: "2026-09-14" }, now });
  assert.ok(note);
  assert.equal(note.days, 0);
  assert.match(note.message, /still settling/);

  assert.equal(settlementNote({ params: { to: "2026-08-01" }, now }), null);
  assert.equal(settlementNote({ params: {}, now }), null, "an unknown window invents nothing");
});

test("a decision set carries every measurement's own evidence and nothing merged", () => {
  const decisions = buildDecisions({
    sources: sources({
      entities: { ...emptyEntities(), campaign: envelope([campaign({ results: 0, qualifiedLeads: 0, siteConversions: 0, spend: 900 })]) },
    }),
    level: "campaign",
    params: { to: "2026-09-14" },
    now: Date.parse("2026-09-14T09:00:00Z"),
  });
  assert.equal(decisions.outcomes.lanes.length, 2);
  assert.equal(decisions.coverage.complete, true);
  assert.ok(Array.isArray(decisions.attention.items));
  assert.ok(decisions.recommendations.items.length >= 0);
  const item = decisions.attention.items.find((entry) => entry.kind === "spend_no_outcome");
  assert.ok(item, "spend with every counter answering zero is an item");
  // Each measurement keeps its own evidence row: the item shows them side by
  // side and never adds them into one number.
  assert.equal(item.evidence.some((row) => row.label === "CRM-qualified leads" && row.value === 0), true);
  assert.equal(item.evidence.some((row) => row.label === "Website-observed conversions" && row.value === 0), true);
  assert.equal(item.evidence.filter((row) => /results|leads|conversions/i.test(row.label)).length, 3);
  for (const evidence of item.evidence) {
    assert.ok(evidenceRow(evidence.label, evidence.value).kind, "every evidence row has a render kind");
  }
  assert.ok(Object.keys(RECOMMENDATION_KINDS).length >= 5);
});
