import test from "node:test";
import assert from "node:assert/strict";

import { createReplayKeyTracker } from "../web/mini/mini_retry.mjs";

test("a lost response reuses the key for the same material command", () => {
  let sequence = 0;
  const tracker = createReplayKeyTracker(() => `key-${++sequence}`);
  const payload = JSON.stringify({ job: "job-1", kind: "video_call", note: "Reviewed" });

  const firstAttempt = tracker.keyFor(payload);
  // Simulate an ambiguous network failure: there is deliberately no confirm.
  const retryAttempt = tracker.keyFor(payload);

  assert.equal(firstAttempt, "key-1");
  assert.equal(retryAttempt, firstAttempt);
});

test("material edits and confirmed success each start a fresh command", () => {
  let sequence = 0;
  const tracker = createReplayKeyTracker(() => `key-${++sequence}`);
  const original = JSON.stringify({ text: "Looks good", kind: "comment" });
  const edited = JSON.stringify({ text: "Please change the heading", kind: "suggestion" });

  assert.equal(tracker.keyFor(original), "key-1");
  assert.equal(tracker.keyFor(edited), "key-2");
  tracker.confirm(edited);
  assert.equal(tracker.keyFor(edited), "key-3");
  tracker.reset();
  assert.equal(tracker.keyFor(edited), "key-4");
});
