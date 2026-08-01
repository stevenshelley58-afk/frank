/**
 * `@frank/memory` — the agent memory port (FRANK-§7.4, BRAIN-006).
 *
 * Public surface: the {@link MemoryProvider} port and its vocabulary, plus two
 * implementations — {@link Mem0Provider} (self-hosted mem0) and
 * {@link InMemoryMemoryProvider} (tests / Slice-1 local dev). Callers depend on
 * the port; the choice of implementation is one line of composition.
 */

export type {
  MemoryProvider,
  MemoryScope,
  RecalledFact,
  StoredFact,
  StoreInput,
} from './provider';
export { Mem0Provider } from './mem0-provider';
export type { Mem0ProviderConfig } from './mem0-provider';
export { InMemoryMemoryProvider } from './in-memory-provider';
