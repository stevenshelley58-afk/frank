/**
 * Port-contract tests for `@frank/memory`.
 *
 * These assert the CONTRACT, using the in-memory fake, so they hold for ANY
 * backend: minimization, relevance ordering, generated-untrusted trust, scope
 * isolation, and the BRAIN-006 reviewable/editable/expirable/deletable surface.
 * The mem0 implementation's wire behavior is covered by an integration test
 * gated on a live server (see mem0-provider.integration.test.ts).
 */

import { describe, expect, it } from 'vitest';

import { InMemoryMemoryProvider } from './in-memory-provider.js';
import type { MemoryScope } from './provider.js';

const personal: MemoryScope = { cellId: 'cell-steven-primary', ownerId: 'steve' };
const projectA: MemoryScope = { ...personal, projectId: 'blockwise' };
const projectB: MemoryScope = { ...personal, projectId: 'merrypaws' };

async function seeded(): Promise<InMemoryMemoryProvider> {
  const p = new InMemoryMemoryProvider();
  await p.store({
    messages: [
      { role: 'user', content: 'I use an Android Pixel 10 smartphone, not an iPhone.' },
      { role: 'assistant', content: 'Noted — Pixel 10, Android.' },
      { role: 'user', content: 'I run a company called Blockwise and am building Frank.' },
    ],
    scope: personal,
  });
  return p;
}

describe('MemoryProvider port contract', () => {
  it('recall is relevance-ranked and minimized to topK', async () => {
    const p = await seeded();
    const hits = await p.recall({ query: 'which smartphone device do I use', scope: personal, topK: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.fact).toContain('Pixel 10');
    // The irrelevant fact must not outrank the relevant one within the budget.
    expect(hits[0]?.fact).not.toContain('Blockwise');
  });

  it('every recalled fact is generated-untrusted (FRANK-§2.3)', async () => {
    const p = await seeded();
    const hits = await p.recall({ query: 'smartphone', scope: personal, topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.trust).toBe('generated-untrusted');
      expect(hit.sourceId).toMatch(/^mem:\/\//);
    }
  });

  it('recall returns empty (not throws) when nothing is relevant', async () => {
    const p = await seeded();
    const hits = await p.recall({ query: 'quantum chromodynamics lattice', scope: personal, topK: 5 });
    expect(hits).toEqual([]);
  });

  it('scopes are isolated: a project recall does not leak personal-only facts', async () => {
    const p = new InMemoryMemoryProvider();
    await p.store({ messages: [{ role: 'user', content: 'Blockwise uses Stripe for billing.' }], scope: projectA });
    await p.store({ messages: [{ role: 'user', content: 'MerryPaws uses a different payment provider.' }], scope: projectB });

    const a = await p.recall({ query: 'billing payment provider', scope: projectA, topK: 5 });
    expect(a.map((h) => h.fact)).toContain('Blockwise uses Stripe for billing.');
    expect(a.map((h) => h.fact)).not.toContain('MerryPaws uses a different payment provider.');
  });

  it('BRAIN-006: facts are reviewable, editable, expirable, and deletable', async () => {
    const p = await seeded();

    // Reviewable.
    const all = await p.list(personal);
    expect(all).toHaveLength(2);
    const target = all[0];
    expect(target).toBeDefined();

    // Editable.
    const edited = await p.edit({ id: target!.id, fact: 'I use an Android Pixel 10.' });
    expect(edited.fact).toBe('I use an Android Pixel 10.');

    // Deletable.
    await p.remove(target!.id);
    const afterRemove = await p.list(personal);
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove.map((f) => f.id)).not.toContain(target!.id);

    // Expirable: an expired fact is no longer recalled.
    const survivor = afterRemove[0]!;
    await p.expire({ id: survivor.id, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const hits = await p.recall({ query: 'Blockwise Frank company', scope: personal, topK: 5 });
    expect(hits).toEqual([]);
  });

  it('edit/remove on an unknown id throws (fail closed)', async () => {
    const p = await seeded();
    await expect(p.edit({ id: 'nope', fact: 'x' })).rejects.toThrow(/not found/);
    await expect(p.remove('nope')).rejects.toThrow(/not found/);
  });

  it('store ignores non-user turns (extraction boundary is the backend)', async () => {
    const p = new InMemoryMemoryProvider();
    const { results } = await p.store({
      messages: [
        { role: 'system', content: 'You are Frank.' },
        { role: 'assistant', content: 'I should not be stored.' },
        { role: 'user', content: 'Only this user fact should persist.' },
      ],
      scope: personal,
    });
    expect(results).toHaveLength(1);
    const all = await p.list(personal);
    expect(all.map((f) => f.fact)).toEqual(['Only this user fact should persist.']);
  });

  it('health reports the backend name', async () => {
    const p = new InMemoryMemoryProvider();
    const h = await p.health();
    expect(h.healthy).toBe(true);
    expect(h.backend).toBe('in-memory');
  });
});
