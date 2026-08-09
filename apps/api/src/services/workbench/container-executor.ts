/** Compose provision -> fenced model/tool loop -> teardown for one workbench. */

import type { WorkbenchRecord } from './types.js';
import { mkdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { WorkbenchStore } from './store.js';
import type { ExecuteOutcome, WorkbenchExecutor } from './runner.js';
import type { DockerCli, WorkbenchProvisioner } from './provisioner.js';
import { HarnessExecutor } from './harness-executor.js';
import { ContainerAgentHarnessAdapter } from './recipes/container-agent.js';

export interface ContainerModelProviderConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly pricing?: Readonly<
    Record<string, { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number }>
  >;
}

export interface ContainerWorkbenchExecutorOptions {
  readonly provisioner: WorkbenchProvisioner;
  readonly docker: DockerCli;
  readonly store: WorkbenchStore;
  readonly executorId: string;
  readonly provider: ContainerModelProviderConfig;
  readonly maxModelTurns?: number;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
  /** API-local durable volume where /workspace/out is archived before teardown. */
  readonly artifactArchiveRoot?: string;
  readonly recordUsage?: (usage: {
    readonly record: WorkbenchRecord;
    readonly providerId: string;
    readonly model: string;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly estimatedCostUsd: number;
    readonly occurredAt: Date;
  }) => Promise<void>;
}

export class ContainerWorkbenchExecutor implements WorkbenchExecutor {
  readonly #provisioner: WorkbenchProvisioner;
  readonly #docker: DockerCli;
  readonly #store: WorkbenchStore;
  readonly #executorId: string;
  readonly #provider: ContainerModelProviderConfig;
  readonly #maxModelTurns: number | undefined;
  readonly #now: () => Date;
  readonly #log: (message: string) => void;
  readonly #artifactArchiveRoot: string;
  readonly #recordUsage: ContainerWorkbenchExecutorOptions['recordUsage'];
  readonly #active = new Map<string, HarnessExecutor>();

  constructor(options: ContainerWorkbenchExecutorOptions) {
    this.#provisioner = options.provisioner;
    this.#docker = options.docker;
    this.#store = options.store;
    this.#executorId = options.executorId;
    this.#provider = options.provider;
    this.#maxModelTurns = options.maxModelTurns;
    this.#now = options.now ?? (() => new Date());
    this.#log = options.log ?? ((message) => console.error(message));
    this.#artifactArchiveRoot = resolve(options.artifactArchiveRoot ?? '/var/lib/frank/artifacts');
    this.#recordUsage = options.recordUsage;
  }

  async execute(record: WorkbenchRecord): Promise<ExecuteOutcome> {
    const provisioned = await this.#provisioner.provision(record);
    await this.#store.appendEvent(
      record.id,
      'provisioned',
      {
        container: provisioned.spec.name,
        image: provisioned.spec.image,
        network: provisioned.spec.network,
      },
      this.#now(),
    );

    const model = record.taskDef.harness?.model ?? this.#provider.model;
    const pricing = this.#provider.pricing?.[model];
    const adapter = new ContainerAgentHarnessAdapter({
      containerName: provisioned.spec.name,
      docker: this.#docker,
      provider: {
        id: this.#provider.id,
        baseUrl: this.#provider.baseUrl,
        apiKey: this.#provider.apiKey,
        model,
        ...(pricing === undefined ? {} : pricing),
      },
      ...(this.#maxModelTurns === undefined ? {} : { maxTurns: this.#maxModelTurns }),
      now: this.#now,
      ...(record.taskDef.leash?.tokenBudget === undefined
        ? {}
        : { tokenBudget: record.taskDef.leash.tokenBudget }),
      ...(record.taskDef.leash?.spendCapUsd === undefined
        ? {}
        : { spendCapUsd: record.taskDef.leash.spendCapUsd }),
    });
    const harness = new HarnessExecutor({
      adapter,
      store: this.#store,
      executorId: this.#executorId,
      now: this.#now,
      log: this.#log,
      requireObservedArtifacts: true,
      durableArtifactPath: (workbench, sandboxPath) =>
        archivedArtifactPath(this.#artifactArchiveRoot, workbench.id, sandboxPath),
    });
    this.#active.set(record.id, harness);

    try {
      const outcome = await harness.execute(record);
      const usage = await adapter.usage('1h');
      if (this.#recordUsage !== undefined) {
        await this.#recordUsage({
          record,
          providerId: this.#provider.id,
          model,
          tokensIn: usage.totalTokensIn,
          tokensOut: usage.totalTokensOut,
          estimatedCostUsd: usage.estimatedCostUsd ?? 0,
          occurredAt: this.#now(),
        });
      }
      await this.#archiveArtifacts(record, provisioned.spec.name);
      return outcome;
    } finally {
      this.#active.delete(record.id);
      await this.#provisioner.deprovision(record).catch((error: unknown) => {
        this.#log(
          `workbench ${record.id}: final sandbox teardown failed (${error instanceof Error ? error.message : String(error)})`,
        );
      });
    }
  }

  async cancel(record: WorkbenchRecord, reason: string): Promise<void> {
    const harness = this.#active.get(record.id);
    if (harness !== undefined) await harness.cancel(record, reason);
    // Removing the container is the forceful cancellation boundary. It also
    // terminates a shell command that ignored cooperative cancellation.
    await this.#provisioner.deprovision(record);
  }

  async cleanup(record: WorkbenchRecord): Promise<void> {
    await this.#provisioner.deprovision(record);
  }

  async #archiveArtifacts(record: WorkbenchRecord, containerName: string): Promise<void> {
    const destination = join(this.#artifactArchiveRoot, record.id);
    await mkdir(destination, { recursive: true, mode: 0o750 });
    const copied = await this.#docker.run([
      'cp',
      `${containerName}:/workspace/out/.`,
      destination,
    ]);
    // An agent may legitimately produce only a receipt. Docker reports a
    // missing /workspace/out in that case; every declared artifact was already
    // rejected by HarnessExecutor, so there is nothing to archive.
    if (copied.exitCode !== 0 && !/no such (file|directory)|could not find/i.test(copied.stderr)) {
      throw new Error(
        `artifact archive failed for ${record.id}: ${copied.stderr.trim() || 'docker cp failed'}`,
      );
    }
  }
}

function archivedArtifactPath(root: string, workbenchId: string, sandboxPath: string): string {
  const outRoot = '/workspace/out';
  const normalized = sandboxPath.replace(/\\/g, '/');
  const rel = relative(outRoot, normalized);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`artifact path is outside /workspace/out: ${sandboxPath}`);
  }
  return join(root, workbenchId, rel);
}
