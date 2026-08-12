import { createHmac, timingSafeEqual } from 'node:crypto';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ContentSandboxPort, ExtractionRunner, MalwareScanner, ObjectManifest, TusdTerminationPort, UploadCapabilityClaims, UploadCapabilityPort } from './types.js';
import { classifyContent } from './content-policy.js';

/** The archive parser is intentionally injected: unknown archives are rejected, never expanded in-process. */
export class BoundedContentSandbox implements ContentSandboxPort {
  constructor(private readonly inspectArchive: (prefix: Buffer, signal?: AbortSignal) => Promise<{ encrypted: boolean; expandedBytes: bigint; paths: readonly string[]; supported: boolean }> = async () => ({ encrypted: false, expandedBytes: 0n, paths: [], supported: false })) {}
  async inspect(stream: import('node:stream').Readable, declaredMediaType: string, signal?: AbortSignal) { const prefix: Buffer[] = []; let bytes = 0; await pipeline(stream, new Writable({ write(chunk, _encoding, done) { if (bytes < 64 * 1024) { const slice = Buffer.from(chunk).subarray(0, 64 * 1024 - bytes); prefix.push(slice); bytes += slice.length; } done(); } }), ...(signal ? [{ signal }] : [])); const joined = Buffer.concat(prefix); const archive = joined.subarray(0, 2).equals(Buffer.from('PK')) ? await this.inspectArchive(joined, signal) : undefined; const result = classifyContent(joined, declaredMediaType, archive); return result.allowed ? { mediaType: result.mediaType, verdict: 'clean' as const } : { mediaType: 'application/octet-stream', verdict: result.reason, detail: result.reason }; }
}
/** ClamAV is a required worker dependency; transport ambiguity is unavailable and therefore fails closed. */
export class ClamAvScanner implements MalwareScanner { constructor(private readonly scanStream: (stream: import('node:stream').Readable, signal?: AbortSignal) => Promise<'clean' | 'infected'>) {} async scan(stream: import('node:stream').Readable, signal?: AbortSignal) { try { return { state: await this.scanStream(stream, signal) }; } catch { return { state: 'unavailable' as const, detail: 'clamav_unavailable' }; } } }
/** Compact HMAC proof. Verification accepts the current and one retiring key only. */
export class HmacUploadCapability implements UploadCapabilityPort {
  constructor(private readonly current: Uint8Array, private readonly previous?: Uint8Array, private readonly now = () => new Date()) { if (current.length < 32 || (previous && previous.length < 32)) throw new Error('invalid_upload_capability_key'); }
  async issue(claims: UploadCapabilityClaims): Promise<string> { const payload = Buffer.from(JSON.stringify({ u: claims.uploadId, c: claims.cellId, o: claims.ownerId, v: claims.capabilityVersion, e: claims.expiresAt.getTime() })).toString('base64url'); return `v1.${payload}.${this.sign(payload, this.current)}`; }
  async verify(value: string): Promise<UploadCapabilityClaims | undefined> { const parts = value.split('.'); if (parts.length !== 3 || parts[0] !== 'v1' || !this.matches(parts[1]!, parts[2]!)) return undefined; try { const p = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>; if (typeof p.u !== 'string' || typeof p.c !== 'string' || typeof p.o !== 'string' || !Number.isSafeInteger(p.v) || !Number.isSafeInteger(p.e) || p.e <= this.now().getTime()) return undefined; return { uploadId: p.u, cellId: p.c, ownerId: p.o, capabilityVersion: p.v, expiresAt: new Date(p.e) }; } catch { return undefined; } }
  private sign(payload: string, key: Uint8Array): string { return createHmac('sha256', key).update(payload).digest('base64url'); }
  private matches(payload: string, signature: string): boolean { return [this.current, this.previous].filter((key): key is Uint8Array => !!key).some(key => { const expected = Buffer.from(this.sign(payload, key)); const actual = Buffer.from(signature); return expected.length === actual.length && timingSafeEqual(expected, actual); }); }
}
/** An extractor must persist its outputs before claiming complete. This conservative adapter is honest. */
export class UnsupportedExtractor implements ExtractionRunner { async extract(input: { manifest: ObjectManifest; stream: import('node:stream').Readable; signal?: AbortSignal }) { input.stream.destroy(); return { state: 'unsupported' as const, previewObjectIds: [], hint: `no extractor installed for ${input.manifest.media_type}` }; } }
/** Concrete private tusd deletion client. Public browser traffic never receives this internal endpoint. */
export class InternalTusdTerminator implements TusdTerminationPort {
  private readonly endpoint: URL;
  constructor(baseUrl: string, private readonly request: typeof fetch = fetch) { const base = new URL(baseUrl); if (base.protocol !== 'http:' || base.hostname !== 'frank-tusd' || base.port !== '1080' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new Error('invalid_internal_tusd_endpoint'); this.endpoint = base; }
  async terminate(input: { uploadId: string; capability: string }): Promise<void> { if (!/^[0-9a-f-]{36}$/i.test(input.uploadId)) throw new Error('invalid_upload_id'); if (!/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.capability)) throw new Error('invalid_upload_capability'); const url = new URL(`v1/uploads/tus/${input.uploadId}`, this.endpoint); const response = await this.request(url, { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0', 'X-Frank-Upload-Capability': input.capability }, redirect: 'error' }); if (response.status !== 204 && response.status !== 404) throw new Error(`tusd_terminate_${response.status}`); }
}
