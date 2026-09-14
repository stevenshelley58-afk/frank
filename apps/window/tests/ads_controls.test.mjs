// The professional controls of the Ads workspace: views, hierarchy, currency,
// bulk review, draft lifecycle.
//
// Every rule here exists because getting it wrong is quiet and expensive:
//
//   * a built-in view that is mistakable for the operator's own makes a link
//     mean two things, and a view that applies half of itself (filters but not
//     columns) leaves a screen nobody can explain;
//   * a drill-down that filters on a parent's *name* shows the children of every
//     campaign that shares it;
//   * a money figure with an invented currency is a wrong number, and a missing
//     value rendered as 0 is a number Frank made up;
//   * an approval is a sign-off on one exact plan, so an approval that survives
//     the plan changing is not an approval at all;
//   * a phase this browser claims to have reached is a claim that Meta accepted
//     something, and this browser cannot know that.
//
// Rule-level, no browser: these modules are imported directly and driven with
// plain objects. The interactive journeys in acceptance/ads_journey.py drive the
// same rules through the real screens.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BUILT_IN_VIEWS,
  OPERATORS,
  accountCurrency,
  appliedViewSentence,
  applyFilters,
  builtInViewsFor,
  createViewStore,
  findBuiltInView,
  formatAccountMoney,
  formatAccountMoneyDelta,
  isBuiltInViewId,
  readViewParam,
  reflectViewParam,
  summariseChangeEntries,
} from "../web/js/ads/ads-views.js";
import { PARENT_FIELD, parentFilterFor, parentIdentity } from "../web/js/ads/ads-campaigns.js";
import { approvalStatus, draftDigest, queuePhaseLabel } from "../web/js/ads/ads-queue.js";
import { planDigest } from "../web/js/ads/ads-identity.js";
import { EVIDENCE_FLOOR } from "../web/js/ads/ads-contracts.js";

/* ------------------------------------------------------------- fakes --- */

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    size: () => map.size,
  };
}

/** The smallest window that `reflectViewParam` and `readViewParam` need. */
function fakeWindow(href = "https://frank.test/project/blockwise/ads?screen=campaigns") {
  let current = href;
  return {
    location: {
      get search() {
        return new URL(current).search;
      },
      get href() {
        return current;
      },
    },
    history: {
      state: null,
      replaceState(_state, _title, url) {
        current = String(url);
      },
    },
    href: () => current,
  };
}

const row = (over = {}) => ({
  id: "cmp_001",
  internalId: "cmp_001",
  level: "campaign",
  name: "Spring launch",
  spend: 120,
  results: 30,
  qualifiedLeads: 4,
  ...over,
});

/* ------------------------------------------------- built-in views --- */

test("built-in views are code, named, and impossible to confuse with saved views", () => {
  const screens = Object.keys(BUILT_IN_VIEWS);
  assert.deepEqual(
    screens.sort(),
    ["screen.blogs", "screen.campaigns", "screen.creative", "screen.queue"],
    "the screens the owner asked for each carry built-ins",
  );
  const ids = new Set();
  for (const [screen, list] of Object.entries(BUILT_IN_VIEWS)) {
    assert.ok(list.length > 0, `${screen} has built-in views`);
    for (const view of list) {
      assert.equal(view.kind, "built-in", `${view.id} says what it is`);
      assert.ok(isBuiltInViewId(view.id), `${view.id} carries the built-in id prefix`);
      assert.ok(!view.id.startsWith("view_"), "a built-in id can never collide with a saved view's id");
      assert.ok(view.name && view.name.length > 0, `${view.id} has a name`);
      // The hint is the claim's small print: a built-in that filters on a floor
      // has to say what the floor is, or the name is doing the arguing.
      assert.ok(view.hint && view.hint.length > 20, `${view.id} states its own condition`);
      assert.ok(Array.isArray(view.filters) && view.filters.length > 0, `${view.id} filters on something`);
      for (const filter of view.filters) {
        assert.ok(filter.field && filter.op, `${view.id} filters are data, not closures`);
        assert.equal(typeof filter.get, "undefined", `${view.id} filters survive storage: no closures`);
        assert.ok(OPERATORS.some((operator) => operator.id === filter.op), `${view.id} uses an operator the bar can render`);
      }
      assert.ok(!ids.has(view.id), `${view.id} is unique`);
      ids.add(view.id);
    }
  }
});

