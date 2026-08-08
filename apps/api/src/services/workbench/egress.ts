/**
 * EgressPolicy — SS-03: task-specific domain allowlists for the workbench.
 *
 * Master plan §8H SS-03 / §M9: one Docker container per workbench (WB-03)
 * plus `srt` for filesystem and egress policy. This module turns the task
 * def's `network.egressAllowlist` into a single, explicit policy descriptor
 * consumed by both enforcement layers:
 *
 *   - the provisioner's docker network profile (coarse: `none` when egress
 *     is denied, `restricted` when an allowlist exists), and
 *   - the srt wrapper (fine: the actual domain list handed to srt).
 *
 * ## Deny-by-default
 *
 * An absent or empty allowlist means DENY-ALL egress — never "everything".
 * That invariant is the same one WB-03's `resolveNetwork` already encodes
 * for the docker layer; building the policy here keeps the two layers in
 * lock-step from one source of truth.
 *
 * Domains are normalized (trimmed, lowercased, deduplicated) and validated:
 * a malformed entry throws instead of silently entering (or silently
 * dropping out of) the policy. The allowlist is platform-authored, so a
 * loud failure at spec-build time is the safe behaviour.
 */

import type { WorkbenchTaskDef } from './types.js';

/**
 * The egress policy descriptor for one workbench.
 *
 *  - `deny-all`  — no egress of any kind (the default).
 *  - `allowlist` — egress permitted to exactly `domains`, nothing else.
 */
export type EgressPolicy =
  | { readonly mode: 'deny-all'; readonly domains: readonly [] }
  | { readonly mode: 'allowlist'; readonly domains: readonly string[] };

/** Hostname with optional `*.` wildcard prefix and optional `:port`. */
const DOMAIN_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/**
 * Validate and normalize one allowlist entry. Throws on anything that is
 * not a bare hostname (no scheme, no path, no whitespace, no credentials)
 * so a task def cannot smuggle a URL past the policy.
 */
export function normalizeEgressDomain(raw: string): string {
  const domain = raw.trim().toLowerCase();
  if (domain === '') {
    throw new Error('workbench egress allowlist entry is empty');
  }
  if (/[/\s@]/.test(domain)) {
    throw new Error(
      `workbench egress allowlist entry must be a bare hostname (no scheme, path, or port path): ${raw}`,
    );
  }
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error(`workbench egress allowlist entry is not a valid hostname: ${raw}`);
  }
  return domain;
}

/**
 * Build the egress policy for one workbench from its task def.
 * Pure function of the task def — unit-tested without Docker or srt.
 */
export function buildEgressPolicy(taskDef: WorkbenchTaskDef): EgressPolicy {
  const raw = taskDef.network?.egressAllowlist;
  if (raw === undefined || raw.length === 0) {
    return { mode: 'deny-all', domains: [] };
  }
  const domains: string[] = [];
  for (const entry of raw) {
    const domain = normalizeEgressDomain(entry);
    if (!domains.includes(domain)) {
      domains.push(domain);
    }
  }
  return { mode: 'allowlist', domains };
}

/** True when the policy permits no egress at all. */
export function isDenyAll(policy: EgressPolicy): boolean {
  return policy.mode === 'deny-all';
}
