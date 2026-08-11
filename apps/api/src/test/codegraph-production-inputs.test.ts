import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const runbook = readFileSync(
  resolve(repositoryRoot, 'docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md'),
  'utf8',
);
const compose = readFileSync(
  resolve(repositoryRoot, 'infra/production/docker-compose.app.yml'),
  'utf8',
);

function stageSection(): string {
  const match = runbook.match(/### 2B\. Stage non-root codegraph inputs[\s\S]*?(?=\n### )/);
  if (!match) throw new Error('codegraph input staging section is missing');
  return match[0];
}

function hasModeAccess(
  mode: number,
  owner: number,
  group: number,
  uid: number,
  groups: number[],
  permission: 0o1 | 0o2 | 0o4,
): boolean {
  const shift = uid === owner ? 6 : groups.includes(group) ? 3 : 0;
  return ((mode >> shift) & permission) !== 0;
}

function isSafeRegistrySource(releaseRoot: string, source: string): boolean {
  const sourceStat = lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) return false;
  if (realpathSync(source) !== source) return false;
  const fromRelease = relative(releaseRoot, source);
  return fromRelease !== '' && fromRelease !== '..' && !fromRelease.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

describe('production codegraph staged-input contract', () => {
  it('binds only explicit staged inputs and keeps both services non-root', () => {
    expect(compose.match(/FRANK_CODEGRAPH_REGISTRY_HOST_PATH:\?/g)).toHaveLength(2);
    expect(compose).toContain(
      'source: "${FRANK_CODEGRAPH_PROJECT_FRANK_HOST_PATH:?FRANK_CODEGRAPH_PROJECT_FRANK_HOST_PATH is required}"',
    );
    expect(compose).not.toContain(
      '${FRANK_RELEASE_SOURCE:-/srv/frank/repo}/infra/production/codegraph-projects.json',
    );
    expect(compose).not.toMatch(/source: "\$\{FRANK_RELEASE_SOURCE[^\n]+"\n\s+target: \/repositories\/frank/);

    const api = compose.match(/\n  frank-api:[\s\S]*?(?=\n  frank-web:)/)?.[0] ?? '';
    const codegraph = compose.match(/\n  frank-codegraph:[\s\S]*?(?=\nnetworks:)/)?.[0] ?? '';
    expect(api).toContain('user: "10001:10001"');
    expect(codegraph).toContain('user: "10001:10001"');
  });

  it('stages exact tracked inputs atomically without opening the private Git worktree', () => {
    const section = stageSection();
    expect(section).toContain('test "$(realpath -e -- "$FRANK_RELEASE_SOURCE")" = "$FRANK_RELEASE_SOURCE"');
    expect(section).toContain('ls-files --error-unmatch');
    expect(section).toContain(
      'infra/production/codegraph-projects.json >/dev/null',
    );
    expect(section).toContain('test -f "$registry_source" && test ! -L "$registry_source"');
    expect(section).toContain('test "$(realpath -e -- "$registry_source")" = "$registry_source"');
    expect(section).toContain(
      '"$FRANK_EXPECTED_COMMIT:infra/production/codegraph-projects.json"',
    );
    expect(section).toContain('.mount == "/repositories/frank"');
    expect(section).toContain('git -C "$FRANK_RELEASE_SOURCE" archive --format=tar "$FRANK_EXPECTED_COMMIT"');
    expect(section).toContain(`':(exclude)**/.env.*'`);
    expect(section).toContain(`':(exclude)**/secrets/**'`);
    expect(section).toContain(`':(exclude)**/node_modules/**'`);
    expect(section).toContain(`':(exclude)**/dist/**'`);
    expect(section).toContain('test "$registry_source_sha256_before" = "$registry_source_sha256_after"');
    expect(section).toContain('test "$registry_source_sha256_before" = "$registry_staged_sha256"');
    expect(section).toContain('mv -T -- "$codegraph_inputs_tmp" "$FRANK_CODEGRAPH_INPUTS_HOST_PATH"');
    expect(section).toContain('test ! -e "$FRANK_CODEGRAPH_PROJECT_FRANK_HOST_PATH/.git"');
    expect(section).not.toMatch(/(?:chown|chmod)[^\n]*FRANK_RELEASE_SOURCE/);
  });

  it('gives UID 10001 read/traverse but no write, and denies an unrelated identity', () => {
    const rootUid = 0;
    const serviceUid = 10001;
    const serviceGroups = [10001];
    const unrelatedUid = 10002;
    const unrelatedGroups = [10002];

    expect(hasModeAccess(0o750, rootUid, 10001, serviceUid, serviceGroups, 0o1)).toBe(true);
    expect(hasModeAccess(0o640, rootUid, 10001, serviceUid, serviceGroups, 0o4)).toBe(true);
    expect(hasModeAccess(0o750, rootUid, 10001, serviceUid, serviceGroups, 0o2)).toBe(false);
    expect(hasModeAccess(0o640, rootUid, 10001, serviceUid, serviceGroups, 0o2)).toBe(false);
    expect(hasModeAccess(0o750, rootUid, 10001, unrelatedUid, unrelatedGroups, 0o1)).toBe(false);
    expect(hasModeAccess(0o640, rootUid, 10001, unrelatedUid, unrelatedGroups, 0o4)).toBe(false);

    expect(hasModeAccess(0o700, rootUid, 0, serviceUid, serviceGroups, 0o1)).toBe(false);
    expect(hasModeAccess(0o600, rootUid, 0, serviceUid, serviceGroups, 0o4)).toBe(false);
    expect(runbook).toContain('docker run --rm --network none --read-only --user 10001:10001');
    expect(runbook).toContain('docker run --rm --network none --read-only --user 10002:10002');
    expect(runbook).toContain('UID 10001 unexpectedly wrote');
  });

  it('rejects linked, non-file, and out-of-tree registry sources', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'frank-codegraph-inputs-'));
    try {
      const release = resolve(root, 'release');
      const registry = resolve(release, 'infra/production/codegraph-projects.json');
      mkdirSync(resolve(release, 'infra/production'), { recursive: true });
      chmodSync(release, 0o700);
      writeFileSync(registry, '{"projects":[]}\n', 'utf8');
      chmodSync(registry, 0o600);
      expect(isSafeRegistrySource(release, registry)).toBe(true);

      const linked = resolve(release, 'infra/production/linked.json');
      symlinkSync(registry, linked);
      expect(isSafeRegistrySource(release, linked)).toBe(false);

      const directory = resolve(release, 'infra/production/not-a-file');
      mkdirSync(directory);
      expect(isSafeRegistrySource(release, directory)).toBe(false);

      const outside = resolve(root, 'outside.json');
      writeFileSync(outside, '{}\n', 'utf8');
      expect(isSafeRegistrySource(release, outside)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