test("each screen's built-in views are exactly the ones the brief asked for", () => {
  const names = (screen) => builtInViewsFor(screen).map((view) => view.name);
  assert.deepEqual(names("screen.campaigns"), ["Needs attention", "Spending with no observed outcome", "Below the evidence floor"]);
  assert.deepEqual(names("screen.creative"), ["Winners", "Awaiting evidence", "Near-duplicates"]);
  assert.deepEqual(names("screen.blogs"), ["Promoted", "Converting", "No promotion"]);
  assert.ok(names("screen.queue").includes("Needs reconcile"), "the queue can show the rows that must be reconciled before a retry");
  assert.deepEqual(builtInViewsFor("screen.unknown"), [], "a screen without built-ins gets none, not another screen's");
  assert.equal(findBuiltInView("screen.campaigns", "builtin.creative.winners"), null, "a built-in belongs to one screen");
});

test("the evidence floor splits the creative rows in two, and an unknown row is in neither half", () => {
  const winners = findBuiltInView("screen.creative", "builtin.creative.winners");
  const awaiting = findBuiltInView("screen.creative", "builtin.creative.awaiting-evidence");
  const fields = [
    { id: "name", get: (r) => r.name },
    { id: "results", get: (r) => r.results },
  ];
  const enough = { name: "Enough", results: EVIDENCE_FLOOR.results };
  const notEnough = { name: "Too little", results: EVIDENCE_FLOOR.results - 1 };
  const unknown = { name: "Not measured", results: null };

  assert.deepEqual(applyFilters([enough, notEnough, unknown], winners.filters, fields), [enough]);
  assert.deepEqual(applyFilters([enough, notEnough, unknown], awaiting.filters, fields), [notEnough]);
  // The floor is inclusive on the winners' side and the two views together
  // cover every measured row exactly once.
  assert.equal(winners.filters[0].value, EVIDENCE_FLOOR.results);
  assert.ok(/floor/i.test(winners.hint), "the winners view names the floor rather than crowning a winner");
});

test("a built-in that counts spending excludes the rows whose outcome is unknown", () => {
  const view = findBuiltInView("screen.campaigns", "builtin.campaigns.spending-no-outcome");
  const fields = [
    { id: "spend", get: (r) => r.spend },
    { id: "qualifiedLeads", get: (r) => r.qualifiedLeads },
  ];
  const rows = [
    { name: "Spent, no lead", spend: 40, qualifiedLeads: 0 },
    { name: "Spent, leads", spend: 40, qualifiedLeads: 3 },
    { name: "Spent, leads unknown", spend: 40, qualifiedLeads: null },
    { name: "No spend, no lead", spend: 0, qualifiedLeads: 0 },
  ];
  assert.deepEqual(
    applyFilters(rows, view.filters, fields).map((r) => r.name),
    ["Spent, no lead"],
    "an unmeasured row is not a row with no outcome",
  );
});

test("a floor is inclusive, and an unmeasured row is on neither side of it", () => {
  const fields = [{ id: "results", get: (r) => r.results }];
  const atLeast = { field: "results", op: "gte", value: 25 };
  const atMost = { field: "results", op: "lte", value: 24 };
  const rows = [{ name: "24", results: 24 }, { name: "25", results: 25 }, { name: "unknown", results: null }, { name: "text", results: "not a number" }];
  assert.deepEqual(applyFilters(rows, [atLeast], fields).map((r) => r.name), ["25"]);
  assert.deepEqual(applyFilters(rows, [atMost], fields).map((r) => r.name), ["24"]);
  assert.ok(OPERATORS.some((operator) => operator.id === "gte"), "the bar can render the operator a built-in uses");
  assert.ok(OPERATORS.some((operator) => operator.id === "lte"));
});

