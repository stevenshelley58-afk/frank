'use client';

import Link from 'next/link';

import type { MissionSnapshot, MissionState, MissionWorkNode } from './types';

const STATE_TONE: Record<MissionState, string> = {
  planning: 'border-accent/30 bg-accent/8 text-accent',
  running: 'border-success/30 bg-success/8 text-success',
  waiting: 'border-[#f59e0b]/30 bg-[#f59e0b]/8 text-[#b45309]',
  completed: 'border-success/30 bg-success/8 text-success',
  failed: 'border-[#dc2626]/30 bg-[#dc2626]/8 text-[#dc2626]',
  cancelled: 'border-line bg-subtle text-muted',
};

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} min` : `${minutes} min ${remainder}s`;
}

function shortId(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 8);
}

function WorkNode({ node, roomId }: { node: MissionWorkNode; roomId: string }) {
  return (
    <li className="rounded-xl border border-line bg-white px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink">{node.title}</p>
          <p className="mt-1 font-mono text-[9.5px] uppercase tracking-wide text-muted">
            {node.state} · {node.modelTier} model · attempt {node.attempts}
            {node.workbenchState ? ` · workbench ${node.workbenchState}` : ''}
          </p>
          {node.dependsOn.length > 0 && (
            <p className="mt-1 truncate font-mono text-[9.5px] text-muted/75">
              after {node.dependsOn.map(shortId).join(', ')}
            </p>
          )}
        </div>
        {node.workbenchId && (
          <Link
            href={`/console/workbench?roomId=${encodeURIComponent(roomId)}&workbenchId=${encodeURIComponent(node.workbenchId)}`}
            aria-label={`Open ${node.title} in Workbench`}
            className="shrink-0 rounded-lg border border-line px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-accent transition-colors hover:bg-subtle"
          >
            Workbench
          </Link>
        )}
      </div>
    </li>
  );
}

export function MissionPanel({
  snapshot,
  pendingObjective,
  restoring,
  submitting,
  stopping,
  error,
}: {
  snapshot: MissionSnapshot | null;
  pendingObjective: string | null;
  restoring: boolean;
  submitting: boolean;
  stopping: boolean;
  error: string | null;
}) {
  if (snapshot === null && !submitting && !restoring && error === null) return null;

  if (snapshot === null) {
    return (
      <section
        className="mx-5 mb-1 rounded-xl border border-line bg-card px-4 py-3 md:mx-7"
        role={error ? 'alert' : 'status'}
        aria-live="polite"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
          {submitting
            ? 'Creating durable mission...'
            : restoring
              ? 'Restoring durable mission...'
              : 'Mission could not be created'}
        </p>
        {pendingObjective && <p className="mt-1.5 line-clamp-2 text-[12.5px] text-ink2">{pendingObjective}</p>}
        {error && <p className="mt-1.5 text-[11.5px] text-[#b42318]">{error}</p>}
      </section>
    );
  }

  const { mission, workGraph } = snapshot;
  return (
    <section
      aria-labelledby="current-mission-title"
      className="mx-5 mb-1 max-h-[42vh] overflow-y-auto rounded-2xl border border-line bg-card shadow-sm md:mx-7"
    >
      <header className="border-b border-line px-4 py-3">
        <h2 id="current-mission-title" className="sr-only">
          Current mission: {mission.objective}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-live="polite"
            className={`rounded-full border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wide ${STATE_TONE[mission.state]}`}
          >
            {stopping ? 'stopping' : mission.state}
          </span>
          <span className="font-mono text-[9.5px] text-muted">mission {shortId(mission.id)}</span>
          <Link
            href={`/console/workbench?roomId=${encodeURIComponent(mission.roomId)}`}
            className="ml-auto font-mono text-[9.5px] uppercase tracking-wide text-accent hover:underline"
          >
            Open Workbench
          </Link>
        </div>
        <p className="mt-2 text-[13px] font-medium leading-snug text-ink">{mission.objective}</p>
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wide text-muted/75">
          {USD.format(mission.budget.spendCapUsd)} cap ·{' '}
          {mission.budget.tokenBudget.toLocaleString()} tokens ·{' '}
          {durationLabel(mission.budget.wallClockSec)} · {mission.budget.maxAttempts} attempts
        </p>
        {mission.lastError && (
          <p role="alert" className="mt-1.5 text-[11.5px] text-[#b42318]">
            {mission.lastError}
          </p>
        )}
        {mission.state === 'failed' && !mission.lastError && (
          <p role="alert" className="mt-1.5 text-[11.5px] text-[#b42318]">
            Mission failed; the durable record returned no error detail.
          </p>
        )}
      </header>

      <div
        role="group"
        aria-label="Durable room to mission to work graph"
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line bg-subtle/50 px-4 py-2.5 text-center"
      >
        <GraphNode label="Room" value={mission.roomName} detail={shortId(mission.roomId)} />
        <span className="text-muted/50" aria-hidden>→</span>
        <GraphNode label="Mission" value={mission.state} detail={shortId(mission.id)} />
        <span className="text-muted/50" aria-hidden>→</span>
        <GraphNode label="Work graph" value={`${workGraph.length} item${workGraph.length === 1 ? '' : 's'}`} detail={workGraph.length === 0 ? 'planning' : 'durable'} />
      </div>

      <div className="px-4 py-3">
        {workGraph.length === 0 ? (
          <p className="text-[11.5px] text-muted">The durable work graph is still being planned.</p>
        ) : (
          <ol className="space-y-2" aria-label="Mission work graph">
            {workGraph.map((node) => (
              <WorkNode key={node.workItemId} node={node} roomId={mission.roomId} />
            ))}
          </ol>
        )}
        <p className="mt-2 text-[10.5px] text-muted/75">
          Evidence and receipts are stored on each linked Workbench as its run finishes.
        </p>
        {error && (
          <p role="status" className="mt-2 text-[11px] text-[#b45309]">
            Status refresh delayed: {error}
          </p>
        )}
      </div>
    </section>
  );
}

function GraphNode({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[8.5px] uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate text-[11px] font-medium text-ink">{value}</p>
      <p className="truncate font-mono text-[8.5px] text-muted/65">{detail}</p>
    </div>
  );
}
