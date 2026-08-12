import { AttachmentOutboxWorker } from './worker.js';
import { BoundedContentSandbox, HmacUploadCapability, InternalTusdTerminator } from './adapters.js';
import { SeaweedS3Client, SeaweedS3DownloadStorage, SeaweedS3PromoterStorage, TcpClamAvScanner, UnsupportedRuntimeExtractor, type S3Identity } from './runtime-adapters.js';
import { OBJECTS_BUCKET, STAGING_BUCKET, seaweedEndpoint } from './storage.js';
import type { AttachmentPersistencePort } from './types.js';

export interface AttachmentRuntimeConfig {
  readonly staging: S3Identity;
  readonly canonical: S3Identity;
  readonly downloader: S3Identity;
  readonly capabilityKey: string;
  readonly previousCapabilityKey?: string;
  readonly tusdUrl: string;
  readonly clamavHost: string;
  readonly clamavPort: number;
}

/** Undefined means attachment runtime is deliberately disabled; a partial or identity-mismatched configuration is rejected. */
export function attachmentRuntimeConfig(env: NodeJS.ProcessEnv): AttachmentRuntimeConfig | undefined {
  const required = ['FRANK_ATTACHMENT_S3_ENDPOINT', 'FRANK_ATTACHMENT_STAGING_BUCKET', 'FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY', 'FRANK_ATTACHMENT_PROMOTER_SECRET_KEY', 'FRANK_ATTACHMENT_CANONICAL_BUCKET', 'FRANK_ATTACHMENT_CANONICAL_ACCESS_KEY', 'FRANK_ATTACHMENT_CANONICAL_SECRET_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_BUCKET', 'FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY', 'FRANK_UPLOAD_CAPABILITY_KEY', 'FRANK_TUSD_INTERNAL_URL', 'FRANK_CLAMAV_HOST', 'FRANK_CLAMAV_PORT'];
  if (required.every(key => env[key] === undefined || env[key] === '')) return undefined;
  if (required.some(key => !env[key])) throw new Error('incomplete_attachment_runtime_config');
  const endpoint = seaweedEndpoint(env.FRANK_ATTACHMENT_S3_ENDPOINT!);
  const port = Number(env.FRANK_CLAMAV_PORT);
  if (!Number.isInteger(port) || port !== 3310 || env.FRANK_CLAMAV_HOST !== 'frank-clamav') throw new Error('invalid_attachment_runtime_config');
  if (env.FRANK_ATTACHMENT_STAGING_BUCKET !== STAGING_BUCKET || env.FRANK_ATTACHMENT_CANONICAL_BUCKET !== OBJECTS_BUCKET || env.FRANK_ATTACHMENT_DOWNLOADER_BUCKET !== OBJECTS_BUCKET) throw new Error('attachment_storage_identity_mismatch');
  const staging: S3Identity = { endpoint, bucket: STAGING_BUCKET, accessKey: env.FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY!, secretKey: env.FRANK_ATTACHMENT_PROMOTER_SECRET_KEY! };
  const canonical: S3Identity = { endpoint, bucket: OBJECTS_BUCKET, accessKey: env.FRANK_ATTACHMENT_CANONICAL_ACCESS_KEY!, secretKey: env.FRANK_ATTACHMENT_CANONICAL_SECRET_KEY! };
  const downloader: S3Identity = { endpoint, bucket: OBJECTS_BUCKET, accessKey: env.FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY!, secretKey: env.FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY! };
  if (sameIdentity(staging, canonical) || sameIdentity(staging, downloader) || sameIdentity(canonical, downloader)) throw new Error('attachment_storage_identity_reuse');
  const tusd = new URL(env.FRANK_TUSD_INTERNAL_URL!);
  if (tusd.protocol !== 'http:' || tusd.hostname !== 'frank-tusd' || tusd.port !== '1080' || tusd.username || tusd.password || tusd.search || tusd.hash || !['', '/'].includes(tusd.pathname)) throw new Error('invalid_attachment_runtime_config');
  return { staging, canonical, downloader, capabilityKey: env.FRANK_UPLOAD_CAPABILITY_KEY!, ...(env.FRANK_UPLOAD_CAPABILITY_PREVIOUS_KEY ? { previousCapabilityKey: env.FRANK_UPLOAD_CAPABILITY_PREVIOUS_KEY } : {}), tusdUrl: tusd.toString(), clamavHost: env.FRANK_CLAMAV_HOST!, clamavPort: port };
}

export function createAttachmentRuntime(config: AttachmentRuntimeConfig, persistence: AttachmentPersistencePort) {
  const staging = new SeaweedS3Client(config.staging);
  const canonical = new SeaweedS3Client(config.canonical);
  const downloader = new SeaweedS3DownloadStorage(new SeaweedS3Client(config.downloader));
  const storage = new SeaweedS3PromoterStorage(staging, canonical, config.staging.bucket);
  return { storage, downloader, capabilities: new HmacUploadCapability(Buffer.from(config.capabilityKey, 'base64'), config.previousCapabilityKey ? Buffer.from(config.previousCapabilityKey, 'base64') : undefined), terminator: new InternalTusdTerminator(config.tusdUrl), worker: new AttachmentOutboxWorker(persistence, storage, new BoundedContentSandbox(), new TcpClamAvScanner(config.clamavHost, config.clamavPort), new UnsupportedRuntimeExtractor()) };
}

export function startAttachmentWorker(worker: AttachmentOutboxWorker, signal: AbortSignal, intervalMs = 250): () => void { let stopped = false; const tick = async () => { if (stopped || signal.aborted) return; await worker.processNext(signal).catch(() => undefined); if (!stopped && !signal.aborted) setTimeout(tick, intervalMs).unref(); }; void tick(); return () => { stopped = true; }; }

function sameIdentity(left: S3Identity, right: S3Identity): boolean { return left.accessKey === right.accessKey || left.secretKey === right.secretKey; }
