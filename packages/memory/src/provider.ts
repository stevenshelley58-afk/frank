/**
 * The memory port — FRANK-§7.4, BRAIN-006.
 *
 * FRANK OWNS memory. Harnesses (Goose today; Hermes, Codex, Claude Code later)
 * never do. This file is the contract that makes that true: everything a caller
 * in `packages/kernel` or `apps/api` knows about memory goes through
 * {@link MemoryProvider}. Nothing here imports a mem0 client, knows a mem0 URL,
 * or parses a mem0 response shape — that lives in `mem0-provider.ts`, which is
 * ONE implementation, not this package's shape.
 *
 * ## What the port is, and what it deliberately is not
 *
 * {@link MemoryProvider.recall} returns a MINIMIZED set of facts, most relevant
 * first, each stamped `generated-untrusted` (FRANK-§2.3). It is not a dump of
 * everything Frank knows. FRANK-§7.4 is explicit that "agents do not inherit all
 * of FRANK's memory merely because they can access a tool" — the kernel decides
 * the minimized set and carries it in a context pack's distinct memory section.
 *
 * {@link MemoryProvider.store} takes conversation turns and lets the backend
 * extract durable facts. It does not take pre-formatted facts: extraction is the
 * backend's job, so a swappable backend (mem0's Gemini extraction today, a
 * local model tomorrow) stays free to do it its own way.
 *
 * BRAIN-006 requires memory to be reviewable, editable, expirable, and
 * deletable. Those are first-class methods here ({@link MemoryProvider.list},
 * {@link MemoryProvider.edit}, {@link MemoryProvider.expire},
 * {@link MemoryProvider.remove}) rather than an admin back-door, because the
 * memory-control surface Steven reviews calls exactly these — there is no other
 * path to the data.
 *
 * ## Scoping
 *
 * Every call is scoped by {@link MemoryScope}. FRANK-§2.4: all state is scoped
 * to one cell. Within a cell, memory further separates personal knowledge from
 * project and room knowledge so a Builder agent working one project does not
 * recall another project's private facts. The scope maps onto whatever
 * partitioning the backend offers (mem0's user_id / agent_id / run_id filters)
 * in the implementation; the port speaks only in Frank's own vocabulary.
 */

import type { DataClass, TrustLabel } from '@frank/contracts';

/**
 * The scope a memory call operates in. FRANK-§2.4 cell scoping is mandatory;
 * project and room are optional narrowing dimensions.
 */
export interface MemoryScope {
  /** FRANK-§2.4: every piece of state lives in exactly one cell. */
  readonly cellId: string;
  /** The human owner the memory is about. Personal knowledge. */
  readonly ownerId: string;
  /** Set when the memory belongs to a specific project. */
  readonly projectId?: string;
  /** Set when the memory belongs to a specific collaboration room. */
  readonly roomId?: string;
}

/**
 * A single recalled fact, as it enters a context pack.
 *
 * Mirrors `RecalledMemory` from `@frank/contracts` so the kernel can drop these
 * straight into a pack's memory section without a translation layer. `trust` is
 * always `generated-untrusted` for a recall: FRANK-§2.3 forbids promoting an
 * ordinary recall, and the assembler enforces that, not the backend.
 */
export interface RecalledFact {
  readonly fact: string;
  readonly trust: TrustLabel;
  readonly sourceId: string;
  readonly classification: DataClass;
  /** Relevance 0..1 from the backend's ranking. */
  readonly relevance: number;
  /** When the fact was last confirmed, if the backend knows. */
  readonly confirmedAt?: string;
}

/** A stored fact as the backend reports it, for the memory-control surface. */
export interface StoredFact {
  /** Backend-stable identifier, opaque to Frank. */
  readonly id: string;
  readonly fact: string;
  readonly scope: MemoryScope;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

/** Input to {@link MemoryProvider.store}: the turns the backend extracts from. */
export interface StoreInput {
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant' | 'system';
    readonly content: string;
  }>;
}

/**
 * The memory port. One implementation per backend; the kernel is composed with
 * exactly one at startup and nothing else changes — the swappability
 * requirement that keeps Frank from being a skin over any one memory system.
 */
export interface MemoryProvider {
  /** Backend identity for evidence and the control surface, e.g. `mem0@vps:8888`. */
  readonly name: string;

  /**
   * Recall a minimized, relevance-ranked set of facts for a query within a
   * scope. FRANK-§7.4. Returns an empty array (never throws for "nothing
   * relevant") so the kernel can distinguish "looked, found nothing" from a
   * backend failure, which surfaces as a thrown error.
   */
  recall(input: {
    query: string;
    scope: MemoryScope;
    /** Cap on returned facts; the kernel sets the pack's minimization budget. */
    topK: number;
  }): Promise<readonly RecalledFact[]>;

  /**
   * Hand conversation turns to the backend to extract and persist durable facts
   * within a scope. Returns the identifiers the backend created or updated.
   */
  store(input: {
    messages: StoreInput['messages'];
    scope: MemoryScope;
  }): Promise<{ results: ReadonlyArray<{ id: string; event: string }> }>;

  /** List facts in a scope, for the reviewable memory-control surface. */
  list(scope: MemoryScope): Promise<readonly StoredFact[]>;

  /** BRAIN-006 editable: rewrite a fact's text. */
  edit(input: { id: string; fact: string }): Promise<StoredFact>;

  /** BRAIN-006 expirable: set an expiry after which the fact is not recalled. */
  expire(input: { id: string; expiresAt: string }): Promise<StoredFact>;

  /** BRAIN-006 deletable: permanently remove a fact. */
  remove(id: string): Promise<void>;

  /** Health for the System screen and startup checks. */
  health(): Promise<{ healthy: boolean; backend: string; latencyMs?: number }>;
}
