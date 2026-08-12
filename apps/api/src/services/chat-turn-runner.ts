import { createHash, randomUUID } from 'node:crypto';
import type { AgentHarnessAdapter, ChatTurnInput, ContextPack, HarnessEvent, FallbackAttempt, TurnReceipt } from '@frank/contracts';
import { HarnessBroker } from '@frank/kernel/harness-broker';
import type { FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';
import type { ChatTurnRunner } from '../routes/chat-turns.js';
import { appendChatTurnEvent } from './chat-turn-events.js';

export interface ModelAlias { readonly provider: string; readonly model: string; readonly upstream?: string; readonly apiKey?: string; readonly baseUrl?: string }
export interface DurableChatTurnRunnerOptions {
  readonly db: FrankDatabase;
  readonly adapters: readonly AgentHarnessAdapter[];
  readonly modelAliases?: Readonly<Record<string, ModelAlias>>;
  readonly capabilityRoutes?: Readonly<Record<'Auto' | 'Deep' | 'Vision' | 'Image', readonly string[]>>;
  readonly workspacePath: string;
  readonly now?: () => Date;
}

type TurnRecord = { id: string; cell_id: string; conversation_id: string; input: ChatTurnInput; state: string };

/** Executes persisted turns through the kernel broker and records exact evidence. */
export class DurableChatTurnRunner implements ChatTurnRunner {
  readonly #broker: HarnessBroker;
  readonly #adapters: readonly AgentHarnessAdapter[];
  readonly #sessions = new Map<string, { adapter: AgentHarnessAdapter; sessionId: string }>();
  readonly #aliases: Readonly<Record<string, ModelAlias>>;
  readonly #now: () => Date;
  readonly #active = new Map<string, Promise<void>>();
  #closing = false;

  constructor(readonly options: DurableChatTurnRunnerOptions) {
    this.#adapters = options.adapters;
    this.#broker = new HarnessBroker(options.adapters);
    this.#aliases = options.modelAliases ?? {};
    this.#now = options.now ?? (() => new Date());
  }

  available(): boolean { return !this.#closing && this.#adapters.length > 0; }

  dispatch(turnId: string): Promise<void> {
    if (!this.available()) return Promise.reject(new Error('Chat runner is unavailable.'));
    const existing = this.#active.get(turnId);
    if (existing) return existing;
    const task = this.runDispatch(turnId).finally(() => this.#active.delete(turnId));
    this.#active.set(turnId, task);
    return task;
  }

  async recover(): Promise<void> {
    await this.options.db.execute(sql`update frank_domain.chat_turn set state='queued',updated_at=now() where state='running'`);
    const queued = await this.options.db.execute<{ id: string }>(sql`select id from frank_domain.chat_turn where state='queued' order by created_at`);
    for (const row of queued.rows) void this.dispatch(row.id).catch(() => undefined);
  }

  async shutdown(timeoutMs = 15_000): Promise<void> {
    this.#closing = true;
    await Promise.race([Promise.allSettled([...this.#sessions].map(([turnId]) => this.cancel(turnId))), delay(Math.floor(timeoutMs / 2))]);
    await Promise.race([Promise.allSettled([...this.#active.values()]), delay(Math.ceil(timeoutMs / 2))]);
    await this.options.db.execute(sql`update frank_domain.chat_turn set state='queued',updated_at=now() where state='running'`);
  }

  private async runDispatch(turnId: string): Promise<void> {
    const turn = await this.claim(turnId);
    if (!turn) return;
    const attempts: FallbackAttempt[] = [];
    let terminalError: unknown;
    try {
      const selection = await this.#broker.select({ taskType: 'general', requiredToolProtocols: [], dataClass: 'private', needsReviewDiversity: false, preferredWorkspaceMode: 'shared' }, turn.input.route_profile ?? 'auto');
      const adapter = await this.findAdapter(selection.harnessId);
      if (!adapter) throw new Error(`Selected harness ${selection.harnessId} is unavailable.`);
      const routes = planProviderAttempts(turn.input, this.#aliases, this.options.capabilityRoutes);
      for (const route of routes) {
        const harnessId = selection.harnessId;
        const attempt = attempts.length + 1;
        const startedAt = this.#now().toISOString();
        await this.recordAttempt(turn, attempt, harnessId, route.upstream, 'selected');
        attempts.push({ attempt, harness: harnessId, upstream: route.upstream, outcome: 'selected', at: startedAt });
        try {
          await this.execute(turn, adapter, harnessId, route, attempts);
          return;
        } catch (error) {
          terminalError = error;
          const reason = error instanceof Error ? error.message.slice(0, 500) : 'Harness execution failed.';
          await this.recordAttempt(turn, attempt, harnessId, route.upstream, 'failed');
          attempts[attempts.length - 1] = { attempt, harness: harnessId, upstream: route.upstream, outcome: 'failed', reason, at: startedAt };
        }
      }
    } catch (error) {
      terminalError = error;
    }
    await this.fail(turn, terminalError, attempts);
  }

  async cancel(turnId: string): Promise<void> {
    const active = this.#sessions.get(turnId);
    if (!active) return;
    await active.adapter.cancel({ sessionId: active.sessionId, reason: 'Cancelled by the conversation owner.', now: this.#now().toISOString() });
    this.#sessions.delete(turnId);
  }

  private async claim(turnId: string): Promise<TurnRecord | undefined> {
    return this.options.db.transaction(async (tx) => {
      const updated = await tx.execute<TurnRecord>(sql`update frank_domain.chat_turn set state='running',updated_at=now() where id=${turnId}::uuid and state='queued' returning id,cell_id,conversation_id,input,state`);
      const turn = updated.rows[0];
      if (!turn) return undefined;
      const text = turn.input.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n');
      const messageId = randomUUID();
      await tx.execute(sql`insert into frank_domain.chat_message(id,cell_id,conversation_id,kind,body,meta) values (${messageId}::uuid,${turn.cell_id},${turn.conversation_id}::uuid,'user',${text},${JSON.stringify({ attachment_ids: turn.input.attachment_ids })}::jsonb)`);
      await tx.execute(sql`update frank_domain.chat_turn set user_message_id=${messageId}::uuid where id=${turn.id}::uuid and cell_id=${turn.cell_id}`);
      await appendChatTurnEvent(tx, turn, 'text', { text: 'running' });
      return turn;
    });
  }

  private async execute(turn: TurnRecord, adapter: AgentHarnessAdapter, selectedHarness: string, route: ModelAlias & { upstream: string }, attempts: FallbackAttempt[]): Promise<void> {
    const prompt = turn.input.content.map((part) => part.type === 'text' ? part.text ?? '' : `[${part.type} attachment ${part.attachment_id ?? 'missing'}]`).join('\n');
    const contextHash = sha256(JSON.stringify({ turn: turn.id, conversation: turn.conversation_id, attachments: turn.input.attachment_ids }));
    const pack = contextPack(turn, prompt, contextHash, this.#now());
    const provider = { provider: route.provider, model: route.model, ...(route.apiKey ? { apiKey: route.apiKey } : {}), ...(route.baseUrl ? { baseUrl: route.baseUrl } : {}) };
    const session = await adapter.start({ runId: turn.id, cellId: turn.cell_id, workspacePath: this.options.workspacePath, contextPack: pack, systemPrompt: 'You are Frank. Answer the user request within the supplied conversation and attachment references. Never claim an action or cost without evidence.', provider, now: this.#now().toISOString() });
    this.#sessions.set(turn.id, { adapter, sessionId: session.id });
    let response = '';
    let reportedModel: string | undefined;
    let usage = { input_tokens: 0, output_tokens: 0 };
    try {
      for await (const event of adapter.prompt({ sessionId: session.id, content: prompt, stream: true })) {
        if (await this.cancelled(turn.id)) return;
        const normalized = normalizeEvent(event);
        if (normalized) await appendChatTurnEvent(this.options.db, turn, normalized.kind, normalized.payload);
        if (event.type === 'text') response += event.content;
        if (event.type === 'done' && event.usage) { usage = { input_tokens: event.usage.tokensIn, output_tokens: event.usage.tokensOut }; reportedModel = event.usage.model; }
        if (event.type === 'error') throw new Error(event.content);
      }
      const attachmentHashes = await this.attachmentHashes(turn);
      const completedAttempt = attempts.at(-1);
      if (completedAttempt) {
        attempts[attempts.length - 1] = { ...completedAttempt, outcome: 'succeeded' };
        await this.recordAttempt(turn, completedAttempt.attempt, completedAttempt.harness, route.upstream, 'succeeded');
      }
      const receipt: TurnReceipt = {
        turn_id: turn.id, state: 'completed', completed_at: this.#now().toISOString(),
        ...(turn.input.requested_model_alias ? { requested_model: turn.input.requested_model_alias } : {}),
        selected_model: route.model, ...(reportedModel ? { reported_model: reportedModel } : {}),
        harness: selectedHarness, upstream: route.upstream, usage,
        cost: { confidence: 'unavailable', source: 'unavailable' }, request_ids: [],
        policy: { decision: 'chat.write authorized', result: 'allowed' }, fallback_chain: attempts,
        context_hash: contextHash, attachment_hashes: attachmentHashes,
      };
      await this.complete(turn, response, receipt);
    } finally {
      this.#sessions.delete(turn.id);
      await adapter.close({ sessionId: session.id, runId: turn.id, cleanup: true, now: this.#now().toISOString() }, new Date(this.#now().getTime() + 30_000).toISOString()).catch(() => undefined);
    }
  }

  private async complete(turn: TurnRecord, response: string, receipt: TurnReceipt): Promise<void> {
    await this.options.db.transaction(async (tx) => {
      const locked = await tx.execute<{ state: string }>(sql`select state from frank_domain.chat_turn where id=${turn.id}::uuid and cell_id=${turn.cell_id} for update`);
      if (locked.rows[0]?.state !== 'running') return;
      const messageId = randomUUID();
      await tx.execute(sql`insert into frank_domain.chat_message(id,cell_id,conversation_id,kind,body,meta) values (${messageId}::uuid,${turn.cell_id},${turn.conversation_id}::uuid,'agent',${response},${JSON.stringify({ receipt: receipt.turn_id })}::jsonb)`);
      await tx.execute(sql`insert into frank_domain.chat_turn_receipt(turn_id,cell_id,receipt) values (${turn.id}::uuid,${turn.cell_id},${JSON.stringify(receipt)}::jsonb)`);
      await tx.execute(sql`update frank_domain.chat_turn set state='completed',assistant_message_id=${messageId}::uuid,finished_at=now(),updated_at=now() where id=${turn.id}::uuid and cell_id=${turn.cell_id}`);
      await tx.execute(sql`update frank_domain.chat_conversation set last_message_at=now(),updated_at=now() where id=${turn.conversation_id}::uuid and cell_id=${turn.cell_id}`);
      await appendChatTurnEvent(tx, turn, 'receipt', { receipt_id: turn.id });
      await appendChatTurnEvent(tx, turn, 'terminal', { state: 'completed' });
    });
  }

  private async fail(turn: TurnRecord, error: unknown, attempts: FallbackAttempt[]): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'No eligible harness completed the turn.';
    await this.options.db.transaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`update frank_domain.chat_turn set state='failed',finished_at=now(),updated_at=now() where id=${turn.id}::uuid and cell_id=${turn.cell_id} and state='running' returning id`);
      if (!updated.rows[0]) return;
      const receipt: TurnReceipt = { turn_id: turn.id, state: 'failed', completed_at: this.#now().toISOString(), harness: attempts.at(-1)?.harness ?? 'unavailable', usage: { input_tokens: 0, output_tokens: 0 }, cost: { confidence: 'unavailable', source: 'unavailable' }, request_ids: [], policy: { decision: 'chat.write authorized', result: 'allowed' }, fallback_chain: attempts, context_hash: sha256(JSON.stringify(turn.input)), attachment_hashes: await this.attachmentHashes(turn) };
      await tx.execute(sql`insert into frank_domain.chat_turn_receipt(turn_id,cell_id,receipt) values (${turn.id}::uuid,${turn.cell_id},${JSON.stringify(receipt)}::jsonb) on conflict(turn_id) do nothing`);
      await appendChatTurnEvent(tx, turn, 'error', { code: 'harness_failed', message, retryable: false });
      await appendChatTurnEvent(tx, turn, 'terminal', { state: 'failed' });
    });
  }

  private async recordAttempt(turn: TurnRecord, attempt: number, harness: string, upstream: string, outcome: string): Promise<void> {
    await this.options.db.execute(sql`insert into frank_domain.harness_fallback_attempt(id,cell_id,turn_id,attempt,harness_id,upstream,outcome) values (${randomUUID()}::uuid,${turn.cell_id},${turn.id}::uuid,${attempt},${harness},${upstream},${outcome}) on conflict(turn_id,attempt) do update set upstream=excluded.upstream,outcome=excluded.outcome`);
  }

  private async attachmentHashes(turn: TurnRecord): Promise<string[]> {
    if (!turn.input.attachment_ids.length) return [];
    const result = await this.options.db.execute<{ digest: string }>(sql`select digest from frank_domain.attachment where cell_id=${turn.cell_id} and turn_id=${turn.id}::uuid and digest is not null order by id`);
    return result.rows.map((row) => row.digest);
  }

  private async cancelled(turnId: string): Promise<boolean> {
    const result = await this.options.db.execute<{ state: string }>(sql`select state from frank_domain.chat_turn where id=${turnId}::uuid`);
    return result.rows[0]?.state === 'cancelled';
  }

  private async findAdapter(id: string): Promise<AgentHarnessAdapter | undefined> {
    for (const adapter of this.#adapters) if ((await adapter.descriptor()).id === id) return adapter;
    return undefined;
  }
}

function normalizeEvent(event: HarnessEvent): { kind: string; payload: Record<string, unknown> } | undefined {
  if (event.type === 'text') return { kind: 'text', payload: { text: event.content } };
  if (event.type === 'tool_call') return { kind: 'tool_call', payload: { tool_call_id: event.callId, name: event.toolName, arguments_json: JSON.stringify(event.toolArgs) } };
  if (event.type === 'tool_result') return { kind: 'tool_result', payload: { tool_call_id: event.callId, status: event.isError ? 'error' : 'success', summary: event.content } };
  if (event.type === 'error') return { kind: 'error', payload: { code: event.code ?? 'harness_error', message: event.content, retryable: false } };
  if (event.type === 'done' && event.usage) return { kind: 'usage', payload: { input_tokens: event.usage.tokensIn, output_tokens: event.usage.tokensOut } };
  return undefined;
}

function contextPack(turn: TurnRecord, prompt: string, hash: string, now: Date): ContextPack {
  const at = now.toISOString();
  return { schema: 'frank.context-pack/v1', packId: turn.id, assignmentId: turn.id, cellId: turn.cell_id, createdAt: at, goal: prompt, definitionOfDone: ['Answer the submitted chat turn.'], requirements: [], sources: [], constraints: ['Do not infer raw attachment bytes; use durable references only.'], allowedTools: [], credentials: [], classification: 'private', egress: 'frank-internal-only', budget: { maxSpend: 0, currency: 'USD', deadline: new Date(now.getTime() + 300_000).toISOString(), maxRetries: 0 }, expectedOutputs: ['chat response'], evidenceSchemaRef: 'schema://frank.chat-turn/v1', escalation: { escalateWhen: ['Required evidence is unavailable.'], doNotAssume: ['Model identity, spend, or attachment contents.'] }, memory: { recalled: [], recallQuery: '', backend: 'none' }, integrity: { contentHash: hash, signerId: 'frank.api/service', signature: 'unsigned-runtime-context', signedAt: at } };
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export function planProviderAttempts(
  input: Pick<ChatTurnInput, 'requested_model_alias' | 'requested_capability'>,
  aliases: Readonly<Record<string, ModelAlias>>,
  configured?: Readonly<Record<'Auto' | 'Deep' | 'Vision' | 'Image', readonly string[]>>,
): Array<ModelAlias & { upstream: string }> {
  const capability = input.requested_capability ?? 'Auto';
  const defaults: Record<typeof capability, readonly string[]> = {
    Auto: ['openai-direct', 'gemini-direct', 'configured', 'concentrate'],
    Deep: ['openai-direct', 'gemini-direct', 'configured', 'concentrate'],
    Vision: ['gemini-direct', 'openai-direct', 'configured', 'concentrate'],
    Image: ['gemini-direct', 'openai-direct', 'configured', 'concentrate'],
  };
  const explicitAlias = input.requested_model_alias && input.requested_model_alias !== 'auto' ? input.requested_model_alias : undefined;
  const names = explicitAlias
    ? [explicitAlias, 'concentrate']
    : [...(configured?.[capability] ?? defaults[capability])];
  const unique = [...new Set(names)];
  if (explicitAlias && !aliases[explicitAlias]) throw new Error(`Unknown model alias ${explicitAlias}.`);
  const attempts = unique.flatMap((name) => {
    const target = aliases[name];
    return target ? [{ ...target, upstream: target.upstream ?? name }] : [];
  });
  if (!attempts.length) throw new Error(`No provider route is configured for ${capability}.`);
  return attempts;
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
