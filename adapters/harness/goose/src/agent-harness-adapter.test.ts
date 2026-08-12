import { describe, expect, it, vi } from 'vitest';
import type { GooseAdapter } from './goose-adapter.js';
import { GooseAgentHarnessAdapter } from './agent-harness-adapter.js';

describe('GooseAgentHarnessAdapter', () => {
  it('bridges start, streamed events, and cancellation without inventing provider usage', async () => {
    const handle = { id: 'session-1', harness: 'Goose', roomId: 'turn-1', createdAt: '2026-08-12T00:00:00.000Z' };
    const legacy = {
      listProviders: vi.fn(async () => [{ id: 'model', provider: 'provider', model: 'model', type: 'api_key', status: 'active', harness: ['Goose'] }]),
      status: vi.fn(async () => ({ healthy: true, version: '1.45.0', sessions: 0 })),
      startSession: vi.fn(async () => handle),
      async *sendMessage() { yield { type: 'text' as const, content: 'hello' }; yield { type: 'done' as const, content: '' }; },
      stopSession: vi.fn(async () => undefined),
    } as unknown as GooseAdapter;
    const adapter = new GooseAgentHarnessAdapter(legacy, { provider: 'provider', model: 'model' });

    expect((await adapter.descriptor()).budgetReporting).toBe(false);
    const session = await adapter.start({ runId: 'turn-1', cellId: 'cell', workspacePath: '/workspace', contextPack: {} as never, systemPrompt: 'system', now: '2026-08-12T00:00:00.000Z' });
    const events = [];
    for await (const event of adapter.prompt({ sessionId: session.id, content: 'prompt' })) events.push(event);
    expect(events).toEqual([{ type: 'text', content: 'hello' }, { type: 'done' }]);
    const usage = await adapter.usage('1h');
    expect(usage).toMatchObject({ totalTurns: 1 });
    expect(usage).not.toHaveProperty('estimatedCostUsd');
    await adapter.cancel({ sessionId: session.id, reason: 'stop', now: '2026-08-12T00:00:01.000Z' });
    expect(legacy.stopSession).toHaveBeenCalledWith(handle);
  });
});
