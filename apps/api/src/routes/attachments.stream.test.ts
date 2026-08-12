import { describe, expect, it } from 'vitest';
import { LocalSignedSessionProvider } from '@frank/identity';

import { buildServer } from '../server.js';
import { testConfig, TEST_CELL, TEST_NOW } from '../test/harness.js';
import { FakeDomainStore } from '../test/fake-store.js';

const objectId = '123e4567-e89b-42d3-a456-426614174010';
const conversationId = '123e4567-e89b-42d3-a456-426614174011';

describe('attachment download stream boundary', () => {
  it('does not expose GET or HEAD download routes when the attachment runtime is disabled', async () => {
    const app = disabledServer();
    const url = `/v1/attachments/objects/${objectId}/download?conversation_id=${conversationId}`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await app.inject({ method: 'HEAD', url })).statusCode).toBe(404);
    await app.close();
  });

  it('fails closed before GET or HEAD reaches storage when ownership or clean manifest lookup is absent', async () => {
    let reads = 0;
    const config = testConfig();
    const identity = new LocalSignedSessionProvider({ signingKey: config.sessionSigningKey, audience: config.audience, cellId: TEST_CELL, now: () => TEST_NOW });
    const built = buildServer({
      config,
      store: new FakeDomainStore(),
      db: {} as import('@frank/adapter-postgres').FrankDatabase,
      identity,
      now: () => TEST_NOW,
      attachments: {
        lifecycle: {} as import('../services/attachments/lifecycle.js').AttachmentLifecycle,
        persistence: { findDownload: async () => undefined } as unknown as import('../services/attachments/types.js').AttachmentPersistencePort,
        downloader: { role: 'downloader', readObject: async () => { reads++; throw new Error('must_not_read'); } },
        tusdTerminator: { terminate: async () => 'deleted' },
        tusdHookSecret: 'hook-secret',
        tusdGateSecret: 'gate-secret',
      },
    });
    const token = identity.issue({ principalId: 'user/steven', roles: ['owner'], sessionId: 'attachment-stream', lifetimeSeconds: 3600, methods: ['passkey'] });
    const url = `/v1/attachments/objects/${objectId}/download?conversation_id=${conversationId}`;
    for (const method of ['GET', 'HEAD'] as const) expect((await built.app.inject({ method, url, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect(reads).toBe(0);
    await built.app.close();
  });
});

function disabledServer() {
  const config = testConfig();
  return buildServer({ config, store: new FakeDomainStore(), now: () => TEST_NOW }).app;
}
