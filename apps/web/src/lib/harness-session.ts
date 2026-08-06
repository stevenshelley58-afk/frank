/**
 * Server-side harness turn runner.
 *
 * Owns the per-room session cache and the identity primer, so BOTH the chat
 * route and the delegation runner execute turns the same way. Server-only —
 * never import this from a 'use client' module.
 */

import { resolveHarness } from './providers';
import { identityForRoom } from './rooms-identity';
import { startRoomTurn, endRoomTurn } from './room-activity';

// roomId → { providerId, sessionId }
const sessions = new Map<string, { providerId: string; sessionId: string }>();
// Rooms whose session has already received the identity primer.
const primed = new Set<string>();

export interface TurnMeta {
  harness: string;
  reason: string;
  /** What model the harness reports it is running (cheap per-turn read). */
  modelInfo: { provider: string | null; model: string | null };
}

export interface RunTurnArgs {
  roomId: string;
  roomName: string;
  agentName: string;
  /** Text sent to the model. Callers fold in memory/pack blocks themselves. */
  prompt: string;
  onChunk: (text: string) => void;
}

/** Reset a room's session (used when a turn errors). */
export function dropSession(roomId: string): void {
  sessions.delete(roomId);
  primed.delete(roomId);
}

/**
 * Run one turn for a room. Returns the full text plus which harness ran it.
 * Throws on session-create or stream failure.
 */
export async function runTurn(args: RunTurnArgs): Promise<{ text: string; meta: TurnMeta }> {
  const { roomId, roomName, agentName, prompt, onChunk } = args;

  const { provider, reason } = await resolveHarness(roomId);

  let identityText: string | null = null;
  if (!primed.has(roomId)) {
    identityText = identityForRoom(roomId, roomName, agentName);
  }

  let entry = sessions.get(roomId);
  if (!entry || entry.providerId !== provider.id) {
    const sessionArg =
      provider.id === 'letta' ? `${roomId}|${identityText ?? ''}` : '/srv/frank/repo';
    const sessionId = await provider.createSession(sessionArg);
    entry = { providerId: provider.id, sessionId };
    sessions.set(roomId, entry);
    primed.delete(roomId);
  }

  let promptText = prompt;
  if (!primed.has(roomId) && identityText !== null && provider.id !== 'letta') {
    promptText = `${identityText}\n\n---\n${prompt}`;
  }
  if (!primed.has(roomId)) primed.add(roomId);

  startRoomTurn(roomId);
  let fullText = '';
  try {
    for await (const chunk of provider.stream(entry.sessionId, promptText)) {
      fullText += chunk;
      onChunk(chunk);
    }
    endRoomTurn(roomId, { snippet: fullText });
    // Cheap per-turn read — lets the UI show the real model behind the harness.
    const modelInfo = await provider.modelInfo().catch(() => ({ provider: null, model: null }));
    return { text: fullText, meta: { harness: provider.id, reason, modelInfo } };
  } catch (err) {
    endRoomTurn(roomId, { error: String(err) });
    dropSession(roomId);
    throw err;
  }
}
