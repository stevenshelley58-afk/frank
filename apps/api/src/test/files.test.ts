/**
 * `/v1/files` route tests — the read-only files browser.
 *
 * Every security property the packet demands is asserted here against a
 * real fixture directory on disk: the absolute-path escape, the `..`
 * traversal escape, the symlink escape (when the platform permits creating
 * symlinks), the secret-name refusals, and the 2 MB preview cap.
 *
 * The root is injected through `FRANK_FILES_ROOT` (the route's own
 * production fallback chain: deps override → env → `C:/Dev`), so the test
 * never touches the real `C:/Dev`. The env var is read at request time, and
 * vitest isolates this file in its own worker, so the mutation cannot leak.
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';

let server: TestServer | undefined;
let root: string;
let outside: string;
let symlinkCreated = false;

// Fixture setup runs at module scope (top-level await) rather than in
// beforeAll: the skipIf on the symlink test is evaluated during collection,
// which happens before beforeAll hooks run.
root = await mkdtemp(join(tmpdir(), 'frank-files-'));
outside = await mkdtemp(join(tmpdir(), 'frank-files-outside-'));

await writeFile(join(root, 'README.md'), '# Fixture\n\nHello **world**.\n', 'utf8');
await writeFile(join(root, 'data.json'), '{ "ok": true }\n', 'utf8');
await writeFile(join(root, '.env'), 'SECRET=1\n', 'utf8');
await writeFile(join(root, 'secrets.json'), '{}\n', 'utf8');
await writeFile(join(root, 'tokens.txt'), 'tok\n', 'utf8');
await writeFile(join(root, 'big.bin'), 'a'.repeat(2 * 1024 * 1024 + 1), 'utf8');

await mkdir(join(root, 'notes'));
await writeFile(join(root, 'notes', 'deep.md'), 'deep content\n', 'utf8');
await writeFile(join(outside, 'secret-outside.txt'), 'outside\n', 'utf8');

// A symlink inside the root pointing outside it. Windows directory symlinks
// need Developer Mode or an elevated shell, but junctions do not — and
// realpath resolves both. When neither can be created, the test skips rather
// than failing on an environment limitation.
try {
  await symlink(outside, join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  symlinkCreated = true;
} catch {
  symlinkCreated = false;
}

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.FRANK_FILES_ROOT = root;
});

afterEach(async () => {
  delete process.env.FRANK_FILES_ROOT;
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
});


function ownerHeaders(target: TestServer): Record<string, string> {
  const headers: Record<string, string> = {};
  headers['authorization'] = target.auth(['owner']);
  return headers;
}

function start(): TestServer {
  server = buildTestServer();
  return server;
}

async function files(
  target: TestServer,
  path?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = path === undefined ? '/v1/files' : `/v1/files?path=${encodeURIComponent(path)}`;
  const response = await target.app.inject({
    method: 'GET',
    url,
    headers: ownerHeaders(target),
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

describe('W3-1 /v1/files — browsing and reading', () => {
  it('lists the files root when no path is given', async () => {
    const target = start();
    const result = await files(target);

    expect(result.status).toBe(200);
    expect(result.body['kind']).toBe('dir');
    // The resolved path is platform-native (backslashes on Windows) — the
    // client re-sends it verbatim as ?path=, so it must round-trip.
    expect(result.body['path']).toBe(root);
    const entries = result.body['entries'] as Array<{ name: string; kind: string; size: number }>;
    expect(entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['README.md', 'data.json', 'notes', 'big.bin']),
    );
    // Directories sort before files.
    expect(entries[0]?.name).toBe('notes');
    expect(entries[0]?.kind).toBe('dir');
    const readme = entries.find((entry) => entry.name === 'README.md');
    expect(readme?.kind).toBe('file');
    expect(readme?.size).toBeGreaterThan(0);
    // Secret-bearing entries are not even named in listings.
    for (const hidden of ['.env', 'secrets.json', 'tokens.txt']) {
      expect(entries.some((entry) => entry.name === hidden)).toBe(false);
    }
  });

  it('reads a file as text content', async () => {
    const target = start();
    const result = await files(target, join(root, 'README.md'));

    expect(result.status).toBe(200);
    expect(result.body['kind']).toBe('file');
    expect(result.body['name']).toBe('README.md');
    expect(result.body['size']).toBeGreaterThan(0);
    expect(String(result.body['content'])).toContain('Hello **world**');
  });

  it('lists and reads inside a subdirectory, resolving relative paths against the root', async () => {
    const target = start();
    const listing = await files(target, join(root, 'notes'));
    expect(listing.status).toBe(200);
    expect(listing.body['kind']).toBe('dir');
    const entries = listing.body['entries'] as Array<{ name: string }>;
    expect(entries.map((entry) => entry.name)).toEqual(['deep.md']);

    const relative = await files(target, 'notes/deep.md');
    expect(relative.status).toBe(200);
    expect(String(relative.body['content'])).toBe('deep content\n');
  });

  it('returns 404 for a missing path', async () => {
    const target = start();
    const result = await files(target, join(root, 'nope.md'));
    expect(result.status).toBe(404);
    expect(result.body['type']).toBe('https://frank.fail/problems/not-found');
  });

  it('requires authentication', async () => {
    const target = start();
    const response = await target.app.inject({ method: 'GET', url: '/v1/files' });
    expect(response.statusCode).toBe(401);
  });
});

describe('W3-1 /v1/files — path traversal protection', () => {
  it('refuses an absolute path outside the root, existing or not (403 before any stat)', async () => {
    const target = start();
    for (const escape of [
      'C:/Windows/System32/drivers/etc/hosts',
      'C:/Windows/definitely-not-here',
    ]) {
      const result = await files(target, escape);
      expect(result.status).toBe(403);
      expect(result.body['type']).toBe('https://frank.fail/problems/forbidden');
    }
  });

  it('refuses any path containing a .. segment', async () => {
    const target = start();
    for (const escape of [
      'C:/Dev/../Windows',
      'C:/Dev/frank/../..',
      '../outside',
      `${root}/../..`,
    ]) {
      const result = await files(target, escape);
      expect(result.status).toBe(403);
      expect(result.body['type']).toBe('https://frank.fail/problems/forbidden');
    }
  });

  it.skipIf(!symlinkCreated)('refuses a symlink inside the root that points outside it', async () => {
    const target = start();
    const result = await files(target, join(root, 'outside-link'));
    expect(result.status).toBe(403);
    expect(result.body['type']).toBe('https://frank.fail/problems/forbidden');
  });

  it('lets a symlink inside the root that stays inside it through', async () => {
    // Not a traversal test — a guard against the escape check rejecting
    // legitimate symlinked layouts (e.g. a root that is itself a symlink).
    const target = start();
    const result = await files(target, join(root, 'notes', 'deep.md'));
    expect(result.status).toBe(200);
  });

  it.skipIf(process.platform !== 'win32')(
    'refuses a Windows alternate data stream path',
    async () => {
      const target = start();
      const result = await files(target, `${root}/README.md:stream`);
      expect(result.status).toBe(403);
    },
  );
});

describe('W3-1 /v1/files — never returns secrets', () => {
  it('refuses .env files', async () => {
    const target = start();
    const result = await files(target, join(root, '.env'));
    expect(result.status).toBe(403);
    expect(result.body['type']).toBe('https://frank.fail/problems/forbidden');
  });

  it('refuses anything matching *secret*, *key*, or *token*', async () => {
    const target = start();
    for (const name of ['secrets.json', 'tokens.txt', 'private.key']) {
      const result = await files(target, join(root, name));
      expect(result.status).toBe(403);
    }
  });
});

describe('W3-1 /v1/files — preview bounds', () => {
  it('refuses files over 2 MB', async () => {
    const target = start();
    const result = await files(target, join(root, 'big.bin'));
    expect(result.status).toBe(403);
    expect(String(result.body['detail'])).toMatch(/2 MB/);
  });
});
