/**
 * `@frank/kernel` — FRANK-§7.4 context-pack assembly.
 *
 * Public surface: the {@link ContextPackAssembler} (builds and verifies signed
 * packs) and its vocabulary, plus the canonical-JSON utility used for hashing.
 */

export {
  ContextPackAssembler,
  MissingPackSigningKeyError,
  UntrustedMemoryViolationError,
} from './context-pack-assembler';
export type { AssembleInput } from './context-pack-assembler';
export { canonicalJson, NonCanonicalValueError } from './canonical-json';
export type { CanonicalValue, FloatPolicy } from './canonical-json';
export {
  HarnessBroker,
  NoEligibleHarnessError,
  UnknownHarnessError,
} from './harness-broker';
