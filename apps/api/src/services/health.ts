/**
 * Health — OPS-004, UX-007, FRANK-§19.2, FRANK-§19.3.
 *
 * OPS-004: "Health must distinguish healthy, degraded, unavailable, stale, and
 * **intentionally paused**." Five states, not a boolean, and the fifth one is
 * the reason a boolean will not do: an operator who paused the execution plane
 * (OPS-003) must not see the same red that a database outage produces, or the
 * next real outage will be assumed to be somebody's pause.
 *
 * UX-007: "The interface must show stale data and sync failures rather than
 * silently presenting an old state as current", with acceptance evidence
 * "Connector outage test displays **age** and **recovery action**". So every
 * component reports `observed_at`, `age_seconds`, and — whenever it is not
 * healthy — a `recovery_action` that names something a person can actually do.
 * {@link assertRecoveryActionsPresent} makes that an invariant rather than a
 * convention.
 *
 * ## Liveness and readiness are different questions
 *
 * FRANK-§16.2 puts Caddy in front and FRANK-§19.3 wants availability checks.
 * Liveness answers "should this process be restarted" — it is true whenever the
 * event loop is turning, and it deliberately does not touch the database,
 * because restarting the API will not fix PostgreSQL and a liveness probe that
 * fails during a database outage turns one outage into a crash loop.
 *
 * Readiness answers "should traffic be routed here" and does depend on the
 * database, because a process that cannot read canonical truth has nothing
 * useful to serve.
 */

import type { EnrichmentDispatcher } from './enrichment.js';
import type { DomainStore } from './store.js';

/** OPS-004, verbatim. */
export type HealthState =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'stale'
  | 'intentionally_paused';

/**
 * Severity order, worst last.
 *
 * `stale` ranks above `degraded` because a stale answer that is presented as
 * current is a correctness failure, while a degraded-but-current answer is a
 * performance one — UX-007 exists precisely because the first is worse.
 * `intentionally_paused` ranks *below* everything: it is not a fault, and it
 * must never be the reason an aggregate goes red.
 */
const SEVERITY: Readonly<Record<HealthState, number>> = {
  intentionally_paused: 0,
  healthy: 1,
  degraded: 2,
  stale: 3,
  unavailable: 4,
};

export interface HealthComponent {
  readonly id: string;
  readonly state: HealthState;
  readonly detail: string;
  readonly observedAt: Date;
  readonly ageSeconds: number;
  /** UX-007. Required unless `state` is `healthy`. */
  readonly recoveryAction: string | null;
  /** OPS-003: who paused it, so a pause is attributable. */
  readonly pausedBy: string | null;
  readonly measurements: Readonly<Record<string, number | string | boolean>>;
}

export interface HealthReport {
  readonly state: HealthState;
  readonly live: boolean;
  readonly ready: boolean;
  readonly checkedAt: Date;
  readonly components: readonly HealthComponent[];
}

/** FRANK-§19.3-shaped thresholds. Data, so tuning is not a code change. */
export interface HealthThresholds {
  /** Above this the database component is `degraded`. */
  readonly databaseLatencyDegradedMs: number;
  /** Outbox backlog above which ADR-004 publication is visibly behind. */
  readonly outboxPendingDegraded: number;
  /** Any quarantined event is at least `degraded` (FRANK-§12.4). */
  readonly outboxQuarantinedDegraded: number;
  /** Enrichment backlog age above which the derived view is `stale`. */
  readonly enrichmentStaleMs: number;
  readonly enrichmentQueueDegraded: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  databaseLatencyDegradedMs: 250,
  outboxPendingDegraded: 500,
  outboxQuarantinedDegraded: 1,
  enrichmentStaleMs: 60_000,
  enrichmentQueueDegraded: 100,
};

export interface HealthServiceOptions {
  readonly store: DomainStore;
  readonly enrichment: EnrichmentDispatcher;
  readonly cellId: string;
  readonly thresholds?: HealthThresholds;
  readonly startedAt: Date;
  /** OPS-003: components an operator has paused, and who paused them. */
  readonly pausedComponents?: ReadonlyMap<string, string>;
  /** Whether an identity provider is configured. */
  readonly identityProviderId: string;
  readonly policyVersion: string;
}

export class HealthService {
  readonly #options: HealthServiceOptions;
  readonly #thresholds: HealthThresholds;
  #paused: Map<string, string>;

  constructor(options: HealthServiceOptions) {
    this.#options = options;
    this.#thresholds = options.thresholds ?? DEFAULT_HEALTH_THRESHOLDS;
    this.#paused = new Map(options.pausedComponents ?? []);
  }

  /** OPS-003: "pause a run, agent, connector, automation class, … ". */
  pause(componentId: string, by: string): void {
    this.#paused.set(componentId, by);
  }

  resume(componentId: string): void {
    this.#paused.delete(componentId);
  }

