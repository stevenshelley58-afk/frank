import { AttachmentOutboxWorker } from './worker.js';
import { BoundedContentSandbox, HmacUploadCapability, InternalTusdTerminator } from './adapters.js';
import { SeaweedS3Client, SeaweedS3DownloadStorage, SeaweedS3PromoterStorage, TcpClamAvScanner, UnsupportedRuntimeExtractor, type S3Identity } from './runtime-adapters.js';
import { OBJECTS_BUCKET, STAGING_BUCKET, seaweedEndpoint } from './storage.js';
import type { AttachmentPersistencePort } from './types.js';
import { AttachmentLifecycle } from './lifecycle.js';

export interface AttachmentRuntimeConfig {
  readonly s3Endpoint: URL;
  /** The sole API worker identity: policy permits only its cross-bucket promotion duties. */
  readonly promoter: { readonly accessKey: string; readonly secretKey: string };
  readonly downloader: S3Identity;
  readonly capabilityKey: string;
  readonly previousCapabilityKey?: string;
  readonly tusdUrl: string;
  readonly clamavHost: string;
  readonly clamavPort: number;
}

/** Undefined means attachment runtime is deliberately disabled; a partial or identity-mismatched configuration is rejected. */
export function attachmentRuntimeConfig(env: NodeJS.ProcessEnv): AttachmentRuntimeConfig | undefined {
  // Existing app Compose harmlessly supplies private endpoint defaults. A strict
  // explicit flag keeps that base deployment disabled; the harness overlay alone
  // supplies both the flag and the identities. Credentials without the flag (or
  // a false flag) are a configuration error rather than an accidental enablement.
  const enableInputs = ['FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY', 'FRANK_ATTACHMENT_PROMOTER_SECRET_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY', 'FRANK_UPLOAD_CAPABILITY_KEY', 'FRANK_TUSD_HOOK_SECRET', 'FRANK_TUSD_GATE_SECRET'];
  const flag = env.FRANK_ATTACHMENT_RUNTIME_ENABLED;
  const hasCredentials = enableInputs.some(key => env[key] !== undefined && env[key] !== '');
  if (flag === undefined || flag === '') {
    if (!hasCredentials) return undefined;
    throw new Error('incomplete_attachment_runtime_config');
  }
  if (flag !== 'true' && flag !== 'false') throw new Error('invalid_attachment_runtime_config');
  if (flag === 'false') {
    if (hasCredentials) throw new Error('incomplete_attachment_runtime_config');
    return undefined;
  }
  const required = ['FRANK_SEAWEEDFS_INTERNAL_URL', ...enableInputs, 'FRANK_TUSD_INTERNAL_URL', 'FRANK_CLAMAV_INTERNAL_URL'];
  if (required.some(key => !env[key])) throw new Error('incomplete_attachment_runtime_config');
  const s3Endpoint = seaweedEndpoint(env.FRANK_SEAWEEDFS_INTERNAL_URL!);
  const promoter = { accessKey: env.FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY!, secretKey: env.FRANK_ATTACHMENT_PROMOTER_SECRET_KEY! };
  const downloader: S3Identity = { endpoint: s3Endpoint, bucket: OBJECTS_BUCKET, accessKey: env.FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY!, secretKey: env.FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY! };
  if (sameIdentity(promoter, downloader)) throw new Error('attachment_storage_identity_reuse');
  const tusd = new URL(env.FRANK_TUSD_INTERNAL_URL!);
  if (tusd.protocol !== 'http:' || tusd.hostname !== 'frank-tusd' || tusd.port !== '1080' || tusd.username || tusd.password || tusd.search || tusd.hash || !['', '/'].includes(tusd.pathname)) throw new Error('invalid_attachment_runtime_config');
  const clamav = new URL(env.FRANK_CLAMAV_INTERNAL_URL!);
  if (clamav.protocol !== 'tcp:' || clamav.hostname !== 'frank-clamav' || clamav.port !== '3310' || clamav.username || clamav.password || clamav.search || clamav.hash || !['', '/'].includes(clamav.pathname)) throw new Error('invalid_attachment_runtime_config');
  return { s3Endpoint, promoter, downloader, capabilityKey: env.FRANK_UPLOAD_CAPABILITY_KEY!, ...(env.FRANK_UPLOAD_CAPABILITY_PREVIOUS_KEY ? { previousCapabilityKey: env.FRANK_UPLOAD_CAPABILITY_PREVIOUS_KEY } : {}), tusdUrl: tusd.toString(), clamavHost: clamav.hostname, clamavPort: Number(clamav.port) };
}

