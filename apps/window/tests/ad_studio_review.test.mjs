import assert from "node:assert/strict";
import test from "node:test";
import { placementScore, reviewArtifactPurpose, reviewOverallScore, selectMetaPreview, selectReusableReviewArtifact, selectReviewArtifact } from "../web/js/ad-studio-review.js";

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
