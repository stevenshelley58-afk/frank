/**
 * `schema://frank.classification/v1` — FRANK-§2.3.
 *
 * One versioned vocabulary used everywhere. Classification and trust are
 * different axes and must never be conflated. Combining data inherits the
 * strictest class. Unknown terms or unknown classification fail closed.
 */

import type { IsoDateTime } from './common.js';

/**
 * FRANK-§2.3 classification vocabulary, ordered least to most restrictive.
 * The ordinality is normative — see {@link DATA_CLASS_ORDER} and
 * {@link strictestOf}.
 */
export type DataClass = 'open' | 'internal' | 'private' | 'sensitive' | 'secret';

/**
 * FRANK-§2.3 content trust.
 *
 * `policy-trusted` can only be produced by the policy-change workflow; ordinary
 * documents and messages can never receive it. `verified-source` content
 * remains evidence to assess and can never issue system instructions.
 */
export type TrustLabel =
  | 'policy-trusted'
  | 'owner-authenticated'
  | 'verified-source'
  | 'external-untrusted'
  | 'generated-untrusted';

/**
 * The FRANK-§2.3 classification vocabulary in its normative order, least to
 * most restrictive. Index position is the restrictiveness rank; nothing else in
 * the system may define a second ordering.
 */
export const DATA_CLASS_ORDER: readonly DataClass[] = [
  'open',
  'internal',
  'private',
  'sensitive',
  'secret',
];

export interface RetentionTerms {
  /**
   * `null` means the processor's retention is unknown. Unknown terms fail
   * closed (FRANK-§2.3).
   */
  retainedForDays: number | null;
  usedForTraining: boolean | null;
  termsVersion: string;
}

export interface Redaction {
  kind: string;
  appliedBy: string;
  /**
   * FRANK-§2.3: only an explicit deterministic redaction may produce a
   * separately verified lower-class artifact. A model-generated redaction is
   * not deterministic and does not lower class.
   */
  deterministic: boolean;
  /**
   * Identifier of the separately verified artifact this redaction produced.
   * Without it the redaction cannot support a class reduction.
   */
  verifiedArtifactId?: string;
}

export type ProcessorKind =
  | 'model'
  | 'tool'
  | 'projection'
  | 'storage'
  | 'telemetry'
  | 'connector';

export type ProcessingMode =
  | 'local'
  | 'dedicated-authenticated'
  | 'hosted-approved'
  | 'promotional-pool';

export interface ContributingSource {
  sourceId: string;
  class: DataClass;
  trust: TrustLabel;
}

export interface Processor {
  kind: ProcessorKind;
  id: string;
}

export interface ProcessingLocation {
  mode: ProcessingMode;
  region?: string;
}

/**
 * FRANK-§2.3: every model, tool, projection, storage, telemetry, and connector
 * route produces one of these.
 */
export interface DataRouteDecision {
  schema: 'frank.data-route/v1';
  decisionId: string;
  cellId: string;
  /**
   * The strictest class among contributing sources unless a deterministic
   * redaction produced a separately verified lower-class artifact.
   */
  effectiveClass: DataClass;
  /** Schema requires at least one entry. */
  contributingSources: ContributingSource[];
  processor: Processor;
  processingLocation: ProcessingLocation;
  retention: RetentionTerms;
  redactions: Redaction[];
  policyVersion: string;
  reason: string;
  decidedAt: IsoDateTime;
}

/**
 * Restrictiveness rank of a data class: `0` for the least restrictive class.
 *
 * Throws on a value outside the vocabulary. FRANK-§2.3: unknown classification
 * fails closed, and the loudest possible failure is the one that cannot be
 * mistaken for a permissive answer.
 */
function rankOf(value: DataClass): number {
  const rank = DATA_CLASS_ORDER.indexOf(value);
  if (rank === -1) {
    throw new RangeError(
      `Unknown data class ${JSON.stringify(value)}. Unknown classification fails closed (FRANK-§2.3).`,
    );
  }
  return rank;
}

/**
 * FRANK-§2.3: "Combining data inherits the strictest class."
 *
 * Throws on an empty array. There is no safe default here — returning `open`
 * would under-classify combined data, and returning `secret` would silently
 * over-restrict a caller that had a bug. An empty input means the caller failed
 * to record its contributing sources, which is the bug worth surfacing.
 */
export function strictestOf(classes: readonly DataClass[]): DataClass {
  const first = classes[0];
  if (first === undefined) {
    throw new RangeError(
      'strictestOf() requires at least one data class; combining zero sources has no defined class (FRANK-§2.3).',
    );
  }

  let strictest = first;
  let strictestRank = rankOf(first);

  for (let i = 1; i < classes.length; i += 1) {
    const candidate = classes[i];
    if (candidate === undefined) continue;
    const candidateRank = rankOf(candidate);
    if (candidateRank > strictestRank) {
      strictest = candidate;
      strictestRank = candidateRank;
    }
  }

  return strictest;
}

/**
 * A redaction may only support a class reduction if it is deterministic *and*
 * produced a separately verified artifact (FRANK-§2.3).
 */
function supportsLowering(redaction: Redaction): boolean {
  return (
    redaction.deterministic === true &&
    typeof redaction.verifiedArtifactId === 'string' &&
    redaction.verifiedArtifactId.length > 0
  );
}

/**
 * FRANK-§2.3 permits lowering a data class ONLY via explicit deterministic
 * redaction producing a separately verified artifact.
 *
 * Returns `true` only when `to` is strictly less restrictive than `from` and
 * every step down the vocabulary is backed by its own qualifying redaction —
 * one that is `deterministic: true` and carries a `verifiedArtifactId`.
 *
 * Returns `false` when `to` is more restrictive than `from` (raising class is
 * never a "lowering") and when `to === from` (there is no lowering to permit).
 * Callers gating an arbitrary transition should ask
 * `to === from || canLowerClass(from, to, redactions)`.
 *
 * Throws on a class outside the vocabulary, for the same fail-closed reason as
 * {@link strictestOf}.
 */
export function canLowerClass(
  from: DataClass,
  to: DataClass,
  redactions: readonly Redaction[],
): boolean {
  const fromRank = rankOf(from);
  const toRank = rankOf(to);

  const steps = fromRank - toRank;
  if (steps <= 0) return false;

  const qualifying = redactions.filter(supportsLowering).length;
  return qualifying >= steps;
}
