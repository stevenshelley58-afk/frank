/**
 * `GET /v1/workbenches/:id/events` — WB-06 plan events over SSE.
 *
 * ## Wire contract (frozen: docs/plans/WORKBENCH_API_CONTRACT.md, consumed
 * by apps/web/src/lib/workbench/event-stream.ts)
 *
 *  - on connect the server sends `event: snapshot` whose `data` is the FULL
 *    ordered event list (envelopes `{ seq, type, at, payload }`);
 *  - then live appends as default `message` events, one envelope per line;
 *  - every event carries `id: <seq>` so the browser's EventSource re-sends
 *    `Last-Event-ID` on reconnect;
 *  - resume: the route honors BOTH the `Last-Event-ID` header and the
 *    `?lastEventId=` query param (hard-retry fallback the web client uses) —
 *    no duplicates, no gaps;
 *  - a heartbeat comment every 15s keeps proxies from closing the idle stream.
 *
 * ## Why this is a direct route, not a `registerRoute` route
 *
 * The registry pipeline (`plugins/route-handler.ts`) validates the handler's
 * return value against a JSON response schema and serializes it as JSON. An
 * SSE stream is neither: the reply is hijacked and written incrementally.
 * So this route registers directly on Fastify — the same family as
 * `/v1/auth/dev-session` and `/v1/openapi.json` — but it STILL appears in
 * `ALL_ROUTES` (registry + OpenAPI) and enforces the same auth/authz/idempotency
 * invariants by hand. It is in the workbench route group and shares the
 * registry's capability gate (`work.read`).
 *
 * ## Durability posture
 *
 * The database is the source of truth: every event is read back by `seq`
 * (store.listEventsSince), so a dropped bus notification can lose latency but
 * never an event, and the seq cursor makes resume gap-free and duplicate-free.
 * The bus wakes the loop early; a poll timer bounds worst-case delivery
 * latency when the writer is another process.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { IdentityProvider, Principal } from '@frank/identity';
import { authorize } from '@frank/identity';

import type { WorkbenchFrontDoor } from '../services/workbench/front-door.js';
import type { WorkbenchEventBus } from '../services/workbench/event-bus.js';
import type { WorkbenchEvent } from '../services/workbench/types.js';

export interface WorkbenchEventsRouteDependencies {
  readonly cellId: string;
  readonly policyVersion: string;
  readonly identity: IdentityProvider;
  readonly frontDoor: WorkbenchFrontDoor;
  readonly bus: WorkbenchEventBus;
  readonly now: () => Date;
  /** Live-delivery poll interval when no bus wake arrives. Default 1000ms. */
  readonly pollIntervalMs?: number;
}

/** Canonical UUID (the workbench id column type). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Envelope on the wire, matching the contract + the web client parser. */
function envelopeOf(event: WorkbenchEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    type: event.type,
    at: event.occurredAt.toISOString(),
    payload: event.payload,
  };
}

