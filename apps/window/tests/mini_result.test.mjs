import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeResultGuidance,
  resultGuidanceMarkup,
  selfHostGuideMarkup,
} from "../web/mini/mini_result.mjs";

const guidanceFixture = {
  schema: "schema://frank.mini-guidance/v1",
  source: "hermes_supplied",
  status: "ready",
  revision: 3,
  use_now: [{
    title: "Open the booking board",
    why: "The current revision is ready for Saturday service.",
    prompt: "https://frank.fail/mini-preview/job-1/",
  }],
  free_revisions: {
    available: true,
    items: [{
      title: "Add the courtyard section",
      why: "The venue uses it for larger bookings.",
      prompt: "Add the courtyard section and preserve the current table notes.",
    }],
  },
  related_free_projects: {
    status: "ready",
    items: [{
      title: "Prepare the weekly run sheet",
      why: "It can reuse the same service data.",
      prompt: "Build a free weekly run sheet from this booking board.",
    }],
  },
  larger_project: {
    status: "ready",
    title: "Connect live reservations",
    why: "This removes the remaining manual copy step.",
    owner_prompt: "Scope a live reservations connection using this current result.",
  },
};

const selfHostFixture = {
  schema: "schema://frank.mini-self-host/v1",
  source: "hermes_supplied",
  status: "ready",
  revision: 3,
  applicability: "static_files",
  overview: "Publish the supplied public files on a static host and verify every route before sharing it.",
  requirements: ["The deployable public folder", "A static host with HTTPS"],
  steps: [
    { title: "Upload the public files", detail: "Keep index.html at the site root." },
    { title: "Verify the result", detail: "Test the public address on desktop and mobile." },
  ],
  operations: [
    { area: "Monitoring", detail: "Notice outages and broken downloads." },
    { area: "Updates", detail: "Keep the previous working files for rollback." },
  ],
  service: {
    available: true,
    reason: "Frank can scope managed hosting after the provider and traffic are known.",
    price_status: "scope_required",
  },
};

test("a real backend-shaped result renders use-now, free, related, self-host and optional implementation paths", () => {
  const guidance = normalizeResultGuidance(guidanceFixture, 3, selfHostFixture);
  const markup = resultGuidanceMarkup(guidance);
  const guide = selfHostGuideMarkup(guidance.selfHost);

  assert.equal(guidance.status, "ready");
  assert.equal(guidance.revision, 3);
  assert.match(markup, /Use it now/);
  assert.match(markup, /Add the courtyard section/);
  assert.match(markup, /Prepare the weekly run sheet/);
  assert.match(markup, /Connect live reservations/);
  assert.match(markup, /data-guidance-prompt="Scope a live reservations connection using this current result\."/);
  assert.match(markup, /data-guidance-mode="service"/);
  assert.match(markup, /For this revision · 3/);
  assert.equal(guidance.freeRefinements.actions[0].url, "");
  assert.equal(guidance.freeRefinements.actions[0].prompt, "Add the courtyard section and preserve the current table notes.");
  assert.equal(guidance.relatedFreeProject.actions[0].url, "");
  assert.equal(guidance.relatedFreeProject.actions[0].prompt, "Build a free weekly run sheet from this booking board.");
  assert.match(markup, /data-guidance-prompt="Add the courtyard section and preserve the current table notes\."/);
  assert.match(markup, /data-guidance-prompt="Build a free weekly run sheet from this booking board\."/);
  assert.match(guide, /Upload the public files/);
  assert.match(guide, /Monitoring: Notice outages and broken downloads/);
  assert.equal(guidance.selfHost.service.priceStatus, "scope_required");
});

test("explicitly stale guidance is withheld from the current revision", () => {
  const stale = normalizeResultGuidance({ ...guidanceFixture, revision: 2 }, 3, selfHostFixture);
  assert.equal(stale.status, "stale");
  assert.match(resultGuidanceMarkup(stale), /earlier revision/);
});

test("not-required self-host guidance keeps the honest no-hosting explanation", () => {
  const guide = {
    ...selfHostFixture,
    applicability: "not_required",
    overview: "This downloadable result does not need a website or service to be hosted.",
    requirements: [],
    steps: [],
    operations: [],
  };
  const normalized = normalizeResultGuidance(guidanceFixture, 3, guide);
  assert.equal(normalized.selfHost.status, "not_required");
  assert.match(selfHostGuideMarkup(normalized.selfHost), /does not need a website or service/);
});

test("guidance links trust only the Mini Frank origin", () => {
  const fixture = {
    ...guidanceFixture,
    use_now: [
      { title: "Valid preview", why: "Trusted delivery route.", prompt: "/mini-frank/published-artifacts/result/1" },
      { title: "Old preview host", why: "Direct preview delivery is disabled.", prompt: "https://preview.frank.fail/result/1" },
      { title: "Arbitrary site", why: "Must remain composer text.", prompt: "https://example.com/collect" },
      { title: "Script scheme", why: "Must remain inert text.", prompt: "javascript:alert(1)" },
      { title: "Credential URL", why: "Must remain inert text.", prompt: "https://owner@frank.fail/private" },
    ],
  };
  const normalized = normalizeResultGuidance(fixture, 3, selfHostFixture);
  const actions = normalized.useNow.actions;

  assert.equal(actions[0].url, "https://frank.fail/mini-frank/published-artifacts/result/1");
  assert.equal(actions[0].prompt, "");
  assert.equal(actions[1].url, "");
  assert.equal(actions[1].prompt, "https://preview.frank.fail/result/1");
  assert.equal(actions[2].url, "");
  assert.equal(actions[2].prompt, "https://example.com/collect");
  assert.equal(actions[3].url, "");
  assert.equal(actions[3].prompt, "javascript:alert(1)");
  assert.equal(actions[4].url, "");
  assert.equal(actions[4].prompt, "https://owner@frank.fail/private");
  const markup = resultGuidanceMarkup(normalized);
  assert.match(markup, /href="https:\/\/frank\.fail\/mini-frank\/published-artifacts\/result\/1"/);
  assert.doesNotMatch(markup, /href="https:\/\/preview\.frank\.fail|href="https:\/\/example\.com|href="javascript:|href="https:\/\/owner@/);
});
