import { describe, expect, it } from 'vitest';
import type { ApiFetch } from './api';
import { parseToolEventPayload, submitChatTurn, type ChatTurnStreamEvent } from './chat-api';

const CONVERSATION = '11111111-1111-4111-8111-111111111111';

const turnInput = {
  conversation_id: CONVERSATION,
  idempotency_key: 'turn-1',
  profile: 'hub',
  session_key: CONVERSATION,
  message: 'Review this',
};

function sseResponse(blocks: string, chunkSizes?: number[]): Response {
  const bytes = new TextEncoder().encode(blocks);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!chunkSizes) {
        controller.enqueue(bytes);
      } else {
        let offset = 0;
        for (const size of chunkSizes) {
          controller.enqueue(bytes.slice(offset, offset + size));
          offset += size;
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const W2_1_STREAM =
  'event: turn\n' +
  `data: {"turn_id":"22222222-2222-4222-8222-222222222222","state":"running","created_at":"2026-08-13T00:00:00.000Z","updated_at":"2026-08-13T00:00:00.000Z","finished_at":null,"cancelled_at":null}\n\n` +
  'event: text\n' +
  'data: {"content":"Hello"}\n\n' +
  'event: text\n' +
  'data: {"content":" world"}\n\n' +
  'event: tool\n' +
  'data: {"content":"{\\"name\\":\\"web_search\\",\\"call_id\\":\\"call_1\\",\\"arguments\\":{\\"query\\":\\"x\\"}}"}\n\n' +
  'event: done\n' +
  'data: {"content":""}\n\n';

describe('submitChatTurn (W2-1 SSE)', () => {
  it('consumes turn/text/tool/done events and resolves the turn view', async () => {
    const api: ApiFetch = async () => sseResponse(W2_1_STREAM);
    const seen: ChatTurnStreamEvent[] = [];
    const turn = await submitChatTurn(api, turnInput, { onEvent: (event) => seen.push(event) });

    expect(turn.turn_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(seen.map((event) => event.type)).toEqual(['turn', 'text', 'text', 'tool', 'done']);
    expect((seen[1].data as { content: string }).content).toBe('Hello');
    expect((seen[2].data as { content: string }).content).toBe(' world');
    expect((seen[3].data as { content: string }).content).toBe(
      '{"name":"web_search","call_id":"call_1","arguments":{"query":"x"}}',
    );
  });

  it('handles SSE blocks split across chunk boundaries', async () => {
    const size = 9;
    const length = new TextEncoder().encode(W2_1_STREAM).length;
    const chunkSizes = Array.from({ length: Math.ceil(length / size) }, (_, i) =>
      Math.min(size, length - i * size),
    ).filter((n) => n > 0);
    const api: ApiFetch = async () => sseResponse(W2_1_STREAM, chunkSizes);
    const seen: ChatTurnStreamEvent[] = [];
    await submitChatTurn(api, turnInput, { onEvent: (event) => seen.push(event) });
    expect(seen.map((event) => event.type)).toEqual(['turn', 'text', 'text', 'tool', 'done']);
  });

  it('surfaces an error event before the turn event as a rejection', async () => {
    const api: ApiFetch = async () =>
      sseResponse('event: error\ndata: {"content":"service unavailable"}\n\n');
    await expect(submitChatTurn(api, turnInput)).rejects.toThrow(/before the turn event/);
  });
});

describe('parseToolEventPayload', () => {
  it('parses the W2-1 tool envelope', () => {
    const tool = parseToolEventPayload('{"name":"web_search","call_id":"call_1","arguments":{"query":"x"}}');
    expect(tool).toEqual({ name: 'web_search', call_id: 'call_1', arguments: { query: 'x' } });
  });

  it('returns null for malformed envelopes', () => {
    expect(parseToolEventPayload('not json')).toBeNull();
    expect(parseToolEventPayload('{"name":"only_name"}')).toBeNull();
  });
});
