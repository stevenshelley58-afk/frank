import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const preflight = readFileSync(
  resolve(repositoryRoot, 'scripts/production/hosted-preflight.sh'),
  'utf8',
);
const runbook = readFileSync(
  resolve(repositoryRoot, 'docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md'),
  'utf8',
);

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}`, 'utf8');
  chmodSync(path, 0o755);
}

function runPreflight(overrides: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'frank-preflight-disk-'));
  const mockBin = resolve(root, 'bin');
  const repository = resolve(root, 'repo');
  const data = resolve(root, 'data');
  const compose = resolve(root, 'compose.yml');
  mkdirSync(mockBin);
  mkdirSync(repository);
  mkdirSync(data);
  writeFileSync(compose, 'services: {}\n', 'utf8');
  writeExecutable(
    resolve(mockBin, 'df'),
    `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'\nprintf '/dev/mock 999999999 1 %s %s%% /mock\\n' "\${MOCK_AVAILABLE_KIB}" "\${MOCK_USED_PERCENT}"\n`,
  );
  writeExecutable(
    resolve(mockBin, 'git'),
    `case "$*" in
  *"status --porcelain"*) exit 0 ;;
  *"rev-parse --is-inside-work-tree"*) printf 'true\\n' ;;
  *"rev-parse HEAD"*) printf '%s\\n' "$FRANK_EXPECTED_COMMIT" ;;
  *"symbolic-ref --quiet --short HEAD"*) printf '%s\\n' "$FRANK_EXPECTED_BRANCH" ;;
  *"rev-parse --abbrev-ref @{upstream}"*) printf 'origin/main\\n' ;;
  *"rev-list --count"*) printf '0\\n' ;;
  *) printf 'unexpected git invocation: %s\\n' "$*" >&2; exit 90 ;;
esac
`,
  );
  writeExecutable(
    resolve(mockBin, 'docker'),
    `case "$*" in
  "info") exit 0 ;;
  compose*) exit 0 ;;
  *"network inspect"*".Internal"*) printf 'true\\n' ;;
  *"network inspect"*) printf 'bridge\\n' ;;
  *"NetworkSettings.Networks"*) printf '{"frank":{}}\\n' ;;
  *".State.Status"*) printf 'running\\n' ;;
  *".State.Health"*) printf 'healthy\\n' ;;
  *".Id"*) printf 'sha256:%064d\\n' 0 ;;
  inspect*) exit 0 ;;
  *) printf 'unexpected docker invocation: %s\\n' "$*" >&2; exit 91 ;;
esac
`,
  );
  writeExecutable(resolve(mockBin, 'jq'), 'exit 0\n');

  const image = `ghcr.io/test/frank-workbench@sha256:${'a'.repeat(64)}`;
  const environment: NodeJS.ProcessEnv = {
    PATH: `${mockBin}:${process.env.PATH ?? ''}`,
    MOCK_AVAILABLE_KIB: '1048576',
    MOCK_USED_PERCENT: '50',
    FRANK_REPO_PATH: repository,
    FRANK_COMPOSE_FILE: compose,
    FRANK_DATA_PATH: data,
    FRANK_EXPECTED_COMMIT: 'a'.repeat(40),
    FRANK_EXPECTED_BRANCH: 'main',
    FRANK_REQUIRED_NETWORK: 'frank',
    FRANK_CODEGRAPH_CONTAINER: 'codegraph-not-in-required-set',
    FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK: 'true',
    FRANK_MIN_FREE_GIB: '1',
    FRANK_REQUIRED_SECRET_VARS: 'TEST_SECRET',
    TEST_SECRET: 'present',
    FRANK_REQUIRED_CONTAINERS: 'test-container',
    FRANK_WORKBENCH_IMAGE: image,
    FRANK_REQUIRED_IMAGES: image,
    ...overrides,
  };
  const result = spawnSync('bash', [resolve(repositoryRoot, 'scripts/production/hosted-preflight.sh')], {
    env: environment,
    encoding: 'utf8',
  });
  rmSync(root, { recursive: true, force: true });
  return result;
}