  /**
   * Liveness. Touches nothing external — see the module comment.
   *
   * Always `true` once the process is answering, which is the honest answer: a
   * process that can execute this function is alive. A liveness check that could
   * return `false` for a reason a restart would not fix is a check that causes
   * outages instead of reporting them.
   */
  liveness(): { live: true; uptimeSeconds: number } {
    return {
      live: true,
      uptimeSeconds: Math.floor((Date.now() - this.#options.startedAt.getTime()) / 1000),
    };
  }

  async report(now: Date): Promise<HealthReport> {
    const components: HealthComponent[] = [];

    components.push(await this.#databaseComponent(now));
    components.push(await this.#outboxComponent(now));
    components.push(this.#enrichmentComponent(now));
    components.push(this.#identityComponent(now));
    components.push(this.#policyComponent(now));

    const withPauses = components.map((component) => this.#applyPause(component));
    const aggregate = withPauses.reduce<HealthState>(
      (worst, component) =>
        SEVERITY[component.state] > SEVERITY[worst] ? component.state : worst,
      'healthy',
    );

    // Readiness depends only on the components a request actually needs.
    const database = withPauses.find((component) => component.id === 'canonical_database');
    const ready = database !== undefined && database.state !== 'unavailable';

    assertRecoveryActionsPresent(withPauses);

    return {
      state: allPaused(withPauses) ? 'intentionally_paused' : aggregate,
      live: true,
      ready,
      checkedAt: now,
      components: withPauses,
    };
  }

  #applyPause(component: HealthComponent): HealthComponent {
    const by = this.#paused.get(component.id);
    if (by === undefined) return component;
    return {
      ...component,
      state: 'intentionally_paused',
      detail: `${component.id} is intentionally paused (OPS-003). Underlying report: ${component.detail}`,
      recoveryAction: `Resume ${component.id} from /system when the reason for the pause has passed.`,
      pausedBy: by,
    };
  }

  async #databaseComponent(now: Date): Promise<HealthComponent> {
    const health = await this.#options.store.health();
    const ageSeconds = ageIn(now, health.observedAt);

    if (!health.reachable) {
      return {
        id: 'canonical_database',
        state: 'unavailable',
        detail: health.detail,
        observedAt: health.observedAt,
        ageSeconds,
        recoveryAction:
          'The canonical PostgreSQL is not answering. Check the database service and the connection pool; the API serves no reads until it returns (ADR-003).',
        pausedBy: null,
        measurements: { latency_ms: Math.round(health.latencyMs) },
      };
    }

    const degraded = health.latencyMs > this.#thresholds.databaseLatencyDegradedMs;
    return {
      id: 'canonical_database',
      state: degraded ? 'degraded' : 'healthy',
      detail: degraded
        ? `canonical database responded in ${Math.round(health.latencyMs)} ms, above the ${String(this.#thresholds.databaseLatencyDegradedMs)} ms objective`
        : health.detail,
      observedAt: health.observedAt,
      ageSeconds,
      recoveryAction: degraded
        ? 'Check database load, slow queries, and connection saturation (FRANK-§19.2).'
        : null,
      pausedBy: null,
      measurements: { latency_ms: Math.round(health.latencyMs) },
    };
  }

  async #outboxComponent(now: Date): Promise<HealthComponent> {
    const store = this.#options.store as DomainStore & {
      outboxCounts?: (cellId: string) => Promise<{
        pending: number;
        publishing: number;
        published: number;
        quarantined: number;
      } | null>;
    };

    if (typeof store.outboxCounts !== 'function') {
      return {
        id: 'event_outbox',
        state: 'degraded',
        detail: 'outbox counters are not available from this store implementation',
        observedAt: now,
        ageSeconds: 0,
        recoveryAction:
          'Backlog cannot be observed. Treat event delivery as unverified until counters are available (FRANK-§12.4).',
        pausedBy: null,
        measurements: {},
      };
    }

    let counts: Awaited<ReturnType<NonNullable<typeof store.outboxCounts>>>;
    try {
      counts = await store.outboxCounts(this.#options.cellId);
    } catch {
      return {
        id: 'event_outbox',
        state: 'unavailable',
        detail: 'outbox counters could not be read',
        observedAt: now,
        ageSeconds: 0,
        recoveryAction: 'The database is unreachable; resolve that first (ADR-004).',
        pausedBy: null,
        measurements: {},
      };
    }

    if (counts === null) {
      return {
        id: 'event_outbox',
        state: 'degraded',
        detail: 'outbox counters returned nothing',
        observedAt: now,
        ageSeconds: 0,
        recoveryAction: 'Verify the outbox table is present and readable (ADR-004).',
        pausedBy: null,
        measurements: {},
      };
    }

    // FRANK-§12.4: "Failed events enter a visible quarantine with replay
    // controls." Visible is the operative word — a quarantined event is a
    // degraded system even when everything else is fine.
    const quarantined = counts.quarantined >= this.#thresholds.outboxQuarantinedDegraded;
    const backlogged = counts.pending >= this.#thresholds.outboxPendingDegraded;

    return {
      id: 'event_outbox',
      state: quarantined || backlogged ? 'degraded' : 'healthy',
      detail: quarantined
        ? `${String(counts.quarantined)} event(s) are quarantined and will not be delivered until replayed`
        : backlogged
          ? `${String(counts.pending)} event(s) are pending publication`
          : 'outbox backlog is within objective',
      observedAt: now,
      ageSeconds: 0,
      recoveryAction: quarantined
        ? 'Inspect the quarantine and replay the events once their cause is fixed (FRANK-§12.4).'
        : backlogged
          ? 'Check the publisher; events are committed and durable but are not reaching consumers (ADR-004).'
          : null,
      pausedBy: null,
      measurements: {
        pending: counts.pending,
        publishing: counts.publishing,
        published: counts.published,
        quarantined: counts.quarantined,
      },
    };
  }

  /**
   * The component UX-004 is about.
   *
   * A stalled enrichment path is explicitly *not* an API outage: captures are
   * durable and acknowledged regardless. It is reported as `stale`, which is the
   * accurate word — derived views are behind the canonical record — with the age
   * of the oldest pending job and a recovery action, exactly as UX-007 requires.
   */
  #enrichmentComponent(now: Date): HealthComponent {
    const status = this.#options.enrichment.status(now);
    const ageMs = status.oldestPendingAgeMs ?? 0;

    let state: HealthState = 'healthy';
    let recovery: string | null = null;
    let detail = status.detail;

    if (status.paused) {
      state = 'intentionally_paused';
      recovery = 'Resume enrichment from /system. Captures remain durable while it is paused.';
    } else if (status.dropped > 0) {
      state = 'degraded';
      detail = status.detail;
      recovery =
        'Enrichment shed load. The captures are durable and their outbox events will replay; investigate why the handler stalled (FRANK-§12.4).';
    } else if (ageMs >= this.#thresholds.enrichmentStaleMs) {
      state = 'stale';
      detail = `oldest enrichment job has waited ${String(Math.round(ageMs / 1000))} s; derived views are behind the canonical record`;
      recovery =
        'Derived data is behind. Captures and work items are current; re-run enrichment or wait for the backlog to drain (UX-007).';
    } else if (status.queueDepth >= this.#thresholds.enrichmentQueueDegraded) {
      state = 'degraded';
      recovery = 'Enrichment backlog is growing. Check the handler and its downstream.';
    }

    return {
      id: 'enrichment',
      state,
      detail,
      observedAt: now,
      ageSeconds: Math.round(ageMs / 1000),
      recoveryAction: recovery,
      pausedBy: null,
      measurements: {
        queue_depth: status.queueDepth,
        in_flight: status.inFlight,
        completed: status.completed,
        failed: status.failed,
        dropped: status.dropped,
        capacity: status.capacity,
      },
    };
  }

  #identityComponent(now: Date): HealthComponent {
    return {
      id: 'identity_provider',
      state: 'healthy',
      detail: `identity provider ${this.#options.identityProviderId} is configured`,
      observedAt: now,
      ageSeconds: 0,
      recoveryAction: null,
      pausedBy: null,
      measurements: { provider: this.#options.identityProviderId },
    };
  }

  #policyComponent(now: Date): HealthComponent {
    return {
      id: 'policy_engine',
      state: 'healthy',
      detail: `FRANK-§6.9 action boundary active at policy version ${this.#options.policyVersion}`,
      observedAt: now,
      ageSeconds: 0,
      recoveryAction: null,
      pausedBy: null,
      measurements: { policy_version: this.#options.policyVersion },
    };
  }
}

function ageIn(now: Date, observedAt: Date): number {
  return Math.max(0, Math.floor((now.getTime() - observedAt.getTime()) / 1000));
}

function allPaused(components: readonly HealthComponent[]): boolean {
  return (
    components.length > 0 && components.every((component) => component.state === 'intentionally_paused')
  );
}

/**
 * UX-007's requirement, as an invariant rather than a habit.
 *
 * Any component that is not `healthy` must carry a recovery action. Throwing
 * here would be worse than the bug it catches — a health endpoint that crashes
 * during an incident is the last thing anyone needs — so it repairs the report
 * in place and says so. The repaired text is deliberately unhelpful, which is
 * how it gets noticed and fixed.
 */
export function assertRecoveryActionsPresent(components: HealthComponent[]): void {
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) continue;
    if (component.state !== 'healthy' && component.recoveryAction === null) {
      components[index] = {
        ...component,
        recoveryAction: `No recovery action was defined for "${component.id}" in state "${component.state}". This is a defect: UX-007 requires one.`,
      };
    }
  }
}
