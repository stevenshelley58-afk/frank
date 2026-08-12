import { describe, expect, it, vi } from 'vitest';
import type { AgentHarnessAdapter } from '@frank/contracts';
import type { FrankDatabase } from '@frank/adapter-postgres';
import { buildTestServer } from '../test/harness.js';
import type { ChatTurnRunner } from '../routes/chat-turns.js';
import { DurableChatTurnRunner, planProviderAttempts } from './chat-turn-runner.js';
import { chatTurnRuntimeConfig } from './chat-turn-config.js';

const conversationId = '10000000-0000-4000-8000-000000000001';
const turnId = '20000000-0000-4000-8000-000000000002';
const at = '2026-08-12T00:00:00.000Z';
const input = { conversation_id: conversationId, idempotency_key: 'turn-key', content: [{ type: 'text' as const, text: 'hello' }], attachment_ids: [], requested_capability: 'Deep' as const };

function runner(available = true): ChatTurnRunner {
  return { available: () => available, dispatch: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined), recover: vi.fn(async () => undefined), shutdown: vi.fn(async () => undefined) };
}

function queuedDatabase(executeRows: unknown[][], transactionRows: unknown[][] = []): FrankDatabase {
  const execute = vi.fn(async (_query: unknown) => ({ rows: executeRows.shift() ?? [] }));
  const transaction = vi.fn(async (callback: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => callback({ execute: async (_query: unknown) => ({ rows: transactionRows.shift() ?? [] }) }));
  return { execute, transaction } as unknown as FrankDatabase;
}

describe('chat turn route behavior', () => {
  it('returns 503 before persistence when no execution runner is available', async () => {
    const server = buildTestServer({ db: queuedDatabase([]) });
    const response = await server.app.inject({ method: 'POST', url: '/v1/chat/turns', headers: { authorization: server.auth(), 'idempotency-key': 'turn-key' }, payload: input });
    expect(response.statusCode).toBe(503);
    await server.close();
  });

  it('rejects disagreeing idempotency keys before dispatch', async () => {
    const liveRunner = runner();
    const server = buildTestServer({ db: queuedDatabase([]), chatTurnRunner: liveRunner });
    const response = await server.app.inject({ method: 'POST', url: '/v1/chat/turns', headers: { authorization: server.auth(), 'idempotency-key': 'different' }, payload: input });
    expect(response.statusCode).toBe(409);
    expect(liveRunner.dispatch).not.toHaveBeenCalled();
    await server.close();
  });

  it('resumes terminal SSE from Last-Event-ID and emits durable cursor ids', async () => {
    const turn = { id: turnId, cell_id: 'cell-steven', conversation_id: conversationId, state: 'completed', request_hash: 'a'.repeat(64), input, created_at: at, updated_at: at, finished_at: at, cancelled_at: null };
    const event = { turn_id: turnId, cursor: 4, kind: 'terminal', payload: { state: 'completed' }, created_at: at };
    const server = buildTestServer({ db: queuedDatabase([[turn], [event], [turn], [], [turn]]), chatTurnRunner: runner(), chatTurnPollIntervalMs: 1 });
    const response = await server.app.inject({ method: 'GET', url: `/v1/chat/turns/${turnId}/events?after_cursor=0`, headers: { authorization: server.auth(), 'last-event-id': '3' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('id: 4');
    expect(response.body).toContain('event: terminal');
    await server.close();
  });

  it('cancels through the runner and persists a terminal receipt before responding', async () => {
    const running = { id: turnId, cell_id: 'cell-steven', conversation_id: conversationId, state: 'running', request_hash: 'a'.repeat(64), input, created_at: at, updated_at: at, finished_at: null, cancelled_at: null };
    const cancelled = { ...running, state: 'cancelled', finished_at: at, cancelled_at: at };
    const liveRunner = runner();
    const db = queuedDatabase([[running], [cancelled]], [[{ id: turnId }], [{ attempt: 1, harness_id: 'goose', upstream: 'openai-direct', outcome: 'selected', created_at: at }], [], [], [], [], [], [], []]);
    const server = buildTestServer({ db, chatTurnRunner: liveRunner });
    const response = await server.app.inject({ method: 'POST', url: `/v1/chat/turns/${turnId}/cancel`, headers: { authorization: server.auth(), 'idempotency-key': 'cancel-key' }, payload: { idempotency_key: 'cancel-key' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe('cancelled');
    expect(liveRunner.cancel).toHaveBeenCalledWith(turnId);
    expect((db.transaction as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    await server.close();
  });
});

describe('provider routing and lifecycle behavior', () => {
  const aliases = {
    'openai-direct': { provider: 'openai', model: 'gpt', upstream: 'openai-direct' },
    'gemini-direct': { provider: 'google', model: 'gemini', upstream: 'gemini-direct' },
    concentrate: { provider: 'openai', model: 'concentrate', upstream: 'concentrate-litellm', baseUrl: 'https://litellm.invalid' },
  };

  it('honors Deep/Vision preference, explicit aliases, and Concentrate fallback ordering', () => {
    expect(planProviderAttempts({ requested_capability: 'Deep' }, aliases).map((attempt) => attempt.upstream)).toEqual(['openai-direct', 'gemini-direct', 'concentrate-litellm']);
    expect(planProviderAttempts({ requested_capability: 'Vision' }, aliases).map((attempt) => attempt.upstream)).toEqual(['gemini-direct', 'openai-direct', 'concentrate-litellm']);
    expect(planProviderAttempts({ requested_capability: 'Auto', requested_model_alias: 'gemini-direct' }, aliases).map((attempt) => attempt.upstream)).toEqual(['gemini-direct', 'concentrate-litellm']);
  });

  it('builds direct provider routes and a LiteLLM Concentrate fallback from composition env', () => {
    const config = chatTurnRuntimeConfig({ GOOSE_ACP_URL: 'wss://goose.example/acp', OPENAI_API_KEY: 'openai', GEMINI_API_KEY: 'gemini', FRANK_LITELLM_BASE_URL: 'https://litellm.example/v1', FRANK_LITELLM_VIRTUAL_KEY: 'virtual' });
    expect(config?.aliases['openai-direct']).toMatchObject({ provider: 'openai' });
    expect(config?.aliases['gemini-direct']).toMatchObject({ provider: 'google' });
    expect(config?.aliases.concentrate).toMatchObject({ upstream: 'concentrate-litellm', baseUrl: 'https://litellm.example/v1' });
  });

  it('deduplicates active dispatch and drains/cancels it before making running rows recoverable', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = {
      descriptor: async () => ({ id: 'goose', label: 'Goose', blurb: '', version: '1', acp: { supported: true, versions: ['1'] }, toolProtocols: [], supportedModels: ['gpt'], subscriptionAuth: false, contextLimits: {}, budgetReporting: false, workspaceModes: ['shared'], cleanupGuarantee: 'best-effort', osRequirements: [], resumeGuarantee: 'none', checkpointPortability: 'native-only', eventReplay: 'none', cancellationStrength: 'cooperative', maxDataClass: 'private' }),
      health: async () => ({ healthy: true, checkedAt: at }), capacity: async () => ({ maxConcurrentSessions: 1, activeSessions: 0, accepting: true }),
      start: vi.fn(async () => ({ id: 'session', nativeSessionId: 'native', harness: 'goose', runId: turnId, createdAt: at, resumed: false })),
      async *prompt() { await gate; }, cancel: vi.fn(async () => { release(); }), close: vi.fn(async () => undefined),
    } as unknown as AgentHarnessAdapter;
    let transaction = 0;
    const db = queuedDatabase([[], [], []]);
    db.transaction = vi.fn(async (callback: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
      transaction += 1;
      const rows = transaction === 1 ? [[{ id: turnId, cell_id: 'cell-steven', conversation_id: conversationId, input, state: 'running' }], [], [], [], []] : [[{ state: 'running' }], [], [], [], [], [], [], [], []];
      return callback({ execute: async (_query: unknown) => ({ rows: rows.shift() ?? [] }) });
    }) as typeof db.transaction;
    const durable = new DurableChatTurnRunner({ db, adapters: [adapter], modelAliases: aliases, workspacePath: '/workspace', now: () => new Date(at) });
    const first = durable.dispatch(turnId);
    const second = durable.dispatch(turnId);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(adapter.start).toHaveBeenCalledOnce());
    await durable.shutdown(100);
    await first;
    expect(adapter.cancel).toHaveBeenCalledOnce();
    expect(durable.available()).toBe(false);
  });
});
