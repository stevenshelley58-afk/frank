import { describe, expect, it } from "vitest";
import {
  AGENT_PERMISSION_LEVELS,
  MODEL_ROLES,
  PROVIDER_IDS,
  TASK_STATES,
  isAgentPermissionLevel,
  isModelRole,
  isProviderId,
  isTaskState
} from "../src/index.js";

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

  it("defines the required task states", () => {
    expect(TASK_STATES).toEqual([
      "draft",
      "queued",
      "running",
      "blocked",
      "waiting_approval",
      "completed",
      "failed",
      "cancelled"
    ]);
    expect(isTaskState("waiting_approval")).toBe(true);
    expect(isTaskState("pending")).toBe(false);
  });

  it("defines the required agent permission levels", () => {
    expect(AGENT_PERMISSION_LEVELS).toEqual(["denied", "auto", "auto_review", "manual"]);
    expect(isAgentPermissionLevel("auto_review")).toBe(true);
    expect(isAgentPermissionLevel("approval_required")).toBe(false);
  });
});
