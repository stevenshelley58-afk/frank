/**
 * The mem0 implementation of the memory port — FRANK-§7.4, BRAIN-006.
 *
 * This is the ONLY file in `@frank/memory` that knows mem0 exists: its URL, its
 * `X-API-Key` header, its `{ results: [...] }` envelopes, its user_id/agent_id
 * scoping. Everything else in Frank talks to the {@link MemoryProvider} port and
 * never sees any of it. Swapping mem0 for another backend is a new class plus
 * one line of composition — no call site changes (the requirement).
 *
 * ## Two auth schemes, don't confuse them
 *
 * The self-hosted mem0 server (what Frank runs, on the VPS at :8888)
 * authenticates with an `X-API-Key` header. The hosted mem0 *platform* uses
 * `Authorization: *** Mixing them up yields a silent "Authentication
 * required" 401 that looks like a wrong key but is a wrong scheme. This client
 * speaks the self-hosted scheme.
 *
 * ## Scoping translation
 *
 * Frank's {@link MemoryScope} maps onto mem0's filters:
 *   - cellId + ownerId  -> user_id   (the owner the memory is about)
 *   - projectId/roomId  -> agent_id  (a namespace within the owner)
 * The user_id is derived deterministically so a scope always lands on the same
 * partition; the port never leaks this derivation.
 */

import type {
  MemoryProvider,
  MemoryScope,
  RecalledFact,
  StoredFact,
} from './provider';

/** Raw rows as the self-hosted mem0 server returns them. */
interface Mem0MemoryRow {
  id: string;
  memory: string;
  hash?: string;
  metadata?: Record<string, unknown> | null;
  score?: number;
  /** Present on POST /memories results; the extraction event (ADD/UPDATE/DELETE/NONE). */
  event?: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  expires_at?: string | null;
}

interface Mem0ResultsEnvelope {
  results: Mem0MemoryRow[];
}

export interface Mem0ProviderConfig {
  /** Base URL of the self-hosted server, e.g. `http://76.13.209.160:8888`. */
  readonly baseUrl: string;
  /** The self-hosted server API key (sent as `X-API-Key`). */
  readonly apiKey: string;
  /** Default classification stamped on recalled facts. FRANK-§2.3. */
  readonly defaultClassification?: 'internal' | 'private';
  /** Request timeout in ms. Default 10000. */
  readonly timeoutMs?: number;
}

export class Mem0Provider implements MemoryProvider {
  readonly name: string;
  private readonly config: Required<
    Pick<Mem0ProviderConfig, 'baseUrl' | 'apiKey'>
  > & {
    defaultClassification: 'internal' | 'private';
    timeoutMs: number;
  };

