/**
 * Key material supply — FRANK-§15.3 (Secrets), FRANK-§15.7 (Data protection),
 * ADR-012 (OpenBao is the secret root).
 *
 * The encryption code in this directory never reads an environment variable,
 * never opens a file, and never talks to a network service. It asks this
 * interface for bytes. That is the whole point: ADR-012 puts the key root in
 * OpenBao, OpenBao is a Workstream 3 deliverable, and the canonical data model
 * is Workstream 4. An `OpenBaoCellKeyProvider` implementing this interface drops
 * in with no change to any call site, and `KeyRef` already carries the version
 * OpenBao's transit engine needs for rotation.
 *
 * FRANK-§11.1: "Secrets never appear in domain tables, events, logs, prompts, or
 * artifacts." Nothing here is written to a domain column except the *reference*
 * to a key, which is not itself secret.
 */

/**
 * A pointer to key material. Deliberately not the material itself: this value is
 * stored inside every encrypted cell so a rotated key can still decrypt old
 * rows, and it must be safe to persist and log.
 */
export interface KeyRef {
  /**
   * FRANK-§2.4: keys are per cell. A `KeyRef` from one cell must never decrypt
   * another cell's data, and the AAD binding in `envelope.ts` enforces that even
   * if a provider were misconfigured.
   */
  readonly cellId: string;
  /** Stable name of the key within the cell, e.g. `domain-kek`. */
  readonly name: string;
  /**
   * Monotonic version. Rotation increments it; old versions must remain
   * retrievable for decryption or the ciphertext is lost.
   */
  readonly version: number;
}

/** Purpose separation for blind-index keys — see `blind-index.ts`. */
export interface BlindIndexKeyRef {
  readonly cellId: string;
  /**
   * The index this key serves, e.g. `source.external_id`. Distinct indexes get
   * distinct keys so a compromise of one index does not let an attacker confirm
   * guesses against another.
   */
  readonly index: string;
  readonly version: number;
}

export class KeyUnavailableError extends Error {
  constructor(description: string, cause?: unknown) {
    super(`Key material unavailable: ${description}. Encryption fails closed (FRANK-§15.7).`);
    this.name = 'KeyUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Supplies the two kinds of key material this package needs.
 *
 * Implementations must:
 *   * return exactly 32 bytes (AES-256 / HMAC-SHA256 block-sized keys);
 *   * never return the same bytes for a key-encryption key and a blind-index
 *     key — FRANK-§15.7 treats these as separate mechanisms and reusing one key
 *     across two constructions is the classic way to break both;
 *   * throw {@link KeyUnavailableError} rather than returning a zero key,
 *     a derived-from-nothing key, or a cached stale key.
 */
export interface CellKeyProvider {
  /** Identifier of the backing implementation, recorded in audit provenance. */
  readonly providerId: string;

  /**
   * The key-encryption key version that new writes should use. Rotation is a
   * matter of this returning a higher `version`; existing rows keep decrypting
   * because they carry their own `KeyRef`.
   */
  currentKeyEncryptionKeyRef(cellId: string): Promise<KeyRef>;

  /** Resolve a key-encryption key, including superseded versions. */
  keyEncryptionKey(ref: KeyRef): Promise<Uint8Array>;

  /** The blind-index key version that new writes should use. */
  currentBlindIndexKeyRef(cellId: string, index: string): Promise<BlindIndexKeyRef>;

  /** Resolve a blind-index key, including superseded versions. */
  blindIndexKey(ref: BlindIndexKeyRef): Promise<Uint8Array>;
}

/** Serialize a {@link KeyRef} for storage inside a ciphertext header. */
export function formatKeyRef(ref: KeyRef): string {
  assertRefComponent(ref.cellId, 'cellId');
  assertRefComponent(ref.name, 'name');
  return `${ref.cellId}:${ref.name}:v${ref.version}`;
}

export function parseKeyRef(text: string): KeyRef {
  const parts = text.split(':');
  const [cellId, name, version] = parts;
  if (parts.length !== 3 || !cellId || !name || !version?.startsWith('v')) {
    throw new TypeError(`Malformed key reference ${JSON.stringify(text)}.`);
  }
  const parsed = Number.parseInt(version.slice(1), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`Malformed key version in ${JSON.stringify(text)}.`);
  }
  return { cellId, name, version: parsed };
}

/** `:` is the separator, so it may not appear inside a component. */
function assertRefComponent(value: string, field: string): void {
  if (value.length === 0 || value.includes(':')) {
    throw new TypeError(`KeyRef.${field} must be non-empty and must not contain ':'.`);
  }
}

/**
 * In-memory provider for tests, local development, and migration rehearsal.
 *
 * Explicitly **not** for production: it holds raw key bytes in the process heap
 * with no rotation, no audit, and no revocation, which is exactly what ADR-012
 * moved to OpenBao. It throws for any key it was not handed, so a test that
 * forgets to register a key fails loudly instead of encrypting under a
 * silently-derived default.
 */
export class InMemoryCellKeyProvider implements CellKeyProvider {
  readonly providerId = 'in-memory';

