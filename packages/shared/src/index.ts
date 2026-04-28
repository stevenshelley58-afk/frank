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
