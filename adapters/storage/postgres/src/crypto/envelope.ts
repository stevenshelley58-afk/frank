/**
 * Per-cell envelope encryption for stored `sensitive` fields — FRANK-§15.7.
 *
 * FRANK-§15.7: "Application-level per-cell envelope encryption is mandatory for
 * stored `sensitive` fields."
 *
 * ## Construction
 *
 * Standard two-level envelope, no invention:
 *
 *   1. a fresh 256-bit **data encryption key** (DEK) is generated per encrypted
 *      value — per table cell, not per row and not per column;
 *   2. the plaintext is sealed with **AES-256-GCM** under that DEK with a fresh
 *      96-bit IV;
 *   3. the DEK is sealed with AES-256-GCM under the per-cell **key-encryption
 *      key** (KEK) supplied by {@link CellKeyProvider}, with its own fresh IV;
 *   4. the wrapped DEK, both IVs, both tags, and the `KeyRef` travel with the
 *      ciphertext.
 *
 * A fresh DEK per value means the 96-bit random IV never approaches its
 * birthday bound — the well-known GCM failure mode is IV reuse under one key,
 * and with one key per value there is exactly one IV under it. It also means a
 * single leaked DEK discloses one field, not a column.
 *
 * ## Associated data
 *
 * Both GCM operations bind associated data. The *value* AAD is
 * `frank.enc.v1|<cellId>|<table>|<column>|<rowId>|<keyRef>`, which makes a
 * ciphertext non-transplantable: copying the `dob` cell of row A into row B, or
 * into another column, or into another cell's table, fails authentication rather
 * than decrypting to a plausible value. FRANK-§2.4 forbids cross-cell data flow;
 * this makes the storage layer enforce it cryptographically rather than by
 * convention. The *DEK* AAD binds `cellId` and the key reference for the same
 * reason.
 *
 * ## Serialization
 *
 * `frank.enc.v1.<base64url(JSON header)>.<base64url(ciphertext‖tag)>`
 *
 * Self-describing and versioned so a future construction can coexist with
 * existing rows; the version prefix is checked before anything is parsed.
 *
 * ## What this is not
 *
 * It is not a search mechanism. An AES-GCM ciphertext is randomized, so equality
 * search over it is impossible by design — that is what `blind-index.ts` is for.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import type { CellKeyProvider, KeyRef } from './key-provider.js';
import { formatKeyRef, parseKeyRef } from './key-provider.js';

const SCHEME = 'frank.enc.v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits: the NIST SP 800-38D recommended GCM IV length.
const TAG_BYTES = 16;
const DEK_BYTES = 32;

/**
 * Identifies exactly which cell of which row of which table a ciphertext belongs
 * to. Every field is authenticated; none is confidential.
 */
export interface FieldLocator {
  readonly cellId: string;
  /** Physical table name, e.g. `conversation_message`. */
  readonly table: string;
  /** Physical column name, e.g. `body_encrypted`. */
  readonly column: string;
  /** Primary key of the row. */
  readonly rowId: string;
}

interface EnvelopeHeader {
  readonly k: string; // key reference
  readonly wi: string; // DEK wrapping IV
  readonly wk: string; // wrapped DEK ‖ wrapping tag
  readonly iv: string; // value IV
}

export class DecryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`${message} (FRANK-§15.7).`);
    this.name = 'DecryptionError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** True when `value` looks like a ciphertext produced by this module. */
export function isEncryptedField(value: string): boolean {
  return value.startsWith(`${SCHEME}.`);
}

/**
 * Encrypt one field value.
 *
 * @returns an opaque, storable string. Two calls with identical inputs return
 *   different strings; that is semantic security, not nondeterminism to work
 *   around.
 */
export async function encryptField(
  keys: CellKeyProvider,
  locator: FieldLocator,
  plaintext: string,
): Promise<string> {
  const keyRef = await keys.currentKeyEncryptionKeyRef(locator.cellId);
  return encryptFieldWithKeyRef(keys, locator, plaintext, keyRef);
}

/**
 * Encrypt under an explicit key version. Used by re-encryption jobs during
 * rotation, where the target version is chosen by the job rather than by
 * "whatever is current right now".
 */
export async function encryptFieldWithKeyRef(
  keys: CellKeyProvider,
  locator: FieldLocator,
  plaintext: string,
  keyRef: KeyRef,
): Promise<string> {
  if (keyRef.cellId !== locator.cellId) {
    throw new DecryptionError(
      `Key reference belongs to cell ${keyRef.cellId} but the field belongs to cell ${locator.cellId}`,
    );
  }

  const kek = await keys.keyEncryptionKey(keyRef);
  assertKeyLength(kek);

  const dek = randomBytes(DEK_BYTES);
  const valueIv = randomBytes(IV_BYTES);
  const wrapIv = randomBytes(IV_BYTES);

  const wrapCipher = createCipheriv(ALGORITHM, kek, wrapIv);
  wrapCipher.setAAD(Buffer.from(dekAad(keyRef), 'utf8'));
  const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final(), wrapCipher.getAuthTag()]);

  const valueCipher = createCipheriv(ALGORITHM, dek, valueIv);
  valueCipher.setAAD(Buffer.from(valueAad(locator, keyRef), 'utf8'));
  const sealed = Buffer.concat([
    valueCipher.update(Buffer.from(plaintext, 'utf8')),
    valueCipher.final(),
    valueCipher.getAuthTag(),
  ]);

  // Zero the DEK's heap copy. Not a guarantee — V8 may have copied it — but the
  // cost is one memset and it shortens the window in a core dump.
  dek.fill(0);

  const header: EnvelopeHeader = {
    k: formatKeyRef(keyRef),
    wi: b64url(wrapIv),
    wk: b64url(wrappedDek),
    iv: b64url(valueIv),
  };

  return `${SCHEME}.${b64url(Buffer.from(JSON.stringify(header), 'utf8'))}.${b64url(sealed)}`;
}