export function createAttachmentRuntime(config: AttachmentRuntimeConfig, persistence: AttachmentPersistencePort) {
  const staging = new SeaweedS3Client({ endpoint: config.s3Endpoint, bucket: STAGING_BUCKET, ...config.promoter });
  const canonical = new SeaweedS3Client({ endpoint: config.s3Endpoint, bucket: OBJECTS_BUCKET, ...config.promoter });
  const downloader = new SeaweedS3DownloadStorage(new SeaweedS3Client(config.downloader));
  const storage = new SeaweedS3PromoterStorage(staging, canonical, STAGING_BUCKET);
  return { storage, downloader, capabilities: new HmacUploadCapability(Buffer.from(config.capabilityKey, 'base64'), config.previousCapabilityKey ? Buffer.from(config.previousCapabilityKey, 'base64') : undefined), terminator: new InternalTusdTerminator(config.tusdUrl), worker: new AttachmentOutboxWorker(persistence, storage, new BoundedContentSandbox(), new TcpClamAvScanner(config.clamavHost, config.clamavPort), new UnsupportedRuntimeExtractor()) };
}

export function startAttachmentWorker(worker: AttachmentOutboxWorker, signal: AbortSignal, intervalMs = 250): () => Promise<void> { let stopped = false; let active: Promise<void> = Promise.resolve(); const tick = (): void => { if (stopped || signal.aborted) return; active = worker.processNext(signal).catch(() => undefined).then(() => undefined).finally(() => { if (!stopped && !signal.aborted) setTimeout(tick, intervalMs).unref(); }); }; tick(); return async () => { stopped = true; await drain(active); }; }

/** Bounded, abortable maintenance: one outbox loop and one expiry/termination loop.
 * The expiry loop can only act on rows atomically claimed through 0013's ledger. */
export function startAttachmentMaintenance(input: { worker: AttachmentOutboxWorker; lifecycle: AttachmentLifecycle; persistence: AttachmentPersistencePort; terminator: { terminate(input: { uploadId: string; capability: string }): Promise<'deleted' | 'absent'> } }, signal: AbortSignal, intervalMs = 1_000): () => Promise<void> {
  const stopWorker = startAttachmentWorker(input.worker, signal, Math.min(intervalMs, 1_000));
  let stopped = false;
  let active: Promise<void> = Promise.resolve();
  const tick = (): void => {
    if (stopped || signal.aborted) return;
    active = (async () => { try {
      const claimed = await input.persistence.claimExpiredReservations(16);
      for (const reservation of claimed) {
        if (stopped || signal.aborted) break;
        await input.lifecycle.expire(reservation, input.terminator).catch(() => undefined);
      }
    } finally {
      if (!stopped && !signal.aborted) setTimeout(() => void tick(), intervalMs).unref();
    } })();
  };
  tick();
  return async () => { stopped = true; await Promise.all([stopWorker(), drain(active)]); };
}

async function drain(work: Promise<void>): Promise<void> {
  await Promise.race([work, new Promise<void>(resolve => { const timeout = setTimeout(resolve, 10_000); timeout.unref(); })]);
}

function sameIdentity(left: { accessKey: string; secretKey: string }, right: { accessKey: string; secretKey: string }): boolean { return left.accessKey === right.accessKey || left.secretKey === right.secretKey; }
