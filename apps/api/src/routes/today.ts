/**
 * `GET /v1/today` — UX-001 (partial), UX-007, FRANK-§3.8 `/today`.
 *
 * ## Partial, and it says so
 *
 * UX-001 requires Today to combine "calendar, tasks, goals, routines, waiting
 * items, messages, agent work, and system exceptions into one prioritised view".
 * Slice 1 has exactly one of those in the canonical store. The brief for this
 * workstream is explicit that UX-001 is partial here by design: "one card
 * proving the provenance chain, not the full prioritised brief".
 *
 * The response therefore carries a `coverage` block naming each UX-001 input,
 * whether it is included, and which slice supplies it. That block is not
 * documentation — it is the thing that stops a Today response from *looking*
 * complete. UX-007's principle ("show stale data … rather than silently
 * presenting an old state as current") applied to completeness rather than to
 * age: a brief missing six of its eight inputs, presented without saying so, is
 * the same lie in a different dimension.
 *
 * ## Prioritisation
 *
 * Deliberately simple and deliberately explainable: state urgency, then
 * priority, then due date, then recency. There is no model in this path. UX-001's
 * "prioritised" and UX-006's "every recommendation must be dismissible,
 * explainable, and trainable" both point at a ranking a person can predict, and
 * a learned ranking with no feedback store to train from (Slice 4) would be a
 * ranking nobody could explain or correct.
 */

import type { FastifyInstance } from 'fastify';

import type { WorkState } from '@frank/adapter-postgres';

import { identifiersOf } from '../context.js';
import { defineRoute } from '../schema/registry.js';
import { todayQuerySchema, todayResponseSchema } from '../schema/views.js';
import type { DomainStore, WorkItemRecord } from '../services/store.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { canonicalFreshness, guidanceToWire } from './work.js';

export const todayRoute = defineRoute({
  operationId: 'todayGet',
  method: 'GET',
  path: '/v1/today',
  group: '/v1/today',
  summary: "Today's brief (Slice 1 subset)",
  description:
    'The Slice 1 subset of UX-001: actionable work items with WORK-006 guidance and a provenance link on every card. ' +
    'The `coverage` block names the UX-001 inputs that are not yet available and the slice that supplies each.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer'],
  capability: 'today.read',
  dataClasses: ['open', 'internal', 'private', 'sensitive'],
  standingPolicyEligible: false,
  policyOperation: 'today.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 300, burst: 30 },
  auditObligations: [],
  query: todayQuerySchema,
  response: todayResponseSchema,
  successStatus: 200,
});

export const todayRoutes = [todayRoute];

/**
 * The UX-001 inputs Slice 1 cannot supply, and where each arrives.
 *
 * Data, in the response, rather than a comment: a client rendering Today can
 * show the user which parts of their day FRANK cannot see yet, which is a more
 * honest empty state than a short list.
 */
const UNAVAILABLE_INPUTS: ReadonlyArray<{
  input: string;
  reason: string;
  available_in: string;
}> = [
  {
    input: 'calendar',
    reason: 'No calendar connector exists yet; COMMS-001 synchronisation is Workstream 11.',
    available_in: 'Slice 5',
  },
  {
    input: 'messages',
    reason: 'No email or messaging connector exists yet (COMMS-003).',
    available_in: 'Slice 5',
  },
  {
    input: 'goals',
    reason: 'The goals bounded context is not in the Slice 1 schema (FRANK-§11.2).',
    available_in: 'Slice 4',
  },
  {
    input: 'routines',
    reason: 'Habit and routine tracking is not in the Slice 1 schema.',
    available_in: 'Slice 4',
  },
  {
    input: 'agent_work',
    reason: 'There is no agent kernel and no run record yet (FRANK-§7.3).',
    available_in: 'Slice 2',
  },
  {
    input: 'system_exceptions',
    reason:
      'Exceptions are reported through /v1/system/health in Slice 1 rather than folded into the brief.',
    available_in: 'Slice 4',
  },
];

/**
 * Ranking weight per state.
 *
 * Terminal states are excluded from the brief entirely rather than ranked last:
 * a completed item is not low-priority work, it is not work.
 */
