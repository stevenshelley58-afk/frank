/**
 * FRANK-§11.5: "The canonical audit log is append-only and hash-linked...
 * tamper tests must fail external-root verification."
 *
 * The chain is built and attacked here without a database. The database-side
 * guarantees (the append-only trigger, per-cell serialization) are in
 * `integration/audit.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  GENESIS_CHAIN_HASH,
  computeChainHash,
  computeEntryHash,
  verifyAuditChain,
} from './audit-chain.js';
import type { AuditChainLink, AuditEntryContent } from './audit-chain.js';

function content(seq: bigint, overrides: Partial<AuditEntryContent> = {}): AuditEntryContent {
  return {
    cellId: 'cell-steven',
    seq,
    occurredAt: '2026-07-28T12:00:00.000Z',
    actorKind: 'user',
    actorId: 'steven',
    delegatedActorKind: null,
    delegatedActorId: null,
    action: 'work.state_changed',
    targetKind: 'work_item',
    targetId: '01920000-0000-7000-8000-000000000001',
    correlationId: 'run-789',
    causationId: null,
    policyVersion: 'autonomous-internal-work@3.2.0',
    policyDecision: 'allow',
    beforeHash: null,
    afterHash: null,
    changeRedacted: { field: 'state', from: 'active', to: 'done' },
    changeEncrypted: null,
    dataClass: 'internal',
    receiptRef: null,
    evidenceUri: null,
    evidenceSha256: null,
    ...overrides,
  };
}

/** Build a well-formed chain of `n` links starting from genesis. */
function chain(n: number, mutate: (seq: number) => Partial<AuditEntryContent> = () => ({})): AuditChainLink[] {
  const links: AuditChainLink[] = [];
  let previous = GENESIS_CHAIN_HASH;
  for (let i = 1; i <= n; i += 1) {
    const c = content(BigInt(i), mutate(i));
    const entryHash = computeEntryHash(c);
    const chainHash = computeChainHash(previous, entryHash);
    links.push({ content: c, entryHash, prevChainHash: previous, chainHash });
    previous = chainHash;
  }
  return links;
}

describe('computeEntryHash', () => {
  it('is deterministic', () => {
    const c = content(1n);
    const first = computeEntryHash(c);
    for (let i = 0; i < 20; i += 1) expect(computeEntryHash(c)).toBe(first);
  });

  it('produces a prefixed lowercase SHA-256 digest', () => {
    expect(computeEntryHash(content(1n))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when any recorded field changes', () => {
    const baseline = computeEntryHash(content(1n));
    const variants: Array<Partial<AuditEntryContent>> = [
      { cellId: 'cell-other' },
      { seq: 2n },
      { occurredAt: '2026-07-28T12:00:00.001Z' },
      { actorKind: 'agent' },
      { actorId: 'someone-else' },
      { delegatedActorId: 'agent/reviewer' },
      { action: 'work.created' },
      { targetKind: 'source' },
      { targetId: 'other' },
      { correlationId: 'run-000' },
      { causationId: 'evt-1' },
      { policyVersion: 'other@1.0.0' },
      { policyDecision: 'deny' },
      { beforeHash: `sha256:${'11'.repeat(32)}` },
      { afterHash: `sha256:${'22'.repeat(32)}` },
      { changeRedacted: { field: 'state', from: 'active', to: 'cancelled' } },
      { changeEncrypted: 'frank.enc.v1.x.y' },
      { dataClass: 'sensitive' },
      { receiptRef: 'receipt-1' },
      { evidenceUri: 's3://bucket/evidence.json' },
      { evidenceSha256: `sha256:${'33'.repeat(32)}` },
    ];
    for (const overrides of variants) {
      const label = Object.keys(overrides).join(',');
      expect(computeEntryHash(content(1n, overrides)), label).not.toBe(baseline);
    }
  });

  it('is insensitive to the key order of the redacted change', () => {
    const a = content(1n, { changeRedacted: { from: 'active', to: 'done', field: 'state' } });
    const b = content(1n, { changeRedacted: { field: 'state', from: 'active', to: 'done' } });
    expect(computeEntryHash(a)).toBe(computeEntryHash(b));
  });

  it('handles a sequence number beyond the safe integer range', () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(computeEntryHash(content(huge))).not.toBe(
      computeEntryHash(content(huge + 1n)),
    );
  });
});

