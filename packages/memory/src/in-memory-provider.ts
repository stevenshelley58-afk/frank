/**
 * An in-memory {@link MemoryProvider} for tests and Slice-1 local development.
 *
 * No network, no database, deterministic. `recall` scores by token overlap so
 * tests can assert that a relevant fact outranks an irrelevant one without a
 * real embedding model. `store` treats each user turn as one durable fact — a
 * deliberately naive extractor, since the point of the fake is to exercise the
 * PORT contract (minimization, scoping, BRAIN-006 CRUD), not to model
 * extraction quality. A real backend (mem0) does the real extraction.
 */

import type {
  MemoryProvider,
  MemoryScope,
  RecalledFact,
  StoredFact,
} from './provider';

interface Row {
  id: string;
  fact: string;
  scope: MemoryScope;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export class InMemoryMemoryProvider implements MemoryProvider {
  readonly name = 'in-memory';
  private rows: Row[] = [];
  private seq = 0;

  async recall(input: {
    query: string;
    scope: MemoryScope;
    topK: number;
  }): Promise<readonly RecalledFact[]> {
    const now = Date.now();
    const queryTokens = tokenize(input.query);

    const scored = this.rows
      .filter((r) => sameScope(r.scope, input.scope))
      .filter((r) => r.expiresAt === undefined || Date.parse(r.expiresAt) > now)
      .map((r) => ({ row: r, relevance: overlap(queryTokens, tokenize(r.fact)) }))
      .filter((s) => s.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, input.topK);

    return scored.map((s): RecalledFact => ({
      fact: s.row.fact,
      trust: 'generated-untrusted',
      sourceId: `mem://${s.row.id}`,
      classification: 'internal',
      relevance: s.relevance,
      confirmedAt: s.row.updatedAt,
    }));
  }

  async store(input: {
    messages: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    scope: MemoryScope;
  }): Promise<{ results: ReadonlyArray<{ id: string; event: string }> }> {
    const results: Array<{ id: string; event: string }> = [];
    for (const msg of input.messages) {
      if (msg.role !== 'user') continue;
      const id = `mem-${++this.seq}`;
      const at = new Date().toISOString();
      this.rows.push({
        id,
        fact: msg.content,
        scope: input.scope,
        createdAt: at,
        updatedAt: at,
      });
      results.push({ id, event: 'ADD' });
    }
    return { results };
  }

  async list(scope: MemoryScope): Promise<readonly StoredFact[]> {
    return this.rows
      .filter((r) => sameScope(r.scope, scope))
      .map((r) => toStored(r));
  }

  async edit(input: { id: string; fact: string }): Promise<StoredFact> {
    const row = this.mustGet(input.id);
    row.fact = input.fact;
    row.updatedAt = new Date().toISOString();
    return toStored(row);
  }

  async expire(input: { id: string; expiresAt: string }): Promise<StoredFact> {
    const row = this.mustGet(input.id);
    row.expiresAt = input.expiresAt;
    row.updatedAt = new Date().toISOString();
    return toStored(row);
  }

  async remove(id: string): Promise<void> {
    this.mustGet(id);
    this.rows = this.rows.filter((r) => r.id !== id);
  }

  async health(): Promise<{ healthy: boolean; backend: string; latencyMs?: number }> {
    return { healthy: true, backend: this.name, latencyMs: 0 };
  }

  private mustGet(id: string): Row {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`memory ${id} not found`);
    return row;
  }
}

function sameScope(a: MemoryScope, b: MemoryScope): boolean {
  return (
    a.cellId === b.cellId &&
    a.ownerId === b.ownerId &&
    (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
    (a.roomId ?? undefined) === (b.roomId ?? undefined)
  );
}

function toStored(r: Row): StoredFact {
  const stored: StoredFact = {
    id: r.id,
    fact: r.fact,
    scope: r.scope,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (r.expiresAt !== undefined) {
    return { ...stored, expiresAt: r.expiresAt };
  }
  return stored;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard overlap of two token sets, in 0..1. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}
