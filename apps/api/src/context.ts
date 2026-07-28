/**
 * Per-request context — FRANK-§12.1, FRANK-§19.1.
 *
 * FRANK-§12.1: "Explicit cell, actor, policy, trace, and request identifiers."
 * FRANK-§19.1: "Every request, run, workflow, model call, tool call, connector
 * action, event, artifact, review, release, and incident shares trace and
 * correlation identifiers."
 *
 * ## Correlation is accepted from the client; request and trace ids are not
 *
 * A correlation id crosses service boundaries by definition — that is what makes
 * it useful — so an inbound `X-Correlation-Id` is honoured after validation.
 * A *request* id must be unique to this hop, and a trace id must not be
 * forgeable, so both are minted here. A client that could set the request id
 * could make two different requests indistinguishable in the log, which is a
 * cheap way to hide one of them.
 *
 * The inbound correlation id is length- and charset-checked before it is
 * accepted, because it ends up in log lines and in a `urn:` in a problem detail,
 * and an unvalidated string in a log line is a log-injection primitive.
 */

import { randomUUID } from 'node:crypto';

import type { Principal } from '@frank/identity';

/** Conservative: hex, dash, underscore, dot. Long enough for a UUID or a W3C id. */
const CORRELATION_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

export interface RequestContext {
  readonly cellId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly receivedAt: Date;
  readonly policyVersion: string;
  /** Set by the authentication hook. Absent on unauthenticated probes. */
  principal?: Principal;
  /** FRANK-§12.1 idempotency key, once resolved and cross-checked. */
  idempotencyKey?: string;
}

export interface BuildContextInput {
  readonly cellId: string;
  readonly policyVersion: string;
  readonly inboundCorrelationId: string | undefined;
  readonly now: Date;
}

export function buildRequestContext(input: BuildContextInput): RequestContext {
  const correlationId =
    input.inboundCorrelationId !== undefined && CORRELATION_ID_RE.test(input.inboundCorrelationId)
      ? input.inboundCorrelationId
      : randomUUID();

  return {
    cellId: input.cellId,
    requestId: randomUUID(),
    correlationId,
    traceId: randomUUID().replace(/-/g, ''),
    receivedAt: input.now,
    policyVersion: input.policyVersion,
  };
}

/** The actor id recorded in audit entries and event envelopes. */
export function actorIdOf(context: RequestContext): string {
  return context.principal?.principalId ?? 'anonymous';
}

/**
 * The FRANK-§12.1 identifier block, for the response body.
 *
 * In the body as well as in headers because a client that persists a response
 * keeps the body, and the identifiers are what make a persisted response
 * explainable a month later.
 */
export function identifiersOf(context: RequestContext): {
  cell_id: string;
  actor_id: string;
  request_id: string;
  correlation_id: string;
  trace_id: string;
  policy_version: string;
} {
  return {
    cell_id: context.cellId,
    actor_id: actorIdOf(context),
    request_id: context.requestId,
    correlation_id: context.correlationId,
    trace_id: context.traceId,
    policy_version: context.policyVersion,
  };
}

/** Response headers carrying the same identifiers. FRANK-§12.1, FRANK-§19.1. */
export function identifierHeaders(context: RequestContext): Record<string, string> {
  return {
    'x-frank-cell-id': context.cellId,
    'x-frank-request-id': context.requestId,
    'x-frank-correlation-id': context.correlationId,
    'x-frank-trace-id': context.traceId,
    'x-frank-policy-version': context.policyVersion,
  };
}
