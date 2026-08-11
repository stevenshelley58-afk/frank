/**
 * The composition root — ADR-006, FRANK-§16.2, FRANK-§17.1.
 *
 * ADR-006: "The FRANK Domain API runs on Fastify with TypeScript, OpenAPI schema
 * validation, and explicit routing."
 *
 * Everything is constructed here and injected downward. No module below this one
 * reads an environment variable, constructs a database handle, or knows which
 * identity provider is in use — which is what makes the Authentik swap
 * FRANK-§16.2 requires a change to this file alone.
 *
 * ## Logger redaction is configured before anything can log
 *
 * FRANK-§15.1 lists "secret leakage through prompts, **logs**, artifacts,
 * telemetry, or previews" as a threat, and FRANK-§15.3 says "raw secrets are
 * redacted before model, log, trace, event, or artifact boundaries". Fastify's
 * default request serializer logs headers; `authorization` is a header. The
 * `redact` configuration below removes it, and the serializers replace the
 * default request/response logging entirely so a body is never logged at all —
 * a capture body is user content and FRANK-§2.3 classifies it `private` at
 * least.
 *
 * ## The signer registry is built here, and it is where "models cannot sign"
 *  becomes configuration
 *
 * Slice 1 registers one signer per FRANK-§2.2 role kind, all `maySign: true`,
 * all backed by the same process-held key. When the agent kernel arrives it will
 * register `agent/*` and `model/*` entries, and `SignerRegistry` will refuse to
 * construct if any of them claims `maySign: true` (FRANK-§6.9).
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { LocalSignedSessionProvider } from '@frank/identity';
import type { IdentityProvider } from '@frank/identity';
import {
  HmacEnvelopeSigner,
  InMemoryKeyResolver,
  InMemorySpentNonceLedger,
  POLICY_VERSION,
  PolicyEngine,
  SignerRegistry,
} from '@frank/policy';
import type { SignerRecord, SpentNonceLedger } from '@frank/policy';

import type { AppConfig } from './config.js';
import { buildRequestContext, identifierHeaders } from './context.js';
import { buildOpenApiDocument } from './openapi.js';
import { registerDevAuthRoute } from './routes/auth.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemError,
  opaqueInternalProblem,
  toProblemDetail,
} from './problem.js';
import { assertRegistryConsistent } from './schema/registry.js';
import type { AnyRouteDefinition } from './schema/registry.js';
import { captureRoutes, registerCaptureRoutes } from './routes/capture.js';
import { healthRoutes, registerHealthRoutes } from './routes/health.js';
import { provenanceRoutes, registerProvenanceRoutes } from './routes/provenance.js';
import { registerTodayRoutes, todayRoutes } from './routes/today.js';
import { frameGetRoute, frameRoutes, registerFrameRoutes } from './routes/frame.js';
import { registerWorkRoutes, workRoutes } from './routes/work.js';
import { registerWorkbenchRoutes, workbenchAllRoutes } from './routes/workbench.js';
import {
  missionRoutes,
  registerMissionRoutes,
} from './routes/missions.js';
import type { MissionRouteOrchestrator } from './routes/missions.js';
import { channelRoutes, registerChannelRoutes } from './routes/channels.js';
import { registerWorkbenchEventsRoute } from './routes/workbench-events.js';
import { folderBindingRoutes, registerFolderBindingRoutes } from './routes/folder-binding.js';
import { RoomFolderBindingStore } from './services/workbench/folder-binding-store.js';
import { WorkbenchEventBus } from './services/workbench/event-bus.js';
import { WorkbenchCancellationService } from './services/workbench/cancellation.js';
import type { WorkbenchRunner } from './services/workbench/runner.js';
import { WorkbenchDecisionService } from './services/workbench/decision.js';
import { StagedWriteService } from './services/workbench/staged-write.js';
import { ChannelPushStore } from './services/workbench/channel-push.js';
import { brainRoutes, registerBrainRoutes } from './routes/brain.js';
import { chatRoutes, registerChatRoutes } from './routes/chats.js';
import { harnessControlRoutes, registerHarnessControlRoutes } from './routes/harness-control.js';
import { codegraphRoutes, registerCodegraphRoutes } from './routes/codegraph.js';
import type { CodegraphRouteDependencies } from './routes/codegraph.js';
import { ActionBoundary } from './services/action-boundary.js';
import { WorkbenchFrontDoor } from './services/workbench/front-door.js';
import type { PreviewDeployer } from './services/workbench/preview-backend.js';
import { PreviewBackend, SshPreviewDeployer } from './services/workbench/preview-backend.js';
import { HealthService } from './services/health.js';
import type { EnrichmentDispatcher } from './services/enrichment.js';
import { InProcessEnrichmentDispatcher, noopEnrichmentHandler } from './services/enrichment.js';
import type { DomainStore } from './services/store.js';

export const ALL_ROUTES: readonly AnyRouteDefinition[] = [
  ...captureRoutes,
  ...workRoutes,
  ...workbenchAllRoutes,
  ...missionRoutes,
  ...channelRoutes,
  ...folderBindingRoutes,
  ...provenanceRoutes,
  ...todayRoutes,
  ...frameRoutes,
  ...healthRoutes,
  ...brainRoutes,
  ...chatRoutes,
  ...harnessControlRoutes,
  ...codegraphRoutes,
];

const ENVELOPE_KEY_HANDLE = 'handle:frank.api.envelope-signing-key';

/**
 * One signer per FRANK-§2.2 role kind.
 *
 * `maximumActionClass` differs per role and is the privilege ceiling the
 * conformance suite's privilege-inheritance case exercises: a `member` session
 * cannot sign a `financial_or_public` envelope even if a future route asked it
 * to, because the ceiling is checked before any authorization is consulted.
 */
