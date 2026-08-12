/**
 * Harness Broker — FRANK-§8.4.
 *
 * Scores registered harness adapters against selection factors and picks the
 * best one. Steven can choose Auto, a named harness, or a saved route profile.
 * The interface explains the actual selection in plain language.
 *
 * ## Scoring model (Slice 1)
 *
 * Each factor contributes a weight in [0, 1]. The composite score is a
 * weighted sum. Factors without data yet (measured eval success, speed/cost
 * benchmarks) score neutral (0.5) so they don't distort the ranking.
 *
 * | Factor                          | Weight |
 * |---------------------------------|--------|
 * | Health                          | 0.25   |
 * | Capacity (accepting + headroom) | 0.15   |
 * | Tool protocol coverage          | 0.20   |
 * | Data class compatibility        | 0.15   |
 * | Resume / cancellation strength  | 0.10   |
 * | Workspace mode match            | 0.05   |
 * | Review diversity                | 0.05   |
 * | Task-type affinity              | 0.05   |
 */

import type {
  AgentHarnessAdapter,
  DataClass,
  HarnessCandidate,
  HarnessDescriptor,
  HarnessRouteProfile,
  HarnessSelection,
  HealthReport,
  HarnessCapacity,
  SelectionFactors,
} from '@frank/contracts';

import { DATA_CLASS_ORDER } from '@frank/contracts';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** No registered harness satisfies the selection factors. */
export class NoEligibleHarnessError extends Error {
  readonly factors: SelectionFactors;
  constructor(factors: SelectionFactors, reasons: string[]) {
    super(
      `No harness satisfies the selection factors: ${reasons.join('; ')}. ` +
        'Register a compatible harness or relax the constraints.',
    );
    this.name = 'NoEligibleHarnessError';
    this.factors = factors;
  }
}

/** A named harness was requested but is not registered. */
export class UnknownHarnessError extends Error {
  readonly harnessId: string;
  constructor(harnessId: string) {
    super(`Harness ${JSON.stringify(harnessId)} is not registered.`);
    this.name = 'UnknownHarnessError';
    this.harnessId = harnessId;
  }
}

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  health: 0.25,
  capacity: 0.15,
  toolProtocols: 0.2,
  dataClass: 0.15,
  resilience: 0.1,
  workspace: 0.05,
  diversity: 0.05,
  taskAffinity: 0.05,
} as const;

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

/**
 * The Harness Broker. Constructed with registered adapters; reused across
 * selections. Adapters are queried live at selection time (health, capacity).
 */
export class HarnessBroker {
  readonly #adapters: AgentHarnessAdapter[];
  readonly #routeProfiles: Map<string, HarnessRouteProfile>;
  /** Harness ids used for the most recent selection, for diversity tracking. */
  #recentSelections: string[] = [];

  constructor(adapters: readonly AgentHarnessAdapter[] = []) {
    this.#adapters = [...adapters];
    this.#routeProfiles = new Map();
  }

  /** Register an adapter. */
  register(adapter: AgentHarnessAdapter): void {
    this.#adapters.push(adapter);
  }

  /** Save a route profile. */
  saveRouteProfile(profile: HarnessRouteProfile): void {
    this.#routeProfiles.set(profile.id, profile);
  }

