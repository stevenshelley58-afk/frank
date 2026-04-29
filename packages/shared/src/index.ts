import { z } from "zod";

export const FRANK_SYSTEM_NAME = "Frank Hub" as const;
export const FRANK_DOMAIN = "frank.fail" as const;
export const FRANK_DASHBOARD_URL = "https://hub.frank.fail" as const;
export const FRANK_API_URL = "https://api.frank.fail" as const;

export const MODEL_ROLES = [
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
] as const;

export type ModelRoleId = (typeof MODEL_ROLES)[number];

export const PROVIDER_IDS = [
  "openrouter",
  "litellm",
  "openai",
  "anthropic",
  "google",
  "mistral",
  "groq",
  "together",
  "replicate",
  "fal",
  "ollama",
  "vllm",
  "codex",
  "claude-agent-sdk",
  "comfyui"
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const TASK_STATES = [
  "draft",
  "queued",
  "running",
  "blocked",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled"
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TASK_EXECUTION_KINDS = [
  "manual_lifecycle",
  "hermes_operator",
  "hermes_coding",
  "hermes_research",
  "hermes_ops"
] as const;

export type TaskExecutionKind = (typeof TASK_EXECUTION_KINDS)[number];

export const AGENT_PERMISSION_LEVELS = ["denied", "auto", "auto_review", "manual"] as const;

export type AgentPermissionLevel = (typeof AGENT_PERMISSION_LEVELS)[number];

export const serviceStatusSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional()
});

export const systemStatusSchema = z.object({
  systemName: z.string(),
  environment: z.string(),
  dashboardUrl: z.string().url(),
  apiUrl: z.string().url(),
  generatedAt: z.string(),
  services: z.object({
    postgres: serviceStatusSchema,
    redis: serviceStatusSchema,
    cloudflareAccess: serviceStatusSchema
  }),
  modelControlPlane: z.object({
    roleCount: z.number().int().nonnegative(),
    providerCount: z.number().int().nonnegative(),
    routingMode: z.literal("role_based_skeleton")
  }),
  opsConsole: z.object({
    mode: z.literal("skeleton"),
    terminalAccess: z.literal("disabled")
  })
});

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export function isModelRole(value: string): value is ModelRoleId {
  return MODEL_ROLES.includes(value as ModelRoleId);
}

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

export function isTaskState(value: string): value is TaskState {
  return TASK_STATES.includes(value as TaskState);
}

export const REOPENABLE_TASK_STATES = ["completed", "cancelled"] as const;

export type ReopenableTaskState = (typeof REOPENABLE_TASK_STATES)[number];

export const TASK_STATE_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  draft: ["queued", "cancelled"],
  queued: ["running", "blocked", "cancelled"],
  running: ["blocked", "waiting_approval", "completed", "failed", "cancelled"],
  blocked: ["queued", "running", "failed", "cancelled"],
  waiting_approval: ["queued", "running", "failed", "cancelled"],
  completed: ["queued"],
  failed: ["queued", "cancelled"],
  cancelled: ["queued"]
} as const;

export interface TaskStateTransitionResult {
  ok: boolean;
  reason?: string;
  reopen?: boolean;
  statusCode?: 400 | 409;
}

export function isReopenableTaskState(value: TaskState): value is ReopenableTaskState {
  return REOPENABLE_TASK_STATES.includes(value as ReopenableTaskState);
}

export function validateTaskStateTransition(
  from: TaskState,
  to: TaskState,
  options: { reopened?: boolean } = {}
): TaskStateTransitionResult {
  if (from === to) {
    if (options.reopened) {
      return {
        ok: false,
        statusCode: 400,
        reason: "Reopening requires a state change to queued."
      };
    }
    return { ok: true };
  }

  if (options.reopened) {
    if (!isReopenableTaskState(from) || to !== "queued") {
      return {
        ok: false,
        statusCode: 400,
        reason: "Reopening requires the current state to be completed or cancelled and the target state to be queued."
      };
    }
    return { ok: true, reopen: true };
  }

  if (isReopenableTaskState(from) && to === "queued") {
    return {
      ok: false,
      statusCode: 400,
      reason: "Reopening a completed or cancelled task requires reopened=true."
    };
  }

  if (!TASK_STATE_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      statusCode: 409,
      reason: `Invalid task state transition from ${from} to ${to}.`
    };
  }

  return { ok: true };
}

export function isAgentPermissionLevel(value: string): value is AgentPermissionLevel {
  return AGENT_PERMISSION_LEVELS.includes(value as AgentPermissionLevel);
}
