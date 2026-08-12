import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import type { AttachmentDownloadStorage, AttachmentPromoterStorage, ExtractionRunner, MalwareScanner, ObjectManifest } from './types.js';

export interface S3Identity { readonly endpoint: URL; readonly bucket: string; readonly accessKey: string; readonly secretKey: string; }

/** Private, minimal SigV4 client. Each constructed instance represents one Seaweed policy identity. */
export class SeaweedS3Client {
  constructor(private readonly identity: S3Identity, private readonly fetcher: typeof fetch = fetch, private readonly now = () => new Date()) {
    if (identity.endpoint.protocol !== 'http:' || identity.endpoint.hostname !== 'frank-seaweedfs' || identity.endpoint.port !== '8333' || identity.endpoint.username || identity.endpoint.password || identity.endpoint.search || identity.endpoint.hash || identity.endpoint.pathname !== '/' || !validBucket(identity.bucket) || !identity.accessKey || !identity.secretKey) throw new Error('invalid_attachment_s3_config');
  }
  async head(key: string, signal?: AbortSignal): Promise<{ size: bigint } | undefined> {
    const response = await this.request('HEAD', key, {}, signal);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`s3_head_${response.status}`);
    const size = response.headers.get('content-length');
    if (!size || !/^[0-9]+$/.test(size)) throw new Error('s3_invalid_content_length');
    return { size: BigInt(size) };
  }
  async read(key: string, range?: { start: bigint; end: bigint }, signal?: AbortSignal): Promise<Readable> {
    if (range && (range.start < 0n || range.end < range.start)) throw new Error('invalid_object_range');
    const response = await this.request('GET', key, range ? { range: `bytes=${range.start}-${range.end}` } : {}, signal);
    if (!response.ok || !response.body) throw new Error(`s3_get_${response.status}`);
    return Readable.fromWeb(response.body as never);
  }
  async copyFrom(sourceBucket: string, sourceKey: string, targetKey: string, signal?: AbortSignal): Promise<void> {
    if (!validBucket(sourceBucket)) throw new Error('invalid_attachment_s3_config');
    const response = await this.request('PUT', targetKey, { 'x-amz-copy-source': `/${awsPath(sourceBucket)}/${awsPath(sourceKey)}` }, signal);
    if (!response.ok) throw new Error(`s3_copy_${response.status}`);
  }
  async remove(key: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request('DELETE', key, {}, signal);
    if (!response.ok && response.status !== 404) throw new Error(`s3_delete_${response.status}`);
  }
  private async request(method: string, key: string, inputHeaders: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    const url = new URL(`${awsPath(this.identity.bucket)}/${awsPath(key)}`, this.identity.endpoint);
    const date = amzDate(this.now());
    const payload = createHash('sha256').update('').digest('hex');
    const headers = new Map<string, string>();
    headers.set('host', url.host);
    headers.set('x-amz-content-sha256', payload);
    headers.set('x-amz-date', date);
    for (const [name, value] of Object.entries(inputHeaders)) {
      const normalized = name.toLowerCase();
      if (!normalized || normalized === 'authorization' || headers.has(normalized)) throw new Error('invalid_s3_request_header');
      headers.set(normalized, normalizeHeader(value));
    }
    const signedHeaders = [...headers.keys()].sort();
    const canonicalHeaders = signedHeaders.map(name => `${name}:${headers.get(name)!}\n`).join('');
    const canonical = `${method}\n${url.pathname}\n${canonicalQuery(url)}\n${canonicalHeaders}\n${signedHeaders.join(';')}\n${payload}`;
    const scope = `${date.slice(0, 8)}/us-east-1/s3/aws4_request`;
    const signature = signV4(this.identity.secretKey, date, scope, canonical);
    headers.set('authorization', `AWS4-HMAC-SHA256 Credential=${this.identity.accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`);
    return this.fetcher(url, { method, signal, redirect: 'error', headers: Object.fromEntries(headers) });
  }
}

/** The worker can read/delete staging with its promoter identity and write canonical objects with a separate canonical identity. */
export class SeaweedS3PromoterStorage implements AttachmentPromoterStorage {
  readonly role = 'promoter' as const;
  constructor(private readonly staging: SeaweedS3Client, private readonly canonical: SeaweedS3Client, private readonly stagingBucket: string) {}
  headStaging(key: string, signal?: AbortSignal) { return this.staging.head(key, signal); }
  readStaging(key: string, signal?: AbortSignal) { return this.staging.read(key, undefined, signal); }
  headObject(key: string, signal?: AbortSignal) { return this.canonical.head(key, signal); }
  copyStagingToObject(source: string, target: string, signal?: AbortSignal) { return this.canonical.copyFrom(this.stagingBucket, source, target, signal); }
  removeStaging(key: string, signal?: AbortSignal) { return this.staging.remove(key, signal); }
  readObject(key: string, signal?: AbortSignal) { return this.canonical.read(key, undefined, signal); }
}