export function buildSignerRegistry(): SignerRegistry {
  const records: SignerRecord[] = [
    {
      signerId: 'frank.api/owner',
      kind: 'owner',
      maySign: true,
      maximumActionClass: 'destructive_or_privileged',
      algorithm: 'hmac-sha256',
      keyHandle: ENVELOPE_KEY_HANDLE,
    },
    {
      signerId: 'frank.api/operator',
      kind: 'operator',
      maySign: true,
      maximumActionClass: 'external_reversible',
      algorithm: 'hmac-sha256',
      keyHandle: ENVELOPE_KEY_HANDLE,
    },
    {
      signerId: 'frank.api/builder',
      kind: 'builder',
      maySign: true,
      maximumActionClass: 'internal_reversible',
      algorithm: 'hmac-sha256',
      keyHandle: ENVELOPE_KEY_HANDLE,
    },
    {
      signerId: 'frank.api/member',
      kind: 'member',
      maySign: true,
      maximumActionClass: 'internal_reversible',
      algorithm: 'hmac-sha256',
      keyHandle: ENVELOPE_KEY_HANDLE,
    },
    {
      signerId: 'frank.api/reviewer',
      kind: 'reviewer',
      maySign: true,
      maximumActionClass: 'observe',
      algorithm: 'hmac-sha256',
      keyHandle: ENVELOPE_KEY_HANDLE,
    },
    {
      signerId: 'frank.api/service',
      kind: 'service',
      maySign: true,
      maximumActionClass: 'internal_reversible',
      algorithm: 'hmac-sha256',
      keyHandle: ENVELOPE_KEY_HANDLE,
    },
  ];
  return new SignerRegistry(records);
}

export interface BuildServerOptions {
  readonly config: AppConfig;
  readonly store: DomainStore;
  /** Defaults to a real {@link LocalSignedSessionProvider} built from the config. */
  readonly identity?: IdentityProvider;
  /** Defaults to an in-process dispatcher with the Slice 1 no-op handler. */
  readonly enrichment?: EnrichmentDispatcher;
  readonly nonces?: SpentNonceLedger;
  /** Injected in tests so expiry and freshness are deterministic. */
  readonly now?: () => Date;
  readonly startedAt?: Date;
  /** Raw DB handle for brain routes (raw SQL queries, not yet in DomainStore). */
  readonly db?: import("@frank/adapter-postgres").FrankDatabase;
  /** WB-06: workbench SSE live-poll interval (tests use a fast value). */
  readonly workbenchPollIntervalMs?: number;
  /**
   * FS-05: preview-lane deployer. Defaults to the real ssh deployer
   * (`SshPreviewDeployer` → /srv/frank/infra/preview-deploy.sh); tests inject
   * a fake so no ssh ever runs in CI.
   */
  readonly previewDeployer?: PreviewDeployer;
  /** In-process runner used by Stop to reach the live sandbox immediately. */
  readonly workbenchRunner?: WorkbenchRunner;
  /** Durable objective orchestrator. Production composition injects and starts it. */
  readonly missionOrchestrator?: MissionRouteOrchestrator;
  /** Codegraph storage/service ports; tests provide isolated fixtures. */
  readonly codegraph?: Pick<
    CodegraphRouteDependencies,
    | 'codegraphOutputDir'
    | 'codegraphRegistryFile'
    | 'codegraphServiceUrl'
    | 'codegraphControlTokenFile'
    | 'codegraphReadLimit'
    | 'fetch'
  >;
}

