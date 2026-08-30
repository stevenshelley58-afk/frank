import test from "node:test";
import assert from "node:assert/strict";

import { createMiniApi } from "../web/mini/mini_api.mjs";

function recordingApi(body = {}) {
  const calls = [];
  const api = createMiniApi({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  return { api, calls };
}

test("claimed versioned mutations carry owner access, idempotency and base_version", async () => {
  const { api, calls } = recordingApi({ job: { id: "job-1" } });
  await api.changeJob(
    { id: "job-1", claim: "job-claim-token" },
    "Make it clearer",
    [],
    { baseVersion: 7, idempotencyKey: "change-1" },
  );

  assert.equal(calls[0].options.headers["X-Mini-Claim"], "job-claim-token");
  assert.equal(calls[0].options.headers.Authorization, "Bearer job-claim-token");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "change-1");
  assert.equal(calls[0].options.headers["X-Mini-Base-Version"], "7");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    change: "Make it clearer",
    attachment_ids: [],
    base_version: 7,
  });
});

test("opaque account continuity is sent only when creating the next intake", async () => {
  const { api, calls } = recordingApi({ intake: { id: "intake-1" } });
  const accountClaim = "ma1.cGF5bG9hZC0xMjM0NTY.sig_abcdefghijklmnopqrstuvwxyz";

  await api.createIntake([], { accountClaim });
  await api.readJob({ id: "job-1", claim: "job-claim-token" });

  assert.equal(calls[0].path, "/api/mini/intakes");
  assert.equal(calls[0].options.headers["X-Mini-Account-Claim"], accountClaim);
  assert.equal(calls[0].options.headers["X-Mini-Claim"], undefined);
  assert.equal(calls[1].options.headers["X-Mini-Account-Claim"], undefined);
  assert.equal(calls[1].options.headers["X-Mini-Claim"], "job-claim-token");
});

test("sharing transport matches the deterministic sharing and bearer routes", async () => {
  const { api, calls } = recordingApi({ sharing: { version: 4 } });
  const access = { id: "job-1", claim: "job-claim-token" };

  await api.readSharing(access);
  await api.updateSharing(access, { mode: "published", role: "viewer", scope: "result" }, { baseVersion: 4 });
  await api.createShare(access, { role: "commenter", scope: "project" }, { baseVersion: 5 });
  await api.rotateShare(access, "shr-1", { baseVersion: 6 });
  await api.revokeShare(access, "shr-1", { baseVersion: 7 });

  assert.deepEqual(calls.map(({ path, options }) => [options.method, path]), [
    ["GET", "/api/mini/jobs/job-1/sharing"],
    ["PATCH", "/api/mini/jobs/job-1/sharing"],
    ["POST", "/api/mini/jobs/job-1/shares"],
    ["POST", "/api/mini/jobs/job-1/shares/shr-1/rotate"],
    ["DELETE", "/api/mini/jobs/job-1/shares/shr-1"],
  ]);
  assert.deepEqual(JSON.parse(calls[2].options.body), { role: "commenter", scope: "project", base_version: 5 });
  assert.equal(JSON.parse(calls[4].options.body).base_version, 7);
});

test("public share/comment transport never attaches an owner claim", async () => {
  const { api, calls } = recordingApi({ shared: { result: {} } });
  await api.readShared("ms1_public-token");
  await api.readPublished("job-1");
  await api.readSharedComments("ms1_public-token");
  await api.createSharedComment("ms1_public-token", { text: "Looks good", kind: "comment" }, { baseVersion: 2 });

  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/mini/shares/ms1_public-token",
    "/api/mini/published/job-1",
    "/api/mini/shares/ms1_public-token/comments",
    "/api/mini/shares/ms1_public-token/comments",
  ]);
  calls.forEach(({ options }) => {
    assert.equal(options.headers["X-Mini-Claim"], undefined);
    assert.equal(options.headers.Authorization, undefined);
  });
});

test("tips and reviewed service requests use the shipped routes and authority-safe shape", async () => {
  const { api, calls } = recordingApi({ intent: { status: "ready" } });
  const access = { id: "job-1", claim: "job-claim-token" };

  await api.tipConfig();
  await api.createTip({});
  await api.createJobTip(access, {});
  await api.readServiceOptions(access);
  await api.readServiceRequests(access);
  await api.createServiceRequest(access, {
    kind: "video_call",
    owner_reviewed: true,
    note: "Reviewed handoff",
    contact: { method: "email", value: "owner@example.com" },
  });

  assert.deepEqual(calls.map(({ path, options }) => [options.method, path]), [
    ["GET", "/api/mini/tips/config"],
    ["POST", "/api/mini/tips/intents"],
    ["POST", "/api/mini/jobs/job-1/tips/intents"],
    ["GET", "/api/mini/jobs/job-1/service-options"],
    ["GET", "/api/mini/jobs/job-1/service-requests"],
    ["POST", "/api/mini/jobs/job-1/service-requests"],
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {});
  assert.deepEqual(JSON.parse(calls[5].options.body), {
    kind: "video_call",
    owner_reviewed: true,
    note: "Reviewed handoff",
    contact: { method: "email", value: "owner@example.com" },
  });
});

test("a mutation deadline remains a recoverable transport error", async () => {
  const api = createMiniApi({
    deadlineMs: 5,
    fetchImpl: (_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  await assert.rejects(
    api.deleteJob({ id: "job-1", claim: "job-claim-token" }),
    (error) => error.code === "deadline_exceeded" && error.name === "DeadlineError",
  );
});
