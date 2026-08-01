/**
 * FRANK Harness Adapter Protocol
 *
 * Every agent harness (Goose, jcode, future) implements this interface.
 * Frank's control plane talks to rooms through this seam alone — the
 * harness underneath is hot-swappable per room or globally.
 */

/** Model/provider configuration for a session. */
export interface ProviderConfig {
  /** Provider id: "openai", "anthropic", "google", "ollama", "openrouter", etc. */
  provider: string;
  /** Model id: "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro", etc. */
  model: string;
  /** API key for key-based providers. Omit for ACP/subscription providers. */
  apiKey?: string;
  /** ACP subscription id for Goose: "chatgpt-plus", "claude-pro", etc. */
  acpSubscription?: string;
  /** Custom base URL for self-hosted or proxied providers. */
  baseUrl?: string;
}

/** Info about an available provider/model. */
export interface ProviderInfo {
  id: string;
  provider: string;
  model: string;
  type: 'api_key' | 'acp' | 'local';
  status: 'active' | 'inactive' | 'needs_setup';
  harness: string[];
}

/** Opaque handle to a live harness session. */
export interface SessionHandle {
  id: string;
  harness: string;
  roomId: string;
  createdAt: string;
}

/** A chunk of streamed output from the harness. */
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content: string;
  /** For tool_call chunks: the tool name. */
  toolName?: string;
  /** For tool_call chunks: the tool arguments. */
  toolArgs?: Record<string, unknown>;
}

/**
 * The harness adapter protocol.
 *
 * One adapter instance per harness type. Sessions are created per room.
 * The adapter is responsible for lifecycle management (start, message,
 * model swap, stop) and health reporting.
 */
export interface HarnessAdapter {
  /** Human-readable harness name: "Goose", "jcode", etc. */
  readonly name: string;

  /**
   * Start a session for a room.
   * The systemPrompt carries Frank's scoping rules (D3):
   * global read, project-scoped write, shared-folder approvals.
   */
  startSession(input: {
    roomId: string;
    workspacePath: string;
    systemPrompt: string;
    provider?: ProviderConfig;
  }): Promise<SessionHandle>;

  /** Send a message and stream back the response. */
  sendMessage(
    session: SessionHandle,
    message: string,
  ): AsyncIterable<StreamChunk>;

  /** Hot-swap the model/provider mid-session. */
  switchModel(
    session: SessionHandle,
    provider: ProviderConfig,
  ): Promise<void>;

  /** List available providers/models for this harness. */
  listProviders(): Promise<ProviderInfo[]>;

  /** Stop a session and clean up resources. */
  stopSession(session: SessionHandle): Promise<void>;

  /** Health check. */
  status(): Promise<{ healthy: boolean; version?: string; sessions?: number }>;
}