/* -------------------------------------------------- view apply/restore --- */
test("applying a view restores its columns, sort and filters together", () => {
  const storage = fakeStorage();
  const store = createViewStore("screen.campaigns", { storage, win: fakeWindow() });

  store.update({ columns: ["name", "spend"], sort: { id: "spend", dir: "desc" }, filters: [{ field: "state", op: "is", value: "delivering" }] });
  const saved = store.save("Spend, delivering");

  // Everything changes…
  store.update({ columns: ["name"], sort: { id: "name", dir: "asc" }, filters: [] });
  assert.equal(store.activeView().modified, true, "editing after applying marks the view as modified");

  // …and applying the view puts all three back.
  store.apply(saved);
  assert.deepEqual(store.state.columns, ["name", "spend"]);
  assert.deepEqual(store.state.sort, { id: "spend", dir: "desc" });
  assert.deepEqual(store.state.filters, [{ field: "state", op: "is", value: "delivering" }]);
  assert.equal(store.activeView().id, saved.id);
  assert.equal(store.activeView().kind, "saved");
  assert.equal(store.activeView().modified, false);
});

test("a built-in view applies its conditions without clearing a column choice it never made", () => {
  const store = createViewStore("screen.creative", { storage: fakeStorage(), win: fakeWindow() });
  store.update({ columns: ["name", "ctr"], sort: { id: "ctr", dir: "desc" } });
  const view = findBuiltInView("screen.creative", "builtin.creative.near-duplicates");
  store.apply(view);
  assert.deepEqual(store.state.filters, [{ field: "nearDuplicate", op: "is_true", value: true }]);
  assert.deepEqual(store.state.columns, ["name", "ctr"], "a view that names no columns leaves the reader's choice alone");
  assert.equal(store.activeView().kind, "built-in");
  assert.equal(store.activeView().name, "Near-duplicates");

  // The view that does name columns replaces them.
  store.apply(findBuiltInView("screen.creative", "builtin.creative.winners"));
  assert.deepEqual(store.state.columns, ["name", "spend", "results", "costPerResult", "qualifiedLeads", "costPerQualifiedLead", "ctr"]);
  assert.deepEqual(store.state.sort, { id: "costPerResult", dir: "asc" });
});

test("a condition this screen cannot evaluate is dropped and named, never silently applied", () => {
  const store = createViewStore("screen.campaigns", { storage: fakeStorage(), win: fakeWindow() });
  store.update({ filters: [{ field: "nearDuplicate", op: "is_true", value: true }, { field: "spend", op: "gt", value: 0 }] });
  const saved = store.save("Mixed");
  store.update({ filters: [] });
  const fields = [{ id: "spend", get: (r) => r.spend }];
  store.apply(saved, { fields });
  assert.deepEqual(store.state.filters, [{ field: "spend", op: "gt", value: 0 }]);
  assert.deepEqual(store.skipped.fields, ["nearDuplicate"]);
  assert.match(appliedViewSentence(store, saved), /nearDuplicate/);
});

test("views are keyed and de-duplicated by id, never by name", () => {
  const store = createViewStore("screen.campaigns", { storage: fakeStorage(), win: fakeWindow() });
  const first = store.save("Winners");
  const second = store.save("Winners");
  assert.notEqual(first.id, second.id, "two views may share a name");
  assert.equal(store.saved().length, 2, "saving the same name twice does not overwrite the first view");

  store.rename(first.id, "Renamed");
  assert.equal(store.saved().find((view) => view.id === first.id).name, "Renamed");
  assert.equal(store.saved().find((view) => view.id === second.id).name, "Winners", "a rename touches one view");

  store.remove(second.id);
  assert.deepEqual(store.saved().map((view) => view.id), [first.id]);
  assert.equal(store.builtIn().length, 3, "the built-ins are untouched by anything the operator does");
  store.remove("builtin.campaigns.needs-attention");
  assert.equal(store.builtIn().length, 3);
});

