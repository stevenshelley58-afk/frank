'use client';

/**
 * Workbench console — Running surface + detail view (UI-07).
 *
 * Data flow (frozen contract):
 *  - room picker -> same-origin BFF list -> Running entries;
 *  - each entry opens an SSE stream through the same-origin BFF
 *    (snapshot first, then live; seq-dedupe makes reconnects clean);
 *  - opening an entry expands the detail view (raw event log, artifacts,
 *    receipt);
 *  - Stop -> BFF POST with a command id and reason.
 *
 * The WB backend may not be live yet; fetch failures degrade to a clear
 * "API not reachable" state that links to the fixture-driven dev preview.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_ROOMS } from '@/lib/rooms';
import { EmptyState, RunningEntry, useListNavigation } from '@/lib/workbench/components';
import { WorkbenchDetailPanel } from '@/lib/workbench/detail';
import { mergeWorkbenchDetail } from '@/lib/workbench/run-state';
import { useWorkbenchDetail } from '@/lib/workbench/use-workbench-detail';
import { useWorkbenchEvents } from '@/lib/workbench/use-workbench-events';
import {
  type WorkbenchRecord,
  workbenchTaskTitle,
  WORKBENCH_API,
} from '@/lib/workbench/types';

/* ------------------------------------------------------------------ */
/* One live Running entry — owns its SSE stream.                       */
/* ------------------------------------------------------------------ */

function LiveRunningEntry({
  record,
  roomName,
  selected,
  onOpen,
}: {
  record: WorkbenchRecord;
  roomName: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const { state, lifecycle, progress, elapsedLabel, isTerminal, stop } = useWorkbenchEvents(record.id);
  const title = workbenchTaskTitle(record) || record.id;

  return (
    <RunningEntry
      roomName={roomName}
      taskTitle={title}
      state={state}
      lifecycle={lifecycle}
      progress={progress}
      elapsedLabel={elapsedLabel}
      isTerminal={isTerminal}
      selected={selected}
      onOpen={onOpen}
      onStop={async () => {
        const res = await stop('Stopped from the Workbench console');
        if (!res.ok) console.error(`[workbench] stop failed: ${res.error}`);
      }}
    />
  );
}

/** Detail view for the selected run — raw events + artifacts + receipt. */
function LiveDetail({ record, roomName }: { record: WorkbenchRecord; roomName: string }) {
  const wb = useWorkbenchEvents(record.id);
  // Receipt contents live in the durable detail row, not the SSE event
  // payload. Refresh after a receipt/terminal event instead of polling the
  // detail endpoint on every step update.
  const durableRefreshKey = useMemo(() => {
    let latest: number | null = null;
    for (const event of wb.state.events) {
      if (
        event.type === 'receipt_published' ||
        event.type === 'completed' ||
        event.type === 'failed' ||
        event.type === 'cancelled' ||
        event.type === 'timed_out'
      ) {
        latest = event.seq;
      }
    }
    return latest;
  }, [wb.state.events]);
  const durable = useWorkbenchDetail(record.id, durableRefreshKey);
  const state = useMemo(
    () => mergeWorkbenchDetail(wb.state, durable.detail),
    [wb.state, durable.detail],
  );
  const title = workbenchTaskTitle(durable.detail?.workbench ?? record) || record.id;
  return (
    <WorkbenchDetailPanel
      title={title}
      roomName={roomName}
      state={state}
      streamStatus={wb.status}
    >
      {durable.loading && (
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
          Loading durable receipt...
        </p>
      )}
      {durable.error && (
        <p className="border-t border-line px-4 py-2 text-[11px] text-[#b45309]">
          Durable detail unavailable ({durable.error}). Live events are still shown above.
        </p>
      )}
    </WorkbenchDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Console body                                                         */
/* ------------------------------------------------------------------ */

export function WorkbenchConsole({
  initialRoomId = 'central',
  initialWorkbenchId = null,
}: {
  initialRoomId?: string;
  initialWorkbenchId?: string | null;
}) {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<WorkbenchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkbenchId);
  const isKnownRoom = DEFAULT_ROOMS.some((room) => room.id === roomId);

  const roomName = useMemo(
    () =>
      DEFAULT_ROOMS.find((r) => r.id === roomId)?.name ??
      `Mission room ${roomId.length > 12 ? roomId.slice(0, 8) : roomId}`,
    [roomId],
  );

  useEffect(() => {
    setRoomId(initialRoomId);
  }, [initialRoomId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(WORKBENCH_API.listForRoom(roomId), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WorkbenchRecord[] | { workbenches?: WorkbenchRecord[] };
      // GAP: the contract does not pin the list envelope — accept either a
      // bare array or { workbenches: [...] }.
      setItems(Array.isArray(data) ? data : (data.workbenches ?? []));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    setLoading(true);
    setSelectedId(roomId === initialRoomId ? initialWorkbenchId : null);
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [initialRoomId, initialWorkbenchId, load, roomId]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((w) => workbenchTaskTitle(w).toLowerCase().includes(q) || w.id.includes(q));
  }, [items, filter]);

  const nav = useListNavigation(visible.length);
  const selected = visible.find((w) => w.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold text-ink">Workbench</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Frank&apos;s delegated runs — step-by-step progress, live events, artifacts, receipts.
        </p>
      </div>

      {/* Room picker + filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger className="h-8 w-56 text-[13px]" aria-label="Pick a room">
            <SelectValue placeholder="Room" />
          </SelectTrigger>
          <SelectContent>
            {DEFAULT_ROOMS.map((room) => (
              <SelectItem key={room.id} value={room.id} className="text-[13px]">
                {room.name}
              </SelectItem>
            ))}
            {!isKnownRoom && (
              <SelectItem value={roomId} className="text-[13px]">
                {roomName}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter workbenches…"
          aria-label="Filter workbenches by title"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-xs text-[13px]"
        />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5 px-4 py-3 text-[12.5px] text-[#b45309]">
          Workbench API not reachable ({error}). The backend ships with WB-05 — until then, the
          surfaces run against fixtures:{' '}
          <Link
            href="/dev/workbench-preview"
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            open the dev preview
          </Link>
          .
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-label="Loading workbenches">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={error ? 'No data — API unreachable' : `No workbenches in ${roomName}`}
          body={
            error
              ? 'See the fixture-driven dev preview for the full surface.'
              : 'Delegated runs for this room will appear here while they execute.'
          }
        />
      ) : (
        <div onKeyDown={nav.onKeyDown}>
          <div
            role="list"
            aria-label={`Workbenches in ${roomName} — use arrow keys to move between runs`}
            className="space-y-2"
          >
            {visible.map((item, i) => (
              <LiveRunningEntry
                key={item.id}
                record={item}
                roomName={roomName}
                selected={item.id === selectedId}
                onOpen={() => {
                  nav.setActive(i);
                  setSelectedId((cur) => (cur === item.id ? null : item.id));
                }}
              />
            ))}
          </div>

          {selected && (
            <div className="mt-4">
              <LiveDetail key={selected.id} record={selected} roomName={roomName} />
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-[11px] text-muted/70">
        Raw events, artifacts, and receipts live in each run&apos;s detail view — chat only gets the
        handoff and the receipt.
      </p>
    </div>
  );
}
