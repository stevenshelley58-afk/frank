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
import { statfs } from 'node:fs/promises';
import { PostgresAttachmentPersistence } from './services/attachments/postgres-persistence.js';
import { AttachmentLifecycle } from './services/attachments/lifecycle.js';
import { attachmentRuntimeConfig, createAttachmentRuntime, startAttachmentMaintenance } from './services/attachments/runtime.js';

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

  // Attachment lifecycle is opt-in as one atomic configuration set. Empty is
  // deliberately disabled; a partial set is rejected by attachmentRuntimeConfig
  // before routes, workers or private hooks can be exposed.
  const attachmentConfig = attachmentRuntimeConfig(process.env);
  const attachmentAbort = new AbortController();
  let stopAttachmentMaintenance: (() => Promise<void>) | undefined;
  let attachments: Parameters<typeof buildServer>[0]['attachments'];
  if (attachmentConfig) {
    const hostFreeBytes = async (): Promise<bigint> => {
      try {
        const observed = await statfs(process.env.FRANK_ATTACHMENT_DURABLE_PATH ?? '/var/lib/frank/artifacts', { bigint: true });
        return observed.bavail * observed.bsize;
      } catch {
        // A capacity observation failure refuses reservations; it is never
        // replaced with caller-supplied or stale remaining-byte data.
        return 0n;
      }
    };
    const persistence = new PostgresAttachmentPersistence(store.db, hostFreeBytes);
    const runtime = createAttachmentRuntime(attachmentConfig, persistence);
    const lifecycle = new AttachmentLifecycle(persistence, runtime.capabilities);
    attachments = {
      lifecycle,
      persistence,
      downloader: runtime.downloader,
      tusdTerminator: runtime.terminator,
      tusdHookSecret: requiredAttachmentSecret('FRANK_TUSD_HOOK_SECRET'),
      tusdGateSecret: requiredAttachmentSecret('FRANK_TUSD_GATE_SECRET'),
    };
    stopAttachmentMaintenance = startAttachmentMaintenance({ worker: runtime.worker, lifecycle, persistence, terminator: runtime.terminator }, attachmentAbort.signal);
  }

  const { app } = buildServer({
    config,
    store,
    db: store.db,
    ...(attachments === undefined ? {} : { attachments }),
  });

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(async () => {
        // Workers receive the abort before their bounded drain.  The pool stays
        // open until both maintenance loops have stopped, so an in-flight CAS
        // cannot race a closed database connection during shutdown.
        attachmentAbort.abort();
        await stopAttachmentMaintenance?.();
      })
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

function requiredAttachmentSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when attachments are enabled`);
  return value;
}

main().catch((error: unknown) => {
  process.stderr.write(`frank-api failed to start\n${String(error)}\n`);
  process.exit(1);
});
