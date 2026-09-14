// Identity rules for the Ads workspace.
//
// These tests exist because identity is the thing reporting history joins on,
// and every way of getting it wrong is quiet: an id derived from a name splits
// history on rename, an id derived from a row's position re-points a join when
// somebody reorders a table, and an id derived from truncated copy fuses two
// different ads into one. None of those throw. They just make the numbers lie.
//
// Rule-level, no browser. The browser journeys in acceptance/ads_journey.py
// drive the same rules through the real screens.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ID_KINDS,
  VERSION_POLICY,
  campaignKey,
  createCampaign,
  creativeFingerprint,
  identityKind,
  isIdentity,
  newIdentity,
  plannedAdFingerprint,
  planDigest,
  planSnapshot,
  reconcilePlanRows,
  renameCampaign,
  resolveVersion,
  shortIdentity,
  slotKey,
  sourceFingerprint,
  trackingIdentityFor,
  versionIdFor,
} from "../web/js/ads/ads-identity.js";

const plannedRow = (over = {}) => ({
  creativeKey: "crv_asset_a",
  creativeVersionId: "crv_asset_a",
  headline: "Book a free valuation",
  body: "Same week appointments",
  destination: "https://example.test/valuation",
  ...over,
});

/* ------------------------------------------------------------ allocation --- */

test("identities are unique, prefixed by kind, and never look like a timestamp", () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(newIdentity("ad"));
  assert.equal(ids.size, 500, "500 allocations must be 500 distinct identities");
  for (const id of ids) {
    assert.ok(id.startsWith("ad_"), `${id} carries its kind`);
    assert.ok(isIdentity(id), `${id} is a well-formed identity`);
    assert.equal(identityKind(id), "ad");
  }
  assert.equal(identityKind(newIdentity("campaign")), "cmp");
  assert.equal(identityKind(newIdentity("version")), "crvv");
  // An unknown kind becomes a literal prefix rather than silently becoming `ad`.
  assert.equal(identityKind(newIdentity("experiment")), "experiment");
  assert.equal(ID_KINDS.campaign, "cmp");
});

test("a dense display form never replaces the identity itself", () => {
  const id = newIdentity("ad");
  const shown = shortIdentity(id);
  assert.ok(shown.length < id.length, "the display form is shorter");
  assert.ok(shown.endsWith(id.slice(-6)), "it keeps the tail, so two ids stay distinguishable");
  assert.notEqual(shown, id, "and it is visibly not the stored value");
});

/* ------------------------------------------------- campaign identity --- */

test("renaming a campaign leaves its identity and its join key alone", () => {
  const campaign = createCampaign({ name: "Spring launch" });
  const renamed = renameCampaign(campaign, "Spring launch (Aug)");
  assert.equal(renamed.campaignId, campaign.campaignId);
  assert.equal(campaignKey(renamed), campaignKey(campaign));
  assert.notEqual(renamed.name, campaign.name);

  // A provider campaign joins on the provider's id, never on its name.
  const read = { providerId: "act_1/campaign/99", name: "Renamed in Ads Manager" };
  assert.equal(campaignKey(read), "act_1/campaign/99");
});

test("two campaigns with the same name still have different identities", () => {
  const a = createCampaign({ name: "Retargeting" });
  const b = createCampaign({ name: "Retargeting" });
  assert.notEqual(a.campaignId, b.campaignId);
});

/* ---------------------------------------------- creative version policy --- */

test("the version policy states what creates a version and what does not", () => {
  assert.ok(VERSION_POLICY.createsNewVersion.some((line) => /asset/i.test(line)));
  assert.ok(VERSION_POLICY.keepsSameVersion.some((line) => /classification/i.test(line)));
  assert.ok(VERSION_POLICY.keepsSameVersion.some((line) => /headline/i.test(line)));
  assert.equal(VERSION_POLICY.summary.length > 0, true);
});

test("the same asset resolves to the same version, and a new asset mints a new one", () => {
  const creative = { creativeId: "cr_0007", name: "Editorial kitchen" };
  const first = resolveVersion(creative, { assetKey: "asset-1", format: "Feed", ratio: "4:5" });
  assert.equal(first.created, true);

  const again = resolveVersion(first.creative, { assetKey: "asset-1", format: "Feed", ratio: "4:5" });
  assert.equal(again.created, false, "the same rendition is the same version");
  assert.equal(again.version.versionId, first.version.versionId);

  const regenerated = resolveVersion(again.creative, { assetKey: "asset-2", format: "Feed", ratio: "4:5" });
  assert.equal(regenerated.created, true, "a re-generated asset is a new version");
  assert.notEqual(regenerated.version.versionId, first.version.versionId);
  assert.equal(regenerated.creative.versions.length, 2, "the old version is kept, not overwritten");

  const recropped = resolveVersion(regenerated.creative, { assetKey: "asset-2", format: "Feed", ratio: "9:16" });
  assert.equal(recropped.created, true, "a different crop is a different rendition");

  const reformatted = resolveVersion(recropped.creative, { assetKey: "asset-2", format: "Short video", ratio: "9:16" });
  assert.equal(reformatted.created, true, "a different format is a different rendition");
});

