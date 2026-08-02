/**
 * Integration test — ZapierMcpToolProvider against a fake MCP server.
 *
 * Runs a real `node:http` server speaking MCP Streamable HTTP (plain-JSON path)
 * and drives the provider through the actual `fetch` transport, not a mock. This
 * exercises handshake, session echo, tool discovery, classification, and
 * invocation end to end. A second fake returns SSE to cover the streaming path.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ZapierMcpToolProvider,
  classifyTool,
  createZapierMcpToolProvider,
  familyOf,
  loadConfig,
} from '../src/index.js';

/* ------------------------------------------------------------------ */
/* Fake MCP server                                                    */
/* ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'gmail.send_email',
    description: 'Send an email via Gmail',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' } },
      required: ['to'],
    },
  },
  {
    name: 'gmail.list_messages',
    description: 'List Gmail messages',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'google_calendar.create_event',
    description: 'Create a calendar event',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  },
  {
    name: 'google_tasks.create_task',
    description: 'Create a task',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  },
  // Outside the three families — must be dropped by classification.
  {
    name: 'slack.post_message',
    description: 'Post to Slack',
    inputSchema: { type: 'object', properties: {} },
  },
  // Supported family but unrecognised verb — must be dropped.
  {
    name: 'gmail.explode_inbox',
    description: 'Mystery verb',
    inputSchema: { type: 'object', properties: {} },
  },
];

interface Seen {
  authHeaders: (string | undefined)[];
  sessionEchoes: (string | undefined)[];
  calls: { name: string; args: Record<string, unknown> }[];
}

const SESSION_ID = 'sess-test-123';

/** Build a JSON-RPC handler bound to a `seen` recorder. */
function makeHandler(seen: Seen, opts: { sse?: boolean } = {}) {
  return (req: { headers: Record<string, string | string[] | undefined> }, body: string): {
    status: number;
    contentType: string;
    body: string;
  } => {
    const msg = JSON.parse(body) as {
      id?: string;
      method?: string;
      params?: Record<string, unknown>;
    };
    seen.authHeaders.push(req.headers.authorization as string | undefined);
    seen.sessionEchoes.push(req.headers['mcp-session-id'] as string | undefined);

    // Notifications carry no id and expect 202 + empty body.
    if (msg.id === undefined) {
      return { status: 202, contentType: 'application/json', body: '' };
    }

    if (msg.method === 'initialize') {
      return respond(msg.id, {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'fake-zapier-mcp', version: '0.0.1' },
        capabilities: { tools: {} },
      }, opts.sse);
    }
    if (msg.method === 'tools/list') {
      return respond(msg.id, { tools: TOOLS }, opts.sse);
    }
    if (msg.method === 'tools/call') {
      const params = msg.params ?? {};
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      seen.calls.push({ name, args });
      if (name === 'gmail.send_email') {
        return respond(msg.id, {
          content: [{ type: 'text', text: `sent to ${String(args.to ?? '')}` }],
        }, opts.sse);
      }
      if (name === 'boom') {
        return respond(msg.id, {
          content: [{ type: 'text', text: 'upstream exploded' }],
          isError: true,
        }, opts.sse);
      }
      return respond(msg.id, {
        content: [{ type: 'text', text: `called ${name}` }],
      }, opts.sse);
    }

    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      }),
    };
  };
}

function respond(
  id: string,
  result: unknown,
  sse?: boolean,
): { status: number; contentType: string; body: string } {
  const json = JSON.stringify({ jsonrpc: '2.0', id, result });
  if (sse) {
    const frame = `event: message\ndata: ${json}\n\n`;
    return { status: 200, contentType: 'text/event-stream', body: frame };
  }
  return { status: 200, contentType: 'application/json', body: json };
}

