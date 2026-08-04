// S4 Delegation — client-side delegation store + cross-room dispatch.
//
// Central's Goose is instructed to delegate by emitting a room handle
// (@blockwise, @chase, or an ad-hoc room id) inline in its reply. The UI
// parses the streamed text, creates a delegation record, and the STORE runs
// the task in the target room with that room's scoped identity — regardless
// of which room the user is currently viewing. Everything is visible: a
// delegation card in Central's thread, live rows in the Running panel, and
// a receipt back in Central and in the target room's thread.
//
// The store owns execution so delegations never drop when a room is unmounted.
// Rooms subscribe purely for display. (The full kernel-grade version — signed
// Action Envelopes, Capability Broker, isolated workspaces, FRANK spec §7.5 /
// §8 — lands later; this is the product surface for it.)

import { frankStream, uid, type TextPart } from './frank';

export type DelegationStatus = 'running' | 'done' | 'error';

export interface Delegation {
  id: string;
  task: string;
  fromRoomId: string; // 'central'
  toRoomId: string;
  toRoomName: string;
  agent: string;
  tint: string;
  status: DelegationStatus;
  startedAt: number;
  result?: string;
  error?: string;
}

type DelegationEvent =
  | { type: 'created'; d: Delegation }
  | { type: 'update'; d: Delegation };

const listeners = new Set<(e: DelegationEvent) => void>();
const delegations = new Map<string, Delegation>();

function emit(e: DelegationEvent) {
  for (const l of listeners) l(e);
}

export function onDelegation(fn: (e: DelegationEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listDelegations(): Delegation[] {
  return [...delegations.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function activeDelegations(): Delegation[] {
  return listDelegations().filter((d) => d.status === 'running');
}

/* ------------------------------------------------------------------ */
/* Dispatch — the store owns execution so runs never drop              */
/* ------------------------------------------------------------------ */

export function dispatchDelegation(p: {
  roomId: string;
  roomName: string;
  agent: string;
  tint: string;
  task: string;
}): Delegation {
  const d: Delegation = {
    id: uid(),
    task: p.task,
    fromRoomId: 'central',
    toRoomId: p.roomId,
    toRoomName: p.roomName,
    agent: p.agent,
    tint: p.tint,
    status: 'running',
    startedAt: Date.now(),
  };
  delegations.set(d.id, d);
  emit({ type: 'created', d });

  // Run the task in the target room with its scoped identity.
  void runTask(d);
  return d;
}

async function runTask(d: Delegation) {
  let acc = '';
  await frankStream(
    `Central delegated this task to you: ${d.task}\n\nDo the work and give a tight receipt (what you did, what you found, any decision Steve must make).`,
    d.toRoomId,
    {
      onChunk: (c) => {
        acc += c;
      },
      onDone: () => {
        const result = acc.trim() || 'Acknowledged — working on it.';
        patch(d.id, { status: 'done', result });
      },
      onError: (err) => {
        patch(d.id, { status: 'error', error: err });
      },
    },
    d.toRoomName,
    d.agent,
  );
}

function patch(id: string, p: Partial<Delegation>) {
  const cur = delegations.get(id);
  if (!cur) return;
  const next = { ...cur, ...p };
  delegations.set(id, next);
  emit({ type: 'update', d: next });
}

/* ------------------------------------------------------------------ */
/* Thread rendering helpers                                            */
/* ------------------------------------------------------------------ */

/** Delegation kickoff card for Central's thread. */
export function delegationParts(d: Delegation): TextPart[] {
  return [
    { text: `Delegated to ${d.agent}: `, strong: true },
    { text: d.task + ' — ' },
    { text: 'running', strong: true },
    { text: ` in the ${d.toRoomName} room. Receipt lands here when verified.` },
  ];
}

/** Receipt card once the target room finishes (or errors). */
export function receiptParts(d: Delegation): TextPart[] {
  if (d.status === 'error') {
    return [
      { text: `${d.agent} hit a snag: `, strong: true },
      { text: d.error ?? 'unknown error' },
    ];
  }
  return [
    { text: `Receipt from ${d.agent}: `, strong: true },
    { text: d.result ?? 'done.' },
  ];
}

/** Inbound card for the target room's thread. */
export function inboundParts(d: Delegation): TextPart[] {
  return [
    { text: `From Central: `, strong: true },
    { text: d.task },
  ];
}

/* ------------------------------------------------------------------ */
/* React hook — subscribe to the live delegation list                  */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from 'react';

/** Live-updating delegation list for widgets (Running panel). */
export function useDelegations(): Delegation[] {
  const [items, setItems] = useState<Delegation[]>(() => listDelegations());
  useEffect(() => {
    const off = onDelegation(() => setItems(listDelegations()));
    return off;
  }, []);
  return items;
}
