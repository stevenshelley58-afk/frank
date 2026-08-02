/**
 * Google auth for Frank. Supports two modes, picked automatically:
 *
 *  1. OAuth refresh token — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
 *     GOOGLE_REFRESH_TOKEN. The normal path for a single Frank operator.
 *  2. Service account — GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
 *     (+ optional GOOGLE_SERVICE_ACCOUNT_SUBJECT to impersonate a user,
 *     required for Calendar/Gmail/Tasks domain-wide delegation).
 *
 * Tokens are refreshed transparently by google-auth-library; we hand a live
 * OAuth2Client / auth client to each API surface. Nothing here is a class the
 * caller has to manage — getAuthClient() is the whole contract.
 */
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { GoogleConnectorError } from "./types.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

const SCOPES = [CALENDAR_SCOPE, GMAIL_SCOPE, TASKS_SCOPE] as const;

export interface GoogleConnectorConfig {
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly serviceAccountEmail?: string | undefined;
  readonly serviceAccountPrivateKey?: string | undefined;
  /** User email to impersonate in service-account mode. */
  readonly serviceAccountSubject?: string | undefined;
}

function readEnvConfig(): GoogleConnectorConfig {
  const env = process.env;
  return {
    clientId: nonEmpty(env.GOOGLE_CLIENT_ID),
    clientSecret: nonEmpty(env.GOOGLE_CLIENT_SECRET),
    refreshToken: nonEmpty(env.GOOGLE_REFRESH_TOKEN),
    serviceAccountEmail: nonEmpty(env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    serviceAccountPrivateKey: nonEmpty(env.GOOGLE_PRIVATE_KEY),
    serviceAccountSubject: nonEmpty(env.GOOGLE_SERVICE_ACCOUNT_SUBJECT),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  // Support the JSON-escaped newlines people paste into .env files.
  return trimmed.length > 0 ? trimmed.replace(/\\n/g, "\n") : undefined;
}

/** Union of the two auth client shapes googleapis accepts directly. */
export type AuthClient = OAuth2Client | GoogleAuth;

let cached: Promise<AuthClient> | undefined;

/**
 * Build the auth client once and reuse it. Refresh is handled internally by
 * google-auth-library on every request.
 */
export function getAuthClient(): Promise<AuthClient> {
  if (!cached) {
    cached = buildAuthClient().catch((error) => {
      cached = undefined; // don't cache a failure; let the next call retry
      throw error;
    });
  }
  return cached;
}

async function buildAuthClient(): Promise<AuthClient> {
  const config = readEnvConfig();

  const hasOAuth =
    config.clientId !== undefined &&
    config.clientSecret !== undefined &&
    config.refreshToken !== undefined;

  if (hasOAuth) {
    const client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    client.setCredentials({ refresh_token: config.refreshToken });
    return client;
  }

  const hasServiceAccount =
    config.serviceAccountEmail !== undefined &&
    config.serviceAccountPrivateKey !== undefined;

  if (hasServiceAccount) {
    const auth = new GoogleAuth({
      scopes: [...SCOPES],
      credentials: {
        client_email: config.serviceAccountEmail,
        private_key: config.serviceAccountPrivateKey,
      },
      ...(config.serviceAccountSubject !== undefined
        ? { clientOptions: { subject: config.serviceAccountSubject } }
        : {}),
    });
    return auth;
  }

  throw new GoogleConnectorError({
    code: "config",
    surface: "auth",
    message:
      "Google connectors are not configured. Set GOOGLE_CLIENT_ID, " +
      "GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (OAuth), or " +
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY (service account).",
  });
}

/** Test/ops escape hatch: drop the cached client so the next call re-reads env. */
export function resetAuthCache(): void {
  cached = undefined;
}
