/**
 * Mint the server-to-server credential used by the web BFF.
 *
 * The signing key is read from the process environment and the credential is
 * written only to stdout so the release script can redirect it straight into
 * a root-owned secret file. Never invoke this without redirecting stdout.
 */

// This operator script lives outside a workspace package, so a package-name
// import would resolve against the root's intentionally minimal dependencies.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { LocalSignedSessionProvider } from '../../packages/identity/src/index.js';

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function decodeKey(value: string): Uint8Array {
  const bytes = /^[0-9a-fA-F]+$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (bytes.length < 32) throw new Error('FRANK_SESSION_SIGNING_KEY must decode to 32+ bytes');
  return Uint8Array.from(bytes);
}

/**
 * Build the exact credential written to FRANK_DOMAIN_SERVICE_TOKEN.
 *
 * `service_identity` deliberately has no ambient codegraph access. The BFF
 * receives only these reviewed signed capability claims, so adding a future
 * API capability requires an explicit token-remint change here.
 */
export function mintServiceToken(
  environment: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): string {
  const lifetimeSeconds = Number(environment.FRANK_SERVICE_TOKEN_LIFETIME_SECONDS ?? '31536000');
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 300 || lifetimeSeconds > 31_536_000) {
    throw new Error('FRANK_SERVICE_TOKEN_LIFETIME_SECONDS must be 300..31536000');
  }

  const provider = new LocalSignedSessionProvider({
    signingKey: decodeKey(required(environment, 'FRANK_SESSION_SIGNING_KEY')),
    audience: environment.FRANK_API_AUDIENCE ?? 'frank.api',
    cellId: required(environment, 'FRANK_CELL_ID'),
    now: () => now,
  });

  return provider.issue({
    principalId: 'service/frank-web-bff',
    roles: ['service_identity'],
    capabilities: ['codegraph.read', 'codegraph.refresh'],
    sessionId: `web-bff-${now.toISOString().slice(0, 10)}`,
    lifetimeSeconds,
    methods: ['workload_identity'],
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))) {
  process.stdout.write(mintServiceToken());
}
