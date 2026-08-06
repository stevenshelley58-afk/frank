'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  useWorktrees,
  stageTree,
  dirtySummary,
  treeDirtyCount,
  type WorktreeInfo,
  type WtStage,
  type WtStageInfo,
} from '@/lib/worktrees';

/* ------------------------------------------------------------------ */
/* WorktreesPanel — a graphical, plain-English view of the repo's      */
/* worktree status. Built for a non-technical owner: no git numbers    */
/* on the surface, every tree placed on a visual pipeline              */
/* (building → ready → saved → live). Raw git detail sits behind a     */
/* per-tree "details" toggle. Polls every 4 s via the shared store.    */
/* ------------------------------------------------------------------ */

const TONE_TEXT = {
  running: 'text-running',
  warning: 'text-warning',
  success: 'text-success',
  acid: 'text-acid',
  muted: 'text-muted',
} as const;

const TONE_BG = {
  running: 'bg-running',
  warning: 'bg-warning',
  success: 'bg-success',
  acid: 'bg-acid',
  muted: 'bg-muted',
} as const;

/* Pipeline stops, left → right. Trees slot into one stop by stage. */
const STOPS: { x: number; label: string; stages: readonly WtStage[] }[] = [
  { x: 28, label: 'building', stages: ['working'] },
  { x: 109, label: 'ready', stages: ['ready'] },
  { x: 190, label: 'saved', stages: ['queued', 'parked'] },
  { x: 272, label: 'live', stages: ['live'] },
];

function stopFor(s: WtStageInfo): number {
  return STOPS.findIndex((st) => st.stages.includes(s.stage));
}

/* ---------- The graphical pipeline (SVG) ---------- */

function PipelineGraph({ trees }: { trees: WorktreeInfo[] }) {
  const staged = trees.map((t) => ({ t, s: stageTree(t) }));
  const buckets: { t: WorktreeInfo; s: WtStageInfo }[][] = STOPS.map(() => []);
  for (const item of staged) {
    const i = stopFor(item.s);
    if (i >= 0) buckets[i].push(item);
  }

  const svgDotColor = (s: WtStageInfo) =>
    s.tone === 'muted' ? 'rgb(var(--tw-muted) / 45%)' : `rgb(var(--tw-${s.tone}))`;

  return (
    <svg viewBox="0 0 300 74" className="w-full" role="img" aria-label="Worktree pipeline status">
      {/* track */}
      <line x1="28" y1="40" x2="272" y2="40" stroke="rgb(var(--tw-line))" strokeWidth="1.5" />
      {/* stop ticks + labels */}
      {STOPS.map((st, i) => (
        <g key={st.label}>
          <circle
            cx={st.x}
            cy="40"
            r="3"
            fill={buckets[i].length > 0 ? 'rgb(var(--tw-ink) / 55%)' : 'rgb(var(--tw-line))'}
          />
          <text
            x={st.x}
            y="66"
            textAnchor="middle"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '7.5px', letterSpacing: '0.1em' }}
            fill="rgb(var(--tw-muted))"
          >
            {st.label.toUpperCase()}
          </text>
        </g>
      ))}
      {/* tree dots, stacked up from the track */}
      {buckets.map((bucket) =>
        bucket.map(({ t, s }, i) => (
          <g key={t.path}>
            {s.stage === 'live' && (
              <circle cx={STOPS[stopFor(s)].x} cy={40 - i * 15} r="10" fill={svgDotColor(s)} opacity="0.25" className="animate-pulse" />
            )}
            <circle
              cx={STOPS[stopFor(s)].x}
              cy={40 - i * 15}
              r="6"
              fill={svgDotColor(s)}
              stroke="rgb(var(--tw-shell))"
              strokeWidth="1.5"
            >
              <title>{`${t.name} — ${s.label}`}</title>
            </circle>
          </g>
        )),
      )}
    </svg>
  );
}

/* ---------- Plain-English cards ---------- */

const STAGE_ORDER: Record<string, number> = { working: 0, ready: 1, live: 2, queued: 3, parked: 4 };

