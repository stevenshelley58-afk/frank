/**
 * The canonical FRANK domain schema — ADR-003, FRANK-§11.
 *
 * Slice 1 bounded contexts (FRANK-§11.2): source, work, conversation,
 * notification, audit, cost, plus the ADR-004 transactional outbox and its
 * consumer inbox.
 *
 * Everything lives in the `frank_domain` PostgreSQL schema; see `shared.ts` for
 * why that satisfies FRANK-§11.4 without giving up the single-transaction
 * guarantee ADR-004 depends on.
 */

export * from './shared.js';
export * from './source.js';
export * from './work.js';
export * from './room-mission.js';
export * from './conversation.js';
export * from './notification.js';
export * from './audit.js';
export * from './cost.js';
export * from './outbox.js';
export * from './chat-shell.js';
export * from './harness-control.js';
