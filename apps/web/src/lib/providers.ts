/**
 * Harness + provider registry (FRANK spec §8.4 Harness Broker, §9 Model Broker).
 *
 * Server-side only. Goose is one harness behind a clean interface; more
 * (Hermes, Codex, Claude Code) slot in by implementing ChatProvider and
 * registering — no core change. The registry owns:
 *
 *   - capability aliases (§9.2): fast-general, deep-reasoning, code-builder…
 *   - per-room harness routes (Auto | named), hot-swappable at runtime
 *   - live health probing
 *
 * The interface explains the actual selection in plain language, per §8.4.
 */

import { createSession, streamMessage, gooseHealth, gooseModelInfo } from './goose-server';
import { ensureAgent, streamLettaMessage, lettaHealth } from './letta-server';
import {
  createDeepseekSession,
  deepseekHealth,
  deepseekModel,
  deepseekReportedModel,
  streamDeepseekMessage,
} from './deepseek-server';

export interface PublicModelOption {
  id: string;
  name: string;
  short: string;
  sub: string;
}

export class ModelSelectionError extends Error {
  constructor(readonly code: 'unsupported_model' | 'model_unavailable', message: string) {
    super(message);
    this.name = 'ModelSelectionError';
  }
}

/* ------------------------------------------------------------------ */
/* Chat provider interface — every harness implements this             */
/* ------------------------------------------------------------------ */

export interface ChatProvider {
  /** stable id, e.g. 'goose' */
  id: string;
  /** human label, e.g. 'Goose ACP' */
  label: string;
  /** one-line description for the UI */
  blurb: string;
  /** Explicit per-turn model selections this provider can truthfully execute. */
  models: readonly PublicModelOption[];
  /** live liveness probe */
  health(): Promise<boolean>;
  /** open a session rooted at a working dir; returns opaque session id */
  createSession(workdir: string): Promise<string>;
  /** stream text chunks for one turn. opts.model overrides the provider's default. */
  stream(sessionId: string, prompt: string, opts?: { model?: string }): AsyncGenerator<string, void, unknown>;
  /** What model is actually behind this harness right now. */
  modelInfo(sessionId?: string): Promise<{ provider: string | null; model: string | null }>;
}

/* ------------------------------------------------------------------ */
/* Goose implementation (current default)                              */
/* ------------------------------------------------------------------ */

const gooseProvider: ChatProvider = {
  id: 'goose',
  models: [],
  label: 'Goose ACP',
  blurb: 'Open general-purpose harness over the Agent Client Protocol. Reads + writes, tool use, streaming.',
  health: gooseHealth,
  createSession: (workdir) => createSession(workdir),
  stream: (sessionId, prompt, opts) => streamMessage(sessionId, prompt, opts),
  modelInfo: gooseModelInfo,
};

/* ------------------------------------------------------------------ */
/* Letta implementation — persistent agent memory ("session wiki")     */
/* ------------------------------------------------------------------ */
/* One long-lived Letta agent per room; its memory blocks persist in     */
/* Postgres across restarts. The chat route stashes the room persona on  */
/* createSession so stream() can fold it in on first use.               */

const lettaPersonaByRoom = new Map<string, string>();

const lettaProvider: ChatProvider = {
  id: 'letta',
  models: [],
  label: 'Letta Memory',
  blurb: 'Persistent agent memory — keeps a per-room session wiki that grows over time. DeepSeek backbone.',
  health: lettaHealth,
  // The "session" is just the room id; persona is captured here for the turn.
  createSession: (workdir) => {
    // workdir carries "roomId|persona" from the chat route (see route.ts).
    const sep = workdir.indexOf('|');
    const roomId = sep === -1 ? workdir : workdir.slice(0, sep);
    const persona = sep === -1 ? '' : workdir.slice(sep + 1);
    if (persona) lettaPersonaByRoom.set(roomId, persona);
    return Promise.resolve(roomId);
  },
  stream: (roomId, prompt, opts) =>
    streamLettaMessage(roomId, lettaPersonaByRoom.get(roomId) ?? '', prompt, opts),
  modelInfo: async () => ({
    provider: 'letta',
    model: process.env.LETTA_DEFAULT_MODEL ?? 'deepseek/deepseek-chat',
  }),
};

/* ------------------------------------------------------------------ */
/* DeepSeek direct — no local harness required                         */
/* ------------------------------------------------------------------ */

const deepseekProvider: ChatProvider = {
  id: 'deepseek',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', short: 'DS Chat', sub: 'fast · general-purpose' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', short: 'Reasoner', sub: 'deep reasoning · slower, thoughtful' },
  ],
  label: 'DeepSeek Direct',
  blurb: 'Direct DeepSeek API over HTTPS — streaming chat with per-room history, no local harness needed.',
  health: deepseekHealth,
  createSession: () => createDeepseekSession(),
  stream: (sessionId, prompt, opts) =>
    streamDeepseekMessage(sessionId, prompt, opts),
  modelInfo: (sessionId) => Promise.resolve({
    provider: 'deepseek',
    // Registry status reports configured default; turns report only provider
    // confirmation from stream frames, never the requested model.
    model: sessionId === undefined ? deepseekModel() : deepseekReportedModel(sessionId),
  }),
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const providers = new Map<string, ChatProvider>();
providers.set(gooseProvider.id, gooseProvider);
providers.set(deepseekProvider.id, deepseekProvider);
providers.set(lettaProvider.id, lettaProvider);
const autoProviders: readonly ChatProvider[] = [gooseProvider, deepseekProvider, lettaProvider];

/** Stable Auto preference: local Goose first, direct DeepSeek only on failure. */
export const AUTO_PROVIDER_IDS = autoProviders.map((provider) => provider.id);

