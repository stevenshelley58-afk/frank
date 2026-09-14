import test from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_TRANSPORT_POLICY,
  filterCustomers,
  filterNotifications,
  filterRevenueRecords,
  growthReport,
  growthRows,
  rangeMetrics,
} from "../web/js/owner-dashboard.js";
const records = [
  {
    name: "Ava",
    email: "ava@example.test",
    stage: "Website enquiry",
    source: "Website",
    kind: "lead",
    status: "New",
  },
  {
    name: "Mila",
    email: "mila@example.test",
    stage: "Trial day 4",
    source: "Search",
    kind: "trial",
    status: "Onboarding",
  },
];
test("range metrics change their period evidence", () => {
  assert.equal(rangeMetrics(7).leads, 18);
  assert.equal(rangeMetrics(30).leads, 54);
  assert.equal(rangeMetrics(90).leads, 143);
  assert.equal(rangeMetrics(123).leads, 54);
});
test("customer filters combine category status and search", () => {
  assert.deepEqual(filterCustomers(records, "ava", "New", "lead"), [
    records[0],
  ]);
  assert.deepEqual(filterCustomers(records, "", "Onboarding", "All"), [
    records[1],
  ]);
  assert.equal(filterCustomers(records, "missing").length, 0);
});
test("notification filtering does not mutate records", () => {
  const notes = [
    { severity: "New", category: "Customer" },
    { severity: "Info", category: "Delivery" },
  ];
  assert.deepEqual(filterNotifications(notes, "New", "All"), [notes[0]]);
  assert.equal(notes.length, 2);
});
test("preview has no persistence or provider transport capability", () =>
  assert.deepEqual(PREVIEW_TRANSPORT_POLICY, {
    previewOnly: true,
    persistence: "none",
    providerTransport: "prohibited",
  }));
import fs from "node:fs";
test("preview source forbids browser transport and storage", () => {
  const source = fs.readFileSync(
    new URL("../web/js/owner-dashboard.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage)\b/,
  );
});

test("growth reports use source-specific units and reconcile every range", () => {
  const sources = [["Website", "leads"], ["Google Analytics", "sessions"], ["Search Console", "clicks"], ["Meta Ads", "leads"], ["Google Ads", "leads"], ["Clarity", "sessions"]];
  for (const [source, unit] of sources) {
    const totals = [7, 30, 90].map((days) => {
      const report = growthReport(source, days);
      assert.equal(report.unit, unit);
      const rows = growthRows(report);
      assert.equal(rows.length, 3);
      assert.ok(rows.every((row) => row.length === 2 && row.every((value) => typeof value === "string")));
      assert.equal(report.series.reduce((sum, value) => sum + value, 0), report.total);
      return report.total;
    });
    assert.equal(new Set(totals).size, 3);
  }
  assert.notEqual(growthReport("Website", 30).total, growthReport("Clarity", 30).total);
  assert.equal(growthReport("Meta Ads", 7).series.includes(0), true);
  assert.equal(growthReport("Meta Ads", 30).costPerLead, 22.77);
  assert.equal(growthReport("Google Ads", 90).costPerLead, 32);
});

test("revenue filters separate record kinds and expose issues explicitly", () => {
  const revenue = [
    { id: "trial", recordKind: "subscription", issueFlag: false },
    { id: "current", recordKind: "subscription", issueFlag: false },
    { id: "retry", recordKind: "payment", issueFlag: true },
    { id: "receipt", recordKind: "payment", issueFlag: false },
  ];
  assert.deepEqual(filterRevenueRecords(revenue, "Subscriptions").map((x) => x.id), ["trial", "current"]);
  assert.deepEqual(filterRevenueRecords(revenue, "Payments").map((x) => x.id), ["retry", "receipt"]);
  assert.deepEqual(filterRevenueRecords(revenue, "Issues").map((x) => x.id), ["retry"]);
  assert.equal(filterRevenueRecords(revenue, "All").length, 4);
});
