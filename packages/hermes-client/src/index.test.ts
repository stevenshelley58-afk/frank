import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chat, type ChatEvent } from './index.js';

/**
 * The suite talks ONLY to a fake OpenAI-compatible HTTP server on loopback —
 * never to the real Hermes gateway, never to the public internet. The fake
 * emits the same Responses-API SSE event stream the real Hermes API server
 * emits (verified by the W2-1 live probe): `response.created`,
 * `response.output_item.added` (function_call), `response.output_item.done`,
 * `response.output_text.delta`, `response.completed`.
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
      const address = server.address() as AddressInfo | null;
      if (address === null) {
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

/** Responses-API SSE encoding: `event: <name>` + `data: <json>`. */
function sse(...events: Array<{ name: string; data: Record<string, unknown> }>): string {
  return events.map((e) => `event: ${e.name}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

function textDelta(delta: string, sequence = 0): { name: string; data: Record<string, unknown> } {
  return {
    name: 'response.output_text.delta',
    data: { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta, sequence_number: sequence },
  };
}

function completed(sequence = 0): { name: string; data: Record<string, unknown> } {
  return {
    name: 'response.completed',
    data: { type: 'response.completed', response: { id: 'resp_1', status: 'completed' }, sequence_number: sequence },
  };
}

function functionCallDone(name: string, callId: string, args: string, sequence = 0): { name: string; data: Record<string, unknown> } {
  return {
    name: 'response.output_item.done',
    data: {
      type: 'response.output_item.done',
      output_index: 0,
      item: { id: `fc_${callId}`, type: 'function_call', status: 'completed', name, call_id: callId, arguments: args },
      sequence_number: sequence,
    },
  };
}

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const ENV_KEYS = ['HERMES_API_URL', 'HERMES_API_KEY', 'HERMES_API_CONNECT_TIMEOUT_MS', 'HERMES_API_IDLE_TIMEOUT_MS'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

describe('hermes-client chat()', () => {
  beforeEach(() => {
    for (const name of ENV_KEYS) ORIGINAL_ENV[name] = process.env[name];
    process.env.HERMES_API_KEY = 'dev-key-abc123';
  });

  afterEach(() => {
    for (const name of ENV_KEYS) {
      const value = ORIGINAL_ENV[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('streams text deltas and ends with done, hitting the profile-routed responses endpoint', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sse(textDelta('Hel', 1), textDelta('lo', 2), completed(3)));
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'Hello there' }));

      expect(events).toEqual([
        { type: 'text', content: 'Hel' },
        { type: 'text', content: 'lo' },
        { type: 'done', content: '' },
      ]);

      expect(fake.requests).toHaveLength(1);
      const request = fake.requests[0];
      if (!request) throw new Error('no request recorded');
      expect(request.method).toBe('POST');
      expect(request.path).toBe('/p/hub/v1/responses');
      expect(request.body.model).toBe('hub');
      expect(request.body.input).toBe('Hello there');
      expect(request.body.stream).toBe(true);
      expect(request.body.conversation).toBe('conv-1');
      expect(request.headers.authorization).toBe('Bearer dev-key-abc123');
      expect(request.headers['x-hermes-session-key']).toBe('conv-1');
    } finally {
      await fake.close();
    }
  });

  it('emits one tool event per completed function call, with name and arguments', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        sse(
          functionCallDone('terminal', 'call_1', '{"command":"pwd"}', 1),
          textDelta('The directory is /c/Users/steve.', 2),
          completed(3),
        ),
      );
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'where am I?' }));

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({
        type: 'tool',
        content: JSON.stringify({ name: 'terminal', call_id: 'call_1', arguments: '{"command":"pwd"}' }),
      });
      expect(events[1]).toEqual({ type: 'text', content: 'The directory is /c/Users/steve.' });
      expect(events[2]).toEqual({ type: 'done', content: '' });
    } finally {
      await fake.close();
    }
  });

  it('routes the default profile without a /p/ prefix', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sse(completed(0)));
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      await collect(chat({ profile: 'hermes-agent', sessionKey: 'conv-1', message: 'hi' }));
      expect(fake.requests[0]?.path).toBe('/v1/responses');
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
    // Connection refused on loopback is immediate; well under 5 s proves the
    // client did not hang waiting on a retry or a long timeout.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('aborts a stalled request via the connect timeout and yields a clear error', async () => {
    const fake = await startFakeServer(() => {
      // Accept the connection and never respond — the request stalls.
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      process.env.HERMES_API_CONNECT_TIMEOUT_MS = '300';
      const startedAt = Date.now();
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
      const elapsedMs = Date.now() - startedAt;

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('error');
      expect(events[0]?.content).toContain('connect timeout');
      expect(elapsedMs).toBeGreaterThan(250);
      expect(elapsedMs).toBeLessThan(5_000);
    } finally {
      await fake.close();
    }
  });

  it('yields a configuration error when HERMES_API_KEY is missing', async () => {
    delete process.env.HERMES_API_KEY;
    const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
    expect(events).toEqual([
      { type: 'error', content: 'HERMES_API_KEY is not set; cannot authenticate to the Hermes API server.' },
    ]);
  });

  it('maps an HTTP error response to an error event', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too many concurrent runs', type: 'server_error' } }));
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('error');
      expect(events[0]?.content).toContain('HTTP 503');
    } finally {
      await fake.close();
    }
  });

  it('surfaces an in-stream SSE error event', async () => {
    const fake = await startFakeServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        sse(
          textDelta('partial', 1),
          { name: 'error', data: { type: 'error', code: 'server_error', message: 'upstream exploded', param: null, sequence_number: 2 } },
        ),
      );
    });
    try {
      process.env.HERMES_API_URL = fake.url;
      const events = await collect(chat({ profile: 'hub', sessionKey: 'conv-1', message: 'hi' }));
      expect(events.at(-1)).toEqual({ type: 'error', content: 'Hermes stream error: upstream exploded' });
    } finally {
      await fake.close();
    }
  });
});
