/**
 * FRANK-§15.7 data protection primitives.
 *
 * `envelope.ts`      — AES-256-GCM envelope encryption for stored `sensitive` fields.
 * `blind-index.ts`   — HMAC-SHA256 blind indexes for the searchable ones.
 * `key-provider.ts`  — the injected key source (ADR-012: OpenBao slots in here).
 */

export * from './key-provider.js';
export * from './envelope.js';
export * from './blind-index.js';
