/**
 * POST /api/chat — SSE bridge from Frank web to Goose ACP.
 *
 * Body: { message: string, roomId?: string, roomName?: string, agentName?: string }
 * Response: text/event-stream with `data: {"text":"..."}` chunks
 *           and a final `data: {"done":true}` event.
 *
 * Server-side only (Node.js runtime). Uses the ACP client in @/lib/goose-server.
 */

import { NextRequest } from 'next/server';
import { createSession, streamMessage, gooseHealth } from '@/lib/goose-server';
import { identityForRoom } from '@/lib/rooms-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Module-level session cache: roomId → goose session id
const sessions = new Map<string, string>();
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

  // Health check
  const healthy = await gooseHealth();
  if (!healthy) {
    return new Response(
      JSON.stringify({ error: 'Goose ACP server unreachable', fallback: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Get or create session
  let sessionId = sessions.get(roomId);
  if (!sessionId) {
    try {
      sessionId = await createSession('/srv/frank/repo');
      sessions.set(roomId, sessionId);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Session create failed: ${err}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // Fold per-room identity into the first turn of a fresh session.
  let promptText = message;
  if (!primed.has(roomId)) {
    const identity = identityForRoom(roomId, roomName, agentName);
    promptText = `${identity}\n\n---\nSteve says: ${message}`;
    primed.add(roomId);
  }

  // Stream response as SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let fullText = '';
        for await (const chunk of streamMessage(sessionId!, promptText)) {
          fullText += chunk;
          send({ text: chunk });
        }

        // If no text was streamed (Goose returned result in final response)
        if (!fullText) {
          send({ text: 'Acknowledged. Working on it.' });
        }

        send({ done: true });
      } catch (err) {
        send({ error: String(err) });
        // Clear broken session so next message retries
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
