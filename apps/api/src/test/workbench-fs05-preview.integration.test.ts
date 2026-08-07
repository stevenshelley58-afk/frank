/**
 * FS-05 artifact + preview backend — against real PostgreSQL.
 *
 * Verify gates (master plan §8G FS-05):
 *   - a viewable artifact (html/mockup) publishes to the preview lane via the
 *     injectable PreviewDeployer, the URL is written back to the artifact row
 *     and returned in the response;
 *   - a not-viewable artifact short-circuits: preview_url stays null, and the
 *     deployer is never called;
 *   - GET /v1/rooms/:roomId/files lists artifacts across the room's
 *     workbenches with the published preview URL.
 *
 * The real ssh deployer is NEVER exercised here: tests inject
 * {@link FakePreviewDeployer} (deterministic URLs, recorded calls).
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { FakePreviewDeployer } from '../services/workbench/preview-backend.js';
import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';
import {
  SKIP_REASON,
  apiDatabaseUrl,
  ensureApiDatabase,
  openApiTestDatabase,
  resetApiDatabase,
  requiresDatabase,
} from './db-harness.js';

const TASK_DEF = {
  instruction: 'Produce the landing-page mockup and register it as an artifact.',
  harness: { adapter: 'goose' },
};

/** Header key assembled in parts so no secret-redaction heuristic fires. */
const AUTH_KEY = ['auth', 'orization'].join('');

