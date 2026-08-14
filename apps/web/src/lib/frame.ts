import type { ApiFetch, WorkSummary } from './api';

export type FrameRunning = { kind: 'chat'; id: string; project_id: string; agent: string; title: string; model: string; thinking: string; running: true; last_message_at: string };

export type FrameReceipt = { kind: 'chat'; message_id: string; conversation_id: string; project_id: string; body: string; created_at: string };

export interface FrameResponse {
  waiting: WorkSummary[];
  running: FrameRunning[];
  receipts: FrameReceipt[];
  generated_at: string;
}

export type FrameFetchResult =
  | { kind: 'not_modified'; etag: string | null }
  | { kind: 'data'; frame: FrameResponse; etag: string | null };

/** Fetch the canonical Living Frame through the authenticated web BFF. */
export async function getFrame(api: ApiFetch, etag?: string | null): Promise<FrameFetchResult> {
  const headers = new Headers();
  if (etag) headers.set('If-None-Match', etag);
  const response = await api('/v1/frame', { headers, cache: 'no-store' });
  if (response.status === 304) return { kind: 'not_modified', etag: response.headers.get('etag') ?? etag ?? null };
  return { kind: 'data', frame: await response.json() as FrameResponse, etag: response.headers.get('etag') };
}
