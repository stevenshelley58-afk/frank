/**
 * Context-pack assembler — FRANK-§7.4.
 *
 * Builds a signed, hash-addressed, minimized manifest of what an agent is
 * allowed to know for one assignment. The pack is the single boundary between
 * FRANK's memory and a harness: an agent never inherits all of FRANK's
 * knowledge merely because a tool could reach it.
 *
 * ## Assembly procedure
 *
 * 1. The caller supplies the assignment's non-memory fields (goal, sources,
 *    tools, budget, escalation, etc.) via {@link AssembleInput}.
 * 2. The assembler recalls memory through {@link MemoryProvider.recall} using
 *    the goal as the query, scoped to the assignment's cell/owner/project.
 * 3. Recalled facts are stamped `generated-untrusted` (FRANK-§2.3) and placed
 *    in the pack's distinct `memory` section.
 * 4. The pack body (everything except `integrity`) is canonicalized and
 *    SHA-256 hashed to produce `contentHash`.
 * 5. The hash is signed via the policy package's `SigningKeyResolver` +
 *    HMAC-SHA256, producing the `integrity` block.
 *
 * ## Invariants enforced here
 *
 * - **MINIMIZED**: only the `topK` most relevant recalled facts enter the
 *   pack. The assembler does not dump memory.
 * - **HASH-ADDRESSED**: `contentHash` covers every field except `integrity`,
 *   so a pack is content-addressable and tamper-evident.
 * - **REPRODUCIBLE**: canonical JSON with sorted keys ensures the same inputs
 *   produce the same hash.
 * - **SIGNED**: the assembler signs with a key resolved by handle; the key
 *   material never enters the pack.
 * - **MEMORY IS LOWER-TRUST**: every recalled fact carries
 *   `trust: 'generated-untrusted'`. The assembler refuses to stamp a higher
 *   trust label.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type {
  AssignmentBudget,
  ContextPack,
  ContextPackIntegrity,
  ContextSource,
  CredentialHandle,
  DataClass,
  EgressRule,
  EscalationPolicy,
  IsoDateTime,
  MemorySection,
  RecalledMemory,
  RequirementRef,
  ToolGrant,
} from '@frank/contracts';
import type { MemoryProvider, MemoryScope } from '@frank/memory';
import type { SigningKeyResolver } from '@frank/policy';

import { canonicalJson } from './canonical-json';
import type { CanonicalValue } from './canonical-json';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The signer has no key material for the given handle. */
export class MissingPackSigningKeyError extends Error {
  readonly keyHandle: string;
  constructor(keyHandle: string) {
    super(
      `No key material for handle ${JSON.stringify(keyHandle)}; ` +
        'cannot sign context pack (FRANK-§7.4).',
    );
    this.name = 'MissingPackSigningKeyError';
    this.keyHandle = keyHandle;
  }
}

