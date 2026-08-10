/**
 * Server-side DeepSeek chat client (Node.js runtime only).
 *
 * A direct HTTPS provider used while no local harness (Goose ACP, Letta) is
 * reachable from the web container. OpenAI-compatible streaming API.
 *
 * Env:
 *   DEEPSEEK_API_KEY   required — provider reports unhealthy without it
 *   DEEPSEEK_MODEL     default "deepseek-chat"
 *   DEEPSEEK_BASE_URL  default "https://api.deepseek.com"
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Per-session rolling history, in process memory (same lifetime as the
 *  goose/letta session caches — lost on restart, which is acceptable). */
const sessions = new Map<string, ChatMessage[]>();
let nextSessionId = 1;

/** History window sent per turn — bounds token cost. */
const MAX_HISTORY_MESSAGES = 30;

function baseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
}

export function deepseekModel(): string {
  return process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
}

export function deepseekHealth(): Promise<boolean> {
  const key = process.env.DEEPSEEK_API_KEY;
  return Promise.resolve(key !== undefined && key !== '');
}

export function createDeepseekSession(): Promise<string> {
  const id = `ds-${nextSessionId}`;
  nextSessionId += 1;
  sessions.set(id, []);
  return Promise.resolve(id);
}

/** Stream one turn, yielding visible assistant text chunks. */
export async function* streamDeepseekMessage(
  sessionId: string,
  prompt: string,
): AsyncGenerator<string, void, unknown> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (key === undefined || key === '') throw new Error('DEEPSEEK_API_KEY is not set');

  const history = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, history);
  history.push({ role: 'user', content: prompt });

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: deepseekModel(),
      messages: history.slice(-MAX_HISTORY_MESSAGES),
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`DeepSeek HTTP ${res.status}: ${detail}`);
  }
  if (!res.body) throw new Error('DeepSeek returned no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt: { choices?: Array<{ delta?: { content?: string } }> };
        try {
          evt = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        } catch {
          continue; // partial frame — wait for more bytes
        }
        const text = evt.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          fullText += text;
          yield text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  history.push({ role: 'assistant', content: fullText });
}
