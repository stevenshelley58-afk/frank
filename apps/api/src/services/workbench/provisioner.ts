/**
 * WorkbenchProvisioner — WB-03: one Docker container per workbench.
 *
 * Master plan §3.2 / §4.2: a workbench run executes inside its own
 * throwaway container. This module builds the `docker run` specification
 * from the {@link WorkbenchTaskDef} and drives it through a thin
 * {@link DockerCli} interface — the interface exists so unit tests mock the
 * CLI layer and never need Docker installed, and so the real CLI (local
 * daemon or `ssh vps docker ...`) can be swapped at composition time.
 *
 * ## Isolation invariants (each one asserted in provisioner.test.ts)
 *
 *  1. NON-ROOT — the container runs as the `frank` user (uid 10001), never
 *     root. `--user` is always emitted.
 *  2. RESOURCE LIMITS — cpu and memory limits from the task def (with
 *     conservative defaults), so one runaway run cannot starve the host.
 *  3. SCRATCH VOLUME — every workbench gets its own named volume for
 *     writable scratch space (`/workspace`), removed on cleanup.
 *  4. EXPLICIT MOUNTS ONLY — nothing from the host enters the container
 *     unless the task def names it. Mount modes (§3.2):
 *       ro     -> bind mount, read-only (writes must fail)
 *       rw     -> bind mount, read-write
 *       staged -> copy-in: the source is copied to the scratch volume before
 *                 the run starts; the agent edits the copy, never the source.
 *                 (Copy-in is executed by the executor at provision time via
 *                 the stagedFiles() list; this module never bind-mounts a
 *                 staged source.)
 *  5. NO DOCKER SOCKET — the spec never mounts /var/run/docker.sock; the
 *     container cannot escape sideways into host Docker. Asserted in tests.
 *  6. NETWORK PROFILE — from the task def: `none` (default: no egress),
 *     `restricted` (allowlist — enforced by a pre-created docker network of
 *     the same name, owned by the platform), or `bridge` (explicit opt-in).
 *     An empty egressAllowlist means `none`, not "everything".
 */

import { buildEgressPolicy } from './egress.js';
import type { EgressPolicy } from './egress.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from './types.js';
import type { SrtFilesystemPolicy } from './srt.js';

/* ------------------------------------------------------------ docker cli --- */

/** Result of one docker CLI invocation. */
export interface DockerCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The seam over the docker CLI. The production implementation shells out
 * (optionally over ssh); unit tests use a recording fake. Every provisioner
 * operation is one argv vector — no shell interpolation anywhere, so mount
 * paths with spaces or quotes cannot inject commands.
 */
export interface DockerCli {
  run(argv: readonly string[]): Promise<DockerCliResult>;
}

/** A real docker CLI on this host. */
export class LocalDockerCli implements DockerCli {
  async run(argv: readonly string[]): Promise<DockerCliResult> {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve) => {
      const child = spawn('docker', [...argv], { shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += String(d)));
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (error) => {
        resolve({ exitCode: 127, stdout, stderr: `${stderr}${String(error)}` });
      });
      child.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

/**
 * Docker CLI on a remote host over ssh (the VPS smoke-test path). Each
 * docker argv element is shell-single-quoted into the remote command, so
 * mount paths with spaces or quotes survive the remote shell intact.
 */
export class SshDockerCli implements DockerCli {
  constructor(private readonly host: string) {}

