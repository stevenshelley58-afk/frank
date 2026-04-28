import { describe, expect, it } from "vitest";
import { MODEL_ROLES, PROVIDER_IDS, isModelRole, isProviderId } from "../src/index.js";

describe("Frank Hub shared constants", () => {
  it("defines exactly the required model roles", () => {
    expect(MODEL_ROLES).toHaveLength(17);
    expect(MODEL_ROLES).toEqual([
      "router_fast",
      "memory_extractor",
      "project_context_summarizer",
      "coding_fast",
      "coding_heavy",
      "coding_review",
      "research_fast",
      "research_deep",
      "scraping_extraction",
      "structured_data_extraction",
      "image_prompting",
      "image_generation",
      "image_editing",
      "embedding",
      "rerank",
      "notification_summarizer",
      "approval_reviewer"
    ]);
    expect(isModelRole("coding_heavy")).toBe(true);
    expect(isModelRole("gpt-4.1")).toBe(false);
  });

  it("defines the required provider adapter ids", () => {
    expect(PROVIDER_IDS).toHaveLength(15);
    expect(isProviderId("openrouter")).toBe(true);
    expect(isProviderId("unknown")).toBe(false);
  });
});
