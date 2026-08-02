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

import { createSession, streamMessage, gooseHealth } from './goose-server';
import { ensureAgent, streamLettaMessage, lettaHealth } from './letta-server';

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
  /** live liveness probe */
  health(): Promise<boolean>;
  /** open a session rooted at a working dir; returns opaque session id */
  createSession(workdir: string): Promise<string>;
  /** stream text chunks for one turn */
  stream(sessionId: string, prompt: string): AsyncGenerator<string, void, unknown>;
}

/* ------------------------------------------------------------------ */
/* Goose implementation (current default)                              */
/* ------------------------------------------------------------------ */

const gooseProvider: ChatProvider = {
  id: 'goose',
  label: 'Goose ACP',
  blurb: 'Open general-purpose harness over the Agent Client Protocol. Reads + writes, tool use, streaming.',
  health: gooseHealth,
  createSession: (workdir) => createSession(workdir),
  stream: (sessionId, prompt) => streamMessage(sessionId, prompt),
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
  stream: (roomId, prompt) =>
    streamLettaMessage(roomId, lettaPersonaByRoom.get(roomId) ?? '', prompt),
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const providers = new Map<string, ChatProvider>();
providers.set(gooseProvider.id, gooseProvider);
providers.set(lettaProvider.id, lettaProvider);

export function registerProvider(p: ChatProvider): void {
  providers.set(p.id, p);
}

export function listProviders(): Array<Omit<ChatProvider, 'stream' | 'createSession' | 'health'>> {
  return [...providers.values()].map((p) => ({ id: p.id, label: p.label, blurb: p.blurb }));
}

export function getProvider(id: string): ChatProvider | undefined {
  return providers.get(id);
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

// Phase 1: Central runs on the Letta memory harness (persistent per-room
// session wiki). Other rooms stay on Auto (Goose). Hot-swappable via setRoomRoute.
roomRoutes.set('central', 'letta');

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
export async function resolveHarness(roomId: string): Promise<{
  provider: ChatProvider;
  reason: string;
}> {
  const route = getRoomRoute(roomId);
  if (route !== 'auto') {
    const p = providers.get(route) ?? gooseProvider;
    return { provider: p, reason: `Pinned to ${p.label} for this room.` };
  }
  // Auto: prefer health, fall back to Goose.
  for (const p of providers.values()) {
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
}

export async function providerStatuses(): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const p of providers.values()) {
    const healthy = await p.health().catch(() => false);
    out.push({ id: p.id, label: p.label, blurb: p.blurb, healthy });
  }
  return out;
}
