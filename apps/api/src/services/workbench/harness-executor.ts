/**
 * HarnessExecutor — WB-04: execute one claimed workbench through the
 * AgentHarnessAdapter contract alone.
 *
 * This file is the seam the WB-02 runner's {@link WorkbenchExecutor}
 * interface is filled with. It imports:
 *   - `AgentHarnessAdapter` types from @frank/contracts (the §6.2 contract),
 *   - the harness-agnostic publication protocol from recipes/headless-protocol,
 *   - the WorkbenchStore for persistence.
 * It does NOT import the Goose adapter, the provisioner, or any harness
 * internals — the adapter instance is injected at composition time
 * (WB-05 wires `GooseHeadlessHarnessAdapter` here; tests inject a fake).
 * "Trivial task def reaches a receipt through the adapter" is exactly what
 * harness-executor.test.ts proves with a scripted fake adapter.
 *
 * ## Run flow
 *
 *   1. provisioning -> running once the session starts
 *   2. prompt the session with the standalone headless instruction
 *      (buildHeadlessInstruction) and collect the transcript
 *   3. parse plan / step updates / artifacts / receipt out of the transcript
 *   4. persist each through the store (plan rule 3-10 enforced)
 *   5. outcome: done only when a receipt was published and no harness error
 *      surfaced; otherwise failed (with the reason)
 */

import { createHash } from 'node:crypto';

import { newId } from '@frank/adapter-postgres';
import type {
  AgentHarnessAdapter,
  ContextPack,
  HarnessEvent,
} from '@frank/contracts';

import { buildHeadlessInstruction, parseHarnessText } from './recipes/headless-protocol.js';
import type { WorkbenchStore } from './store.js';
import type { WorkbenchRecord } from './types.js';
import type { ExecuteOutcome } from './runner.js';

export interface HarnessExecutorOptions {
  readonly adapter: AgentHarnessAdapter;
  readonly store: WorkbenchStore;
  /** Identity stamped on persisted rows/events. */
  readonly executorId: string;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
  /** Production sandboxes require every model-declared artifact to exist. */
  readonly requireObservedArtifacts?: boolean;
  /**
   * Translate an ephemeral sandbox path into the durable path that will be
   * archived by the owning executor. Matching still uses the observed
   * sandbox path, so a model cannot claim an unobserved file.
   */
  readonly durableArtifactPath?: (record: WorkbenchRecord, sandboxPath: string) => string;
}

export class HarnessExecutor {
  private readonly adapter: AgentHarnessAdapter;
  private readonly store: WorkbenchStore;
  private readonly executorId: string;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private readonly requireObservedArtifacts: boolean;
  private readonly durableArtifactPath: (record: WorkbenchRecord, sandboxPath: string) => string;
  private readonly active = new Map<string, string>();

  constructor(options: HarnessExecutorOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.executorId = options.executorId;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((m) => console.error(m));
    this.requireObservedArtifacts = options.requireObservedArtifacts ?? false;
    this.durableArtifactPath = options.durableArtifactPath ?? ((_record, path) => path);
  }

