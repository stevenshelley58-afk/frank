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
  inboundParts,
  onDelegation,
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
 *
 * Chat affordances (this chat / ChatGPT parity): copy lives in Thread,
 * regenerate re-runs the last user turn, and edit-and-resend replaces a
 * user message and everything after it with a fresh run.
 */
export function RoomView({ room, rooms }: { room: Room; rooms: Room[] }) {
  const { api, status } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    room.isHome ? centralSeed() : roomSeed(room.greeting),
  );
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  /** ChatGPT-style edit-and-resend: the user message being rewritten. */
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const timerRef = useRef<number | null>(null);
  /** AbortController for the active Frank stream — powers the Stop button. */
  const abortRef = useRef<AbortController | null>(null);

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

  /**
   * Run one Frank turn against `prompt`: typing bubble, empty frank message,
   * SSE stream into it, delegation detection at the end (Central only).
   * Shared by send / regenerate / edit-and-resend.
   */
  async function runTurn(prompt: string) {
    setSending(true);
    setTyping(true);
    append({ id: uid(), from: 'frank', text: '', at: Date.now() });

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = '';
    let finished = false;

    await frankStream(
      prompt,
      room.id,
      {
        onChunk: (chunk) => {
          accumulated += chunk;
          setTyping(false);
          updateLast(accumulated);
        },
        onDone: () => {
          finished = true;
          abortRef.current = null;
          setTyping(false);
          const final = accumulated || 'Acknowledged. Working on it.';
          if (!accumulated) updateLast(final);
          setSending(false);
        },
        onError: (err) => {
          finished = true;
          setTyping(false);
          // A user-initiated stop surfaces as an abort — keep what arrived.
          const aborted = controller.signal.aborted;
          if (aborted && accumulated) {
            // leave partial text as-is
          } else if (aborted) {
            updateLast('Stopped.');
          } else {
            updateLast(accumulated || `Something went wrong: ${err}`);
          }
          setSending(false);
          abortRef.current = null;
        },
      },
      room.name,
      room.agent,
      controller.signal,
    );

    if (!finished) setSending(false);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // Edit-and-resend: replace the edited message and drop everything after it.
    if (editing) {
      const editId = editing.id;
      setEditing(null);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === editId);
        if (idx < 0) return prev;
        return [...prev.slice(0, idx), { ...prev[idx], text: trimmed, at: Date.now() }];
      });
      await runTurn(trimmed);
      return;
    }

    append({ id: uid(), from: 'steve', text: trimmed, at: Date.now() });

    // Central: durability via domain API (fire-and-forget). Fresh sends only —
    // regenerate/edit must not duplicate the captured command.
    if (room.isHome) {
      api?.('/v1/capture', {
        method: 'POST',
        body: JSON.stringify({ command_id: commandId(), kind: 'text', text: trimmed }),
      }).catch(() => {});
    }

    await runTurn(trimmed);
  }

  /** Regenerate: drop the last frank reply (and what followed), re-run the last user turn. */
  function regenerate() {
    if (sending) return;
    let frankIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].from === 'frank') {
        frankIdx = i;
        break;
      }
    }
    if (frankIdx < 0) return;
    let steveIdx = -1;
    for (let i = frankIdx - 1; i >= 0; i -= 1) {
      if (messages[i].from === 'steve') {
        steveIdx = i;
        break;
      }
    }
    if (steveIdx < 0) return; // no user turn to re-run (e.g. room greeting)
    const prompt = (messages[steveIdx].text ?? '').trim();
    if (!prompt) return;
    setMessages((prev) => prev.slice(0, steveIdx + 1));
    void runTurn(prompt);
  }

  /** Regenerate is only offered when a user turn exists to re-run. */
  const canRegenerate = (() => {
    let frankIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].from === 'frank') {
        frankIdx = i;
        break;
      }
    }
    if (frankIdx < 0) return false;
    for (let i = frankIdx - 1; i >= 0; i -= 1) {
      if (messages[i].from === 'steve') return true;
    }
    return false;
  })();

  function startEdit(msg: ChatMessage) {
    if (sending) return;
    setEditing(msg);
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col">
      {status === 'error' && <AuthErrorCard />}
      <Thread
        messages={messages}
        typing={typing}
        agentName={room.agent}
        onRegenerate={canRegenerate && !sending ? regenerate : undefined}
        onEdit={!sending ? startEdit : undefined}
      />
      <Composer
        room={room}
        disabled={sending}
        running={sending}
        editing={editing}
        onSend={send}
        onStop={stop}
        onCancelEdit={() => setEditing(null)}
        onTyping={() => {}}
      />
    </div>
  );
}
