import test from "node:test";
import assert from "node:assert/strict";
import { canPersistProjectRefresh, isCurrentProjectAccess, jobNextAction, jobRenderPolicy, mapWithConcurrency, ownerReturnEvent, receiptViewModel, reconcileProjectRefresh, workFreshness, workNextAction, workRowAccessibleName, workStatusLabel } from "../web/mini/mini_projects.mjs";

test("project return, receipt and reader policies stay private and deterministic", () => {
  assert.equal(ownerReturnEvent({ last_opened_stage: "working" }, { stage: "ready", result: {} }), "ready");
  assert.equal(ownerReturnEvent({ last_opened_stage: "ready", last_opened_had_result: true }, { stage: "ready", result: {} }), "");
  assert.equal(ownerReturnEvent({ last_opened_stage: "working" }, { stage: "needs_attention" }), "needs_attention");
  const receipt = receiptViewModel({ problem: "Follow up\0 safely", stage: "ready", result: {}, claim: "private" }, { formatDate: () => "date", formatDateTime: () => "time" });
  assert.deepEqual(receipt, { aim: "Follow up safely", now: "Ready to use", next: "Open the result or ask for a change.", updated: "", availability: "", ready: true });
  assert.deepEqual(jobRenderPolicy("work"), { focusReceipt: true, scrollToEnd: false });
  assert.match(workRowAccessibleName({ title: "Quote", stage: "ready", refresh_status: "unavailable" }, { ready: "Ready" }), /Showing saved information/);
});

test("row freshness distinguishes cached, live and unavailable states", () => {
  assert.equal(workFreshness({ refresh_status: "saved" }), "Saved in this browser.");
  assert.equal(workFreshness({ refresh_status: "live" }), "Checked just now.");
  assert.equal(workFreshness({ refresh_status: "unavailable" }), "Showing saved information — couldn't refresh just now.");
  assert.equal(workFreshness({}), "Saved in this browser.");
  const labels = { queued: "Waiting", ready: "Ready", unavailable: "Couldn't update just now" };
  assert.equal(workStatusLabel({ stage: "ready", refresh_status: "live" }, labels), "Ready");
  assert.equal(workStatusLabel({ stage: "ready", refresh_status: "unavailable" }, labels), "Saved details");
  assert.equal(workStatusLabel({ stage: "ready", refresh_status: "saved", return_event: "ready" }, labels), "Ready since you last opened it");
  assert.equal(workNextAction({ stage: "ready", refresh_status: "unavailable" }), "Try opening this work again.");
  assert.equal(workNextAction({ stage: "ready" }), "Open the result or ask for a change.");
  assert.match(workRowAccessibleName({ title: "Quote", stage: "ready", refresh_status: "live" }, labels), /Checked just now/);
  assert.doesNotMatch(workRowAccessibleName({ title: "Quote", stage: "ready", refresh_status: "saved" }, labels), /just now/);
});

test("render policy keeps the start flow away from the receipt and polling quiet", () => {
  assert.deepEqual(jobRenderPolicy("start"), { focusReceipt: false, scrollToEnd: true });
  assert.deepEqual(jobRenderPolicy("poll"), { focusReceipt: false, scrollToEnd: false });
  assert.deepEqual(jobRenderPolicy("direct"), { focusReceipt: false, scrollToEnd: false });
  assert.equal(jobNextAction(null), "Open this work to see where things are up to.");
  assert.equal(jobNextAction({ stage: "queued" }), "Your solution is queued.");
  assert.equal(jobNextAction({ stage: "needs_attention", retry_available: true }), "There is one thing to try again.");
  assert.equal(ownerReturnEvent(null, { stage: "ready", result: {} }), "");
  assert.equal(ownerReturnEvent({ last_opened_stage: "ready", last_opened_had_result: false }, { stage: "ready", result: {} }), "ready");
});

test("refresh work is bounded, ordered and cannot overwrite a newer snapshot", async () => {
  let active = 0, peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return value * 2; });
  assert.deepEqual(result, [2, 4, 6, 8, 10]); assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => { throw new Error("never"); }), []);
  const snapshot = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const refreshed = reconcileProjectRefresh(snapshot, [{ kind: "live", job: { stage: "ready" }, returnEvent: "ready" }, { kind: "missing" }, { kind: "unavailable" }], (prior, job) => ({ ...prior, ...job, refresh_status: "live" }));
  assert.deepEqual(refreshed.stored.map((item) => item.id), ["one", "three"]);
  assert.equal(refreshed.display[0].return_event, "ready");
  assert.equal(refreshed.display[1].refresh_status, "unavailable");
  assert.equal(canPersistProjectRefresh({ revision: 1, raw: "a" }, { revision: 1, raw: "a" }), true);
  assert.equal(canPersistProjectRefresh({ revision: 1, raw: "a" }, { revision: 2, raw: "a" }), false);
  assert.equal(canPersistProjectRefresh({ revision: 1, raw: "a" }, { revision: 1, raw: "b" }), false);
  assert.equal(isCurrentProjectAccess({ id: "one", claim: "key" }, { id: "one", claim: "key" }, 2, 2), true);
  assert.equal(isCurrentProjectAccess({ id: "two", claim: "key" }, { id: "one", claim: "key" }, 2, 2), false);
  assert.equal(isCurrentProjectAccess(null, { id: "one", claim: "key" }, 2, 2), false);
  assert.equal(isCurrentProjectAccess({ id: "one", claim: "other" }, { id: "one", claim: "key" }, 2, 2), false);
  assert.equal(isCurrentProjectAccess({ id: "one", claim: "key" }, { id: "one", claim: "key" }, 3, 2), false);
});
