// The draft model's lifecycle rules.
//
// These are the rules that decide whether a person's work survives: what a save
// does to a revision, what happens when two copies of the same draft are open,
// which states this browser is allowed to reach on its own, and what a browser
// that refuses to store is allowed to claim. Rule-level, no browser.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_STORAGE_KEY,
  LEGACY_DRAFT_STORAGE_KEYS,
  LOCAL_PHASES,
  PROVIDER_PHASES,
  createAdsDrafts,
  draftScope,
  normalizeDraft,
  phaseLabel,
} from "../web/js/ads/ads-drafts.js";
import { planDigest, reconcilePlanRows } from "../web/js/ads/ads-identity.js";

/** A localStorage stand-in, including the two ways a real one disappoints you. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    failNext: false,
    quota: false,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("storage is unavailable");
      }
      if (this.quota || String(value).length > 1_000_000) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function launchDraft(over = {}) {
  const rows = reconcilePlanRows([], [
    { creativeVersionId: "crvv_a", creativeKey: "crvv_a", headline: "One", body: "", destination: "https://example.test/one" },
    { creativeVersionId: "crvv_a", creativeKey: "crvv_a", headline: "Two", body: "", destination: "https://example.test/two" },
  ]);
  return {
    kind: "launch",
    title: "Spring",
    campaign: { campaignId: "cmp_fixed", name: "Spring" },
    plan: { total: rows.length, rows },
    ...over,
  };
}

function store(over = {}) {
  return createAdsDrafts({ storage: fakeStorage(), origin: "live", now: () => new Date(2026, 8, 14, 10, 0, 0).toISOString(), ...over });
}

/* ------------------------------------------------------------- revisions --- */

test("a save bumps the revision and records what changed, in order", () => {
  const drafts = store();
  const first = drafts.save(launchDraft());
  assert.equal(first.revision, 1);
  assert.equal(first.phase, "editing");
  assert.equal(first.history.length, 1);

  const second = drafts.save({ ...first, title: "Spring (edited)" }, { id: first.id });
  assert.equal(second.id, first.id, "an edit keeps the draft's identity");
  assert.equal(second.revision, 2);
  assert.deepEqual(second.history.map((entry) => entry.revision), [1, 2]);
  assert.ok(second.savedAt, "a saved draft states when it was saved");

  // A draft that was never saved is not the same thing as a saved one.
  const fresh = normalizeDraft(launchDraft());
  assert.equal(fresh.revision, 1);
  assert.equal(fresh.savedAt, "");
});

test("staging and unstaging are phases, and the stored state follows", () => {
  const drafts = store();
  const draft = drafts.save(launchDraft());
  assert.equal(drafts.stage(draft.id).phase, "staged");
  assert.equal(drafts.get(draft.id).state, "queued");
  assert.equal(drafts.staged().length, 1);
  assert.equal(drafts.unfinished().length, 0);

  assert.equal(drafts.unstage(draft.id).phase, "editing");
  assert.equal(drafts.staged().length, 0);
  assert.equal(drafts.unfinished().length, 1, "an unstaged draft is recoverable work again");
});

test("this browser can approve, and cannot claim anything past that", () => {
  const drafts = store();
  const draft = drafts.stage(drafts.save(launchDraft()).id);
  const digest = planDigest(draft.plan.rows);
  const approved = drafts.approve(draft.id, { digest });
  assert.equal(approved.phase, "approved");
  assert.equal(approved.approvedDigest, digest);
  assert.ok(approved.approvedAt);

  // A local phase is the only thing `phase()` will reach.
  for (const phase of PROVIDER_PHASES) {
    assert.equal(drafts.phase(draft.id, phase), null, `${phase} must not be reachable from the browser`);
  }
  assert.deepEqual(LOCAL_PHASES, ["editing", "staged", "approved"]);
});

test("a provider state is only recorded when something outside the browser says so", () => {
  const drafts = store();
  const draft = drafts.stage(drafts.save(launchDraft()).id);
  assert.equal(drafts.applyProviderState(draft.id, { phase: "editing" }), null, "a provider setter may not move a local phase");
  const submitted = drafts.applyProviderState(draft.id, { phase: "submitted", providerId: "act_1/ad/9", providerState: "PAUSED" });
  assert.equal(submitted.phase, "submitted");
  assert.equal(submitted.providerId, "act_1/ad/9");
  assert.ok(submitted.submittedAt);
});

test("an approval stops describing the plan the moment the plan changes", () => {
  const drafts = store();
  const draft = drafts.stage(drafts.save(launchDraft()).id);
  const digest = planDigest(draft.plan.rows);
  drafts.approve(draft.id, { digest });

  const edited = drafts.save(
    { ...drafts.get(draft.id), plan: { ...drafts.get(draft.id).plan, rows: [{ ...draft.plan.rows[0], headline: "Changed after approval" }] } },
    { id: draft.id },
  );
  const stored = drafts.get(edited.id);
  assert.equal(stored.approvedDigest, digest, "the old approval is kept as a record of what was approved");
  assert.notEqual(planDigest(stored.plan.rows), stored.approvedDigest, "and it no longer matches the plan on screen");
});

/* -------------------------------------------------------------- conflicts --- */

