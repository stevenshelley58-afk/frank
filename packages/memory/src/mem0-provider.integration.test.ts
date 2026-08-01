/**
 * Integration test for {@link Mem0Provider} against a LIVE self-hosted mem0
 * server. Gated: it is SKIPPED unless `MEM0_INTEGRATION_URL` and
 * `MEM0_INTEGRATION_KEY` are set, so the hermetic test suite (no network)
 * stays green everywhere, and the real wire behavior is proven where a server
 * exists (e.g. the VPS, which has both in its env).
 *
 * Run on the VPS:
 *   MEM0_INTEGRATION_URL=http://localhost:8888 \
 *   MEM0_INTEGRATION_KEY=*** \
 *   pnpm --filter @frank/memory test
 *
 * Uses a throwaway user_id (integration-<timestamp>) so it never touches real
 * memories, and deletes the facts it created on the way out.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { Mem0Provider } from './mem0-provider.js';
import type { MemoryScope } from './provider.js';

const url = process.env.MEM0_INTEGRATION_URL;
const key = process.env.MEM0_INTEGRATION_KEY;

// Build the suite ONLY when a live server is configured. A bare `describe.skip`
// would still run the factory (and eagerly construct the provider with an
// undefined baseUrl), so the whole block is gated instead.
if (url && key) {
  describe('Mem0Provider against a live self-hosted server', () => {
    const provider = new Mem0Provider({ baseUrl: url, apiKey: key });
    const scope: MemoryScope = {
      cellId: 'integration',
      ownerId: `test-${Date.now()}`,
    };
    const created: string[] = [];

    afterAll(async () => {
      for (const id of created) {
        await provider.remove(id).catch(() => undefined);
      }
    });

    it('health reports healthy', async () => {
      const h = await provider.health();
      expect(h.healthy).toBe(true);
      expect(h.backend).toContain('mem0@');
    });

    it('store extracts, recall returns it generated-untrusted, BRAIN-006 CRUD works', async () => {
      // Store a distinctive fact.
      const stored = await provider.store({
        messages: [
          { role: 'user', content: 'My favorite integration test color is cerulean blue.' },
        ],
        scope,
      });
      expect(stored.results.length).toBeGreaterThan(0);

      // Recall it back.
      const hits = await provider.recall({
        query: 'favorite color for the integration test',
        scope,
        topK: 5,
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.trust).toBe('generated-untrusted');
      expect(hits[0]?.fact.toLowerCase()).toContain('cerulean');

      // Track ids for cleanup + BRAIN-006 checks.
      const all = await provider.list(scope);
      for (const f of all) created.push(f.id);
      const target = all[0];
      expect(target).toBeDefined();

      // Editable.
      const edited = await provider.edit({ id: target!.id, fact: 'Favorite test color is teal.' });
      expect(edited.fact).toContain('teal');

      // Deletable.
      await provider.remove(target!.id);
      const afterRemove = await provider.list(scope);
      expect(afterRemove.map((f) => f.id)).not.toContain(target!.id);
    }, 30_000);
  });
} else {
  // Hermetic default: record why the live suite is absent.
  describe('Mem0Provider integration', () => {
    it.skip('requires MEM0_INTEGRATION_URL and MEM0_INTEGRATION_KEY', () => undefined);
  });
}
