/**
 * `GET /v1/work/{id}/provenance` — the Slice 1 exit gate.
 *
 * "Walk a Today card back to its immutable source envelope, run, policy decision
 * and cost receipt."
 *
 * ## Why it lives under `/v1/work` and not under `/v1/provenance`
 *
 * FRANK-§12.2's endpoint-group list has no `/v1/provenance` group, and its
 * method table has no provenance verb. Both facts are load-bearing: adding a
 * top-level group the specification does not name would be inventing an
 * endpoint group, and the specification is explicit that a route absent from the
 * registry cannot ship (FRANK-§3.8).
 *
 * So provenance is a sub-resource of the thing whose provenance it is, in the
 * same shape as FRANK-§12.2's `GET /{resources}/{id}/history`. A Today card
 * links to it directly (`_links.provenance`), so the client-side journey — the
 * one the exit gate describes — is one hop from the card.
 *
 * ## Every link is present or explained
 *
 * The chain has four required links and Slice 1 can supply two of them from real
 * data every time (`sources`, `policy_decisions`), one occasionally
 * (`cost_receipts`, when spend was attached), and one never (`runs`, because
 * there is no agent kernel until Slice 2).
 *
 * Returning `runs: []` on its own would be a lie by omission — it reads as
 * "nothing ran" when the truth is "runs do not exist yet". `unavailable_links`
 * names each missing link, why, and the slice that supplies it. The same
 * discipline as `/v1/today`'s `coverage`, for the same reason.
 *
 * ## The audit chain is verified here, not trusted
 *
 * FRANK-§11.5's chain is hash-linked, and a stored "verified" flag would be a
 * claim the chain makes about itself. `PostgresDomainStore` recomputes the
 * segment at read time and the response carries the result plus the entry
 * hashes, so a caller can recompute it independently.
 */

import type { FastifyInstance } from 'fastify';

import { identifiersOf } from '../context.js';
import { ProblemError } from '../problem.js';
import { defineRoute } from '../schema/registry.js';
import { provenanceResponseSchema, workIdParamsSchema } from '../schema/views.js';
import type { DomainStore } from '../services/store.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { canonicalFreshness } from './work.js';

export const provenanceRoute = defineRoute({
  operationId: 'workProvenance',
  method: 'GET',
  path: '/v1/work/:id/provenance',
  group: '/v1/work',
  summary: 'Walk a work item back to its immutable source envelope',
  description:
    'The Slice 1 exit gate. Returns the source envelopes that caused this work item, their versions and capture events, ' +
    'the FRANK-§6.9 policy decisions recorded on the FRANK-§11.5 hash-linked audit chain (re-verified at read time), ' +
    'and any OPS-001 cost receipts. Links this slice cannot supply are listed in `unavailable_links` with the slice that supplies them.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer'],
  capability: 'provenance.read',
  dataClasses: ['open', 'internal', 'private', 'sensitive'],
  standingPolicyEligible: false,
  policyOperation: 'provenance.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: [],
  params: workIdParamsSchema,
  response: provenanceResponseSchema,
  successStatus: 200,
});

export const provenanceRoutes = [provenanceRoute];

/** Links the chain declares but Slice 1 cannot populate. See the module comment. */
const UNAVAILABLE_LINKS: ReadonlyArray<{ link: string; reason: string; available_in: string }> = [
  {
    link: 'runs',
    reason:
      'There is no durable run record yet: the agent kernel and FRANK-§7.3 run state are Workstream 5.',
    available_in: 'Slice 2',
  },
  {
    link: 'sources[].content',
    reason:
      'ADR-003 puts the raw bytes in object storage, referenced by URI and digest. The object store is not deployed in Slice 1, so the envelope, its hash, and its audit entry resolve but the payload does not.',
    available_in: 'Slice 3',
  },
  {
    link: 'assertions',
    reason: 'The FRANK-§10.2 assertion and knowledge model is Workstream 10.',
    available_in: 'Slice 3',
  },
];

export interface ProvenanceRouteDependencies extends RouteHandlerDependencies {
  readonly store: DomainStore;
}

export function registerProvenanceRoutes(
  app: FastifyInstance,
  dependencies: ProvenanceRouteDependencies,
): void {
  registerRoute(app, dependencies, provenanceRoute, async ({ params, context }) => {
    const now = dependencies.now();
    const chain = await dependencies.store.provenanceFor(context.cellId, params.id);
    if (chain === undefined) {
      throw new ProblemError('not_found', `No work item ${params.id} exists in this cell.`);
    }

    return {
      work_item: {
        id: chain.workItem.id,
        title: chain.workItem.title,
        state: chain.workItem.state,
        created_at: chain.workItem.createdAt.toISOString(),
        data_class: chain.workItem.dataClass,
        provenance: {
          method: chain.workItem.provenance.method,
          producer: chain.workItem.provenance.producer,
          correlation_id: chain.workItem.provenance.correlationId,
        },
      },
      sources: chain.sources.map((source) => ({
        id: source.id,
        relation: source.relation,
        kind: source.kind,
        origin_uri: source.originUri,
        content_hash: source.contentHash,
        raw_artifact_uri: source.rawArtifactUri,
        raw_artifact_sha256: source.rawArtifactSha256,
        data_class: source.dataClass,
        trust: source.trust,
        lifecycle: source.lifecycle,
        captured_at: source.capturedAt.toISOString(),
        captured_by: source.capturedBy,
        current_version_id: source.currentVersionId,
        versions: source.versions.map((version) => ({
          id: version.id,
          version_no: version.versionNo,
          content_hash: version.contentHash,
          recorded_at: version.recordedAt.toISOString(),
          reason: version.reason,
        })),
        capture_events: source.captureEvents.map((event) => ({
          id: event.id,
          request_idempotency_key: event.requestIdempotencyKey,
          channel: event.channel,
          accepted_at: event.acceptedAt.toISOString(),
          replay_count: event.replayCount,
          correlation_id: event.correlationId,
        })),
      })),
      // Slice 2. Empty and explained in `unavailable_links`.
      runs: [],
      policy_decisions: chain.auditEntries.map((entry) => ({
        audit_entry_id: entry.id,
        seq: entry.seq,
        action: entry.action,
        target: { kind: entry.targetKind, id: entry.targetId },
        policy_version: entry.policyVersion,
        result: entry.policyDecision,
        occurred_at: entry.occurredAt.toISOString(),
        actor: entry.actor,
      })),
      cost_receipts: chain.costReceipts.map((receipt) => ({
        id: receipt.id,
        category: receipt.category,
        // A decimal string, never a JSON number: FIN-002 does not survive a
        // float, and the column is `numeric`.
        amount: receipt.amount,
        currency: receipt.currency,
        attribution_state: receipt.attributionState,
        occurred_at: receipt.occurredAt.toISOString(),
        usage_receipt_ref: receipt.usageReceiptRef,
        provider_id: receipt.providerId,
        model_ref: receipt.modelRef,
      })),
      audit_chain: {
        entries: chain.auditEntries.map((entry) => ({
          id: entry.id,
          seq: entry.seq,
          action: entry.action,
          occurred_at: entry.occurredAt.toISOString(),
          entry_hash: entry.entryHash,
          prev_chain_hash: entry.prevChainHash,
          chain_hash: entry.chainHash,
        })),
        verified: chain.chainVerified,
        verification_detail: chain.chainVerificationDetail,
      },
      unavailable_links: UNAVAILABLE_LINKS.map((entry) => ({ ...entry })),
      freshness: canonicalFreshness(chain.asOf, now),
      identifiers: identifiersOf(context),
    };
  });
}
