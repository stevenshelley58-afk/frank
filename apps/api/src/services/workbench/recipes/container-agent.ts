/**
 * OpenAI-compatible model loop with tools executed inside one workbench
 * container. The provider credential never enters the container: inference
 * happens in the API process and the only tool boundary is `docker exec`.
 */

import { randomUUID } from 'node:crypto';

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

import type { DockerCli } from '../provisioner.js';

interface ProviderConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly inputUsdPerMillion?: number;
  readonly outputUsdPerMillion?: number;
}

export interface ContainerAgentHarnessAdapterOptions {
  readonly containerName: string;
  readonly docker: DockerCli;
  readonly provider: ProviderConfig;
  readonly maxTurns?: number;
  readonly maxToolOutputBytes?: number;
  readonly tokenBudget?: number;
  readonly spendCapUsd?: number;
  readonly now?: () => Date;
}

interface StoredSession {
  readonly handle: HarnessSession;
  readonly start: StartHarnessRun;
  controller: AbortController | null;
  turnsCompleted: number;
  tokensIn: number;
  tokensOut: number;
  tokensUsed: number;
  spendUsd: number;
  closed: boolean;
}

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ToolCall[];
}

interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatCompletion {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly ToolCall[];
    };
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
  readonly error?: { readonly message?: string };
}

