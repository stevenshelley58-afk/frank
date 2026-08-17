import test from "node:test";
import assert from "node:assert/strict";
import { classifyChatStreamEvent, SseEventParser } from "../web/js/chat-stream.js";

test("SSE parser streams fragmented LF and CRLF events without losing data", () => {
  const parser = new SseEventParser();
  assert.deepEqual(parser.push('event: reasoning.delta\r\ndata: {"text":"look'), []);
  assert.deepEqual(parser.push('ing"}\r\n\r\nevent: assistant.delta\ndata: {"delta":"hel'), [
    { event: "reasoning.delta", data: { text: "looking" } },
  ]);
  assert.deepEqual(parser.finish('lo"}\n\n'), [
    { event: "assistant.delta", data: { delta: "hello" } },
  ]);
});

test("chat stream classifier keeps reasoning, status, answer, and tools distinct", () => {
  assert.deepEqual(classifyChatStreamEvent("reasoning.delta", { text: "inspect" }), {
    kind: "reasoning.delta", text: "inspect",
  });
  assert.deepEqual(classifyChatStreamEvent("reasoning.available", { text: "full thought" }), {
    kind: "reasoning.replace", text: "full thought",
  });
  assert.deepEqual(classifyChatStreamEvent("tool.progress", { tool_name: "_thinking", delta: "snapshot" }), {
    kind: "reasoning.replace", text: "snapshot",
  });
  assert.deepEqual(classifyChatStreamEvent("thinking.delta", { text: "Waiting for provider" }), {
    kind: "thinking.status", text: "Waiting for provider",
  });
  assert.deepEqual(classifyChatStreamEvent("assistant.delta", { delta: "answer" }), {
    kind: "assistant.delta", text: "answer",
  });
  assert.deepEqual(classifyChatStreamEvent("tool.started", { tool_name: "terminal" }), {
    kind: "tool.started", name: "terminal",
  });
});
