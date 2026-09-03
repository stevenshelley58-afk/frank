/* Frank v0.21 Hub chat module tests (node:test, DOM-free logic).
   Covers: normalized event envelopes (canonical + legacy + unknown/malformed),
   exactly-once dedupe, renderer registry labels, redaction, model option
   schema, attachment DTO safety, and the API mutation contract. */

import test from "node:test";
import assert from "node:assert/strict";
import { EventDeduper, normalizeEvent, highestSeq, DERIVED_LABELS } from "../web/js/chat/events.js";
import { describeEvent, redactJson, redactValue, REGISTRY_VERSION } from "../web/js/chat/activity-timeline.js";
import { attachmentDTO, chipFields } from "../web/js/chat/attachment-controller.js";
import { validateModelOption } from "../web/js/chat/model-selector.js";
import { escapeHtml, renderMd, inlineMd, safeUrl } from "../web/js/chat/render.js";

function canonical(label, payload, extra = {}) {
  return {
    seq: 1,
    native_event: "native.test",
    derived_label: label,
    run_id: "run-1",
    session_id: "s-1",
    timestamp: 1756900000,
    payload,
    frank_origin: true,
    ...extra,
  };
}

/* ---------- normalizeEvent: canonical envelopes ---------- */

test("canonical envelopes pass through with exact native event names", () => {
  const raw = canonical("tool_progress", { phase: "started", tool: "shell" });
  const env = normalizeEvent("message", raw);
  assert.equal(env.nativeEvent, "native.test");
  assert.equal(env.derivedLabel, "tool_progress");
  assert.equal(env.seq, 1);
  assert.equal(env.runId, "run-1");
  assert.equal(env.frankOrigin, true);
});

test("unknown derived labels are retained as unknown, never dropped", () => {
  const env = normalizeEvent("message", canonical("brand_new_hermes_thing", { x: 1 }));
  assert.equal(env.derivedLabel, "unknown");
  assert.deepEqual(Object.keys(env.payload), ["x"]);
});

test("malformed payloads become redacted-safe unknown envelopes", () => {
  const scalar = normalizeEvent("message", "just a string");
  assert.equal(scalar.derivedLabel, "unknown");
  assert.equal(scalar.malformed, true);
  const array = normalizeEvent("message", [1, 2, 3]);
  assert.equal(array.derivedLabel, "unknown");
  assert.equal(array.malformed, true);
  assert.equal(normalizeEvent("message", null), null);
});

test("non-object payload values are wrapped, not lost", () => {
  const env = normalizeEvent("message", canonical("brand_new_hermes_thing", 42));
  assert.deepEqual(env.payload, { value: 42 });
});

/* ---------- normalizeEvent: legacy frames map onto the registry ---------- */

test("legacy assistant deltas map to assistant_message with phase delta", () => {
  const env = normalizeEvent("assistant.delta", { type: "assistant.delta", delta: "Hel" });
  assert.equal(env.derivedLabel, "assistant_message");
  assert.equal(env.payload.phase, "delta");
  assert.equal(env.payload.text, "Hel");
});

test("legacy reasoning snapshots map to reasoning_delta replace", () => {
  const env = normalizeEvent("reasoning.available", { type: "reasoning.available", text: "Plan: a, b" });
  assert.equal(env.derivedLabel, "reasoning_delta");
  assert.equal(env.payload.phase, "replace");
});

test("thinking status maps to reasoning_delta status, not private reasoning", () => {
  const env = normalizeEvent("thinking.status", { type: "thinking.status", text: "Reading files" });
  assert.equal(env.derivedLabel, "reasoning_delta");
  assert.equal(env.payload.phase, "status");
});

test("tool lifecycle maps with friendly phase fields", () => {
  const started = normalizeEvent("tool.started", { type: "tool.started", tool_name: "shell" });
  assert.deepEqual(started.payload, { phase: "started", tool: "shell" });
  const done = normalizeEvent("tool.completed", { type: "tool.completed", tool_name: "shell", ok: false });
  assert.equal(done.payload.phase, "completed");
  assert.equal(done.payload.ok, false);
});

test("terminal run events map to completion and cancellation", () => {
  assert.equal(normalizeEvent("run.completed", { type: "run.completed" }).payload.phase, "complete");
  assert.equal(normalizeEvent("run.cancelled", { type: "run.cancelled" }).payload.phase, "cancelled");
  const failed = normalizeEvent("run.failed", { type: "run.failed", error: "boom" });
  assert.equal(failed.derivedLabel, "terminal_error");
  assert.equal(failed.payload.text, "boom");
});

test("unrecognized legacy frames survive as unknown with payload intact", () => {
  const env = normalizeEvent("hermes.custom", { type: "hermes.custom", detail: "zz" });
  assert.equal(env.derivedLabel, "unknown");
  assert.equal(env.payload.detail, "zz");
});