export function registerWorkbenchEventsRoute(
  app: FastifyInstance,
  dependencies: WorkbenchEventsRouteDependencies,
): void {
  const pollIntervalMs = dependencies.pollIntervalMs ?? 1000;
  const store = dependencies.frontDoor.store;
  const bus = dependencies.bus;

  app.route({
    method: 'GET',
    url: '/v1/workbenches/:id/events',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id: string };
      const query = request.query as { lastEventId?: string; access_token?: string };

      /* ---- validate the id shape (uuid column) --------------------------- */
      if (!UUID_RE.test(params.id)) {
        void reply.code(404);
        return {
          type: 'https://frank.fail/problems/not-found',
          title: 'Not found',
          status: 404,
          detail: `No workbench ${params.id} exists in this cell.`,
        };
      }

      /* ---- authenticate: bearer header, else the EventSource-friendly
              access_token query param (the web client's documented fallback).
              EventSource cannot set headers, so this is the only honest way
              to keep the stream authenticated without leaking the token into
              a logged URL path. Tokens in query strings are still sensitive:
              the request logger redacts nothing here, so the stream is kept
              quiet (no per-request logging of the URL) and the reverse proxy
              remains the only trusted hop (FRANK-§15.6). ------------------ */
      let principal: Principal | undefined;
      const authHeader = request.headers['authorization'];
      if (typeof authHeader === 'string' && authHeader.length > 0) {
        const spaceAt = authHeader.indexOf(' ');
        if (spaceAt > 0) {
          const result = await dependencies.identity.authenticate({
            scheme: authHeader.slice(0, spaceAt),
            value: authHeader.slice(spaceAt + 1),
          });
          if (result.authenticated) principal = result.principal;
        }
      }
      if (principal === undefined && typeof query.access_token === 'string') {
        const result = await dependencies.identity.authenticate({
          scheme: 'Bearer',
          value: query.access_token,
        });
        if (result.authenticated) principal = result.principal;
      }
      if (principal === undefined) {
        void reply.code(401);
        return {
          type: 'https://frank.fail/problems/unauthenticated',
          title: 'Unauthenticated',
          status: 401,
          detail: 'No valid bearer session or access_token was presented.',
        };
      }

      /* ---- authorize: work.read (same capability as workbenchGet) -------- */
      const verdict = authorize({
        principal,
        capability: 'work.read',
        cellId: dependencies.cellId,
        now: dependencies.now(),
      });
      if (!verdict.authorized) {
        void reply.code(verdict.refusal === 'session_expired' ? 401 : 403);
        return {
          type: 'https://frank.fail/problems/forbidden',
          title: 'Forbidden',
          status: verdict.refusal === 'session_expired' ? 401 : 403,
          detail: verdict.detail,
        };
      }

      /* ---- existence check (404, not a silent empty stream) -------------- */
      const record = await store.getWorkbench(dependencies.cellId, params.id);
      if (record === null) {
        void reply.code(404);
        return {
          type: 'https://frank.fail/problems/not-found',
          title: 'Not found',
          status: 404,
          detail: `No workbench ${params.id} exists in this cell.`,
        };
      }

      /* ---- resume cursor: Last-Event-ID header wins over the query param */
      let afterSeq = 0;
      const lastEventIdHeader = request.headers['last-event-id'];
      const headerCursor = Array.isArray(lastEventIdHeader)
        ? lastEventIdHeader[0]
        : lastEventIdHeader;
      const cursorSource =
        typeof headerCursor === 'string' && headerCursor.length > 0
          ? headerCursor
          : query.lastEventId;
      if (typeof cursorSource === 'string') {
        const parsed = Number(cursorSource);
        if (Number.isInteger(parsed) && parsed >= 0) afterSeq = parsed;
      }

      /* ---- hijack the reply and stream ----------------------------------- */
      void reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // never let an intermediate proxy buffer us
      });

      let lastSeq = afterSeq;
      let closed = false;
      let wakeTimer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let unsub: (() => void) | null = null;
      let draining = false;

      const close = (): void => {
        if (closed) return;
        closed = true;
        if (wakeTimer !== null) clearTimeout(wakeTimer);
        if (pollTimer !== null) clearTimeout(pollTimer);
        if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
        unsub?.();
        try {
          raw.end();
        } catch {
          /* already gone */
        }
      };

      raw.on('close', close);
      request.raw.on('close', close);

      const writeEvent = (event: WorkbenchEvent, kind: 'snapshot' | 'message'): void => {
        if (closed) return;
        const data = JSON.stringify(envelopeOf(event));
        raw.write(`id: ${event.seq}\nevent: ${kind}\ndata: ${data}\n\n`);
        lastSeq = event.seq;
      };

      /** Read and deliver everything newer than lastSeq, in order. */
      const deliver = async (): Promise<void> => {
        if (closed || draining) return;
        draining = true;
        try {
          const events = await store.listEventsSince(params.id, lastSeq);
          for (const event of events) {
            if (closed) break;
            // Duplicate guard: seq strictly increases, so anything at or below
            // the cursor is skipped even if a wake raced the cursor update.
            if (event.seq <= lastSeq) continue;
            writeEvent(event, 'message');
          }
        } catch {
          /* transient read failure — the next poll retries; never crash the stream */
        } finally {
          draining = false;
        }
      };

      const schedulePoll = (): void => {
        if (closed || pollTimer !== null) return;
        pollTimer = setTimeout(() => {
          pollTimer = null;
          void deliver().then(schedulePoll);
        }, pollIntervalMs);
      };

      // 1) Snapshot first: the full ordered history from the resume cursor.
      try {
        const snapshot = await store.listEventsSince(params.id, afterSeq);
        raw.write(
          `event: snapshot\ndata: ${JSON.stringify(snapshot.map(envelopeOf))}\n\n`,
        );
        for (const event of snapshot) {
          if (event.seq > lastSeq) lastSeq = event.seq;
        }
      } catch {
        // Could not read the snapshot — close rather than stream a lie.
        close();
        return;
      }

      // 2) Live: bus wakes deliver early; the poll bounds latency otherwise.
      unsub = bus.subscribe(params.id, () => {
        if (closed) return;
        if (wakeTimer !== null) clearTimeout(wakeTimer);
        // Small debounce: coalesce bursts into one read.
        wakeTimer = setTimeout(() => {
          wakeTimer = null;
          void deliver();
        }, 25);
      });
      schedulePoll();

      // 3) Heartbeat keeps proxies/clients from reaping an idle stream.
      heartbeatTimer = setInterval(() => {
        if (!closed) raw.write(': hb\n\n');
      }, 15_000);
    },
  });
}
