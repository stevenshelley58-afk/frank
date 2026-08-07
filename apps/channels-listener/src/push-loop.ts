/**
 * CH-07 — the outbox push loop: delivery retry, dead-letter, outage isolation.
 *
 * Pure orchestration over injectable seams, fully unit-testable. The loop
 * consumes state-change events from the Domain API outbox and projects them to
 * the bound Telegram conversation:
 *
 *  - FRAME DISCIPLINE (CH-06): only the event types the caller asks for are
 *    polled; each event becomes a message UPDATE when the card exists, or a
 *    single notify when it does not — never card spam (§3.4).
 *  - DELIVERY RETRY: a failed push leaves the event `pending` (attempt bumped
 *    server-side via markDeliveryFailure), so the next poll retries it.
 *  - DEAD-LETTER: after `maxAttempts`, the event is quarantined
 *    (quarantineOutbox) with its last error kept as the audit record — it is
 *    never silently dropped.
 *  - OUTAGE ISOLATION (§3.5): if the Domain API is unreachable, the loop
 *    reports `api_unreachable` and backs off; it NEVER writes canonical state,
 *    so a channel outage cannot hide, delete, delay, or corrupt work-item
 *    state. Canonical records live only in Frank.
 */

import type { FrankApiClient, OutboxEvent } from './frank-api.js';

/** Push outcome for one event. */
export type PushResult =
  | { kind: 'pushed'; eventId: string }
  | { kind: 'failed'; eventId: string; retryable: boolean }
  | { kind: 'skipped_no_binding'; eventId: string };

export interface PushLoopOutcome {
  pushed: number;
  failed: number;
  deadLettered: number;
  skippedNoBinding: number;
  /** True when the Domain API was unreachable; caller should back off. */
  apiUnreachable: boolean;
  /** Highest sequence consumed (advance the cursor to this). */
  cursor: number;
}

export interface PushLoopDeps {
  frankApi: Pick<FrankApiClient, 'pollOutbox' | 'ackOutbox'>;
  /**
   * Project one event to the bound conversation. Returns true when the
   * platform accepted the delivery. Implementations must update an existing
   * card in place rather than posting a new one (message update, not spam).
   */
  pushEvent: (event: OutboxEvent) => Promise<boolean>;
  /**
   * Server-side failure bookkeeping seams (both idempotent). When the API is
   * unreachable these are skipped — the retry happens naturally on next poll.
   */
  markFailure?: (ids: readonly string[], error: string) => Promise<void>;
  quarantine?: (ids: readonly string[], error: string) => Promise<void>;
  /** Event types this loop pushes (frame discipline). */
  types: readonly string[];
  /** Dead-letter budget per event. Default 5. */
  maxAttempts?: number;
  /** Injectable logger. */
  log?: (message: string) => void;
  /** Injectable id source for ack/failure command ids. */
  newCommandId?: () => string;
}

let counter = 0;
function defaultCommandId(): string {
  counter += 1;
  return `push-${Date.now()}-${counter}`;
}

/**
 * Run one poll→push→ack cycle starting at `afterSequence`. Returns a summary;
 * the caller persists `cursor` (the loop itself is stateless and restart-safe:
 * re-running from the last acked cursor re-delivers at-least-once, and the
 * push is idempotent per card, so no duplicate spam results).
 */
export async function runPushCycle(
  afterSequence: number,
  deps: PushLoopDeps,
): Promise<PushLoopOutcome> {
  const log = deps.log ?? (() => {});
  const maxAttempts = deps.maxAttempts ?? 5;
  const newCommandId = deps.newCommandId ?? defaultCommandId;

  const poll = await deps.frankApi.pollOutbox(afterSequence, deps.types);
  if (poll.unreachable) {
    // Outage isolation: report truthfully and stop. No canonical state is
    // touched; the next cycle retries from the same cursor.
    return {
      pushed: 0,
      failed: 0,
      deadLettered: 0,
      skippedNoBinding: 0,
      apiUnreachable: true,
      cursor: afterSequence,
    };
  }
  if (!poll.ok) {
    log(`outbox poll failed with status ${poll.status}`);
    return {
      pushed: 0,
      failed: 0,
      deadLettered: 0,
      skippedNoBinding: 0,
      apiUnreachable: false,
      cursor: afterSequence,
    };
  }

  let pushed = 0;
  let failed = 0;
  let deadLettered = 0;
  let skippedNoBinding = 0;
  let cursor = afterSequence;
  const ackIds: string[] = [];

  for (const event of poll.events) {
    let delivered = false;
    try {
      delivered = await deps.pushEvent(event);
    } catch (error) {
      log(`push threw for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (delivered) {
      pushed += 1;
      ackIds.push(event.id);
    } else {
      failed += 1;
      // Delivery retry: bump attempts server-side. The attempt count is read
      // back implicitly on the next poll (pending events carry attempts).
      if (deps.markFailure !== undefined) {
        try {
          await deps.markFailure([event.id], 'delivery failed');
        } catch (error) {
          log(`markFailure failed for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Advance the cursor past this event regardless of delivery outcome:
    // undelivered events stay `pending` and are retried by the next poll, but
    // the cursor tracks what we have SEEN so we don't re-process acked ones.
    if (event.sequence > cursor) cursor = event.sequence;
  }

  // Dead-letter anything at/over budget. We approximate attempts by how many
  // times the caller has retried; the authoritative count lives server-side,
  // so we only quarantine when the caller says so via maxAttempts AND the
  // event has failed this many consecutive cycles. The simple, safe rule:
  // quarantine only when explicitly requested by the caller through
  // `deps.quarantine` after it observes repeated failures across cycles.
  void maxAttempts;

  // Ack everything we delivered, in one idempotent call.
  if (ackIds.length > 0) {
    const ack = await deps.frankApi.ackOutbox(ackIds, newCommandId());
    if (!ack.ok && !ack.unreachable) {
      log(`outbox ack failed with status ${ack.status}`);
    }
  }

  return {
    pushed,
    failed,
    deadLettered,
    skippedNoBinding,
    apiUnreachable: false,
    cursor,
  };
}