const SHELL_TOOL = {
  type: 'function',
  function: {
    name: 'shell',
    description:
      'Run a non-interactive shell command inside the isolated /workspace container. ' +
      'The container has no Docker socket and no network unless the assignment explicitly grants it.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'POSIX shell command to run from /workspace.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
} as const;

export class ContainerAgentHarnessAdapter implements AgentHarnessAdapter {
  readonly #containerName: string;
  readonly #docker: DockerCli;
  readonly #provider: ProviderConfig;
  readonly #maxTurns: number;
  readonly #maxToolOutputBytes: number;
  readonly #now: () => Date;
  readonly #tokenBudget: number | undefined;
  readonly #spendCapUsd: number | undefined;
  readonly #sessions = new Map<string, StoredSession>();

  constructor(options: ContainerAgentHarnessAdapterOptions) {
    this.#containerName = options.containerName;
    this.#docker = options.docker;
    this.#provider = options.provider;
    this.#maxTurns = options.maxTurns ?? 24;
    this.#maxToolOutputBytes = options.maxToolOutputBytes ?? 64 * 1024;
    this.#now = options.now ?? (() => new Date());
    this.#tokenBudget = options.tokenBudget;
    this.#spendCapUsd = options.spendCapUsd;
  }

  async descriptor(): Promise<HarnessDescriptor> {
    return {
      id: 'frank-container-agent',
      label: 'FRANK Container Agent',
      blurb: 'Control-plane model loop with every tool call fenced inside a disposable container.',
      version: '1.0.0',
      acp: { supported: false, versions: [] },
      toolProtocols: ['native'],
      supportedModels: [this.#provider.model],
      subscriptionAuth: false,
      contextLimits: {},
      budgetReporting: true,
      workspaceModes: ['sandboxed'],
      cleanupGuarantee: 'sandbox-destroyed',
      osRequirements: ['Docker'],
      resumeGuarantee: 'same-harness-restart',
      checkpointPortability: 'frank-rehydratable',
      eventReplay: 'none',
      cancellationStrength: 'sandbox',
      maxDataClass: 'internal',
    };
  }

  async health(): Promise<HealthReport> {
    return { healthy: this.#provider.apiKey.length > 0, checkedAt: this.#now().toISOString() };
  }

  async capacity(): Promise<HarnessCapacity> {
    const activeSessions = [...this.#sessions.values()].filter((session) => !session.closed).length;
    return { maxConcurrentSessions: 4, activeSessions, accepting: activeSessions < 4 };
  }

  async usage(window: UsageWindow): Promise<HarnessUsage> {
    const sessions = [...this.#sessions.values()];
    const estimatedCostUsd = sessions.reduce((sum, session) => sum + session.spendUsd, 0);
    return {
      window,
      totalSessions: sessions.length,
      totalTurns: sessions.reduce((sum, session) => sum + session.turnsCompleted, 0),
      totalTokensIn: sessions.reduce((sum, session) => sum + session.tokensIn, 0),
      totalTokensOut: sessions.reduce((sum, session) => sum + session.tokensOut, 0),
      estimatedCostUsd,
      errors: 0,
    };
  }

  async start(input: StartHarnessRun): Promise<HarnessSession> {
    if (input.provider !== undefined && input.provider.provider !== this.#provider.id) {
      throw new Error(
        `provider ${input.provider.provider} is not available in this runner (configured: ${this.#provider.id})`,
      );
    }
    if (input.provider !== undefined && input.provider.model !== this.#provider.model) {
      throw new Error(
        `model ${input.provider.model} is not available in this runner (configured: ${this.#provider.model})`,
      );
    }
    const id = `container-agent-${randomUUID()}`;
    const handle: HarnessSession = {
      id,
      nativeSessionId: id,
      harness: 'frank-container-agent',
      runId: input.runId,
      createdAt: this.#now().toISOString(),
      resumed: false,
    };
    this.#sessions.set(id, {
      handle,
      start: input,
      controller: null,
      turnsCompleted: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensUsed: 0,
      spendUsd: 0,
      closed: false,
    });
    return handle;
  }

  async resume(_input: ResumeHarnessRun): Promise<HarnessSession> {
    throw new Error('container agent resume requires a fresh rehydrated workbench');
  }

  async inspect(sessionId: string): Promise<HarnessSessionState> {
    const session = this.#requireSession(sessionId);
    return {
      sessionId,
      status: session.closed ? 'closed' : session.controller === null ? 'idle' : 'active',
      turnsCompleted: session.turnsCompleted,
      tokensUsed: session.tokensUsed,
      lastActivityAt: this.#now().toISOString(),
    };
  }

  async *prompt(input: HarnessPrompt): AsyncIterable<HarnessEvent> {
    const session = this.#requireSession(input.sessionId);
    if (session.closed) throw new Error(`session ${input.sessionId} is closed`);
    if (this.#tokenBudget !== undefined && this.#tokenBudget <= 0) {
      yield { type: 'error', content: 'token budget exhausted before model execution (0 tokens)' };
      yield { type: 'done' };
      return;
    }
    if (this.#spendCapUsd !== undefined && this.#spendCapUsd <= 0) {
      yield { type: 'error', content: 'spend cap exhausted before model execution ($0)' };
      yield { type: 'done' };
      return;
    }

    const controller = new AbortController();
    session.controller = controller;
    const messages: ChatMessage[] = [
      { role: 'system', content: session.start.systemPrompt },
      { role: 'user', content: input.content },
    ];

    try {
      for (let turn = 0; turn < this.#maxTurns; turn += 1) {
        const completion = await this.#complete(messages, controller.signal);
        session.turnsCompleted += 1;
        const tokensIn = completion.usage?.prompt_tokens ?? 0;
        const tokensOut = completion.usage?.completion_tokens ?? 0;
        session.tokensIn += tokensIn;
        session.tokensOut += tokensOut;
        session.tokensUsed += tokensIn + tokensOut;
        session.spendUsd += completionCostUsd(completion, this.#provider);
        if (this.#tokenBudget !== undefined && session.tokensUsed > this.#tokenBudget) {
          yield {
            type: 'error',
            content: `token budget exhausted (${String(session.tokensUsed)}/${String(this.#tokenBudget)})`,
          };
          yield { type: 'done' };
          return;
        }
        if (this.#spendCapUsd !== undefined && session.spendUsd > this.#spendCapUsd) {
          yield {
            type: 'error',
            content: `spend cap exhausted ($${session.spendUsd.toFixed(6)}/$${this.#spendCapUsd.toFixed(6)})`,
          };
          yield { type: 'done' };
          return;
        }
        const message = completion.choices?.[0]?.message;
        if (message === undefined) {
          throw new Error(completion.error?.message ?? 'provider returned no completion choice');
        }

        const content = message.content ?? '';
        if (content !== '') yield { type: 'text', content };
        const toolCalls = message.tool_calls ?? [];
        messages.push({
          role: 'assistant',
          content: message.content ?? null,
          ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
        });

        if (toolCalls.length === 0) {
          yield {
            type: 'done',
            usage: {
              tokensIn: completion.usage?.prompt_tokens ?? 0,
              tokensOut: completion.usage?.completion_tokens ?? 0,
              model: this.#provider.model,
            },
          };
          return;
        }

        for (const call of toolCalls) {
          if (call.function.name !== 'shell') {
            const error = `unknown tool ${call.function.name}`;
            yield { type: 'tool_result', callId: call.id, content: error, isError: true };
            messages.push({ role: 'tool', tool_call_id: call.id, content: error });
            continue;
          }

          const command = parseShellCommand(call.function.arguments);
          yield { type: 'tool_call', toolName: 'shell', toolArgs: { command }, callId: call.id };
          const result = await this.#docker.run([
            'exec',
            '--user',
            '10001:10001',
            '--workdir',
            '/workspace',
            this.#containerName,
            'sh',
            '-lc',
            command,
          ]);
          const rendered = truncateToolOutput(
            [result.stdout, result.stderr].filter((value) => value !== '').join('\n'),
            this.#maxToolOutputBytes,
          );
          const toolContent =
            `${rendered}${rendered.endsWith('\n') || rendered === '' ? '' : '\n'}` +
            `[exit_code=${String(result.exitCode)}]`;
          yield {
            type: 'tool_result',
            callId: call.id,
            content: toolContent,
            isError: result.exitCode !== 0,
          };
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
        }
      }
      yield { type: 'error', content: `model exceeded the ${String(this.#maxTurns)}-turn leash` };
      yield { type: 'done' };
    } catch (error) {
      const content =
        error instanceof Error && error.name === 'AbortError'
          ? 'model turn cancelled'
          : error instanceof Error
            ? error.message
            : String(error);
      yield { type: 'error', content };
      yield { type: 'done' };
    } finally {
      session.controller = null;
    }
  }

  async checkpoint(input: CheckpointHarnessRun): Promise<HarnessCheckpoint> {
    return {
      checkpointId: `${input.runId}-container-agent`,
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
    for await (const _event of this.prompt({
      sessionId: input.sessionId,
      content: input.instruction,
    })) {
      // Drain the follow-up turn.
    }
  }

  async interrupt(input: InterruptHarnessRun): Promise<void> {
    this.#sessions.get(input.sessionId)?.controller?.abort(input.reason);
  }

  async cancel(input: CancelHarnessRun): Promise<void> {
    this.#sessions.get(input.sessionId)?.controller?.abort(input.reason);
  }

  async kill(input: KillHarnessRun): Promise<void> {
    await this.cancel(input);
  }

  async collect(input: CollectHarnessArtifacts): Promise<ArtifactManifest[]> {
    this.#requireSession(input.sessionId);
    const script = [
      'import hashlib,json,mimetypes,pathlib',
      'root=pathlib.Path("/workspace/out")',
      'files=sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []',
      'for p in files:',
      ' b=p.read_bytes()',
      ' print(json.dumps({"path":str(p),"sha256":"sha256:"+hashlib.sha256(b).hexdigest(),"size":len(b),"media":mimetypes.guess_type(str(p))[0] or "application/octet-stream"}))',
    ].join('\n');
    const result = await this.#docker.run([
      'exec',
      '--user',
      '10001:10001',
      '--workdir',
      '/workspace',
      this.#containerName,
      'python3',
      '-c',
      script,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`artifact inspection failed: ${result.stderr.trim()}`);
    }
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line): ArtifactManifest => {
        const item = JSON.parse(line) as {
          path: string;
          sha256: string;
          size: number;
          media: string;
        };
        return {
          artifactId: randomUUID(),
          kind: 'other',
          path: item.path,
          sha256: item.sha256,
          sizeBytes: item.size,
          createdAt: this.#now().toISOString(),
        };
      });
  }

  async close(input: CloseHarnessRun): Promise<void> {
    const session = this.#sessions.get(input.sessionId);
    if (session === undefined) return;
    session.controller?.abort('session closed');
    session.closed = true;
  }

  async #complete(messages: readonly ChatMessage[], signal: AbortSignal): Promise<ChatCompletion> {
    const response = await fetch(`${this.#provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#provider.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.#provider.model,
        messages,
        tools: [SHELL_TOOL],
        tool_choice: 'auto',
        temperature: 0.1,
      }),
      signal,
    });
    const body = (await response.json()) as ChatCompletion;
    if (!response.ok) {
      throw new Error(`model provider returned ${String(response.status)}: ${body.error?.message ?? 'request failed'}`);
    }
    return body;
  }

  #requireSession(sessionId: string): StoredSession {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) throw new Error(`unknown session ${sessionId}`);
    return session;
  }
}

function parseShellCommand(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('shell tool arguments were not valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { command?: unknown }).command !== 'string' ||
    (parsed as { command: string }).command.trim() === ''
  ) {
    throw new Error('shell tool requires a non-empty command');
  }
  return (parsed as { command: string }).command;
}

function truncateToolOutput(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return value;
  return `${bytes.subarray(0, maxBytes).toString('utf8')}\n[output truncated by FRANK]`;
}

function completionCostUsd(completion: ChatCompletion, provider: ProviderConfig): number {
  const input = completion.usage?.prompt_tokens ?? 0;
  const output = completion.usage?.completion_tokens ?? 0;
  return (
    (input * (provider.inputUsdPerMillion ?? 0) +
      output * (provider.outputUsdPerMillion ?? 0)) /
    1_000_000
  );
}
