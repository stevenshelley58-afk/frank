import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDeepseekSession,
  deepseekReportedModel,
  streamDeepseekMessage,
} from './deepseek-server';

const originalKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
  vi.unstubAllGlobals();
});

describe('DeepSeek streamed model metadata', () => {
  it('records only the model confirmed in a provider stream frame', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-only';
    const firstBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"model":"deepseek-reasoner","choices":[{"delta":{"content":"hello"}}]}\n\n',
        ));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const secondBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"again"}}]}\n\n',
        ));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(firstBody, { status: 200 }))
      .mockResolvedValueOnce(new Response(secondBody, { status: 200 })));

    const sessionId = await createDeepseekSession();
    const chunks: string[] = [];
    for await (const chunk of streamDeepseekMessage(sessionId, 'hi', { model: 'deepseek-chat' })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['hello']);
    expect(deepseekReportedModel(sessionId)).toBe('deepseek-reasoner');

    for await (const _chunk of streamDeepseekMessage(sessionId, 'again', { model: 'deepseek-chat' })) {
      // Consume the second response; it intentionally omits its model field.
    }
    expect(deepseekReportedModel(sessionId)).toBeNull();
  });
});
