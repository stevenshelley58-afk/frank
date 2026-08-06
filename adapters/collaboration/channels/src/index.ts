/**
 * `@frank/adapter-collaboration-channels` — Channels collaboration adapter.
 *
 * CH-02 (FRANK-§8E, M4): the Postgres-backed StateStore for the channel
 * runtime. The ChannelPort implementation (CH-03) and the listener app build
 * on this store so registered actions and waiting decisions survive restarts.
 *
 * Authority posture: everything here persists Frank's canonical projections;
 * a channel surface is never an authority (ADR-022).
 */

export {
  PostgresStateStore,
  createPostgresStateStore,
  type PostgresStateStoreConfig,
} from './state-store.js';