export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly identity: IdentityProvider;
  readonly enrichment: EnrichmentDispatcher;
  readonly health: HealthService;
  readonly openApiDocument: Record<string, unknown>;
}

export function buildServer(options: BuildServerOptions): BuiltServer {
  const { config, store } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now();

  // FRANK-§3.8: duplicate paths and undocumented operations fail the build.
  // Startup, not first request.
  // The Living Frame has no in-memory substitute: exposing its contract when
  // no database-backed sources were registered would advertise a 404 as data.
  const activeRoutes =
    options.db === undefined ? ALL_ROUTES.filter((route) => route !== frameGetRoute) : ALL_ROUTES;
  assertRegistryConsistent(activeRoutes);

  const identity =
    options.identity ??
    new LocalSignedSessionProvider({
      signingKey: config.sessionSigningKey,
      audience: config.audience,
      cellId: config.cellId,
      now,
    });

  const enrichment =
    options.enrichment ??
    new InProcessEnrichmentDispatcher({ handler: noopEnrichmentHandler() });

  const signers = buildSignerRegistry();
  const signer = new HmacEnvelopeSigner(
    new InMemoryKeyResolver([[ENVELOPE_KEY_HANDLE, config.envelopeSigningKey]]),
  );
  const engine = new PolicyEngine({
    signers,
    verifier: signer,
    nonces: options.nonces ?? new InMemorySpentNonceLedger(),
  });
  const actions = new ActionBoundary({ engine, signers, signer, cellId: config.cellId });

  const health = new HealthService({
    store,
    enrichment,
    cellId: config.cellId,
    startedAt,
    identityProviderId: identity.providerId,
    policyVersion: POLICY_VERSION,
  });

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // FRANK-§15.3: raw secrets are redacted before the log boundary.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["idempotency-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        // Replaces Fastify's defaults entirely. Note what is absent: the body,
        // the query string, and every header but the two named. A capture body
        // is `private` at minimum (FRANK-§2.3) and a query string can carry an
        // identifier the URL was supposed to keep opaque (FRANK-§3.8).
        req(request: {
          method: string;
          url: string;
          headers: Record<string, unknown>;
        }) {
          return {
            method: request.method,
            // Path only; the query string is dropped.
            path: String(request.url).split('?', 1)[0],
            correlation_id: request.headers['x-correlation-id'] ?? null,
          };
        },
        res(reply: { statusCode: number }) {
          return { statusCode: reply.statusCode };
        },
      },
    },
    // FRANK-§12.1: identifiers are ours. A client-supplied request id would let
    // two different requests share a log identity.
    genReqId: () => crypto.randomUUID(),
    bodyLimit: config.maxBodyBytes,
    // FRANK-§15.6: the reverse proxy is the only publicly reachable service, so
    // it is the only thing whose forwarding headers we would ever trust — and we
    // do not need them, so they are off.
    trustProxy: false,
  });

  /* ---------------------------------------------------- error handling --- */

  app.setErrorHandler((error, request, reply) => {
    const context =
      request.frankContext ??
      buildRequestContext({
        cellId: config.cellId,
        policyVersion: POLICY_VERSION,
        inboundCorrelationId: undefined,
        now: now(),
      });

    const identifiers = {
      cellId: context.cellId,
      requestId: context.requestId,
      correlationId: context.correlationId,
    };

    for (const [name, value] of Object.entries(identifierHeaders(context))) {
      void reply.header(name, value);
    }
    void reply.type(PROBLEM_CONTENT_TYPE);

    if (error instanceof ProblemError) {
      const problem = toProblemDetail(error, identifiers);
      // A refusal is logged at `warn`, not `error`: a denied action is the system
      // working. Logging it as an error trains operators to ignore errors.
      request.log.warn(
        { problem_type: problem.type, correlation_id: context.correlationId },
        'request refused',
      );
      void reply.code(problem.status);
      return problem;
    }

    // Fastify's own errors (payload too large, malformed JSON) carry a status.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const problem = toProblemDetail(
        new ProblemError('validation_failed', 'The request could not be parsed.'),
        identifiers,
      );
      void reply.code(statusCode);
      return { ...problem, status: statusCode };
    }

    // Anything else. The real error goes to the log; the client gets a
    // correlation id and nothing else (FRANK-§15.1).
    request.log.error(
      { err: error, correlation_id: context.correlationId },
      'unhandled error in request',
    );
    void reply.code(500);
    return opaqueInternalProblem(identifiers);
  });

  app.setNotFoundHandler((request, reply) => {
    const context =
      request.frankContext ??
      buildRequestContext({
        cellId: config.cellId,
        policyVersion: POLICY_VERSION,
        inboundCorrelationId: undefined,
        now: now(),
      });
    void reply.type(PROBLEM_CONTENT_TYPE);
    void reply.code(404);
    return toProblemDetail(
      new ProblemError(
        'not_found',
        'No such operation. The API surface is described at /v1/openapi.json (ADR-017).',
      ),
      {
        cellId: context.cellId,
        requestId: context.requestId,
        correlationId: context.correlationId,
      },
    );
  });

  /* ------------------------------------------------------------- routes --- */

  const shared = {
    cellId: config.cellId,
    cellTimeZone: config.cellTimeZone,
    policyVersion: POLICY_VERSION,
    identity,
    now,
  };

  // HITL-01/02: the decision seam needs a DB handle. Created once here (before
  // the work routes, which call back into it on ready/cancel) and reused by
  // the workbench routes registered below.
  const workbenchDecisions =
    options.db === undefined ? null : new WorkbenchDecisionService(options.db);
  // FS-03: staged shared writes. Created alongside the decision seam because
  // the resolution hook (below) lands an approved staged write when the
  // decision item it filed resolves `ready`.
  const stagedWrites =
    workbenchDecisions === null || options.db === undefined
      ? null
      : new StagedWriteService(options.db, workbenchDecisions);

  registerCaptureRoutes(app, { ...shared, store, enrichment, actions });
  registerWorkRoutes(app, {
    ...shared,
    store,
    actions,
    // HITL-02: a ready/cancel command on a workbench decision resumes or
    // safe-fails the linked run. A paused run that never resumes is a silent
    // stall, so a resolution failure propagates to the caller.
    ...(workbenchDecisions === null
      ? {}
      : {
          onDecisionResolution: async (
            cellId: string,
            workItemId: string,
            resolution: 'ready' | 'cancel',
            actor: { kind: 'user' | 'agent' | 'service'; id: string },
            correlationId: string,
            now: Date,
          ): Promise<void> => {
            await workbenchDecisions.resolveDecision({
              cellId,
              decisionWorkItemId: workItemId,
              resolution,
              actor,
              correlationId,
              now,
            });
            // FS-03: if this decision approved a staged shared write, the
            // controlled copy lands here (outside the harness), fully
            // audited. Denied decisions copy nothing. Non-staged-write
            // decisions are a no-op on both paths. Landing runs AFTER the
            // workbench resume so a copy failure never leaves the run
            // paused-and-landed; it throws and the envelope surfaces it.
            if (stagedWrites !== null) {
              if (resolution === 'ready') {
                await stagedWrites.landStagedWrite(workItemId, {
                  cellId,
                  actor,
                  correlationId,
                  now,
                });
              } else {
                await stagedWrites.denyStagedWrite(workItemId, {
                  cellId,
                  actor,
                  correlationId,
                  now,
                });
              }
            }
          },
        }),
  });
  registerProvenanceRoutes(app, { ...shared, store });
  registerTodayRoutes(app, { ...shared, store });
  registerHealthRoutes(app, { ...shared, health, serviceName: 'frank-api' });
  if (options.db) {
    registerBrainRoutes(app, { ...shared, db: options.db });
    // The chat shell's own store — raw SQL on frank_domain (migration 0010),
    // so like brain it needs a DB handle.
    registerChatRoutes(app, { ...shared, db: options.db });
    registerHarnessControlRoutes(app, { ...shared, db: options.db });
    registerFrameRoutes(app, { ...shared, store, db: options.db });
    // Workbench routes need Postgres (the front door + store are raw-SQL on
    // frank_domain); like brain, they only register when a DB handle exists.
    // ONE event bus is shared by the store (writer notifications) and the SSE
    // route (live delivery) — WB-06.
    const workbenchBus = new WorkbenchEventBus();
    const workbenchFrontDoor = new WorkbenchFrontDoor(options.db, workbenchBus);
    const workbenchCancellation = new WorkbenchCancellationService(
      options.db,
      options.workbenchRunner,
    );
    // CH-06: canonical room↔channel bindings + outbox access for the listener.
    const channelPush = new ChannelPushStore(options.db);
    registerChannelRoutes(app, {
      ...shared,
      channelPush,
      actions,
    });
    // HITL-01/02: the decision seam (created once above, before the work
    // routes, so ready/cancel on a decision item can resume the run).
    // FS-05: preview backend — classification + preview-lane publishing. The
    // deployer is injectable: production gets the real ssh deployer; tests
    // pass a fake so CI never shells out. Shares the bus so a published
    // preview wakes SSE subscribers too.
    const previewBackend = new PreviewBackend({
      store: workbenchFrontDoor.store,
      deployer: options.previewDeployer ?? new SshPreviewDeployer(),
    });
    registerWorkbenchRoutes(app, {
      ...shared,
      frontDoor: workbenchFrontDoor,
      actions,
      cancellation: workbenchCancellation,
      decisions: workbenchDecisions as WorkbenchDecisionService,
      preview: previewBackend,
      stagedWrites: stagedWrites as StagedWriteService,
      folderBindings: new RoomFolderBindingStore(options.db),
    });
    // FS-02: room folder bindings — declarations are Postgres rows (migration
    // 0006), so the routes register alongside the workbench routes, only when
    // a DB handle exists. Mount enforcement is FS-03, not here.
    registerFolderBindingRoutes(app, {
      ...shared,
      bindings: new RoomFolderBindingStore(options.db),
      actions,
    });
    registerWorkbenchEventsRoute(app, {
      ...shared,
      frontDoor: workbenchFrontDoor,
      bus: workbenchBus,
      ...(options.workbenchPollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: options.workbenchPollIntervalMs }),
    });
  }

  if (options.missionOrchestrator !== undefined) {
    registerMissionRoutes(app, {
      ...shared,
      orchestrator: options.missionOrchestrator,
      actions,
    });
  }

  // Code intelligence graph — reads from the codegraph service output volume.
  registerCodegraphRoutes(app, { ...shared, ...(options.codegraph ?? {}) });

  const openApiDocument = buildOpenApiDocument(activeRoutes, {
    title: 'FRANK Domain API',
    version: '1.0.0-slice1',
    description:
      'The FRANK Domain API (ADR-006). Versioned REST/JSON with OpenAPI 3.1 as the client contract (ADR-017, FRANK-§12.1). ' +
      'This document is generated from the server route registry, so an operation cannot exist without appearing here.',
    serverUrl: config.publicUrl,
  });

  // Served rather than only built, so a client can fetch the contract from the
  // instance it is talking to. Registered directly rather than through
  // `registerRoute`: the document is public by design and describing it inside
  // itself is a loop nobody benefits from.
  app.get('/v1/openapi.json', async (_request, reply) => {
    void reply.type('application/json');
    return openApiDocument;
  });

  // Development-only session mint — registered directly (see routes/auth.ts):
  // it cannot sit behind the capability gate it exists to bootstrap, and it must
  // never appear in the generated OpenAPI contract. Refuses to mint outside dev/test.
  registerDevAuthRoute(app, { config, now });

  /* -------------------------------------------------- self-build --- */

  if (config.environment === 'development') {
    let rebuildInProgress = false;
    app.post('/v1/system/rebuild', async (_request, reply) => {
    if (rebuildInProgress) {
      void reply.code(409);
      return { rebuilding: false, error: 'A rebuild is already in progress.' };
    }
    rebuildInProgress = true;
    try {
      const { exec } = await import('node:child_process');
      exec('bash /scripts/rebuild.sh', { timeout: 300_000 }, (error) => {
        rebuildInProgress = false;
        if (error) {
          app.log.error({ err: error }, 'rebuild failed');
        } else {
          app.log.info('rebuild completed successfully');
        }
      });
      return { rebuilding: true, message: 'Frank rebuild triggered. Check /v1/system/rebuild/status for progress.' };
    } catch (error) {
      rebuildInProgress = false;
      void reply.code(500);
      return { rebuilding: false, error: 'Failed to start rebuild.' };
    }
    });

    app.get('/v1/system/rebuild/status', async () => {
    const { readFileSync } = await import('node:fs');
    try {
      const log = readFileSync('/tmp/frank-rebuild.log', 'utf-8');
      return { rebuilding: rebuildInProgress, log: log.split('\n').slice(-30).join('\n') };
    } catch {
      return { rebuilding: rebuildInProgress, log: 'No rebuild log found.' };
    }
    });
  }

  return { app, identity, enrichment, health, openApiDocument };
}
