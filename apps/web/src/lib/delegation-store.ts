/**
 * Server-owned delegation store (FRANK spec §7.5 product surface).
 *
 * Delegations are created by the delegate tool (or by Steve approving a
 * proposal), executed here on the server, and streamed to every connected
 * client. State survives page refresh, tab close, and navigation; it does
 * not survive a server restart (Postgres-backed persistence is a later
 * workstream — see docs/plans/BACKLOG.md).
 *
 * Server-only. Never import from a 'use client' module.
 */

import { randomUUID } from 'node:crypto';
import { runTurn } from './harness-session';

export type DelegationStatus = 'proposed' | 'running' | 'done' | 'error' | 'rejected';

export interface Delegation {
  id: string;
  /** Idempotency key from the caller. Duplicate keys are ignored. */
  key: string;
  task: string;
  why: string;
  fromRoomId: string;
  toRoomId: string;
  toRoomName: string;
  agent: string;
  status: DelegationStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Streaming partial text while running. */
  partial: string;
  result?: string;
  error?: string;
}

export type DelegationEvent =
  | { type: 'snapshot'; items: Delegation[] }
  | { type: 'created'; d: Delegation }
  | { type: 'update'; d: Delegation };

/**
 * All mutable state lives on globalThis so every route module shares ONE
 * store. Next.js dev gives each route file its own module instance — a bare
 * module-level Map would fork per route and /api/delegations/[id] would
 * never see what /api/delegations created. (The Prisma dev-singleton trick.)
 */
interface StoreState {
  delegations: Map<string, Delegation>;
  byKey: Map<string, string>; // idempotency key → delegation id
  listeners: Set<(e: DelegationEvent) => void>;
}

const g = globalThis as unknown as { __frankDelegationStore?: StoreState };
if (!g.__frankDelegationStore) {
  g.__frankDelegationStore = {
    delegations: new Map(),
    byKey: new Map(),
    listeners: new Set(),
  };
}
const store = g.__frankDelegationStore;
const { delegations, byKey, listeners } = store;

function emit(e: DelegationEvent) {
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* a dead listener must not break the run */
    }
  }
}

export function subscribe(fn: (e: DelegationEvent) => void): () => void {
  listeners.add(fn);
  fn({ type: 'snapshot', items: list() });
  return () => listeners.delete(fn);
}

export function list(): Delegation[] {
  return [...delegations.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function get(id: string): Delegation | undefined {
  return delegations.get(id);
}

function patch(id: string, p: Partial<Delegation>) {
  const cur = delegations.get(id);
  if (!cur) return;
  const next = { ...cur, ...p };
  delegations.set(id, next);
  emit({ type: 'update', d: next });
}

export interface CreateArgs {
  key: string;
  task: string;
  why: string;
  toRoomId: string;
  toRoomName: string;
  agent: string;
  /** 'sure' runs immediately; 'unsure' waits for Steve to approve. */
  confidence: 'sure' | 'unsure';
}

/**
 * Create a delegation. Idempotent on `key` — calling twice with the same key
 * returns the existing record and does NOT start a second run.
 */
export function create(args: CreateArgs): Delegation {
  const existingId = byKey.get(args.key);
  if (existingId) {
    const existing = delegations.get(existingId);
    if (existing) return existing;
  }

  const d: Delegation = {
    id: randomUUID(),
    key: args.key,
    task: args.task,
    why: args.why,
    fromRoomId: 'central',
    toRoomId: args.toRoomId,
    toRoomName: args.toRoomName,
    agent: args.agent,
    status: args.confidence === 'sure' ? 'running' : 'proposed',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    partial: '',
  };

  delegations.set(d.id, d);
  byKey.set(d.key, d.id);
  emit({ type: 'created', d });

  if (d.status === 'running') void run(d.id);
  return d;
}

/** Steve approved a proposal — start it. */
export function approve(id: string): Delegation | undefined {
  const d = delegations.get(id);
  if (!d || d.status !== 'proposed') return d;
  patch(id, { status: 'running' });
  void run(id);
  return delegations.get(id);
}

/** Steve rejected a proposal — it never runs. */
export function reject(id: string): Delegation | undefined {
  const d = delegations.get(id);
  if (!d || d.status !== 'proposed') return d;
  patch(id, { status: 'rejected', finishedAt: Date.now() });
  return delegations.get(id);
}

async function run(id: string) {
  const d = delegations.get(id);
  if (!d) return;
  patch(id, { startedAt: Date.now(), partial: '' });

  const prompt = [
    `Central delegated this task to you:`,
    ``,
    d.task,
    ``,
    d.why ? `Context from Central: ${d.why}` : '',
    ``,
    `Do the work and give a tight receipt: what you did, what you found, and any decision Steve must make.`,
    `If the task is not concrete enough to act on, say so in one line and name the single thing you need — do not invent work.`,
  ]
    .filter(Boolean)
    .join('\n');

  let acc = '';
  try {
    const { text } = await runTurn({
      roomId: d.toRoomId,
      roomName: d.toRoomName,
      agentName: d.agent,
      prompt,
      onChunk: (c) => {
        acc += c;
        // Throttle: only emit every ~40 chars to avoid flooding SSE.
        if (acc.length % 40 < c.length) patch(id, { partial: acc });
      },
    });
    patch(id, {
      status: 'done',
      result: (text || acc).trim() || 'Acknowledged — working on it.',
      partial: '',
      finishedAt: Date.now(),
    });
  } catch (err) {
    patch(id, { status: 'error', error: String(err), partial: '', finishedAt: Date.now() });
  }
}
