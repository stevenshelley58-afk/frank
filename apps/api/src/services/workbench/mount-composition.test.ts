/**
 * FS-03 mount composition — pure unit tests (no database, no Docker).
 *
 * The rule under test (master plan §3.2 / §8G FS-02 verify gate): a
 * workbench receives ONLY folders that are (a) bound to its room AND (b)
 * named in its task definition. Both lists narrow: an unbound request yields
 * nothing, and an unrequested binding yields nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  composeTaskDefMounts,
  composeWorkbenchMounts,
} from './mount-composition.js';
import type { RoomFolderBindingRecord } from './folder-binding-store.js';
import type { WorkbenchMount } from './types.js';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function binding(
  overrides: Partial<RoomFolderBindingRecord> & Pick<RoomFolderBindingRecord, 'id' | 'folderSource'>,
): RoomFolderBindingRecord {
  return {
    cellId: 'cell-steven',
    roomId: 'room-a',
    serverPath: `/srv/frank/sync/room-a/${overrides.folderSource}`,
    syncDirection: 'send-only',
    mountMode: 'ro',
    writeBack: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('FS-03 mount composition (pure)', () => {
  it('yields exactly the folders that are bound AND named', () => {
    const bindings = [
      binding({ id: 'b-notes', folderSource: 'notes', mountMode: 'staged' }),
      binding({ id: 'b-docs', folderSource: 'docs', mountMode: 'rw' }),
      binding({ id: 'b-archive', folderSource: 'archive', mountMode: 'ro' }),
    ];

    const result = composeWorkbenchMounts(
      [
        { folderSource: 'notes', path: '/mnt/notes' },
        { folderSource: 'docs', path: '/mnt/docs' },
      ],
      bindings,
    );

    // The bound-but-unrequested folder (archive) stays OUT; both requested
    // bound folders come in with the binding's server path + mode.
    expect(result.unboundRequests).toEqual([]);
    expect(result.mounts).toEqual([
      {
        source: '/srv/frank/sync/room-a/notes',
        path: '/mnt/notes',
        mode: 'staged',
        bindingId: 'b-notes',
        folderSource: 'notes',
      },
      {
        source: '/srv/frank/sync/room-a/docs',
        path: '/mnt/docs',
        mode: 'rw',
        bindingId: 'b-docs',
        folderSource: 'docs',
      },
    ]);
  });

  it('refuses a request for a folder the room never bound (default-closed)', () => {
    const bindings = [binding({ id: 'b-notes', folderSource: 'notes' })];

    const result = composeWorkbenchMounts(
      [
        { folderSource: 'notes', path: '/mnt/notes' },
        { folderSource: 'secrets', path: '/mnt/secrets' },
      ],
      bindings,
    );

    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0]?.folderSource).toBe('notes');
    expect(result.unboundRequests).toEqual(['secrets']);
  });

  it('yields no mounts for an empty request list or an unbound room', () => {
    const bindings = [binding({ id: 'b-notes', folderSource: 'notes' })];

    expect(composeWorkbenchMounts([], bindings).mounts).toEqual([]);
    expect(
      composeWorkbenchMounts([{ folderSource: 'notes', path: '/mnt/notes' }], []).mounts,
    ).toEqual([]);
    const nothing = composeWorkbenchMounts([{ folderSource: 'x', path: '/mnt/x' }], []);
    expect(nothing.unboundRequests).toEqual(['x']);
  });

  it('the binding mode is the enforcement ceiling — the task def cannot loosen it', () => {
    const bindings = [binding({ id: 'b-notes', folderSource: 'notes', mountMode: 'ro' })];

    // A task def asking for `rw` on an `ro`-bound folder does not upgrade.
    const result = composeTaskDefMounts(
      [{ source: 'notes', path: '/mnt/notes', mode: 'rw' } satisfies WorkbenchMount],
      bindings,
    );

    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0]?.mode).toBe('ro');
    expect(result.mounts[0]?.source).toBe('/srv/frank/sync/room-a/notes');
  });

  it('the task def source names the folder; the binding supplies the server path', () => {
    const bindings = [
      binding({ id: 'b-x', folderSource: 'laptop-notes', serverPath: '/srv/frank/sync/room-a/laptop-notes' }),
    ];

    const result = composeTaskDefMounts(
      // The task def's source is the folder's id/name, never a host path the
      // run chooses — composition swaps in the binding's server_path.
      [{ source: 'laptop-notes', path: '/mnt/notes', mode: 'staged' }],
      bindings,
    );

    expect(result.mounts).toEqual([
      {
        source: '/srv/frank/sync/room-a/laptop-notes',
        path: '/mnt/notes',
        mode: 'ro', // binding ceiling (default ro in the fixture)
        bindingId: 'b-x',
        folderSource: 'laptop-notes',
      },
    ]);
  });

  it('an undefined mounts array composes to nothing', () => {
    const bindings = [binding({ id: 'b-notes', folderSource: 'notes' })];
    const result = composeTaskDefMounts(undefined, bindings);
    expect(result.mounts).toEqual([]);
    expect(result.unboundRequests).toEqual([]);
  });
});
