'use client';

/**
 * Dev preview of the workbench surfaces (UI-07) — no backend required.
 *
 * Renders the SAME components the console uses, driven by fixture data in
 * the exact contract envelope shape ({ seq, type, at, payload }) through a
 * mock EventSource: `event: snapshot` first, then timed live events. This
 * makes the snapshot → live → seq-dedupe behavior verifiable standalone.
 *
 * "Simulate reconnect" remounts the stream with a fresh mock EventSource:
 * the snapshot replays, live events replay, and seq-dedupe must keep the
 * rendered log identical — the core UI-07 reconnect guarantee.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { EmptyState, RunningEntry, useListNavigation } from '@/lib/workbench/components';
import { WorkbenchDetailPanel } from '@/lib/workbench/detail';
import {
  DONE_SNAPSHOT,
  ROOM_WORKBENCHES,
  RUNNING_LIVE,
  RUNNING_SNAPSHOT,
  WAITING_SNAPSHOT,
} from '@/lib/workbench/fixtures';
import { createMockEventSourceFactory, makeScript } from '@/lib/workbench/mock-stream';
import { useWorkbenchEvents } from '@/lib/workbench/use-workbench-events';
import {
  type WorkbenchEvent,
  type WorkbenchRecord,
  workbenchTaskTitle,
} from '@/lib/workbench/types';

/* Fixture → mock SSE script, keyed by workbench id. */
const SCRIPTS: Record<string, { snapshot: WorkbenchEvent[]; live: WorkbenchEvent[] }> = {
  'wb-demo-running': { snapshot: RUNNING_SNAPSHOT, live: RUNNING_LIVE },
  'wb-demo-waiting': { snapshot: WAITING_SNAPSHOT, live: [] },
  'wb-demo-done': { snapshot: DONE_SNAPSHOT, live: [] },
};

function MockRunningEntry({
  record,
  selected,
  onOpen,
  onReconnect,
}: {
  record: WorkbenchRecord;
  selected: boolean;
  onOpen: () => void;
  onReconnect: () => void;
}) {
  // One stable factory per workbench id.
  const factory = useMemo(() => {
    const script = SCRIPTS[record.id] ?? { snapshot: [], live: [] };
    return createMockEventSourceFactory(makeScript(script.snapshot, script.live));
  }, [record.id]);

  const { state, lifecycle, progress, elapsedLabel, isTerminal, stop, status, duplicates } =
    useWorkbenchEvents(record.id, { factory });

  return (
    <div>
      <RunningEntry
        roomName="Blockwise"
        taskTitle={workbenchTaskTitle(record) || record.id}
        state={state}
        lifecycle={lifecycle}
        progress={progress}
        elapsedLabel={elapsedLabel}
        isTerminal={isTerminal}
        selected={selected}
        onOpen={onOpen}
        onStop={async () => {
          // Dev mode: no backend exists — POST goes nowhere. Terminality
          // must still come from SSE events, so the run stays open.
          await stop('Stopped from the dev preview (mock — no backend)').catch(() => undefined);
        }}
      />
      {selected && (
        <div className="mt-1 flex items-center gap-2 px-1 text-[10.5px] text-muted/70">
          <span>stream: {status}</span>
          {duplicates > 0 && <span>· deduped {duplicates} replayed event(s)</span>}
          <button
            type="button"
            onClick={onReconnect}
            className="rounded font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            simulate reconnect
          </button>
        </div>
      )}
    </div>
  );
}

function MockDetail({ record }: { record: WorkbenchRecord }) {
  const factory = useMemo(() => {
    const script = SCRIPTS[record.id] ?? { snapshot: [], live: [] };
    return createMockEventSourceFactory(makeScript(script.snapshot, script.live));
  }, [record.id]);

  const wb = useWorkbenchEvents(record.id, { factory });
  return (
    <WorkbenchDetailPanel
      title={workbenchTaskTitle(record) || record.id}
      roomName="Blockwise"
      state={wb.state}
      streamStatus={wb.status}
    />
  );
}

export function WorkbenchPreview() {
  const [items] = useState<WorkbenchRecord[]>(ROOM_WORKBENCHES);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>('wb-demo-running');
  // Bump to force remount (simulated reconnect) — proves snapshot-then-live
  // rehydration without duplicate events.
  const [epoch, setEpoch] = useState(0);
  // Fixture timestamps are now-relative (module load); render only after
  // mount so SSR HTML never diverges from the client tree (hydration).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((w) => workbenchTaskTitle(w).toLowerCase().includes(q) || w.id.includes(q));
  }, [items, filter]);

  const nav = useListNavigation(visible.length);
  const selected = visible.find((w) => w.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[10px] uppercase">
          dev preview
        </Badge>
        <Badge variant="secondary" className="font-mono text-[10px] uppercase text-muted">
          fixture data
        </Badge>
      </div>
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold text-ink">Workbench — surfaces preview</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          The Running list, waiting surface, and detail view against scripted events. No backend —
          everything is the frozen-contract envelope driven through a mock EventSource.
        </p>
        <p className="mt-1 text-[12px]">
          Real console:{' '}
          <Link href="/console/workbench" className="text-accent underline-offset-2 hover:underline">
            /console/workbench
          </Link>
        </p>
      </div>

      {/* Filter + reconnect */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Filter workbenches…"
          aria-label="Filter workbenches by title"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-xs rounded-md border border-line bg-white px-3 text-[13px] text-ink placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setEpoch((e) => e + 1)}
          aria-label="Simulate a reconnect for all streams"
        >
          Reconnect all
        </Button>
        <span className="text-[11px] text-muted/70">
          Reconnect replays snapshot + live events; seq-dedupe must keep the log clean.
        </span>
      </div>

      {visible.length === 0 || !mounted ? (
        mounted ? (
          <EmptyState title="No workbenches match" body="Clear the filter to see the demo runs." />
        ) : (
          <div className="space-y-2" aria-label="Loading demo workbenches">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )
      ) : (
        <div onKeyDown={nav.onKeyDown}>
          <div
            role="list"
            aria-label="Demo workbenches — use arrow keys to move between runs"
            className="space-y-2"
          >
            {visible.map((item, i) => (
              <div key={`${item.id}:${epoch}`}>
                <MockRunningEntry
                  record={item}
                  selected={item.id === selectedId}
                  onOpen={() => {
                    nav.setActive(i);
                    setSelectedId((cur) => (cur === item.id ? null : item.id));
                  }}
                  onReconnect={() => setEpoch((e) => e + 1)}
                />
              </div>
            ))}
          </div>

          {selected && (
            <div className="mt-4">
              <MockDetail key={`${selected.id}:${epoch}`} record={selected} />
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-[11px] text-muted/70">
        Waiting runs link their decision work item — resolution happens there via the command
        envelope, never in this surface.
      </p>
    </div>
  );
}