test("a save built on a stale revision is refused, and names both revisions", () => {
  const drafts = store();
  const draft = drafts.save(launchDraft());

  // Two screens open the same draft.
  const mine = { ...draft };
  const theirs = drafts.save({ ...draft, title: "Theirs" }, { id: draft.id });
  assert.equal(theirs.revision, 2);

  const refused = drafts.saveGuarded({ ...mine, title: "Mine" }, { id: mine.id, baseRevision: mine.revision });
  assert.equal(refused.ok, false);
  assert.equal(refused.conflict.expectedRevision, 1);
  assert.equal(refused.conflict.actualRevision, 2);
  assert.equal(refused.conflict.draft.title, "Theirs");
  assert.equal(drafts.get(draft.id).title, "Theirs", "the refused save changed nothing");

  // Once the screen adopts the newer revision, the save goes through.
  const accepted = drafts.saveGuarded({ ...mine, title: "Mine, deliberately" }, { id: mine.id, baseRevision: 2 });
  assert.equal(accepted.ok, true);
  assert.equal(drafts.get(draft.id).title, "Mine, deliberately");
  assert.equal(drafts.get(draft.id).revision, 3);
});

/* --------------------------------------------------------------- recovery --- */

test("a record that cannot be read is counted, not silently dropped", () => {
  const payload = JSON.stringify([{ kind: "launch", id: "draft_ok", plan: { total: 0, rows: [] } }, { kind: "nonsense" }, null]);
  const drafts = createAdsDrafts({ storage: fakeStorage({ [DRAFT_STORAGE_KEY]: payload }), origin: "live" });
  assert.equal(drafts.list().length, 1);
  assert.equal(drafts.diagnostics.discarded, 2);
});

test("a record written by the previous build is migrated forward, not dropped", () => {
  const legacy = JSON.stringify([
    { id: "draft_old", kind: "launch", approval: "staged", state: "queued", title: "Older build", plan: { total: 1, rows: [{ creativeKey: "crv", headline: "h" }] } },
  ]);
  const storage = fakeStorage({ [LEGACY_DRAFT_STORAGE_KEYS[0]]: legacy });
  const drafts = createAdsDrafts({ storage, origin: "live" });
  const migrated = drafts.list();
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].phase, "staged", "a staged draft stays staged across the upgrade");
  assert.ok(migrated[0].plan.rows[0].adId, "and its rows get the identities they were missing");
  assert.ok(storage.getItem(DRAFT_STORAGE_KEY), "the migrated record is written to the current key");
});

test("a browser that refuses to store says so instead of claiming a save", () => {
  const storage = fakeStorage();
  const drafts = createAdsDrafts({ storage, origin: "live" });
  const draft = drafts.save(launchDraft());
  assert.equal(drafts.diagnostics.storageError, "");

  storage.quota = true;
  drafts.save({ ...draft, title: "Second" }, { id: draft.id });
  assert.match(drafts.diagnostics.storageError, /full|not being saved|not saving/i);
  // The in-memory copy is still authoritative, so the work is not lost mid-session.
  assert.equal(drafts.get(draft.id).title, "Second");
});

test("the previous payload is kept, and can be put back", () => {
  const storage = fakeStorage();
  const drafts = createAdsDrafts({ storage, origin: "live" });
  const draft = drafts.save(launchDraft());
  drafts.save({ ...draft, title: "Second" }, { id: draft.id });
  assert.ok(storage.getItem(`${DRAFT_STORAGE_KEY}.bak`), "a backup exists before every write");
  assert.equal(drafts.restoreBackup(), true);
  assert.equal(drafts.get(draft.id).title, "Spring", "the backup holds the previous revision");
});

/* ------------------------------------------------------- preview isolation --- */

test("a rehearsal draft is never a live draft, and says which it is", () => {
  const storage = fakeStorage();
  const live = createAdsDrafts({ storage, origin: "live" });
  const preview = createAdsDrafts({ storage, origin: "preview" });

  const staged = preview.stage(preview.save(launchDraft({ origin: "preview", title: "Rehearsal" })).id);
  assert.equal(preview.list().length, 1);
  assert.equal(live.list().length, 0, "a rehearsal must not appear in the live queue");
  assert.equal(live.get(staged.id), null, "nor be readable from it");
  assert.equal(draftScope(staged), "rehearsal");
  assert.match(phaseLabel(staged), /rehearsal/i);

  const real = live.save(launchDraft({ title: "Real" }));
  assert.equal(draftScope(real), "live");
  assert.equal(phaseLabel(real), "Draft");
  assert.equal(phaseLabel(live.stage(real.id)), "Staged in Frank");
  assert.equal(phaseLabel(live.approve(real.id, { digest: planDigest(real.plan.rows) })), "Approved");
});

test("a record cannot smuggle itself onto the other side of the preview line", () => {
  const storage = fakeStorage();
  const preview = createAdsDrafts({ storage, origin: "preview" });
  const live = createAdsDrafts({ storage, origin: "live" });
  // A rehearsal saved by the preview build keeps its own origin even when the
  // live build is the one reading the storage.
  const rehearsal = preview.save(launchDraft({ origin: "preview" }));
  assert.equal(live.get(rehearsal.id, { scope: "preview" }), null, "the live store never reaches into rehearsals");
  assert.equal(preview.get(rehearsal.id).origin, "preview");
  assert.equal(
    live.list().concat(preview.list()).filter((draft) => draft.id === rehearsal.id).length,
    1,
    "one record, on one side",
  );
});