export function registerProvider(p: ChatProvider): void {
  providers.set(p.id, p);
}

export function listProviders(): Array<Omit<ChatProvider, 'stream' | 'createSession' | 'health' | 'modelInfo'>> {
  return [...providers.values()].map((p) => ({ id: p.id, label: p.label, blurb: p.blurb, models: p.models }));
}

export function getProvider(id: string): ChatProvider | undefined {
  return providers.get(id);
}

/* ------------------------------------------------------------------ */
/* Expected model + mismatch warning                                   */
/* ------------------------------------------------------------------ */

/**
 * The model Steve believes he is running, declared in env. When the harness
 * reports something else, the UI shows a warning — a silent model swap is the
 * single most expensive kind of drift in this system.
 */
export function expectedModel(): string | null {
  return process.env.FRANK_EXPECTED_MODEL ?? null;
}

export function modelMismatch(actual: string | null, expected = expectedModel()): boolean {
  const exp = expected;
  if (!exp || !actual) return false;
  // Compare basenames: Goose reports 'deepseek-chat' while Letta reports
  // 'deepseek/deepseek-chat' — same model, different harness spelling.
  const base = (s: string) => {
    const t = s.trim().toLowerCase();
    const i = t.lastIndexOf('/');
    return i === -1 ? t : t.slice(i + 1);
  };
  return base(exp) !== base(actual);
}

/* ------------------------------------------------------------------ */
/* Capability aliases (§9.2) → provider                                */
/* ------------------------------------------------------------------ */

export type CapabilityAlias =
  | 'fast-general'
  | 'deep-reasoning'
  | 'code-builder'
  | 'code-review-independent'
  | 'vision-understanding'
  | 'embedding';

/**
 * Alias → provider route. Today everything maps to Goose; as harnesses land,
 * e.g. code-review-independent could route to an independent reviewer for
 * review diversity (§8.4). Overridable at runtime via setAliasRoute.
 */
const aliasRoutes = new Map<CapabilityAlias, string>([
  ['fast-general', 'goose'],
  ['deep-reasoning', 'goose'],
  ['code-builder', 'goose'],
  ['code-review-independent', 'goose'],
  ['vision-understanding', 'goose'],
  ['embedding', 'goose'],
]);

export function aliasProvider(alias: CapabilityAlias): ChatProvider {
  const id = aliasRoutes.get(alias) ?? 'goose';
  return providers.get(id) ?? gooseProvider;
}

export function setAliasRoute(alias: CapabilityAlias, providerId: string): void {
  aliasRoutes.set(alias, providerId);
}

/* ------------------------------------------------------------------ */
/* Per-room harness routes — hot-swappable                             */
/* ------------------------------------------------------------------ */

/** roomId → providerId. 'auto' means the broker picks. Absent = auto. */
const roomRoutes = new Map<string, string>();

// No static room pins. Central ran pinned to Letta in Phase 1; that pin is
// removed until a Letta server actually exists in production. Use
// setRoomRoute(roomId, providerId) to pin at runtime.

export function setRoomRoute(roomId: string, providerId: string): void {
  if (providerId === 'auto') roomRoutes.delete(roomId);
  else roomRoutes.set(roomId, providerId);
}

export function getRoomRoute(roomId: string): string {
  return roomRoutes.get(roomId) ?? 'auto';
}

/**
 * Resolve the harness for a room. Auto → first healthy provider (Goose for
 * now). Named → that provider, with a plain-language reason either way.
 */
export async function resolveHarness(roomId: string, requestedModel?: string): Promise<{
  provider: ChatProvider;
  reason: string;
}> {
  if (requestedModel !== undefined && requestedModel !== 'auto') {
    const provider = [...providers.values()].find((candidate) =>
      candidate.models.some((model) => model.id === requestedModel),
    );
    if (!provider) throw new ModelSelectionError('unsupported_model', `Model "${requestedModel}" is not available.`);
    if (!(await provider.health().catch(() => false))) {
      throw new ModelSelectionError('model_unavailable', `${provider.label} is unavailable.`);
    }
    return { provider, reason: `Selected ${requestedModel}; using ${provider.label}.` };
  }
  const route = getRoomRoute(roomId);
  if (route !== 'auto') {
    const p = providers.get(route) ?? gooseProvider;
    if (!(await p.health().catch(() => false))) {
      throw new ModelSelectionError('model_unavailable', `${p.label} is unavailable.`);
    }
    return { provider: p, reason: `Pinned to ${p.label} for this room.` };
  }
  // Auto: prefer health, fall back to Goose.
  for (const p of autoProviders) {
    if (await p.health().catch(() => false)) {
      return { provider: p, reason: `Auto — ${p.label} is healthy and general-purpose.` };
    }
  }
  return { provider: gooseProvider, reason: 'Auto — using Goose (no healthy alternative registered).' };
}

/* ------------------------------------------------------------------ */
/* Health snapshot for the UI                                          */
/* ------------------------------------------------------------------ */

export interface ProviderStatus {
  id: string;
  label: string;
  blurb: string;
  healthy: boolean;
  /** What model the harness reports it is running right now. */
  model: string | null;
  modelProvider: string | null;
  expectedModel: string | null;
  modelMismatch: boolean;
  models: readonly PublicModelOption[];
}

export async function providerStatuses(): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const p of providers.values()) {
    const healthy = await p.health().catch(() => false);
    const mi = await p.modelInfo().catch(() => ({ provider: null, model: null }));
    out.push({
      id: p.id,
      label: p.label,
      blurb: p.blurb,
      healthy,
      model: mi.model,
      modelProvider: mi.provider,
      expectedModel: expectedModel(),
      modelMismatch: modelMismatch(mi.model),
      models: p.models,
    });
  }
  return out;
}
