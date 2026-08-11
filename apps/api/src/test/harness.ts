/**
 * Test harness — one place that builds a server, so a test differs from the
 * baseline only in what it is actually testing.
 *
 * `app.inject()` rather than a real socket: Fastify's inject runs the complete
 * request lifecycle — routing, hooks, the error handler, serialization — in
 * process. For the UX-004 measurement that is the right boundary to measure at,
 * because "at the API boundary" means from the moment the server has the request
 * to the moment it has the response, not including the network the requirement
 * cannot control.
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { LocalSignedSessionProvider } from '@frank/identity';
import type { Role } from '@frank/identity';

import type { AppConfig } from '../config.js';
import { buildServer } from '../server.js';
import type { BuiltServer } from '../server.js';
import type { EnrichmentDispatcher } from '../services/enrichment.js';
import type { DomainStore } from '../services/store.js';
import type { MissionRouteOrchestrator } from '../routes/missions.js';
import { FakeDomainStore } from './fake-store.js';

export const TEST_CELL = 'cell-steven';
export const TEST_AUDIENCE = 'frank.api';
export const TEST_NOW = new Date('2026-07-28T09:00:00.000Z');

const SESSION_KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
const ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff);

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = {
    environment: 'test' as const,
    cellId: TEST_CELL,
    cellTimeZone: 'Australia/Perth',
    host: '127.0.0.1',
    port: 0,
    audience: TEST_AUDIENCE,
    publicUrl: 'http://127.0.0.1:8080',
    databaseUrl: undefined,
    logLevel: 'silent' as const,
    maxBodyBytes: 1_048_576,
    sessionSigningKey: SESSION_KEY,
    envelopeSigningKey: ENVELOPE_KEY,
  };
  return {
    ...base,
    ...overrides,
    toJSON(): Record<string, unknown> {
      return { environment: 'test', cellId: base.cellId };
    },
  };
}

export interface TestServer extends BuiltServer {
  readonly app: FastifyInstance;
  readonly store: DomainStore;
  readonly identityProvider: LocalSignedSessionProvider;
  /** A bearer token for the given roles. */
  token(roles?: readonly Role[], overrides?: { sessionId?: string; lifetimeSeconds?: number }): string;
  /** `Authorization` header value. */
  auth(roles?: readonly Role[]): string;
  close(): Promise<void>;
}

export interface BuildTestServerOptions {
  readonly store?: DomainStore;
  readonly enrichment?: EnrichmentDispatcher;
  readonly now?: () => Date;
  readonly config?: Partial<AppConfig>;
  /**
   * Raw Postgres handle; when given, DB-backed routes (brain, workbench)
   * register — mirroring `main.ts`, which passes `store.db`.
   */
  readonly db?: import('@frank/adapter-postgres').FrankDatabase;
  /** WB-06: workbench SSE live-poll interval (tests use a fast value). */
  readonly workbenchPollIntervalMs?: number;
  /** FS-05: preview-lane deployer (tests inject FakePreviewDeployer). */
  readonly previewDeployer?: import('../services/workbench/preview-backend.js').PreviewDeployer;
  /** Mission route port; tests inject a deterministic in-memory fake. */
  readonly missionOrchestrator?: MissionRouteOrchestrator;
}

export function buildTestServer(options: BuildTestServerOptions = {}): TestServer {
  const config = testConfig(options.config ?? {});
  const store = options.store ?? new FakeDomainStore();
  const now = options.now ?? (() => TEST_NOW);

  const identityProvider = new LocalSignedSessionProvider({
    signingKey: config.sessionSigningKey,
    audience: config.audience,
    cellId: config.cellId,
    now,
  });

  const built = buildServer({
    config,
    store,
    identity: identityProvider,
    ...(options.enrichment === undefined ? {} : { enrichment: options.enrichment }),
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.workbenchPollIntervalMs === undefined
      ? {}
      : { workbenchPollIntervalMs: options.workbenchPollIntervalMs }),
    ...(options.previewDeployer === undefined
      ? {}
      : { previewDeployer: options.previewDeployer }),
    ...(options.missionOrchestrator === undefined
      ? {}
      : { missionOrchestrator: options.missionOrchestrator }),
    now,
    startedAt: now(),
  });

  let sessionCounter = 0;

  return {
    ...built,
    store,
    identityProvider,
    token(roles = ['owner'], overrides = {}) {
      sessionCounter += 1;
      return identityProvider.issue({
        principalId: 'user/steven',
        roles: [...roles],
        sessionId: overrides.sessionId ?? `sess-${String(sessionCounter)}`,
        lifetimeSeconds: overrides.lifetimeSeconds ?? 3_600,
        methods: ['passkey'],
      });
    },
    auth(roles = ['owner']) {
      return `Bearer ${this.token(roles)}`;
    },
    async close() {
      await built.app.close();
      await store.close();
    },
  };
}

/** A fresh, unique idempotency key. FRANK-§12.1 requires one per action. */
export function commandId(prefix = 'cmd'): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}
