/**
 * BRAIN-006 end-to-end acceptance test — FRANK-§4.6.
 *
 * "Personal preference memories must be reviewable, editable, expirable, and
 * deletable." Acceptance: "Memory control screen and end-to-end deletion
 * test." This is the deletion-test half, driven through the MemoryProvider
 * port against the in-memory backend (the port contract is backend-agnostic,
 * so passing here is the guarantee the mem0 impl must also hold).
 *
 * Full lifecycle exercised: store → list → recall → edit → expire → remove,
 * plus scope isolation and the literal end-to-end deletion path
 * (store → list N → delete each → list 0).
 */

import { describe, expect, it } from 'vitest';

import { InMemoryMemoryProvider } from './in-memory-provider';
import type { MemoryScope } from './provider';

const CELL: MemoryScope = { cellId: 'frank', ownerId: 'steve' };
const ROOM_BLOCKWISE: MemoryScope = { ...CELL, roomId: 'blockwise' };
const ROOM_CHASE: MemoryScope = { ...CELL, roomId: 'chase' };

function store(provider: InMemoryMemoryProvider, scope: MemoryScope, contents: string[]) {
  return provider.store({
    messages: contents.map((content) => ({ role: 'user' as const, content })),
    scope,
  });
}

describe('BRAIN-006 — reviewable (list)', () => {
  it('lists stored facts in their scope', async () => {
    const provider = new InMemoryMemoryProvider();
    await store(provider, CELL, ['Steve prefers concise replies', 'Steve uses Android, not iOS']);

    const facts = await provider.list(CELL);
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.fact)).toEqual(
      expect.arrayContaining(['Steve prefers concise replies', 'Steve uses Android, not iOS']),
    );
    // Every listed fact carries a stable id, scope, and timestamps.
    for (const f of facts) {
      expect(f.id).toBeTruthy();
      expect(f.scope).toEqual(CELL);
      expect(f.createdAt).toBeTruthy();
      expect(f.updatedAt).toBeTruthy();
    }
  });

  it('only user turns become durable facts (extraction is the backend\u2019s job)', async () => {
    const provider = new InMemoryMemoryProvider();
    await provider.store({
      messages: [
        { role: 'system', content: 'system primer, not a fact' },
        { role: 'user', content: 'Steve is building Frank' },
        { role: 'assistant', content: 'assistant reply, not a fact' },
      ],
      scope: CELL,
    });
    const facts = await provider.list(CELL);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.fact).toBe('Steve is building Frank');
  });
});

describe('BRAIN-006 — editable', () => {
  it('rewrites a fact\u2019s text and bumps updatedAt', async () => {
    const provider = new InMemoryMemoryProvider();
    const { results } = await store(provider, CELL, ['Steve likes serif fonts']);
    const id = results[0]!.id;

    const before = (await provider.list(CELL))[0]!;
    const edited = await provider.edit({ id, fact: 'Steve HATES serif fonts' });

    expect(edited.fact).toBe('Steve HATES serif fonts');
    expect(edited.id).toBe(id);
    // The list reflects the edit.
    const after = (await provider.list(CELL))[0]!;
    expect(after.fact).toBe('Steve HATES serif fonts');
    expect(Date.parse(after.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
  });

  it('editing a missing fact throws', async () => {
    const provider = new InMemoryMemoryProvider();
    await expect(provider.edit({ id: 'nope', fact: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('BRAIN-006 — expirable', () => {
  it('an expired fact is no longer recalled', async () => {
    const provider = new InMemoryMemoryProvider();
    const { results } = await store(provider, CELL, ['Steve wants weekly ad reports']);

    // Sanity: recalled while live.
    const live = await provider.recall({ query: 'weekly ad reports', scope: CELL, topK: 5 });
    expect(live).toHaveLength(1);

    // Expire it in the past.
    const past = new Date(Date.now() - 60_000).toISOString();
    const expired = await provider.expire({ id: results[0]!.id, expiresAt: past });
    expect(expired.expiresAt).toBe(past);

    // No longer recalled.
    const after = await provider.recall({ query: 'weekly ad reports', scope: CELL, topK: 5 });
    expect(after).toHaveLength(0);
  });

  it('a future expiry keeps the fact recallable', async () => {
    const provider = new InMemoryMemoryProvider();
    const { results } = await store(provider, CELL, ['Steve reviews launches on Fridays']);
    const future = new Date(Date.now() + 60_000).toISOString();
    await provider.expire({ id: results[0]!.id, expiresAt: future });

    const recalled = await provider.recall({ query: 'launches on Fridays', scope: CELL, topK: 5 });
    expect(recalled).toHaveLength(1);
  });
});

describe('BRAIN-006 — deletable (end-to-end deletion)', () => {
  it('store \u2192 list N \u2192 delete each \u2192 list 0', async () => {
    const provider = new InMemoryMemoryProvider();
    const seeded = [
      'Steve prefers modern-minimal design',
      'Steve is a non-technical founder',
      'Steve uses a Pixel 10',
    ];
    const { results } = await store(provider, CELL, seeded);
    expect(results).toHaveLength(3);

    // Reviewable: all three present.
    expect(await provider.list(CELL)).toHaveLength(3);

    // Deletable: remove every one.
    for (const { id } of results) {
      await provider.remove(id);
    }

    // End state: nothing left to recall or list.
    expect(await provider.list(CELL)).toHaveLength(0);
    expect(
      await provider.recall({ query: 'modern-minimal design Pixel', scope: CELL, topK: 10 }),
    ).toHaveLength(0);
  });

  it('removing a missing fact throws (idempotent-safe surface)', async () => {
    const provider = new InMemoryMemoryProvider();
    await expect(provider.remove('ghost')).rejects.toThrow(/not found/);
  });

  it('deleting one fact leaves its siblings intact', async () => {
    const provider = new InMemoryMemoryProvider();
    const { results } = await store(provider, CELL, ['fact A', 'fact B', 'fact C']);
    await provider.remove(results[1]!.id);

    const remaining = await provider.list(CELL);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((f) => f.fact)).toEqual(['fact A', 'fact C']);
  });
});

describe('BRAIN-006 — cell/room scoping (FRANK-\u00a72.4)', () => {
  it('memory never leaks across rooms', async () => {
    const provider = new InMemoryMemoryProvider();
    await store(provider, ROOM_BLOCKWISE, ['Blockwise runs Meta ad scraping']);
    await store(provider, ROOM_CHASE, ['Chase\u2019s Game turns selfies into characters']);

    const blockwise = await provider.list(ROOM_BLOCKWISE);
    const chase = await provider.list(ROOM_CHASE);

    expect(blockwise).toHaveLength(1);
    expect(chase).toHaveLength(1);
    expect(blockwise[0]!.fact).toContain('Meta ad scraping');
    expect(chase[0]!.fact).toContain('selfies');

    // Deleting Blockwise\u2019s fact does not touch Chase\u2019s.
    await provider.remove(blockwise[0]!.id);
    expect(await provider.list(ROOM_BLOCKWISE)).toHaveLength(0);
    expect(await provider.list(ROOM_CHASE)).toHaveLength(1);
  });
});