  async execute(record: WorkbenchRecord): Promise<ExecuteOutcome> {
    const taskDef = record.taskDef;
    const instruction = buildHeadlessInstruction(taskDef);
    const nowIso = this.now().toISOString();

    const session = await this.adapter.start({
      runId: record.id,
      cellId: record.cellId,
      workspacePath: '/workspace',
      contextPack: minimalContextPack(record, instruction),
      systemPrompt:
        'You are a FRANK workbench agent. Follow the publication duties in your task instruction exactly. Your first assistant response must begin with the FRANK_PLAN block before any tool call, and you must end with a valid FRANK_RECEIPT block.',
      ...(taskDef.harness?.provider !== undefined && taskDef.harness?.model !== undefined
        ? { provider: { provider: taskDef.harness.provider, model: taskDef.harness.model } }
        : {}),
      now: nowIso,
    });
    this.active.set(record.id, session.id);

    await this.store.setState(record.id, 'running', this.executorId, this.now(), {
      startedAt: this.now(),
    });
    await this.store.appendEvent(record.id, 'resumed', { session: session.id }, this.now());

    let transcript = '';
    let harnessError: string | null = null;
    try {
      for await (const event of this.adapter.prompt({
        sessionId: session.id,
        content: instruction,
        stream: true,
      })) {
        transcript += renderEvent(event);
        if (event.type === 'error') {
          harnessError = event.content;
        }
      }
    } catch (error) {
      harnessError = error instanceof Error ? error.message : String(error);
    }

    const output = parseHarnessText(transcript);

    // Plan publication (master plan §3.4): required and 3-to-10 steps.
    if (output.plan.length > 0) {
      try {
        await this.store.publishPlan(record.id, output.plan, this.now());
        await this.store.appendEvent(
          record.id,
          'plan_published',
          { steps: output.plan.length },
          this.now(),
        );
      } catch (error) {
        harnessError =
          harnessError ?? `plan rejected: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      harnessError = harnessError ?? 'agent published no plan (master plan §3.4 violation)';
    }

    for (const update of output.stepUpdates) {
      const applied = await this.store.updatePlanStep(
        record.id,
        update.seq,
        update.state,
        update.note,
        this.now(),
      );
      if (applied) {
        await this.store.appendEvent(
          record.id,
          'step_updated',
          { seq: update.seq, state: update.state },
          this.now(),
        );
      }
    }

    let observedArtifacts: Awaited<ReturnType<AgentHarnessAdapter['collect']>> = [];
    if (this.requireObservedArtifacts) {
      try {
        observedArtifacts = await this.adapter.collect({
          sessionId: session.id,
          runId: record.id,
        });
      } catch (error) {
        harnessError =
          harnessError ??
          `artifact inspection failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    for (const artifact of output.artifacts) {
      const observed = observedArtifacts.find((item) => item.path === artifact.path);
      if (this.requireObservedArtifacts && observed === undefined) {
        harnessError = harnessError ?? `artifact was not observed in the sandbox: ${artifact.path}`;
        continue;
      }
      await this.store.registerArtifact(
        record.id,
        {
          id: newId(),
          path: this.durableArtifactPath(record, artifact.path),
          kind: artifact.kind,
          ...(observed === undefined ? {} : { sha256: observed.sha256 }),
          mediaType: mediaTypeFor(artifact.path),
        },
        this.now(),
      );
      await this.store.appendEvent(
        record.id,
        'artifact_registered',
        {
          path: this.durableArtifactPath(record, artifact.path),
          sandboxPath: artifact.path,
          ...(observed === undefined
            ? {}
            : { sha256: observed.sha256, sizeBytes: observed.sizeBytes }),
        },
        this.now(),
      );
    }

    if (output.receipt !== null) {
      await this.store.publishReceipt(
        record.id,
        {
          summary: output.receipt.summary,
          assumptions: output.receipt.assumptions,
          evidence: output.receipt.evidence,
        },
        taskDef.harness?.adapter ?? 'harness',
        this.now(),
      );
      await this.store.appendEvent(record.id, 'receipt_published', {}, this.now());
    } else {
      harnessError = harnessError ?? 'agent published no receipt (WB-04 duty)';
    }

    await this.adapter
      .close({ sessionId: session.id, runId: record.id, cleanup: true, now: this.now().toISOString() }, this.now().toISOString())
      .catch((error: unknown) => {
        this.log(
          `workbench ${record.id}: session close failed (${error instanceof Error ? error.message : String(error)})`,
        );
      });

    this.active.delete(record.id);

    if (harnessError !== null) {
      return { kind: 'failed', error: harnessError };
    }
    return { kind: 'done' };
  }

  /**
   * No container-level cleanup here — the provisioner (WB-03) owns
   * containers/volumes. The runner composes a cleanup that calls both.
   */
  async cleanup(_record: WorkbenchRecord): Promise<void> {
    // intentionally empty — see WB-03 WorkbenchProvisioner.deprovision
  }

  async cancel(record: WorkbenchRecord, reason: string): Promise<void> {
    const sessionId = this.active.get(record.id);
    if (sessionId === undefined) return;
    try {
      await this.adapter.cancel({ sessionId, reason, now: this.now().toISOString() });
    } catch {
      await this.adapter.kill({ sessionId, reason, now: this.now().toISOString() });
    }
  }
}

function renderEvent(event: HarnessEvent): string {
  switch (event.type) {
    case 'text':
      return `${event.content}\n`;
    case 'tool_call':
      return '';
    case 'tool_result':
      return '';
    case 'thinking':
      return '';
    case 'error':
      return '';
    case 'done':
      return '';
  }
}

function mediaTypeFor(path: string): string {
  const extension = path.toLowerCase().split('.').pop();
  switch (extension) {
    case 'json':
      return 'application/json';
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
    case 'mjs':
      return 'text/javascript';
    case 'md':
      return 'text/markdown';
    case 'txt':
    case 'log':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Minimal FRANK-§7.4 context pack for a headless workbench run. The full
 * signed pack assembly (policy broker, memory recall) is WB-05's front-door
 * concern; here we assemble the minimized shape so the adapter contract is
 * satisfied honestly. `integrity.signature` is a content-hash placeholder
 * until the signing key wiring lands (documented assumption).
 */
function minimalContextPack(record: WorkbenchRecord, instruction: string): ContextPack {
  const taskDef = record.taskDef;
  const packWithoutIntegrity = {
    schema: 'frank.context-pack/v1' as const,
    packId: newId(),
    assignmentId: record.id,
    cellId: record.cellId,
    createdAt: new Date().toISOString(),
    goal: taskDef.instruction,
    definitionOfDone: ['plan published (3-10 steps)', 'artifacts registered', 'receipt published'],
    requirements: [],
    sources: [],
    constraints: [
      'stay inside the declared mounts and /workspace',
      ...(taskDef.network?.egressAllowlist?.length
        ? [`egress allowlist: ${taskDef.network.egressAllowlist.join(', ')}`]
        : ['no network egress']),
    ],
    allowedTools: [],
    credentials: [],
    classification: 'internal' as const,
    egress: taskDef.network?.egressAllowlist?.length ? ('approved-connectors' as const) : ('none' as const),
    budget: {
      maxSpend: taskDef.leash?.spendCapUsd ?? 0,
      currency: 'USD',
      deadline: new Date(
        Date.now() + (taskDef.leash?.wallClockSec ?? 3600) * 1000,
      ).toISOString(),
      maxRetries: 0,
    },
    expectedOutputs: ['receipt'],
    evidenceSchemaRef: 'schema://frank.workbench-receipt/v1',
    escalation: {
      escalateWhen: ['task cannot be completed from the provided mounts'],
      doNotAssume: ['content outside the declared mounts'],
    },
    memory: { recalled: [], recallQuery: record.taskDef.instruction, backend: 'none' },
  };

  const contentHash = `sha256:${createHash('sha256')
    .update(JSON.stringify(packWithoutIntegrity))
    .digest('hex')}`;

  return {
    ...packWithoutIntegrity,
    integrity: {
      contentHash,
      signerId: 'workbench-harness-executor',
      signature: `dev-placeholder:${contentHash}`,
      signedAt: new Date().toISOString(),
    },
    goal: instruction,
  };
}
