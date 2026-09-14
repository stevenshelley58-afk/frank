// Ads workspace contract.
//
// Every test here exists because the behaviour it asserts was wrong in the
// reviewed build, and the wrongness was expensive in a specific way: a bulk
// action that touched rows nobody could see, a variation count that did not
// match the rows it staged, a second mapping edit that silently undid the
// first, a tracking identity that changed when a campaign was renamed, two
// variations sharing one identity, and a throttled refresh that erased the last
// good answer.
//
// These are rule-level tests and run without a browser. The interactive
// journeys live in acceptance/ads_journey.py, which drives the same modules in
// a real Chromium.
import test from "node:test";
import assert from "node:assert/strict";

import { createSelection } from "../web/js/ads/ads-table.js";
import { planAds, planAdRows, axisValues, buildTrackingUrl, resolveTrackingValue, validateTrackingUrls } from "../web/js/ads/ads-publish.js";
import { createAdsDrafts, normalizeDraft, draftAdCount, mergeMapping, newAdsId } from "../web/js/ads/ads-drafts.js";
import { createAdsReader, createAdsCache } from "../web/js/ads/ads-source.js";
import { evidenceFor } from "../web/js/ads/ads-contracts.js";

const creatives = (n) =>
  Array.from({ length: n }, (unused, index) => ({
    id: `cr_${String(index + 1).padStart(3, "0")}`,
    internalId: `cr_int_${index + 1}`,
    name: `Creative ${index + 1}`,
    format: "Feed",
    preview: { hasImage: true, hasVideo: false, ratio: "4:5" },
  }));

const trackingFields = () => [
  { key: "utm_source", value: "meta", required: true },
  { key: "utm_medium", value: "paid_social", required: true },
  { key: "utm_campaign", value: "{{campaign.internal_id}}", required: true },
  { key: "utm_content", value: "{{creative.internal_id}}", required: true },
];

/* ------------------------------------------------- bulk-action selection --- */

test("select this page selects exactly the rows on the page", () => {
  const rows = creatives(120).map((c) => ({ id: c.id, name: c.name }));
  const selection = createSelection({ getKey: (row) => String(row.id) });
  selection.setMatching(rows);
  selection.setPage(rows.slice(0, 50));
  selection.selectPage(true);
  assert.equal(selection.size(), 50, "50 visible rows must select 50 rows");
  assert.equal(selection.hiddenKeys().length, 0);
  assert.equal(selection.isAllPageSelected(), true);
  assert.equal(selection.isAllMatchingSelected(), false);
});

test("selecting every matching row is a separate action that states a different count", () => {
  const rows = creatives(120).map((c) => ({ id: c.id, name: c.name }));
  const selection = createSelection({ getKey: (row) => String(row.id) });
  selection.setMatching(rows);
  selection.setPage(rows.slice(0, 50));
  selection.selectPage(true);
  assert.equal(selection.size(), 50);
  selection.selectMatching();
  assert.equal(selection.size(), 120);
  assert.equal(selection.isAllMatchingSelected(), true);
  assert.equal(selection.matchingSize(), 120);
  assert.equal(selection.pageSize(), 50);
  assert.equal(selection.hiddenKeys().length, 70, "the 70 rows off this page are reported, not hidden");
});

test("a shift range cannot sweep in a row that is not on the page", () => {
  const rows = creatives(10).map((c) => ({ id: c.id }));
  const selection = createSelection({ getKey: (row) => String(row.id) });
  selection.setMatching(rows);
  selection.setPage(rows.slice(0, 3));
  selection.toggle("cr_001");
  selection.toggle("cr_003", { shift: true });
  assert.deepEqual(selection.keys().sort(), ["cr_001", "cr_002", "cr_003"]);
});

test("a row the filters exclude cannot stay selected into a bulk action", () => {
  const rows = creatives(4).map((c) => ({ id: c.id }));
  const selection = createSelection({ getKey: (row) => String(row.id) });
  selection.setMatching(rows);
  selection.setPage(rows);
  selection.selectMatching();
  const kept = rows.slice(0, 2);
  selection.retain(kept.map((row) => String(row.id)));
  assert.equal(selection.size(), 2);
});

/* --------------------------------------------------- combination counting --- */

