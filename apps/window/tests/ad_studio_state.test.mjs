import assert from "node:assert/strict";
import test from "node:test";
import { mergeAdStudioRun, mergeAdStudioRunList, mergeIterationHistory, runListRenderSignature } from "../web/js/ad-studio-state.js";

test("a thin run-list refresh cannot erase populated iteration history", () => {
  const detailed = {
    id: "trun-history",
    status: "running",
    stage: "compare",
    updated_at: 10,
    source: { name: "source.png", url: "/source.png" },
    output: {
      iterations: [{ iteration: 1, decision: "revise", comparison: { score: 8.7, reason: "spacing" }, previews: [{ name: "feed.png", url: "/feed.png" }] }],
      previews: [{ name: "latest.png", url: "/latest.png" }],
    },
  };
  const summary = { id: "trun-history", status: "completed", stage: "live", updated_at: 11, output: {} };

  const merged = mergeAdStudioRun(detailed, summary);

  assert.equal(merged.status, "completed");
  assert.equal(merged.output.iterations.length, 1);
  assert.equal(merged.output.iterations[0].comparison.score, 8.7);
  assert.equal(merged.output.iterations[0].previews[0].url, "/feed.png");
  assert.equal(merged.output.previews[0].url, "/latest.png");
  assert.equal(merged.source.url, "/source.png");
});

test("iteration event snapshots enrich history without dropping earlier evidence", () => {
  const history = mergeIterationHistory(
    [{ iteration: 1, comparison: { score: 8.1, reason: "first" }, previews: [{ url: "/one.png" }] }],
    [{ iteration: 1, comparison: { score: 9.2 } }, { iteration: 2, comparison: { score: 9.6 } }],
  );

  assert.deepEqual(history.map((record) => record.iteration), [1, 2]);
  assert.equal(history[0].comparison.reason, "first");
  assert.equal(history[0].comparison.score, 9.2);
  assert.equal(history[0].previews[0].url, "/one.png");
});

test("terminal replay followed by a thin list refresh keeps recorded iterations", () => {
  const selected = { id: "trun-terminal", status: "running", updated_at: 30, output: {} };
  const afterReplay = mergeAdStudioRun(selected, {
    id: "trun-terminal",
    status: "running",
    updated_at: 31,
    output: { iterations: [{ iteration: 1, decision: "revise", comparison: { score: 8.9 } }] },
  });
  const afterTerminalRefresh = mergeAdStudioRun(afterReplay, { id: "trun-terminal", status: "failed", updated_at: 32, output: {} });

  assert.equal(afterTerminalRefresh.status, "failed");
  assert.equal(afterTerminalRefresh.output.iterations.length, 1);
  assert.equal(afterTerminalRefresh.output.iterations[0].comparison.score, 8.9);
});

test("an older polling response cannot regress current run state", () => {
  const current = { id: "trun-history", status: "completed", stage: "live", updated_at: 20, source: { url: "/current.png" }, output: { iterations: [{ iteration: 1, comparison: { score: 9.6 } }] } };
  const stale = { id: "trun-history", status: "running", stage: "render", updated_at: 15, source: { url: "" }, output: { iterations: [{ iteration: 1, comparison: { score: 8.2 } }] } };

  const merged = mergeAdStudioRun(current, stale);

  assert.equal(merged.status, "completed");
  assert.equal(merged.stage, "live");
  assert.equal(merged.source.url, "/current.png");
  assert.equal(merged.output.iterations[0].comparison.score, 9.6);
  assert.equal(merged.output.iterations.length, 1);
});

test("an equal-second delayed snapshot cannot overwrite event-derived state", () => {
  const eventState = {
    id: "trun-equal",
    status: "running",
    stage: "compare",
    progress: 0.7,
    updated_at: 40,
    output: { iterations: [{ iteration: 1, decision: "accepted", comparison: { score: 9.8 }, previews: [{ url: "/current.png" }] }] },
  };
  const delayed = {
    id: "trun-equal",
    status: "running",
    stage: "render",
    progress: 0.4,
    updated_at: 40,
    output: { iterations: [{ iteration: 1, decision: "revise", comparison: { score: 8.0 }, previews: [{ url: "/stale.png" }] }] },
  };

  const merged = mergeAdStudioRun(eventState, delayed);

  assert.equal(merged.stage, "compare");
  assert.equal(merged.progress, 0.7);
  assert.equal(merged.output.iterations[0].decision, "accepted");
  assert.equal(merged.output.iterations[0].comparison.score, 9.8);
  assert.equal(merged.output.iterations[0].previews[0].url, "/current.png");
});

test("an equal-second terminal summary can still advance status", () => {
  const running = { id: "trun-terminal", status: "running", stage: "compare", updated_at: 50, output: { iterations: [{ iteration: 1 }] } };
  const failed = { id: "trun-terminal", status: "failed", stage: "compare", updated_at: 50, output: {} };

  const merged = mergeAdStudioRun(running, failed);

  assert.equal(merged.status, "failed");
  assert.equal(merged.output.iterations.length, 1);
});

test("rich detail changes do not force an unchanged run-list DOM rebuild", () => {
  const before = [{ id: "trun-history", title: "History", project_id: "blockwise", status: "running", updated_at: 120, output: {} }];
  const after = [{ ...before[0], updated_at: 150, output: { iterations: [{ iteration: 1 }] } }];

  assert.equal(runListRenderSignature(after), runListRenderSignature(before));
  assert.notEqual(runListRenderSignature([{ ...after[0], status: "completed" }]), runListRenderSignature(before));
  assert.notEqual(runListRenderSignature([{ ...after[0], updated_at: 181 }]), runListRenderSignature(before));
});

test("an empty polling snapshot cannot erase durable run history", () => {
  const before = [{ id: "trun-kept", status: "running", created_at: 20, output: { iterations: [{ iteration: 1 }] } }];

  const merged = mergeAdStudioRunList(before, []);

  assert.deepEqual(merged, before);
});

test("a truncated polling page updates returned runs without dropping an older selected run", () => {
  const before = [
    { id: "trun-new", status: "running", created_at: 20 },
    { id: "trun-selected", status: "completed", created_at: 10, output: { iterations: [{ iteration: 1 }] } },
  ];

  const merged = mergeAdStudioRunList(before, [{ id: "trun-new", status: "completed", created_at: 20, updated_at: 30 }]);

  assert.deepEqual(merged.map((run) => run.id), ["trun-new", "trun-selected"]);
  assert.equal(merged[0].status, "completed");
  assert.equal(merged[1].output.iterations.length, 1);
});

test("frozen model roles survive a thin refresh", () => {
  const before = [{
    id: "trun-models", status: "running", updated_at: 10,
    model_profile: { source: "Hermes frozen run policy", roles: [{ role: "builder", provider: "openai-codex", model: "gpt-5.6-sol" }] },
  }];

  const [merged] = mergeAdStudioRunList(before, [{ id: "trun-models", status: "running", updated_at: 11 }]);

  assert.equal(merged.model_profile.roles[0].model, "gpt-5.6-sol");
});
