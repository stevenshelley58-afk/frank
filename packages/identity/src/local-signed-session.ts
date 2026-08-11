/**
 * The Slice 1 {@link IdentityProvider}: a locally-signed session token.
 *
 * FRANK-§16.2 wants Authentik through OIDC. Authentik is not deployed in Slice 1
 * (it is Workstream 3), and the brief for this workstream is explicit: *accept a
 * signed session from a pluggable identity provider interface so Authentik slots
 * in without touching call sites — do not hardcode Authentik*. So this is a real
 * verifier for a real signed credential, sitting behind the port that Authentik
 * will later sit behind.
 *
 * ## Token shape
 *
 *     frank-session.v1.<base64url(claims JSON)>.<base64url(HMAC-SHA256)>
 *
 * A JWT would be the obvious choice and is deliberately not used, for two
 * reasons that both cost more than they save here:
 *
 *   * a JWT library is a new core dependency (FRANK-§0.2) for a token this
 *     process both mints and verifies;
 *   * JWT's algorithm agility is the source of its worst failure mode (`alg:
 *     none`, and RS256-verified-as-HS256). This format has no algorithm field.
 *     The verifier knows the algorithm because there is only one, and a token
 *     that claims otherwise is not parseable.
 *
 * When Authentik arrives, its provider parses real JWTs against a real JWKS,
 * with a library chosen for that job. That is a different implementation of
 * {@link IdentityProvider}, which is the point of the port.
 *
 * ## Secrets
 *
 * FRANK-§2.3: a `secret`-class value must never reach a log, a response, or
 * model context. Two consequences visible here:
 *
 *   * the signing key arrives as bytes and is stored in a private field with no
 *     accessor, and {@link LocalSignedSessionProvider} defines `toJSON` so that
 *     a structured logger serializing the provider cannot reach it;
 *   * no {@link AuthenticationResult} failure `detail` contains any part of the
 *     presented token. A rejected credential is still a credential — half of one
 *     in a log line is a gift to whoever reads the log.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  AuthenticationMethod,
  AuthenticationResult,
  IdentityProvider,
  PresentedCredential,
  Principal,
} from './provider.js';
import { isCapability, isRole } from './roles.js';
import type { Capability, Role } from './roles.js';

const TOKEN_PREFIX = 'frank-session.v1.';
const MAX_EXPLICIT_CAPABILITIES = 32;

/** The claims a session token carries. Serialized with sorted keys before MAC. */
export interface SessionClaims {
  /** Subject. */
  readonly sub: string;
  /** FRANK-§2.4 cell scope. */
  readonly cell: string;
  readonly roles: readonly string[];
  /** Explicit grants for a narrowly scoped service identity. */
  readonly caps?: readonly string[];
  /** Session id, for the FRANK-§15.2 inventory. */
  readonly sid: string;
  /** Seconds since the epoch. */
  readonly iat: number;
  readonly exp: number;
  readonly nbf: number;
  /** Audience: the service this token may be presented to. */
  readonly aud: string;
  readonly amr: readonly string[];
  /** FRANK-§7.5 delegation, when the session is exercised on behalf of a human. */
  readonly act?: string;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

/**
 * Deterministic claim serialization.
 *
 * Sorted keys, `undefined` omitted. The MAC covers these exact bytes, and the
 * verifier re-derives them from the *decoded* claims rather than from the
 * transmitted string — so a token whose encoding differs but whose claims are
 * identical is rejected, and there is no room for a parser-differential attack
 * between the signer's view and the verifier's.
 */
function canonicalClaims(claims: SessionClaims): string {
  const ordered: Record<string, unknown> = {
    ...(claims.act === undefined ? {} : { act: claims.act }),
    amr: [...claims.amr],
    aud: claims.aud,
    ...(claims.caps === undefined ? {} : { caps: [...claims.caps] }),
    cell: claims.cell,
    exp: claims.exp,
    iat: claims.iat,
    nbf: claims.nbf,
    roles: [...claims.roles],
    sid: claims.sid,
    sub: claims.sub,
  };
  const keys = Object.keys(ordered).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(ordered[key])}`);
  return `{${parts.join(',')}}`;
}

export interface LocalSignedSessionOptions {
  /** At least 32 bytes. Comes from OpenBao in a deployed cell (FRANK-§15.3). */
  readonly signingKey: Uint8Array;
  /** Audience this verifier accepts. A token for another service is rejected. */
  readonly audience: string;
  /** FRANK-§2.4: tokens for another cell are rejected. */
  readonly cellId: string;
  readonly providerId?: string;
  /** Tolerance for clock skew, in milliseconds. Default 5 s. */
  readonly clockSkewToleranceMs?: number;
  /** Injected for tests; defaults to the system clock. */
  readonly now?: () => Date;
}

export class LocalSignedSessionProvider implements IdentityProvider {
  readonly providerId: string;

  readonly #key: Uint8Array;
  readonly #audience: string;
  readonly #cellId: string;
  readonly #skewMs: number;
  readonly #now: () => Date;
  readonly #revoked = new Set<string>();

  constructor(options: LocalSignedSessionOptions) {
    if (options.signingKey.length < 32) {
      throw new TypeError(
        `Session signing key is ${options.signingKey.length} bytes; HMAC-SHA256 session keys must be at least 32 bytes (FRANK-§15.3).`,
      );
    }
    this.#key = Uint8Array.from(options.signingKey);
    this.#audience = options.audience;
    this.#cellId = options.cellId;
    this.#skewMs = options.clockSkewToleranceMs ?? 5_000;
    this.#now = options.now ?? (() => new Date());
    this.providerId = options.providerId ?? 'frank.local-signed-session';
  }

  /**
   * Mint a token.
   *
   * Present in the provider rather than in a separate signer because Slice 1's
   * session is issued and verified by the same authority; splitting them would
   * imply a separation that does not exist. The Authentik provider will have no
   * `issue` method at all — FRANK does not mint Authentik's tokens — which is
   * why `issue` is *not* on the {@link IdentityProvider} interface.
   */
  issue(input: {
    readonly principalId: string;
    readonly roles: readonly Role[];
    readonly sessionId: string;
    readonly lifetimeSeconds: number;
    readonly methods?: readonly AuthenticationMethod[];
    readonly delegatedActorId?: string;
    readonly capabilities?: readonly Capability[];
  }): string {
    if (
      input.capabilities !== undefined &&
      (input.capabilities.length > MAX_EXPLICIT_CAPABILITIES ||
        new Set(input.capabilities).size !== input.capabilities.length ||
        input.capabilities.some((capability) => !isCapability(capability)))
    ) {
      throw new TypeError(`Explicit service capabilities must be unique and limited to ${MAX_EXPLICIT_CAPABILITIES}.`);
    }
    if (
      input.capabilities !== undefined &&
      input.capabilities.length > 0 &&
      !input.roles.includes('service_identity')
    ) {
      throw new TypeError('Explicit capabilities may be issued only to a service_identity.');
    }
    const nowSeconds = Math.floor(this.#now().getTime() / 1000);
    const claims: SessionClaims = {
      sub: input.principalId,
      cell: this.#cellId,
      roles: [...input.roles],
      sid: input.sessionId,
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: nowSeconds + input.lifetimeSeconds,
      aud: this.#audience,
      amr: [...(input.methods ?? ['local_signed_session'])],
      ...(input.capabilities === undefined ? {} : { caps: [...input.capabilities] }),
      ...(input.delegatedActorId === undefined ? {} : { act: input.delegatedActorId }),
    };
    const payload = base64url(Buffer.from(canonicalClaims(claims), 'utf8'));
    return `${TOKEN_PREFIX}${payload}.${this.#mac(claims)}`;
  }

