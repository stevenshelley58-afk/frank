import { timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ObjectStorage } from './types.js';

export const STAGING_BUCKET = 'frank-attachment-staging';
export const OBJECTS_BUCKET = 'frank-objects';
export const PREVIEWS_BUCKET = 'frank-object-previews';
export function seaweedEndpoint(input: string): URL { const endpoint = new URL(input); if (endpoint.protocol !== 'http:' || endpoint.hostname !== 'frank-seaweedfs' || endpoint.port !== '8333' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('invalid_private_seaweed_endpoint'); return endpoint; }

export function stagingKey(cellId: string, uploadId: string, part = 'object'): string { return `${cellId}/${uploadId}/${part}`; }
export function objectKey(sha256: string): string { if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid sha256'); return `sha256/${sha256.slice(0, 2)}/${sha256}`; }
export function constantTimeEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
/** Adapter boundary only: SeaweedFS is accessed via a private, allowlisted S3 endpoint. */
export class S3ObjectStorage implements ObjectStorage {
  constructor(endpoint: URL, private readonly client: { head(bucket: string, key: string, signal?: AbortSignal): Promise<{ size: bigint } | undefined>; read(bucket: string, key: string, range?: { start: bigint; end?: bigint }, signal?: AbortSignal): Promise<Readable>; copy(source: { bucket: string; key: string }, target: { bucket: string; key: string }, signal?: AbortSignal): Promise<void>; remove(bucket: string, key: string, signal?: AbortSignal): Promise<void> }) {
    // Object traffic is only ever inside the compose network. There is deliberately
    // no general host allowlist: accepting one recreates an SSRF primitive.
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== 'frank-seaweedfs' || endpoint.port !== '8333' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('invalid_private_seaweed_endpoint');
  }
  private bucket(bucket: string, key: string) { if (![STAGING_BUCKET, OBJECTS_BUCKET, PREVIEWS_BUCKET].includes(bucket)) throw new Error('bucket_not_allowlisted'); const segment = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}'; const ok = bucket === STAGING_BUCKET ? new RegExp(`^${segment}\\/[0-9a-f-]{36}\\/(?:object|part-[0-9]{1,9})$`, 'i').test(key) : bucket === OBJECTS_BUCKET ? /^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(key) : new RegExp(`^${segment}\\/${segment}\\/(?:[a-f0-9]{64}|${segment})$`, 'i').test(key); if (!ok || key.includes('..') || key.includes('\\\\')) throw new Error('invalid_object_key'); }
  head(bucket: string, key: string, signal?: AbortSignal) { this.bucket(bucket, key); return this.client.head(bucket, key, signal); }
  read(bucket: string, key: string, range?: { start: bigint; end?: bigint }, signal?: AbortSignal) { this.bucket(bucket, key); return this.client.read(bucket, key, range, signal); }
  copy(source: { bucket: string; key: string }, target: { bucket: string; key: string }, signal?: AbortSignal) { this.bucket(source.bucket, source.key); this.bucket(target.bucket, target.key); return this.client.copy(source, target, signal); }
  remove(bucket: string, key: string, signal?: AbortSignal) { this.bucket(bucket, key); return this.client.remove(bucket, key, signal); }
}
