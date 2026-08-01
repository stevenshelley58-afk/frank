/**
 * Tests for @frank/kernel — FRANK-§7.4 context-pack assembly.
 *
 * Covers:
 *  - canonical-json: sorted keys, float policy, determinism, edge cases
 *  - ContextPackAssembler: assembly, signing, verification, tamper detection,
 *    memory recall integration, trust-label enforcement
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { InMemoryMemoryProvider } from '@frank/memory';
import { InMemoryKeyResolver } from '@frank/policy';

import {
  ContextPackAssembler,
  MissingPackSigningKeyError,
  UntrustedMemoryViolationError,
  canonicalJson,
} from './index.js';
import { NonCanonicalValueError } from './canonical-json.js';

// ---------------------------------------------------------------------------
// canonical-json
// ---------------------------------------------------------------------------

describe('canonicalJson', () => {
  it('sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: 'x', a: 'y', m: 'z' })).toBe('{"a":"y","m":"z","z":"x"}');
  });

  it('sorts nested keys', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 0 })).toBe('{"a":0,"b":{"c":2,"d":1}}');
  });

  it('handles arrays', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('omits undefined object properties', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('rejects undefined in arrays', () => {
    expect(() => canonicalJson([1, undefined as unknown as null])).toThrow(
      NonCanonicalValueError,
    );
  });

  it('rejects NaN and Infinity', () => {
    expect(() => canonicalJson(NaN)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(Infinity)).toThrow(NonCanonicalValueError);
  });

  it('rejects floats with default policy', () => {
    expect(() => canonicalJson(0.5)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(1.1)).toThrow(NonCanonicalValueError);
  });

  it('stringifies floats with stringify policy', () => {
    expect(canonicalJson(0.5, 'stringify')).toBe('0.5');
    expect(canonicalJson(1.1, 'stringify')).toBe('1.1');
    expect(canonicalJson({ relevance: 0.87 }, 'stringify')).toBe('{"relevance":0.87}');
  });

  it('normalizes -0 to 0', () => {
    expect(canonicalJson(-0)).toBe('0');
  });

  it('is deterministic: same value, same string', () => {
    const value = { z: [1, { b: 'x', a: null }], a: true };
    expect(canonicalJson(value)).toBe(canonicalJson(value));
  });

  it('rejects Date objects', () => {
    expect(() => canonicalJson(new Date() as unknown as string)).toThrow(
      NonCanonicalValueError,
    );
  });
});

// ---------------------------------------------------------------------------
// ContextPackAssembler
// ---------------------------------------------------------------------------

const KEY_HANDLE = 'handle:frank-pack-signer';
const SIGNER_ID = 'service:frank-kernel';
const KEY = randomBytes(32);

function makeResolver(): InMemoryKeyResolver {
  return new InMemoryKeyResolver([[KEY_HANDLE, KEY]]);
}

function makeMemoryWithFacts(): InMemoryMemoryProvider {
  const mem = new InMemoryMemoryProvider();
  // Seed some facts asynchronously
  const scope = { cellId: 'cell-1', ownerId: 'owner-1' };
  // store is async but we can fire-and-forget for test setup
  void mem.store({
    messages: [
      { role: 'user', content: 'The deploy target is production cluster us-east-1' },
      { role: 'user', content: 'Steven prefers TypeScript strict mode' },
      { role: 'user', content: 'The budget cap is $50 per run' },
    ],
    scope,
  });
  return mem;
}

function makeInput(overrides: Partial<Parameters<ContextPackAssembler['assemble']>[0]> = {}) {
  return {
    packId: 'pack-001',
    assignmentId: 'run-abc',
    cellId: 'cell-1',
    goal: 'deploy the service to production cluster us-east-1',
    definitionOfDone: ['service responds to health checks', 'zero downtime'],
    requirements: ['FRANK-§7.4', 'FRANK-§7.6'],
    sources: [{ path: 'apps/api/src/server.ts' }],
    constraints: ['no data loss', 'rollback within 60s'],
    allowedTools: [{ handle: 'tool://deploy.apply', capability: 'apply deployment' }],
    credentials: [{ handle: 'secret://cloudflare.token', classification: 'secret' as const }],
    classification: 'internal' as const,
    egress: 'frank-internal-only' as const,
    budget: {
      maxSpend: 50,
      currency: 'USD',
      deadline: '2026-01-01T00:00:00Z',
      maxRetries: 2,
    },
    expectedOutputs: ['deployment receipt', 'health check log'],
    evidenceSchemaRef: 'schema://frank.evidence/v1',
    escalation: {
      escalateWhen: ['budget exceeds $50', 'data loss detected'],
      doNotAssume: ['production credentials are valid'],
    },
    now: '2026-08-01T12:00:00Z',
    recallTopK: 5,
    memoryScope: { cellId: 'cell-1', ownerId: 'owner-1' },
    signerId: SIGNER_ID,
    keyHandle: KEY_HANDLE,
    ...overrides,
  };
}

describe('ContextPackAssembler', () => {
  it('assembles a valid pack with all required fields', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const pack = await assembler.assemble(makeInput());

    expect(pack.schema).toBe('frank.context-pack/v1');
    expect(pack.packId).toBe('pack-001');
    expect(pack.assignmentId).toBe('run-abc');
    expect(pack.cellId).toBe('cell-1');
    expect(pack.goal).toContain('deploy');
    expect(pack.definitionOfDone).toHaveLength(2);
    expect(pack.requirements).toEqual(['FRANK-§7.4', 'FRANK-§7.6']);
    expect(pack.sources).toHaveLength(1);
    expect(pack.constraints).toHaveLength(2);
    expect(pack.allowedTools).toHaveLength(1);
    expect(pack.credentials).toHaveLength(1);
    expect(pack.classification).toBe('internal');
    expect(pack.egress).toBe('frank-internal-only');
    expect(pack.budget.maxSpend).toBe(50);
    expect(pack.expectedOutputs).toHaveLength(2);
    expect(pack.evidenceSchemaRef).toBe('schema://frank.evidence/v1');
    expect(pack.escalation.escalateWhen).toHaveLength(2);
    expect(pack.integrity.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(pack.integrity.signerId).toBe(SIGNER_ID);
    expect(pack.integrity.signature).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(pack.integrity.signedAt).toBe('2026-08-01T12:00:00Z');
  });

  it('includes optional fields when provided', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const pack = await assembler.assemble(
      makeInput({
        adrExcerpts: ['ADR-001: use HMAC for Slice 1'],
        relatedWork: ['FRANK-§6.9 policy engine'],
      }),
    );

    expect(pack.adrExcerpts).toEqual(['ADR-001: use HMAC for Slice 1']);
    expect(pack.relatedWork).toEqual(['FRANK-§6.9 policy engine']);
  });

  it('omits optional fields when not provided', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const pack = await assembler.assemble(makeInput());

    expect(pack.adrExcerpts).toBeUndefined();
    expect(pack.relatedWork).toBeUndefined();
  });

  it('recalls memory into the memory section', async () => {
    const mem = makeMemoryWithFacts();
    // Wait for store to complete
    await new Promise((r) => setTimeout(r, 10));

    const assembler = new ContextPackAssembler(mem, makeResolver());
    const pack = await assembler.assemble(makeInput());

    expect(pack.memory.recallQuery).toBe(makeInput().goal);
    expect(pack.memory.backend).toBe('in-memory');
    // Should recall at least the deploy-related fact
    expect(pack.memory.recalled.length).toBeGreaterThan(0);
    for (const fact of pack.memory.recalled) {
      expect(fact.trust).toBe('generated-untrusted');
      expect(fact.relevance).toBeGreaterThan(0);
    }
  });

  it('returns empty recalled array when nothing is relevant', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const pack = await assembler.assemble(makeInput({ goal: 'zzz no match' }));

    expect(pack.memory.recalled).toEqual([]);
    expect(pack.memory.recallQuery).toBe('zzz no match');
  });

  it('is reproducible: same inputs produce same hash', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const input = makeInput();
    const pack1 = await assembler.assemble(input);
    const pack2 = await assembler.assemble(input);

    expect(pack1.integrity.contentHash).toBe(pack2.integrity.contentHash);
    expect(pack1.integrity.signature).toBe(pack2.integrity.signature);
  });

  it('verify returns true for an untampered pack', async () => {
    const resolver = makeResolver();
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), resolver);
    const pack = await assembler.assemble(makeInput());

    expect(assembler.verify(pack, SIGNER_ID, KEY_HANDLE)).toBe(true);
  });

  it('verify returns false when the goal is tampered', async () => {
    const resolver = makeResolver();
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), resolver);
    const pack = await assembler.assemble(makeInput());

    const tampered = { ...pack, goal: 'deploy to a DIFFERENT target' };
    expect(assembler.verify(tampered, SIGNER_ID, KEY_HANDLE)).toBe(false);
  });

  it('verify returns false when the signature is tampered', async () => {
    const resolver = makeResolver();
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), resolver);
    const pack = await assembler.assemble(makeInput());

    const tampered = {
      ...pack,
      integrity: { ...pack.integrity, signature: 'hmac-sha256:' + '0'.repeat(64) },
    };
    expect(assembler.verify(tampered, SIGNER_ID, KEY_HANDLE)).toBe(false);
  });

  it('verify returns false when the content hash is tampered', async () => {
    const resolver = makeResolver();
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), resolver);
    const pack = await assembler.assemble(makeInput());

    const tampered = {
      ...pack,
      integrity: { ...pack.integrity, contentHash: 'sha256:' + 'f'.repeat(64) },
    };
    expect(assembler.verify(tampered, SIGNER_ID, KEY_HANDLE)).toBe(false);
  });

  it('verify returns false with wrong key', async () => {
    const resolver = makeResolver();
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), resolver);
    const pack = await assembler.assemble(makeInput());

    // A different assembler with a different key
    const otherResolver = new InMemoryKeyResolver([[KEY_HANDLE, randomBytes(32)]]);
    const otherAssembler = new ContextPackAssembler(new InMemoryMemoryProvider(), otherResolver);
    expect(otherAssembler.verify(pack, SIGNER_ID, KEY_HANDLE)).toBe(false);
  });

  it('verify returns false when key handle is unknown', async () => {
    const resolver = makeResolver();
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), resolver);
    const pack = await assembler.assemble(makeInput());

    expect(assembler.verify(pack, SIGNER_ID, 'handle:nonexistent')).toBe(false);
  });

  it('throws MissingPackSigningKeyError when key is unavailable', async () => {
    const emptyResolver = new InMemoryKeyResolver([]);
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), emptyResolver);

    await expect(assembler.assemble(makeInput())).rejects.toThrow(MissingPackSigningKeyError);
  });

  it('enforces generated-untrusted on recalled facts', async () => {
    // A fake provider that returns a fact with the wrong trust label
    const badMem = {
      name: 'bad-mem',
      async recall() {
        return [
          {
            fact: 'I am trusted',
            trust: 'verified-source' as const,
            sourceId: 'mem://1',
            classification: 'internal' as const,
            relevance: 0.9,
          },
        ];
      },
      async store() { return { results: [] }; },
      async list() { return []; },
      async edit() { throw new Error('nope'); },
      async expire() { throw new Error('nope'); },
      async remove() { throw new Error('nope'); },
      async health() { return { healthy: true, backend: 'bad-mem' }; },
    };

    const assembler = new ContextPackAssembler(badMem, makeResolver());
    await expect(assembler.assemble(makeInput())).rejects.toThrow(UntrustedMemoryViolationError);
  });

  it('pack is frozen (immutable)', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const pack = await assembler.assemble(makeInput());

    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.integrity)).toBe(true);
  });

  it('respects recallTopK limit', async () => {
    const mem = makeMemoryWithFacts();
    await new Promise((r) => setTimeout(r, 10));

    const assembler = new ContextPackAssembler(mem, makeResolver());
    const pack = await assembler.assemble(makeInput({ recallTopK: 1 }));

    expect(pack.memory.recalled.length).toBeLessThanOrEqual(1);
  });

  it('memory section uses empty array not omission for no recall', async () => {
    const assembler = new ContextPackAssembler(new InMemoryMemoryProvider(), makeResolver());
    const pack = await assembler.assemble(makeInput({ goal: 'completely unrelated zzz' }));

    // Empty array, not undefined — "we looked and minimized to nothing"
    expect(pack.memory.recalled).toEqual([]);
    expect(pack.memory).toBeDefined();
    expect(pack.memory.backend).toBe('in-memory');
  });
});
