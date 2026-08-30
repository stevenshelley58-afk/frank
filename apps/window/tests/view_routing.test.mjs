import assert from "node:assert/strict";
import test from "node:test";

import { blockwiseTemplateUrl, pathForView, viewForPath } from "../web/js/view-routing.js";

test("Ad Studio has a canonical deep link and every other view returns home", () => {
  assert.equal(viewForPath("/ad-studio"), "ad-studio");
  assert.equal(viewForPath("/ad-studio/"), "ad-studio");
  assert.equal(viewForPath("/"), "hub");
  assert.equal(viewForPath("/not-a-view"), "hub");
  assert.equal(pathForView("ad-studio"), "/ad-studio");
  assert.equal(pathForView("tools"), "/");
});

test("Blockwise editor links require a safe imported template identity", () => {
  assert.equal(
    blockwiseTemplateUrl({ template_id: "meta-006", status: "imported" }),
    "https://blockwise.sale/ad-studio/templates/meta-006",
  );
  assert.equal(
    blockwiseTemplateUrl({ template_url: "https://blockwise.sale/ad-studio/templates/meta-006" }),
    "https://blockwise.sale/ad-studio/templates/meta-006",
  );
  assert.equal(blockwiseTemplateUrl({}), "");
  assert.equal(blockwiseTemplateUrl({ template_id: "../admin" }), "");
  assert.equal(blockwiseTemplateUrl({ template_id: "meta-006", template_url: "https://evil.example/ad-studio/templates/meta-006" }), "");
  assert.equal(blockwiseTemplateUrl({ template_url: "http://blockwise.sale/ad-studio/templates/meta-006" }), "");
  assert.equal(blockwiseTemplateUrl({ template_url: "https://blockwise.sale/ad-studio/templates/meta-006?workspace=1" }), "");
  assert.equal(blockwiseTemplateUrl({ template_url: "https://user:pass@blockwise.sale/ad-studio/templates/meta-006" }), "");
  assert.equal(
    blockwiseTemplateUrl({
      template_id: "meta-006",
      template_url: "https://blockwise.sale/ad-studio/templates/different",
    }),
    "",
  );
});
