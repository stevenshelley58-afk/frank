import assert from "node:assert/strict";
import test from "node:test";
import { placementScore, reviewArtifactPurpose, reviewOverallScore, reusableValidationChecks, selectFaithfulReviewArtifact, selectMetaPreview, selectReusableReviewArtifact, selectReviewArtifact } from "../web/js/ad-template-generator-review.js";

const summary = {
  source: { name: "source.png", url: "/source" },
  previews: [
    { name: "feed.png", placement: "feed", kind: "template", url: "/feed" },
    { name: "story.png", placement: "story", kind: "template", url: "/story" },
    { name: "meta-feed.png", placement: "feed", kind: "meta-preview", url: "/meta-feed" },
    { name: "overlay-story.png", placement: "story", view: "overlay", url: "/overlay-story" },
  ],
  diffs: [{ name: "diff-feed.png", placement: "feed", view: "difference", url: "/diff-feed" }],
  scores: { overall: 9.8, feed: 9.9, story_likeness: 9.8 },
};

test("review evidence selector never substitutes a different evidence kind", () => {
  assert.equal(selectReviewArtifact(summary, "feed", "source").url, "/source");
  assert.equal(selectReviewArtifact(summary, "feed", "template").url, "/feed");
  assert.equal(selectReviewArtifact(summary, "story", "overlay").url, "/overlay-story");
  assert.equal(selectReviewArtifact(summary, "feed", "difference").url, "/diff-feed");
  assert.equal(selectReviewArtifact(summary, "story", "difference"), null);
});

test("Meta preview selection cannot silently return a raw template", () => {
  assert.equal(selectMetaPreview(summary, "feed").url, "/meta-feed");
  assert.equal(selectMetaPreview(summary, "story"), null);
});

test("recorded overall and placement scores are selected explicitly", () => {
  assert.equal(reviewOverallScore(summary), 9.8);
  assert.equal(placementScore(summary, "feed"), 9.9);
  assert.equal(placementScore(summary, "story"), 9.8);
  assert.equal(reviewOverallScore({ scores: { feed: 9.9, story: 9.7 } }), 9.7);
});

test("source-filled QA and reusable customer renders stay visibly distinct", () => {
  const evidence = { previews: [
    { name: "qa-feed.png", placement: "feed", kind: "qa-source-filled", url: "/qa" },
    { name: "customer-feed.png", placement: "feed", kind: "customer-default", url: "/customer" },
  ] };

  assert.equal(selectReviewArtifact(evidence, "feed", "template").url, "/qa");
  assert.equal(selectReusableReviewArtifact(evidence, "feed").url, "/customer");
  assert.equal(reviewArtifactPurpose(evidence.previews[0]), "qa-source-filled");
  assert.equal(reviewArtifactPurpose(evidence.previews[1]), "customer-default");
  assert.equal(selectReusableReviewArtifact(summary, "feed"), null);
});

test("Story source uses the reciprocal reference and final shippable is reusable", () => {
  const evidence = {
    source: { name: "source.png", placement: "feed", url: "/source" },
    references: [{ name: "reference-story.png", placement: "story", kind: "reciprocal-image-reference", url: "/story-reference" }],
    previews: [{ name: "neutral-story.png", placement: "story", kind: "final-neutral-shippable", url: "/neutral" }],
  };
  assert.equal(selectReviewArtifact(evidence, "feed", "source").url, "/source");
  assert.equal(selectReviewArtifact(evidence, "story", "source").url, "/story-reference");
  assert.equal(selectReusableReviewArtifact(evidence, "story").url, "/neutral");
});

test("faithful and reusable review cards require their declared artifact kinds", () => {
  assert.equal(selectFaithfulReviewArtifact({
    previews: [{ name: "neutral-feed.png", placement: "feed", kind: "customer-default", url: "/neutral" }],
  }, "feed"), null);
  assert.equal(selectFaithfulReviewArtifact({
    previews: [{ name: "qa-feed.png", placement: "feed", kind: "qa-source-filled", url: "/qa" }],
  }, "feed").url, "/qa");
  assert.equal(selectReusableReviewArtifact({
    previews: [{ name: "qa-feed.png", placement: "feed", kind: "qa-source-filled", url: "/qa" }],
  }, "feed"), null);
});

test("reusable validation reports only consistent recorded scenarios", () => {
  assert.deepEqual(reusableValidationChecks({}), []);
  assert.deepEqual(reusableValidationChecks({ reusable_validation: {
    status: "passed", counts: { total: 2, passed: 2, failed: 0 },
    scenarios: [{ name: "No source pixels", status: "passed" }, { identity: "Editable layers", status: "passed" }],
  } }), [
    { label: "No source pixels", status: "passed" },
    { label: "Editable layers", status: "passed" },
  ]);
  assert.deepEqual(reusableValidationChecks({ reusable_validation: {
    status: "passed", counts: { total: 1, passed: 1, failed: 0 },
    scenarios: [{ name: "Incomplete", status: "unknown" }],
  } }), []);
  assert.deepEqual(reusableValidationChecks({ reusable_validation: {
    status: "passed", counts: { total: 2, passed: 2, failed: 0 },
    scenarios: [{ name: "Only one", status: "passed" }],
  } }), []);
  assert.deepEqual(reusableValidationChecks({ reusable_validation: {
    status: "failed", counts: { total: 1, passed: 0, failed: 1 },
    scenarios: [{ name: "Contradictory", status: "passed" }],
  } }), []);
  assert.deepEqual(reusableValidationChecks({ reusable_validation: {
    status: "passed", counts: { total: 1.5, passed: 1, failed: 0 },
    scenarios: [{ name: "Fractional", status: "passed" }],
  } }), []);
});
