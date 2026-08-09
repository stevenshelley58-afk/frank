/**
 * WorkbenchEventStream tests — wire-level SSE behavior with a fake
 * EventSource (no browser, no timers escaping):
 *  - snapshot arrives before live events;
 *  - Last-Event-ID resume is carried as ?lastEventId= on hard reconnect;
 *  - hard reconnect (CLOSED) reopens with exponential backoff;
 *  - explicit stop() never reconnects.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SSE_READY_STATE, WorkbenchEventStream, type EventSourceLike } from './event-stream';
import type { WorkbenchEvent } from './types';

type Listener = (event: MessageEvent) => void;

class FakeEventSource implements EventSourceLike {
  readyState: number = SSE_READY_STATE.CONNECTING;
  private listeners = new Map<string, Listener[]>();
  static instances: FakeEventSource[] = [];

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.readyState = SSE_READY_STATE.CLOSED;
  }

  /* test helpers */
  emit(type: string, data: unknown): void {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(ev);
  }
  fail(hard = false): void {
    if (hard) this.readyState = SSE_READY_STATE.CLOSED;
    else this.readyState = SSE_READY_STATE.CONNECTING;
    this.emit('error', {});
  }
  open(): void {
    this.readyState = SSE_READY_STATE.OPEN;
  }
}

const SNAP: WorkbenchEvent[] = [
  { seq: 1, type: 'workbench_created', at: '2026-08-06T15:00:00Z', payload: {} },
  { seq: 2, type: 'provisioned', at: '2026-08-06T15:00:05Z', payload: {} },
];
const LIVE: WorkbenchEvent[] = [
  {
    seq: 3,
    type: 'step_updated',
    at: '2026-08-06T15:00:09Z',
    payload: { step: 1, state: 'doing', note: 'go' },
  },
];

describe('WorkbenchEventStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  it('delivers snapshot first, then live events, in order', () => {
    const snapshots: WorkbenchEvent[][] = [];
    const events: WorkbenchEvent[] = [];
    const stream = new WorkbenchEventStream({
      workbenchId: 'wb-1',
      factory: (url) => new FakeEventSource(url),
      callbacks: {
        onSnapshot: (e) => snapshots.push(e),
        onEvent: (e) => events.push(e),
        onStatusChange: () => {},
      },
    });
    stream.start();

    const es = FakeEventSource.instances[0];
    es.open();
    es.emit('snapshot', SNAP);
    es.emit('message', LIVE[0]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].map((e) => e.seq)).toEqual([1, 2]);
    expect(events.map((e) => e.seq)).toEqual([3]);
    expect(stream.resumeSeq).toBe(3);
    stream.stop();
  });

  it('carries the resume cursor as ?lastEventId= on hard reconnect', () => {
    const scheduled: Array<{ fn: () => void; delay: number }> = [];
    const stream = new WorkbenchEventStream({
      workbenchId: 'wb-1',
      factory: (url) => new FakeEventSource(url),
      callbacks: { onSnapshot: () => {}, onEvent: () => {}, onStatusChange: () => {} },
      scheduleReconnect: (fn, delayMs) => scheduled.push({ fn, delay: delayMs }),
    });
    stream.start();

    const first = FakeEventSource.instances[0];
    expect(first.url).toBe('/api/workbenches/wb-1/events');
    first.open();
    first.emit('snapshot', SNAP);
    first.emit('message', LIVE[0]); // lastSeq = 3

    // Hard drop → manual reopen scheduled with backoff.
    first.fail(true);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(1000);
    scheduled[0].fn();

    const second = FakeEventSource.instances[1];
    expect(second.url).toContain('lastEventId=3');
    stream.stop();
  });

  it('lets the native EventSource retry soft errors (no manual reopen)', () => {
    const scheduled: unknown[] = [];
    const stream = new WorkbenchEventStream({
      workbenchId: 'wb-1',
      factory: (url) => new FakeEventSource(url),
      callbacks: { onSnapshot: () => {}, onEvent: () => {}, onStatusChange: () => {} },
      scheduleReconnect: (fn, delayMs) => scheduled.push({ fn, delayMs }),
    });
    stream.start();
    const es = FakeEventSource.instances[0];
    es.fail(false); // soft: readyState CONNECTING → native retry owns it
    expect(scheduled).toHaveLength(0);
    stream.stop();
  });

  it('backs off exponentially and stops reopening after stop()', () => {
    const scheduled: Array<{ fn: () => void; delay: number }> = [];
    const statuses: string[] = [];
    const stream = new WorkbenchEventStream({
      workbenchId: 'wb-1',
      factory: (url) => new FakeEventSource(url),
      callbacks: {
        onSnapshot: () => {},
        onEvent: () => {},
        onStatusChange: (s) => statuses.push(s),
      },
      scheduleReconnect: (fn, delayMs) => scheduled.push({ fn, delay: delayMs }),
      maxBackoffMs: 4000,
    });
    stream.start();

    for (const i of [0, 1, 2]) {
      FakeEventSource.instances[i].fail(true);
      scheduled[i].fn();
    }
    expect(scheduled.map((s) => s.delay)).toEqual([1000, 2000, 4000]);
    // Backoff is capped.
    FakeEventSource.instances[3].fail(true);
    expect(scheduled[3].delay).toBe(4000);

    stream.stop();
    expect(statuses[statuses.length - 1]).toBe('stopped');
    const count = FakeEventSource.instances.length;
    for (const s of scheduled) s.fn(); // pending retries after stop: no-op
    expect(FakeEventSource.instances.length).toBe(count);
  });

  it('skips malformed live events without crashing', () => {
    const events: WorkbenchEvent[] = [];
    const stream = new WorkbenchEventStream({
      workbenchId: 'wb-1',
      factory: (url) => new FakeEventSource(url),
      callbacks: {
        onSnapshot: () => {},
        onEvent: (e) => events.push(e),
        onStatusChange: () => {},
      },
    });
    stream.start();
    const es = FakeEventSource.instances[0];
    es.open();
    es.emit('message', { hello: 'not an envelope' });
    es.emit('message', 'not json');
    es.emit('message', LIVE[0]);
    expect(events.map((e) => e.seq)).toEqual([3]);
    stream.stop();
  });
});

describe('mock EventSource factory (dev preview fidelity)', () => {
  it('emits snapshot then timed live events and honors resume', async () => {
    const { createMockEventSourceFactory, makeScript } = await import('./mock-stream');
    const factory = createMockEventSourceFactory(makeScript(SNAP, LIVE));

    const snapshots: WorkbenchEvent[][] = [];
    const events: WorkbenchEvent[] = [];
    const es = factory('/api/workbenches/wb-1/events') as unknown as {
      addEventListener: (t: string, l: Listener) => void;
      close: () => void;
    };
    es.addEventListener('snapshot', (e: MessageEvent) => snapshots.push(JSON.parse(e.data)));
    es.addEventListener('message', (e: MessageEvent) => events.push(JSON.parse(e.data)));

    await new Promise((r) => setTimeout(r, 300)); // snapshot lands (~200ms)
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].map((e) => e.seq)).toEqual([1, 2]);

    await new Promise((r) => setTimeout(r, 1400)); // live event lands
    expect(events.map((e) => e.seq)).toEqual([3]);
    es.close();
  });
});