describe('hosted release absolute disk gate', () => {
  it('keeps percent as the default and makes absolute mode fail closed', () => {
    expect(preflight).toContain('readonly disk_gate_mode="${FRANK_DISK_GATE_MODE:-percent}"');
    expect(preflight).toContain('[[ "$disk_gate_mode" == "percent" || "$disk_gate_mode" == "absolute" ]]');
    expect(preflight).toContain('(( disk_used_percent <= max_disk_percent ))');
    expect(preflight).toContain('absolute byte inputs require FRANK_DISK_GATE_MODE=absolute');
    expect(preflight).toContain('FRANK_RELEASE_REQUIRED_BYTES must be a positive canonical decimal byte count');
    expect(preflight).toContain('FRANK_ROLLBACK_HEADROOM_BYTES must be a positive canonical decimal byte count');
    expect(preflight).toContain('release disk byte requirement overflows the signed 64-bit range');
    expect(preflight).toContain('(( disk_available_bytes >= release_total_required_bytes ))');
  });

  it('records every exact byte value in preflight evidence', () => {
    for (const field of [
      'disk_available_bytes',
      'release_required_bytes',
      'rollback_headroom_bytes',
      'release_total_required_bytes',
    ]) {
      expect(preflight).toContain(`printf '${field}=%s\\n'`);
    }
  });

  it('binds the runbook to the reviewed conservative capacity calculation', () => {
    const releaseRequired = 21_932_447_888n;
    const rollbackHeadroom = 23_862_108_519n;
    const totalRequired = 45_794_556_407n;

    expect(releaseRequired + rollbackHeadroom).toBe(totalRequired);
    expect(runbook).toContain(`export FRANK_DISK_GATE_MODE='absolute'`);
    expect(runbook).toContain(`export FRANK_RELEASE_REQUIRED_BYTES='${releaseRequired}'`);
    expect(runbook).toContain(`export FRANK_ROLLBACK_HEADROOM_BYTES='${rollbackHeadroom}'`);
    expect(runbook).toContain(`grep -Fx 'release_total_required_bytes=${totalRequired}'`);
    for (const coveredCapacity of [
      'Candidate image pull',
      'PostgreSQL backup plus transient output',
      'CodeGraph volume snapshot plus transient output',
      'Five coexisting Graphify releases',
      'Bounded service logs and release evidence',
      'Retained rollback images and image archive',
      'Explicit operational safety reserve',
    ]) {
      expect(runbook).toContain(coveredCapacity);
    }
  });

  it('keeps default percent behavior and accepts exact absolute equality', () => {
    const percent = runPreflight({ MOCK_USED_PERCENT: '87', MOCK_AVAILABLE_KIB: '2097152' });
    expect(percent.status).not.toBe(0);
    expect(percent.stderr).toContain('disk use is 87%, above the 75% release limit');

    const equality = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_RELEASE_REQUIRED_BYTES: '536870912',
      FRANK_ROLLBACK_HEADROOM_BYTES: '536870912',
    });
    expect(equality.status).toBe(0);
    expect(equality.stdout).toContain('disk_available_bytes=1073741824\n');
    expect(equality.stdout).toContain('release_total_required_bytes=1073741824\n');
  });

  it('rejects one byte short and still enforces the independent minimum-free gate', () => {
    const short = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_RELEASE_REQUIRED_BYTES: '536870912',
      FRANK_ROLLBACK_HEADROOM_BYTES: '536870913',
    });
    expect(short.status).not.toBe(0);
    expect(short.stderr).toContain(
      'free disk bytes 1073741824 are below release requirement 1073741825',
    );

    const minimum = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_RELEASE_REQUIRED_BYTES: '1',
      FRANK_ROLLBACK_HEADROOM_BYTES: '1',
      FRANK_MIN_FREE_GIB: '2',
    });
    expect(minimum.status).not.toBe(0);
    expect(minimum.stderr).toContain('free disk space is below the 2 GiB release minimum');
  });

  const invalidInputs: Array<[NodeJS.ProcessEnv, string]> = [
    [{ FRANK_DISK_GATE_MODE: 'absolute', FRANK_ROLLBACK_HEADROOM_BYTES: '1' }, 'FRANK_RELEASE_REQUIRED_BYTES'],
    [
      {
        FRANK_DISK_GATE_MODE: 'absolute',
        FRANK_RELEASE_REQUIRED_BYTES: '0',
        FRANK_ROLLBACK_HEADROOM_BYTES: '1',
      },
      'FRANK_RELEASE_REQUIRED_BYTES',
    ],
    [
      {
        FRANK_DISK_GATE_MODE: 'absolute',
        FRANK_RELEASE_REQUIRED_BYTES: '01',
        FRANK_ROLLBACK_HEADROOM_BYTES: '1',
      },
      'FRANK_RELEASE_REQUIRED_BYTES',
    ],
    [
      {
        FRANK_DISK_GATE_MODE: 'absolute',
        FRANK_RELEASE_REQUIRED_BYTES: '9223372036854775807',
        FRANK_ROLLBACK_HEADROOM_BYTES: '1',
      },
      'overflows the signed 64-bit range',
    ],
    [{ FRANK_RELEASE_REQUIRED_BYTES: '1' }, 'absolute byte inputs require'],
  ];

  it.each(invalidInputs)('fails closed for invalid or mixed byte inputs', (overrides, error) => {
    const result = runPreflight(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
  });
});
