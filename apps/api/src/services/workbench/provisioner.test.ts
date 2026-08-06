/**
 * WB-03 provisioner unit tests — the Docker CLI is mocked behind the
 * DockerCli interface, so these run anywhere with no daemon. The invariants
 * under test are the isolation guarantees, not docker's behaviour.
 */
import { describe, expect, it } from 'vitest';

import {
  PROVISION_DEFAULTS,
  WorkbenchProvisioner,
  buildProvisionSpec,
} from './provisioner.js';
import type { DockerCli, DockerCliResult } from './provisioner.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from './types.js';

/** Recording fake: scripted responses keyed by argv[0..1]. */
class FakeDockerCli implements DockerCli {
  calls: string[][] = [];
  responses = new Map<string, DockerCliResult>();
  defaultResponse: DockerCliResult = { exitCode: 0, stdout: '', stderr: '' };

  respond(prefix: string, result: Partial<DockerCliResult>): void {
    this.responses.set(prefix, { exitCode: 0, stdout: '', stderr: '', ...result });
  }

  async run(argv: readonly string[]): Promise<DockerCliResult> {
    this.calls.push([...argv]);
    for (const [prefix, result] of this.responses) {
      const head = argv.slice(0, prefix.split(' ').length).join(' ');
      if (head === prefix) return result;
    }
    return this.defaultResponse;
  }
}

