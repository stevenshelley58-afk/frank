/**
 * Envelope canonicalisation, hashing, and freezing — FRANK-§6.9.
 *
 * "The Policy Service evaluates an **immutable** envelope."
 *
 * Immutability here means three separate things, and each needs its own
 * mechanism:
 *
 *   1. **The value the engine sees cannot change under it.** {@link freezeEnvelope}
 *      deep-freezes a structural copy, so a caller that keeps a reference to the
 *      object it passed in cannot mutate the array the engine is iterating.
 *   2. **A decision is bound to one exact envelope.** {@link envelopeHash} produces
 *      the `evaluatedEnvelopeHash` that FRANK-§6.9 puts inside every
 *      `PolicyDecision`, so a decision presented alongside a different envelope
 *      is detectable at the execution boundary
 *      (see `decision.ts#assertDecisionAppliesTo`).
 *   3. **Nobody but a registered signer can produce a valid envelope.** The
 *      signature covers exactly the bytes {@link canonicalEnvelopeBytes} produces
 *      (see `signing.ts`).
 *
 * ## Why the canonical form is a field list and not sorted-key JSON
 *
 * The usual approach — `JSON.stringify` with sorted keys — has a hole for this
 * use: an attacker can add a key the schema does not declare, and a sorted-key
 * serializer will faithfully include it, so two parties can disagree about what
 * was signed if one of them strips unknown fields. Here the canonical form is
 * built from an explicit list of the fields the frozen `ActionEnvelope` contract
 * declares, in a fixed order, and anything else in the input is *not*
 * serialized. An attacker adding a field therefore changes nothing they hoped to
 * change, and — because {@link freezeEnvelope} also drops undeclared fields — the
 * engine never reads it either.
 *
 * `signature` is excluded from the signed bytes, for the obvious reason. It is
 * *included* in {@link envelopeHash}, so that re-signing an otherwise identical
 * envelope produces a different hash and cannot inherit an existing decision.
 */

import { createHash } from 'node:crypto';

import type { ActionEnvelope, ResourceRef } from '@frank/contracts';

/**
 * The declared fields of `frank.action/v1` in canonical order, excluding
 * `signature`. Adding a field to the contract without adding it here is caught
 * by `envelope.test.ts`, which walks the contract's own example.
 */
const SIGNED_FIELD_ORDER = [
  'schema',
  'actionId',
  'idempotencyKey',
  'nonce',
  'cellId',
  'principalId',
  'delegatedActorId',
  'operation',
  'actionClass',
  'target',
  'recipient',
  'requestHash',
  'artifactDigest',
  'dataClasses',
  'credentialHandles',
  'networkScope',
  'budget',
  'validFrom',
  'expiresAt',
  'compensation',
  'signerId',
] as const;

type CanonicalPrimitive = string | number | boolean | null;
type CanonicalNode = CanonicalPrimitive | CanonicalNode[] | { [key: string]: CanonicalNode };

/**
 * Serialize a value with object keys in lexicographic order.
 *
 * Only used for the *nested* structures (`target`, `networkScope`, `budget`,
 * `compensation`), whose shapes are small, closed, and fully declared by the
 * contract. The top level uses {@link SIGNED_FIELD_ORDER} instead — see the
 * module comment.
 */
