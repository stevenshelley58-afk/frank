/**
 * `schema://frank.context-pack/v1` — FRANK-§7.4.
 *
 * A context pack is a SIGNED manifest of what an agent was allowed to know for
 * one assignment. It is the single boundary between FRANK's memory and a
 * harness: an agent never inherits all of FRANK's knowledge merely because a
 * tool could reach it. FRANK decides, per assignment, the minimized set.
 *
 * Invariants (FRANK-§7.4, non-negotiable):
 *  - MINIMIZED: only what this assignment needs. Not a dump of memory.
 *  - HASH-ADDRESSED: `integrity.contentHash` covers every field except the
 *    integrity block itself, so a pack is content-addressable and tamper-evident.
 *  - REPRODUCIBLE: the same inputs and selection produce the same hash.
 *  - SIGNED: the assembler signs it; the harness receives it as authoritative.
 *
 * Memory is carried in a DISTINCT, lower-trust section. Recalled facts are
 * `generated-untrusted` (FRANK-§2.3): they are evidence to weigh, never system
 * instructions, and a harness must not treat them as policy.
 */

import type { DataClass, TrustLabel } from './classification.js';
import type { IsoDateTime, Sha256 } from './common.js';
import type { RequirementRef } from './evidence.js';

/**
 * A source reference the agent is allowed to read: a file, a symbol, or a
 * bounded slice of one. FRANK-§7.4 "source files or symbols".
 */
export interface ContextSource {
  /** Repository-relative path, e.g. `apps/api/src/config.ts`. */
  path: string;
  /** Optional symbol (function/class) the assignment is scoped to. */
  symbol?: string;
  /** Optional 1-indexed inclusive line range to bound the read. */
  lines?: { start: number; end: number };
  sha256?: Sha256;
}

/**
 * A tool the agent may call, granted BY HANDLE — never the raw tool. FRANK's
 * policy broker resolves the handle to a concrete, audited capability at call
 * time (FRANK-§7.1 tool/connector authorization).
 */
export interface ToolGrant {
  /** Opaque policy handle, e.g. `tool://github.pr.create`. */
  handle: string;
  /** Human-readable capability for the evidence record. */
  capability: string;
}

/**
 * A credential made available to the assignment, referenced by handle only.
 * The secret itself never enters the pack; the broker injects it at call time.
 * FRANK-§7.4 "allowed tools and credentials by handle".
 */
export interface CredentialHandle {
  /** Opaque secret handle, e.g. `secret://github.token`. */
  handle: string;
  classification: DataClass;
}

/** FRANK-§7.4 "data classification and egress rule". */
export type EgressRule =
  | 'none'
  | 'frank-internal-only'
  | 'approved-connectors'
  | 'public-web';

/** FRANK-§7.4 "budget, deadline, and retry policy". */
export interface AssignmentBudget {
  /** Maximum model+tool spend in `currency`. */
  maxSpend: number;
  currency: string;
  /** Hard wall-clock deadline for the assignment. */
  deadline: IsoDateTime;
  /** Maximum number of automatic retries on transient failure. */
  maxRetries: number;
}

/**
 * A single recalled memory fact. Lower-trust by construction: these are
 * `generated-untrusted` and must be weighed, never obeyed. The provenance
 * (where it came from, when, how relevant) travels with the fact so the agent
 * and the reviewer can judge it.
 */
export interface RecalledMemory {
  /** The fact text as recalled. */
  fact: string;
  /**
   * Always `generated-untrusted` for recalled memory (FRANK-§2.3). Typed as the
   * full TrustLabel union so a future, separately-verified memory source can be
   * represented without a schema bump — but the assembler must not stamp a
   * higher trust on an ordinary recall.
   */
  trust: TrustLabel;
  /** Origin of the fact (user utterance, document, prior run). */
  sourceId: string;
  /** Data class of the underlying fact; the pack's class >= this. */
  classification: DataClass;
  /** Recall relevance score from the memory backend, 0..1. */
  relevance: number;
  /** When the fact was last confirmed, if known. */
  confirmedAt?: IsoDateTime;
}

/**
 * The memory section of a pack. Kept separate from requirements/sources so the
 * harness and reviewer can see exactly which lower-trust facts were injected.
 * Empty (not omitted) when nothing relevant was recalled — an empty array says
 * "we looked and minimized to nothing", which is different from "we forgot".
 */
export interface MemorySection {
  /** Minimized set of recalled facts, most relevant first. */
  recalled: RecalledMemory[];
  /** The query the recall was run against, for reproducibility. */
  recallQuery: string;
  /** Memory backend that produced the recall, e.g. `mem0@vps:8888`. */
  backend: string;
}

/** FRANK-§7.4 "uncertainty and escalation instructions". */
export interface EscalationPolicy {
  /** Conditions under which the agent must stop and ask the owner. */
  escalateWhen: string[];
  /** What the agent must NOT assume on its own. */
  doNotAssume: string[];
}

/**
 * FRANK-§7.4 integrity block. `contentHash` is the SHA-256 over the
 * canonicalized pack excluding this block, making the pack hash-addressed and
 * reproducible. `signature` is FRANK's signature over `contentHash`.
 */
export interface ContextPackIntegrity {
  contentHash: Sha256;
  signerId: string;
  signature: string;
  signedAt: IsoDateTime;
}

export interface ContextPack {
  schema: 'frank.context-pack/v1';
  /** Stable id of this pack instance. */
  packId: string;
  /** The assignment (run) this pack was assembled for. */
  assignmentId: string;
  cellId: string;
  createdAt: IsoDateTime;

  /** FRANK-§7.4 "goal and definition of done". */
  goal: string;
  definitionOfDone: string[];

  /** FRANK-§7.4 "requirement IDs and relevant ADR excerpts". */
  requirements: RequirementRef[];
  adrExcerpts?: string[];

  /** FRANK-§7.4 "source files or symbols". */
  sources: ContextSource[];

  /** FRANK-§7.4 "related work and known constraints". */
  relatedWork?: string[];
  constraints: string[];

  /** FRANK-§7.4 "allowed tools and credentials by handle". */
  allowedTools: ToolGrant[];
  credentials: CredentialHandle[];

  /** FRANK-§7.4 "data classification and egress rule". */
  classification: DataClass;
  egress: EgressRule;

  /** FRANK-§7.4 "budget, deadline, and retry policy". */
  budget: AssignmentBudget;

  /** FRANK-§7.4 "expected outputs and evidence schema". */
  expectedOutputs: string[];
  evidenceSchemaRef: string;

  /** FRANK-§7.4 "uncertainty and escalation instructions". */
  escalation: EscalationPolicy;

  /**
   * The minimized, lower-trust memory section. Distinct from requirements and
   * sources so it is visible exactly what recalled facts the agent was fed.
   */
  memory: MemorySection;

  integrity: ContextPackIntegrity;
}
