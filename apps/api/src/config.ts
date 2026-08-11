/**
 * Configuration — FRANK-§15.3, FRANK-§16.4, FRANK-§17.3.
 *
 * Validated with Zod at the process boundary for the same reason request bodies
 * are: the environment is untrusted input. A missing signing key that surfaces
 * as `undefined` deep inside an HMAC is a much worse failure than a startup
 * refusal naming the variable.
 *
 * ## Secrets arrive as material and are immediately handled
 *
 * FRANK-§15.3: "Agents receive opaque credential handles." The API is not an
 * agent — it is the thing that holds the key — but the same discipline applies
 * inside the process: {@link resolveConfig} returns `Uint8Array` key material
 * that the composition root hands straight to `InMemoryKeyResolver` and
 * `LocalSignedSessionProvider`, both of which put it behind a private field with
 * a `toJSON` that cannot reach it.
 *
 * {@link AppConfig} therefore has a `toJSON` too, and the *loaded* config object
 * is never logged as a whole. FRANK-§2.3: a `secret`-class value must never
 * reach a log.
 *
 * ## Development defaults exist and announce themselves
 *
 * Generating a random key when `FRANK_SESSION_SIGNING_KEY` is unset is
 * convenient and dangerous: convenient because tests and a local run need no
 * setup, dangerous because a production deployment that forgot the variable
 * would silently accept nobody's tokens after a restart. So the generated key is
 * only permitted when `FRANK_ENV` is `development` or `test`, and it is
 * announced on stderr. Any other environment refuses to start.
 */

import { randomBytes } from 'node:crypto';

import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'staging', 'production', 'recovery', 'preview']);
const ianaTimeZoneSchema = z.string().min(1).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  'must be an IANA time zone supported by this runtime',
);

export type FrankEnvironment = z.infer<typeof environmentSchema>;

const rawSchema = z.object({
  FRANK_ENV: environmentSchema.default('development'),
  /** FRANK-§2.4: one cell per deployment. */
  FRANK_CELL_ID: z.string().min(1).default('cell-steven'),
  /** The cell's civil-day boundary for human-facing daily read models. */
  FRANK_CELL_TIMEZONE: ianaTimeZoneSchema.default('Australia/Perth'),
  FRANK_API_HOST: z.string().min(1).default('127.0.0.1'),
  FRANK_API_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  FRANK_API_AUDIENCE: z.string().min(1).default('frank.api'),
  FRANK_PUBLIC_URL: z.string().min(1).default('http://127.0.0.1:8080'),
  /** libpq connection string. Never a superuser credential (FRANK-§11.4). */
  FRANK_DATABASE_URL: z.string().min(1).optional(),
  /** Hex or base64. At least 32 bytes decoded. */
  FRANK_SESSION_SIGNING_KEY: z.string().optional(),
  FRANK_ENVELOPE_SIGNING_KEY: z.string().optional(),
  FRANK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** FRANK-§15.6: the edge sets the real limit; this is the last line. */
  FRANK_MAX_BODY_BYTES: z.coerce.number().int().min(1_024).max(8_388_608).default(1_048_576),
});

export interface AppConfig {
  readonly environment: FrankEnvironment;
  readonly cellId: string;
  readonly cellTimeZone: string;
  readonly host: string;
  readonly port: number;
  readonly audience: string;
  readonly publicUrl: string;
  readonly databaseUrl: string | undefined;
  readonly logLevel: z.infer<typeof rawSchema>['FRANK_LOG_LEVEL'];
  readonly maxBodyBytes: number;
  /** Secret. Never logged, never serialized — see `toJSON`. */
  readonly sessionSigningKey: Uint8Array;
  readonly envelopeSigningKey: Uint8Array;
  toJSON(): Record<string, unknown>;
}

function decodeKey(name: string, value: string): Uint8Array {
  const buffer = /^[0-9a-fA-F]+$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (buffer.length < 32) {
    throw new Error(
      `${name} decodes to ${String(buffer.length)} bytes; at least 32 are required for HMAC-SHA256 (FRANK-§15.3).`,
    );
  }
  return Uint8Array.from(buffer);
}

function ephemeralKey(name: string, environment: FrankEnvironment): Uint8Array {
  if (environment !== 'development' && environment !== 'test') {
    throw new Error(
      `${name} is not set and FRANK_ENV is "${environment}". ` +
        'A generated key would be discarded on restart, silently invalidating every session. ' +
        'Provide the key from OpenBao (FRANK-§15.3).',
    );
  }
  if (environment === 'development') {
    process.stderr.write(
      `[frank-api] ${name} is unset; generated an ephemeral key for this process. ` +
        'Sessions will not survive a restart. This is permitted only in development and test.\n',
    );
  }
  return Uint8Array.from(randomBytes(32));
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // `DATABASE_URL` was used by the first VPS compose. Keep the migration
  // bridge at the configuration boundary so start.ts and main.ts cannot
  // disagree about whether persistence is configured.
  const parsed = rawSchema.safeParse({
    ...env,
    FRANK_DATABASE_URL: env.FRANK_DATABASE_URL ?? env.DATABASE_URL,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  const raw = parsed.data;

  const sessionSigningKey =
    raw.FRANK_SESSION_SIGNING_KEY === undefined
      ? ephemeralKey('FRANK_SESSION_SIGNING_KEY', raw.FRANK_ENV)
      : decodeKey('FRANK_SESSION_SIGNING_KEY', raw.FRANK_SESSION_SIGNING_KEY);

  const envelopeSigningKey =
    raw.FRANK_ENVELOPE_SIGNING_KEY === undefined
      ? ephemeralKey('FRANK_ENVELOPE_SIGNING_KEY', raw.FRANK_ENV)
      : decodeKey('FRANK_ENVELOPE_SIGNING_KEY', raw.FRANK_ENVELOPE_SIGNING_KEY);

  return {
    environment: raw.FRANK_ENV,
    cellId: raw.FRANK_CELL_ID,
    cellTimeZone: raw.FRANK_CELL_TIMEZONE,
    host: raw.FRANK_API_HOST,
    port: raw.FRANK_API_PORT,
    audience: raw.FRANK_API_AUDIENCE,
    publicUrl: raw.FRANK_PUBLIC_URL,
    databaseUrl: raw.FRANK_DATABASE_URL,
    logLevel: raw.FRANK_LOG_LEVEL,
    maxBodyBytes: raw.FRANK_MAX_BODY_BYTES,
    sessionSigningKey,
    envelopeSigningKey,
    /**
     * FRANK-§2.3. The two key fields are absent from the serialized form, and
     * the database URL is reduced to its host — a connection string carries a
     * password.
     */
    toJSON(): Record<string, unknown> {
      return {
        environment: raw.FRANK_ENV,
        cellId: raw.FRANK_CELL_ID,
        cellTimeZone: raw.FRANK_CELL_TIMEZONE,
        host: raw.FRANK_API_HOST,
        port: raw.FRANK_API_PORT,
        audience: raw.FRANK_API_AUDIENCE,
        publicUrl: raw.FRANK_PUBLIC_URL,
        databaseConfigured: raw.FRANK_DATABASE_URL !== undefined,
        logLevel: raw.FRANK_LOG_LEVEL,
        maxBodyBytes: raw.FRANK_MAX_BODY_BYTES,
      };
    },
  };
}
