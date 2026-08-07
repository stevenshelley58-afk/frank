/**
 * WorkbenchEventBus — in-process wake-up signal for new workbench events.
 *
 * WB-06: the SSE route (`GET /v1/workbenches/:id/events`) must deliver events
 * live. The database is the source of truth (events are read back by seq, so
 * nothing is duplicated or lost), and this bus is ONLY the wake-up mechanism:
 * "something was appended to workbench X — go read the DB."
 *
 * Because the bus is a hint, not a transport, the SSE route also polls on a
 * timer. That makes delivery correct even when events are written by another
 * process (a runner deployed separately) or when a bus notification is missed.
 * Liveness from the bus, durability from the poll — neither alone is enough.
 */

type WakeListener = () => void;

export class WorkbenchEventBus {
  readonly #listeners = new Map<string, Set<WakeListener>>();

  /** Subscribe to wake-ups for one workbench. Returns the unsubscribe fn. */
  subscribe(workbenchId: string, listener: WakeListener): () => void {
    let set = this.#listeners.get(workbenchId);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(workbenchId, set);
    }
    set.add(listener);
    return () => {
      const current = this.#listeners.get(workbenchId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.#listeners.delete(workbenchId);
    };
  }

  /** Wake every subscriber of one workbench. Called by WorkbenchStore.appendEvent. */
  notify(workbenchId: string): void {
    const set = this.#listeners.get(workbenchId);
    if (set === undefined) return;
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        /* a broken listener must never break the append path */
      }
    }
  }

  /** Visible for tests: how many workbenches have live subscribers. */
  get subscribedWorkbenchCount(): number {
    return this.#listeners.size;
  }
}