/** Download credentials have only canonical-object read access; they cannot stage, promote, or delete. */
export class SeaweedS3DownloadStorage implements AttachmentDownloadStorage {
  readonly role = 'downloader' as const;
  constructor(private readonly canonical: SeaweedS3Client) {}
  readObject(key: string, range?: { start: bigint; end: bigint }, signal?: AbortSignal) { return this.canonical.read(key, range, signal); }
}

/** ClamAV INSTREAM transport with bounded writes, backpressure, abort propagation, timeout, and a single terminal result. */
export class TcpClamAvScanner implements MalwareScanner {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 30_000, private readonly maxBytes = 2n * 1024n * 1024n * 1024n) {
    if (host !== 'frank-clamav' || !Number.isInteger(port) || port !== 3310 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || maxBytes < 1n) throw new Error('invalid_clamav_config');
  }
  async scan(stream: Readable, signal?: AbortSignal): Promise<{ state: 'clean' | 'infected' | 'unavailable'; detail?: string }> {
    return new Promise(resolve => {
      const socket = connect(this.port, this.host);
      let settled = false;
      let reply = '';
      let bytes = 0n;
      const finish = (result: { state: 'clean' | 'infected' | 'unavailable'; detail?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        stream.destroy();
        socket.destroy();
        resolve(result);
      };
      const abort = () => finish({ state: 'unavailable', detail: 'clamav_aborted' });
      const timeout = setTimeout(() => finish({ state: 'unavailable', detail: 'clamav_timeout' }), this.timeoutMs);
      timeout.unref();
      signal?.addEventListener('abort', abort, { once: true });
      socket.once('error', () => finish({ state: 'unavailable', detail: 'clamav_transport' }));
      socket.on('data', chunk => {
        if (reply.length + chunk.length > 8192) return finish({ state: 'unavailable', detail: 'clamav_reply_too_large' });
        reply += Buffer.from(chunk).toString('utf8');
      });
      socket.once('close', () => finish(/\bFOUND\b/.test(reply) ? { state: 'infected' } : /\bOK\b/.test(reply) ? { state: 'clean' } : { state: 'unavailable', detail: 'clamav_invalid_reply' }));
      socket.once('connect', () => { void this.writeInstream(socket, stream, () => settled, () => bytes, value => { bytes = value; }).then(() => socket.end()).catch(() => finish({ state: 'unavailable', detail: 'clamav_stream' })); });
    });
  }
  private async writeInstream(socket: ReturnType<typeof connect>, stream: Readable, settled: () => boolean, getBytes: () => bigint, setBytes: (value: bigint) => void): Promise<void> {
    await write(socket, Buffer.from('zINSTREAM\0'));
    for await (const chunk of stream) {
      if (settled()) throw new Error('clamav_settled');
      const bytes = Buffer.from(chunk);
      const total = getBytes() + BigInt(bytes.length);
      if (total > this.maxBytes) throw new Error('clamav_size_limit');
      setBytes(total);
      const prefix = Buffer.allocUnsafe(4);
      prefix.writeUInt32BE(bytes.length);
      await write(socket, prefix);
      await write(socket, bytes);
    }
    await write(socket, Buffer.alloc(4));
  }
}

/** Wave 1 has no durable extraction-output sink; report that truthfully rather than claiming completion. */
export class UnsupportedRuntimeExtractor implements ExtractionRunner {
  async extract(input: { manifest: ObjectManifest; stream: Readable; signal?: AbortSignal }): Promise<{ state: 'unsupported'; previewObjectIds: readonly string[]; hint: string }> {
    input.stream.destroy();
    return { state: 'unsupported', previewObjectIds: [], hint: `no durable extractor is configured for ${input.manifest.media_type}` };
  }
}

function validBucket(value: string): boolean { return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value); }
function awsPath(value: string): string { return value.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/'); }
function normalizeHeader(value: string): string { const result = value.trim().replace(/\s+/g, ' '); if (!result) throw new Error('invalid_s3_request_header'); return result; }
function canonicalQuery(url: URL): string { return [...url.searchParams.entries()].map(([key, value]) => [awsPath(key), awsPath(value)] as const).sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)).map(([key, value]) => `${key}=${value}`).join('&'); }
function amzDate(now: Date): string { return now.toISOString().replace(/[:-]|\.\d{3}/g, ''); }
function signV4(secret: string, date: string, scope: string, canonical: string): string { const dateKey = createHmac('sha256', `AWS4${secret}`).update(date.slice(0, 8)).digest(); const regionKey = createHmac('sha256', dateKey).update('us-east-1').digest(); const serviceKey = createHmac('sha256', regionKey).update('s3').digest(); const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest(); const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`; return createHmac('sha256', signingKey).update(stringToSign).digest('hex'); }
async function write(socket: ReturnType<typeof connect>, data: Buffer): Promise<void> { if (socket.write(data)) return; await once(socket, 'drain'); }