test("the advertised ad count is the number of rows that would be staged", () => {
  const cases = [
    { creatives: creatives(20), headlines: ["a", "b", "c", "d", "e"], bodies: [""], mode: "per_creative" },
    { creatives: creatives(20), headlines: ["a", "b", "c", "d", "e"], bodies: ["x"], mode: "cross_product" },
    { creatives: creatives(3), headlines: [], bodies: [], mode: "cross_product" },
    { creatives: creatives(3), headlines: ["  ", ""], bodies: [""], mode: "cross_product" },
    { creatives: creatives(2), headlines: ["one"], bodies: ["a", "b"], mode: "cross_product" },
    { creatives: [], headlines: ["a"], bodies: ["b"], mode: "cross_product" },
  ];
  for (const options of cases) {
    const plan = planAds(options);
    const rows = planAdRows(options);
    assert.equal(plan.total, rows.length, `${options.mode} ${options.creatives.length}x${options.headlines.length}x${options.bodies.length}`);
    assert.equal(plan.rows.length, rows.length);
  }
});

test("20 creatives and 5 headlines stay 20 ads unless the axes are explicitly multiplied", () => {
  const chosen = creatives(20);
  const perCreative = planAds({ creatives: chosen, headlines: ["a", "b", "c", "d", "e"], bodies: [""], mode: "per_creative" });
  assert.equal(perCreative.total, 20);
  assert.equal(perCreative.multiplies, false);
  const cross = planAds({ creatives: chosen, headlines: ["a", "b", "c", "d", "e"], bodies: ["x"], mode: "cross_product" });
  assert.equal(cross.total, 100);
  assert.equal(cross.equation, "20 × 5 × 1");
  assert.equal(cross.multiplies, true);
});

test("blank optional copy is one implied row, not zero rows and not an invented variation", () => {
  // The advertised count used to say "3 × 1 × 1" while the staging loop walked
  // zero bodies and created nothing.
  const plan = planAds({ creatives: creatives(3), headlines: ["hello"], bodies: ["", "   "], mode: "cross_product" });
  assert.equal(plan.total, 3);
  assert.equal(plan.rows.length, 3);
  assert.equal(plan.equation, "3 × 1 × 1");
  assert.ok(plan.note.includes("primary text"), plan.note);

  // A whitespace-only headline is not a variation either.
  assert.deepEqual(axisValues(["a", "   ", ""]), ["a"]);
  assert.deepEqual(axisValues([]), [""]);
  const whitespace = planAds({ creatives: creatives(4), headlines: ["a", "  "], bodies: ["b"], mode: "cross_product" });
  assert.equal(whitespace.total, 4);
});

/* ------------------------------------------------------ mapping integrity --- */

test("destination, headline and utm_content edits never overwrite each other", () => {
  let mapping = {};
  mapping = mergeMapping(mapping, "cr_1", { destination: "https://example.invalid/one" });
  mapping = mergeMapping(mapping, "cr_1", { utmContent: "cr_int_1" });
  mapping = mergeMapping(mapping, "cr_1", { headlineIndex: 2 });
  mapping = mergeMapping(mapping, "cr_1", { destination: "https://example.invalid/two" });
  assert.deepEqual(mapping.cr_1, {
    destination: "https://example.invalid/two",
    utmContent: "cr_int_1",
    headlineIndex: 2,
  });
  assert.deepEqual(mapping.cr_1_different === undefined, true);
});

/* -------------------------------------------------------------- tracking --- */

test("a tracking URL keeps the destination's own parameters and its anchor", () => {
  const row = planAdRows({ creatives: creatives(1), mode: "per_creative" })[0];
  const withAnchor = buildTrackingUrl({
    base: "https://example.invalid/guides/survey?ref=newsletter#tips",
    fields: trackingFields(),
    row,
    campaignId: "cmp_stable",
  });
  const url = new URL(withAnchor);
  assert.equal(url.searchParams.get("ref"), "newsletter");
  assert.equal(url.hash, "#tips");
  assert.equal(url.searchParams.get("utm_source"), "meta");
  assert.equal(withAnchor.indexOf("utm_source") < withAnchor.indexOf("#tips"), true, "tracking must be inside the query, not the fragment");

  const noQuery = buildTrackingUrl({ base: "https://example.invalid/page#top", fields: trackingFields(), row, campaignId: "cmp_stable" });
  assert.equal(noQuery.includes("?utm_source"), true);

  const trailingQuestion = buildTrackingUrl({ base: "https://example.invalid/page?", fields: trackingFields(), row, campaignId: "cmp_stable" });
  assert.equal(trailingQuestion.includes("?&"), false, "an empty parameter list must not produce `?&`");
});

test("a parameter the destination already sets is replaced, never duplicated", () => {
  const row = planAdRows({ creatives: creatives(1), mode: "per_creative" })[0];
  const built = buildTrackingUrl({
    base: "https://example.invalid/page?utm_source=facebook#tips",
    fields: trackingFields(),
    row,
    campaignId: "cmp_stable",
  });
  assert.equal(new URL(built).searchParams.getAll("utm_source").length, 1, built);
  assert.equal(new URL(built).searchParams.get("utm_source"), "meta");
});

