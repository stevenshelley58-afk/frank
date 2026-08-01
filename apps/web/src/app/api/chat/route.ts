/**
 * POST /api/chat — SSE bridge from Frank web to the harness registry.
 *
 * Body: { message: string, roomId?: string, roomName?: string, agentName?: string }
 * Response: text/event-stream with `data: {"text":"..."}` chunks
 *           and a final `data: {"done":true}` event.
 *
 * The harness is resolved per-room through the provider registry (spec §8.4):
 * a room may be pinned to a named harness or left on Auto. Server-side only.
 */

import { NextRequest } from 'next/server';
import { resolveHarness } from '@/lib/providers';
import { identityForRoom } from '@/lib/rooms-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Module-level session cache: roomId → { providerId, sessionId }
const sessions = new Map<string, { providerId: string; sessionId: string }>();
// Rooms whose session has already received the identity primer.
const primed = new Set<string>();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const message = (body as { message?: string })?.message?.trim();
  const roomId = (body as { roomId?: string })?.roomId ?? 'central';
  const roomName = (body as { roomName?: string })?.roomName ?? 'Central';
  const agentName = (body as { agentName?: string })?.agentName ?? 'Frank';

  if (!message) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Resolve the harness for this room (Auto or pinned).
  let provider;
  let reason: string;
  try {
    ({ provider, reason } = await resolveHarness(roomId));
  } catch {
    return new Response(
      JSON.stringify({ error: 'No harness available', fallback: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Get or create a session, re-creating if the harness changed (hot-swap).
  let entry = sessions.get(roomId);
  if (!entry || entry.providerId !== provider.id) {
    try {
      const sessionId = await provider.createSession('/srv/frank/repo');
      entry = { providerId: provider.id, sessionId };
      sessions.set(roomId, entry);
      primed.delete(roomId); // re-prime on a fresh session
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Session create failed: ${err}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
  const activeProvider = provider;

  // Fold per-room identity into the first turn of a fresh session.
  let promptText = message;
  if (!primed.has(roomId)) {
    const identity = identityForRoom(roomId, roomName, agentName);
    promptText = `${identity}\n\n---\nSteve says: ${message}`;
    primed.add(roomId);
  }

  // Stream response as SSE.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let fullText = '';
        for await (const chunk of activeProvider.stream(entry!.sessionId, promptText)) {
          fullText += chunk;
          send({ text: chunk });
        }

        if (!fullText) {
          send({ text: 'Acknowledged. Working on it.' });
        }

        send({ done: true, harness: activeProvider.id, reason });
      } catch (err) {
        send({ error: String(err) });
        sessions.delete(roomId);
        primed.delete(roomId);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
