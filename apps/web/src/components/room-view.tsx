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
import {
  delegationParts,
  dispatchDelegation,
  inboundParts,
  onDelegation,
  parseDelegations,
  receiptParts,
} from '@/lib/delegation';
import { AuthErrorCard, useAuth } from '@/components/providers';
import { Thread } from './thread';
import { Composer } from './composer';

/**
 * A room view: header · thread · composer.
 *
 * Central streams from Goose and parses delegations out of Frank's reply;
 * the store runs each delegation in its target room. Both Central and the
 * target room subscribe to delegation events purely for display — kickoff
 * cards, inbound cards, and receipts all stream into the right threads.
 */
export function RoomView({ room, rooms }: { room: Room; rooms: Room[] }) {
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

  const updateLast = (text: string) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.from === 'frank') {
        return [...prev.slice(0, -1), { ...last, text }];
      }
      return prev;
    });

  // Subscribe to delegation events for display only.
  useEffect(() => {
    const off = onDelegation((e) => {
      const d = e.d;
      if (room.isHome) {
        // Central shows kickoff on create and receipt on completion.
        if (e.type === 'created') {
          append({ id: uid(), from: 'mention', parts: delegationParts(d), at: Date.now() });
        } else if (e.type === 'update' && d.status !== 'running') {
          append({ id: uid(), from: 'mention', parts: receiptParts(d), at: Date.now() });
        }
      } else if (d.toRoomId === room.id) {
        // Target room shows the inbound task, then the receipt.
        if (e.type === 'created') {
          append({ id: uid(), from: 'mention', parts: inboundParts(d), at: Date.now() });
        } else if (e.type === 'update' && d.status !== 'running') {
          append({
            id: uid(),
            from: 'frank',
            text: d.status === 'error' ? `Hit a snag: ${d.error ?? 'unknown error'}` : (d.result ?? 'Done.'),
            at: Date.now(),
          });
        }
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, room.isHome]);

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

    setTyping(true);
    append({ id: uid(), from: 'frank', text: '', at: Date.now() });

    let accumulated = '';
    let finished = false;

    await frankStream(
      trimmed,
      room.id,
      {
        onChunk: (chunk) => {
          accumulated += chunk;
          setTyping(false);
          updateLast(accumulated);
        },
        onDone: () => {
          finished = true;
          setTyping(false);
          const final = accumulated || 'Acknowledged. Working on it.';
          if (!accumulated) updateLast(final);
          setSending(false);
          if (room.isHome) detectDelegations(final);
        },
        onError: (err) => {
          finished = true;
          setTyping(false);
          updateLast(accumulated || `Something went wrong: ${err}`);
          setSending(false);
        },
      },
      room.name,
      room.agent,
    );

    if (!finished) setSending(false);
  }

  function detectDelegations(frankText: string) {
    for (const p of parseDelegations(frankText, rooms)) {
      dispatchDelegation(p);
    }
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
