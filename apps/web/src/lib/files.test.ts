/**
 * Files console helpers (UI-08) — pure derivation tests:
 *  - write-back state reads straight off the FS-02 declaration;
 *  - sync-waiting degrades gracefully when FS-04 fields are absent;
 *  - artifact id + basename + timestamp helpers never throw.
 */

import { describe, expect, it } from 'vitest';

import {
  type FolderBinding,
  type RoomFile,
  artifactIdOf,
  fileBasename,
  formatStamp,
  syncWaitingOf,
  writeBackStateOf,
} from './files';

function binding(overrides: Partial<FolderBinding> = {}): FolderBinding {
  return {
    id: 'b-1',
    room_id: 'central',
    folder_source: 'design-assets',
    server_path: '/srv/frank/folders/design-assets',
    sync_direction: 'bidirectional',
    mount_mode: 'staged',
    write_back: false,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('writeBackStateOf', () => {
  it('reports write-back on when the declaration opts in', () => {
    expect(writeBackStateOf(binding({ write_back: true }))).toBe('write-back');
  });

  it('reports write-back off by default', () => {
    expect(writeBackStateOf(binding())).toBe('no-write-back');
  });
});

describe('syncWaitingOf (FS-04 graceful degradation)', () => {
  it('is unknown when FS-04 fields are absent', () => {
    expect(syncWaitingOf(binding())).toBe('unknown');
  });

  it('is waiting when pending_sync > 0', () => {
    expect(syncWaitingOf(binding({ pending_sync: 3 }))).toBe('waiting');
  });

  it('is not waiting when pending_sync is 0 and no status', () => {
    expect(syncWaitingOf(binding({ pending_sync: 0 }))).toBe('unknown');
  });

  it('maps sync_status pending to waiting', () => {
    expect(syncWaitingOf(binding({ sync_status: 'pending' }))).toBe('waiting');
  });

  it('maps any other non-empty sync_status to clear', () => {
    expect(syncWaitingOf(binding({ sync_status: 'idle' }))).toBe('clear');
  });
});

describe('artifactIdOf', () => {
  it('prefers artifact_id', () => {
    const f: RoomFile = {
      artifact_id: 'a-1',
      id: 'legacy',
      workbench_id: 'w-1',
      path: '/out/report.html',
      kind: 'html',
      preview_url: null,
      created_at: '2026-08-01T00:00:00.000Z',
    };
    expect(artifactIdOf(f)).toBe('a-1');
  });

  it('falls back to id when artifact_id is missing', () => {
    const f: RoomFile = {
      id: 'legacy',
      workbench_id: 'w-1',
      path: '/out/report.html',
      kind: 'html',
      preview_url: null,
      created_at: '2026-08-01T00:00:00.000Z',
    };
    expect(artifactIdOf(f)).toBe('legacy');
  });
});

describe('fileBasename', () => {
  it('takes the last path segment', () => {
    expect(fileBasename('/work/out/deck.pdf')).toBe('deck.pdf');
  });

  it('handles backslash paths and trailing separators', () => {
    expect(fileBasename('out\\deck.pdf\\')).toBe('deck.pdf');
  });

  it('returns bare names unchanged', () => {
    expect(fileBasename('notes.md')).toBe('notes.md');
  });
});

describe('formatStamp', () => {
  it('renders an em-dash for missing timestamps', () => {
    expect(formatStamp(null)).toBe('—');
    expect(formatStamp(undefined)).toBe('—');
  });

  it('keeps unparseable input verbatim instead of throwing', () => {
    expect(formatStamp('not-a-date')).toBe('not-a-date');
  });

  it('formats valid ISO timestamps', () => {
    const out = formatStamp('2026-08-01T00:00:00.000Z');
    expect(out).not.toBe('—');
    expect(out).not.toBe('2026-08-01T00:00:00.000Z');
  });
});