  readonly #kek = new Map<string, Uint8Array>();
  readonly #blind = new Map<string, Uint8Array>();
  readonly #currentKekVersion = new Map<string, number>();
  readonly #currentBlindVersion = new Map<string, number>();

  putKeyEncryptionKey(ref: KeyRef, key: Uint8Array): this {
    assertKeyLength(key, formatKeyRef(ref));
    this.#kek.set(formatKeyRef(ref), key);
    const cellKey = `${ref.cellId}:${ref.name}`;
    const seen = this.#currentKekVersion.get(cellKey) ?? 0;
    if (ref.version > seen) this.#currentKekVersion.set(cellKey, ref.version);
    return this;
  }

  putBlindIndexKey(ref: BlindIndexKeyRef, key: Uint8Array): this {
    const id = blindRefId(ref);
    assertKeyLength(key, id);
    this.#blind.set(id, key);
    const cellKey = `${ref.cellId}:${ref.index}`;
    const seen = this.#currentBlindVersion.get(cellKey) ?? 0;
    if (ref.version > seen) this.#currentBlindVersion.set(cellKey, ref.version);
    return this;
  }

  async currentKeyEncryptionKeyRef(cellId: string): Promise<KeyRef> {
    const name = DOMAIN_KEK_NAME;
    const version = this.#currentKekVersion.get(`${cellId}:${name}`);
    if (version === undefined) {
      throw new KeyUnavailableError(`no key-encryption key registered for cell ${cellId}`);
    }
    return { cellId, name, version };
  }

  async keyEncryptionKey(ref: KeyRef): Promise<Uint8Array> {
    const key = this.#kek.get(formatKeyRef(ref));
    if (key === undefined) throw new KeyUnavailableError(formatKeyRef(ref));
    return key;
  }

  async currentBlindIndexKeyRef(cellId: string, index: string): Promise<BlindIndexKeyRef> {
    const version = this.#currentBlindVersion.get(`${cellId}:${index}`);
    if (version === undefined) {
      throw new KeyUnavailableError(`no blind-index key registered for ${cellId}:${index}`);
    }
    return { cellId, index, version };
  }

  async blindIndexKey(ref: BlindIndexKeyRef): Promise<Uint8Array> {
    const key = this.#blind.get(blindRefId(ref));
    if (key === undefined) throw new KeyUnavailableError(blindRefId(ref));
    return key;
  }
}

/** Conventional name of the per-cell domain key-encryption key. */
export const DOMAIN_KEK_NAME = 'domain-kek';

function blindRefId(ref: BlindIndexKeyRef): string {
  return `${ref.cellId}:${ref.index}:v${ref.version}`;
}

function assertKeyLength(key: Uint8Array, id: string): void {
  if (key.length !== 32) {
    throw new TypeError(`Key ${id} must be exactly 32 bytes; received ${key.length}.`);
  }
}