test("saving changes to an existing view captures what is on screen now", () => {
  const store = createViewStore("screen.queue", { storage: fakeStorage(), win: fakeWindow() });
  const view = store.save("Mine");
  store.update({ filters: [{ field: "needsReconcile", op: "is_true", value: true }] });
  store.updateSaved(view.id);
  const stored = store.saved().find((entry) => entry.id === view.id);
  assert.deepEqual(stored.filters, [{ field: "needsReconcile", op: "is_true", value: true }]);
  assert.equal(store.activeView().modified, false, "saving over a view leaves it unmodified");
});

test("a link carrying a view applies it, and an unknown view id is ignored rather than an error", () => {
  const known = findBuiltInView("screen.campaigns", "builtin.campaigns.below-evidence-floor");
  const win = fakeWindow(`https://frank.test/project/blockwise/ads?screen=campaigns&view=${known.id}`);
  const store = createViewStore("screen.campaigns", { storage: fakeStorage(), win });
  assert.deepEqual(store.state.filters, known.filters);
  assert.equal(store.urlView.applied, true);
  assert.equal(store.urlView.kind, "built-in");

  const stale = createViewStore("screen.campaigns", {
    storage: fakeStorage(),
    win: fakeWindow("https://frank.test/project/blockwise/ads?screen=campaigns&view=builtin.campaigns.deleted-long-ago"),
  });
  assert.deepEqual(stale.state.filters, [], "an unknown id opens the screen with its stored configuration");
  assert.equal(stale.urlView.applied, false);
  assert.equal(readViewParam({ location: { search: "" } }), "");
});

test("the applied view is reflected in the address bar without disturbing screen or preview", () => {
  const win = fakeWindow("https://frank.test/project/blockwise/ads?screen=queue&preview=1");
  const store = createViewStore("screen.queue", { storage: fakeStorage(), win });
  const view = store.save("Reconcile first");
  const url = new URL(win.href());
  assert.equal(url.searchParams.get("view"), view.id);
  assert.equal(url.searchParams.get("screen"), "queue", "the link still opens the same screen");
  assert.equal(url.searchParams.get("preview"), "1", "and the same preview mode");
  store.remove(view.id);
  assert.equal(new URL(win.href()).searchParams.get("view"), null, "deleting the active view clears the link");

  assert.equal(reflectViewParam("v1", { win: null }), false, "a window that refuses the rewrite is reported, not thrown");
});

/* ----------------------------------------------------- hierarchy --- */

test("the parent of a row is an identity, and a name is never a parent", () => {
  const adset = row({ level: "adset", parentId: "cmp_001", campaignName: "Spring launch" });
  assert.deepEqual(parentIdentity(adset), { id: "cmp_001", name: "Spring launch" });
  const ad = row({ level: "ad", parentId: "adset_9", adsetName: "Broad" });
  assert.deepEqual(parentIdentity(ad), { id: "adset_9", name: "Broad" });
  // A row with no parent field at all has no parent, rather than its own name.
  assert.deepEqual(parentIdentity({ level: "adset", name: "Broad" }), { id: "", name: "" });
  assert.equal(parentIdentity(null).id, "");
});