describe('computeChainHash', () => {
  it('links deterministically', () => {
    const entryHash = computeEntryHash(content(1n));
    expect(computeChainHash(GENESIS_CHAIN_HASH, entryHash)).toBe(
      computeChainHash(GENESIS_CHAIN_HASH, entryHash),
    );
  });

  it('depends on both inputs', () => {
    const a = computeEntryHash(content(1n));
    const b = computeEntryHash(content(2n));
    expect(computeChainHash(GENESIS_CHAIN_HASH, a)).not.toBe(computeChainHash(GENESIS_CHAIN_HASH, b));
    expect(computeChainHash(GENESIS_CHAIN_HASH, a)).not.toBe(
      computeChainHash(computeChainHash(GENESIS_CHAIN_HASH, b), a),
    );
  });

  it('refuses an input that is not a prefixed digest', () => {
    const good = computeEntryHash(content(1n));
    expect(() => computeChainHash('not-a-hash', good)).toThrow(TypeError);
    expect(() => computeChainHash(GENESIS_CHAIN_HASH, 'deadbeef')).toThrow(TypeError);
    expect(() => computeChainHash(GENESIS_CHAIN_HASH, good.toUpperCase())).toThrow(TypeError);
  });
});

describe('verifyAuditChain', () => {
  it('accepts an empty chain and reports genesis as the head', () => {
    const result = verifyAuditChain([]);
    expect(result).toEqual({ ok: true, checked: 0, headChainHash: GENESIS_CHAIN_HASH });
  });

  it('accepts a well-formed chain', () => {
    const links = chain(50);
    const result = verifyAuditChain(links);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checked).toBe(50);
      expect(result.headChainHash).toBe(links[49]!.chainHash);
    }
  });

  it('detects an edited entry — the content no longer hashes to its stored digest', () => {
    const links = chain(10);
    links[4] = {
      ...links[4]!,
      content: { ...links[4]!.content, action: 'work.cancelled' },
    };

    const result = verifyAuditChain(links);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('entry_hash_mismatch');
      expect(result.atSeq).toBe(5n);
    }
  });

  it('detects a rewritten link column', () => {
    const links = chain(10);
    const forged = computeChainHash(links[5]!.prevChainHash, computeEntryHash(content(999n)));
    links[5] = { ...links[5]!, chainHash: forged };

    const result = verifyAuditChain(links);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('chain_hash_mismatch');
  });

  it('detects a removed entry', () => {
    const links = chain(10);
    links.splice(4, 1);

    const result = verifyAuditChain(links);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('sequence_gap');
  });

  it('detects an inserted entry, even a perfectly-formed one', () => {
    // An attacker who can compute hashes still cannot splice a row in without
    // rewriting every successor, because each `prev_chain_hash` pins the one
    // before it.
    const links = chain(10);
    const injectedContent = content(6n, { action: 'policy.decision_recorded' });
    const injectedEntryHash = computeEntryHash(injectedContent);
    links.splice(5, 0, {
      content: injectedContent,
      entryHash: injectedEntryHash,
      prevChainHash: links[4]!.chainHash,
      chainHash: computeChainHash(links[4]!.chainHash, injectedEntryHash),
    });

    const result = verifyAuditChain(links);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['broken_link', 'sequence_gap']).toContain(result.failure);
  });

  it('detects reordered entries', () => {
    const links = chain(10);
    const a = links[3]!;
    const b = links[4]!;
    links[3] = b;
    links[4] = a;

    const result = verifyAuditChain(links);
    expect(result.ok).toBe(false);
  });

  it('detects a truncated-then-rebuilt tail that does not match the exported root', () => {
    // FRANK-§11.5: this is what the signed off-cell root defends against. An
    // attacker who controls the database can rebuild a *self-consistent* chain
    // from any point; the rebuilt chain verifies internally but its head no
    // longer equals the exported root.
    const original = chain(10);
    const exportedRoot = original[9]!.chainHash;

    const rebuilt = chain(10, (seq) => (seq >= 8 ? { action: 'work.cancelled' } : {}));
    expect(verifyAuditChain(rebuilt).ok).toBe(true); // internally consistent
    expect(rebuilt[9]!.chainHash).not.toBe(exportedRoot); // but fails the root check
  });

  it('verifies a suffix against a supplied starting hash', () => {
    const links = chain(10);
    const suffix = links.slice(5);
    expect(verifyAuditChain(suffix, links[4]!.chainHash).ok).toBe(true);
  });

  it('reports a broken link when a suffix is verified against the wrong starting hash', () => {
    const links = chain(10);
    const result = verifyAuditChain(links.slice(5), GENESIS_CHAIN_HASH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('broken_link');
  });

  it('reports how many links it checked before failing', () => {
    const links = chain(10);
    links[7] = { ...links[7]!, entryHash: computeEntryHash(content(999n)) };
    const result = verifyAuditChain(links);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.checked).toBe(7);
  });
});