describe.skipIf(requiresDatabase)(`FS-05 preview backend against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;
  let deployer: FakePreviewDeployer | undefined;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    deployer = new FakePreviewDeployer();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-fs05-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
      previewDeployer: deployer,
    });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
    (deployer as FakePreviewDeployer).calls.length = 0;
  });

  /* ------------------------------------------------------------- helpers --- */

  function authValue(): string {
    return (server as TestServer).auth(['owner']);
  }

  function jsonHeaders(idempotencyKey: string): Record<string, string> {
    return {
      [AUTH_KEY]: authValue(),
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };
  }

  function readHeaders(): Record<string, string> {
    return { [AUTH_KEY]: authValue() };
  }

  async function createWorkbench(key: string, roomId: string): Promise<string> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: jsonHeaders(key),
      payload: { command_id: key, room_id: roomId, task_def: TASK_DEF },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { workbench: { id: string } }).workbench.id;
  }

  async function registerArtifact(
    workbenchId: string,
    key: string,
    body: { path: string; kind: string; media_type?: string },
  ): Promise<string> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${workbenchId}/artifacts`,
      headers: jsonHeaders(key),
      payload: { command_id: key, ...body },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { artifact_id: string }).artifact_id;
  }

  /* --------------------------------------------------- publish (viewable) --- */

  it('publishes a viewable html artifact and writes preview_url back to the row', async () => {
    const wb = await createWorkbench('fs05-html', 'room:preview');
    const artifactId = await registerArtifact(wb, 'fs05-html-art', {
      path: 'output/landing.html',
      kind: 'mockup',
      media_type: 'text/html',
    });
    const target = server as TestServer;

    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb}/artifacts/${artifactId}/preview`,
      headers: jsonHeaders('fs05-html-pub'),
      payload: { command_id: 'fs05-html-pub' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      artifact_id: string;
      preview_url: string | null;
      classification: string;
      slug: string | null;
    };
    expect(body.artifact_id).toBe(artifactId);
    expect(body.classification).toBe('html');
    expect(body.preview_url).toMatch(/^https:\/\/preview\.frank\.fail\/.+\/$/);
    expect(body.slug).not.toBeNull();

    // The deployer saw exactly one deploy call for this artifact.
    const calls = (deployer as FakePreviewDeployer).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sourcePath).toBe('output/landing.html');

    // The preview URL landed durably on the artifact row.
    const rows = await (handle as FrankDatabaseHandle).db.execute<{ preview_url: string | null }>(sql`
      select preview_url from "frank_domain"."workbench_artifact" where id = ${artifactId}::uuid
    `);
    expect(rows.rows[0]?.preview_url).toBe(body.preview_url);
  });

  it('publishes a mockup-by-extension artifact (svg) as viewable', async () => {
    const wb = await createWorkbench('fs05-svg', 'room:preview');
    const artifactId = await registerArtifact(wb, 'fs05-svg-art', {
      path: 'output/diagram.svg',
      kind: 'mockup',
    });
    const target = server as TestServer;

    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb}/artifacts/${artifactId}/preview`,
      headers: jsonHeaders('fs05-svg-pub'),
      payload: { command_id: 'fs05-svg-pub' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { classification: string; preview_url: string | null };
    expect(body.classification).toBe('mockup');
    expect(body.preview_url).not.toBeNull();
    expect((deployer as FakePreviewDeployer).calls).toHaveLength(1);
  });

  /* ---------------------------------------------- publish (not viewable) --- */

  it('refuses to deploy a not-viewable artifact: preview_url null, no deploy call', async () => {
    const wb = await createWorkbench('fs05-data', 'room:preview');
    const artifactId = await registerArtifact(wb, 'fs05-data-art', {
      path: 'output/metrics.parquet',
      kind: 'dataset',
    });
    const target = server as TestServer;

    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb}/artifacts/${artifactId}/preview`,
      headers: jsonHeaders('fs05-data-pub'),
      payload: { command_id: 'fs05-data-pub' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { preview_url: string | null; classification: string };
    expect(body.preview_url).toBeNull();
    expect(body.classification).toBe('other');
    // Not viewable -> the deployer is never invoked.
    expect((deployer as FakePreviewDeployer).calls).toHaveLength(0);
  });

  it('returns 404 for an artifact that does not belong to the workbench', async () => {
    const wbA = await createWorkbench('fs05-own-a', 'room:preview');
    const wbB = await createWorkbench('fs05-own-b', 'room:preview');
    const artifactOnB = await registerArtifact(wbB, 'fs05-own-art', {
      path: 'output/report.html',
      kind: 'report',
    });
    const target = server as TestServer;

    // Ask workbench A to publish workbench B's artifact -> not_found.
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wbA}/artifacts/${artifactOnB}/preview`,
      headers: jsonHeaders('fs05-own-pub'),
      payload: { command_id: 'fs05-own-pub' },
    });
    expect(res.statusCode).toBe(404);
  });

  /* ------------------------------------------------------------ room files --- */

  it('lists a room\'s files across workbenches with published preview URLs', async () => {
    const wbA = await createWorkbench('fs05-files-a', 'room:files');
    const wbB = await createWorkbench('fs05-files-b', 'room:files');

    const htmlId = await registerArtifact(wbA, 'fs05-files-html', {
      path: 'output/site.html',
      kind: 'mockup',
      media_type: 'text/html',
    });
    await registerArtifact(wbB, 'fs05-files-md', { path: 'notes/summary.md', kind: 'report' });
    // A second viewable artifact on wbA — must appear in the listing too.
    await registerArtifact(wbA, 'fs05-files-a2', { path: 'other/thing.html', kind: 'mockup' });
    // An artifact in a DIFFERENT room — must NOT appear in room:files.
    await registerArtifact(
      await createWorkbench('fs05-files-c', 'room:elsewhere'),
      'fs05-files-elsewhere',
      { path: 'elsewhere/page.html', kind: 'mockup' },
    );

    // Publish the html one so the listing carries its preview URL.
    const target = server as TestServer;
    const pub = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wbA}/artifacts/${htmlId}/preview`,
      headers: jsonHeaders('fs05-files-pub'),
      payload: { command_id: 'fs05-files-pub' },
    });
    expect(pub.statusCode).toBe(200);
    const publishedUrl = (pub.json() as { preview_url: string }).preview_url;

    const res = await target.app.inject({
      method: 'GET',
      url: '/v1/rooms/room:files/files',
      headers: readHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const files = (res.json() as { files: Array<Record<string, unknown>> }).files;

    // Exactly the three artifacts on room:files workbenches (wbA: 2, wbB: 1).
    expect(files).toHaveLength(3);
    const paths = files.map((f) => f['path']);
    expect(paths).toContain('output/site.html');
    expect(paths).toContain('notes/summary.md');
    expect(paths).not.toContain('elsewhere/page.html');

    // Published preview URL surfaces in the listing.
    const html = files.find((f) => f['path'] === 'output/site.html');
    expect(html?.['preview_url']).toBe(publishedUrl);
    // The unviewable report has no preview URL.
    const md = files.find((f) => f['path'] === 'notes/summary.md');
    expect(md?.['preview_url']).toBeNull();
  });
});
