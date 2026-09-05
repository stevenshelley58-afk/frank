import assert from "node:assert/strict";
import test from "node:test";

import {
  appendBoundedEvent,
  applyRunEvent,
  deriveTimelineItems,
  filterCreatives,
  splitList,
} from "../web/js/ad-radar.js";

test("research list parsing is ordered, deduplicated, and bounded", () => {
  assert.deepEqual(splitList(" Perth WA, 6000, perth wa, , Fremantle "), ["Perth WA", "6000", "Fremantle"]);
  assert.deepEqual(splitList("one,two,three", 2), ["one", "two"]);
});

test("event replay deduplicates a cursor and bounds the client buffer", () => {
  let events = [];
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    events = appendBoundedEvent(events, { sequence, _runId: "run-a" }, 3);
  }
  assert.deepEqual(events.map((event) => event.sequence), [3, 4, 5]);
  events = appendBoundedEvent(events, { sequence: 5, _runId: "run-a" }, 3);
  assert.deepEqual(events.map((event) => event.sequence), [3, 4, 5]);
  events = appendBoundedEvent(events, { sequence: 5, _runId: "run-b" }, 3);
  assert.equal(events.at(-1)._runId, "run-b");
});

test("timeline prefers durable creative events and falls back to public observations", () => {
  const runs = [{
    id: "run-a",
    status: "running",
    updated_at: 100,
    creatives: [{
      id: "creative-a",
      advertiser: "Northline Homes",
      market: "Perth",
      source_ref: "https://public.example/ad/a",
      copy: { headline: "A public headline" },
      observed: { last_seen: "2026-08-31T10:00:00Z" },
      media: [{ kind: "image", qa_status: "passed" }],
    }, {
      id: "creative-b",
      advertiser: "Kin & Coast",
      source_ref: "https://public.example/ad/b",
      copy: {},
      observed: { last_seen: "2026-08-31T09:00:00Z" },
      media: [],
    }],
  }];
  const events = [{
    sequence: 2,
    _runId: "run-a",
    kind: "creative.observed",
    timestamp: 1788166800,
    data: { creative_id: "creative-a", change: "changed", advertiser: "Northline Homes" },
  }];
  const timeline = deriveTimelineItems(runs, events);
  assert.equal(timeline.filter((item) => item.creativeId === "creative-a").length, 1);
  assert.equal(timeline.find((item) => item.creativeId === "creative-a").status, "changed");
  assert.equal(timeline.find((item) => item.creativeId === "creative-b").summary, "Public creative observation recorded.");
});

test("library filtering relates query, run status, and passed media type", () => {
  const creatives = [
    { advertiser: "Northline Homes", market: "Perth", category: "Residential", _status: "active", media: [{ kind: "image" }], copy: {} },
    { advertiser: "Kin & Coast", market: "Fremantle", category: "Residential", _status: "published", media: [{ kind: "video" }], copy: {} },
  ];
  assert.equal(filterCreatives(creatives, { query: "northline", status: "all", media: "all" }).length, 1);
  assert.equal(filterCreatives(creatives, { query: "", status: "published", media: "video" }).length, 1);
  assert.equal(filterCreatives(creatives, { query: "Perth", status: "published", media: "all" }).length, 0);
});

test("declared lifecycle events update run state and attention consistently", () => {
  const cases = [
    ["run-paused", "paused", false],
    ["run-resumed", "running", false],
    ["stage-failed", "retryable_failure", true],
    ["approval-requested", "awaiting_approval", true],
    ["publish-failed", "failed", true],
    ["publish-completed", "published", false],
    ["run-completed", "completed", false],
  ];
  for (const [kind, status, attention] of cases) {
    const run = { status: "running", attention: false, stage: "capture" };
    applyRunEvent(run, { kind, node_id: "publish", timestamp: "2026-08-31T10:00:00Z" });
    assert.equal(run.status, status, kind);
    assert.equal(run.attention, attention, kind);
    assert.equal(run.stage, "publish", kind);
  }
});
