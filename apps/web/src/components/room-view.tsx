'use client';

import { useEffect, useRef, useState } from 'react';
import type { Room } from '@/lib/rooms';
import {
  centralSeed,
  commandId,
  frankStream,
  roomSeed,
  uid,
  type ChatMessage,
} from '@/lib/frank';
import { AuthErrorCard, useAuth } from '@/components/providers';
import { Thread } from './thread';
import { Composer } from './composer';

/**
 * A room view: header · thread · composer.
 *
 * Every room streams from Goose via /api/chat. Central captures to the
 * domain API for durability; project rooms stream with a scoped identity
 * (reads everywhere, writes only inside the project).
 */
export function RoomView({ room }: { room: Room }) {
  const { api, status } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    room.isHome ? centralSeed() : roomSeed(room.greeting),
  );
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const append = (m: ChatMessage) => setMessages((prev) => [...prev, m]);

  /** Update the last frank message's text (for streaming). */
  const updateLast = (text: string) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.from === 'frank') {
        return [...prev.slice(0, -1), { ...last, text }];
      }
      return prev;
    });

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    append({ id: uid(), from: 'steve', text: trimmed, at: Date.now() });

    // Central: durability via domain API (fire-and-forget)
    if (room.isHome) {
      api?.('/v1/capture', {
        method: 'POST',
        body: JSON.stringify({ command_id: commandId(), kind: 'text', text: trimmed }),
      }).catch(() => {});
    }

    // All rooms: stream from Goose with per-room identity
    setTyping(true);
    append({ id: uid(), from: 'frank', text: '', at: Date.now() });

    let accumulated = '';
    let finished = false;

    await frankStream(trimmed, room.id, {
      onChunk: (chunk) => {
        accumulated += chunk;
        setTyping(false);
        updateLast(accumulated);
      },
      onDone: () => {
        finished = true;
        setTyping(false);
        if (!accumulated) updateLast('Acknowledged. Working on it.');
        setSending(false);
      },
      onError: (err) => {
        finished = true;
        setTyping(false);
        updateLast(accumulated || `Something went wrong: ${err}`);
        setSending(false);
      },
    }, room.name, room.agent);

    if (!finished) setSending(false);
  }

  return (
    <div className="flex h-full flex-col">
      {status === 'error' && <AuthErrorCard />}
      <Thread messages={messages} typing={typing} agentName={room.agent} />
      <Composer
        room={room}
        disabled={sending}
        onSend={send}
        onTyping={() => {}}
      />
    </div>
  );
}
