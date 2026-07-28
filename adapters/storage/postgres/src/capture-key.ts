/**
 * Capture idempotency — FRANK-§10.2, FRANK-§12.1, UX-003, UX-004.
 *
 * Slice 1's exit gate is that replaying the same capture produces one source and
 * one work item. Two independent keys make that true, and they are independent
 * because they answer different questions:
 *
 *   `requestIdempotencyKey`  supplied by the client (FRANK-§12.1: "Idempotency
 *                            keys on all action endpoints"). Answers "is this
 *                            the same *request* I already handled?" It catches a
 *                            retry after a timeout, where the client cannot know
 *                            whether the first attempt committed.
 *
 *   {@link captureIdempotencyKey}  derived here from the *content and origin*.
 *                            Answers "have I already got these bytes from this
 *                            place?" It catches the same email arriving through
 *                            two connectors, a re-sync after a cursor reset, and
 *                            a user pasting the same URL twice.
 *
 * Only the second one needs a construction, so only the second one is here. Both
 * are backed by unique indexes (`capture_event_request_uidx` and
 * `source_capture_idem_uidx`), so the guarantee is the database's, not a
 * read-then-write race in the repository.
 *
 * ## Encoding
 *
 * Fields are length-prefixed before hashing. Plain concatenation with a
 * separator is ambiguous — `originUri = "a|b"` with `externalId = "c"` would
 * collide with `originUri = "a"` and `externalId = "b|c"` — and two captures
 * that collide here are silently merged into one source, which is data loss
 * rather than a visible error. Length prefixes make that impossible.
 */

import { createHash } from 'node:crypto';

/**
 * The facts that decide whether two captures are the same capture.
 *
 * `capturedAt` is deliberately absent: a re-fetch of the same URL an hour later
 * is the same source, and including the time would make every replay a new row.
 * `dataClass` and `trust` are absent for the same reason — a reclassification
 * must not fork the source.
 */
export interface CaptureIdentity {
  /** FRANK-§2.4: a capture never merges across cells. */
  readonly cellId: string;
  readonly kind: string;
  /** SHA-256 of the raw bytes, `sha256:`-prefixed. */
  readonly contentHash: string;
  readonly originUri?: string | undefined;
  readonly externalProviderId?: string | undefined;
  readonly externalAccountId?: string | undefined;
  readonly externalId?: string | undefined;
}

const SCHEME = 'frank.capture-idem.v1';

/**
 * Derive the content-and-origin idempotency key.
 *
 * Deterministic and side-effect free: the same identity always produces the same
 * key, in this process or any other, now or after a restart. That property is
 * what `capture-key.test.ts` asserts, and it is what makes the unique index
 * usable as the replay guard.
 *
 * @returns 64 lowercase hex characters (no `sha256:` prefix — this is a key, not
 *   a content digest, and prefixing it would invite someone to treat it as one).
 */
export function captureIdempotencyKey(identity: CaptureIdentity): string {
  const hash = createHash('sha256');
  hash.update(field(SCHEME));
  hash.update(field(identity.cellId));
  hash.update(field(identity.kind));
  hash.update(field(identity.contentHash));
  hash.update(field(identity.originUri));
  hash.update(field(identity.externalProviderId));
  hash.update(field(identity.externalAccountId));
  hash.update(field(identity.externalId));
  return hash.digest('hex');
}

/**
 * Length-prefixed encoding of one field.
 *
 * `undefined` and the empty string are encoded differently (`-1:` versus `0:`)
 * so "no origin URI" and "an empty origin URI" are distinguishable. Collapsing
 * them would be a small ambiguity with a large consequence: two sources merging.
 */
function field(value: string | undefined): Buffer {
  if (value === undefined) return Buffer.from('-1:', 'utf8');
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(`${bytes.length}:`, 'utf8'), bytes]);
}

/**
 * Idempotency key for one occurrence of a recurring work item — WORK-005.
 *
 * "Repeating work must use recurrence rules and idempotency keys, not copied ad
 * hoc tasks. Retry and daylight-saving tests produce one intended occurrence."
 *
 * The key is the series plus the occurrence's **local wall-clock start** and its
 * IANA zone, not the UTC instant. That is the whole point of the requirement: on
 * the night a zone repeats an hour, the same local 02:30 maps to two UTC
 * instants, and keying on the instant would produce two occurrences of a daily
 * 02:30 routine. Keying on the local time plus zone produces one.
 *
 * @param localStart e.g. `2026-04-05T02:30:00` — no offset, no `Z`.
 * @param timezone IANA zone the rule is evaluated in, e.g. `Australia/Melbourne`.
 */
export function occurrenceIdempotencyKey(
  seriesId: string,
  localStart: string,
  timezone: string,
): string {
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(localStart)) {
    throw new TypeError(
      `occurrenceIdempotencyKey expects a local wall-clock time without an offset; received ${JSON.stringify(localStart)}. ` +
        'Keying on the UTC instant produces two occurrences across a daylight-saving repeat (WORK-005).',
    );
  }
  const hash = createHash('sha256');
  hash.update(field('frank.occurrence-idem.v1'));
  hash.update(field(seriesId));
  hash.update(field(localStart));
  hash.update(field(timezone));
  return hash.digest('hex');
}
