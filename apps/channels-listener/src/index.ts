/**
 * `@frank/channels-listener` — public surface.
 *
 * The process entry (main.ts) wires the adapter + Frank API client + tap
 * handler into a long-running poll loop. Exported pieces are unit-testable in
 * isolation; the runtime composition lives in `startListener`.
 */

export { FrankApiClient, type FrankApiResult, type CommandEnvelopeInput, type FrankApiClientOptions } from './frank-api.js';
export { handleTap, type TapContext, type TapHandlerDeps, type TapOutcome } from './tap-handler.js';
export { startListener, readConfig, assertTelemetryDisabled, type ListenerConfig } from './main.js';
