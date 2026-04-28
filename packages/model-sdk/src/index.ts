import { MODEL_ROLES, PROVIDER_IDS, type ModelRoleId, type ProviderId } from "@frank/shared";

export type ModelCapability =
  | "chat"
  | "code"
  | "reasoning"
  | "research"
  | "extraction"
  | "vision"
  | "image_generation"
  | "image_editing"
  | "embedding"
  | "rerank";

export interface ModelRoleRequest {
  role: ModelRoleId;
  inputKind: "chat" | "code" | "document" | "image" | "embedding" | "rerank";
  budgetTier?: "low" | "standard" | "high";
  requiredCapabilities?: ModelCapability[];
}

export interface ProviderHealth {
  providerId: ProviderId;
  ok: boolean;
  status: "not_configured" | "healthy" | "degraded" | "unavailable";
  message: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  health(): Promise<ProviderHealth>;
  route(request: ModelRoleRequest): Promise<never>;
}

export interface ModelRouteDecision {
  role: ModelRoleId;
  providerId: ProviderId;
  modelCatalogId?: string;
  reason: string;
}

export function createNotConfiguredAdapter(id: ProviderId, displayName: string): ProviderAdapter {
  return {
    id,
    displayName,
    async health() {
      return {
        providerId: id,
        ok: false,
        status: "not_configured",
        message: `${displayName} adapter is scaffolded but not wired to credentials or runtime calls.`
      };
    },
    async route() {
      throw new Error(`${displayName} adapter is not configured. Provider calls are disabled in the foundation.`);
    }
  };
}

export const providerAdapters: ProviderAdapter[] = [
  createNotConfiguredAdapter("openrouter", "OpenRouter"),
  createNotConfiguredAdapter("litellm", "LiteLLM"),
  createNotConfiguredAdapter("openai", "OpenAI"),
  createNotConfiguredAdapter("anthropic", "Anthropic"),
  createNotConfiguredAdapter("google", "Google"),
  createNotConfiguredAdapter("mistral", "Mistral"),
  createNotConfiguredAdapter("groq", "Groq"),
  createNotConfiguredAdapter("together", "Together"),
  createNotConfiguredAdapter("replicate", "Replicate"),
  createNotConfiguredAdapter("fal", "fal"),
  createNotConfiguredAdapter("ollama", "Ollama"),
  createNotConfiguredAdapter("vllm", "vLLM"),
  createNotConfiguredAdapter("codex", "Codex"),
  createNotConfiguredAdapter("claude-agent-sdk", "Claude Agent SDK"),
  createNotConfiguredAdapter("comfyui", "ComfyUI")
];

export function getProviderAdapter(id: ProviderId): ProviderAdapter {
  const adapter = providerAdapters.find((candidate) => candidate.id === id);
  if (!adapter) {
    throw new Error(`Unknown provider adapter: ${id}`);
  }
  return adapter;
}

export function routeByRoleSkeleton(request: ModelRoleRequest): ModelRouteDecision {
  if (!MODEL_ROLES.includes(request.role)) {
    throw new Error(`Unknown model role: ${request.role}`);
  }

  const providerId = PROVIDER_IDS[0];
  return {
    role: request.role,
    providerId,
    reason: "Foundation skeleton only. Real routing will use model pins, budgets, provider health, and fallback chains."
  };
}
