import { timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ObjectStorage } from './types.js';

export const STAGING_BUCKET = 'frank-attachment-staging';
export const OBJECTS_BUCKET = 'frank-objects';
export const PREVIEWS_BUCKET = 'frank-object-previews';

export function stagingKey(cellId: string, uploadId: string, part = 'object'): string { return `${cellId}/${uploadId}/${part}`; }
export function objectKey(sha256: string): string { if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid sha256'); return `sha256/${sha256.slice(0, 2)}/${sha256}`; }
export function constantTimeEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
/** Adapter boundary only: SeaweedFS is accessed via a private, allowlisted S3 endpoint. */
export class S3ObjectStorage implements ObjectStorage {
  constructor(endpoint: URL, private readonly allowedHosts: readonly string[], private readonly client: { head(bucket: string, key: string, signal?: AbortSignal): Promise<{ size: bigint } | undefined>; read(bucket: string, key: string, range?: { start: bigint; end?: bigint }, signal?: AbortSignal): Promise<Readable>; copy(source: { bucket: string; key: string }, target: { bucket: string; key: string }, signal?: AbortSignal): Promise<void>; remove(bucket: string, key: string, signal?: AbortSignal): Promise<void> }) {
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !allowedHosts.includes(endpoint.hostname)) throw new Error('storage endpoint is not allowlisted');
    if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.|\[::1\])/.test(endpoint.hostname) && !allowedHosts.includes(endpoint.hostname)) throw new Error('storage endpoint is not SSRF-safe');
  }
  private bucket(bucket: string) { if (![STAGING_BUCKET, OBJECTS_BUCKET, PREVIEWS_BUCKET].includes(bucket)) throw new Error('bucket_not_allowlisted'); }
  head(bucket: string, key: string, signal?: AbortSignal) { this.bucket(bucket); return this.client.head(bucket, key, signal); }
  read(bucket: string, key: string, range?: { start: bigint; end?: bigint }, signal?: AbortSignal) { this.bucket(bucket); return this.client.read(bucket, key, range, signal); }
  copy(source: { bucket: string; key: string }, target: { bucket: string; key: string }, signal?: AbortSignal) { this.bucket(source.bucket); this.bucket(target.bucket); return this.client.copy(source, target, signal); }
  remove(bucket: string, key: string, signal?: AbortSignal) { this.bucket(bucket); return this.client.remove(bucket, key, signal); }
}
