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
    `case "$*" in
  *"-B1 --output=avail"*) printf 'Avail\\n%s\\n' "\${MOCK_AVAILABLE_BYTES}" ;;
  *) printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'; printf '/dev/mock 999999999 1 %s %s%% /mock\\n' "\${MOCK_AVAILABLE_KIB}" "\${MOCK_USED_PERCENT}" ;;
esac
`,
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
  writeExecutable(
    resolve(mockBin, 'jq'),
    `case "$*" in
  *"--arg service api"*) printf '%s\\n' "$FRANK_API_IMAGE" ;;
  *"--arg service web"*) printf '%s\\n' "$FRANK_WEB_IMAGE" ;;
  *"--arg service codegraph"*) printf '%s\\n' "$FRANK_CODEGRAPH_IMAGE" ;;
  *"--arg service workbench"*) printf '%s\\n' "$FRANK_WORKBENCH_IMAGE" ;;
  *) exit 0 ;;
esac
`,
  );

  const images = {
    api: `ghcr.io/test/frank-api@sha256:${'a'.repeat(64)}`,
    web: `ghcr.io/test/frank-web@sha256:${'b'.repeat(64)}`,
    codegraph: `ghcr.io/test/frank-codegraph@sha256:${'c'.repeat(64)}`,
    workbench: `ghcr.io/test/frank-workbench@sha256:${'d'.repeat(64)}`,
  };
  const manifest = resolve(root, 'release-manifest.json');
  const proof = resolve(root, 'application-images.pulled.tsv');
  writeFileSync(
    manifest,
    `${JSON.stringify({
      images: Object.fromEntries(
        Object.entries(images).map(([name, image]) => {
          const [reference, digest] = image.split('@');
          return [name, { reference, digest }];
        }),
      ),
    })}\n`,
    'utf8',
  );
  writeFileSync(
    proof,
    `${Object.values(images)
      .map((image) => `${image}\tsha256:${'0'.repeat(64)}`)
      .join('\n')}\n`,
    'utf8',
  );
  const environment: NodeJS.ProcessEnv = {
    PATH: `${mockBin}:${process.env.PATH ?? ''}`,
    MOCK_AVAILABLE_KIB: '1048576',
    MOCK_AVAILABLE_BYTES: '1073741824',
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
    FRANK_API_IMAGE: images.api,
    FRANK_WEB_IMAGE: images.web,
    FRANK_CODEGRAPH_IMAGE: images.codegraph,
    FRANK_WORKBENCH_IMAGE: images.workbench,
    FRANK_REQUIRED_IMAGES: Object.values(images).join(' '),
    ...overrides,
  };
  if (environment.MOCK_POST_PULL_PROOF === 'valid') {
    environment.FRANK_RELEASE_MANIFEST_FILE = manifest;
    environment.FRANK_POST_PULL_IMAGE_PROOF_FILE = proof;
  }
  delete environment.MOCK_POST_PULL_PROOF;
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
    expect(preflight).toContain('readonly disk_gate_phase="${FRANK_DISK_GATE_PHASE:-full}"');
    expect(preflight).toContain('[[ "$disk_gate_mode" == "percent" || "$disk_gate_mode" == "absolute" ]]');
    expect(preflight).toContain('FRANK_DISK_GATE_PHASE must be full, pre-pull, or post-pull');
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
      'disk_gate_phase',
      'release_required_bytes',
      'rollback_headroom_bytes',
      'release_total_required_bytes',
    ]) {
      expect(preflight).toContain(`printf '${field}=%s\\n'`);
    }
  });

  it('binds the runbook to the reviewed conservative capacity calculation', () => {
    const candidatePull = 10_234_814_980n;
    const prePullReleaseRequired = 21_932_447_888n;
    const postPullReleaseRequired = 11_697_632_908n;
    const rollbackHeadroom = 23_862_108_519n;
    const prePullTotal = 45_794_556_407n;
    const postPullTotal = 35_559_741_427n;

    expect(prePullReleaseRequired - candidatePull).toBe(postPullReleaseRequired);
    expect(prePullReleaseRequired + rollbackHeadroom).toBe(prePullTotal);
    expect(postPullReleaseRequired + rollbackHeadroom).toBe(postPullTotal);
    expect(runbook).toContain(`export FRANK_DISK_GATE_MODE='absolute'`);
    expect(runbook).toContain(`export FRANK_DISK_GATE_PHASE='pre-pull'`);
    expect(runbook).toContain(`export FRANK_RELEASE_REQUIRED_BYTES='${prePullReleaseRequired}'`);
    expect(runbook).toContain(`export FRANK_ROLLBACK_HEADROOM_BYTES='${rollbackHeadroom}'`);
    expect(runbook).toContain(`export FRANK_RELEASE_REQUIRED_BYTES='${postPullReleaseRequired}'`);
    expect(runbook).toContain(`grep -Fx 'release_total_required_bytes=${prePullTotal}'`);
    expect(runbook).toContain(`grep -Fx 'release_total_required_bytes=${postPullTotal}'`);
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

  it('runs the full capacity gate before pulls and the proven reduced gate afterward', () => {
    const prePull = runbook.indexOf('pre-pull-capacity.result');
    const firstPull = runbook.indexOf('docker pull "$FRANK_API_IMAGE"');
    const proof = runbook.indexOf('export FRANK_POST_PULL_IMAGE_PROOF_FILE=');
    const postPull = runbook.indexOf("export FRANK_DISK_GATE_PHASE='post-pull'");
    expect(prePull).toBeGreaterThan(0);
    expect(prePull).toBeLessThan(firstPull);
    expect(firstPull).toBeLessThan(proof);
    expect(proof).toBeLessThan(postPull);
  });

  it('keeps default percent behavior and accepts exact pre-pull equality', () => {
    const percent = runPreflight({ MOCK_USED_PERCENT: '87', MOCK_AVAILABLE_KIB: '2097152' });
    expect(percent.status).not.toBe(0);
    expect(percent.stderr).toContain('disk use is 87%, above the 75% release limit');

    const equality = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_DISK_GATE_PHASE: 'pre-pull',
      FRANK_RELEASE_REQUIRED_BYTES: '21932447888',
      FRANK_ROLLBACK_HEADROOM_BYTES: '23862108519',
      MOCK_AVAILABLE_KIB: '44721247',
      MOCK_AVAILABLE_BYTES: '45794556407',
    });
    expect(equality.status).toBe(0);
    expect(equality.stdout).toContain('capacity_preflight=passed\n');
    expect(equality.stdout).toContain('disk_available_bytes=45794556407\n');
    expect(equality.stdout).toContain('release_total_required_bytes=45794556407\n');
  });

  it('rejects one byte short and still enforces the independent minimum-free gate', () => {
    const short = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_DISK_GATE_PHASE: 'pre-pull',
      FRANK_RELEASE_REQUIRED_BYTES: '21932447888',
      FRANK_ROLLBACK_HEADROOM_BYTES: '23862108519',
      MOCK_AVAILABLE_KIB: '44721247',
      MOCK_AVAILABLE_BYTES: '45794556406',
    });
    expect(short.status).not.toBe(0);
    expect(short.stderr).toContain(
      'free disk bytes 45794556406 are below release requirement 45794556407',
    );

    const minimum = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_DISK_GATE_PHASE: 'pre-pull',
      FRANK_RELEASE_REQUIRED_BYTES: '21932447888',
      FRANK_ROLLBACK_HEADROOM_BYTES: '23862108519',
      FRANK_MIN_FREE_GIB: '2',
      MOCK_AVAILABLE_BYTES: '45794556407',
    });
    expect(minimum.status).not.toBe(0);
    expect(minimum.stderr).toContain('free disk space is below the 2 GiB release minimum');
  });

  it('requires all manifest-bound local image proof before using the post-pull total', () => {
    const missing = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_DISK_GATE_PHASE: 'post-pull',
      FRANK_RELEASE_REQUIRED_BYTES: '11697632908',
      FRANK_ROLLBACK_HEADROOM_BYTES: '23862108519',
      MOCK_AVAILABLE_KIB: '34726310',
      MOCK_AVAILABLE_BYTES: '35559741427',
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('FRANK_RELEASE_MANIFEST_FILE must be absolute for post-pull');

    const proven = runPreflight({
      FRANK_DISK_GATE_MODE: 'absolute',
      FRANK_DISK_GATE_PHASE: 'post-pull',
      FRANK_RELEASE_REQUIRED_BYTES: '11697632908',
      FRANK_ROLLBACK_HEADROOM_BYTES: '23862108519',
      MOCK_AVAILABLE_KIB: '34726310',
      MOCK_AVAILABLE_BYTES: '35559741427',
      MOCK_POST_PULL_PROOF: 'valid',
    });
    expect(proven.status).toBe(0);
    expect(proven.stdout).toContain('disk_gate_phase=post-pull\n');
    expect(proven.stdout).toContain('release_total_required_bytes=35559741427\n');
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