/** A recalled fact arrived with a trust label other than generated-untrusted. */
export class UntrustedMemoryViolationError extends Error {
  constructor(fact: string, trust: string) {
    super(
      `Recalled fact ${JSON.stringify(fact.slice(0, 60))} carries trust ` +
        `${JSON.stringify(trust)}; the assembler requires generated-untrusted (FRANK-§2.3).`,
    );
    this.name = 'UntrustedMemoryViolationError';
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Everything the assembler needs from the caller. Memory is recalled
 * internally; the caller does not supply recalled facts directly.
 */
export interface AssembleInput {
  /** Stable id for this pack instance. */
  packId: string;
  /** The run (assignment) this pack is for. */
  assignmentId: string;
  cellId: string;

  // FRANK-§7.4 content fields
  goal: string;
  definitionOfDone: string[];
  requirements: RequirementRef[];
  adrExcerpts?: string[];
  sources: ContextSource[];
  relatedWork?: string[];
  constraints: string[];
  allowedTools: ToolGrant[];
  credentials: CredentialHandle[];
  classification: DataClass;
  egress: EgressRule;
  budget: AssignmentBudget;
  expectedOutputs: string[];
  evidenceSchemaRef: string;
  escalation: EscalationPolicy;

  /** Timestamp for the pack and the signature. */
  now: IsoDateTime;

  // Memory recall parameters
  /** How many recalled facts to include (the minimization budget). */
  recallTopK: number;
  /** Memory scope for the recall. */
  memoryScope: MemoryScope;

  // Signing
  /** Opaque key handle resolved via the SigningKeyResolver. */
  signerId: string;
  keyHandle: string;
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * Assembles context packs. Constructed once with the memory provider and key
 * resolver; reused across assignments.
 */
export class ContextPackAssembler {
  readonly #memory: MemoryProvider;
  readonly #keys: SigningKeyResolver;

  constructor(memory: MemoryProvider, keys: SigningKeyResolver) {
    this.#memory = memory;
    this.#keys = keys;
  }

  /**
   * Assemble a signed context pack for one assignment.
   *
   * The pack is deterministic given the same inputs and the same memory
   * backend state: the body is canonicalized, hashed, and signed.
   */
  async assemble(input: AssembleInput): Promise<ContextPack> {
    const memorySection = await this.#recallMemory(input);
    const body = this.#buildBody(input, memorySection);
    const integrity = this.#sign(body, input);

    return Object.freeze({
      schema: 'frank.context-pack/v1',
      ...body,
      integrity,
    });
  }

  /**
   * Verify a pack's integrity: recompute the content hash and check the
   * signature. Returns `true` if the pack is untampered and correctly signed.
   */
  verify(pack: ContextPack, signerId: string, keyHandle: string): boolean {
    const { integrity, schema: _schema, ...body } = pack;

    // Recompute hash
    const recomputed = this.#hashBody(body as Record<string, unknown>);
    if (recomputed !== integrity.contentHash) return false;

    // Verify signature
    const key = this.#keys.resolve(keyHandle);
    if (key === undefined || key.length === 0) return false;
    const expected = `hmac-sha256:${this.#mac(recomputed, signerId, key)}`;
    if (expected.length !== integrity.signature.length) return false;

    // Constant-time comparison
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(integrity.signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  async #recallMemory(input: AssembleInput): Promise<MemorySection> {
    const facts = await this.#memory.recall({
      query: input.goal,
      scope: input.memoryScope,
      topK: input.recallTopK,
    });

    const recalled: RecalledMemory[] = facts.map((f) => {
      if (f.trust !== 'generated-untrusted') {
        throw new UntrustedMemoryViolationError(f.fact, f.trust);
      }
      const mem: RecalledMemory = {
        fact: f.fact,
        trust: f.trust,
        sourceId: f.sourceId,
        classification: f.classification,
        relevance: f.relevance,
      };
      if (f.confirmedAt !== undefined) {
        return { ...mem, confirmedAt: f.confirmedAt };
      }
      return mem;
    });

    return {
      recalled,
      recallQuery: input.goal,
      backend: this.#memory.name,
    };
  }

  #buildBody(
    input: AssembleInput,
    memory: MemorySection,
  ): Omit<ContextPack, 'schema' | 'integrity'> {
    const body: Record<string, unknown> = {
      packId: input.packId,
      assignmentId: input.assignmentId,
      cellId: input.cellId,
      createdAt: input.now,
      goal: input.goal,
      definitionOfDone: input.definitionOfDone,
      requirements: input.requirements,
      sources: input.sources,
      constraints: input.constraints,
      allowedTools: input.allowedTools,
      credentials: input.credentials,
      classification: input.classification,
      egress: input.egress,
      budget: input.budget,
      expectedOutputs: input.expectedOutputs,
      evidenceSchemaRef: input.evidenceSchemaRef,
      escalation: input.escalation,
      memory,
    };

    if (input.adrExcerpts !== undefined) body['adrExcerpts'] = input.adrExcerpts;
    if (input.relatedWork !== undefined) body['relatedWork'] = input.relatedWork;

    return body as unknown as Omit<ContextPack, 'schema' | 'integrity'>;
  }

  #hashBody(body: Record<string, unknown>): string {
    const json = canonicalJson(body as CanonicalValue, 'stringify');
    return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
  }

  #mac(contentHash: string, signerId: string, key: Uint8Array): string {
    return createHmac('sha256', key)
      .update(Buffer.from(`hmac-sha256\u0000${signerId}\u0000`, 'utf8'))
      .update(Buffer.from(contentHash, 'utf8'))
      .digest('hex');
  }

  #sign(
    body: Omit<ContextPack, 'schema' | 'integrity'>,
    input: AssembleInput,
  ): ContextPackIntegrity {
    const contentHash = this.#hashBody(body as unknown as Record<string, unknown>);

    const key = this.#keys.resolve(input.keyHandle);
    if (key === undefined || key.length === 0) {
      throw new MissingPackSigningKeyError(input.keyHandle);
    }

    const signature = `hmac-sha256:${this.#mac(contentHash, input.signerId, key)}`;

    return Object.freeze({
      contentHash,
      signerId: input.signerId,
      signature,
      signedAt: input.now,
    });
  }
}