test("a drill-down splits two campaigns that share a name, because it filters by id", () => {
  const springOne = row({ id: "cmp_001", internalId: "cmp_001", name: "Spring launch" });
  const springTwo = row({ id: "cmp_002", internalId: "cmp_002", name: "Spring launch" });
  const children = [
    row({ level: "adset", id: "adset_1", internalId: "adset_1", name: "Broad 1", parentId: "cmp_001", campaignName: "Spring launch" }),
    row({ level: "adset", id: "adset_2", internalId: "adset_2", name: "Broad 1", parentId: "cmp_002", campaignName: "Spring launch" }),
    row({ level: "adset", id: "adset_3", internalId: "adset_3", name: "Lookalike", parentId: "cmp_001", campaignName: "Spring launch" }),
  ];
  const filter = parentFilterFor("adset", "cmp_001");
  assert.deepEqual(filter, { field: "campaignId", op: "is", value: "cmp_001" });
  const fields = [{ id: "campaignId", get: (r) => parentIdentity(r).id }];
  assert.deepEqual(
    applyFilters(children, [filter], fields).map((r) => r.internalId),
    ["adset_1", "adset_3"],
    "the sibling campaign's ad set is excluded even though its campaign name matches",
  );
  // The filter the drill-down uses is the same shape as any operator filter, so
  // the bar renders it as a removable chip.
  assert.equal(filter.op, "is");
  assert.equal(PARENT_FIELD.ad.id, "adsetId");
  assert.equal(parentFilterFor("campaign", "cmp_001"), null, "a campaign has no parent level to drill into");
  assert.equal(parentFilterFor("adset", ""), null, "an empty id would filter on nothing at all");
  assert.equal(springOne.name, springTwo.name);
});

/* ------------------------------------------------------ currency --- */

test("the account currency is read from the context or reported as unknown, never assumed", () => {
  assert.equal(accountCurrency({}), "");
  assert.equal(accountCurrency(null), "");
  assert.equal(accountCurrency({ account: { currency: "gbp" } }), "GBP");
  assert.equal(accountCurrency({ account: { currency: " eur " } }), "EUR");
  assert.equal(accountCurrency({ account: { currency: "US" } }), "", "a value that is not an ISO code is unknown, not passed to Intl");
  assert.equal(accountCurrency({ account: { currency: 42 } }), "");
});

test("a money figure with no currency says so instead of borrowing a unit", () => {
  const unknown = formatAccountMoney(1234.5, "");
  assert.match(unknown, /currency unknown/);
  assert.ok(!/£|GBP|\$/.test(unknown), `no unit may be invented: ${unknown}`);
  assert.match(formatAccountMoney(1234.5, "GBP"), /£/);
  assert.match(formatAccountMoneyDelta(-250, ""), /^−/);
  assert.match(formatAccountMoneyDelta(-250, ""), /currency unknown/);

  // Unknown is not zero, and a real zero is still a figure.
  assert.equal(formatAccountMoney(null, "GBP"), null);
  assert.equal(formatAccountMoney(undefined, "GBP"), null);
  assert.equal(formatAccountMoney("", "GBP"), null);
  assert.notEqual(formatAccountMoney(0, "GBP"), null);
});

test("no screen in this change assumes a currency of its own", () => {
  for (const file of ["ads-campaigns.js", "ads-queue.js"]) {
    const source = readFileSync(new URL(`../web/js/ads/${file}`, import.meta.url), "utf8");
    assert.ok(!/\|\|\s*"GBP"/.test(source), `${file} does not fall back to GBP`);
    assert.ok(!/formatMoney\(\s*[^,)]+\)/.test(source), `${file} passes a currency to every money format`);
  }
});

/* -------------------------------------------------- bulk review --- */

test("a total covers the known rows, and an unknown value is excluded and counted", () => {
  const plan = summariseChangeEntries("budget", [
    { key: "ad_1", before: 10, after: 12 },
    { key: "ad_2", before: 20, after: 22 },
    { key: "ad_3", before: null, after: null },
  ]);
  assert.equal(plan.entries.length, 3, "every affected record is listed");
  assert.equal(plan.unknown.length, 1);
  assert.deepEqual(plan.unknown.map((entry) => entry.key), ["ad_3"]);
  assert.equal(plan.known.length, 2);
  assert.equal(plan.total, 4, "the total is the known rows' change only");
  assert.equal(plan.beforeTotal, 30);
  assert.equal(plan.afterTotal, 34);
  assert.ok(!plan.known.some((entry) => entry.before === 0), "an unknown before is not a zero before");
});

