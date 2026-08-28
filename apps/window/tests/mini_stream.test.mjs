import test from "node:test";
import assert from "node:assert/strict";

import {
  isAssistantCompleted,
  parseSseBlock,
  streamPiece,
} from "../web/mini/mini_stream.mjs";

test("delta followed by done is partial, not completed", () => {
  const delta = parseSseBlock(
    'event: assistant.delta\ndata: {"type":"assistant.delta","delta":"half"}'
  );
  const done = parseSseBlock('event: done\ndata: {"type":"done"}');

  assert.deepEqual(streamPiece(delta.event, delta.data), { mode: "append", text: "half" });
  assert.equal(isAssistantCompleted(delta.event, delta.data), false);
  assert.equal(isAssistantCompleted(done.event, done.data), false);
  assert.deepEqual(streamPiece(done.event, done.data), { mode: "ignore", text: "" });
});

test("only an explicit assistant terminal event completes the reply", () => {
  const completed = parseSseBlock(
    'event: assistant.completed\ndata: {"type":"assistant.completed","content":"whole answer"}'
  );

  assert.equal(isAssistantCompleted(completed.event, completed.data), true);
  assert.deepEqual(streamPiece(completed.event, completed.data), {
    mode: "replace",
    text: "whole answer",
  });
});