test("renaming, reclassifying and reobserving do not create a version", () => {
  const creative = { creativeId: "cr_0008", name: "Concept A" };
  const first = resolveVersion(creative, { assetKey: "asset-9", format: "Feed", ratio: "1:1" });
  const renamed = { ...first.creative, name: "Concept A (corrected)" };
  const reclassified = {
    ...renamed,
    tags: [{ field: "hook", value: "Corrected hook", source: "manual", corrected: true }],
    confidence: 1,
    totals: { spend: 900, results: 12 },
  };
  const again = resolveVersion(reclassified, { assetKey: "asset-9", format: "Feed", ratio: "1:1" });
  assert.equal(again.created, false, "labels and classification are not part of the rendition");
  assert.equal(again.version.versionId, first.version.versionId);
  assert.equal(again.creative.versions.length, 1);
});

test("reverting to an earlier asset reuses that version instead of forking history", () => {
  const first = resolveVersion({ creativeId: "cr_0009" }, { assetKey: "a1", format: "Feed", ratio: "4:5" });
  const second = resolveVersion(first.creative, { assetKey: "a2", format: "Feed", ratio: "4:5" });
  const reverted = resolveVersion(second.creative, { assetKey: "a1", format: "Feed", ratio: "4:5" });
  assert.equal(reverted.created, false);
  assert.equal(reverted.version.versionId, first.version.versionId);
  assert.equal(reverted.creative.versions.length, 2);
});

test("a version identity is reproducible from the rendition alone", () => {
  // Two browsers that have never met, given the same asset, must name the same
  // version: otherwise the same ad is two versions depending on who looked.
  const source = { assetKey: "asset-77", format: "Feed", ratio: "4:5" };
  const here = resolveVersion({ creativeId: "cr_0011" }, source);
  const elsewhere = resolveVersion({ creativeId: "cr_0011" }, { ...source });
  assert.equal(here.version.versionId, elsewhere.version.versionId);
  assert.equal(here.version.versionId, versionIdFor(source));

  // The full descriptor is stored beside the id, so equality never rests on the
  // digest alone.
  assert.equal(here.version.fingerprint, creativeFingerprint(source));
  assert.notEqual(versionIdFor(source), versionIdFor({ ...source, ratio: "9:16" }));
});

test("a reader creative's rendition comes from its asset identity, not from its name", () => {
  const a = sourceFingerprint({ id: "cr_0001", internalId: "int-1", format: "Feed", preview: { ratio: "4:5" }, name: "One" });
  const b = sourceFingerprint({ id: "cr_0001", internalId: "int-1", format: "Feed", preview: { ratio: "4:5" }, name: "Totally different name" });
  const c = sourceFingerprint({ id: "cr_0001", internalId: "int-2", format: "Feed", preview: { ratio: "4:5" }, name: "One" });
  assert.equal(a, b, "a renamed creative is the same rendition");
  assert.notEqual(a, c, "a different asset is a different rendition");
});

/* -------------------------------------------------- planned ad identity --- */

test("headlines that differ only after the truncation point stay distinct ads", () => {
  // These two agree for their first twenty characters, which is exactly what a
  // slug-and-truncate identity would have collapsed them into.
  const short = plannedRow({ headline: "Book a free valuation" });
  const lengthy = plannedRow({ headline: "Book a free valuation, same week" });
  assert.equal(short.headline.slice(0, 20), lengthy.headline.slice(0, 20));
  assert.notEqual(plannedAdFingerprint(short), plannedAdFingerprint(lengthy));
  assert.notEqual(slotKey(short), slotKey({ ...short, headline: "Book a free valuation with an appointment" }));

  const reconciled = reconcilePlanRows([], [short, lengthy]);
  assert.equal(reconciled.length, 2);
  assert.notEqual(reconciled[0].adId, reconciled[1].adId);

  // Two genuinely identical ads are still two ads with two identities.
  const twins = reconcilePlanRows([], [plannedRow(), plannedRow()]);
  assert.notEqual(twins[0].adId, twins[1].adId);
});

