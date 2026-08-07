/**
 * WB-06 — plan events over SSE against real PostgreSQL.
 *
 * Verify gate (master plan §8D WB-06): "GET /v1/workbenches/:id/events sends
 * a snapshot on connect followed by live events. Reconnect resumes without
 * duplicates or gaps."
 *
 * This is apps/api's first streaming route, so the test boots a REAL listener
 * (`app.listen` on an ephemeral port) — Fastify's `inject` can't consume an
 * open-ended event stream. It speaks SSE with a plain `fetch` + streaming body
 * reader, which exercises the exact wire contract the web client consumes
 * (apps/web/src/lib/workbench/event-stream.ts):
 *
 *   - `event: snapshot` first, `data` = full ordered envelope array;
 *   - live appends as default `message` frames, each with `id: <seq>`;
 *   - `Last-Event-ID` resume → snapshot contains only events newer than the
 *     cursor (no duplicates, no gaps).
 *
 * Live events are appended through a bus-less store on the SAME database; the
 * route's poll timer (fast in tests) delivers them. That exercises the durable
 * path — the database is the source of truth, so delivery is correct even
 * without the wake-up bus.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { WorkbenchStore } from '../services/workbench/store.js';
import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';
import {
  SKIP_REASON,
  apiDatabaseUrl,
  ensureApiDatabase,
  openApiTestDatabase,
  resetApiDatabase,
  requiresDatabase,
} from './db-harness.js';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

const TASK_DEF = {
  instruction: 'Summarize the latest standup notes into five bullets.',
  harness: { adapter: 'goose' },
};

/** One parsed SSE frame. */
interface Frame {
  event: string;
  id?: string;
  data: unknown;
}

function parseFrame(raw: string): Frame | null {
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('id:')) id = line.slice('id:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    const frame: Frame = { event, data: JSON.parse(dataLines.join('\n')) };
    if (id !== undefined) frame.id = id;
    return frame;
  } catch {
    return null;
  }
}

/** Minimal SSE consumer over a fetch streaming body. */
class SseReader {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  readonly frames: Frame[] = [];

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Read frames until `until()` is true or the deadline passes. */
  async readUntil(until: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!until() && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const { value, done } = await Promise.race([
        this.reader.read(),
        new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
          setTimeout(() => resolve({ done: false }), remaining),
        ),
      ]);
      if (done) break;
      if (value === undefined) continue;
      this.buffer += this.decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.startsWith(':')) continue; // heartbeat/comment
        const frame = parseFrame(raw);
        if (frame !== null) this.frames.push(frame);
      }
    }
  }
}

