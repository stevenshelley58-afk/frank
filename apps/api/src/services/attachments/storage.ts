import { timingSafeEqual } from 'node:crypto';

export const STAGING_BUCKET = 'frank-attachment-staging';
export const OBJECTS_BUCKET = 'frank-objects';
export const PREVIEWS_BUCKET = 'frank-object-previews';
const CELL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function stagingKey(cellId: string, uploadId: string, part: 'object' | `part-${number}` = 'object'): string {
  if (!CELL.test(cellId) || !UUID.test(uploadId) || (part !== 'object' && !/^part-[1-9][0-9]{0,8}$/.test(part))) throw new Error('invalid_staging_key');
  return `${cellId}/${uploadId}/${part}`;
}
export function objectKey(sha256: string): string { if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid_sha256'); return `sha256/${sha256.slice(0, 2)}/${sha256}`; }
export function previewKey(objectId: string, variant: string, digestOrName: string): string {
  if (!UUID.test(objectId) || !NAME.test(variant) || (!/^[a-f0-9]{64}$/.test(digestOrName) && !NAME.test(digestOrName))) throw new Error('invalid_preview_key');
  return `${objectId}/${variant}/${digestOrName}`;
}
export function constantTimeEqual(left: string, right: string): boolean { const a = Buffer.from(left, 'utf8'); const b = Buffer.from(right, 'utf8'); return a.length === b.length && timingSafeEqual(a, b); }
export function seaweedEndpoint(input: string): URL { const endpoint = new URL(input); if (endpoint.protocol !== 'http:' || endpoint.hostname !== 'frank-seaweedfs' || endpoint.port !== '8333' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('invalid_private_seaweed_endpoint'); return endpoint; }