function canonicalize(value: CanonicalNode): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Cannot canonicalize the non-finite number ${String(value)}: a signature over NaN or Infinity is not reproducible across JSON implementations.`,
      );
    }
    // Integers only. A float in a budget would already be a FIN-002 violation,
    // and float formatting is the classic source of signature mismatches.
    if (!Number.isInteger(value)) {
      return JSON.stringify(value);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = value[key];
    if (child === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalize(child)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * The exact bytes a signature covers.
 *
 * A field that is absent is *omitted*, not rendered as `null`: the contract uses
 * `exactOptionalPropertyTypes`, so `recipient: undefined` and "no recipient" are
 * the same state, and rendering them differently would let an attacker produce
 * two envelopes that are equal to every consumer but hash differently.
 */
export function canonicalEnvelopeBytes(envelope: ActionEnvelope): Buffer {
  const record = envelope as unknown as Record<string, CanonicalNode | undefined>;
  const parts: string[] = [];
  for (const field of SIGNED_FIELD_ORDER) {
    const value = record[field];
    if (value === undefined) continue;
    parts.push(`${JSON.stringify(field)}:${canonicalize(value)}`);
  }
  return Buffer.from(`{${parts.join(',')}}`, 'utf8');
}

/**
 * Domain separator between the canonical body and the signature.
 *
 * A byte that cannot appear in either side, so no body can be crafted whose
 * tail is mistaken for the start of the signature. `"…}"` followed by a chosen
 * suffix would otherwise be a length-extension-flavoured ambiguity.
 */
const SIGNATURE_SEPARATOR = Buffer.from([0x1f, 0x73, 0x69, 0x67, 0x1f]); // US "sig" US

/**
 * `sha256:`-prefixed digest of the envelope *including* its signature.
 *
 * This is FRANK-§6.9's `PolicyDecision.evaluatedEnvelopeHash`. Prefixed because
 * the frozen contract's schema pattern is `^sha256:[0-9a-f]{64}$` — an
 * unprefixed digest would fail its own schema.
 */
export function envelopeHash(envelope: ActionEnvelope): string {
  const body = canonicalEnvelopeBytes(envelope);
  const hash = createHash('sha256')
    .update(body)
    .update(SIGNATURE_SEPARATOR)
    .update(Buffer.from(envelope.signature, 'utf8'))
    .digest('hex');
  return `sha256:${hash}`;
}

/**
 * Freeze in place and keep the declared type.
 *
 * `Object.freeze` widens its result to `Readonly<T>`, which for an array is
 * `readonly T[]` — and the frozen `ActionEnvelope` contract declares its arrays
 * as mutable `T[]`. Rather than change a frozen contract to suit an
 * implementation detail, the runtime guarantee (frozen) and the declared type
 * (mutable) are allowed to differ here, in one named helper, where the
 * discrepancy is visible instead of scattered across a dozen casts.
 */
function frozen<T>(value: T): T {
  Object.freeze(value);
  return value;
}

function freezeResource(ref: ResourceRef): ResourceRef {
  return frozen({
    kind: ref.kind,
    id: ref.id,
    ...(ref.cellId === undefined ? {} : { cellId: ref.cellId }),
  });
}

/**
 * Return a deep-frozen structural copy carrying only the contract's declared
 * fields.
 *
 * Copy rather than `Object.freeze` in place, for two reasons that both come from
 * FRANK-§6.9's word "immutable": freezing the caller's object would be a
 * surprising side effect on a value they still own, and — more importantly —
 * freezing in place leaves any undeclared extra properties present, where a
 * later code path could read one. Dropping them here means an undeclared field
 * cannot influence a decision even by accident.
 *
 * The result satisfies `Object.isFrozen` at every level, so an attempt to mutate
 * it throws in strict mode (which every ES module is) rather than silently
 * succeeding.
 */
export function freezeEnvelope(envelope: ActionEnvelope): Readonly<ActionEnvelope> {
  const copy: ActionEnvelope = {
    schema: envelope.schema,
    actionId: envelope.actionId,
    idempotencyKey: envelope.idempotencyKey,
    nonce: envelope.nonce,
    cellId: envelope.cellId,
    principalId: envelope.principalId,
    ...(envelope.delegatedActorId === undefined
      ? {}
      : { delegatedActorId: envelope.delegatedActorId }),
    operation: envelope.operation,
    actionClass: envelope.actionClass,
    target: freezeResource(envelope.target),
    ...(envelope.recipient === undefined ? {} : { recipient: freezeResource(envelope.recipient) }),
    requestHash: envelope.requestHash,
    ...(envelope.artifactDigest === undefined
      ? {}
      : { artifactDigest: envelope.artifactDigest }),
    dataClasses: frozen([...envelope.dataClasses]),
    credentialHandles: frozen([...envelope.credentialHandles]),
    networkScope: frozen({
      mode: envelope.networkScope.mode,
      allowedHosts: frozen([...envelope.networkScope.allowedHosts]),
    }),
    budget: frozen({
      currency: envelope.budget.currency,
      maximumSpend: envelope.budget.maximumSpend,
      maximumWallClockSeconds: envelope.budget.maximumWallClockSeconds,
      ...(envelope.budget.maximumTokens === undefined
        ? {}
        : { maximumTokens: envelope.budget.maximumTokens }),
    }),
    validFrom: envelope.validFrom,
    expiresAt: envelope.expiresAt,
    ...(envelope.compensation === undefined
      ? {}
      : {
          compensation: frozen({
            kind: envelope.compensation.kind,
            procedure: envelope.compensation.procedure,
            ...(envelope.compensation.pointOfNoReturn === undefined
              ? {}
              : { pointOfNoReturn: envelope.compensation.pointOfNoReturn }),
          }),
        }),
    signerId: envelope.signerId,
    signature: envelope.signature,
  };
  return Object.freeze(copy);
}

/** True when the two envelopes hash identically. Constant work, not constant time. */
export function envelopesMatch(a: ActionEnvelope, b: ActionEnvelope): boolean {
  return envelopeHash(a) === envelopeHash(b);
}

/**
 * The fields that decide whether two envelopes describe **the same action**.
 *
 * Everything from {@link SIGNED_FIELD_ORDER} except the four that are properties
 * of an *attempt* rather than of the action:
 *
 *   `actionId`    a per-attempt identifier;
 *   `nonce`       the single-use token, which is the key this hash is stored under;
 *   `validFrom`   \ the validity window, which moves with the clock — a retry
 *   `expiresAt`   / five seconds later is the same action, not a different one.
 *
 * See {@link envelopeBindingHash} for why this distinction has to exist.
 */
const BINDING_FIELD_ORDER = SIGNED_FIELD_ORDER.filter(
  (field) => field !== 'actionId' && field !== 'nonce' && field !== 'validFrom' && field !== 'expiresAt',
);

/**
 * Identity of the *action*, independent of when it was attempted.
 *
 * This is what the single-use ledger compares, and getting the distinction wrong
 * breaks one of two things:
 *
 *   * compare the **full** envelope hash, and a legitimate client retry
 *     (FRANK-§12.1 "idempotency keys on all action endpoints") is refused,
 *     because its envelope carries a later validity window than the first
 *     attempt. The retry — the exact thing idempotency exists to make safe —
 *     would fail;
 *   * compare only the **nonce**, and the mutation attack succeeds: an attacker
 *     re-uses a nonce with a different target and the ledger cannot tell.
 *
 * So the ledger compares this: every security-relevant field — principal,
 * delegate, operation, action class, target, recipient, request hash, artifact
 * digest, data classes, credential handles, network scope, budget, signer — and
 * no clock. A retry matches; a substitution does not.
 *
 * The validity window is not unguarded by this omission: `expiresAt` and
 * `validFrom` are covered by the signature (so they cannot be edited) and are
 * checked against the clock *before* the ledger is consulted (so an expired
 * envelope never reaches it). This hash is about identity; expiry is about time,
 * and they are separate questions.
 */
export function envelopeBindingHash(envelope: ActionEnvelope): string {
  const record = envelope as unknown as Record<string, CanonicalNode | undefined>;
  const parts: string[] = [];
  for (const field of BINDING_FIELD_ORDER) {
    const value = record[field];
    if (value === undefined) continue;
    parts.push(`${JSON.stringify(field)}:${canonicalize(value)}`);
  }
  return `sha256:${createHash('sha256')
    .update(Buffer.from(`{${parts.join(',')}}`, 'utf8'))
    .digest('hex')}`;
}
