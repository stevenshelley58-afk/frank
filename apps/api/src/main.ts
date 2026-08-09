/**
 * Process entry point.
 *
 * Separate from `server.ts` so that `buildServer` can be called by a test
 * without binding a port, and so this file can own the things that only a real
 * process needs: signal handling, the listen call, and the ordered shutdown.
 *
 * ## This file cannot be started yet, and that is a repository gap, not a defect
 *
 * No package in this workspace has a `build` script. Every package is consumed
 * as TypeScript source through its `exports` map (`"." : "./src/index.ts"`), and
 * the only thing that resolves those today is Vitest. Node's
 * `--experimental-strip-types` cannot: `moduleResolution: NodeNext` requires the
 * `.js` extension on relative imports and Node does not remap `.js` to `.ts`.
 *
 * So `@frank/api` currently has no `start` script — deliberately, because a
 * script that does not run is worse than an absent one. Turbo's `build` task is
 * already declared in `turbo.json` with `outputs: ["dist/**"]`; the workspace
 * needs a package that fills it (FRANK-§17.3's toolchain, Workstream 2). Once it
 * exists, this file is the entry point, unchanged.
 *
 * FRANK-§16.2 puts Caddy in front and FRANK-§19.3 defines service objectives, so
 * shutdown order matters: stop accepting connections, let in-flight requests
 * finish, then close the pool. Closing the pool first would fail every request
 * that was already running.
 */

import { buildServer } from './server.js';
import { resolveConfig } from './config.js';
import { PostgresDomainStore } from './services/postgres-store.js';
import { CostRepository, decimal, money } from '@frank/adapter-postgres';
import { ContainerWorkbenchExecutor } from './services/workbench/container-executor.js';
import { LocalDockerCli, WorkbenchProvisioner } from './services/workbench/provisioner.js';
import { WorkbenchRunner } from './services/workbench/runner.js';
import { WorkbenchStore } from './services/workbench/store.js';
import { WorkbenchTerminalReporter } from './services/workbench/terminal-reporter.js';
import { WorkbenchCancellationService } from './services/workbench/cancellation.js';
import { MissionOrchestrator, MissionPlanner } from './services/missions/index.js';

