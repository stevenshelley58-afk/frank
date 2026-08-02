/**
 * Server-side memory singleton (FRANK-§7.4, BRAIN-006).
 *
 * Composes exactly one MemoryProvider for the running app. If MEM0_URL and
 * MEM0_API_KEY are set, uses the self-hosted mem0 backend. Otherwise falls
 * back to the in-memory provider (local dev, no persistence).
 *
 * This is the ONLY place the app chooses a memory implementation — every
 * other call site imports getMemory() and talks to the port.
 */

import { Mem0Provider, InMemoryMemoryProvider } from "@frank/memory";
import type { MemoryProvider } from "@frank/memory";

let instance: MemoryProvider | null = null;

export function getMemory(): MemoryProvider {
  if (instance) return instance;

  const url = process.env.MEM0_URL;
  const key = process.env.MEM0_API_KEY;

  if (url && key) {
    instance = new Mem0Provider({
      baseUrl: url,
      apiKey: key,
      defaultClassification: "internal",
      timeoutMs: 8_000,
    });
  } else {
    // Local dev / test fallback — no persistence across restarts.
    instance = new InMemoryMemoryProvider();
  }

  return instance;
}

/** Force re-init (tests, env reload). */
export function resetMemory(): void {
  instance = null;
}
