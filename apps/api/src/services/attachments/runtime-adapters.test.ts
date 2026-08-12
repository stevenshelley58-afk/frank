import { describe, expect, it } from 'vitest';
import { InternalTusdTerminator } from './adapters.js';
import { SeaweedS3Client, SeaweedS3DownloadStorage, SeaweedS3PromoterStorage, TcpClamAvScanner } from './runtime-adapters.js';
import { attachmentRuntimeConfig } from './runtime.js';
import { toCanonicalObjectManifest, toInternalObjectManifest, type ObjectManifest, type UploadReservationState } from './types.js';

const endpoint = new URL('http://frank-seaweedfs:8333/');
const identity = (bucket: string, accessKey: string) => ({ endpoint, bucket, accessKey, secretKey: `${accessKey}-secret` });
const key = `sha256/aa/${'a'.repeat(64)}`;

describe('attachment runtime policy seams', () => {
  it('uses role-separated identities and signs Range plus every x-amz header', async () => {
    let captured: { url: URL; init: RequestInit } | undefined;
    const client = new SeaweedS3Client(identity('frank-objects', 'download'), (async (input, init) => { captured = { url: new URL(String(input)), init: init! }; return new Response('ok', { status: 206 }); }) as typeof fetch, () => new Date('2026-08-12T00:00:00.000Z'));
    const storage = new SeaweedS3DownloadStorage(client);
    await storage.readObject(key, { start: 1n, end: 3n });
    expect(storage.role).toBe('downloader');
    expect(captured!.url.pathname).toBe(`/frank-objects/${key}`);
    expect(captured!.init.headers).toMatchObject({ range: 'bytes=1-3', 'x-amz-date': '20260812T000000Z' });
    expect(String((captured!.init.headers as Record<string, string>).authorization)).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
  });

  it('copies between the separate staging and canonical buckets without granting downloader promotion access', async () => {
    let captured: { url: URL; init: RequestInit } | undefined;
    const staging = new SeaweedS3Client(identity('frank-attachment-staging', 'promoter-read'), (async () => new Response(null, { status: 204 })) as typeof fetch);
    const canonical = new SeaweedS3Client(identity('frank-objects', 'canonical-write'), (async (input, init) => { captured = { url: new URL(String(input)), init: init! }; return new Response(null, { status: 200 }); }) as typeof fetch);
    const promoter = new SeaweedS3PromoterStorage(staging, canonical, 'frank-attachment-staging');
    await promoter.copyStagingToObject('cell/123e4567-e89b-42d3-a456-426614174000/object', key);
    expect(promoter.role).toBe('promoter');
    expect(captured!.url.pathname).toBe(`/frank-objects/${key}`);
    expect(captured!.init.headers).toMatchObject({ 'x-amz-copy-source': '/frank-attachment-staging/cell/123e4567-e89b-42d3-a456-426614174000/object' });
  });

  it('fails closed for invalid storage ranges and non-private ClamAV identities', async () => {
    const client = new SeaweedS3Client(identity('frank-objects', 'download'), (async () => new Response('ok')) as typeof fetch);
    await expect(client.read(key, { start: 3n, end: 1n })).rejects.toThrow('invalid_object_range');
    expect(() => new TcpClamAvScanner('localhost', 3310)).toThrow('invalid_clamav_config');
  });

  it('requires complete, role-distinct configuration that matches the deployed private service identities', () => {
    const env = { FRANK_ATTACHMENT_RUNTIME_ENABLED: 'true', FRANK_SEAWEEDFS_INTERNAL_URL: 'http://frank-seaweedfs:8333', FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY: 'promoter', FRANK_ATTACHMENT_PROMOTER_SECRET_KEY: 'promoter-secret', FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY: 'downloader', FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY: 'downloader-secret', FRANK_UPLOAD_CAPABILITY_KEY: Buffer.alloc(32).toString('base64'), FRANK_TUSD_HOOK_SECRET: 'hook-secret', FRANK_TUSD_GATE_SECRET: 'gate-secret', FRANK_TUSD_INTERNAL_URL: 'http://frank-tusd:1080', FRANK_CLAMAV_INTERNAL_URL: 'tcp://frank-clamav:3310' };
    expect(attachmentRuntimeConfig(env)).toMatchObject({ promoter: { accessKey: 'promoter' }, downloader: { bucket: 'frank-objects', accessKey: 'downloader' } });
    expect(() => attachmentRuntimeConfig({ ...env, FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY: 'promoter' })).toThrow('attachment_storage_identity_reuse');
    expect(() => attachmentRuntimeConfig({ ...env, FRANK_CLAMAV_INTERNAL_URL: 'tcp://other:3310' })).toThrow('invalid_attachment_runtime_config');
    expect(attachmentRuntimeConfig({ FRANK_ATTACHMENT_RUNTIME_ENABLED: 'false', FRANK_SEAWEEDFS_INTERNAL_URL: 'http://frank-seaweedfs:8333', FRANK_TUSD_INTERNAL_URL: 'http://frank-tusd:1080', FRANK_CLAMAV_INTERNAL_URL: 'tcp://frank-clamav:3310' })).toBeUndefined();
    expect(() => attachmentRuntimeConfig({ ...env, FRANK_ATTACHMENT_RUNTIME_ENABLED: 'false' })).toThrow('incomplete_attachment_runtime_config');
    expect(() => attachmentRuntimeConfig(({ ...env, FRANK_ATTACHMENT_RUNTIME_ENABLED: undefined }) as NodeJS.ProcessEnv)).toThrow('incomplete_attachment_runtime_config');
  });

  it('keeps private tusd termination on the internal host and canonicalizes bigint only at the JSON contract boundary', async () => {
    const requests: URL[] = [];
    const terminator = new InternalTusdTerminator('http://frank-tusd:1080', (async input => { requests.push(new URL(String(input))); return new Response(null, { status: 204 }); }) as typeof fetch);
    await terminator.terminate({ uploadId: '123e4567-e89b-42d3-a456-426614174000', capability: 'v1.payload.signature' });
    expect(requests[0]!.toString()).toBe('http://frank-tusd:1080/v1/uploads/tus/123e4567-e89b-42d3-a456-426614174000');
    expect(() => new InternalTusdTerminator('http://localhost:1080')).toThrow('invalid_internal_tusd_endpoint');
    const internal: ObjectManifest = { schema: 'schema://frank.object-manifest/v1', object_id: 'object', cell_id: 'cell', bucket: 'frank-objects', object_key: key, sha256: 'a'.repeat(64), size_bytes: 9n, media_type: 'text/plain', created_at: '2026-08-12T00:00:00.000Z', source_ref: { kind: 'attachment', id: 'attachment' }, security: { scan_state: 'clean' }, extraction: { state: 'none', preview_object_ids: [] }, retention: { class: 'message' } };
    expect(toCanonicalObjectManifest(internal).size_bytes).toBe(9);
    expect(toInternalObjectManifest(toCanonicalObjectManifest(internal)).size_bytes).toBe(9n);
    expect(() => toCanonicalObjectManifest({ ...internal, size_bytes: BigInt(Number.MAX_SAFE_INTEGER) + 1n })).toThrow('unsafe_manifest_size');
    const state: UploadReservationState = 'terminating';
    expect(state).toBe('terminating');
  });
});
