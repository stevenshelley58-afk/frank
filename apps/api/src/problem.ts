/**
 * RFC 9457 problem details — FRANK-§12.1.
 *
 * "RFC 9457-compatible problem details for errors."
 *
 * ## The catalogue is closed
 *
 * FRANK-§12.2: "Every OpenAPI operation declares … error catalogue." An error
 * type not in {@link PROBLEM_TYPES} cannot be constructed, so the OpenAPI
 * document's error catalogue is derivable from this file rather than being a
 * hand-maintained list that drifts from what the server actually returns.
 *
 * ## What a problem detail must never carry
 *
 * FRANK-§2.3: a `secret`-class value must never reach a response. FRANK-§15.1
 * lists "secret leakage through prompts, logs, artifacts, telemetry, or
 * previews" as a threat. So:
 *
 *   * `detail` is written by the server, never interpolated from a request body
 *     or a credential;
 *   * an unexpected exception becomes a generic `internal-error` problem whose
 *     `detail` is a fixed string. The real error goes to the log with the
 *     correlation id, and the client gets the id. A stack trace in a response is
 *     the cheapest reconnaissance an attacker will ever get.
 *
 * `instance` carries the correlation id rather than the request path, so a user
 * reporting an error hands over something that finds the log line
 * (FRANK-§19.1) without disclosing the resource they were looking at.
 */

/** The closed error catalogue. `type` is the URI a client matches on. */
export const PROBLEM_TYPES = {
  validation_failed: {
    type: 'https://frank.fail/problems/validation-failed',
    title: 'Request failed schema validation',
    status: 400,
  },
  unauthenticated: {
    type: 'https://frank.fail/problems/unauthenticated',
    title: 'Authentication required',
    status: 401,
  },
  forbidden: {
    type: 'https://frank.fail/problems/forbidden',
    title: 'Not permitted',
    status: 403,
  },
  policy_denied: {
    type: 'https://frank.fail/problems/policy-denied',
    title: 'Policy denied this action',
    status: 403,
  },
  policy_hold_for_review: {
    type: 'https://frank.fail/problems/policy-hold-for-review',
    title: 'Held for review',
    status: 409,
  },
  not_found: {
    type: 'https://frank.fail/problems/not-found',
    title: 'Resource not found',
    status: 404,
  },
  version_conflict: {
    type: 'https://frank.fail/problems/version-conflict',
    title: 'Resource was modified concurrently',
    status: 409,
  },
  invalid_transition: {
    type: 'https://frank.fail/problems/invalid-transition',
    title: 'Illegal work item state transition',
    status: 422,
  },
  idempotency_conflict: {
    type: 'https://frank.fail/problems/idempotency-conflict',
    title: 'Idempotency key reused with different parameters',
    status: 409,
  },
  unsupported_capture_kind: {
    type: 'https://frank.fail/problems/unsupported-capture-kind',
    title: 'Capture kind not available in this slice',
    status: 415,
  },
  service_unavailable: {
    type: 'https://frank.fail/problems/service-unavailable',
    title: 'Dependency unavailable',
    status: 503,
  },
  internal_error: {
    type: 'https://frank.fail/problems/internal-error',
    title: 'Internal error',
    status: 500,
  },
} as const;

export type ProblemKind = keyof typeof PROBLEM_TYPES;

/** RFC 9457 members plus the FRANK-§12.1 identifier extensions. */
export interface ProblemDetail {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  /** FRANK-§19.1 correlation id. Not a URL — see the module comment. */
  readonly instance: string;
  /** FRANK-§12.1: "Explicit cell, actor, policy, trace, and request identifiers." */
  readonly cell_id: string;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly policy_version?: string;
  /** Field-level validation failures. Paths only; never the rejected values. */
  readonly errors?: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

export class ProblemError extends Error {
  readonly kind: ProblemKind;
  readonly problemDetail: string;
  readonly fieldErrors: ReadonlyArray<{ path: string; message: string }> | undefined;
  readonly policyVersion: string | undefined;

  constructor(
    kind: ProblemKind,
    detail: string,
    options: {
      readonly fieldErrors?: ReadonlyArray<{ path: string; message: string }>;
      readonly policyVersion?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(`${PROBLEM_TYPES[kind].title}: ${detail}`, { cause: options.cause });
    this.name = 'ProblemError';
    this.kind = kind;
    this.problemDetail = detail;
    this.fieldErrors = options.fieldErrors;
    this.policyVersion = options.policyVersion;
  }
}

export interface ProblemIdentifiers {
  readonly cellId: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export function toProblemDetail(
  error: ProblemError,
  identifiers: ProblemIdentifiers,
): ProblemDetail {
  const spec = PROBLEM_TYPES[error.kind];
  return {
    type: spec.type,
    title: spec.title,
    status: spec.status,
    detail: error.problemDetail,
    instance: `urn:frank:correlation:${identifiers.correlationId}`,
    cell_id: identifiers.cellId,
    request_id: identifiers.requestId,
    correlation_id: identifiers.correlationId,
    ...(error.policyVersion === undefined ? {} : { policy_version: error.policyVersion }),
    ...(error.fieldErrors === undefined ? {} : { errors: error.fieldErrors }),
  };
}

/**
 * The problem an unexpected exception becomes.
 *
 * Deliberately says nothing. The caller logs the real error against the same
 * correlation id, which is the only place the two halves are joined.
 */
export function opaqueInternalProblem(identifiers: ProblemIdentifiers): ProblemDetail {
  return toProblemDetail(
    new ProblemError(
      'internal_error',
      'The request could not be completed. Quote the correlation id when reporting this.',
    ),
    identifiers,
  );
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
