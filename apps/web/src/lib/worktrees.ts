// Worktrees — shared polling store + hook.
//
// One interval, one in-flight fetch, many subscribers. Any component can
// call useWorktrees() and get the latest snapshot without duplicating
// network traffic. Cache TTL on the server is 2 s; we poll every 4 s so
// every tick gets fresh data.

'use client';

import { useSyncExternalStore } from 'react';

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string | null;
  detached: boolean;
  isCurrent: boolean;
  ahead: number;
  behind: number;
  added: number;
  modified: number;
  deleted: number;
  untracked: number;
  lastSha: string;
  lastSubject: string;
  lastRelative: string;
}

export interface WorktreeSnapshot {
  repo: string;
  trees: WorktreeInfo[];
  generated_at: string;
  error?: string;
}

interface StoreState {
  snap: WorktreeSnapshot | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

let state: StoreState = { snap: null, loading: true, error: null, fetchedAt: null };
const listeners = new Set<() => void>();
let timer: number | null = null;
let flying = false;

function emit() {
  for (const fn of listeners) fn();
}

async function tick() {
  if (flying) return;
  flying = true;
  try {
    const res = await fetch('/api/worktrees', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap: WorktreeSnapshot = await res.json();
    state = { snap, loading: false, error: null, fetchedAt: Date.now() };
  } catch (e) {
    state = { ...state, loading: false, error: e instanceof Error ? e.message : 'fetch failed' };
  } finally {
    flying = false;
    emit();
  }
}

function ensureInterval() {
  if (timer !== null) return;
  tick();
  timer = window.setInterval(tick, 4000);
}

function stopIntervalIfIdle() {
  if (listeners.size === 0 && timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  ensureInterval();
  return () => {
    listeners.delete(cb);
    stopIntervalIfIdle();
  };
}

function getSnapshot(): StoreState {
  return state;
}

/** React hook — subscribe to the shared worktree store (4 s poll). */
export function useWorktrees() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { snap: s.snap, loading: s.loading, error: s.error, fetchedAt: s.fetchedAt };
}

/* ---- helpers ---- */

export function treeDirtyCount(t: WorktreeInfo): number {
  return t.added + t.modified + t.deleted + t.untracked;
}

export function dirtySummary(t: WorktreeInfo): string {
  const parts: string[] = [];
  if (t.added) parts.push(`${t.added}A`);
  if (t.modified) parts.push(`${t.modified}M`);
  if (t.deleted) parts.push(`${t.deleted}D`);
  if (t.untracked) parts.push(`${t.untracked}?`);
  return parts.length ? parts.join(' ') : 'clean';
}

export function agoShort(iso: string): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function relTime(iso: string): string {
  return agoShort(iso);
}
