import assert from "node:assert/strict";
import test from "node:test";

import { adTemplateGeneratorStartError } from "../web/js/ad-template-generator-api.js";

test("Hermes run rejection keeps its bounded actionable message", () => {
  const message = "model policy stages must exactly match the required route order";
  assert.equal(adTemplateGeneratorStartError({ code: "hermes_rejected", message }), message);
  assert.equal(adTemplateGeneratorStartError({ code: "hermes_rejected", message: "x".repeat(300) }).length, 240);
});

test("Hermes rejection detail redacts credentials without hiding the useful reason", () => {
  const message = adTemplateGeneratorStartError({
    code: "hermes_rejected",
    message: "model policy is missing compare; token=sk-live-secret Bearer abc123 https://user:pass@example.invalid/path",
  });
  assert.match(message, /model policy is missing compare/);
  assert.match(message, /token=\[redacted\]/);
  assert.match(message, /Bearer \[redacted\]/);
  assert.match(message, /https:\/\/\[redacted\]@example.invalid\/path/);
  assert.doesNotMatch(message, /sk-live-secret|abc123|user:pass/);
});

test("unsafe or absent rejection detail uses a useful safe fallback", () => {
  assert.equal(
    adTemplateGeneratorStartError({ code: "hermes_rejected", message: "[object Object]" }),
    "Hermes rejected this run. Check the model setup and try again.",
  );
  assert.equal(
    adTemplateGeneratorStartError({ code: "source_missing", message: "internal detail" }),
    "This image is no longer available. Add it again.",
  );
});
