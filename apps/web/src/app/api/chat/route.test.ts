import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/harness-session', () => ({
  runTurn: vi.fn(),
  dropSession: vi.fn(),
}));
vi.mock('@/lib/providers', () => ({
  ModelSelectionError: class ModelSelectionError extends Error {},
  resolveHarness: vi.fn(),
}));
vi.mock('@/lib/memory-server', () => ({
  getMemory: () => ({ store: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/lib/memory-scope', () => ({
  deploymentScope: () => ({ cellId: 'test-cell', ownerId: 'test-owner' }),
  memoryScope: ({ roomId }: { roomId: string }) => ({ cellId: 'test-cell', ownerId: 'test-owner', roomId }),
}));
vi.mock('@/lib/kernel', () => ({
  PACK_KEY_HANDLE: 'test-key',
  PACK_SIGNER_ID: 'test-signer',
  getAssembler: () => ({
    assemble: vi.fn().mockResolvedValue({ memory: { recalled: [] }, integrity: { contentHash: 'test-pack' } }),
  }),
}));

import { POST } from './route';
import { runTurn } from '@/lib/harness-session';

function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request('https://frank.fail/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://frank.fail', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat input boundary', () => {
  it('rejects a cross-origin browser mutation before parsing or invoking a harness', async () => {
    const response = await POST(request(
      { message: 'hello' },
      { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    ) as never);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'same_origin_required' });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('rejects a room outside the canonical server registry', async () => {
    const response = await POST(request({ message: 'hello', roomId: 'fabricated-room' }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown_room' });
  });

  it('bounds repeated turns from one client', async () => {
    const headers = { 'X-Real-IP': '203.0.113.77' };
    for (let i = 0; i < 12; i += 1) {
      const response = await POST(request({ message: 'hello', roomId: 'not-a-room' }, headers) as never);
      expect(response.status).toBe(400);
    }

    const blocked = await POST(request({ message: 'hello', roomId: 'not-a-room' }, headers) as never);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'chat_rate_limited' });
  });

  it('returns a stable safe SSE envelope when a harness fails', async () => {
    vi.mocked(runTurn).mockRejectedValueOnce(new Error('DeepSeek HTTP 500: upstream diagnostic'));

    const response = await POST(request({ message: 'hello', roomId: 'central' }) as never);
    expect(response.status).toBe(200);
    const data = await response.text();
    const event = JSON.parse(data.replace(/^data: /, '').trim()) as Record<string, unknown>;
    expect(event).toMatchObject({
      error: 'chat_turn_failed',
      message: 'The selected harness could not complete this turn.',
    });
    expect(event.correlationId).toEqual(expect.any(String));
    expect(data).not.toContain('upstream diagnostic');
  });
});
