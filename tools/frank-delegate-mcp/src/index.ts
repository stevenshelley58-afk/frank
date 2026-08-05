#!/usr/bin/env node
/**
 * frank-delegate-mcp — the ONLY channel by which Central can start work in a
 * project room.
 *
 * Central decides on its own whether a task belongs in a room. It expresses
 * that decision by calling delegate_task. Typing "@chase" in prose does
 * nothing — there is no text parser anywhere in the system any more.
 *
 * Env:
 *   FRANK_WEB_URL   base URL of the Frank web app (default http://localhost:3000)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';

const WEB = process.env.FRANK_WEB_URL ?? 'http://localhost:3000';

const server = new Server(
  { name: 'frank-delegate', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'delegate_task',
      description: [
        'Hand a concrete piece of work to a project room so its scoped agent executes it.',
        '',
        'Call this ONLY when Steve has asked for actual work that belongs to one project.',
        'Do NOT call it when Steve is asking a question about how the system works, when he',
        'is asking whether you CAN delegate, when you are explaining what you already did,',
        'or when you are listing the rooms that exist. Talking about a room is not delegating',
        'to it.',
        '',
        'The task argument must be a complete, standalone instruction that the receiving',
        'agent could act on with no other context — not a topic, not a room name, not a',
        'fragment of your reply.',
        '',
        'If you are not certain this should run, set confidence to "unsure". Steve will get',
        'a confirm chip and nothing runs until he clicks it. Preferring "unsure" is always',
        'safe; guessing wrong and running is not.',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          room: {
            type: 'string',
            enum: ['blockwise', 'chase', 'merrypaws', 'lotfile'],
            description: 'Which project room executes the task.',
          },
          task: {
            type: 'string',
            minLength: 12,
            description:
              'The complete standalone instruction for the receiving agent. Must make sense with no other context.',
          },
          why: {
            type: 'string',
            description: 'One sentence: why this belongs in that room. Shown to Steve.',
          },
          confidence: {
            type: 'string',
            enum: ['sure', 'unsure'],
            description:
              '"sure" starts the run immediately. "unsure" creates a proposal Steve must approve. When in doubt, choose "unsure".',
          },
        },
        required: ['room', 'task', 'why', 'confidence'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'delegate_task') {
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
  }

  const a = (req.params.arguments ?? {}) as Record<string, unknown>;
  const payload = {
    room: String(a.room ?? ''),
    task: String(a.task ?? ''),
    why: String(a.why ?? ''),
    confidence: a.confidence === 'sure' ? 'sure' : 'unsure',
    key: randomUUID(),
  };

  try {
    const res = await fetch(`${WEB}/api/delegations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = (await res.json()) as { id?: string; status?: string; error?: string };
    if (!res.ok) {
      return { content: [{ type: 'text', text: `Delegation rejected: ${out.error}` }], isError: true };
    }
    const msg =
      out.status === 'proposed'
        ? `Proposed to ${payload.room}. Steve must approve it before it runs — tell him it is waiting on his confirm.`
        : `Running in ${payload.room} (id ${out.id}). The receipt lands in Central automatically — do not repeat it yourself.`;
    return { content: [{ type: 'text', text: msg }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Delegation failed to reach Frank web: ${err}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
