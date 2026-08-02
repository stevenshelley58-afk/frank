/**
 * Server-side Letta client (Node.js runtime only).
 *
 * Letta is the agent-memory backend: one long-lived agent per room, each with
 * persistent memory blocks (per-room "session wiki"). Each turn the agent reads
 * its blocks, answers, and self-edits them — the memory loop is native to Letta
 * (it exposes memory_replace / memory_insert tools to the LLM).
 *
 * We use Letta as a chat harness behind the same ChatProvider interface as
 * Goose. Streaming is SSE (text/event-stream) from POST /v1/agents/:id/messages.
 *
 * Env:
 *   LETTA_URL            base URL, e.g. http://frank-letta-server:8283 (docker net)
 *   LETTA_DEFAULT_MODEL  model handle, default "deepseek/deepseek-chat"
 *
 * NOTE: DeepSeek V4 reasoning models (deepseek-v4-flash / -pro) require
 * reasoning_content echoed back on follow-up calls; Letta's agent loop does not
 * do this, so multi-turn 400s. Use deepseek-chat (V3, non-thinking) until Letta
 * fixes the reasoning passthrough. Validated 2026-08-02 against Letta 0.16.8.
 */

const LETTA_URL = process.env.LETTA_URL || 'http://127.0.0.1:8283';
const LETTA_DEFAULT_MODEL = process.env.LETTA_DEFAULT_MODEL || 'deepseek/deepseek-chat';
const LETTA_EMBEDDING = 'letta/letta-free';

/** The persona block agents are created with when the room passes none. */
const DEFAULT_PERSONA = [
  "You are Frank, Steve's AI operations manager.",
  'Be direct, concise, action-oriented. No filler. Lead with the answer.',
  'You keep your own memory: after each turn, if Steve shared something durable',
  '(a name, a project, a decision, a preference), silently add a short bullet to',
  'your session_wiki block. Never narrate the memory edit.',
].join(' ');

/** roomId -> Letta agentId, cached for the process lifetime. */
const agentCache = new Map<string, string>();

let fetchImpl: typeof fetch = fetch;

/** Test seam: swap fetch and clear the agent cache. */
export function __setFetchForTest(f: typeof fetch | null): void {
  fetchImpl = f ?? fetch;
  agentCache.clear();
}

interface LettaError {
  error?: { type?: string; message?: string; detail?: string };
  detail?: string;
}

async function lettaFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${LETTA_URL.replace(/\/$/, '')}${path}`;
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Letta gates streaming (streaming=true) behind "SDK v1.0+ clients",
      // detected via a User-Agent of `letta-client/<v>` (major == 1). Without
      // it, token streaming 422s. See letta/utils.py:is_1_0_sdk_version.
      'User-Agent': 'letta-client/1.0.0',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as LettaError;
      detail = body.error?.message || body.error?.detail || body.detail || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Letta ${init?.method || 'GET'} ${path}: ${detail}`);
  }
  return res;
}

/** GET /v1/health/ liveness probe (Letta 0.16 exposes health under /v1/health/). */
export async function lettaHealth(): Promise<boolean> {
  try {
    const res = await lettaFetch('/v1/health/');
    return res.ok;
  } catch {
    return false;
  }
}

interface AgentSummary {
  id: string;
  name: string;
}

/** GET /v1/agents/?name= look up an agent by exact name. */
async function findAgentByName(name: string): Promise<AgentSummary | null> {
  const res = await lettaFetch(`/v1/agents/?name=${encodeURIComponent(name)}`);
  const list = (await res.json()) as AgentSummary[];
  return list.find((a) => a.name === name) ?? null;
}

/**
 * Ensure a Letta agent exists for a room and return its id (cached). Persona is
 * baked into the agent's persona block at creation, so the room identity
 * persists across web restarts — the memory lives in Postgres.
 */
export async function ensureAgent(roomId: string, persona: string): Promise<string> {
  const cached = agentCache.get(roomId);
  if (cached) return cached;

  const agentName = `frank-${roomId}`;
  const existing = await findAgentByName(agentName).catch(() => null);
  if (existing) {
    agentCache.set(roomId, existing.id);
    return existing.id;
  }

  const res = await lettaFetch('/v1/agents/', {
    method: 'POST',
    body: JSON.stringify({
      name: agentName,
      model: LETTA_DEFAULT_MODEL,
      embedding: LETTA_EMBEDDING,
      memory_blocks: [
        { label: 'persona', value: persona || DEFAULT_PERSONA, limit: 4000 },
        { label: 'session_wiki', value: '# Session Wiki\n(empty)\n', limit: 12000 },
      ],
    }),
  });
  const agent = (await res.json()) as AgentSummary & { detail?: string };
  if (!agent?.id) {
    throw new Error(`Letta agent create returned no id: ${agent?.detail || JSON.stringify(agent).slice(0, 200)}`);
  }
  agentCache.set(roomId, agent.id);
  return agent.id;
}

/**
 * Stream one turn through the room's agent, yielding visible assistant text.
 * Reasoning / tool / step frames are filtered — the UI sees only final text.
 */
export async function* streamLettaMessage(
  roomId: string,
  persona: string,
  userMessage: string,
): AsyncGenerator<string, void, unknown> {
  const agentId = await ensureAgent(roomId, persona);

  const res = await lettaFetch(`/v1/agents/${agentId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      streaming: true,
      stream_steps: true,
      stream_tokens: true,
    }),
  });

  if (!res.body) throw new Error('Letta returned no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          let evt: { message_type?: string; content?: string; message?: { content?: string } };
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt.message_type === 'assistant_message') {
            // Letta puts content at top-level (not message.content).
            const text = evt.content;
            if (text) yield text;
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