test("a total computed from no known rows is not presented as zero", () => {
  const plan = summariseChangeEntries("budget", [
    { key: "ad_1", before: null, after: null },
    { key: "ad_2", before: null, after: null },
  ]);
  assert.equal(plan.known.length, 0);
  assert.equal(plan.beforeTotal, null, "the caller prints a dash, because there is nothing to total");
  assert.equal(plan.afterTotal, null);
  assert.equal(plan.unknown.length, 2);
});

test("a real zero is a value, and a row that does not change says so", () => {
  const plan = summariseChangeEntries("budget", [
    { key: "ad_1", before: 0, after: 5 },
    { key: "ad_2", before: 8, after: 8 },
  ]);
  assert.equal(plan.known.length, 2);
  assert.equal(plan.total, 5);
  assert.equal(plan.changed, 1, "the unchanged row is listed and is not counted as a change");
});

test("a pause review counts the rows that actually move, and an unknown state is not counted", () => {
  const plan = summariseChangeEntries("pause", [
    { key: "ad_1", before: "delivering", after: "paused" },
    { key: "ad_2", before: "paused", after: "paused" },
    { key: "ad_3", before: "", after: "paused" },
  ]);
  assert.equal(plan.entries.length, 3);
  assert.equal(plan.changed, 1, "an already-paused ad is not a row that stops delivering");
  assert.equal(plan.unknown.length, 1, "a row whose state this read did not carry is unknown");
  assert.equal(plan.total, 1);
});

/* ------------------------------------------------- draft lifecycle --- */

const launchDraft = (over = {}) => ({
  kind: "launch",
  phase: "staged",
  origin: "live",
  title: "Spring launch",
  plan: {
    rows: [
      { adId: "ad_1", creativeVersionId: "crv_a", headline: "One", body: "", destination: "https://example.test/1", trackingKey: "ad_1" },
      { adId: "ad_2", creativeVersionId: "crv_b", headline: "Two", body: "", destination: "https://example.test/2", trackingKey: "ad_2" },
    ],
  },
  changes: { rows: [] },
  ...over,
});

const changeDraft = (over = {}) => ({
  kind: "budget",
  phase: "staged",
  origin: "live",
  title: "+10% budget",
  plan: { rows: [] },
  changes: {
    rows: [
      { key: "cmp_001", name: "Spring launch", level: "campaign", state: "delivering", before: 10, after: 11 },
      { key: "cmp_002", name: "Always on", level: "campaign", state: "delivering", before: 20, after: 22 },
    ],
  },
  ...over,
});

test("an approval is bound to one exact plan: the digest the queue records is the plan's digest", () => {
  const draft = launchDraft();
  assert.equal(draftDigest(draft), planDigest(draft.plan.rows), "the queue approves against planDigest(plan.rows)");

  const approved = { ...draft, approvedAt: "2026-09-14T09:00:00.000Z", approvedDigest: draftDigest(draft) };
  assert.equal(approvalStatus(approved).status, "approved");

  // The same ads in another order are the same plan.
  const reordered = { ...approved, plan: { rows: [draft.plan.rows[1], draft.plan.rows[0]] } };
  assert.equal(approvalStatus(reordered).status, "approved", "reordering is not a change of plan");

  // Editing a planned ad is: the approval no longer describes what would run.
  const edited = {
    ...approved,
    plan: { rows: [{ ...draft.plan.rows[0], headline: "One, rewritten" }, draft.plan.rows[1]] },
  };
  const stale = approvalStatus(edited);
  assert.equal(stale.status, "stale");
  assert.match(stale.reason, /changed after it was approved/);

  // Adding an ad is a change too.
  const grown = { ...approved, plan: { rows: [...draft.plan.rows, { ...draft.plan.rows[0], adId: "ad_3" }] } };
  assert.equal(approvalStatus(grown).status, "stale");
});

