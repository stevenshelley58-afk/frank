import test from "node:test";
import assert from "node:assert/strict";

import { createMiniApi } from "../web/mini/mini_api.mjs";

test("claimed mutations include bearer access and an idempotency key", async () => {
  const calls = [];
  const api = createMiniApi({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(JSON.stringify({ job: { id: "job-1" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  await api.changeJob({ id: "job-1", claim: "claim-token" }, "Make it clearer");

  assert.equal(calls[0].options.headers["X-Mini-Claim"], "claim-token");
  assert.equal(calls[0].options.headers.Authorization, "Bearer claim-token");
  assert.match(calls[0].options.headers["Idempotency-Key"], /^mini-/);
  assert.equal(JSON.parse(calls[0].options.body).change, "Make it clearer");
});

test("a mutation deadline becomes a recoverable deadline error", async () => {
  const api = createMiniApi({
    deadlineMs: 5,
    fetchImpl: (_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  await assert.rejects(
    api.deleteJob({ id: "job-1", claim: "claim-token" }),
    (error) => error.code === "deadline_exceeded" && error.name === "DeadlineError",
  );
});

test("feedback and revoke use the published lifecycle routes and shapes", async () => {
  const calls = [];
  const api = createMiniApi({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(JSON.stringify({ job: { id: "job-1" } }), { status: 200 });
    },
  });

  await api.feedbackJob({ id: "job-1", claim: "claim-token" }, { rating: "not_yet", reason: "missing_piece" });
  await api.revokeJob({ id: "job-1", claim: "claim-token" });

  assert.equal(calls[0].path, "/api/mini/jobs/job-1/feedback");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { rating: "not_yet", reason: "missing_piece" });
  assert.equal(calls[1].path, "/api/mini/jobs/job-1/revoke");
  assert.equal(calls[1].options.method, "POST");
  assert.match(calls[1].options.headers["Idempotency-Key"], /^mini-/);
});
