import { describe, expect, it, vi } from 'vitest';
import { frankStream } from './frank';

/** Build a fake SSE response body from raw `data:` lines. */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function callbacks() {
  return {
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

describe('frankStream done/error guards (Bug 1 regressions)', () => {
  it('calls onDone exactly once when the stream contains a done event and then ends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['{"text":"hi"}', '{"done":true}'])),
    );
    const cb = callbacks();
    await frankStream('hello', 'central', cb);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(cb.onChunk).toHaveBeenCalledWith('hi');
    vi.unstubAllGlobals();
  });

  it('onError is not called after onDone has fired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse(['{"done":true}', '{"error":"late failure"}']),
      ),
    );
    const cb = callbacks();
    await frankStream('hello', 'central', cb);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('surfaces a server error event via onError when no done preceded it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['{"error":"boom"}'])),
    );
    const cb = callbacks();
    await frankStream('hello', 'central', cb);
    expect(cb.onError).toHaveBeenCalledWith('boom');
    expect(cb.onDone).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