function headline(trees: WorktreeInfo[]): string {
  const stages = trees.map((t) => stageTree(t).stage);
  const ready = stages.filter((s) => s === 'ready').length;
  const working = stages.filter((s) => s === 'working').length;
  if (ready > 0) return `${ready} change${ready > 1 ? 's' : ''} ready to publish`;
  if (working > 0) return `${working} thing${working > 1 ? 's' : ''} being worked on`;
  return 'All quiet — nothing waiting on you';
}

function TreeCard({ t, s, expanded, onToggle }: {
  t: WorktreeInfo;
  s: WtStageInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-t border-line/70 py-2 first:border-t-0">
      <button onClick={onToggle} className="flex w-full items-start gap-2 text-left" aria-expanded={expanded}>
        <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${TONE_BG[s.tone]}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <b className={`text-[11.5px] font-semibold ${TONE_TEXT[s.tone]}`}>{s.label}</b>
            <span className="shrink-0 font-mono text-[9px] text-muted/60">{t.lastRelative}</span>
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink/85">{s.sentence}</span>
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 rounded-lg bg-frame/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
          <div>tree: {t.name} · branch: {t.branch ?? '(detached)'}</div>
          {t.ahead > 0 && <div>{t.ahead} commit{t.ahead > 1 ? 's' : ''} ahead of live · {t.behind > 0 ? `${t.behind} behind` : '0 behind'}</div>}
          <div>files: {dirtySummary(t)}</div>
          <div>last: {t.lastSha} {t.lastSubject}</div>
        </div>
      )}
    </div>
  );
}

/** Desktop widget body (sits inside a <Widget> in the frame). */
export function WorktreesBody() {
  const { snap, loading, error } = useWorktrees();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading && !snap) {
    return <p className="text-[12.5px] text-muted">Reading your project status…</p>;
  }
  if (error && !snap) {
    return <p className="text-[12.5px] text-danger">⚠ {error}</p>;
  }
  if (!snap || snap.trees.length === 0) {
    return <p className="text-[12.5px] text-muted">No project trees found.</p>;
  }

  const ordered = [...snap.trees].sort(
    (a, b) => (STAGE_ORDER[stageTree(a).stage] ?? 9) - (STAGE_ORDER[stageTree(b).stage] ?? 9),
  );

  return (
    <div>
      <PipelineGraph trees={snap.trees} />
      <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted/70">
        {headline(snap.trees)}
      </p>
      {ordered.map((t) => (
        <TreeCard
          key={t.path}
          t={t}
          s={stageTree(t)}
          expanded={expanded === t.path}
          onToggle={() => setExpanded(expanded === t.path ? null : t.path)}
        />
      ))}
      <p className="pt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted/50">
        live · updates every 4 s
      </p>
    </div>
  );
}

/* ---------- Mobile full-screen sheet ---------- */

export function WorktreesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  /* Track A4: migrated from a hand-rolled fixed overlay to the vendored
     shadcn Sheet (Radix Dialog). What this buys: focus trap on open,
     Escape-to-close, focus return to the trigger, scroll lock, and the
     aria-dialog wiring — none of which the old div had. */
  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent
        side="bottom"
        className="flex h-[85dvh] max-w-none flex-col rounded-t-xl border-line bg-shell p-0 lg:hidden"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink">
            Code status
          </span>
        </div>
        <SheetDescription className="sr-only">
          A plain-English view of your project worktrees — building, ready, saved, live.
        </SheetDescription>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <WorktreesBody />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Compact mobile chip — plain-English summary + opens the sheet. */
export function WorktreesChip({ onClick }: { onClick: () => void }) {
  const { snap } = useWorktrees();
  const trees = snap?.trees ?? [];
  const stages = trees.map((t) => stageTree(t));
  const ready = stages.filter((s) => s.stage === 'ready').length;
  const working = stages.filter((s) => s.stage === 'working').length;

  const summary =
    ready > 0 ? `${ready} ready` : working > 0 ? `${working} building` : 'all live';
  const dot = ready > 0 ? 'bg-warning' : working > 0 ? 'bg-running' : 'bg-success';

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-frame/60 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-muted transition-all hover:border-accent/50 hover:text-accent"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {trees.length} tree{trees.length !== 1 ? 's' : ''} · {summary}
    </button>
  );
}
