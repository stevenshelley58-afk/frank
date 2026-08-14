/**
 * GET /v1/frame -- one authoritative feed for the Living Frame.
 *
 * This is a read-only composition of canonical work and chat records.
 * or turn a missing execution seam into a reassuring status.
 */

import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { FrankDatabase } from '@frank/adapter-postgres';

import { identifiersOf } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { defineRoute } from '../schema/registry.js';
import { frameResponseSchema } from '../schema/frame.js';
import { summaryOf } from './work.js';
import type { DomainStore } from '../services/store.js';

export const frameGetRoute = defineRoute({
  operationId: 'frameGet',
  method: 'GET',
  path: '/v1/frame',
  group: '/v1/frame',
  summary: 'Read the Living Frame feed',
  description:
    'A read-only, authoritative aggregation of waiting work, running chats, and receipts published today. Empty sections mean no persisted records matched; the server never fabricates activity.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  capability: 'work.read',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 300, burst: 30 },
  auditObligations: [],
  response: frameResponseSchema,
  successStatus: 200,
});

export const frameRoutes = [frameGetRoute];

export interface FrameRouteDependencies extends RouteHandlerDependencies {
  readonly store: DomainStore;
  readonly db: FrankDatabase;
  /** Configured cell-local civil-day boundary for receipt visibility. */
  readonly cellTimeZone: string;
}

type Timestamp = Date | string;
const iso = (value: Timestamp): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * Returns the UTC instant of the local midnight containing `instant`.
 *
 * `Intl` supplies the IANA-zone calendar conversion already present in Node;
 * resolving the offset twice also handles zones whose offset changes near a
 * civil-day boundary without adding a date library.
 */
export function startOfDayInTimeZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  if (![year, month, day].every(Number.isFinite)) {
    throw new Error(`Could not determine local date in ${timeZone}.`);
  }

  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  const offsetAt = (candidate: number): number => {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const at = Object.fromEntries(local.map((part) => [part.type, part.value]));
    return Date.UTC(Number(at.year), Number(at.month) - 1, Number(at.day), Number(at.hour), Number(at.minute), Number(at.second)) - candidate;
  };
  let result = localMidnightAsUtc - offsetAt(localMidnightAsUtc);
  result = localMidnightAsUtc - offsetAt(result);
  return new Date(result);
}

export function registerFrameRoutes(app: FastifyInstance, dependencies: FrameRouteDependencies): void {
  registerRoute(app, dependencies, frameGetRoute, async ({ context, principal, request, reply }) => {
    const now = dependencies.now();
    const dayStart = startOfDayInTimeZone(now, dependencies.cellTimeZone);
    const ownerId = principal.principalId;

    // ADR-002 makes the cell the authorization and data-isolation boundary.
    // Work and chat projections therefore intentionally match the cell-wide
    // visibility of GET /v1/work and GET /v1/today. Chat rows remain
    // owner-scoped because the browser BFF service identity owns them.

    const [waitingPage, chats, chatReceipts] = await Promise.all([
      dependencies.store.listWork({
        cellId: context.cellId,
        state: 'waiting',
        ownerId: undefined,
        cursor: undefined,
        limit: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
      dependencies.db.execute<{
        id: string; project_id: string; agent: string; title: string; model: string; thinking: string; last_message_at: Timestamp;
      }>(sql`
        select id, project_id, agent, title, model, thinking, last_message_at
        from frank_domain.chat_conversation
        where cell_id = ${context.cellId} and owner_id = ${ownerId}
          and running = true and archived = false
        order by last_message_at desc, id
        limit 100
      `),
      dependencies.db.execute<{
        message_id: string; conversation_id: string; project_id: string; body: string; created_at: Timestamp;
      }>(sql`
        select m.id as message_id, m.conversation_id, c.project_id, m.body, m.created_at
        from frank_domain.chat_message m
        join frank_domain.chat_conversation c on c.id = m.conversation_id
        where m.cell_id = ${context.cellId} and c.cell_id = ${context.cellId}
          and c.owner_id = ${ownerId} and m.kind = 'receipt' and m.created_at >= ${dayStart}
        order by m.created_at desc, m.id
        limit 100
      `),
    ]);

    const waiting = waitingPage.items.map((item) => summaryOf(item, now));
    const running = chats.rows.map((row) => ({ kind: 'chat' as const, id: row.id, project_id: row.project_id, agent: row.agent, title: row.title, model: row.model, thinking: row.thinking, running: true as const, last_message_at: iso(row.last_message_at) }));
    const receipts = chatReceipts.rows
      .map((row) => ({ kind: 'chat' as const, message_id: row.message_id, conversation_id: row.conversation_id, project_id: row.project_id, body: row.body, created_at: iso(row.created_at) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    // A fact snapshot deliberately excludes response-local identifiers and
    // generation time, so this is a weak validator rather than a claim that
    // the complete byte representation is unchanged.
    const etag = `W/"${createHash('sha256').update(JSON.stringify({ waiting, running, receipts })).digest('hex').slice(0, 32)}"`;
    void reply.header('etag', etag);
    if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
      void reply.code(304);
      return undefined as never;
    }

    return { waiting, running, receipts, generated_at: now.toISOString(), identifiers: identifiersOf(context) };
  });
}

/** If-None-Match uses weak comparison for GET, including the `*` validator. */
function ifNoneMatchMatches(value: string | string[] | undefined, etag: string): boolean {
  const header = Array.isArray(value) ? value[0] : value;
  const opaqueTag = etag.replace(/^W\//, '');
  return header?.split(',').some((candidate) => {
    const validator = candidate.trim();
    return validator === '*' || validator.replace(/^W\//, '') === opaqueTag;
  }) ?? false;
}