  constructor(config: Mem0ProviderConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      apiKey: config.apiKey,
      defaultClassification: config.defaultClassification ?? 'internal',
      timeoutMs: config.timeoutMs ?? 10_000,
    };
    this.name = `mem0@${this.config.baseUrl.replace(/^https?:\/\//, '')}`;
  }

  async recall(input: {
    query: string;
    scope: MemoryScope;
    topK: number;
  }): Promise<readonly RecalledFact[]> {
    const body: Record<string, unknown> = {
      query: input.query,
      user_id: this.userIdOf(input.scope),
      top_k: input.topK,
    };
    const agentId = this.agentIdOf(input.scope);
    if (agentId !== undefined) body.agent_id = agentId;

    const env = await this.post<Mem0ResultsEnvelope>('/search', body);
    const rows = env.results ?? [];
    const classification = this.config.defaultClassification;

    return rows.map((row): RecalledFact => {
      const fact: RecalledFact = {
        fact: row.memory,
        // FRANK-§2.3: an ordinary recall is generated-untrusted, full stop.
        trust: 'generated-untrusted',
        sourceId: `mem0://${row.id}`,
        classification,
        relevance: typeof row.score === 'number' ? row.score : 0,
      };
      if (row.updated_at) {
        return { ...fact, confirmedAt: row.updated_at };
      }
      return fact;
    });
  }

  async store(input: {
    messages: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    scope: MemoryScope;
  }): Promise<{ results: ReadonlyArray<{ id: string; event: string }> }> {
    const body: Record<string, unknown> = {
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      user_id: this.userIdOf(input.scope),
    };
    const agentId = this.agentIdOf(input.scope);
    if (agentId !== undefined) body.agent_id = agentId;

    const env = await this.post<Mem0ResultsEnvelope>('/memories', body);
    const rows = env.results ?? [];
    return {
      results: rows.map((row) => ({
        id: row.id,
        // mem0 reports the extraction event at the top level of each result.
        event: row.event ?? 'ADD',
      })),
    };
  }

  async list(scope: MemoryScope): Promise<readonly StoredFact[]> {
    const params = new URLSearchParams({ user_id: this.userIdOf(scope) });
    const agentId = this.agentIdOf(scope);
    if (agentId !== undefined) params.set('agent_id', agentId);

    const env = await this.get<Mem0ResultsEnvelope>(`/memories?${params.toString()}`);
    return (env.results ?? []).map((row) => this.toStored(row, scope));
  }

  async edit(input: { id: string; fact: string }): Promise<StoredFact> {
    // PUT returns only {"message": "..."}; the fresh row must be re-read.
    await this.put(`/memories/${encodeURIComponent(input.id)}`, { text: input.fact });
    return this.readFresh(input.id);
  }

  async expire(input: { id: string; expiresAt: string }): Promise<StoredFact> {
    await this.put(`/memories/${encodeURIComponent(input.id)}`, {
      expiration_date: input.expiresAt,
    });
    return this.readFresh(input.id);
  }

  async remove(id: string): Promise<void> {
    await this.request('DELETE', `/memories/${encodeURIComponent(id)}`);
  }

  async health(): Promise<{ healthy: boolean; backend: string; latencyMs?: number }> {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const res = await fetch(`${this.config.baseUrl}/auth/setup-status`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { healthy: res.ok, backend: this.name, latencyMs: Date.now() - started };
    } catch {
      return { healthy: false, backend: this.name };
    }
  }

  // --- internals ---

  /**
   * Re-read a single memory after a mutation. mem0's PUT/expire endpoints
   * return a bare `{"message"}` acknowledgement, so the authoritative post-edit
   * state (including server-normalized text and refreshed `updated_at`) comes
   * from a follow-up GET.
   */
  private async readFresh(id: string): Promise<StoredFact> {
    const row = await this.get<Mem0MemoryRow>(`/memories/${encodeURIComponent(id)}`);
    return this.toStored(row, this.scopeFromRow(row));
  }

  /** Deterministic owner partition: cell + owner. */
  private userIdOf(scope: MemoryScope): string {
    return `${scope.cellId}:${scope.ownerId}`;
  }

  /** Optional namespace within an owner: project wins, then room. */
  private agentIdOf(scope: MemoryScope): string | undefined {
    if (scope.projectId !== undefined) return `project:${scope.projectId}`;
    if (scope.roomId !== undefined) return `room:${scope.roomId}`;
    return undefined;
  }

  /** Best-effort scope reconstruction from a row, for edit/expire responses. */
  private scopeFromRow(row: Mem0MemoryRow): MemoryScope {
    const [cellId = 'cell-steven-primary', ownerId = row.user_id ?? 'unknown'] =
      (row.user_id ?? '').split(':');
    const scope: MemoryScope = { cellId, ownerId };
    if (row.agent_id?.startsWith('project:')) {
      return { ...scope, projectId: row.agent_id.slice('project:'.length) };
    }
    if (row.agent_id?.startsWith('room:')) {
      return { ...scope, roomId: row.agent_id.slice('room:'.length) };
    }
    return scope;
  }

  private toStored(row: Mem0MemoryRow, scope: MemoryScope): StoredFact {
    const stored: StoredFact = {
      id: row.id,
      fact: row.memory,
      scope,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.expires_at) {
      return { ...stored, expiresAt: row.expires_at };
    }
    return stored;
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'X-API-Key': this.config.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `mem0 ${method} ${path} failed: HTTP ${res.status} ${detail.slice(0, 200)}`,
        );
      }
      // DELETE returns 204 with no body.
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