async function startServer(opts: { sse?: boolean } = {}): Promise<{
  url: string;
  seen: Seen;
  close: () => Promise<void>;
}> {
  const seen: Seen = { authHeaders: [], sessionEchoes: [], calls: [] };
  const handler = makeHandler(seen, opts);
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const out = handler(req, body);
      res.writeHead(out.status, {
        'Content-Type': out.contentType,
        'Mcp-Session-Id': SESSION_ID,
      });
      res.end(out.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seen,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe('config', () => {
  it('rejects a missing URL', () => {
    const r = loadConfig({ ZAPIER_MCP_TOKEN: 't' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ZAPIER_MCP_URL/);
  });

  it('rejects a non-http(s) URL', () => {
    const r = loadConfig({ ZAPIER_MCP_URL: 'ftp://x', ZAPIER_MCP_TOKEN: 't' });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid env', () => {
    const r = loadConfig({ ZAPIER_MCP_URL: 'https://mcp.zapier.com/x', ZAPIER_MCP_TOKEN: 'tok' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.url).toBe('https://mcp.zapier.com/x');
  });

  it('createZapierMcpToolProvider reports misconfig without throwing', () => {
    const r = createZapierMcpToolProvider({});
    expect(r.ok).toBe(false);
  });
});

describe('classifyTool', () => {
  it('exposes the three Google families', () => {
    expect(familyOf('gmail.send_email')?.family).toBe('gmail');
    expect(familyOf('google_calendar.create_event')?.family).toBe('google_calendar');
    expect(familyOf('google_tasks.create_task')?.family).toBe('google_tasks');
    expect(familyOf('calendar.create_event')?.family).toBe('google_calendar');
    expect(familyOf('tasks.create_task')?.family).toBe('google_tasks');
  });

  it('drops unsupported families', () => {
    expect(classifyTool({ name: 'slack.post_message' })).toBeNull();
  });

  it('drops unrecognised verbs', () => {
    expect(classifyTool({ name: 'gmail.explode_inbox' })).toBeNull();
  });

  it('marks send as external_reversible with egress', () => {
    const d = classifyTool({ name: 'gmail.send_email' });
    expect(d?.actionBoundary.actionClass).toBe('external_reversible');
    expect(d?.actionBoundary.networkScope.mode).toBe('allowlist');
    expect(d?.actionBoundary.maximumDataClass).toBe('private');
  });

  it('marks list as observe', () => {
    const d = classifyTool({ name: 'gmail.list_messages' });
    expect(d?.actionBoundary.actionClass).toBe('observe');
  });

  it('marks calendar/task create as internal_reversible', () => {
    expect(classifyTool({ name: 'google_calendar.create_event' })?.actionBoundary.actionClass).toBe(
      'internal_reversible',
    );
    expect(classifyTool({ name: 'google_tasks.create_task' })?.actionBoundary.actionClass).toBe(
      'internal_reversible',
    );
  });
});

describe('ZapierMcpToolProvider (integration, JSON transport)', () => {
  let url = '';
  let seen: Seen;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const s = await startServer();
    url = s.url;
    seen = s.seen;
    close = s.close;
  });
  afterAll(async () => {
    await close();
  });

  it('discovers only the supported, classified tools', async () => {
    const provider = new ZapierMcpToolProvider({ url, token: 'secret-token' });
    const tools = await provider.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'gmail.list_messages',
      'gmail.send_email',
      'google_calendar.create_event',
      'google_tasks.create_task',
    ]);
    // Unsupported + unknown-verb tools never leak through.
    expect(names).not.toContain('slack.post_message');
    expect(names).not.toContain('gmail.explode_inbox');
  });

  it('sends the bearer token on every request', async () => {
    const provider = new ZapierMcpToolProvider({ url, token: 'secret-token' });
    await provider.listTools();
    expect(seen.authHeaders.every((h) => h === 'Bearer secret-token')).toBe(true);
  });

  it('echoes the session id after initialize', async () => {
    // Fresh server so the recorded session echoes belong to this provider
    // alone — every provider's first request (initialize) has no session id,
    // and every subsequent one must echo the server's.
    const s = await startServer();
    try {
      const provider = new ZapierMcpToolProvider({ url: s.url, token: 'secret-token' });
      await provider.listTools();
      expect(s.seen.sessionEchoes[0]).toBeUndefined();
      expect(s.seen.sessionEchoes.length).toBeGreaterThan(1);
      expect(s.seen.sessionEchoes.slice(1).every((h) => h === SESSION_ID)).toBe(true);
    } finally {
      await s.close();
    }
  });

  it('invokes a tool and returns untrusted content', async () => {
    const provider = new ZapierMcpToolProvider({ url, token: 'secret-token' });
    const result = await provider.callTool('gmail.send_email', { to: 'a@b.com' });
    expect(result.ok).toBe(true);
    expect(result.trust).toBe('external-untrusted');
    expect(result.content[0]?.text).toBe('sent to a@b.com');
    expect(seen.calls.at(-1)).toEqual({
      name: 'gmail.send_email',
      args: { to: 'a@b.com' },
    });
  });

  it('refuses to invoke an undiscovered tool', async () => {
    const provider = new ZapierMcpToolProvider({ url, token: 'secret-token' });
    const result = await provider.callTool('slack.post_message', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });

  it('reports status with a tool count', async () => {
    const provider = new ZapierMcpToolProvider({ url, token: 'secret-token' });
    const status = await provider.status();
    expect(status.healthy).toBe(true);
    expect(status.toolCount).toBe(4);
  });
});

describe('ZapierMcpToolProvider (integration, SSE transport)', () => {
  it('parses a text/event-stream response', async () => {
    const s = await startServer({ sse: true });
    try {
      const provider = new ZapierMcpToolProvider({ url: s.url, token: 'tok' });
      const tools = await provider.listTools();
      expect(tools.map((t) => t.name)).toContain('gmail.send_email');
    } finally {
      await s.close();
    }
  });
});
