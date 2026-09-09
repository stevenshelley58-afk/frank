import assert from "node:assert/strict";
import test from "node:test";

import {
  adDbDateLabel,
  archivedMedia,
  adDetailRoute,
  buildAdDbQuery,
  normaliseAdDbPage,
  ownershipLabels,
  runReadiness,
  safeArchiveUrl,
} from "../web/js/ad-db.js";
import { pathForView, routeForPath } from "../web/js/view-routing.js";

test("Ad DB media accepts only same-origin Frank archive routes", () => {
  const path = "/api/ad-db/ads/2d7d97b5/media/asset_01";
  assert.equal(safeArchiveUrl(path), path);
  for (const unsafe of [
    "https://cdn.example/ad.mp4",
    "//cdn.example/ad.mp4",
    "/v1/ad-db/ads/2d7d97b5/media/asset_01",
    "/api/ad-db/ads/../media/asset_01",
    path + "?download=1",
  ]) {
    assert.equal(safeArchiveUrl(unsafe), "");
  }
  assert.deepEqual(
    archivedMedia([
      { archiveUrl: path, mimeType: "video/mp4" },
      { archiveUrl: "https://cdn.example/ad.jpg", mimeType: "image/jpeg" },
      { archiveUrl: "/api/ad-db/ads/2d7d97b5/media/data", mimeType: "application/json" },
    ]).map((asset) => asset.displayKind),
    ["video"],
  );
});

test("Ad DB detail stays on the canonical same-origin route", () => {
  assert.equal(adDetailRoute("ad-1"), "/api/ad-db/ads/ad-1");
  assert.equal(adDetailRoute("ad/with spaces"), "/api/ad-db/ads/ad%2Fwith%20spaces");
  assert.equal(adDetailRoute(""), "");
});

test("Ad DB query includes bounded supported filters and opaque pagination", () => {
  const params = buildAdDbQuery({
    q: "coastal",
    agent: "Alex",
    agency: "North",
    state: "WA",
    suburb: "Perth",
    postcode: "6000",
    locationRelation: "service_area",
    ignored: "never forwarded",
  }, "opaque-cursor", 500);
  assert.deepEqual(Object.fromEntries(params), {
    q: "coastal",
    agentName: "Alex",
    agencyName: "North",
    state: "WA",
    suburb: "Perth",
    postcode: "6000",
    locationRelation: "service_area",
    cursor: "opaque-cursor",
    limit: "100",
  });
  assert.equal(buildAdDbQuery({ locationRelation: "ad_explicit" }).has("locationRelation"), false);
});

test("Ad DB rejects malformed collection envelopes", () => {
  assert.deepEqual(normaliseAdDbPage({ items: [{ id: "one" }], page: { nextCursor: null } }), {
    items: [{ id: "one" }],
    nextCursor: null,
  });
  assert.throws(() => normaliseAdDbPage({ items: [] }), /invalid Ad DB response/);
  assert.throws(() => normaliseAdDbPage({ items: [], page: { nextCursor: 12 } }), /invalid Ad DB cursor/);
});

test("ownership and readiness labels use recorded fields only", () => {
  assert.deepEqual(
    ownershipLabels({
      agent: { name: "A. Agent", relationship: "owner" },
      agency: { name: "North", relationship: "member_agency" },
    }),
    [
      { kind: "agent", name: "A. Agent", relationship: "owner" },
      { kind: "agency", name: "North", relationship: "member agency" },
    ],
  );
  assert.deepEqual(ownershipLabels({ agent: { relationship: "owner" } }), []);
  assert.equal(runReadiness({ coverage_complete: true, pagination_exhausted: true }), "Coverage complete");
  assert.equal(runReadiness({ status: "running" }), "Collection running");
  assert.equal(runReadiness({ status: "failed" }), "Collection failed");
  assert.equal(runReadiness({ status: "complete", coverage_complete: false }), "Coverage not confirmed");
});

test("dates fail closed when the archive did not record a usable time", () => {
  assert.equal(adDbDateLabel(null), "Not recorded");
  assert.equal(adDbDateLabel("not-a-date"), "Not recorded");
  assert.notEqual(adDbDateLabel("2026-09-05T04:30:00Z"), "Not recorded");
});

test("Ad DB has a canonical Window route", () => {
  assert.deepEqual(routeForPath("/ad-db"), { view: "ad-db" });
  assert.deepEqual(routeForPath("/ad-db/"), { view: "ad-db" });
  assert.equal(pathForView("ad-db"), "/ad-db");
});