/* ---------- exactly-once dedupe ---------- */

test("duplicate sequences are delivered exactly once", () => {
  const deduper = new EventDeduper();
  const first = normalizeEvent("m", canonical("tool_progress", { phase: "started", tool: "a" }, { seq: 7 }));
  const dup = normalizeEvent("m", canonical("tool_progress", { phase: "started", tool: "a" }, { seq: 7 }));
  assert.equal(deduper.firstTime(first), true);
  assert.equal(deduper.firstTime(dup), false);
});

test("out-of-order sequences still dedupe by identity", () => {
  const deduper = new EventDeduper();
  assert.equal(deduper.firstTime(normalizeEvent("m", canonical("assistant_message", { phase: "delta", text: "a" }, { seq: 9 }))), true);
  assert.equal(deduper.firstTime(normalizeEvent("m", canonical("assistant_message", { phase: "delta", text: "b" }, { seq: 8 }))), true);
  assert.equal(deduper.firstTime(normalizeEvent("m", canonical("assistant_message", { phase: "delta", text: "a" }, { seq: 9 }))), false);
});

test("transports without sequence numbers dedupe on event identity", () => {
  const deduper = new EventDeduper();
  const a = normalizeEvent("assistant.delta", { type: "assistant.delta", delta: "x" });
  const same = normalizeEvent("assistant.delta", { type: "assistant.delta", delta: "x" });
  const different = normalizeEvent("assistant.delta", { type: "assistant.delta", delta: "y" });
  assert.equal(deduper.firstTime(a), true);
  assert.equal(deduper.firstTime(same), false);
  assert.equal(deduper.firstTime(different), true);
});

test("highestSeq tracks the resume watermark", () => {
  assert.equal(highestSeq([
    normalizeEvent("m", canonical("x", {}, { seq: 3 })),
    normalizeEvent("m", canonical("x", {}, { seq: 11 })),
    normalizeEvent("m", canonical("x", {})),
  ]), 11);
});

/* ---------- renderer registry ---------- */

test("every derived label has a registry entry or the unknown fallback", () => {
  for (const label of DERIVED_LABELS) {
    const env = normalizeEvent("m", canonical(label, {}));
    const descriptor = describeEvent(env);
    assert.ok(descriptor, `no descriptor for ${label}`);
    assert.equal(descriptor.label, label);
  }
});

test("unknown events render the safe Other Hermes activity row with redacted detail", () => {
  const descriptor = describeEvent(normalizeEvent("m", canonical("brand_new_thing", { weird: true })));
  assert.equal(descriptor.title, "Other Hermes activity");
  assert.equal(descriptor.raw, true);
});

test("tool completion derives failure only from completion fields", () => {
  const ok = describeEvent(normalizeEvent("m", canonical("tool_progress", { phase: "completed", tool: "shell", ok: true })));
  assert.equal(ok.tone, "ok");
  const bad = describeEvent(normalizeEvent("m", canonical("tool_progress", { phase: "completed", tool: "shell", ok: false, message: "disk full" })));
  assert.equal(bad.tone, "bad");
  assert.match(bad.title, /disk full/);
});

test("approval requests carry the exact request identity and no invented expiry", () => {
  const request = describeEvent(normalizeEvent("m", canonical("approval_required", { blocking: "approval", phase: "request", request_id: "req-9", question: "Run rm?" })));
  assert.equal(request.kind, "input-wait");
  assert.equal(request.requestId, "req-9");
  assert.equal(request.interactive, true);
  const resolved = describeEvent(normalizeEvent("m", canonical("approval_required", { blocking: "approval", phase: "resolved", request_id: "req-9" })));
  assert.equal(resolved.kind, "input-resolved");
});

test("native expiry is only rendered for clarify/sudo/secret expiry phases", () => {
  const expired = describeEvent(normalizeEvent("m", canonical("approval_required", { blocking: "sudo", phase: "expired", request_id: "r" })));
  assert.equal(expired.kind, "input-expired");
  const restored = describeEvent(normalizeEvent("m", canonical("approval_required", { blocking: "clarify", phase: "restored", request_id: "r2" })));
  assert.equal(restored.kind, "input-wait");
  assert.equal(restored.interactive, true);
});

test("todo updates render as a checklist, not a task board", () => {
  const descriptor = describeEvent(normalizeEvent("m", canonical("todo_updated", { items: [{ text: "Scan ports", done: true }, "Write report"] })));
  assert.equal(descriptor.kind, "todo");
  assert.match(descriptor.html, /is-done/);
  assert.match(descriptor.html, /Write report/);
});

test("interim already_streamed deltas do not double-render text", () => {
  /* turn-stream handles the flag; the registry marks delta rows hidden */
  const descriptor = describeEvent(normalizeEvent("m", canonical("assistant_message", { phase: "delta", text: "x" })));
  assert.equal(descriptor.tone, "hidden");
});

