/**
 * srt wrapper — SS-03: wrap harness execution with `sandbox-runtime` (srt)
 * for filesystem + egress policy inside the workbench container.
 *
 * Master plan §8H SS-03 / §M9: WB-03 provides the Docker container; srt
 * adds the per-task filesystem and egress policy on top. This module owns
 * exactly one concern: given the command the harness would run inside the
 * container, produce the argv that runs it under srt with the task's
 * policy applied.
 *
 * ## Injectable binary + graceful degrade
 *
 * The srt binary path resolves from `SRT_BIN` (env or option) and defaults
 * to `srt` on PATH. When the binary is ABSENT — the documented state on
 * the VPS today (SS_PREP.md: `SRT_ABSENT`, and npm's `sandbox-runtime`
 * placeholder package carries no binary yet) — the wrapper degrades
 * gracefully: the command is returned UNWRAPPED and the docker network
 * profile from the provisioner remains the enforcement layer. Degrade is
 * loud (`degraded: true` + reason), never silent: callers log it.
 *
 * Every argv vector is built element-by-element — no shell interpolation —
 * the same rule as the provisioner's DockerCli.
 */

import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';

import type { EgressPolicy } from './egress.js';

/** Default binary name resolved via PATH when SRT_BIN is unset. */
export const DEFAULT_SRT_BIN = 'srt';

/** Environment variable overriding the srt binary path (tests stub this). */
export const SRT_BIN_ENV = 'SRT_BIN';

/** Filesystem policy handed to srt. */
export interface SrtFilesystemPolicy {
  /** Writable paths inside the container (scratch volume: /workspace). */
  readonly writablePaths: readonly string[];
  /** Read-only paths inside the container (explicit ro mounts). */
  readonly readOnlyPaths: readonly string[];
}

/** Everything srt needs to wrap one harness command. */
export interface SrtWrapRequest {
  /** The harness command argv to run inside the container, unwrapped. */
  readonly command: readonly string[];
  readonly egress: EgressPolicy;
  readonly filesystem: SrtFilesystemPolicy;
  /** Working directory inside the container (default: /workspace). */
  readonly workdir?: string;
}

/** Result of resolving + wrapping: the argv to execute, wrapped or not. */
export interface SrtWrapResult {
  /** The argv to execute (srt-prefixed when wrapped, else the original). */
  readonly argv: readonly string[];
  /** True when srt is present and the command is wrapped. */
  readonly wrapped: boolean;
  /** Present (with reason) when srt is absent and we fell back to bare. */
  readonly degraded: { readonly reason: string } | null;
  /** The resolved srt binary path that was (or would be) used. */
  readonly srtBin: string;
}

export interface SrtWrapperOptions {
  /** Injectable srt binary path; defaults to env `SRT_BIN`, else `srt`. */
  readonly srtBin?: string;
  /**
   * Injectable availability probe — tests stub this instead of touching
   * the filesystem. Defaults to an existence/PATH-style check of the
   * resolved binary.
   */
  readonly isAvailable?: (srtBin: string) => boolean;
  /** Injectable env lookup; defaults to process.env. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Build the srt argv that wraps one harness command with filesystem +
 * egress policy. Pure argv construction — unit-tested with a stubbed
 * binary, no srt required.
 *
 * Shape (flag names follow the srt convention; the binary itself is not
 * installed anywhere yet, so this is the canonical reference the VPS
 * install+test runbook validates against):
 *
 *   srt run \
 *     --fs-write /workspace --fs-read /mnt/notes \
 *     --egress-allow registry.npmjs.org --egress-allow github.com \
 *     [--egress-deny-all] \
 *     [--workdir /workspace] \
 *     -- <command...>
 */
export function buildSrtArgv(srtBin: string, request: SrtWrapRequest): readonly string[] {
  const argv: string[] = [srtBin, 'run'];

  // Filesystem policy: explicit writable + read-only surfaces only.
  for (const path of request.filesystem.writablePaths) {
    argv.push('--fs-write', path);
  }
  for (const path of request.filesystem.readOnlyPaths) {
    argv.push('--fs-read', path);
  }

  // Egress policy: allowlist domains one flag each; deny-all otherwise.
  if (request.egress.mode === 'allowlist') {
    for (const domain of request.egress.domains) {
      argv.push('--egress-allow', domain);
    }
  } else {
    argv.push('--egress-deny-all');
  }

  if (request.workdir !== undefined) {
    argv.push('--workdir', request.workdir);
  }

  // Command separator, then the unwrapped harness command verbatim.
  argv.push('--', ...request.command);
  return argv;
}

/** Default availability probe: absolute paths must exist on disk; bare
 * names are assumed present only if found on PATH (best effort). */
export function defaultSrtAvailability(srtBin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (srtBin.includes('/') || srtBin.includes('\\')) {
    return existsSync(srtBin);
  }
  const pathValue = env.PATH ?? env.Path ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue;
    if (existsSync(`${dir}/${srtBin}`) || existsSync(`${dir}/${srtBin}.exe`)) {
      return true;
    }
  }
  return false;
}

/**
 * Wrap one harness command with srt, degrading gracefully when srt is
 * absent. The degrade path is the documented current state (VPS: SRT_ABSENT)
 * and keeps the WB-03 docker network profile as the enforcement layer.
 */
export function wrapWithSrt(request: SrtWrapRequest, options: SrtWrapperOptions = {}): SrtWrapResult {
  const env = options.env ?? process.env;
  const srtBin = options.srtBin ?? env[SRT_BIN_ENV] ?? DEFAULT_SRT_BIN;
  const isAvailable = options.isAvailable ?? ((bin) => defaultSrtAvailability(bin, env));

  if (!isAvailable(srtBin)) {
    return {
      argv: [...request.command],
      wrapped: false,
      degraded: {
        reason:
          `srt binary not found at '${srtBin}' (set ${SRT_BIN_ENV} to its path); ` +
          'falling back to unwrapped execution — docker network profile remains the egress enforcement layer',
      },
      srtBin,
    };
  }

  return {
    argv: buildSrtArgv(srtBin, request),
    wrapped: true,
    degraded: null,
    srtBin,
  };
}
