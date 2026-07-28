/**
 * `schema://frank.evidence/v1` — FRANK-§6.8, with required contents from §14.4.
 *
 * The evidence pack is what Steven reviews instead of an unbuilt proposal
 * (§1.2 principle 3, ADR-014). A manifest is signed and its integrity hash
 * covers every other field.
 */

import type { CurrencyCode, IsoDateTime, Sha256 } from './common.js';

export type CheckOutcome = 'pass' | 'fail' | 'skipped' | 'error';

export interface CheckResult {
  id: string;
  /**
   * FRANK-§14.3 / BUILD-011: binary tests and deterministic tools outrank model
   * opinion. A failing required check cannot be overridden by a favourable
   * review.
   */
  result: CheckOutcome;
  /**
   * Explicit, never defaulted (FRANK-§6.8 / BUILD-011). A defaulted field
   * would read as `false` when omitted and silently downgrade a blocking
   * check to advisory.
   */
  required: boolean;
  uri?: string;
  sha256?: Sha256;
}

/** FRANK-§14.3 adversarial review lattice. */
export type ReviewKind =
  | 'correctness'
  | 'architecture'
  | 'security'
  | 'reliability'
  | 'product'
  | 'accessibility'
  | 'operations';

export type ReviewVerdict = 'pass' | 'findings' | 'blocked';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'note';

export interface ReviewFinding {
  severity: FindingSeverity;
  summary: string;
  /**
   * FRANK-§14.3 noise control: a finding needs a reproducible path, a violated
   * requirement, or concrete evidence. Style preferences are severity `note`
   * and do not block.
   */
  evidence: string;
  file?: string;
  line?: number;
}

export interface Review {
  reviewer: string;
  kind: ReviewKind;
  /**
   * BUILD-010: must differ from the implementing agent's family.
   * "different-from-builder" is asserted by the evidence service, not
   * self-reported by the reviewer.
   */
  modelFamily: string;
  isolatedContextHash: Sha256;
  reportHash: Sha256;
  verdict: ReviewVerdict;
  findings?: ReviewFinding[];
}

/**
 * FRANK-§14.4 first item: plain-language outcome and user impact. Written for
 * Steven, not for an operator.
 */
export interface EvidenceOutcome {
  summary: string;
  userImpact: string;
}

/**
 * FRANK-§0: every change traces to a requirement ID, a normative section
 * locator, or an accepted ADR. Schema pattern:
 * `^([A-Z]+-[0-9]{3}|FRANK-§[0-9]+(\.[0-9]+)*|ADR-[0-9]{3})$`.
 */
export type RequirementRef = string;

export interface EvidenceSource {
  repository: string;
  baseCommit: string;
  headCommit: string;
  changedFiles?: string[];
  lockfileSha256: Sha256;
}

export interface EvidenceAgent {
  id: string;
  revision: string;
  harness: string;
  model: string;
  skills?: string[];
  tools?: string[];
}

export interface EvidenceExecution {
  workflow: string;
  policy: string;
  /** The pinned sandbox image digest the work actually ran in (FRANK-§15.4). */
  environment: string;
  /** Schema requires at least one agent. */
  agents: EvidenceAgent[];
}

export interface EvidenceArtifact {
  kind: string;
  uri: string;
  sha256: Sha256;
}

export interface SecurityScan {
  tool: string;
  result: 'pass' | 'fail';
  reportSha256: Sha256;
  unresolvedCritical?: number;
  unresolvedHigh?: number;
}

export type ScreenshotViewport = 'desktop' | 'mobile';

export interface PreviewScreenshot {
  viewport: ScreenshotViewport;
  uri: string;
  sha256: Sha256;
}

export interface EvidencePreview {
  /**
   * FRANK-§16.3: previews live on a separately owned registrable domain, never
   * a child of frank.fail.
   */
  url: string;
  artifactDigest: Sha256;
  expiresAt: IsoDateTime;
  /**
   * BUILD-007: desktop and mobile viewports are both required for user-facing
   * changes.
   */
  screenshots?: PreviewScreenshot[];
}

/**
 * BUILD-008: database changes require forward migration, compatibility window,
 * backup point, recovery procedure, and a restore test.
 */
export interface EvidenceMigration {
  forwardMigration: string;
  compatibilityWindow: string;
  backupPoint: string;
  rehearsalResult: 'pass' | 'fail';
}

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface EvidenceRisk {
  summary: string;
  severity: RiskSeverity;
  residual: boolean;
}

export type RollbackKind = 'release-pointer' | 'fix-forward' | 'compensating-action';

export interface EvidenceRollback {
  kind: RollbackKind;
  target: string;
  /**
   * FRANK-§26: evidence packs reference the runbook ID and version, not a
   * free-text title. Schema pattern: `^RB-[A-Z]+-[0-9]{3}@[0-9]+\.[0-9]+\.[0-9]+$`.
   */
  runbookId: string;
}

/**
 * OPS-001 / §20 Cost: model, harness, time, and spend receipts reconciling to a
 * run and project.
 */
export interface EvidenceCost {
  currency: CurrencyCode;
  totalSpend: number;
  wallClockSeconds?: number;
  runId: string;
  projectId: string;
}

export interface EvidenceIntegrity {
  manifestSha256: Sha256;
  signerId: string;
  signature: string;
}

export interface EvidenceManifest {
  schema: 'frank.evidence/v1';
  changeId: string;
  createdAt: IsoDateTime;
  retentionPolicy: string;
  outcome: EvidenceOutcome;
  /** Schema requires at least one requirement reference. */
  requirements: RequirementRef[];
  source: EvidenceSource;
  execution: EvidenceExecution;
  artifacts: EvidenceArtifact[];
  /** Schema requires at least one check. */
  checks: CheckResult[];
  /**
   * FRANK-§14.3 requires a fresh-context review and a cross-model-family review
   * (BUILD-009). Fewer than two entries cannot satisfy the release gate.
   */
  reviews: Review[];
  securityScan?: SecurityScan;
  preview?: EvidencePreview;
  migration?: EvidenceMigration;
  risks: EvidenceRisk[];
  rollback: EvidenceRollback;
  cost: EvidenceCost;
  integrity: EvidenceIntegrity;
}
