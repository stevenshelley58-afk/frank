/**
 * Memory scope resolver (FRANK-§2.4 cell scoping, BRAIN-006).
 *
 * Every memory call is scoped to exactly one cell, an owner, and optionally a
 * project/room narrowing. FRANK-§2.4 is non-negotiable: no state escapes its
 * cell. For this single-owner deployment the cell + owner come from env, with
 * safe defaults; project/room come from the request. This is the ONE place a
 * scope is derived — routes and the chat pack-assembler both call into here so
 * a scope is never assembled by hand at a call site.
 */

import type { MemoryScope } from '@frank/memory';

const DEFAULT_CELL_ID = process.env.FRANK_CELL_ID ?? 'frank';
const DEFAULT_OWNER_ID = process.env.FRANK_OWNER_ID ?? 'steve';

/** The deployment-wide cell + owner. FRANK-§2.4. */
export function deploymentScope(): { cellId: string; ownerId: string } {
  return { cellId: DEFAULT_CELL_ID, ownerId: DEFAULT_OWNER_ID };
}

/**
 * Build a full memory scope. `projectId` / `roomId` are optional narrowings;
 * pass them as a room id (e.g. `central`, `blockwise`) to keep memory
 * separated per room, matching the room-scoped orchestrators.
 */
export function memoryScope(input: {
  projectId?: string;
  roomId?: string;
}): MemoryScope {
  const base = deploymentScope();
  const scope: MemoryScope = { cellId: base.cellId, ownerId: base.ownerId };
  if (input.projectId !== undefined && input.projectId.length > 0) {
    return { ...scope, projectId: input.projectId };
  }
  if (input.roomId !== undefined && input.roomId.length > 0) {
    return { ...scope, roomId: input.roomId };
  }
  return scope;
}
