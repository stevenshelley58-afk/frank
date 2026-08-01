/**
 * @frank/adapter-harness-goose
 *
 * Implements the FRANK HarnessAdapter protocol against Goose's
 * ACP (Agent Communication Protocol) HTTP/WebSocket server.
 *
 * Goose runs headless via `goose serve` and exposes an ACP endpoint.
 * This adapter translates Frank's room/session protocol into ACP calls.
 */

export { GooseAdapter } from './goose-adapter.js';
export type { GooseAdapterConfig } from './goose-adapter.js';
export type {
  HarnessAdapter,
  SessionHandle,
  StreamChunk,
  ProviderConfig,
  ProviderInfo,
} from './types.js';