test("empty values are omitted and an unparseable destination fails loudly", () => {
  const row = planAdRows({ creatives: creatives(1), mode: "per_creative" })[0];
  const fields = [...trackingFields(), { key: "utm_term", value: "   ", required: false }];
  const built = buildTrackingUrl({ base: "https://example.invalid/page", fields, row, campaignId: "cmp_stable" });
  assert.equal(new URL(built).searchParams.has("utm_term"), false);
  assert.equal(buildTrackingUrl({ base: "not a url", fields, row, campaignId: "cmp_stable" }), "");
});

test("a rename cannot change a tracking identity, and variations do not share one", () => {
  const chosen = creatives(2);
  // The identities live in the plan, not in the pre-identity row builder: a row
  // only becomes an ad once `reconcilePlanRows` has given it an identity, and
  // that identity is what tracking resolves to.
  const plan = planAds({ creatives: chosen, headlines: ["one", "two"], bodies: ["body"], mode: "cross_product" });
  const rows = plan.rows;
  assert.equal(rows.length, 4);
  const identities = rows.map((row) => resolveTrackingValue("{{creative.internal_id}}", { row, campaignId: "cmp_stable" }));
  assert.equal(new Set(identities).size, 4, `variations share an identity: ${identities.join(", ")}`);
  for (const row of rows) assert.equal(resolveTrackingValue("{{ad.internal_id}}", { row }), row.adId);
  // The readable label is available, and it is deliberately not the identity:
  // both variations of one creative share it.
  assert.equal(resolveTrackingValue("{{ad.label}}", { row: rows[0] }), "cr_int_1");
  assert.equal(resolveTrackingValue("{{ad.label}}", { row: rows[1] }), "cr_int_1");
  assert.notEqual(resolveTrackingValue("{{ad.internal_id}}", { row: rows[0] }), resolveTrackingValue("{{ad.internal_id}}", { row: rows[1] }));

  const before = buildTrackingUrl({ base: "https://example.invalid/x", fields: trackingFields(), row: rows[0], campaignId: "cmp_stable", campaignName: "Spring" });
  const after = buildTrackingUrl({ base: "https://example.invalid/x", fields: trackingFields(), row: rows[0], campaignId: "cmp_stable", campaignName: "Spring leads 2026" });
  assert.equal(before, after, "renaming the campaign changed the tracking URL");
  assert.equal(new URL(before).searchParams.get("utm_campaign"), "cmp_stable");
});

test("validation reads the URL that would actually ship", () => {
  const rows = planAdRows({ creatives: creatives(1), mode: "per_creative", mapping: { cr_001: { destination: "https://example.invalid/checklist" } } });
  const withDestination = rows.map((row) => ({ ...row, destination: "https://example.invalid/checklist" }));
  const pii = validateTrackingUrls({
    rows: withDestination,
    fields: [{ key: "utm_content", value: "lead@example.invalid", required: false }],
    campaignId: "cmp_stable",
  });
  assert.equal(pii.some((p) => p.kind === "pii" && p.severity === "error"), true);

  const encoded = validateTrackingUrls({
    rows: withDestination,
    fields: [{ key: "utm_content", value: "lead%40example.invalid", required: false }],
    campaignId: "cmp_stable",
  });
  assert.equal(encoded.some((p) => p.kind === "pii"), true, "a percent-encoded address is still personal information");

  const broken = validateTrackingUrls({ rows: [{ ...withDestination[0], destination: "not a url" }], fields: [], campaignId: "cmp" });
  assert.equal(broken.some((p) => p.kind === "invalid_url" && p.severity === "error"), true);

  // Two ads that resolve to one identity are a reporting collision, so the
  // check needs two rows: build them and force the collision.
  const twoRows = planAdRows({ creatives: creatives(2), mode: "per_creative" }).map((row) => ({
    ...row,
    destination: "https://example.invalid/checklist",
    trackingKey: "same",
  }));
  const duplicated = validateTrackingUrls({
    rows: twoRows,
    fields: [{ key: "utm_content", value: "{{creative.internal_id}}", required: false }],
    campaignId: "cmp",
  });
  assert.equal(duplicated.some((p) => p.kind === "duplicate_tracking"), true);
});

