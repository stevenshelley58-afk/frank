/**
 * The enrichment path — UX-004.
 *
 * UX-004: "Capture must acknowledge durability in under 500 ms at the API
 * boundary, **even when downstream enrichment is delayed**."
 *
 * That sentence is a statement about coupling, not about speed. If enrichment
 * were on the request path, the requirement would be satisfiable only by making
 * enrichment fast, and it would stop being satisfied the first time a model
 * provider had a bad minute. So enrichment is submitted, never awaited, and this
 * module exists to make "never awaited" a property the type system helps with:
 *
 *     submit(job): void
 *
 * `void`, not `Promise<void>`. There is nothing to await, so a route cannot
 * accidentally await it, and `await dispatcher.submit(...)` — which would
 * reintroduce the coupling — resolves immediately and buys the caller nothing.
 *
 * ## Bounded, and it drops rather than blocks
 *
 * A queue with no bound converts a stalled downstream into an out-of-memory
 * crash, which is a worse outcome than a delayed enrichment. {@link
 * InProcessEnrichmentDispatcher} has a fixed capacity and, when full, **drops
 * the oldest pending job and counts the drop**. Dropping is safe here and is not
 * a data-loss bug: the capture is already durable, the outbox row is already
 * committed (ADR-004), and enrichment is a *derived* step that the outbox
 * consumer will run again. FRANK-§12.4's quarantine and replay controls are the
 * durable version of this queue; this one is a latency optimisation on top of
 * it, and an optimisation is allowed to give up.
 *
 * The drop counter feeds OPS-004: a dispatcher that is dropping is `degraded`,
 * visibly, with an age and a recovery action (UX-007).
 *
 * ## Slice boundaries
 *
 * What enrichment *does* — classification, extraction, embedding — is Slice 3
 * (retrieval) and Slice 2 (the harness). Slice 1 ships the seam, a handler
 * registry, and the counters, because the requirement being tested is the
 * decoupling, and the decoupling has to be real before there is anything to
 * decouple from.
 */

export interface EnrichmentJob {
  readonly kind: 'source.captured';
  readonly cellId: string;
  readonly sourceId: string;
  readonly workItemId: string | null;
  readonly correlationId: string;
  readonly submittedAt: Date;
}

export type EnrichmentHandler = (job: EnrichmentJob) => Promise<void>;

export type EnrichmentState = 'deferred' | 'queued' | 'unavailable';

export interface EnrichmentStatus {
  readonly state: EnrichmentState;
  readonly detail: string;
  readonly queueDepth: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly failed: number;
  readonly dropped: number;
  readonly capacity: number;
  readonly oldestPendingAgeMs: number | null;
  readonly lastCompletedAt: Date | null;
  readonly paused: boolean;
}

export interface EnrichmentDispatcher {
  /** Fire and forget. Returns nothing, on purpose — see the module comment. */
  submit(job: EnrichmentJob): void;
  status(now: Date): EnrichmentStatus;
}

export interface InProcessEnrichmentDispatcherOptions {
  readonly handler: EnrichmentHandler;
  readonly capacity?: number;
  readonly concurrency?: number;
  /** Called for a handler rejection. Never rethrows into the request path. */
  readonly onError?: (error: unknown, job: EnrichmentJob) => void;
  /** OPS-003: an operator may pause a class of work. */
  readonly paused?: boolean;
}

const DEFAULT_CAPACITY = 1_000;
const DEFAULT_CONCURRENCY = 4;

export class InProcessEnrichmentDispatcher implements EnrichmentDispatcher {
  readonly #handler: EnrichmentHandler;
  readonly #capacity: number;
  readonly #concurrency: number;
  readonly #onError: (error: unknown, job: EnrichmentJob) => void;

  #queue: EnrichmentJob[] = [];
  #inFlight = 0;
  #completed = 0;
  #failed = 0;
  #dropped = 0;
  #lastCompletedAt: Date | null = null;
  #paused: boolean;

  constructor(options: InProcessEnrichmentDispatcherOptions) {
    this.#handler = options.handler;
    this.#capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.#concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.#onError = options.onError ?? (() => undefined);
    this.#paused = options.paused ?? false;
  }

  submit(job: EnrichmentJob): void {
    if (this.#queue.length >= this.#capacity) {
      // Oldest first: a backlog that keeps its oldest entries is a backlog whose
      // newest — and most relevant — work never runs.
      this.#queue.shift();
      this.#dropped += 1;
    }
    this.#queue.push(job);
    // `queueMicrotask` rather than a synchronous pump: draining here would run
    // handler code inside the request's own tick, which is precisely the
    // coupling UX-004 forbids.
    queueMicrotask(() => {
      this.#pump();
    });
  }

  /** OPS-003 containment. Pausing is a state, not a failure (OPS-004). */
  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    queueMicrotask(() => {
      this.#pump();
    });
  }

  status(now: Date): EnrichmentStatus {
    const oldest = this.#queue[0];
    const oldestPendingAgeMs =
      oldest === undefined ? null : Math.max(0, now.getTime() - oldest.submittedAt.getTime());

    let state: EnrichmentState;
    let detail: string;
    if (this.#paused) {
      state = 'unavailable';
      detail = 'enrichment is intentionally paused (OPS-003)';
    } else if (this.#dropped > 0) {
      state = 'unavailable';
      detail = `enrichment dropped ${this.#dropped} job(s); the captures are durable and the outbox will replay them (FRANK-§12.4)`;
    } else if (this.#queue.length > 0) {
      state = 'queued';
      detail = `${this.#queue.length} job(s) awaiting enrichment`;
    } else {
      state = 'deferred';
      detail = 'enrichment runs off the request path (UX-004)';
    }

    return {
      state,
      detail,
      queueDepth: this.#queue.length,
      inFlight: this.#inFlight,
      completed: this.#completed,
      failed: this.#failed,
      dropped: this.#dropped,
      capacity: this.#capacity,
      oldestPendingAgeMs,
      lastCompletedAt: this.#lastCompletedAt,
      paused: this.#paused,
    };
  }

  #pump(): void {
    if (this.#paused) return;
    while (this.#inFlight < this.#concurrency) {
      const job = this.#queue.shift();
      if (job === undefined) return;
      this.#inFlight += 1;
      // No `await`. A rejection is caught here and never becomes an unhandled
      // rejection that would take the process down with it.
      void this.#handler(job).then(
        () => {
          this.#inFlight -= 1;
          this.#completed += 1;
          this.#lastCompletedAt = new Date();
          this.#pump();
        },
        (error: unknown) => {
          this.#inFlight -= 1;
          this.#failed += 1;
          this.#onError(error, job);
          this.#pump();
        },
      );
    }
  }
}

/**
 * The Slice 1 handler: record that the job arrived and stop.
 *
 * Deliberately does nothing else. FRANK-§12.5 warns that a catalogue listing
 * unproduced events "teaches consumers to subscribe to silence"; a handler that
 * pretended to classify would be the same mistake with a worse blast radius,
 * because a classification nobody wrote is still a classification something will
 * read.
 */
export function noopEnrichmentHandler(): EnrichmentHandler {
  return async () => {
    /* Slice 3 fills this in. Until then, the outbox row is the durable record. */
  };
}
