'use client';

/**
 * useWorkbenchEvents — SSE hook for the workbench surfaces (UI-07).
 *
 * Behavior:
 *  - connects to the same-origin BFF's workbench event stream;
 *  - expects `event: snapshot` (full ordered events) first, then live events;
 *  - on reconnect, replays go through seq-dedupe so a browser refresh shows
 *    the current snapshot WITHOUT duplicate events;
 *  - reconnects with Last-Event-ID resume (native EventSource handles the
 *    header automatically; hard reconnects carry it as a query param).
 *
 * The EventSource factory and URL are injectable so the dev preview route
 * can drive the exact same hook with scripted fixture events or a local
 * mock SSE endpoint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type EventSourceFactory,
  type StreamStatus,
  WorkbenchEventStream,
} from './event-stream';
import {
  type WorkbenchRunState,
  applySnapshot,
  deriveLifecycle,
  elapsedMs,
  emptyRunState,
  foldEvents,
  formatElapsed,
  stepProgress,
} from './run-state';
import { type WorkbenchEvent, type StopWorkbenchBody, WORKBENCH_API } from './types';

export interface UseWorkbenchEventsOptions {
  /** Injectable EventSource constructor — mock stream in dev mode. */
  factory?: EventSourceFactory;
  /** Override the SSE URL entirely (dev mock endpoint). */
  url?: string;
  /** false pauses the connection (e.g. while a detail panel is closed). */
  enabled?: boolean;
}

export interface UseWorkbenchEventsResult {
  state: WorkbenchRunState;
  status: StreamStatus;
  /** Derived "step k/n" for the Running entry. */
  progress: { current: number; total: number | null };
  lifecycle: ReturnType<typeof deriveLifecycle>;
  /** Elapsed ms as of the last tick (re-renders once per second while live). */
  elapsed: number | null;
  elapsedLabel: string;
  /** true when the run is finished — Stop must be disabled. */
  isTerminal: boolean;
  /** Events dropped as seq-duplicates (reconnect replay proof). */
  duplicates: number;
  /** Stop through the BFF with an idempotent command id + reason. */
  stop(reason: string): Promise<{ ok: boolean; error?: string }>;
  /** Re-open the stream from scratch (debug / manual retry). */
  reconnect(): void;
}

/** Shared elapsed-time ticker: re-render once per second while any run is live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useWorkbenchEvents(
  workbenchId: string,
  options: UseWorkbenchEventsOptions = {},
): UseWorkbenchEventsResult {
  const { factory, url, enabled = true } = options;
  const [state, setState] = useState<WorkbenchRunState>(emptyRunState);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [duplicates, setDuplicates] = useState(0);
  const [reconnectKey, setReconnectKey] = useState(0);

  // Ref mirrors: stream callbacks are sequential, so we reduce outside
  // React's functional-updater queue and keep both counters exact.
  const stateRef = useRef(state);
  const dupesRef = useRef(0);
  stateRef.current = state;

  useEffect(() => {
    if (!enabled || !workbenchId) return;

    const stream = new WorkbenchEventStream({
      workbenchId,
      factory,
      url,
      callbacks: {
        onSnapshot(events: WorkbenchEvent[]) {
          // Snapshot is authoritative: full ordered events replace state.
          // Any later replay of the same seqs is dropped by foldEvents'
          // seq-dedupe, so refresh/reconnect never duplicates.
          const r = applySnapshot(events);
          stateRef.current = r.state;
          setState(r.state);
        },
        onEvent(event: WorkbenchEvent) {
          const r = foldEvents(stateRef.current, [event]);
          stateRef.current = r.state;
          if (r.duplicates > 0) {
            dupesRef.current += r.duplicates;
            setDuplicates(dupesRef.current);
          }
          setState(r.state);
        },
        onStatusChange(next: StreamStatus) {
          setStatus(next);
        },
      },
    });
    stream.start();
    return () => stream.stop();
    // factory/url are expected stable; reconnectKey forces a reopen.
  }, [workbenchId, enabled, reconnectKey, factory, url]);

  const now = useNow();
  const progress = useMemo(() => stepProgress(state), [state]);
  const lifecycle = useMemo(() => deriveLifecycle(state), [state]);
  const elapsed = elapsedMs(state, now);
  const isTerminal = state.terminal !== null;

  const stop = useCallback(
    async (reason: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const body: StopWorkbenchBody = { reason, command_id: crypto.randomUUID() };
        const res = await fetch(WORKBENCH_API.stop(workbenchId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        // Optimistic-free: the backend must emit stop_requested + a
        // terminal event over SSE; we never fake terminality client-side.
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    [workbenchId],
  );

  const reconnect = useCallback(() => setReconnectKey((k) => k + 1), []);

  return {
    state,
    status,
    progress,
    lifecycle,
    elapsed,
    elapsedLabel: formatElapsed(elapsed),
    isTerminal,
    duplicates,
    stop,
    reconnect,
  };
}