async function main(): Promise<void> {
  const config = resolveConfig();

  if (config.databaseUrl === undefined) {
    process.stderr.write(
      'FRANK_DATABASE_URL is not set. The API serves canonical domain data (ADR-003) and cannot start without it.\n',
    );
    process.exit(2);
  }

  const store = new PostgresDomainStore({
    connectionString: config.databaseUrl,
    applicationName: 'frank-api',
  });

  const runnerEnabled = process.env.FRANK_WORKBENCH_RUNNER_ENABLED === 'true';
  let workbenchRunner: WorkbenchRunner | undefined;
  let workbenchStore: WorkbenchStore | undefined;
  let providerApiKey: string | undefined;
  if (runnerEnabled) {
    providerApiKey = process.env.FRANK_WORKBENCH_MODEL_API_KEY;
    if (providerApiKey === undefined || providerApiKey === '') {
      throw new Error(
        'FRANK_WORKBENCH_RUNNER_ENABLED=true requires FRANK_WORKBENCH_MODEL_API_KEY',
      );
    }
    const runnerId = `frank-api/${process.env.HOSTNAME ?? 'runner-1'}`;
    workbenchStore = new WorkbenchStore(store.db);
    const docker = new LocalDockerCli();
    const provisioner = new WorkbenchProvisioner({
      cli: docker,
      defaults: {
        image: process.env.FRANK_WORKBENCH_IMAGE ?? 'frank-workbench:2026-08-09.1',
        cpuQuota: 200_000,
        memoryBytes: 2 * 1024 * 1024 * 1024,
        user: '10001:10001',
      },
    });
    const executor = new ContainerWorkbenchExecutor({
      provisioner,
      docker,
      store: workbenchStore,
      executorId: runnerId,
      provider: {
        id: process.env.FRANK_WORKBENCH_MODEL_PROVIDER ?? 'custom_deepseek',
        baseUrl: process.env.FRANK_WORKBENCH_MODEL_BASE_URL ?? 'https://api.deepseek.com',
        apiKey: providerApiKey,
        model: process.env.FRANK_WORKBENCH_MODEL ?? 'deepseek-v4-flash',
        pricing: {
          'deepseek-v4-flash': { inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28 },
          'deepseek-v4-pro': { inputUsdPerMillion: 0.435, outputUsdPerMillion: 0.87 },
        },
      },
      artifactArchiveRoot: process.env.FRANK_ARTIFACT_ARCHIVE_ROOT ?? '/var/lib/frank/artifacts',
      recordUsage: async (usage) => {
        const cost = new CostRepository();
        await store.db.transaction(async (tx) => {
          await cost.record(tx, {
            cellId: usage.record.cellId,
            category: 'model',
            confidence: 'estimated',
            occurredAt: usage.occurredAt,
            workItemId: usage.record.workItemId,
            providerId: usage.providerId,
            modelRef: usage.model,
            quantity: decimal('1'),
            unit: 'flat',
            amount: money('USD', usage.estimatedCostUsd.toFixed(8)),
            currency: 'USD',
            correlationId: `workbench/${usage.record.id}`,
            detail: {
              tokensIn: usage.tokensIn,
              tokensOut: usage.tokensOut,
              pricingBasis: 'configured_provider_rates',
            },
            provenance: {
              method: 'agent',
              producer: runnerId,
              correlationId: `workbench/${usage.record.id}`,
            },
            actorRef: `service/${runnerId}`,
            now: usage.occurredAt,
          });
        });
      },
    });
    workbenchRunner = new WorkbenchRunner({
      store: workbenchStore,
      executor,
      runnerId,
      cellIds: [config.cellId],
      concurrency: Number(process.env.FRANK_WORKBENCH_CONCURRENCY ?? '2'),
      terminalReporter: new WorkbenchTerminalReporter(store.db, runnerId),
    });
    await workbenchRunner.start();
  }

  const missionEnabled = process.env.FRANK_MISSION_ORCHESTRATOR_ENABLED === 'true';
  if (missionEnabled && !runnerEnabled) {
    throw new Error(
      'FRANK_MISSION_ORCHESTRATOR_ENABLED=true requires FRANK_WORKBENCH_RUNNER_ENABLED=true',
    );
  }
  let missionOrchestrator: MissionOrchestrator | undefined;
  if (missionEnabled) {
    if (providerApiKey === undefined || workbenchStore === undefined) {
      throw new Error('mission orchestrator requires the configured model provider and workbench store');
    }
    const planner = new MissionPlanner({
      baseUrl: process.env.FRANK_WORKBENCH_MODEL_BASE_URL ?? 'https://api.deepseek.com',
      apiKey: providerApiKey,
      model: process.env.FRANK_MISSION_PLANNER_MODEL ?? 'deepseek-v4-flash',
    });
    missionOrchestrator = new MissionOrchestrator({
      db: store.db,
      planner,
      workbenchStore,
      cancellation: new WorkbenchCancellationService(store.db, workbenchRunner),
      workspaceSource:
        process.env.FRANK_MISSION_WORKSPACE_SOURCE ?? '/srv/frank/workspaces/central',
      cheapModel: process.env.FRANK_MISSION_CHEAP_MODEL ?? 'deepseek-v4-flash',
      strongModel: process.env.FRANK_MISSION_STRONG_MODEL ?? 'deepseek-v4-pro',
      schedulerIntervalMs: Number(process.env.FRANK_MISSION_SCHEDULER_INTERVAL_MS ?? '5000'),
      log: (message, error) => {
        if (error === undefined) appLoggerFallback(message);
        else appLoggerFallback(`${message}: ${String(error)}`);
      },
    });
    await missionOrchestrator.start();
  }

  const { app } = buildServer({
    config,
    store,
    db: store.db,
    ...(workbenchRunner === undefined ? {} : { workbenchRunner }),
    ...(missionOrchestrator === undefined ? {} : { missionOrchestrator }),
  });

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(async () => missionOrchestrator?.stopScheduler())
      .then(async () => workbenchRunner?.stop())
      .then(() => store.close())
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  await app.listen({ host: config.host, port: config.port });
  app.log.info(config.toJSON(), 'frank-api listening');
}

function appLoggerFallback(message: string): void {
  process.stderr.write(`[mission-orchestrator] ${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`frank-api failed to start\n${String(error)}\n`);
  process.exit(1);
});
