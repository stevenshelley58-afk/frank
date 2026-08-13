import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chat, type HermesChatEvent } from './index.js';

/**
 * The suite exercises the transport against a FAKE OpenAI-compatible HTTP
 * server on loopback — no real Hermes gateway, no public internet. Each test
 * sets the env vars `chat()` reads, so the request shape, headers, SSE
 * parsing, and abort behaviour are all verified end to end.
 */

interface RecordedRequest {
  readonly path: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Record<string, unknown>;
}

interface FakeServer {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

function startFakeServer(respond: (req: RecordedRequest, res: ServerResponse) => void): Promise<FakeServer> {
  return new Promise((resolve, reject) => {
    const requests: RecordedRequest[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => {
        const recorded: RecordedRequest = {
          path: req.url ?? '',
          method: req.method ?? '',
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        };
        requests.push(recorded);
        respond(recorded, res);
      });
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('fake server did not bind a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close(): Promise<void> {
          return new Promise((resolveClose) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolveClose());
          });
        },
      });
    });
  });
}

/** Standard OpenAI SSE encoding for chat.completions chunks. */
function sseBody(...chunks: Array<Record<string, unknown>>): string {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
  return `${lines}data: [DONE]\n\n`;
}

function textChunk(content: string, finish: 'stop' | null = null): Record<string, unknown> {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'hub',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  };
}

function emptyChunk(finish: 'stop' | 'tool_calls' | null = null): Record<string, unknown> {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'hub',
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
  };
}

function toolDeltaChunk(index: number, fragment: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'hub',
    choices: [{ index: 0, delta: { tool_calls: [{ index, ...fragment }] }, finish_reason: null }],
  };
}

async function collect(events: AsyncIterable<HermesChatEvent>): Promise<HermesChatEvent[]> {
  const out: HermesChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const ORIGINAL_ENV: Record<string, string | undefined> = {};

describe('hermes-client chat()', () => {
  beforeEach(() => {
    ORIGINAL_ENV.HERMES_API_URL = process.env.HERMES_API_URL;
    ORIGINAL_ENV.HERMES_API_KEY = process.env.HERMES_API_KEY;
    ORIGINAL_ENV.HERMES_API_TIMEOUT_MS = process.env.HERMES_API_TIMEOUT_MS;
    process.env.HERMES_API_KEY = 'dev-key-abc123';
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('streams text deltas and ends with done, hitting the profile-routed endpoint', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sseBody(textChunk('Hel'), textChunk('lo'), emptyChunk('stop')));
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));

      expect(events).toEqual([
        { type: 'text', content: 'Hel' },
        { type: 'text', content: 'lo' },
        { type: 'done', content: '' },
      ]);

      expect(fake.requests).toHaveLength(1);
      const request = fake.requests[0];
      if (!request) throw new Error('no request recorded');
      expect(request.method).toBe('POST');
      expect(request.path).toBe('/p/hub/v1/chat/completions');
      expect(request.body.model).toBe('hub');
      expect(request.body.stream).toBe(true);
      expect(request.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(request.body.conversation).toBe('conv-1');
      const authorization = request.headers.authorization;
      expect(authorization).toBe('Bearer ' + 'dev-key-abc123');
      expect(request.headers['x-hermes-session-key']).toBe('conv-1');
    } finally {
      await fake.close();
    }
  });

  it('assembles fragmented tool-call deltas into one tool event per call', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        sseBody(
          toolDeltaChunk(0, { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '' } }),
          toolDeltaChunk(0, { function: { arguments: '{"path":"' } }),
          toolDeltaChunk(0, { function: { arguments: 'notes.txt"}' } }),
          emptyChunk('tool_calls'),
        ),
      );
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'read my notes' }));
      const toolEvents = events.filter((event) => event.type === 'tool');
      expect(toolEvents).toHaveLength(1);
      const tool = JSON.parse(toolEvents[0]?.content ?? '') as { id: string; name: string; arguments: string };
      expect(tool.id).toBe('call_1');
      expect(tool.name).toBe('read_file');
      expect(tool.arguments).toBe('{"path":"notes.txt"}');
      expect(events.at(-1)).toEqual({ type: 'done', content: '' });
    } finally {
      await fake.close();
    }
  });

  it('reports a dead gateway as a quick error event instead of hanging', async () => {
    // Bind a real server just to learn a free port, then close it — the port
    // is now dead (connection refused), exactly like a stopped gateway.
    const probe = await startFakeServer(() => {});
    const deadUrl = probe.url;
    await probe.close();

    process.env.HERMES_API_URL = deadUrl;
    const startedAt = Date.now();
    const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
    const elapsedMs = Date.now() - startedAt;

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    expect(events[0]?.content ?? '').not.toBe('');
    // Connection refused on loopback is immediate; anything under 5 s proves
    // the client did not hang waiting for a retry or a long timeout.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('aborts a stalled request via HERMES_API_TIMEOUT_MS and yields a clear error', async () => {
    const fake = await startFakeServer(() => {
      // Accept the connection and never respond — the request stalls.
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      process.env.HERMES_API_TIMEOUT_MS = '300';
      const startedAt = Date.now();
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
      const elapsedMs = Date.now() - startedAt;

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('error');
      expect(events[0]?.content).toContain('timed out');
      expect(elapsedMs).toBeGreaterThan(250);
      expect(elapsedMs).toBeLessThan(5_000);
    } finally {
      await fake.close();
    }
  });

  it('yields a configuration error when HERMES_API_KEY is missing', async () => {
    delete process.env.HERMES_API_KEY;
    const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
    expect(events).toEqual([{ type: 'error', content: 'HERMES_API_KEY is not configured.' }]);
  });
});
