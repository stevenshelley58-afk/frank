// Worktree stage classification — plain-English mapping for non-technical owners.

import { describe, expect, it } from 'vitest';
import { stageTree, treeDirtyCount, dirtySummary, type WorktreeInfo } from './worktrees';

function tree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    name: 'feature-x',
    path: '/srv/frank/repo/.worktrees/feature-x',
    branch: 'feat/feature-x',
    detached: false,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    untracked: 0,
    lastSha: 'abc1234',
    lastSubject: 'some change',
    lastRelative: '2 hours ago',
    ...overrides,
  };
}

describe('stageTree', () => {
  it('marks the current (main) tree as live', () => {
    const s = stageTree(tree({ name: '(main)', branch: 'main', isCurrent: true }));
    expect(s.stage).toBe('live');
    expect(s.label).toContain('Live');
    expect(s.sentence).not.toMatch(/ahead|behind|↑|↓/);
  });

  it('live tree mentions mid-edit files when dirty', () => {
    const s = stageTree(tree({ name: '(main)', branch: 'main', isCurrent: true, modified: 3 }));
    expect(s.stage).toBe('live');
    expect(s.sentence).toContain('3 files');
  });

  it('dirty non-main tree is "being worked on"', () => {
    const s = stageTree(tree({ added: 1, untracked: 2 }));
    expect(s.stage).toBe('working');
    expect(s.sentence).toContain('3 files');
  });

  it('clean tree ahead of live site is "ready to publish"', () => {
    const s = stageTree(tree({ ahead: 1 }));
    expect(s.stage).toBe('ready');
    expect(s.sentence).toContain('ready when you say go');
  });

  it('detached tree is parked', () => {
    const s = stageTree(tree({ branch: null, detached: true }));
    expect(s.stage).toBe('parked');
  });

  it('clean in-sync branch is queued', () => {
    const s = stageTree(tree());
    expect(s.stage).toBe('queued');
    expect(s.sentence).toContain('nothing waiting on you');
  });

  it('never surfaces raw git numbers for parked/queued trees', () => {
    for (const t of [tree({ branch: null, detached: true }), tree()]) {
      const s = stageTree(t);
      expect(s.sentence).not.toMatch(/\d+/);
    }
  });
});

describe('dirty helpers', () => {
  it('treeDirtyCount sums all four counts', () => {
    expect(treeDirtyCount(tree({ added: 1, modified: 2, deleted: 3, untracked: 4 }))).toBe(10);
  });

  it('dirtySummary renders counts or "clean"', () => {
    expect(dirtySummary(tree())).toBe('clean');
    expect(dirtySummary(tree({ added: 1, untracked: 2 }))).toBe('1A 2?');
  });
});