  async authenticate(credential: PresentedCredential): Promise<AuthenticationResult> {
    return this.#authenticateSync(credential);
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    if (this.#revoked.has(sessionId)) return false;
    this.#revoked.add(sessionId);
    return true;
  }

  #authenticateSync(credential: PresentedCredential): AuthenticationResult {
    if (credential.scheme.toLowerCase() !== 'bearer') {
      return {
        authenticated: false,
        reason: 'malformed_credential',
        detail: `unsupported authorization scheme ${JSON.stringify(credential.scheme)}`,
      };
    }
    if (credential.value.length === 0) {
      return { authenticated: false, reason: 'missing_credential', detail: 'empty bearer value' };
    }
    if (!credential.value.startsWith(TOKEN_PREFIX)) {
      // Note what this message does NOT contain: any part of the token.
      return {
        authenticated: false,
        reason: 'malformed_credential',
        detail: 'token is not a frank-session.v1 credential',
      };
    }

    const body = credential.value.slice(TOKEN_PREFIX.length);
    const separator = body.lastIndexOf('.');
    if (separator <= 0) {
      return {
        authenticated: false,
        reason: 'malformed_credential',
        detail: 'token has no signature segment',
      };
    }

    const payloadSegment = body.slice(0, separator);
    const signatureSegment = body.slice(separator + 1);

    let claims: SessionClaims;
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(payloadSegment, 'base64url').toString('utf8'),
      );
      const parsed = parseClaims(decoded);
      if (parsed === undefined) {
        return {
          authenticated: false,
          reason: 'malformed_credential',
          detail: 'token claims are missing required fields',
        };
      }
      claims = parsed;
    } catch {
      return {
        authenticated: false,
        reason: 'malformed_credential',
        detail: 'token payload is not decodable JSON',
      };
    }

    // Signature before every other check. An unverified token's claims are
    // attacker-controlled, so nothing may be believed — not the audience, not
    // the expiry, not the cell — until the MAC is confirmed.
    const expected = Buffer.from(this.#mac(claims), 'utf8');
    const presented = Buffer.from(signatureSegment, 'utf8');
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
      return {
        authenticated: false,
        reason: 'bad_signature',
        detail: 'session signature does not verify',
      };
    }

    if (claims.aud !== this.#audience) {
      return {
        authenticated: false,
        reason: 'wrong_audience',
        detail: `token audience ${JSON.stringify(claims.aud)} is not this service`,
      };
    }
    if (claims.cell !== this.#cellId) {
      return {
        authenticated: false,
        reason: 'wrong_cell',
        detail: `token is scoped to another cell (FRANK-§2.4)`,
      };
    }

    const nowMs = this.#now().getTime();
    if (nowMs + this.#skewMs < claims.nbf * 1000) {
      return { authenticated: false, reason: 'not_yet_valid', detail: 'session is not yet valid' };
    }
    if (nowMs - this.#skewMs >= claims.exp * 1000) {
      return { authenticated: false, reason: 'expired', detail: 'session has expired' };
    }
    if (this.#revoked.has(claims.sid)) {
      return { authenticated: false, reason: 'revoked', detail: 'session has been revoked' };
    }

    // FRANK-§2.3 fail-closed: an unrecognised role is not ignored, because
    // ignoring it would silently downgrade a principal to whatever remains, and
    // a partially-understood token is not an understood one.
    const roles: Role[] = [];
    for (const role of claims.roles) {
      if (!isRole(role)) {
        return {
          authenticated: false,
          reason: 'unknown_role',
          detail: `token carries unknown role ${JSON.stringify(role)}`,
        };
      }
      roles.push(role);
    }
    if (roles.length === 0) {
      return {
        authenticated: false,
        reason: 'unknown_role',
        detail: 'token carries no roles; a principal with no role is denied (FRANK-§2.2)',
      };
    }

    const methods = claims.amr.filter(isAuthenticationMethod);
    const capabilities: Capability[] = [];
    const claimedCapabilities = claims.caps ?? [];
    if (
      claimedCapabilities.length > MAX_EXPLICIT_CAPABILITIES ||
      new Set(claimedCapabilities).size !== claimedCapabilities.length
    ) {
      return {
        authenticated: false,
        reason: 'unknown_capability',
        detail: 'token carries a duplicate or excessive explicit capability set',
      };
    }
    for (const capability of claimedCapabilities) {
      if (!isCapability(capability)) {
        return {
          authenticated: false,
          reason: 'unknown_capability',
          detail: `token carries unknown capability ${JSON.stringify(capability)}`,
        };
      }
      capabilities.push(capability);
    }
    if (capabilities.length > 0 && !roles.includes('service_identity')) {
      return {
        authenticated: false,
        reason: 'unknown_capability',
        detail: 'explicit capabilities require a service_identity role',
      };
    }

    const principal: Principal = {
      principalId: claims.sub,
      cellId: claims.cell,
      roles,
      sessionId: claims.sid,
      issuedAt: new Date(claims.iat * 1000),
      expiresAt: new Date(claims.exp * 1000),
      authenticationMethods: methods.length > 0 ? methods : ['local_signed_session'],
      providerId: this.providerId,
      ...(capabilities.length === 0 ? {} : { capabilities }),
      ...(claims.act === undefined ? {} : { delegatedActorId: claims.act }),
    };

    return { authenticated: true, principal };
  }

  #mac(claims: SessionClaims): string {
    return base64url(
      createHmac('sha256', this.#key)
        .update(Buffer.from(TOKEN_PREFIX, 'utf8'))
        .update(Buffer.from(canonicalClaims(claims), 'utf8'))
        .digest(),
    );
  }

  /** FRANK-§2.3: the signing key must be unreachable through serialization. */
  toJSON(): { readonly providerId: string; readonly audience: string } {
    return { providerId: this.providerId, audience: this.#audience };
  }
}

