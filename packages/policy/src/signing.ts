/**
 * Envelope signing and signer authority — FRANK-§6.9.
 *
 * "Models may propose envelopes but cannot sign, widen, or approve them."
 *
 * That sentence is enforced in three places here:
 *
 *   * {@link SignerRegistry} records `maySign` per signer, and every entry whose
 *     `kind` is `model` or `agent` must have `maySign: false` — the registry
 *     constructor refuses to build otherwise, so the rule cannot be forgotten in
 *     configuration;
 *   * {@link HmacEnvelopeSigner.sign} refuses to sign for a signer that may not
 *     sign, so the proposal path has no code that could produce one;
 *   * the engine verifies the signature against the registry *before* it looks at
 *     anything else, so an envelope carrying `signerId: "model/claude"` fails at
 *     step one whether or not the bytes were somehow signed.
 *
 * The third is the one that actually matters: the first two are our own code
 * behaving, the third holds against an attacker who wrote the JSON themselves.
 *
 * ## Key material never leaves this module
 *
 * FRANK-§2.3: a `secret`-class value must never reach a log, a response, or model
 * context. Keys are obtained through {@link SigningKeyResolver} by *handle*, are
 * held only as locals, and every error thrown here names the handle and never
 * the material. {@link SignerRecord} has no field that could hold a key, which is
 * why the resolver exists at all rather than a `key: Buffer` property that
 * something would eventually `JSON.stringify`.
 *
 * ## Why HMAC in Slice 1
 *
 * The API and the policy engine are the same process in Slice 1, so a shared
 * symmetric key is a real boundary between "the session that authenticated
 * Steven" and "some other code path", which is the boundary §6.9 is drawing.
 * {@link SignatureAlgorithm} is part of the record rather than a constant so an
 * asymmetric signer (an Ed25519 key held by the Execution Service, or a key in
 * OpenBao per FRANK-§15.3) is a second implementation of
 * {@link EnvelopeSignatureVerifier} and not a change to any call site.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ActionClass, ActionEnvelope } from '@frank/contracts';

import { canonicalEnvelopeBytes } from './envelope.js';

/** FRANK-§2.2 role model plus the two non-human proposer kinds. */
export type SignerKind =
  | 'owner'
  | 'operator'
  | 'builder'
  | 'member'
  | 'reviewer'
  | 'service'
  | 'agent'
  | 'model';

export type SignatureAlgorithm = 'hmac-sha256';

export interface SignerRecord {
  readonly signerId: string;
  readonly kind: SignerKind;
  /**
   * FRANK-§6.9. `false` for every `model` and `agent`, enforced by
   * {@link SignerRegistry}.
   */
  readonly maySign: boolean;
  /**
   * The most consequential class this signer may sign for. An envelope above it
   * is denied even if the standing authorization would allow the operation —
   * this is the privilege ceiling that makes delegation an intersection rather
   * than an inheritance.
   */
  readonly maximumActionClass: ActionClass;
  readonly algorithm: SignatureAlgorithm;
  /**
   * FRANK-§2.3/§15.3: an opaque handle, never material. Pattern mirrors the
   * frozen contract's `credentialHandles`: `handle:...`.
   */
  readonly keyHandle: string;
}

/** Resolves an opaque handle to key material. Implementations hold the secret. */
export interface SigningKeyResolver {
  resolve(keyHandle: string): Uint8Array | undefined;
}

export class UnknownSignerError extends Error {
  readonly signerId: string;
  constructor(signerId: string) {
    super(`Unknown signer ${JSON.stringify(signerId)}; an unregistered signer cannot sign or be trusted (FRANK-§6.9).`);
    this.name = 'UnknownSignerError';
    this.signerId = signerId;
  }
}

export class SignerMayNotSignError extends Error {
  readonly signerId: string;
  constructor(record: SignerRecord) {
    super(
      `Signer ${JSON.stringify(record.signerId)} has kind "${record.kind}" and maySign=false. ` +
        'Models may propose envelopes but cannot sign, widen, or approve them (FRANK-§6.9).',
    );
    this.name = 'SignerMayNotSignError';
    this.signerId = record.signerId;
  }
}

export class MissingKeyMaterialError extends Error {
  constructor(keyHandle: string) {
    // Names the handle; never the material.
    super(`No key material is available for handle ${JSON.stringify(keyHandle)} (FRANK-§15.3).`);
    this.name = 'MissingKeyMaterialError';
  }
}

/**
 * The set of principals whose signatures the policy engine will consider.
 *
 * Constructed from a list rather than mutated, so the set a decision was made
 * against is a value that can be recorded. Adding a signer at runtime means
 * building a new registry, which is the correct amount of friction for "who may
 * authorize actions in this cell".
 */
export class SignerRegistry {
  readonly #records: ReadonlyMap<string, SignerRecord>;

  constructor(records: readonly SignerRecord[]) {
    const map = new Map<string, SignerRecord>();
    for (const record of records) {
      if ((record.kind === 'model' || record.kind === 'agent') && record.maySign) {
        throw new TypeError(
          `Signer ${JSON.stringify(record.signerId)} has kind "${record.kind}" and maySign=true. ` +
            'FRANK-§6.9 forbids it: models may propose envelopes but cannot sign, widen, or approve them.',
        );
      }
      if (!record.keyHandle.startsWith('handle:')) {
        throw new TypeError(
          `Signer ${JSON.stringify(record.signerId)} declares keyHandle ${JSON.stringify(record.keyHandle)}, ` +
            'which is not an opaque handle. FRANK-§2.3 permits handles only; raw key material in configuration is a contract violation.',
        );
      }
      if (map.has(record.signerId)) {
        throw new TypeError(`Duplicate signer id ${JSON.stringify(record.signerId)} in the registry.`);
      }
      map.set(record.signerId, Object.freeze({ ...record }));
    }
    this.#records = map;
  }