function record(taskDef: WorkbenchTaskDef, id = 'wb-1234'): WorkbenchRecord {
  const now = new Date('2026-08-07T10:00:00.000Z');
  return {
    id,
    cellId: 'cell-test',
    workItemId: 'wi-1',
    roomId: null,
    idempotencyKey: 'key-1',
    taskDef,
    state: 'provisioning',
    attempts: 1,
    claimedBy: 'runner-1',
    claimedAt: now,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    containerId: null,
    scheduleCron: null,
    scheduleTimezone: null,
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe('buildProvisionSpec', () => {
  it('always runs non-root with cpu/memory limits and a scratch volume', () => {
    const spec = buildProvisionSpec(record({ instruction: 'test' }));

    expect(spec.user).toBe(PROVISION_DEFAULTS.user);
    expect(spec.dockerArgv).toContain('--user');
    expect(spec.cpuQuota).toBe(PROVISION_DEFAULTS.cpuQuota);
    expect(spec.memoryBytes).toBe(PROVISION_DEFAULTS.memoryBytes);
    expect(spec.dockerArgv).toContain(`--volume`);
    expect(spec.dockerArgv).toContain(`${spec.scratchVolume}:/workspace`);
  });

  it('never mounts the docker socket or other forbidden sources', () => {
    expect(() =>
      buildProvisionSpec(
        record({
          instruction: 'evil',
          mounts: [{ source: '/var/run/docker.sock', path: '/sock', mode: 'rw' }],
        }),
      ),
    ).toThrow(/forbidden/);

    expect(() =>
      buildProvisionSpec(
        record({
          instruction: 'evil',
          mounts: [{ source: '/proc/self', path: '/p', mode: 'ro' }],
        }),
      ),
    ).toThrow(/forbidden/);

    // A benign spec contains no socket mount.
    const spec = buildProvisionSpec(
      record({ instruction: 'ok', mounts: [{ source: '/srv/data', path: '/data', mode: 'ro' }] }),
    );
    expect(spec.dockerArgv.join(' ')).not.toContain('docker.sock');
  });

  it('maps mount modes: ro/rw become bind mounts, staged becomes copy-in', () => {
    const spec = buildProvisionSpec(
      record({
        instruction: 'mounts',
        mounts: [
          { source: '/srv/notes', path: '/mnt/notes', mode: 'ro' },
          { source: '/srv/out', path: '/mnt/out', mode: 'rw' },
          { source: '/srv/draft', path: '/mnt/draft', mode: 'staged' },
        ],
      }),
    );

    expect(spec.mounts).toEqual([
      { source: '/srv/notes', path: '/mnt/notes', mode: 'ro' },
      { source: '/srv/out', path: '/mnt/out', mode: 'rw' },
    ]);
    expect(spec.stagedFiles).toEqual([{ source: '/srv/draft', destPath: '/mnt/draft' }]);

    // ro mount appears in argv with the :ro suffix.
    expect(spec.dockerArgv).toContain('/srv/notes:/mnt/notes:ro');
    expect(spec.dockerArgv).toContain('/srv/out:/mnt/out:rw');
    // staged source is NOT bind-mounted.
    expect(spec.dockerArgv.join(' ')).not.toContain('/srv/draft');
  });

  it('rejects relative paths and mounts shadowing /workspace', () => {
    expect(() =>
      buildProvisionSpec(
        record({ instruction: 'x', mounts: [{ source: 'relative', path: '/a', mode: 'ro' }] }),
      ),
    ).toThrow(/absolute/);

    expect(() =>
      buildProvisionSpec(
        record({ instruction: 'x', mounts: [{ source: '/srv/a', path: '/workspace/sub', mode: 'ro' }] }),
      ),
    ).toThrow(/workspace/);
  });

  it('network profile: no stanza or empty allowlist -> none; allowlist -> restricted', () => {
    expect(buildProvisionSpec(record({ instruction: 'a' })).network).toBe('none');
    expect(
      buildProvisionSpec(record({ instruction: 'a', network: { egressAllowlist: [] } })).network,
    ).toBe('none');
    expect(
      buildProvisionSpec(
        record({ instruction: 'a', network: { egressAllowlist: ['api.example.com'] } }),
      ).network,
    ).toBe('restricted');

    const noneSpec = buildProvisionSpec(record({ instruction: 'a' }));
    const noneIdx = noneSpec.dockerArgv.indexOf('--network');
    expect(noneSpec.dockerArgv[noneIdx + 1]).toBe('none');
  });
});

describe('WorkbenchProvisioner (mocked CLI)', () => {
  it('provision: creates volume, starts container, returns id', async () => {
    const cli = new FakeDockerCli();
    cli.respond('ps -a', { stdout: '' });
    cli.respond('run -d', { stdout: 'abc123\n' });

    const provisioner = new WorkbenchProvisioner({ cli, log: () => {} });
    const result = await provisioner.provision(record({ instruction: 'go' }));

    expect(result.containerId).toBe('abc123');
    expect(cli.calls.some((c) => c[0] === 'volume' && c[1] === 'create')).toBe(true);
    expect(cli.calls.some((c) => c[0] === 'run' && c.includes('--user'))).toBe(true);
  });

  it('provision is idempotent: existing container id is reused', async () => {
    const cli = new FakeDockerCli();
    cli.respond('ps -a', { stdout: 'existing-456\n' });

    const provisioner = new WorkbenchProvisioner({ cli, log: () => {} });
    const result = await provisioner.provision(record({ instruction: 'go' }));

    expect(result.containerId).toBe('existing-456');
    // No run/create happened.
    expect(cli.calls.some((c) => c[0] === 'run')).toBe(false);
    expect(cli.calls.some((c) => c[0] === 'volume' && c[1] === 'create')).toBe(false);
  });

  it('provision copies staged sources in and rolls back on copy failure', async () => {
    const cli = new FakeDockerCli();
    cli.respond('ps -a', { stdout: '' });
    cli.respond('run -d', { stdout: 'c789\n' });
    cli.respond('cp /srv/draft', { exitCode: 1, stderr: 'permission denied' });

    const provisioner = new WorkbenchProvisioner({ cli, log: () => {} });
    await expect(
      provisioner.provision(
        record({
          instruction: 'staged',
          mounts: [{ source: '/srv/draft', path: '/mnt/draft', mode: 'staged' }],
        }),
      ),
    ).rejects.toThrow(/staged copy failed/);

    // Rollback removed container and volume.
    expect(cli.calls.some((c) => c[0] === 'rm' && c.includes('-f'))).toBe(true);
    expect(cli.calls.some((c) => c[0] === 'volume' && c[1] === 'rm')).toBe(true);
  });

  it('deprovision removes container and volume, tolerating absence', async () => {
    const cli = new FakeDockerCli();
    cli.respond('rm -f', { exitCode: 1, stderr: 'Error: No such container: frank-wb-x' });
    cli.respond('volume rm', { exitCode: 1, stderr: 'Error: No such volume: frank-wb-scratch-x' });

    const provisioner = new WorkbenchProvisioner({ cli, log: () => {} });
    await expect(provisioner.deprovision(record({ instruction: 'x' }))).resolves.toBeUndefined();
  });

  it('container start failure cleans the volume it created', async () => {
    const cli = new FakeDockerCli();
    cli.respond('ps -a', { stdout: '' });
    cli.respond('run -d', { exitCode: 125, stderr: 'image not found' });

    const provisioner = new WorkbenchProvisioner({ cli, log: () => {} });
    await expect(provisioner.provision(record({ instruction: 'x' }))).rejects.toThrow(
      /container start failed/,
    );
    expect(cli.calls.some((c) => c[0] === 'volume' && c[1] === 'rm')).toBe(true);
  });
});