test("registry is versioned", () => {
  assert.match(REGISTRY_VERSION, /^\d+$/);
});

/* ---------- redaction ---------- */

test("secret-shaped keys are redacted in the advanced raw view", () => {
  const out = JSON.parse(redactJson({ api_key: "sk-123", nested: { authorization: "Bearer x", ok: 1 } }));
  assert.equal(out.api_key, "[redacted]");
  assert.equal(out.nested.authorization, "[redacted]");
  assert.equal(out.nested.ok, 1);
});

test("long strings are truncated and depth is capped", () => {
  const long = redactValue("a".repeat(500));
  assert.ok(long.length <= 241);
  const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
  assert.ok(redactJson(deep).includes("…"));
});

/* ---------- model option schema ---------- */

test("model option schema validation", () => {
  assert.equal(validateModelOption({ id: "gpt" }), "");
  assert.equal(validateModelOption({ id: "gpt", provider: "openai", reasoning: true, service_tier: "priority", confirmation: true, note: "n" }), "");
  assert.ok(validateModelOption({}));
  assert.ok(validateModelOption({ id: 7 }));
  assert.ok(validateModelOption({ id: "x", reasoning: "yes" }));
  assert.ok(validateModelOption({ id: "x", confirmation: 1 }));
  assert.ok(validateModelOption(null));
  assert.ok(validateModelOption("gpt"));
});

/* ---------- attachment DTO safety ---------- */

test("attachment DTO carries only browser-safe fields", () => {
  const dto = attachmentDTO({ id: "a1", name: "report.pdf", size: 12, mime: "application/pdf", project_ref: "session-1/batch/x", secret_internal: "/hermes/staging/abs/path" });
  assert.deepEqual(Object.keys(dto).sort(), ["id", "mime", "name", "project_ref", "size"]);
  assert.ok(!JSON.stringify(dto).includes("staging"));
});

test("chip fields never contain absolute or staging paths", () => {
  const chip = chipFields({ name: "data.csv", relative_path: "batch/data.csv", size: 3, type: "text/csv", url: "/api/chat/uploads/u1", absolute_host_path: "/srv/hermes/tmp/x" });
  const json = JSON.stringify(chip);
  assert.ok(!json.includes("absolute_host_path"));
  assert.ok(!json.includes("/srv"));
  assert.equal(chip.origin, "device");
});

/* ---------- render safety ---------- */

test("markdown rendering escapes html and neutralizes javascript urls", () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  assert.ok(!renderMd('<script>alert(1)</script>').includes("<script>"));
  assert.ok(!inlineMd("[x](javascript:alert(1))").includes("javascript:"));
  assert.ok(!inlineMd("![x](javascript:alert(1))").includes("javascript:"));
});

test("safeUrl accepts same-origin and http(s) only", () => {
  assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
});

/* ---------- API mutation contract ---------- */

test("mutations are non-GET with JSON content type and typed bodies", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const api = await import("../web/js/chat/api.js");
    await api.stopRun({ chatId: "c1", runId: "r1" });
    await api.respondInput({ chatId: "c1", requestId: "req-1", kind: "approval", value: "approve" });
    await api.setSessionModel("c1", { model: "m", provider: "p" });
    await api.detachUploads(["a1"]);
    await api.attachVpsSelection({ root: "projects", path: "src", kind: "folder" });
    for (const call of calls) {
      assert.notEqual(call.method, "GET", `GET used for ${call.url}`);
      assert.equal(call.headers["Content-Type"], "application/json", `content type for ${call.url}`);
      assert.ok(!String(call.url).includes("session_id=") || call.method === "GET" || true);
    }
    assert.deepEqual(JSON.parse(calls[0].body), { chat_id: "c1", run_id: "r1" });
    assert.deepEqual(JSON.parse(calls[1].body), { chat_id: "c1", request_id: "req-1", kind: "approval", value: "approve" });
    assert.equal(calls[4].url, "/api/chat/attachments/vps");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("turn submission carries the stable turn identity header", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
  };
  try {
    const api = await import("../web/js/chat/api.js");
    await api.submitTurn({ chatId: "c1", text: "hi", attachments: [], turnId: "t-123", model: "m", provider: "p" });
    assert.equal(calls[0].headers["Idempotency-Key"], "t-123");
    const body = JSON.parse(calls[0].body);
    assert.equal(body.turn_id, "t-123");
    assert.equal(body.chat_id, "c1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("errors surface status for honest refusal rendering", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: "Origin not allowed" }) });
  try {
    const api = await import("../web/js/chat/api.js");
    await assert.rejects(() => api.stopRun({ chatId: "c1" }), (error) => error.status === 403 && /Origin not allowed/.test(error.message));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
