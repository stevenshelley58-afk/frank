/**
 * CLI headless recipe — WB-10: the SECOND AgentHarnessAdapter.
 *
 * Master plan §3.3 requires the workbench contract to be provably runnable
 * under at least two harness adapters. `GooseHeadlessHarnessAdapter` is the
 * ACP/WebSocket adapter; this one is the documented non-ACP path — a
 * single-shot subprocess CLI (the `coder/agentapi`-style mapping described in
 * `goose-headless.ts`):
 *
 *   start()  -> records config; the process is spawned per turn (single-shot)
 *   prompt() -> spawn one turn in the workspace, stream stdout lines as text
 *               events, end with `done`
 *   resume() -> unsupported: non-ACP CLIs have no portable session; FRANK
 *               rehydrates via checkpoint + fresh run (descriptor)
 *   kill()   -> SIGKILL the active process (cancellationStrength 'process')
 *   close()  -> reap the process; workspace teardown is WB-03's job
 *
 * The publication protocol is plain text in the transcript, so
 * `parseHarnessText` works unchanged — that transport-neutrality is exactly
 * what makes the harness contract swappable (WB-10).
 *
 * The process spawner is injectable ({@link CliProcessSpawner}) so unit tests
 * script stdout without spawning a real binary; production injects the default
 * `node:child_process` spawner.
 */

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import type {
  AgentHarnessAdapter,
  ArtifactManifest,
  CancelHarnessRun,
  CheckpointHarnessRun,
  CloseHarnessRun,
  CollectHarnessArtifacts,
  HarnessCapacity,
  HarnessCheckpoint,
  HarnessDescriptor,
  HarnessEvent,
  HarnessPrompt,
  HarnessSession,
  HarnessSessionState,
  HarnessUsage,
  HealthReport,
  InterruptHarnessRun,
  KillHarnessRun,
  ResumeHarnessRun,
  StartHarnessRun,
  SteerHarnessRun,
  UsageWindow,
} from '@frank/contracts';

/* --------------------------------------------------------------- spawner --- */

/** A live CLI process the adapter can observe and terminate. */
export interface CliProcessHandle {
  /** Observable stdout, line by line (in order). */
  stdoutLines(): AsyncIterable<string>;
  /** Terminate the process (SIGKILL). Idempotent. */
  kill(): Promise<void>;
  /** Wait for exit; resolves with the exit code. */
  wait(): Promise<number>;
}

/** Injected so tests can script stdout without a real binary. */
export interface CliProcessSpawner {
  spawn(input: {
    command: string;
    args: readonly string[];
    cwd: string;
    env?: Record<string, string>;
  }): Promise<CliProcessHandle>;
}

/** Default spawner over node:child_process (production path). */
export function createChildProcessSpawner(): CliProcessSpawner {
  return {
    async spawn(input) {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let killed = false;
      let stdoutDone = false;
      const pending: string[] = [];
      let notify: (() => void) | null = null;
      let partial = '';

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        partial += chunk;
        let idx: number;
        while ((idx = partial.indexOf('\n')) >= 0) {
          pending.push(partial.slice(0, idx));
          partial = partial.slice(idx + 1);
          notify?.();
        }
      });
      child.stdout?.on('end', () => {
        if (partial !== '') pending.push(partial);
        stdoutDone = true;
        notify?.();
      });
      child.on('close', () => {
        stdoutDone = true;
        notify?.();
      });

      return {
        async *stdoutLines() {
          for (;;) {
            while (pending.length > 0) yield pending.shift() as string;
            if (stdoutDone && pending.length === 0) return;
            await new Promise<void>((r) => {
              notify = r;
            });
            notify = null;
          }
        },
        async kill() {
          if (killed) return;
          killed = true;
          child.kill('SIGKILL');
        },
        wait() {
          return new Promise<number>((resolve) => {
            child.once('close', (code) => resolve(code ?? 0));
          });
        },
      };
    },
  };
}

/* ---------------------------------------------------------------- adapter --- */

export interface CliHeadlessAdapterOptions {
  /** The CLI binary, e.g. 'codex' or 'claude'. */
  readonly command: string;
  /** Base args prepended before the turn prompt. */
  readonly args?: readonly string[];
  /** Injectable spawner (tests). Default: child_process. */
  readonly spawner?: CliProcessSpawner;
  /** CLI label for the descriptor. Default: the command name. */
  readonly label?: string;
}

export class CliHeadlessHarnessAdapter implements AgentHarnessAdapter {
  private readonly spawner: CliProcessSpawner;
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly label: string;
  /** sessionId -> live process (for kill/close). */
  private readonly active = new Map<string, CliProcessHandle>();