  /** List registered route profiles. */
  listRouteProfiles(): readonly HarnessRouteProfile[] {
    return [...this.#routeProfiles.values()];
  }

  /**
   * Select a harness for the given factors.
   *
   * @param factors  What the assignment needs.
   * @param mode     'auto' (default), a harness id string, or a route profile id.
   */
  async select(
    factors: SelectionFactors,
    mode: 'auto' | string = 'auto',
  ): Promise<HarnessSelection> {
    // Named harness
    if (mode !== 'auto') {
      const profile = this.#routeProfiles.get(mode);
      if (profile) {
        return this.#selectFromProfile(factors, profile);
      }
      // Treat as a named harness id
      return this.#selectNamed(factors, mode);
    }

    // Auto: score all candidates
    const candidates = await this.#scoreAll(factors);
    if (candidates.length === 0) {
      throw new NoEligibleHarnessError(factors, ['no healthy harnesses registered']);
    }

    const best = candidates[0]!;
    this.#recentSelections.push(best.descriptor.id);
    if (this.#recentSelections.length > 10) this.#recentSelections.shift();

    return {
      harnessId: best.descriptor.id,
      candidates,
      explanation: best.explanation,
      mode: 'auto',
    };
  }

  // -----------------------------------------------------------------------
  // Internal: scoring
  // -----------------------------------------------------------------------

  async #scoreAll(factors: SelectionFactors): Promise<HarnessCandidate[]> {
    const candidates: HarnessCandidate[] = [];

    for (const adapter of this.#adapters) {
      try {
        const [descriptor, health, capacity] = await Promise.all([
          adapter.descriptor(),
          adapter.health(),
          adapter.capacity(),
        ]);

        // Hard gates: unhealthy or not accepting → skip
        if (!health.healthy) continue;
        if (!capacity.accepting) continue;

        // Hard gate: data class
        if (!this.#dataClassOk(descriptor, factors.dataClass)) continue;
        if (!this.#toolProtocolsOk(descriptor, factors.requiredToolProtocols)) continue;

        const score = this.#score(descriptor, health, capacity, factors);
        const explanation = this.#explain(descriptor, health, capacity, factors, score);

        candidates.push({ descriptor, health, capacity, score, explanation });
      } catch {
        // Adapter failed to report — skip it
        continue;
      }
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  #score(
    descriptor: HarnessDescriptor,
    health: HealthReport,
    capacity: HarnessCapacity,
    factors: SelectionFactors,
  ): number {
    let total = 0;

    // Health: healthy = 1, unhealthy = 0 (already gated, but score granularity)
    total += WEIGHTS.health * (health.healthy ? 1 : 0);

    // Capacity: headroom ratio
    const headroom =
      capacity.maxConcurrentSessions > 0
        ? 1 - capacity.activeSessions / capacity.maxConcurrentSessions
        : 0;
    total += WEIGHTS.capacity * Math.max(0, headroom);

    // Tool protocol coverage
    const required = new Set(factors.requiredToolProtocols);
    const supported = new Set(descriptor.toolProtocols);
    const covered = [...required].filter((p) => supported.has(p)).length;
    const protocolScore = required.size > 0 ? covered / required.size : 1;
    total += WEIGHTS.toolProtocols * protocolScore;

    // Data class: how much headroom above the requirement
    const requiredRank = DATA_CLASS_ORDER.indexOf(factors.dataClass);
    const maxRank = DATA_CLASS_ORDER.indexOf(descriptor.maxDataClass);
    const dcScore = maxRank >= requiredRank ? 1 : 0;
    total += WEIGHTS.dataClass * dcScore;

    // Resilience: resume + cancellation
    const resumeScore =
      descriptor.resumeGuarantee === 'none'
        ? 0
        : descriptor.resumeGuarantee === 'same-harness-restart'
          ? 0.5
          : 1;
    const cancelScore =
      descriptor.cancellationStrength === 'cooperative'
        ? 0.33
        : descriptor.cancellationStrength === 'process'
          ? 0.66
          : 1;
    total += WEIGHTS.resilience * (resumeScore * 0.5 + cancelScore * 0.5);

    // Workspace mode match
    if (factors.preferredWorkspaceMode) {
      const hasMode = descriptor.workspaceModes.includes(factors.preferredWorkspaceMode);
      total += WEIGHTS.workspace * (hasMode ? 1 : 0);
    } else {
      total += WEIGHTS.workspace * 0.5; // neutral
    }

    // Review diversity: penalize if this harness was recently selected
    if (factors.needsReviewDiversity && this.#recentSelections.includes(descriptor.id)) {
      total += WEIGHTS.diversity * 0;
    } else {
      total += WEIGHTS.diversity * 1;
    }

    // Task-type affinity: neutral for now (no eval data yet)
    total += WEIGHTS.taskAffinity * 0.5;

    return Math.round(total * 1000) / 1000;
  }

  #explain(
    descriptor: HarnessDescriptor,
    health: HealthReport,
    capacity: HarnessCapacity,
    factors: SelectionFactors,
    score: number,
  ): string {
    const parts: string[] = [];

    parts.push(`${descriptor.label} (${descriptor.id})`);
    parts.push(`score ${score.toFixed(3)}`);

    if (health.healthy) {
      parts.push('healthy');
    }

    const headroom = capacity.maxConcurrentSessions - capacity.activeSessions;
    parts.push(`${headroom}/${capacity.maxConcurrentSessions} sessions available`);

    const required = new Set(factors.requiredToolProtocols);
    const supported = new Set(descriptor.toolProtocols);
    const covered = [...required].filter((p) => supported.has(p));
    if (covered.length === required.size) {
      parts.push(`supports all required protocols (${[...required].join(', ')})`);
    } else {
      parts.push(`missing protocols: ${[...required].filter((p) => !supported.has(p)).join(', ')}`);
    }

    parts.push(`data class up to ${descriptor.maxDataClass}`);
    parts.push(`resume: ${descriptor.resumeGuarantee}, cancel: ${descriptor.cancellationStrength}`);

    return parts.join(' · ');
  }

  #dataClassOk(descriptor: HarnessDescriptor, required: DataClass): boolean {
    const requiredRank = DATA_CLASS_ORDER.indexOf(required);
    const maxRank = DATA_CLASS_ORDER.indexOf(descriptor.maxDataClass);
    return maxRank >= requiredRank;
  }

  #toolProtocolsOk(
    descriptor: HarnessDescriptor,
    required: readonly HarnessDescriptor['toolProtocols'][number][],
  ): boolean {
    const supported = new Set(descriptor.toolProtocols);
    return required.every((protocol) => supported.has(protocol));
  }

  // -----------------------------------------------------------------------
  // Internal: named / profile selection
  // -----------------------------------------------------------------------

  async #selectNamed(factors: SelectionFactors, harnessId: string): Promise<HarnessSelection> {
    const adapter = await this.#findAdapter(harnessId);
    if (!adapter) throw new UnknownHarnessError(harnessId);

    const [descriptor, health, capacity] = await Promise.all([
      adapter.descriptor(),
      adapter.health(),
      adapter.capacity(),
    ]);

    const reasons: string[] = [];
    if (!health.healthy) reasons.push(`${harnessId} is unhealthy`);
    if (!capacity.accepting) reasons.push(`${harnessId} is not accepting work`);
    if (!this.#dataClassOk(descriptor, factors.dataClass)) reasons.push(`${harnessId} cannot handle ${factors.dataClass} data`);
    if (!this.#toolProtocolsOk(descriptor, factors.requiredToolProtocols)) reasons.push(`${harnessId} lacks required tool protocols`);
    if (reasons.length > 0) throw new NoEligibleHarnessError(factors, reasons);

    const score = this.#score(descriptor, health, capacity, factors);
    const explanation = this.#explain(descriptor, health, capacity, factors, score);

    return {
      harnessId,
      candidates: [{ descriptor, health, capacity, score, explanation }],
      explanation: `Named harness: ${explanation}`,
      mode: 'named',
    };
  }

  async #selectFromProfile(
    factors: SelectionFactors,
    profile: HarnessRouteProfile,
  ): Promise<HarnessSelection> {
    // Try each harness in preference order
    for (const harnessId of profile.preference) {
      const adapter = await this.#findAdapter(harnessId);
      if (!adapter) continue;

      try {
        const [descriptor, health, capacity] = await Promise.all([
          adapter.descriptor(),
          adapter.health(),
          adapter.capacity(),
        ]);

        if (!health.healthy || !capacity.accepting) continue;
        if (!this.#dataClassOk(descriptor, factors.dataClass)) continue;
        if (!this.#toolProtocolsOk(descriptor, factors.requiredToolProtocols)) continue;

        const score = this.#score(descriptor, health, capacity, factors);
        const explanation = this.#explain(descriptor, health, capacity, factors, score);

        return {
          harnessId,
          candidates: [{ descriptor, health, capacity, score, explanation }],
          explanation: `Route profile "${profile.name}": ${explanation}`,
          mode: 'route-profile',
        };
      } catch {
        continue;
      }
    }

    throw new NoEligibleHarnessError(factors, [
      `no harness in route profile "${profile.name}" is eligible`,
    ]);
  }

  async #findAdapter(harnessId: string): Promise<AgentHarnessAdapter | undefined> {
    for (const adapter of this.#adapters) {
      try {
        const descriptor = await adapter.descriptor();
        if (descriptor.id === harnessId) return adapter;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}
