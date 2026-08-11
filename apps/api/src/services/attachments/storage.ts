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
  constructor(private readonly endpoint: URL, private readonly client: { head(bucket: string, key: string): Promise<{ size: bigint } | undefined>; read(bucket: string, key: string, range?: { start: bigint; end?: bigint }): Promise<Readable>; copy(source: { bucket: string; key: string }, target: { bucket: string; key: string }): Promise<void>; remove(bucket: string, key: string): Promise<void> }) {
    if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'seaweedfs') throw new Error('storage endpoint must be private HTTPS or seaweedfs');
    if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.)/.test(endpoint.hostname)) throw new Error('storage endpoint is not SSRF-safe');
  }
  head(bucket: string, key: string) { return this.client.head(bucket, key); }
  read(bucket: string, key: string, range?: { start: bigint; end?: bigint }) { return this.client.read(bucket, key, range); }
  copy(source: { bucket: string; key: string }, target: { bucket: string; key: string }) { return this.client.copy(source, target); }
  remove(bucket: string, key: string) { return this.client.remove(bucket, key); }
}