  get(signerId: string): SignerRecord | undefined {
    return this.#records.get(signerId);
  }

  /** Throws {@link UnknownSignerError} rather than returning `undefined`. */
  require(signerId: string): SignerRecord {
    const record = this.#records.get(signerId);
    if (record === undefined) throw new UnknownSignerError(signerId);
    return record;
  }

  list(): readonly SignerRecord[] {
    return [...this.#records.values()];
  }
}

/**
 * Verifies that an envelope was signed by the signer it names.
 *
 * A port, because Slice 1's shared-secret HMAC and a later OpenBao-held
 * asymmetric key are different implementations of the same question, and
 * FRANK-§6.9's ordering ("evaluate the immutable envelope, *then* exchange
 * credential handles") only holds if the verifier is on the policy side of the
 * boundary rather than inside the executor.
 */
export interface EnvelopeSignatureVerifier {
  /** Never throws for a bad signature; returns `false`. Throws only on misuse. */
  verify(envelope: ActionEnvelope, signer: SignerRecord): boolean;
}

/** Produces signatures. Deliberately a *different* interface from the verifier. */
export interface EnvelopeSigner {
  sign(envelope: Omit<ActionEnvelope, 'signature'>, signer: SignerRecord): string;
}

/**
 * HMAC-SHA256 over {@link canonicalEnvelopeBytes}.
 *
 * Signing and verification are one class because they share the key resolver,
 * but they are two interfaces, so a component that must only verify (the policy
 * engine) can be given a value typed as {@link EnvelopeSignatureVerifier} and
 * has no `sign` method to reach for.
 */
export class HmacEnvelopeSigner implements EnvelopeSigner, EnvelopeSignatureVerifier {
  readonly #keys: SigningKeyResolver;

  constructor(keys: SigningKeyResolver) {
    this.#keys = keys;
  }

  sign(envelope: Omit<ActionEnvelope, 'signature'>, signer: SignerRecord): string {
    if (!signer.maySign) throw new SignerMayNotSignError(signer);
    if (envelope.signerId !== signer.signerId) {
      throw new TypeError(
        `Envelope names signerId ${JSON.stringify(envelope.signerId)} but is being signed by ` +
          `${JSON.stringify(signer.signerId)}. Signing on another principal's behalf is the confused-deputy ` +
          'attack FRANK-§6.9 requires us to fail.',
      );
    }
    return this.#mac(envelope as ActionEnvelope, signer);
  }

  verify(envelope: ActionEnvelope, signer: SignerRecord): boolean {
    if (!signer.maySign) return false;
    if (envelope.signerId !== signer.signerId) return false;
    let expected: string;
    try {
      expected = this.#mac(envelope, signer);
    } catch {
      // A missing key is a verification failure, not an exception the caller
      // must catch. Fail closed, quietly, at the boundary.
      return false;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(envelope.signature, 'utf8');
    // `timingSafeEqual` throws on a length mismatch, which would itself leak the
    // length. Compare lengths first and return the same `false` either way.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  #mac(envelope: ActionEnvelope, signer: SignerRecord): string {
    const key = this.#keys.resolve(signer.keyHandle);
    if (key === undefined || key.length === 0) {
      throw new MissingKeyMaterialError(signer.keyHandle);
    }
    const mac = createHmac('sha256', key)
      // Domain separation: the algorithm and signer id are inside the MAC, so a
      // signature cannot be lifted onto a differently-configured signer that
      // happens to share key material.
      .update(Buffer.from(`${signer.algorithm} ${signer.signerId} `, 'utf8'))
      .update(canonicalEnvelopeBytes(envelope))
      .digest('hex');
    return `${signer.algorithm}:${mac}`;
  }
}

/**
 * A key resolver backed by a plain map of handle -> material.
 *
 * The material is copied on construction and the map is never exposed, so the
 * only way out of this object is through {@link resolve}, which returns a copy.
 * That is not a serious defence against code running in the same process — it is
 * the mechanical version of "there is no property here for a logger to walk".
 */
export class InMemoryKeyResolver implements SigningKeyResolver {
  readonly #keys: Map<string, Uint8Array>;

  constructor(entries: ReadonlyArray<readonly [handle: string, key: Uint8Array]>) {
    this.#keys = new Map();
    for (const [handle, key] of entries) {
      if (!handle.startsWith('handle:')) {
        throw new TypeError(
          `Key handle ${JSON.stringify(handle)} must be opaque and start with "handle:" (FRANK-§2.3).`,
        );
      }
      if (key.length < 32) {
        throw new TypeError(
          `Key material for ${JSON.stringify(handle)} is ${key.length} bytes; HMAC-SHA256 signing keys must be at least 32 bytes.`,
        );
      }
      this.#keys.set(handle, Uint8Array.from(key));
    }
  }

  resolve(keyHandle: string): Uint8Array | undefined {
    const key = this.#keys.get(keyHandle);
    return key === undefined ? undefined : Uint8Array.from(key);
  }

  /** Never returns key material. Exists so a health check can report coverage. */
  handles(): readonly string[] {
    return [...this.#keys.keys()];
  }

  /** FRANK-§2.3: this object must be unprintable, not merely undocumented. */
  toJSON(): { readonly handles: readonly string[] } {
    return { handles: this.handles() };
  }
}
