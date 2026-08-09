/**
 * SSE client for the same-origin Workbench BFF (upstream contract:
 * GET /v1/workbenches/:id/events).
 *
 * Wire behavior per contract:
 *  - on connect the server sends `event: snapshot` (full ordered events),
 *    then live appends as default `message` events;
 *  - `Last-Event-ID` resume supported — no duplicates/gaps (WB-06);
 *  - the UI additionally dedupes on `seq` (UI-07 rule) so replayed events
 *    after a reconnect never double-render.
 *
 * The browser's EventSource automatically reconnects on network drops and
 * re-sends the `Last-Event-ID` header (from server-sent `id:` fields). When
 * the connection dies hard (readyState CLOSED — e.g. non-200), we reopen
 * manually and carry the resume cursor as a `lastEventId` query param too.
 * Only the non-secret cursor enters the browser URL; the BFF attaches the
 * upstream bearer token as an Authorization header.
 */

import type { WorkbenchEvent } from './types';
import { parseWorkbenchEvent, WORKBENCH_API } from './types';

/** Minimal EventSource surface we depend on (native or mock). */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export const SSE_READY_STATE = { CONNECTING: 0, OPEN: 1, CLOSED: 2 } as const;

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface StreamCallbacks {
  /** Snapshot arrived: full ordered event list (replaces prior state). */
  onSnapshot(events: WorkbenchEvent[]): void;
  /** One live event arrived (already parsed + validated). */
  onEvent(event: WorkbenchEvent): void;
  onStatusChange(status: StreamStatus, detail?: string): void;
}

export interface WorkbenchStreamOptions {
  workbenchId: string;
  callbacks: StreamCallbacks;
  /** Injectable EventSource constructor (mock in tests / dev mode). */
  factory?: EventSourceFactory;
  /** Override the SSE URL entirely (dev mock endpoint). */
  url?: string;
  /** Max manual-reconnect backoff in ms. */
  maxBackoffMs?: number;
  /** Injectable timer for tests. */
  scheduleReconnect?: (fn: () => void, delayMs: number) => void;
}

function parseSnapshotData(raw: unknown): WorkbenchEvent[] {
  if (!Array.isArray(raw)) throw new Error('snapshot payload is not an array');
  return raw.map((item) => parseWorkbenchEvent(item));
}

function safeParse(data: string | undefined): unknown {
  if (typeof data !== 'string' || data.length === 0) throw new Error('empty SSE data');
  return JSON.parse(data) as unknown;
}

export class WorkbenchEventStream {
  private source: EventSourceLike | null = null;
  private stopped = false;
  private attempts = 0;
  /** Resume cursor: highest seq accepted so far (Last-Event-ID fallback). */
  private lastSeq: number | null = null;

  constructor(private readonly options: WorkbenchStreamOptions) {}

  start(): void {
    this.stopped = false;
    this.options.callbacks.onStatusChange('connecting');
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    this.options.callbacks.onStatusChange('stopped');
  }

  /** Highest seq seen — exposed for tests and the resume query param. */
  get resumeSeq(): number | null {
    return this.lastSeq;
  }

  private buildUrl(): string {
    const base = this.options.url ?? WORKBENCH_API.events(this.options.workbenchId);
    const params: string[] = [];
    if (this.lastSeq !== null) params.push(`lastEventId=${this.lastSeq}`);
    return params.length > 0 ? `${base}?${params.join('&')}` : base;
  }

  private open(): void {
    if (this.stopped) return;
    const factory = this.options.factory ?? defaultFactory;
    const source = factory(this.buildUrl());
    this.source = source;

    source.addEventListener('snapshot', (event: MessageEvent) => {
      this.attempts = 0;
      this.options.callbacks.onStatusChange('open');
      try {
        const events = parseSnapshotData(safeParse(event.data));
        for (const e of events) this.observeSeq(e.seq);
        this.options.callbacks.onSnapshot(events);
      } catch (err) {
        this.options.callbacks.onStatusChange('reconnecting', `bad snapshot: ${String(err)}`);
      }
    });

    source.addEventListener('message', (event: MessageEvent) => {
      this.attempts = 0;
      this.options.callbacks.onStatusChange('open');
      try {
        const parsed = parseWorkbenchEvent(safeParse(event.data));
        this.observeSeq(parsed.seq);
        this.options.callbacks.onEvent(parsed);
      } catch {
        /* malformed live event — skip, never crash the surface */
      }
    });

    source.addEventListener('error', () => {
      if (this.stopped) return;
      this.options.callbacks.onStatusChange('reconnecting');
      // Native EventSource auto-reconnects (state CONNECTING) and re-sends
      // Last-Event-ID. Only when it gave up (CLOSED) do we reopen manually.
      if (source.readyState === SSE_READY_STATE.CLOSED) {
        source.close();
        this.source = null;
        const delay = Math.min(1000 * 2 ** this.attempts, this.options.maxBackoffMs ?? 10_000);
        this.attempts += 1;
        const schedule = this.options.scheduleReconnect ?? defaultSchedule;
        schedule(() => this.open(), delay);
      }
    });
  }

  private observeSeq(seq: number): void {
    if (typeof seq === 'number' && (this.lastSeq === null || seq > this.lastSeq)) {
      this.lastSeq = seq;
    }
  }
}

function defaultFactory(url: string): EventSourceLike {
  return new EventSource(url) as unknown as EventSourceLike;
}

function defaultSchedule(fn: () => void, delayMs: number): void {
  window.setTimeout(fn, delayMs);
}
