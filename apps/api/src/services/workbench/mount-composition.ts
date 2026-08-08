/**
 * FS-03 — mount composition: which folders actually enter a workbench.
 *
 * Master plan §3.2 (filesystem fence): a workbench receives ONLY folders that
 * are (a) bound to its room (FS-02 `room_folder_binding` declarations) AND
 * (b) named in its task definition. Neither list alone is sufficient:
 *
 *   - A binding declares the room's folders for ALL its workbenches, but a
 *     task may need only some of them — the task def's mount names narrow it.
 *   - A task def can name arbitrary paths, but nothing from the host enters
 *     the container unless the room bound it — the bindings narrow it back.
 *
 * The result is the INTERSECTION: one {@link WorkbenchMount} per requested
 * folder, sourced at the binding's `server_path`, in the binding's
 * `mount_mode`. The task def can never override the source path or loosen the
 * mode (a request for `rw` on a `ro`-bound folder does not upgrade it — the
 * binding's mode is the enforcement ceiling), only name WHICH bound folders
 * the run wants and WHERE inside the container they appear.
 *
 * ## Pure on purpose
 *
 * This module reads nothing. The caller loads the room's bindings through
 * {@link RoomFolderBindingStore.listByRoom} and passes them in — which is
 * what makes the rule unit-testable without a database and lets the
 * integration test pin the DB-to-mounts path end to end.
 *
 * ## What this module deliberately does NOT do
 *
 * Mount ENFORCEMENT at the container level (ro bind mounts refuse writes,
 * staged sources are copy-ins, never bind mounts) already lives in
 * `provisioner.ts` (WB-03): this module only decides what the provisioner
 * gets. Staged write-back (an approved staged copy landing in the shared
 * source) is `staged-write.ts`, not here.
 */

import type { RoomFolderBindingRecord } from './folder-binding-store.js';
import type { WorkbenchMount } from './types.js';

/** One mount the task definition asks for. */
export interface RequestedMount {
  /** Which synced folder the run wants — matched against `folder_source`. */
  readonly folderSource: string;
  /** Where the folder appears inside the container (absolute; not /workspace). */
  readonly path: string;
}

export interface ComposedMount {
  readonly source: string;
  readonly path: string;
  /** The BINDING's mode — the enforcement ceiling the task cannot loosen. */
  readonly mode: 'ro' | 'rw' | 'staged';
  /** Which binding supplied the source path and mode (provenance). */
  readonly bindingId: string;
  readonly folderSource: string;
}

export interface ComposeMountsResult {
  /** Exactly the bound-and-named folders, in task-def request order. */
  readonly mounts: readonly ComposedMount[];
  /** Requested folder sources with no binding for the room — refused, never guessed. */
  readonly unboundRequests: readonly string[];
}

/**
 * Compose the mounts a workbench actually receives.
 *
 * Pure function of the task def's requested mounts and the room's bindings:
 * every request that matches a binding (by `folder_source`) yields exactly one
 * mount at the binding's `server_path` and `mount_mode`; every request that
 * matches nothing is reported in `unboundRequests` and yields nothing. A
 * workbench with no requests — or a room with no bindings — receives no
 * mounts at all, which is the fence's default posture (§3.2: nothing enters
 * unless explicitly named on BOTH sides).
 */
export function composeWorkbenchMounts(
  requestedMounts: readonly RequestedMount[],
  bindings: readonly RoomFolderBindingRecord[],
): ComposeMountsResult {
  // Bindings are keyed by folder source — the binding store's
  // (cell, room, folder_source) uniqueness means this map has no collisions.
  const bySource = new Map<string, RoomFolderBindingRecord>();
  for (const binding of bindings) {
    bySource.set(binding.folderSource, binding);
  }

  const mounts: ComposedMount[] = [];
  const unbound: string[] = [];

  for (const request of requestedMounts) {
    const binding = bySource.get(request.folderSource);
    if (binding === undefined) {
      // A folder the room never bound: refuse it rather than invent a
      // source path. The fence is default-closed.
      unbound.push(request.folderSource);
      continue;
    }
    mounts.push({
      source: binding.serverPath,
      path: request.path,
      // The binding's mode is the ceiling: the task def names folders, it
      // does not choose privilege.
      mode: binding.mountMode,
      bindingId: binding.id,
      folderSource: binding.folderSource,
    });
  }

  return { mounts, unboundRequests: unbound };
}

/**
 * Narrow a full {@link WorkbenchTaskDef} mounts array to the room's bindings
 * — the shape the workbench creation path needs: task def mounts in, task def
 * mounts out, with unbound requests dropped (and reported).
 */
export function composeTaskDefMounts(
  taskDefMounts: readonly WorkbenchMount[] | undefined,
  bindings: readonly RoomFolderBindingRecord[],
): ComposeMountsResult {
  const requested: RequestedMount[] = (taskDefMounts ?? []).map((mount) => ({
    // The task def's `source` names the synced folder (its id/name on the
    // device); the VPS path comes from the binding, never from the request.
    folderSource: mount.source,
    path: mount.path,
  }));
  const result = composeWorkbenchMounts(requested, bindings);
  return {
    mounts: result.mounts.map((composed) => ({
      source: composed.source,
      path: composed.path,
      mode: composed.mode,
      bindingId: composed.bindingId,
      folderSource: composed.folderSource,
    })),
    unboundRequests: result.unboundRequests,
  };
}