describe.skipIf(requiresDatabase)(`WB-06 SSE against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;
  let store: WorkbenchStore | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-wb06-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
      // Fast poll so live delivery is prompt in tests (prod default is 1000ms).
      workbenchPollIntervalMs: 50,
    });
    // A bus-less writer on the same database: appends reach the SSE route via
    // its poll timer, proving the durable (database-authoritative) path.
    store = new WorkbenchStore((handle as FrankDatabaseHandle).db);
    baseUrl = await (server as TestServer).app.listen({ port: 0, host: '127.0.0.1' });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
  });

  async function createWorkbench(token: string, key: string): Promise<string> {
    const res = await fetch(`${baseUrl}/v1/workbenches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify({ command_id: key, task_def: TASK_DEF }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workbench: { id: string } };
    return body.workbench.id;
  }

  it('sends a snapshot on connect, then live events in order', async () => {
    const token = (server as TestServer).token(['owner']);
    const id = await createWorkbench(token, 'sse-key-1');

    // Seed two events before connecting.
    await (store as WorkbenchStore).appendEvent(id, 'workbench_created', {}, new Date());
    await (store as WorkbenchStore).appendEvent(id, 'plan_published', { steps: 3 }, new Date());

    const abort = new AbortController();
    const res = await fetch(`${baseUrl}/v1/workbenches/${id}/events`, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: abort.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');

    const sse = new SseReader(res.body!.getReader());

    // 1) Snapshot arrives first, containing the two seeded events in seq order.
    await sse.readUntil(() => sse.frames.some((f) => f.event === 'snapshot'));
    const snapshot = sse.frames.find((f) => f.event === 'snapshot');
    expect(snapshot).toBeDefined();
    const snapEvents = snapshot!.data as Array<{ seq: number; type: string; at: string }>;
    expect(snapEvents.map((e) => e.seq)).toEqual([1, 2]);
    expect(snapEvents[0]!.type).toBe('workbench_created');
    expect(snapEvents[1]!.type).toBe('plan_published');
    // Contract envelope fields are all present.
    for (const e of snapEvents) {
      expect(typeof e.at).toBe('string');
    }

    // 2) Live: append two more events; the poll timer delivers them in order.
    await (store as WorkbenchStore).appendEvent(id, 'step_updated', { seq: 1, state: 'doing' }, new Date());
    await (store as WorkbenchStore).appendEvent(id, 'completed', {}, new Date());
    await sse.readUntil(() => sse.frames.filter((f) => f.event === 'message').length >= 2);
    const live = sse.frames
      .filter((f) => f.event === 'message')
      .map((f) => (f.data as { seq: number }).seq);
    expect(live).toEqual([3, 4]);
    // Each live frame carries its seq as the SSE id (for browser resume).
    const liveIds = sse.frames.filter((f) => f.event === 'message').map((f) => f.id);
    expect(liveIds).toEqual(['3', '4']);

    abort.abort();
  });

  it('reconnect with Last-Event-ID resumes without duplicates or gaps', async () => {
    const token = (server as TestServer).token(['owner']);
    const id = await createWorkbench(token, 'sse-key-2');

    // Seed three events, consume them, disconnect.
    await (store as WorkbenchStore).appendEvent(id, 'workbench_created', {}, new Date());
    await (store as WorkbenchStore).appendEvent(id, 'plan_published', { steps: 4 }, new Date());
    await (store as WorkbenchStore).appendEvent(id, 'step_updated', { seq: 1, state: 'done' }, new Date());

    const firstAbort = new AbortController();
    const first = await fetch(`${baseUrl}/v1/workbenches/${id}/events`, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: firstAbort.signal,
    });
    const firstReader = new SseReader(first.body!.getReader());
    await firstReader.readUntil(() => firstReader.frames.some((f) => f.event === 'snapshot'));
    const firstSnap = firstReader.frames.find((f) => f.event === 'snapshot')!;
    expect((firstSnap.data as Array<{ seq: number }>).map((e) => e.seq)).toEqual([1, 2, 3]);
    firstAbort.abort();

    // Two more events land while the client is away.
    await (store as WorkbenchStore).appendEvent(id, 'step_updated', { seq: 2, state: 'doing' }, new Date());
    await (store as WorkbenchStore).appendEvent(id, 'completed', {}, new Date());

    // Reconnect carrying the resume cursor. The snapshot must contain ONLY the
    // events newer than seq 3 — no duplicates of 1..3, no gap at 4.
    const secondAbort = new AbortController();
    const second = await fetch(`${baseUrl}/v1/workbenches/${id}/events`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
        'last-event-id': '3',
      },
      signal: secondAbort.signal,
    });
    const secondReader = new SseReader(second.body!.getReader());
    await secondReader.readUntil(() => secondReader.frames.some((f) => f.event === 'snapshot'));
    const secondSnap = secondReader.frames.find((f) => f.event === 'snapshot') as Frame | undefined;
    expect(secondSnap).toBeDefined();
    const resumedSeqs = (secondSnap!.data as Array<{ seq: number }>).map((e) => e.seq);
    expect(resumedSeqs).toEqual([4, 5]);

    secondAbort.abort();
  });

  it('is 404 for an unknown workbench and 401 without auth', async () => {
    const token = (server as TestServer).token(['owner']);

    const missing = await fetch(
      `${baseUrl}/v1/workbenches/00000000-0000-0000-0000-000000000000/events`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(missing.status).toBe(404);

    const unauth = await fetch(`${baseUrl}/v1/workbenches/00000000-0000-0000-0000-000000000000/events`);
    expect(unauth.status).toBe(401);
  });
});
