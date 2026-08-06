/**
 * WB-03 real-Docker smoke test — SKIPPED unless FRANK_WB_DOCKER_SMOKE=1.
 *
 * Runs the provisioner against a real docker daemon over ssh (host `vps`)
 * and proves the three isolation properties that mocks cannot:
 *
 *   1. a read-only bind mount rejects writes inside the container;
 *   2. the container's process is not root;
 *   3. deprovision removes the container and scratch volume.
 *
 * Requires: `ssh vps` working (see ~/.ssh/config) and docker on the VPS.
 * Run: FRANK_WB_DOCKER_SMOKE=1 npx vitest run src/test/provisioner.smoke.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkbenchProvisioner, SshDockerCli } from '../services/workbench/provisioner.js';
import type { DockerCli, DockerCliResult } from '../services/workbench/provisioner.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from '../services/workbench/types.js';

const SMOKE_ENABLED = process.env['FRANK_WB_DOCKER_SMOKE'] === '1';
const SSH_HOST = process.env['FRANK_WB_DOCKER_SMOKE_HOST'] ?? 'vps';

/**
 * The smoke test needs a host directory to mount ro. We create it on the
 * remote via a small cli wrapper that runs `mkdir` through the same ssh seam.
 */
class SshShellCli implements DockerCli {
  async run(argv: readonly string[]): Promise<DockerCliResult> {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve) => {
      const child = spawn('ssh', [SSH_HOST, '--', argv.join(' ')], { shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += String(d)));
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
      child.on('error', (error) => resolve({ exitCode: 127, stdout, stderr: String(error) }));
    });
  }
}

const SMOKE_ID = `smoke-${Date.now().toString(36)}`;

function smokeRecord(taskDef: WorkbenchTaskDef): WorkbenchRecord {
  const now = new Date();
  return {
    id: SMOKE_ID,
    cellId: 'cell-smoke',
    workItemId: '00000000-0000-0000-0000-000000000000',
    roomId: null,
    idempotencyKey: `smoke-${SMOKE_ID}`,
    taskDef,
    state: 'provisioning',
    attempts: 1,
    claimedBy: 'smoke-test',
    claimedAt: now,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    containerId: null,
    scheduleCron: null,
    scheduleTimezone: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe.skipIf(!SMOKE_ENABLED)(
  'WB-03 docker smoke (FRANK_WB_DOCKER_SMOKE=1 required; uses ssh ' + SSH_HOST + ')',
  () => {
    const cli = new SshDockerCli(SSH_HOST);
    const shell = new SshShellCli();
    const roDir = `/tmp/frank-wb-smoke-${SMOKE_ID}`;
    let provisioner: WorkbenchProvisioner;
    let provisioned: { containerId: string } | null = null;

    beforeAll(async () => {
      // Host fixture: a directory with one file, mounted read-only.
      const setup = await shell.run([
        `mkdir -p ${roDir} && echo read-only-fixture > ${roDir}/note.txt`,
      ]);
      if (setup.exitCode !== 0) throw new Error(`smoke setup failed: ${setup.stderr}`);
      provisioner = new WorkbenchProvisioner({
        cli,
        defaults: {
          image: 'alpine:3.20',
          user: '10001:10001',
          cpuQuota: 50_000,
          memoryBytes: 256 * 1024 * 1024,
        },
        log: () => {},
      });
    }, 60_000);

    afterAll(async () => {
      // Always clean up, even after assertion failures.
      if (provisioned !== null) {
        await provisioner.deprovision(smokeRecord({ instruction: 'cleanup' }));
      }
      await shell.run([`rm -rf ${roDir}`]);
    }, 60_000);

    it('provisions a container from the task def', async () => {
      const result = await provisioner.provision(
        smokeRecord({
          instruction: 'smoke',
          mounts: [{ source: roDir, path: '/mnt/ro', mode: 'ro' }],
          network: { egressAllowlist: [] },
        }),
      );
      provisioned = { containerId: result.containerId };
      expect(result.containerId).toMatch(/^[0-9a-f]{12,64}$/);
    }, 90_000);

    it('the ro mount rejects writes inside the container', async () => {
      const write = await cli.run([
        'exec',
        `frank-wb-${SMOKE_ID}`,
        'sh',
        '-c',
        'touch /mnt/ro/evil.txt',
      ]);
      expect(write.exitCode).not.toBe(0);
      expect(`${write.stderr}`).toMatch(/read-only/i);
    }, 30_000);

    it('the container runs non-root', async () => {
      const whoami = await cli.run(['exec', `frank-wb-${SMOKE_ID}`, 'id', '-u']);
      expect(whoami.exitCode).toBe(0);
      expect(whoami.stdout.trim()).not.toBe('0');
    }, 30_000);

    it('deprovision removes the container and scratch volume', async () => {
      const spec = `frank-wb-${SMOKE_ID}`;
      await provisioner.deprovision(smokeRecord({ instruction: 'cleanup' }));

      const gone = await cli.run(['ps', '-a', '--filter', `name=${spec}`, '--format', '{{.ID}}']);
      expect(gone.stdout.trim()).toBe('');

      const volGone = await cli.run(['volume', 'ls', '--filter', `name=frank-wb-scratch-${SMOKE_ID}`, '--format', '{{.Name}}']);
      expect(volGone.stdout.trim()).toBe('');
      provisioned = null;
    }, 60_000);
  },
);
