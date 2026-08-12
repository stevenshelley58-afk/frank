import type { ModelAlias } from './chat-turn-runner.js';

export interface ChatTurnRuntimeConfig {
  readonly gooseAcpUrl: string;
  readonly gooseSecret?: string;
  readonly aliases: Readonly<Record<string, ModelAlias>>;
  readonly capabilityRoutes: Readonly<Record<'Auto' | 'Deep' | 'Vision' | 'Image', readonly string[]>>;
  readonly workspacePath: string;
}

/** Provider secrets stay at composition; the runner receives only the selected bounded target. */
export function chatTurnRuntimeConfig(env: NodeJS.ProcessEnv): ChatTurnRuntimeConfig | undefined {
  const gooseAcpUrl = nonBlank(env.GOOSE_ACP_URL);
  if (!gooseAcpUrl) return undefined;
  const aliases: Record<string, ModelAlias> = {};
  const openAiKey = nonBlank(env.OPENAI_API_KEY ?? env.FRANK_OPENAI_API_KEY);
  const geminiKey = nonBlank(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY);
  const liteLlmUrl = nonBlank(env.FRANK_LITELLM_BASE_URL ?? env.LITELLM_BASE_URL);
  const liteLlmKey = nonBlank(env.FRANK_LITELLM_VIRTUAL_KEY ?? env.LITELLM_API_KEY);
  const gooseSecret = nonBlank(env.GOOSE_ACP_SECRET);
  if (openAiKey) addAlias(aliases, 'openai-direct', { upstream: 'openai-direct', provider: 'openai', model: nonBlank(env.FRANK_OPENAI_MODEL ?? env.OPENAI_MODEL) ?? 'gpt-5.2', apiKey: openAiKey });
  if (geminiKey) addAlias(aliases, 'gemini-direct', { upstream: 'gemini-direct', provider: 'google', model: nonBlank(env.FRANK_GEMINI_MODEL ?? env.GEMINI_MODEL) ?? 'gemini-2.5-pro', apiKey: geminiKey });
  const configuredProvider = nonBlank(env.GOOSE_PROVIDER);
  const configuredModel = nonBlank(env.GOOSE_MODEL);
  if (configuredProvider && configuredModel) addAlias(aliases, 'configured', { upstream: 'goose-configured', provider: configuredProvider, model: configuredModel });
  if (liteLlmUrl && liteLlmKey) addAlias(aliases, 'concentrate', { upstream: 'concentrate-litellm', provider: 'openai', model: nonBlank(env.FRANK_CONCENTRATE_MODEL) ?? 'concentrate', apiKey: liteLlmKey, baseUrl: liteLlmUrl });
  if (!Object.keys(aliases).length) throw new Error('GOOSE_ACP_URL requires at least one configured direct, Goose, or LiteLLM provider route.');
  return {
    gooseAcpUrl,
    ...(gooseSecret ? { gooseSecret } : {}),
    aliases,
    capabilityRoutes: {
      Auto: ['openai-direct', 'gemini-direct', 'configured', 'concentrate'],
      Deep: ['openai-direct', 'gemini-direct', 'configured', 'concentrate'],
      Vision: ['gemini-direct', 'openai-direct', 'configured', 'concentrate'],
      Image: ['gemini-direct', 'openai-direct', 'configured', 'concentrate'],
    },
    workspacePath: nonBlank(env.GOOSE_REPO_CWD ?? env.FRANK_MISSION_WORKSPACE_SOURCE) ?? '/srv/frank/workspaces/central',
  };
}

function nonBlank(value: string | undefined): string | undefined { const trimmed = value?.trim(); return trimmed ? trimmed : undefined; }
function addAlias(aliases: Record<string, ModelAlias>, name: string, target: ModelAlias): void { aliases[name] = target; aliases[target.model] = target; }