const STATE_URGENCY: Readonly<Record<WorkState, number>> = {
  blocked: 100,
  failed: 95,
  active: 90,
  reviewing: 85,
  scheduled: 70,
  ready: 65,
  waiting: 55,
  planned: 40,
  inbox: 35,
  done: -1,
  cancelled: -1,
};

const PRIORITY_WEIGHT: Readonly<Record<WorkItemRecord['priority'], number>> = {
  critical: 40,
  high: 25,
  normal: 10,
  low: 3,
  none: 0,
};

/** Score an item. Pure and total, so the brief is deterministic — UX-001's
 * acceptance evidence is "Fixture account produces a **deterministic** brief". */
export function todayScore(item: WorkItemRecord, now: Date): number {
  const stateWeight = STATE_URGENCY[item.state];
  if (stateWeight < 0) return -1;

  let score = stateWeight + PRIORITY_WEIGHT[item.priority];

  if (item.dueAt !== null) {
    const hoursUntilDue = (item.dueAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursUntilDue <= 0) score += 50;
    else if (hoursUntilDue <= 24) score += 30;
    else if (hoursUntilDue <= 72) score += 15;
  }

  if (item.scheduledForAt !== null) {
    const hoursUntilStart = (item.scheduledForAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursUntilStart >= 0 && hoursUntilStart <= 12) score += 20;
  }

  return score;
}

export interface TodayRouteDependencies extends RouteHandlerDependencies {
  readonly store: DomainStore;
}

export function registerTodayRoutes(
  app: FastifyInstance,
  dependencies: TodayRouteDependencies,
): void {
  registerRoute(app, dependencies, todayRoute, async ({ query, context }) => {
    const now = dependencies.now();

    // Read more than we will show, so ranking has something to rank. Bounded:
    // an unbounded read behind a "top ten" is a slow query waiting for a busy
    // account.
    const page = await dependencies.store.listWork({
      cellId: context.cellId,
      state: undefined,
      ownerId: undefined,
      cursor: undefined,
      limit: Math.min(200, query.limit * 10),
      sort: 'updated_at',
      order: 'desc',
    });

    const ranked = page.items
      .map((item) => ({ item, score: todayScore(item, now) }))
      .filter((entry) => entry.score >= 0)
      // `id` breaks ties: a UUIDv7 is time-ordered, so equal-scoring items come
      // back oldest-first and the brief is stable across calls.
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
      .slice(0, query.limit);

    const cards = ranked.map(({ item }) => ({
      id: item.id,
      kind: 'work_item' as const,
      title: item.title,
      state: item.state,
      priority: item.priority,
      guidance: guidanceToWire(item, now),
      data_class: item.dataClass,
      freshness: canonicalFreshness(page.asOf, now),
      _links: {
        resource: `/v1/work/${item.id}`,
        // The Slice 1 exit gate: every card on the brief can be walked back to
        // its immutable source envelope.
        provenance: `/v1/work/${item.id}/provenance`,
      },
    }));

    return {
      date: formatDateInZone(now, query.timezone),
      timezone: query.timezone,
      sections: [
        {
          id: 'work',
          title: 'Work needing attention',
          cards,
        },
      ],
      coverage: {
        included: ['tasks', 'waiting_items'],
        not_yet_available: UNAVAILABLE_INPUTS.map((entry) => ({ ...entry })),
      },
      freshness: canonicalFreshness(page.asOf, now),
      identifiers: identifiersOf(context),
    };
  });
}

/**
 * `YYYY-MM-DD` in the requested IANA zone.
 *
 * FRANK-§11.1 requires "UTC timestamps plus an explicit IANA timezone" for
 * anything a human schedules, and "today" is the most human-scheduled thing
 * there is: at 09:00 UTC it is already the 29th in Melbourne and still the 28th
 * in London. `Intl` is in the Node runtime, so this needs no dependency.
 *
 * An unknown zone falls back to UTC rather than throwing: a bad timezone in a
 * query string should not make the brief unavailable, and the response echoes
 * the zone it used.
 */
function formatDateInZone(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}