  async run(argv: readonly string[]): Promise<DockerCliResult> {
    const { spawn } = await import('node:child_process');
    const remoteCommand = ['docker', ...argv].map(shellSingleQuote).join(' ');
    return new Promise((resolve) => {
      const child = spawn('ssh', [this.host, '--', remoteCommand], { shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += String(d)));
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (error) => {
        resolve({ exitCode: 127, stdout, stderr: `${stderr}${String(error)}` });
      });
      child.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/* ----------------------------------------------------------------- specs --- */

export type NetworkProfile = 'none' | 'restricted' | 'bridge';

/** Limits applied to every container; task def may tighten, never loosen. */
export interface ProvisionDefaults {
  readonly cpuQuota?: number; // docker --cpu-quota (microseconds per 100ms period)
  readonly memoryBytes?: number; // docker --memory
  readonly image: string;
  readonly user?: string;
}

export const PROVISION_DEFAULTS: ProvisionDefaults = {
  // 2 CPUs, 2 GiB, non-root uid that does not collide with host users.
  cpuQuota: 200_000,
  memoryBytes: 2 * 1024 * 1024 * 1024,
  image: 'frank-workbench:latest',
  user: '10001:10001',
};

export interface ProvisionSpec {
  /** Container name — deterministic per workbench, for cleanup + debugging. */
  readonly name: string;
  readonly image: string;
  readonly user: string;
  readonly cpuQuota: number;
  readonly memoryBytes: number;
  /** Named scratch volume mounted at /workspace (rw). */
  readonly scratchVolume: string;
  /** Bind mounts: host source -> container path, read-only or read-write. */
  readonly mounts: readonly { source: string; path: string; mode: 'ro' | 'rw' }[];
  /** Staged sources to copy into the scratch volume before start. */
  readonly stagedFiles: readonly { source: string; destPath: string }[];
  readonly network: NetworkProfile;
  /**
   * SS-03: the task's egress policy descriptor, derived once from
   * `taskDef.network.egressAllowlist` (deny-all when absent/empty). The
   * docker network profile above is the coarse layer; the srt wrapper
   * (srt.ts) consumes this same descriptor for per-domain enforcement.
   */
  readonly egress: EgressPolicy;
  /**
   * SS-03: the filesystem policy srt must preserve when wrapping the
   * harness command — writable scratch volume plus the explicit mounts.
   * Built from the same mount list the docker spec uses, so the explicit
   * filesystem policy survives the srt wrap unchanged.
   */
  readonly srtFilesystem: SrtFilesystemPolicy;
  readonly dockerArgv: readonly string[];
}

/** Mount sources are validated so a task def cannot smuggle in sockets etc. */
const FORBIDDEN_SOURCES = ['/var/run/docker.sock', '/proc', '/sys', '/dev', '/etc'];

function validateMountSource(source: string): void {
  if (!source.startsWith('/')) {
    throw new Error(`workbench mount source must be an absolute path: ${source}`);
  }
  const normalized = source.replace(/\/+$/, '') || '/';
  for (const forbidden of FORBIDDEN_SOURCES) {
    if (normalized === forbidden || normalized.startsWith(`${forbidden}/`)) {
      throw new Error(`workbench mount source is forbidden: ${source}`);
    }
  }
}

function resolveNetwork(taskDef: WorkbenchTaskDef): NetworkProfile {
  // No network stanza -> no egress at all.
  const network = taskDef.network;
  if (network === undefined) return 'none';
  const allowlist = network.egressAllowlist;
  if (allowlist === undefined || allowlist.length === 0) return 'none';
  return 'restricted';
}

/**
 * Build the provision spec for one workbench. Pure function of the record —
 * unit-tested exhaustively without any Docker present.
 */
export function buildProvisionSpec(
  record: WorkbenchRecord,
  defaults: ProvisionDefaults = PROVISION_DEFAULTS,
): ProvisionSpec {
  const taskDef = record.taskDef;
  const name = `frank-wb-${record.id}`;
  const scratchVolume = `frank-wb-scratch-${record.id}`;

  const mounts: { source: string; path: string; mode: 'ro' | 'rw' }[] = [];
  const stagedFiles: { source: string; destPath: string }[] = [];

  for (const mount of taskDef.mounts ?? []) {
    validateMountSource(mount.source);
    if (!mount.path.startsWith('/')) {
      throw new Error(`workbench mount path must be absolute: ${mount.path}`);
    }
    if (mount.path === '/workspace' || mount.path.startsWith('/workspace/')) {
      // /workspace is owned by the scratch volume; mounts must not shadow it.
      throw new Error(`workbench mount must not target /workspace: ${mount.path}`);
    }
    if (mount.mode === 'staged') {
      stagedFiles.push({ source: mount.source, destPath: mount.path });
    } else {
      mounts.push({ source: mount.source, path: mount.path, mode: mount.mode });
    }
  }

  const network = resolveNetwork(taskDef);
  // SS-03: one egress policy descriptor shared by the docker layer and the
  // srt wrapper. Deny-by-default: absent/empty allowlist -> deny-all.
  const egress = buildEgressPolicy(taskDef);

  // SS-03: filesystem policy preserved through the srt wrap. Writable
  // surface = the scratch volume (/workspace) plus rw mounts; read-only
  // surface = ro mounts. Staged copy-ins need no entry: provision() copies
  // them to `/workspace${destPath}`, already inside the writable scratch
  // volume. Nothing else is writable.
  const writablePaths: string[] = ['/workspace'];
  const readOnlyPaths: string[] = [];
  for (const mount of mounts) {
    if (mount.mode === 'rw') writablePaths.push(mount.path);
    else readOnlyPaths.push(mount.path);
  }
  const srtFilesystem: SrtFilesystemPolicy = { writablePaths, readOnlyPaths };

  const argv: string[] = [
    'run',
    '-d',
    '--name',
    name,
    '--user',
    defaults.user ?? PROVISION_DEFAULTS.user!,
    `--cpu-quota=${String(defaults.cpuQuota ?? PROVISION_DEFAULTS.cpuQuota)}`,
    `--memory=${String(defaults.memoryBytes ?? PROVISION_DEFAULTS.memoryBytes)}`,
    '--network',
    network === 'restricted' ? 'frank-wb-egress' : network,
    // Scratch volume: the only writable surface besides staged copies.
    '--volume',
    `${scratchVolume}:/workspace`,
  ];
  for (const mount of mounts) {
    argv.push('--volume', `${mount.source}:${mount.path}:${mount.mode}`);
  }
  argv.push(defaults.image, 'sleep', 'infinity');

  return {
    name,
    image: defaults.image,
    user: defaults.user ?? PROVISION_DEFAULTS.user!,
    cpuQuota: defaults.cpuQuota ?? PROVISION_DEFAULTS.cpuQuota!,
    memoryBytes: defaults.memoryBytes ?? PROVISION_DEFAULTS.memoryBytes!,
    scratchVolume,
    mounts,
    stagedFiles,
    network,
    egress,
    srtFilesystem,
    dockerArgv: argv,
  };
}

/* ------------------------------------------------------------ provisioner --- */

export interface ProvisionResult {
  readonly containerId: string;
  readonly spec: ProvisionSpec;
}

export interface WorkbenchProvisionerOptions {
  readonly cli: DockerCli;
  readonly defaults?: ProvisionDefaults;
  readonly log?: (message: string) => void;
}

export class WorkbenchProvisioner {
  private readonly cli: DockerCli;
  private readonly defaults: ProvisionDefaults;
  private readonly log: (message: string) => void;

  constructor(options: WorkbenchProvisionerOptions) {
    this.cli = options.cli;
    this.defaults = options.defaults ?? PROVISION_DEFAULTS;
    this.log = options.log ?? ((m) => console.error(m));
  }

  /**
   * Provision the container for one workbench: create scratch volume, run
   * the container from the built spec. Idempotent per workbench — if the
   * container already exists, its id is returned and nothing new is created.
   */
  async provision(record: WorkbenchRecord): Promise<ProvisionResult> {
    const spec = buildProvisionSpec(record, this.defaults);

    // Idempotency: reuse an existing container for this workbench.
    // (docker's name filter is substring-based; names embed the workbench
    // uuid so substring equality is exact enough.)
    const existing = await this.cli.run(['ps', '-a', '--filter', `name=${spec.name}`, '--format', '{{.ID}}']);
    if (existing.exitCode === 0 && existing.stdout.trim() !== '') {
      return { containerId: existing.stdout.trim().split('\n')[0]!, spec };
    }

    const volume = await this.cli.run(['volume', 'create', spec.scratchVolume]);
    if (volume.exitCode !== 0 && !/exists/i.test(volume.stderr)) {
      throw new Error(`scratch volume create failed for ${record.id}: ${volume.stderr.trim()}`);
    }

    const started = await this.cli.run([...spec.dockerArgv]);
    if (started.exitCode !== 0) {
      // Leave no half-provisioned volume behind.
      await this.cli.run(['volume', 'rm', '-f', spec.scratchVolume]);
      throw new Error(`container start failed for ${record.id}: ${started.stderr.trim()}`);
    }

    const containerId = started.stdout.trim();
    if (containerId === '') {
      throw new Error(`container start returned no id for ${record.id}`);
    }

    // Staged mounts are copy-ins: copy after start, into the scratch volume.
    for (const staged of spec.stagedFiles) {
      const dest = `/workspace${staged.destPath}`;
      const copy = await this.cli.run(['cp', staged.source, `${spec.name}:${dest}`]);
      if (copy.exitCode !== 0) {
        await this.deprovision(record);
        throw new Error(
          `staged copy failed for ${record.id} (${staged.source} -> ${dest}): ${copy.stderr.trim()}`,
        );
      }
    }

    this.log(`workbench ${record.id}: provisioned container ${containerId} (${spec.network} network)`);
    return { containerId, spec };
  }

  /**
   * Remove the workbench's container and scratch volume. Idempotent and
   * best-effort: cleaning something that never existed must not throw
   * (WB-02's recovery path calls this on possibly-unprovisioned rows).
   */
  async deprovision(record: WorkbenchRecord): Promise<void> {
    const spec = buildProvisionSpec(record, this.defaults);
    const rm = await this.cli.run(['rm', '-f', spec.name]);
    if (rm.exitCode !== 0 && !/no such container/i.test(rm.stderr)) {
      this.log(`workbench ${record.id}: container removal reported: ${rm.stderr.trim()}`);
    }
    const volumeRm = await this.cli.run(['volume', 'rm', '-f', spec.scratchVolume]);
    if (volumeRm.exitCode !== 0 && !/(no such volume|in use)/i.test(volumeRm.stderr)) {
      this.log(`workbench ${record.id}: volume removal reported: ${volumeRm.stderr.trim()}`);
    }
  }
}