/* ---------------------------------------------------------- draft model --- */

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("a staged draft survives a reload with its creatives, mappings and exact ad count", () => {
  const storage = memoryStorage();
  const first = createAdsDrafts({ storage, origin: "live" });
  const chosen = creatives(3);
  const options = { creatives: chosen, headlines: ["headline one", "headline two"], bodies: [""], mode: "cross_product", mapping: { cr_001: { utmContent: "custom_1", destination: "https://example.invalid/one" } } };
  const plan = planAds(options);
  const draft = first.save({
    kind: "launch",
    approval: "staged",
    state: "queued",
    title: "Spring launch",
    campaign: { campaignId: "cmp_fixed", name: "Spring", budget: 25, placements: ["feed"] },
    creatives: chosen.map((creative, index) => ({
      id: creative.id,
      internalId: creative.internalId,
      name: creative.name,
      mappings: options.mapping[creative.id] || {},
    })),
    headlines: options.headlines,
    bodies: options.bodies,
    mode: options.mode,
    tracking: { templateId: "tpl_standard", fields: trackingFields() },
    plan: { mode: plan.mode, total: plan.total, equation: plan.equation, rows: plan.rows },
    validation: { ok: true, errors: 0, warnings: 0, problems: [] },
  });
  assert.equal(draftAdCount(draft), plan.total);
  assert.equal(draft.plan.rows.length, plan.total);

  // A second store over the same storage is what a page reload looks like.
  const second = createAdsDrafts({ storage, origin: "live" });
  const reopened = second.get(draft.id);
  assert.ok(reopened, "the staged draft was lost across a reload");
  assert.equal(reopened.approval, "staged");
  assert.equal(reopened.state, "queued");
  assert.equal(reopened.plan.total, plan.total);
  assert.equal(reopened.plan.rows.length, plan.total, "the stored rows must match the stored count");
  assert.equal(reopened.creatives.length, 3);
  assert.deepEqual(reopened.creatives[0].mappings, { utmContent: "custom_1", destination: "https://example.invalid/one" });
  assert.equal(reopened.campaign.campaignId, "cmp_fixed");
  assert.equal(second.staged().length, 1);
});

test("preview drafts never surface in a live queue, and staging is a local fact", () => {
  const storage = memoryStorage();
  let preview = true;
  const drafts = createAdsDrafts({ storage, origin: () => (preview ? "preview" : "live") });
  const previewDraft = drafts.save({ kind: "launch", title: "Rehearsal", plan: { total: 4, rows: [] } });
  assert.equal(drafts.list().length, 1);
  preview = false;
  assert.equal(drafts.list().length, 0, "a rehearsal draft leaked into the live queue");
  const liveDraft = drafts.save({ kind: "launch", title: "Real", plan: { total: 2, rows: [] } });
  assert.equal(drafts.list().length, 1);
  assert.equal(drafts.get(previewDraft.id), null);
  assert.equal(drafts.staged().length, 0, "a draft is not staged until it is staged");
  drafts.stage(liveDraft.id);
  assert.equal(drafts.get(liveDraft.id).approval, "staged");
  assert.equal(drafts.get(liveDraft.id).state, "queued");
  assert.equal(drafts.get(liveDraft.id).submission, null, "staging must never claim a submission");
  drafts.unstage(liveDraft.id);
  assert.equal(drafts.get(liveDraft.id).approval, "editing");
});

test("a budget or pause draft keeps every affected row with its before and after value", () => {
  const drafts = createAdsDrafts({ storage: memoryStorage(), origin: "live" });
  const saved = drafts.save({
    kind: "budget",
    approval: "staged",
    title: "+10% budget across 2 ads",
    campaign: { currency: "GBP" },
    changes: {
      kind: "budget",
      percent: 10,
      rows: [
        { key: "ad_1", name: "Ad one", level: "ad", state: "delivering", before: 10, after: 11 },
        { key: "ad_2", name: "Ad two", level: "ad", state: "paused", before: 20, after: 22 },
      ],
    },
  });
  assert.equal(saved.changes.rows.length, 2);
  assert.equal(draftAdCount(saved), 2);
  assert.deepEqual(saved.changes.rows.map((row) => [row.before, row.after]), [[10, 11], [20, 22]]);
  const reopened = createAdsDrafts({ storage: memoryStorage(), origin: "live" });
  assert.equal(reopened.list().length, 0, "a different storage must not invent drafts");
});

test("a malformed stored record is normalised instead of trusted", () => {
  const normalized = normalizeDraft({ id: "d1", kind: "nonsense", approval: "maybe", plan: { total: "7" }, creatives: [{ id: "cr_1" }] });
  assert.equal(normalized.kind, "launch");
  assert.equal(normalized.approval, "editing");
  assert.equal(normalized.state, "draft");
  assert.equal(normalized.plan.total, 7);
  assert.equal(normalized.creatives[0].mappings.destination, undefined);
  const ids = new Set([normalized.id, newAdsId("cmp"), newAdsId("cmp"), newAdsId("cmp")]);
  assert.equal(ids.size, 4, "generated identities must be unique");
});