test("an approval with no digest, and no approval at all, are different answers", () => {
  const draft = launchDraft();
  const none = approvalStatus(draft);
  assert.equal(none.status, "none");
  assert.equal(none.digest, draftDigest(draft), "the digest is still computed, so it can be approved now");

  const undigested = approvalStatus({ ...draft, approvedAt: "2026-09-14T09:00:00.000Z" });
  assert.equal(undigested.status, "undigested");
  assert.match(undigested.reason, /nothing to check the approval against/);
});

test("a budget change is approved against its rows, and a rename does not break that approval", () => {
  const draft = changeDraft();
  const digest = draftDigest(draft);
  const approved = { ...draft, approvedAt: "2026-09-14T09:00:00.000Z", approvedDigest: digest };
  assert.equal(approvalStatus(approved).status, "approved");

  // A label change is not a change of what would happen.
  const renamed = {
    ...approved,
    changes: { rows: draft.changes.rows.map((r) => ({ ...r, name: `${r.name} (renamed in Ads Manager)` })) },
  };
  assert.equal(approvalStatus(renamed).status, "approved", "renaming a row must not expire an approval");

  // A change of amount is.
  const reamounted = {
    ...approved,
    changes: { rows: draft.changes.rows.map((r, index) => (index === 0 ? { ...r, after: r.after + 1 } : r)) },
  };
  assert.equal(approvalStatus(reamounted).status, "stale");

  // So is dropping or adding a covered row.
  assert.equal(approvalStatus({ ...approved, changes: { rows: [draft.changes.rows[0]] } }).status, "stale");
});

test("the queue's phases are the model's phases, and the provider's two are read-only", () => {
  assert.equal(queuePhaseLabel({ phase: "editing", origin: "live" }).label, "Draft (unsaved)");
  assert.equal(queuePhaseLabel({ phase: "editing", origin: "live", savedAt: "2026-09-14T09:00:00.000Z" }).label, "Saved draft");
  assert.equal(queuePhaseLabel({ phase: "staged", origin: "live" }).label, "Staged in Frank");
  assert.equal(queuePhaseLabel({ phase: "approved", origin: "live" }).label, "Approved");

  const submitted = queuePhaseLabel({ phase: "submitted", origin: "live" });
  assert.equal(submitted.label, "Submitted to Meta");
  assert.equal(submitted.readOnly, true);
  assert.equal(submitted.settable, false, "nothing in this browser may claim Meta accepted a write");
  const delivering = queuePhaseLabel({ phase: "delivering", origin: "live" });
  assert.equal(delivering.label, "Delivering");
  assert.equal(delivering.readOnly, true);
  assert.equal(delivering.settable, false);

  for (const phase of ["editing", "staged", "approved"]) {
    const info = queuePhaseLabel({ phase, origin: "live" });
    assert.equal(info.readOnly, false);
    assert.equal(info.settable, true, `${phase} is a local phase this browser may move`);
  }
});

test("a rehearsal draft is labelled as one and can never be presented as sendable", () => {
  const rehearsal = queuePhaseLabel({ phase: "staged", origin: "preview" });
  assert.match(rehearsal.label, /^Local rehearsal/);
  assert.equal(rehearsal.rehearsal, true);
  assert.match(rehearsal.reason, /never be sent/);
  assert.equal(queuePhaseLabel({ phase: "delivering", origin: "preview" }).readOnly, true);
});

test("a phase this build does not know is repeated as-is, not guessed at", () => {
  const info = queuePhaseLabel({ phase: "escalated_to_legal", origin: "live" });
  assert.equal(info.label, "escalated_to_legal");
  assert.equal(info.readOnly, false);
  assert.equal(info.settable, false, "an unknown phase is not one this browser may set");
  assert.equal(queuePhaseLabel({}).label, "Phase unknown");
  assert.equal(queuePhaseLabel(null).label, "Phase unknown");
});
