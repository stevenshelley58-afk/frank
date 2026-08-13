/**
 * Repository layer — ADR-004, FRANK-§11.5.
 *
 * Every write method takes a `FrankTransaction`, never a `FrankDatabase`, so the
 * "domain mutation, canonical audit entry, and outbox event commit in one
 * transaction or none of them do" rule is enforced by the type checker rather
 * than by discipline. See `src/db.ts`.
 */

export * from './outbox.js';
export * from './audit.js';
export * from './work.js';
export * from './capture.js';
export * from './cost.js';
export * from './attachment.js';