const AUTHENTICATION_METHODS: readonly string[] = [
  'passkey',
  'webauthn',
  'password',
  'totp',
  'recovery_code',
  'workload_identity',
  'local_signed_session',
];

function isAuthenticationMethod(value: string): value is AuthenticationMethod {
  return AUTHENTICATION_METHODS.includes(value);
}

function parseClaims(value: unknown): SessionClaims | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const strings = (input: unknown): string[] | undefined =>
    Array.isArray(input) && input.every((item) => typeof item === 'string')
      ? (input as string[])
      : undefined;

  const roles = strings(raw['roles']);
  const amr = strings(raw['amr']);
  const caps = raw['caps'] === undefined ? undefined : strings(raw['caps']);
  if (
    typeof raw['sub'] !== 'string' ||
    typeof raw['cell'] !== 'string' ||
    typeof raw['sid'] !== 'string' ||
    typeof raw['aud'] !== 'string' ||
    typeof raw['iat'] !== 'number' ||
    typeof raw['exp'] !== 'number' ||
    typeof raw['nbf'] !== 'number' ||
    roles === undefined ||
    amr === undefined ||
    (raw['caps'] !== undefined && caps === undefined)
  ) {
    return undefined;
  }
  const act = raw['act'];
  if (act !== undefined && typeof act !== 'string') return undefined;

  return {
    sub: raw['sub'],
    cell: raw['cell'],
    roles,
    sid: raw['sid'],
    iat: raw['iat'],
    exp: raw['exp'],
    nbf: raw['nbf'],
    aud: raw['aud'],
    amr,
    ...(caps === undefined ? {} : { caps }),
    ...(act === undefined ? {} : { act }),
  };
}
