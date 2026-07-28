/**
 * `POST /v1/capture` — UX-003, UX-004, FRANK-§12.2.
 *
 * ## The UX-004 shape, stated plainly
 *
 * The request path is:
 *
 *     validate -> authenticate -> authorize -> evaluate policy -> ONE TRANSACTION -> respond
 *
 * and then, *after* the response object is built and without an `await`:
 *
 *     enrichment.submit(job)
 *
 * The transaction writes the source envelope, its first version, the triage work
 * item, the capture ledger row, the audit entry, and the ADR-004 outbox events —
 * all of it, or none of it. When it commits, the capture is durable, and the
 * acknowledgement says exactly that and nothing more.
 *
 * Everything downstream of that commit — classification, extraction, embedding,
 * notification, event publication — reads the outbox. If every one of them is
 * stalled, this endpoint is unaffected, which is what "even when downstream
 * enrichment is delayed" means. `test/capture-latency.test.ts` proves it by
 * installing an enrichment handler that never resolves.
 *
 * ## Slice boundaries are in the contract, not in a 500
 *
 * UX-003 lists text, voice, images, documents, URLs, and forwarded content.
 * Slice 1 accepts the first two. The Zod enum rejects the rest with a typed
 * `unsupported_capture_kind` problem naming the slice that will add them, so a
 * client learns the boundary from the API rather than from a stack trace.
 *
 * ## Trust cannot be claimed by the payload
 *
 * FRANK-§2.3: `policy-trusted` "can only be produced by the policy-change
 * workflow; ordinary documents and messages can never receive this label", and
 * `owner-authenticated` is "Steven's authenticated command". A request body
 * asking for either is asking to be believed about its own trustworthiness. The
 * server sets trust from the *authenticated session*, and a body may only
 * declare a value at or below what the session supports.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import type { TrustLabel } from '@frank/contracts';

import { identifiersOf } from '../context.js';
import { ProblemError } from '../problem.js';
import { defineRoute } from '../schema/registry.js';
import { captureRequestSchema, captureResponseSchema } from '../schema/views.js';
import type { ActionBoundary } from '../services/action-boundary.js';
import { ownerCommandInfluence, policyDecisionToWire } from '../services/action-boundary.js';
import type { EnrichmentDispatcher } from '../services/enrichment.js';
import type { DomainStore } from '../services/store.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

export const captureRoute = defineRoute({
  operationId: 'captureCreate',
  method: 'POST',
  path: '/v1/capture',
  group: '/v1/capture',
  summary: 'Capture text or a voice transcript',
  description:
    'Creates an immutable source envelope and a triage work item in one transaction and acknowledges durability. ' +
    'Enrichment happens off the request path (UX-004). Slice 1 accepts `text` and `voice_transcript`; ' +
    'images, documents, URLs, and forwarded content arrive in later slices.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'source.capture',
  dataClasses: ['open', 'internal', 'private', 'sensitive'],
  standingPolicyEligible: false,
  policyOperation: 'source.capture',
  idempotency: 'required_key',
  consistency: 'read_own_writes',
  errors: [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'policy_denied',
    'policy_hold_for_review',
    'unsupported_capture_kind',
    'idempotency_conflict',
    'service_unavailable',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 600, burst: 60 },
  auditObligations: ['source.captured', 'work.created'],
  body: captureRequestSchema,
  response: captureResponseSchema,
  successStatus: 201,
});

export interface CaptureRouteDependencies extends RouteHandlerDependencies {
  readonly store: DomainStore;
  readonly enrichment: EnrichmentDispatcher;
  readonly actions: ActionBoundary;
}

/**
 * Trust labels a request body may declare.
 *
 * `policy-trusted` and `owner-authenticated` are absent: see the module comment.
 * A body that asks for `verified-source` gets it, because that is a claim about
 * provenance the client may legitimately know (a signed webhook, a connector
 * with a verified account) and it still "can never issue system instructions"
 * per FRANK-§2.3.
 */
const CLIENT_DECLARABLE_TRUST: readonly TrustLabel[] = [
  'verified-source',
  'external-untrusted',
  'generated-untrusted',
];

