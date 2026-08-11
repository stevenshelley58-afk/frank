import { describe, expect, it, vi } from 'vitest';
import { frankStream, StreamAbortedError, turnInfoToMessageMeta } from './frank';

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

  it('sends the selected model and exposes execution metadata from the done frame', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      '{"done":true,"requestedModel":"deepseek-reasoner","model":"deepseek-reasoner","modelProvider":"deepseek","expectedModel":"deepseek-reasoner","modelMismatch":false}',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const cb = callbacks();
    await frankStream('hello', 'central', cb, undefined, undefined, undefined, 'deepseek-reasoner');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'deepseek-reasoner' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('roomName');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('agentName');
    expect(cb.onDone).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-reasoner', modelProvider: 'deepseek', modelMismatch: false,
    }));
    vi.unstubAllGlobals();
  });

  it('rethrows a deliberate abort without reporting an agent error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([])));
    const cb = callbacks();
    const controller = new AbortController();
    controller.abort();

    await expect(frankStream('hello', 'central', cb, undefined, undefined, controller.signal))
      .rejects.toBeInstanceOf(StreamAbortedError);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onDone).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('turnInfoToMessageMeta', () => {
  it('persists every terminal route fact using the stable snake_case contract', () => {
    expect(turnInfoToMessageMeta({
      requestedModel: 'deepseek-reasoner',
      model: 'deepseek-chat',
      modelProvider: 'deepseek',
      expectedModel: 'deepseek-reasoner',
      modelMismatch: true,
      harness: 'goose',
      packHash: 'sha256:abc123',
    })).toEqual({
      requested_model: 'deepseek-reasoner',
      model: 'deepseek-chat',
      model_provider: 'deepseek',
      expected_model: 'deepseek-reasoner',
      model_mismatch: true,
      harness: 'goose',
      pack_hash: 'sha256:abc123',
    });
  });

  it('preserves the complete shape when execution metadata is unavailable', () => {
    expect(turnInfoToMessageMeta({})).toEqual({
      requested_model: null,
      model: null,
      model_provider: null,
      expected_model: null,
      model_mismatch: false,
      harness: null,
      pack_hash: null,
    });
  });
});
