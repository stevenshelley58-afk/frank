/**
 * `/v1/auth/dev-session` conformance — FRANK-§16.2 seam.
 *
 * Asserts the two properties that make this endpoint safe to exist:
 *
 *   * in a permissive environment (`test`, and by extension `development`) it
 *     mints a token that **actually authenticates** against the live verifier
 *     — proven by using the returned bearer on a real authenticated route;
 *   * in any other environment it is a wall (403 `forbidden`), so it can never
 *     leak owner sessions from staging or production.
 *
 * In-process through `app.inject()`, mirroring `api-contract.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';

let server: TestServer | undefined;

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
});

function start(options: Parameters<typeof buildTestServer>[0] = {}): TestServer {
  server = buildTestServer(options);
  return server;
}

describe('FRANK-§16.2 dev session mint', () => {
  it('mints an owner session that authenticates against a protected route', async () => {
    const target = start();

    const minted = await target.app.inject({ method: 'POST', url: '/v1/auth/dev-session' });
    expect(minted.statusCode).toBe(200);

    const body = minted.json() as Record<string, unknown>;
    expect(body['token_type']).toBe('Bearer');
    expect(body['principal_id']).toBe('user/steven');
    expect(body['roles']).toEqual(
      expect.arrayContaining(['owner', 'operator', 'builder', 'member', 'reviewer']),
    );
    const token = body['access_token'];
    expect(token).toEqual(expect.stringMatching(/^frank-session\.v1\./));

    // The real proof: the minted token is accepted by the capability gate.
    const work = await target.app.inject({
      method: 'GET',
      url: '/v1/work',
      headers: { authorization: `Bearer ${String(token)}` },
    });
    expect(work.statusCode).toBe(200);
  });

  it('refuses to mint outside development/test environments', async () => {
    const target = start({ config: { environment: 'production' } });

    const response = await target.app.inject({ method: 'POST', url: '/v1/auth/dev-session' });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    const problem = response.json() as Record<string, unknown>;
    expect(problem['type']).toBe('https://frank.fail/problems/forbidden');
    expect(problem['status']).toBe(403);
    // It must not leak a token on refusal.
    expect(response.body).not.toContain('frank-session.v1');
  });
});
