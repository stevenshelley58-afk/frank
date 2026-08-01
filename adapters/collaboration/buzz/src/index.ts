/**
 * @frank/adapter-collaboration-buzz
 *
 * Implements the FRANK BuzzPort contract against the Buzz relay WebSocket
 * API. This is the ONLY place FRANK touches Buzz (ADR-011).
 *
 * If Buzz fails or is replaced, only this adapter changes. The BuzzPort
 * contract in @frank/contracts remains stable.
 */

export { BuzzRelayAdapter } from './buzz-relay-adapter.js';
export type { BuzzRelayAdapterConfig } from './buzz-relay-adapter.js';
export { InMemoryBindingStore, InMemoryReplayCache } from './buzz-relay-adapter.js';
export {
  verifyEvent,
  structuralSignatureVerifier,
  DEFAULT_VERIFICATION_CONFIG,
} from './verification.js';
export type {
  VerificationConfig,
  VerificationDeps,
  SignatureVerifier,
  BindingStore,
  ReplayCache,
} from './verification.js';