test("reordering a plan preserves every identity", () => {
  const rows = [
    plannedRow({ creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A" }),
    plannedRow({ creativeVersionId: "crv_b", creativeKey: "crv_b", headline: "B" }),
    plannedRow({ creativeVersionId: "crv_c", creativeKey: "crv_c", headline: "C" }),
  ];
  const first = reconcilePlanRows([], rows);
  const reordered = reconcilePlanRows(first, [first[2], first[0], first[1]]);
  assert.deepEqual(
    reordered.map((row) => row.adId),
    [first[2].adId, first[0].adId, first[1].adId],
    "the same rows in a different order keep their identities",
  );
});

test("editing the copy of a planned ad updates it instead of replacing it", () => {
  const first = reconcilePlanRows([], [plannedRow({ creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "Draft headline" })]);
  const edited = reconcilePlanRows(first, [{ ...first[0], headline: "Final headline" }]);
  assert.equal(edited[0].adId, first[0].adId, "an unrun ad keeps its identity when its copy is edited");
});

test("adding and removing rows never re-points the surviving identities", () => {
  const base = reconcilePlanRows(
    [],
    [
      plannedRow({ creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A" }),
      plannedRow({ creativeVersionId: "crv_b", creativeKey: "crv_b", headline: "B" }),
    ],
  );
  const grown = reconcilePlanRows(base, [
    base[0],
    plannedRow({ creativeVersionId: "crv_new", creativeKey: "crv_new", headline: "New" }),
    base[1],
  ]);
  assert.equal(grown[0].adId, base[0].adId);
  assert.equal(grown[2].adId, base[1].adId);
  assert.ok(![base[0].adId, base[1].adId].includes(grown[1].adId), "a new row gets a new identity");

  const shrunk = reconcilePlanRows(grown, [grown[1], grown[2]]);
  assert.equal(shrunk[0].adId, grown[1].adId);
  assert.equal(shrunk[1].adId, grown[2].adId);
});

test("a plan rebuilt after an axis change keeps the identities it can still match", () => {
  const previous = reconcilePlanRows(
    [],
    [
      plannedRow({ creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A", body: "" }),
      plannedRow({ creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A2", body: "" }),
    ],
  );
  const rebuilt = reconcilePlanRows(previous, [
    { creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A", body: "" },
    { creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A2", body: "" },
    { creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A3", body: "" },
  ]);
  assert.equal(rebuilt[0].adId, previous[0].adId);
  assert.equal(rebuilt[1].adId, previous[1].adId);
  assert.ok(![previous[0].adId, previous[1].adId].includes(rebuilt[2].adId));
});

/* --------------------------------------------------------- tracking join --- */

test("tracking identity is the ad's identity, never a slug of its copy", () => {
  const rows = reconcilePlanRows([], [
    plannedRow({ headline: "Book a free valuation" }),
    plannedRow({ headline: "Book a free valuation today" }),
  ]);
  for (const row of rows) {
    assert.equal(row.trackingKey, row.adId, "the tracking key is the identity");
    assert.equal(row.utmContent, row.adId, "utm_content is the identity");
    assert.ok(!/[Bb]ook/.test(row.utmContent), "no copy leaks into the identity");
  }
  assert.notEqual(rows[0].utmContent, rows[1].utmContent, "two variations cannot share a tracking identity");
});

test("rewording an ad cannot change what its tracking joins on", () => {
  const first = reconcilePlanRows([], [plannedRow({ headline: "Original wording" })]);
  const reworded = reconcilePlanRows(first, [{ ...first[0], headline: "Completely different wording" }]);
  assert.equal(reworded[0].trackingKey, first[0].trackingKey);
  assert.equal(reworded[0].utmContent, first[0].utmContent);
});

test("the tracking helper falls back to a fresh identity rather than an empty one", () => {
  const value = trackingIdentityFor("");
  assert.ok(isIdentity(value));
  assert.equal(identityKind(value), "ad");
});

/* -------------------------------------------------------- approval snapshot --- */

test("the plan snapshot is order-independent and changes with the plan", () => {
  const rows = reconcilePlanRows(
    [],
    [
      plannedRow({ creativeVersionId: "crv_a", creativeKey: "crv_a", headline: "A" }),
      plannedRow({ creativeVersionId: "crv_b", creativeKey: "crv_b", headline: "B" }),
    ],
  );
  const digest = planDigest(rows);
  assert.equal(planDigest([rows[1], rows[0]]), digest, "the same ads in another order are the same plan");

  const edited = reconcilePlanRows(rows, [{ ...rows[0], destination: "https://example.test/other" }, rows[1]]);
  assert.notEqual(planDigest(edited), digest, "changing a destination changes what was approved");

  const fewer = planDigest([rows[0]]);
  assert.notEqual(fewer, digest);
  assert.equal(planSnapshot([rows[1], rows[0]]).length, 2);
});

test("the fingerprint of a rendition is exact, not a truncated convenience value", () => {
  const a = creativeFingerprint({ assetKey: "asset-abcdefghijklmnop", format: "Feed", ratio: "4:5" });
  const b = creativeFingerprint({ assetKey: "asset-abcdefghijklmnoq", format: "Feed", ratio: "4:5" });
  assert.notEqual(a, b, "assets that differ in the last character are different renditions");
});