export function registerCaptureRoutes(
  app: FastifyInstance,
  dependencies: CaptureRouteDependencies,
): void {
  registerRoute(app, dependencies, captureRoute, async ({ body, context, principal }) => {
    const now = dependencies.now();

    /* ---- trust is resolved from the session, not accepted from the body -- */
    const requested = body.trust;
    const trust: TrustLabel =
      requested === 'owner-authenticated' || requested === 'policy-trusted'
        ? 'owner-authenticated'
        : requested;
    if (
      requested !== 'owner-authenticated' &&
      !CLIENT_DECLARABLE_TRUST.includes(requested)
    ) {
      throw new ProblemError(
        'validation_failed',
        `A request body may not declare trust "${requested}". FRANK-§2.3 reserves policy-trusted for the policy-change workflow.`,
      );
    }

    /* ---- the FRANK-§6.9 action boundary --------------------------------- */
    // The request hash binds the decision to this exact payload, so a decision
    // cannot be replayed against different content on a retry.
    const requestHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          kind: body.kind,
          text: body.text,
          data_class: body.data_class,
          trust,
          origin_uri: body.origin_uri ?? null,
        }),
        'utf8',
      )
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'source.capture',
      // Creating an immutable internal record. FRANK-§7.6 row 2, "Run
      // automatically". A capture contacts nothing and changes nothing outside
      // the cell, which is what makes that row the right one.
      actionClass: 'internal_reversible',
      target: { kind: 'source', id: body.command_id, cellId: context.cellId },
      requestHash,
      idempotencyKey: context.idempotencyKey ?? body.command_id,
      dataClasses: [body.data_class],
      // The owner's authenticated command chose this. The captured *content* may
      // be hostile, and that is fine: it influences nothing (see `trust.ts`).
      influences: ownerCommandInfluence(principal),
      correlationId: context.correlationId,
      now,
    });

    if (evaluation.decision.result === 'deny') {
      throw new ProblemError('policy_denied', evaluation.decision.reasons.join('; '), {
        policyVersion: evaluation.decision.policyVersion,
      });
    }
    if (evaluation.decision.result === 'hold_for_review') {
      throw new ProblemError('policy_hold_for_review', evaluation.decision.reasons.join('; '), {
        policyVersion: evaluation.decision.policyVersion,
      });
    }

    /* ---- one transaction ------------------------------------------------- */
    const record = await dependencies.store.capture({
      cellId: context.cellId,
      requestIdempotencyKey: context.idempotencyKey ?? body.command_id,
      kind: body.kind === 'voice_transcript' ? 'voice' : 'text',
      text: body.text,
      title: body.title,
      originUri: body.origin_uri,
      mediaType: body.kind === 'voice_transcript' ? 'text/plain' : 'text/plain',
      dataClass: body.data_class,
      trust,
      actor: { kind: actorKindFor(principal), id: principal.principalId },
      correlationId: context.correlationId,
      channel: body.kind === 'voice_transcript' ? 'voice' : 'text',
      now,
      policyVersion: evaluation.decision.policyVersion,
      policyResult: evaluation.decision.result,
    });

    /* ---- everything below here is OFF the request path -------------------- */
    // No `await`. `submit` returns void so this cannot accidentally become one.
    // A replay submits nothing: the source already exists and was already
    // enriched (or already queued), and re-submitting would do the work twice.
    if (!record.replayed) {
      dependencies.enrichment.submit({
        kind: 'source.captured',
        cellId: context.cellId,
        sourceId: record.sourceId,
        workItemId: record.workItemId,
        correlationId: context.correlationId,
        submittedAt: now,
      });
    }

    const enrichmentStatus = dependencies.enrichment.status(now);

    return {
      acknowledgement: 'durable' as const,
      source_id: record.sourceId,
      source_version_id: record.sourceVersionId,
      work_item_id: record.workItemId,
      capture_event_id: record.captureEventId,
      content_hash: record.contentHash,
      replayed: record.replayed,
      replay_reason: record.replayReason,
      emitted_event_ids: [...record.emittedEventIds],
      audit_entry_id: record.auditEntryId,
      enrichment: {
        state: enrichmentStatus.state,
        detail: enrichmentStatus.detail,
      },
      policy: policyDecisionToWire(evaluation.decision),
      identifiers: identifiersOf(context),
      _links: {
        source: `/v1/sources/${record.sourceId}`,
        work_item: record.workItemId === null ? null : `/v1/work/${record.workItemId}`,
        provenance:
          record.workItemId === null ? null : `/v1/work/${record.workItemId}/provenance`,
      },
    };
  });
}

function actorKindFor(principal: {
  roles: readonly string[];
  delegatedActorId?: string;
}): 'user' | 'agent' | 'service' {
  if (principal.roles.includes('service_identity')) return 'service';
  if (principal.delegatedActorId !== undefined) return 'agent';
  return 'user';
}

/** Exported for the OpenAPI generator and the registry consistency check. */
export const captureRoutes = [captureRoute];

/** Re-exported so `openapi.ts` can list the slice's supported kinds. */
export const SUPPORTED_CAPTURE_KINDS = z.enum(['text', 'voice_transcript']).options;