  constructor(options: CliHeadlessAdapterOptions) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.label = options.label ?? options.command;
    this.spawner = options.spawner ?? createChildProcessSpawner();
  }

  async descriptor(): Promise<HarnessDescriptor> {
    return {
      id: 'cli',
      label: this.label,
      blurb: 'Single-shot subprocess CLI harness (agentapi-style) — one turn per prompt.',
      version: '1.0.0',
      acp: { supported: false, versions: [] },
      toolProtocols: ['native'],
      supportedModels: [],
      subscriptionAuth: false,
      contextLimits: {},
      budgetReporting: false,
      workspaceModes: ['isolated'],
      cleanupGuarantee: 'best-effort',
      osRequirements: [],
      resumeGuarantee: 'same-harness-restart',
      checkpointPortability: 'frank-rehydratable',
      eventReplay: 'none',
      cancellationStrength: 'process',
      maxDataClass: 'internal',
    };
  }

  async health(): Promise<HealthReport> {
    // No out-of-band health endpoint on a bare CLI; report healthy so the
    // runner can attempt a turn (the spawn itself is the probe).
    return { healthy: true, checkedAt: new Date().toISOString() };
  }

  async capacity(): Promise<HarnessCapacity> {
    return { maxConcurrentSessions: 4, activeSessions: this.active.size, accepting: true };
  }

  async usage(window: UsageWindow): Promise<HarnessUsage> {
    // No usage ledger on a bare CLI; report zeros honestly (§18.1).
    const usage: HarnessUsage = {
      window,
      totalSessions: 0,
      totalTurns: 0,
      errors: 0,
    } as HarnessUsage;
    (usage as { totalTokensIn: number }).totalTokensIn = 0;
    (usage as { totalTokensOut: number }).totalTokensOut = 0;
    return usage;
  }

  async start(input: StartHarnessRun): Promise<HarnessSession> {
    // Single-shot: no process until the first prompt. The session id is a
    // FRANK-assigned tag; the native id is assigned per turn.
    const id = `cli-${randomUUID()}`;
    return {
      id,
      nativeSessionId: id,
      harness: 'cli',
      runId: input.runId,
      createdAt: new Date().toISOString(),
      resumed: false,
    };
  }

  async resume(_input: ResumeHarnessRun): Promise<HarnessSession> {
    throw new Error('cli headless: resume unsupported — rehydrate via checkpoint');
  }

  async inspect(sessionId: string): Promise<HarnessSessionState> {
    return {
      sessionId,
      status: 'active',
      turnsCompleted: 0,
      tokensUsed: 0,
      detail: 'single-shot CLI exposes no session introspection',
    };
  }

  async *prompt(input: HarnessPrompt): AsyncIterable<HarnessEvent> {
    const handle = await this.spawner.spawn({
      command: this.command,
      args: [...this.args, input.content],
      cwd: '/workspace',
    });
    this.active.set(input.sessionId, handle);

    let failed = false;
    try {
      for await (const line of handle.stdoutLines()) {
        yield { type: 'text', content: `${line}\n` };
      }
      const code = await handle.wait();
      if (code !== 0) {
        failed = true;
        yield { type: 'error', content: `cli exited with code ${code}` };
      }
    } finally {
      this.active.delete(input.sessionId);
    }

    if (!failed) {
      yield { type: 'done' };
    } else {
      yield { type: 'done' };
    }
  }

  async checkpoint(input: CheckpointHarnessRun): Promise<HarnessCheckpoint> {
    return {
      checkpointId: `${input.runId}-cli`,
      runId: input.runId,
      runRevision: 0,
      planState: {},
      sourceRefs: [],
      artifactDigests: [],
      completedReceipts: [],
      pendingEffects: [],
      cumulativeSpendUsd: 0,
      eventCursor: '',
      remainingBudget: { maxSpend: 0, currency: 'USD' },
      policyRevision: 'unknown',
      createdAt: input.now,
    };
  }

  async steer(input: SteerHarnessRun): Promise<void> {
    // Steer = a follow-up turn on the same CLI.
    for await (const _event of this.prompt({
      sessionId: input.sessionId,
      content: input.instruction,
    })) {
      // drain the stream
    }
  }

  async interrupt(_input: InterruptHarnessRun): Promise<void> {
    // No mid-turn interrupt on a single-shot CLI; cancellation is process-level.
  }

  async cancel(input: CancelHarnessRun): Promise<void> {
    await this.kill(input);
  }

  async kill(input: KillHarnessRun): Promise<void> {
    const handle = this.active.get(input.sessionId);
    if (handle === undefined) return;
    await handle.kill();
    this.active.delete(input.sessionId);
  }

  async collect(_input: CollectHarnessArtifacts): Promise<ArtifactManifest[]> {
    // Artifacts register through the marker protocol, not out-of-band scraping.
    return [];
  }

  async close(input: CloseHarnessRun): Promise<void> {
    const handle = this.active.get(input.sessionId);
    if (handle === undefined) return;
    await handle.kill();
    this.active.delete(input.sessionId);
  }
}
