/**
 * Mock EventSource factory for the dev preview route (no backend live yet).
 *
 * Faithful to the contract's SSE semantics:
 *  - on connect, emit `event: snapshot` with the FULL ordered event list;
 *  - then emit live events one at a time on a timer;
 *  - on reconnect (Last-Event-ID), replay snapshot + only events with
 *    seq > lastEventId — the UI's seq-dedupe must swallow any overlap.
 *
 * Fixture envelopes are the exact contract shape ({ seq, type, at, payload }).
 */

import type { EventSourceFactory, EventSourceLike } from './event-stream';
import type { WorkbenchEvent } from './types';

interface MockScript {
  /** Full ordered history — delivered as the snapshot on every connect. */
  snapshot: WorkbenchEvent[];
  /** Events streamed live after the snapshot. */
  live: WorkbenchEvent[];
  /** Delay before the snapshot lands (simulates network). */
  snapshotDelayMs?: number;
  /** Delay between live events. */
  liveIntervalMs?: number;
}

type Listener = (event: MessageEvent) => void;

class MockEventSource implements EventSourceLike {
  readyState = 0; // CONNECTING
  private listeners = new Map<string, Listener[]>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly script: MockScript,
    url: string,
  ) {
    // Honor the Last-Event-ID resume contract: skip live events already
    // covered by the resume cursor. (Native EventSource sends the header;
    // our stream class also mirrors it as ?lastEventId= for hard retries.)
    const resumeSeq = parseResumeSeq(url);
    const live = script.live.filter((e) => resumeSeq === null || e.seq > resumeSeq);

    const snapshotDelay = script.snapshotDelayMs ?? 150;
    this.timers.push(
      setTimeout(() => {
        this.readyState = 1; // OPEN
        this.emit('snapshot', script.snapshot);
        let step = 0;
        const interval = script.liveIntervalMs ?? 900;
        const tick = () => {
          if (step >= live.length) return;
          this.emit('message', live[step]);
          step += 1;
          if (step < live.length) {
            this.timers.push(setTimeout(tick, interval));
          }
        };
        if (live.length > 0) this.timers.push(setTimeout(tick, interval));
      }, snapshotDelay),
    );
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.readyState = 2; // CLOSED
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.listeners.clear();
  }

  private emit(type: string, data: unknown): void {
    const message = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(message);
  }
}

function parseResumeSeq(url: string): number | null {
  const match = /[?&]lastEventId=(\d+)/.exec(url);
  return match ? Number(match[1]) : null;
}

/** Build a factory bound to one scripted workbench. */
export function createMockEventSourceFactory(script: MockScript): EventSourceFactory {
  return (url: string) => new MockEventSource(script, url);
}

/** Pre-canned scripts for the three demo runs. */
export function makeScript(snapshot: WorkbenchEvent[], live: WorkbenchEvent[] = []): MockScript {
  return { snapshot, live, snapshotDelayMs: 200, liveIntervalMs: 1100 };
}