/* --------------------------------------------------- reporting retention --- */

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload;
    },
  };
}

test("one screen giving up does not fail a read another screen has joined", async () => {
  // The first paint renders a screen, then the context read lands and the screen
  // is replaced. The replacement used to join the first screen's request and
  // then be handed "superseded" when the first screen was disposed — an error it
  // could never recover from, on about one cold load in ten.
  let calls = 0;
  let abortedEarly = false;
  const slow = (url, options = {}) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve(response(200, { rows: [{ id: "cmp_1", name: "Kept" }], meta: { status: "ready" } }));
      }, 30);
      options.signal?.addEventListener("abort", () => {
        if (settled) return;
        abortedEarly = true;
        clearTimeout(timer);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const reader = createAdsReader({ fetchImpl: slow, cache: createAdsCache() });
  const first = new AbortController();
  const second = new AbortController();
  const abandoned = reader.read("entities", { level: "campaign" }, { signal: first.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const joined = reader.read("entities", { level: "campaign" }, { signal: second.signal });
  first.abort();
  const result = await joined;
  assert.equal(result.status, "ready", `the joiner was handed ${result.status}: ${result.detail}`);
  assert.equal(result.data.rows[0].name, "Kept");
  assert.equal(calls, 1, "both screens shared one request");
  await abandoned;
  assert.equal(abortedEarly, false, "the shared request was not cancelled while a caller still wanted it");
});

test("a read nobody is waiting for any more is cancelled", async () => {
  let aborted = false;
  const hanging = (url, options = {}) =>
    new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        aborted = true;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const reader = createAdsReader({ fetchImpl: hanging, cache: createAdsCache() });
  const only = new AbortController();
  const pending = reader.read("entities", { level: "ad" }, { signal: only.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  only.abort();
  const result = await pending;
  assert.equal(aborted, true, "the last caller letting go stops the request");
  assert.equal(result.status, "error");
});

test("a throttled re-read keeps the last good rows and their observation time", async () => {
  const observedAt = "2026-09-14T07:00:00.000Z";
  let mode = "ready";
  const fetchImpl = async () =>
    mode === "ready"
      ? response(200, { rows: [{ id: "c1" }, { id: "c2" }], meta: { status: "ready", syncedAt: observedAt } })
      : response(429, {});
  const reader = createAdsReader({ fetchImpl, cache: createAdsCache({ ttlMs: 0 }) });

  const first = await reader.read("entities", { level: "campaign" });
  assert.equal(first.status, "ready");
  assert.equal(first.data.rows.length, 2);

  mode = "throttled";
  const second = await reader.read("entities", { level: "campaign" }, { force: true });
  // The rows are stale and the read failed: the envelope states both, because
  // one status cannot honestly describe two different facts.
  assert.equal(second.status, "stale");
  assert.equal(second.failedStatus, "throttled", "the failure must be named, not swallowed");
  assert.equal(second.data?.rows?.length, 2, "the last good rows must stay on screen");
  assert.equal(second.cached, true);
  assert.equal(second.fetchedAt, Date.parse(observedAt), "the rows must keep their real observation time");
  assert.equal(/queue/i.test(second.detail || ""), false, `a detail may not promise a queue this build does not have: ${second.detail}`);
});

test("a network failure on a forced re-read also keeps the last good rows", async () => {
  let mode = "ready";
  const fetchImpl = async () => {
    if (mode === "ready") return response(200, { rows: [{ id: "c1" }], meta: { status: "ready", syncedAt: "2026-09-14T07:00:00.000Z" } });
    throw new Error("network down");
  };
  const reader = createAdsReader({ fetchImpl, cache: createAdsCache({ ttlMs: 0 }) });
  await reader.read("overview", {});
  mode = "down";
  const failed = await reader.read("overview", {}, { force: true });
  assert.equal(failed.status, "stale");
  assert.equal(failed.failedStatus, "error");
  assert.equal(failed.data?.rows?.length, 1, "a failed refresh blanked the screen");
});

/* ------------------------------------------------------------- evidence --- */

test("the evidence floor applies to the quantity being judged", () => {
  // Two qualified leads from real spend is not a comparable result, however many
  // provider-level results sit behind it.
  assert.equal(evidenceFor({ results: 2, linkClicks: 300, spend: 50 }).level, "insufficient");
  assert.equal(evidenceFor({ results: 40, linkClicks: 300, spend: 50 }).level, "comparable");
});
