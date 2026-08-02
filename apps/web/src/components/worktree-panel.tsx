'use client';

import { useState } from 'react';
import {
  useWorktrees,
  dirtySummary,
  treeDirtyCount,
  relTime,
  type WorktreeInfo,
} from '@/lib/worktrees';

/* ------------------------------------------------------------------ */
/* WorktreesPanel — live git worktree status.                          */
/* Polls every 4 s via the shared store. Desktop: always-visible       */
/* widget. Mobile: compact chip + full-screen sheet.                   */
/* ------------------------------------------------------------------ */

/** Desktop widget body (sits inside a <Widget> in the frame). */
export function WorktreesBody() {
  const { snap, loading, error } = useWorktrees();

  if (loading && !snap) {
    return <p className="text-[12.5px] text-muted">Reading worktrees…</p>;
  }
  if (error && !snap) {
    return <p className="text-[12.5px] text-red-400">⚠ {error}</p>;
  }
  if (!snap || snap.trees.length === 0) {
    return <p className="text-[12.5px] text-muted">No worktrees found.</p>;
  }

  return (
    <div className="space-y-0">
      {snap.trees.map((t, i) => (
        <TreeRow key={t.path} tree={t} first={i === 0} />
      ))}
      <p className="pt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted/50">
        live · {snap.trees.length} tree{snap.trees.length > 1 ? 's' : ''} · poll 4 s
      </p>
    </div>
  );
}

function TreeRow({ tree: t, first }: { tree: WorktreeInfo; first: boolean }) {
  const dirty = treeDirtyCount(t);
  return (
    <div className={`flex items-start gap-2 py-[7px] ${first ? '' : 'border-t border-line/70'}`}>
      {/* status dot */}
      <span
        className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${
          t.isCurrent
            ? 'bg-emerald-400 ring-2 ring-emerald-400/30'
            : dirty > 0
              ? 'bg-amber-400'
              : 'bg-muted/40'
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <b className="truncate text-[12px] font-semibold text-ink">{t.name}</b>
          {t.isCurrent && (
            <span className="shrink-0 rounded bg-accent/15 px-1 py-px font-mono text-[8px] font-bold uppercase tracking-wider text-accent">
              here
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted/70">
          <span className="truncate">{t.branch ?? '(detached)'}</span>
          {t.ahead > 0 && <span className="text-emerald-400">↑{t.ahead}</span>}
          {t.behind > 0 && <span className="text-red-400">↓{t.behind}</span>}
        </div>
        {dirty > 0 && (
          <div className="mt-0.5 font-mono text-[10px] text-amber-400/80">{dirtySummary(t)}</div>
        )}
      </div>
      <span className="shrink-0 font-mono text-[9px] text-muted/50">{t.lastRelative}</span>
    </div>
  );
}

/* ---------- Mobile full-screen sheet ---------- */

export function WorktreesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-shell lg:hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink">
          Worktrees
        </span>
        <button
          onClick={onClose}
          aria-label="Close worktrees"
          className="rounded-lg px-2 py-1 text-lg text-muted transition-colors hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <WorktreesBody />
      </div>
    </div>
  );
}

/** Compact mobile chip — shows count + opens the sheet. */
export function WorktreesChip({ onClick }: { onClick: () => void }) {
  const { snap } = useWorktrees();
  const count = snap?.trees.length ?? 0;
  const dirtyTrees = snap?.trees.filter((t) => treeDirtyCount(t) > 0).length ?? 0;

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-frame/60 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-muted transition-all hover:border-accent/50 hover:text-accent"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dirtyTrees > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`}
      />
      {count} tree{count !== 1 ? 's' : ''}
      {dirtyTrees > 0 && <span className="text-amber-400">· {dirtyTrees} dirty</span>}
    </button>
  );
}