/**
 * Decrypt one field value.
 *
 * Throws {@link DecryptionError} on any failure — wrong cell, wrong row, wrong
 * column, tampered ciphertext, tampered header, missing key. It never returns a
 * partially-trusted value.
 */
export async function decryptField(
  keys: CellKeyProvider,
  locator: FieldLocator,
  stored: string,
): Promise<string> {
  const [headerPart, bodyPart] = splitStored(stored);

  let header: EnvelopeHeader;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as EnvelopeHeader;
  } catch (error) {
    throw new DecryptionError('Ciphertext header is not valid JSON', error);
  }
  if (
    typeof header?.k !== 'string' ||
    typeof header?.wi !== 'string' ||
    typeof header?.wk !== 'string' ||
    typeof header?.iv !== 'string'
  ) {
    throw new DecryptionError('Ciphertext header is missing required fields');
  }

  const keyRef = parseKeyRef(header.k);
  if (keyRef.cellId !== locator.cellId) {
    throw new DecryptionError(
      `Ciphertext was sealed for cell ${keyRef.cellId} but is being read as cell ${locator.cellId}`,
    );
  }

  const kek = await keys.keyEncryptionKey(keyRef);
  assertKeyLength(kek);

  const wrapped = Buffer.from(header.wk, 'base64url');
  if (wrapped.length !== DEK_BYTES + TAG_BYTES) {
    throw new DecryptionError('Wrapped data key has the wrong length');
  }

  let dek: Buffer;
  try {
    const unwrap = createDecipheriv(ALGORITHM, kek, Buffer.from(header.wi, 'base64url'));
    unwrap.setAAD(Buffer.from(dekAad(keyRef), 'utf8'));
    unwrap.setAuthTag(wrapped.subarray(DEK_BYTES));
    dek = Buffer.concat([unwrap.update(wrapped.subarray(0, DEK_BYTES)), unwrap.final()]);
  } catch (error) {
    throw new DecryptionError('Data key unwrap failed; key material or header was tampered with', error);
  }

  const sealed = Buffer.from(bodyPart, 'base64url');
  if (sealed.length < TAG_BYTES) {
    throw new DecryptionError('Ciphertext is shorter than its authentication tag');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, dek, Buffer.from(header.iv, 'base64url'));
    decipher.setAAD(Buffer.from(valueAad(locator, keyRef), 'utf8'));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    const plaintext = Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (error) {
    throw new DecryptionError(
      'Authenticated decryption failed; the ciphertext, its associated data, or its location does not match',
      error,
    );
  } finally {
    dek.fill(0);
  }
}

/**
 * Re-wrap an existing ciphertext under the cell's current key version without
 * exposing the plaintext to the caller. This is the rotation primitive: it
 * decrypts and re-encrypts inside one function so a rotation job never handles a
 * plaintext it has no business seeing.
 */
export async function rewrapField(
  keys: CellKeyProvider,
  locator: FieldLocator,
  stored: string,
): Promise<string> {
  const plaintext = await decryptField(keys, locator, stored);
  try {
    return await encryptField(keys, locator, plaintext);
  } finally {
    // Best-effort: strings are immutable in JS, so this is documentation of
    // intent rather than an erasure. The real control is that `plaintext` never
    // leaves this scope.
  }
}

/** Read the key reference from a stored ciphertext without decrypting it. */
export function keyRefOf(stored: string): KeyRef {
  const [headerPart] = splitStored(stored);
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as EnvelopeHeader;
  return parseKeyRef(header.k);
}

/**
 * Split `frank.enc.v1.<header>.<body>` into its two base64url parts.
 *
 * The scheme prefix itself contains dots, so this strips the literal prefix
 * first and only then splits. Splitting the whole string on `.` and indexing
 * would silently shift if the scheme version ever gained or lost a segment.
 */
function splitStored(stored: string): [header: string, body: string] {
  const prefix = `${SCHEME}.`;
  if (!stored.startsWith(prefix)) {
    throw new DecryptionError(
      `Value is not a ${SCHEME} ciphertext; refusing to guess at its encoding`,
    );
  }
  const parts = stored.slice(prefix.length).split('.');
  const [header, body] = parts;
  if (parts.length !== 2 || header === undefined || body === undefined || header === '' || body === '') {
    throw new DecryptionError(
      `Value is not a ${SCHEME} ciphertext; refusing to guess at its encoding`,
    );
  }
  return [header, body];
}

function valueAad(locator: FieldLocator, keyRef: KeyRef): string {
  return [
    SCHEME,
    locator.cellId,
    locator.table,
    locator.column,
    locator.rowId,
    formatKeyRef(keyRef),
  ].join('|');
}

function dekAad(keyRef: KeyRef): string {
  return [SCHEME, 'dek', keyRef.cellId, formatKeyRef(keyRef)].join('|');
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function assertKeyLength(key: Uint8Array): void {
  if (key.length !== 32) {
    throw new DecryptionError(`AES-256 requires a 32-byte key; provider returned ${key.length}`);
  }
}

/**
 * Constant-time comparison, re-exported for callers that need to compare a
 * blind index they just computed against one read from the database. Length
 * differences leak, so mismatched lengths short-circuit to `false` rather than
 * throwing the way `timingSafeEqual` does.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
