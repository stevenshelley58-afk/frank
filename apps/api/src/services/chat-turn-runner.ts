import { createHash, randomUUID } from 'node:crypto';
import type { AgentHarnessAdapter, ChatTurnInput, ContextPack, HarnessEvent, FallbackAttempt, TurnReceipt } from '@frank/contracts';
import { HarnessBroker } from '@frank/kernel/harness-broker';
import type { FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';
import type { ChatTurnRunner } from '../routes/chat-turns.js';

export interface ModelAlias { readonly provider: string; readonly model: string }
export interface DurableChatTurnRunnerOptions {
  readonly db: FrankDatabase;
  readonly adapters: readonly AgentHarnessAdapter[];
  readonly modelAliases?: Readonly<Record<string, ModelAlias>>;
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

  constructor(readonly options: DurableChatTurnRunnerOptions) {
    this.#adapters = options.adapters;
    this.#broker = new HarnessBroker(options.adapters);
    this.#aliases = options.modelAliases ?? {};
    this.#now = options.now ?? (() => new Date());
  }

  async dispatch(turnId: string): Promise<void> {
    const turn = await this.claim(turnId);
    if (!turn) return;
    const attempts: FallbackAttempt[] = [];
    let terminalError: unknown;
    try {
      const selection = await this.#broker.select({ taskType: 'general', requiredToolProtocols: [], dataClass: 'private', needsReviewDiversity: false, preferredWorkspaceMode: 'shared' }, turn.input.route_profile ?? 'auto');
      const candidates = selection.candidates.length ? selection.candidates.map((candidate: { descriptor: { id: string } }) => candidate.descriptor.id) : [selection.harnessId];
      for (const harnessId of [...new Set([selection.harnessId, ...candidates])]) {
        const adapter = await this.findAdapter(harnessId);
        if (!adapter) continue;
        const attempt = attempts.length + 1;
        const startedAt = this.#now().toISOString();
        await this.recordAttempt(turn, attempt, harnessId, 'selected');
        attempts.push({ attempt, harness: harnessId, outcome: 'selected', at: startedAt });
        try {
          await this.execute(turn, adapter, harnessId, attempts);
          await this.recordAttempt(turn, attempt, harnessId, 'succeeded');
          attempts[attempts.length - 1] = { attempt, harness: harnessId, outcome: 'succeeded', at: startedAt };
          return;
        } catch (error) {
          terminalError = error;
          const reason = error instanceof Error ? error.message.slice(0, 500) : 'Harness execution failed.';
          await this.recordAttempt(turn, attempt, harnessId, 'failed');
          attempts[attempts.length - 1] = { attempt, harness: harnessId, outcome: 'failed', reason, at: startedAt };
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
      await this.appendEvent(tx, turn, 'text', { text: 'running' });
      return turn;
    });
  }

  private async execute(turn: TurnRecord, adapter: AgentHarnessAdapter, selectedHarness: string, attempts: FallbackAttempt[]): Promise<void> {
    const alias = turn.input.requested_model_alias ? this.#aliases[turn.input.requested_model_alias] : undefined;
    if (turn.input.requested_model_alias && !alias) throw new Error(`Unknown model alias ${turn.input.requested_model_alias}.`);
    const prompt = turn.input.content.map((part) => part.type === 'text' ? part.text ?? '' : `[${part.type} attachment ${part.attachment_id ?? 'missing'}]`).join('\n');
    const contextHash = sha256(JSON.stringify({ turn: turn.id, conversation: turn.conversation_id, attachments: turn.input.attachment_ids }));
    const pack = contextPack(turn, prompt, contextHash, this.#now());
    const session = await adapter.start({ runId: turn.id, cellId: turn.cell_id, workspacePath: this.options.workspacePath, contextPack: pack, systemPrompt: 'You are Frank. Answer the user request within the supplied conversation and attachment references. Never claim an action or cost without evidence.', ...(alias ? { provider: alias } : {}), now: this.#now().toISOString() });
    this.#sessions.set(turn.id, { adapter, sessionId: session.id });
    let response = '';
    let reportedModel: string | undefined;
    let usage = { input_tokens: 0, output_tokens: 0 };
    try {
      for await (const event of adapter.prompt({ sessionId: session.id, content: prompt, stream: true })) {
        if (await this.cancelled(turn.id)) return;
        const normalized = normalizeEvent(event);
        if (normalized) await this.appendEvent(this.options.db, turn, normalized.kind, normalized.payload);
        if (event.type === 'text') response += event.content;
        if (event.type === 'done' && event.usage) { usage = { input_tokens: event.usage.tokensIn, output_tokens: event.usage.tokensOut }; reportedModel = event.usage.model; }
        if (event.type === 'error') throw new Error(event.content);
      }
      const attachmentHashes = await this.attachmentHashes(turn);
      const completedAttempt = attempts.at(-1);
      if (completedAttempt) {
        attempts[attempts.length - 1] = { ...completedAttempt, outcome: 'succeeded' };
        await this.recordAttempt(turn, completedAttempt.attempt, completedAttempt.harness, 'succeeded');
      }
      const receipt: TurnReceipt = {
        turn_id: turn.id, state: 'completed', completed_at: this.#now().toISOString(),
        ...(turn.input.requested_model_alias ? { requested_model: turn.input.requested_model_alias } : {}),
        ...(alias ? { selected_model: alias.model } : {}), ...(reportedModel ? { reported_model: reportedModel } : {}),
        harness: selectedHarness, usage,
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
      await this.appendEvent(tx, turn, 'receipt', { receipt_id: turn.id });
      await this.appendEvent(tx, turn, 'terminal', { state: 'completed' });
    });
  }

  private async fail(turn: TurnRecord, error: unknown, attempts: FallbackAttempt[]): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'No eligible harness completed the turn.';
    await this.options.db.transaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`update frank_domain.chat_turn set state='failed',finished_at=now(),updated_at=now() where id=${turn.id}::uuid and cell_id=${turn.cell_id} and state='running' returning id`);
      if (!updated.rows[0]) return;
      const receipt: TurnReceipt = { turn_id: turn.id, state: 'failed', completed_at: this.#now().toISOString(), harness: attempts.at(-1)?.harness ?? 'unavailable', usage: { input_tokens: 0, output_tokens: 0 }, cost: { confidence: 'unavailable', source: 'unavailable' }, request_ids: [], policy: { decision: 'chat.write authorized', result: 'allowed' }, fallback_chain: attempts, context_hash: sha256(JSON.stringify(turn.input)), attachment_hashes: await this.attachmentHashes(turn) };
      await tx.execute(sql`insert into frank_domain.chat_turn_receipt(turn_id,cell_id,receipt) values (${turn.id}::uuid,${turn.cell_id},${JSON.stringify(receipt)}::jsonb) on conflict(turn_id) do nothing`);
      await this.appendEvent(tx, turn, 'error', { code: 'harness_failed', message, retryable: false });
      await this.appendEvent(tx, turn, 'terminal', { state: 'failed' });
    });
  }

  private async appendEvent(db: Pick<FrankDatabase, 'execute'>, turn: Pick<TurnRecord, 'id' | 'cell_id'>, kind: string, payload: Record<string, unknown>): Promise<void> {
    await db.execute(sql`insert into frank_domain.chat_turn_event(turn_id,cell_id,cursor,kind,payload) select ${turn.id}::uuid,${turn.cell_id},coalesce(max(cursor)+1,0),${kind},${JSON.stringify(payload)}::jsonb from frank_domain.chat_turn_event where turn_id=${turn.id}::uuid`);
  }

  private async recordAttempt(turn: TurnRecord, attempt: number, harness: string, outcome: string): Promise<void> {
    await this.options.db.execute(sql`insert into frank_domain.harness_fallback_attempt(id,cell_id,turn_id,attempt,harness_id,outcome) values (${randomUUID()}::uuid,${turn.cell_id},${turn.id}::uuid,${attempt},${harness},${outcome}) on conflict(turn_id,attempt) do update set outcome=excluded.outcome`);
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
