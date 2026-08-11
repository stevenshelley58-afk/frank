import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const runbook = readFileSync(
  resolve(repositoryRoot, 'docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md'),
  'utf8',
);
const fetchMapping = '+refs/heads/main:refs/remotes/origin/main';

function releaseSourceSection(): string {
  const match = runbook.match(/### 2A\. Materialize the clean exact release worktree[\s\S]*?(?=\n### )/);
  if (!match) throw new Error('release worktree runbook section is missing');
  return match[0];
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('production release-source worktree contract', () => {
  it('configures and verifies the narrow main fetch mapping before fetch and tracking', () => {
    const section = releaseSourceSection();
    const configCommand = [
      'git --git-dir="$release_git_dir" config remote.origin.fetch \\',
      `  '${fetchMapping}'`,
    ].join('\n');
    const verifyCommand = [
      'test "$(git --git-dir="$release_git_dir" config --get-all remote.origin.fetch)" = \\',
      `  '${fetchMapping}'`,
    ].join('\n');
    const fetchCommand = 'git --git-dir="$release_git_dir" fetch --prune origin';
    const trackingCommand = 'git --git-dir="$release_git_dir" worktree add --track';

    expect(section).toContain(configCommand);
    expect(section).toContain(verifyCommand);
    expect(section.indexOf(configCommand)).toBeLessThan(section.indexOf(fetchCommand));
    expect(section.indexOf(verifyCommand)).toBeLessThan(section.indexOf(fetchCommand));
    expect(section.indexOf(fetchCommand)).toBeLessThan(section.indexOf(trackingCommand));
    expect(section).not.toContain('refs/heads/*');
    expect(section).not.toMatch(/(?:fetch|clone)[^\n]*(?:--all|--mirror)/);
    expect(section).not.toMatch(/git\s+(?:-C\s+[^\n]+\s+)?(?:reset|clean)\b/);
    expect(section).not.toMatch(/git\s+-C\s+["']?\/srv\/frank\/repo\b/);
  });

  it('lets a fresh bare cache create a tracking worktree without touching a dirty primary', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'frank-release-source-'));
    const origin = resolve(root, 'origin.git');
    const seed = resolve(root, 'seed');
    const primary = resolve(root, 'primary');
    const cache = resolve(root, 'cache.git');
    const release = resolve(root, 'release');

    try {
      git(root, ['init', '--bare', origin]);
      git(root, ['init', '--initial-branch=main', seed]);
      git(seed, ['config', 'user.name', 'Release Contract']);
      git(seed, ['config', 'user.email', 'release-contract@invalid.example']);
      writeFileSync(resolve(seed, 'tracked.txt'), 'reviewed\n', 'utf8');
      git(seed, ['add', 'tracked.txt']);
      git(seed, ['commit', '-m', 'seed']);
      git(seed, ['remote', 'add', 'origin', origin]);
      git(seed, ['push', 'origin', 'main']);
      git(root, [`--git-dir=${origin}`, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

      git(root, ['clone', origin, primary]);
      writeFileSync(resolve(primary, 'local-only.txt'), 'must remain untouched\n', 'utf8');
      const primaryStatus = git(primary, ['status', '--porcelain=v1', '--untracked-files=normal']);

      git(root, ['clone', '--bare', origin, cache]);
      const initialFetchMapping = spawnSync(
        'git',
        [`--git-dir=${cache}`, 'config', '--get-all', 'remote.origin.fetch'],
        { cwd: root, encoding: 'utf8' },
      );
      expect(initialFetchMapping.error).toBeUndefined();
      expect(initialFetchMapping.status).toBe(1);

      git(root, [`--git-dir=${cache}`, 'config', 'remote.origin.fetch', fetchMapping]);
      git(root, [`--git-dir=${cache}`, 'config', 'remote.origin.fetch', fetchMapping]);
      expect(git(root, [`--git-dir=${cache}`, 'config', '--get-all', 'remote.origin.fetch'])).toBe(
        fetchMapping,
      );
      git(root, [`--git-dir=${cache}`, 'fetch', '--prune', 'origin', fetchMapping]);
      git(root, [
        `--git-dir=${cache}`,
        'worktree',
        'add',
        '--track',
        '-b',
        'release-contract',
        release,
        'refs/remotes/origin/main',
      ]);

      expect(git(release, ['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe('origin/main');
      expect(git(release, ['rev-list', '--count', 'origin/main..HEAD'])).toBe('0');
      expect(git(release, ['rev-list', '--count', 'HEAD..origin/main'])).toBe('0');
      expect(readFileSync(resolve(primary, 'local-only.txt'), 'utf8')).toBe('must remain untouched\n');
      expect(git(primary, ['status', '--porcelain=v1', '--untracked-files=normal'])).toBe(
        primaryStatus,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
