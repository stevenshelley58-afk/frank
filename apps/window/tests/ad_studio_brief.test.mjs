import assert from "node:assert/strict";
import test from "node:test";
import { AD_STUDIO_BRIEF_MAX_CHARACTERS, adStudioBriefLength, adStudioBriefValidation } from "../web/js/ad-studio-brief.js";

test("a 1,975-character rich brief is accepted without normalization", () => {
  const prefix = "  Keep leading space\r\nKeep newlines\tand Unicode: café — 😀\n";
  const brief = prefix + "界".repeat(1975 - Array.from(prefix).length);
  const validation = adStudioBriefValidation(brief);

  assert.equal(AD_STUDIO_BRIEF_MAX_CHARACTERS, 4000);
  assert.equal(adStudioBriefLength(brief), 1975);
  assert.equal(validation.valid, true);
  assert.equal(brief.startsWith("  "), true);
  assert.equal(brief.includes("\r\n"), true);
});

test("4,001 characters are rejected and never returned as a shortened value", () => {
  const brief = "😀".repeat(4001);
  const validation = adStudioBriefValidation(brief);

  assert.equal(adStudioBriefLength(brief), 4001);
  assert.equal(validation.valid, false);
  assert.match(validation.message, /4,001 characters/);
  assert.match(validation.message, /did not shorten/);
  assert.equal(Object.hasOwn(validation, "value"), false);
});

test("4,000 multibyte characters are accepted at the boundary", () => {
  const brief = "😀".repeat(4000);

  assert.equal(adStudioBriefLength(brief), 4000);
  assert.equal(adStudioBriefValidation(brief).valid, true);
});
