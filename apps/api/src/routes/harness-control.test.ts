import { describe, expect, it } from 'vitest';

import { attachmentUploadStatusRoute } from './attachment-uploads.js';
import {
  harnessJobBody,
  harnessJobCancelRoute,
  harnessJobCreateRoute,
  harnessJobEventsRoute,
  harnessJobGetRoute,
} from './harness-control.js';

const identifiers = {
  cell_id: 'cell-a', actor_id: 'user/a', request_id: 'request-a',
  correlation_id: 'correlation-a', trace_id: 'trace-a', policy_version: 'v1',
};
const request = {
  idempotency_key: 'job-one', harness: 'hermes' as const, task_type: 'browser-research' as const,
  scope: { project_id: 'central' }, input: { query: 'Frank', max_sources: 5 },
  allowed_tools: ['browser.search' as const], egress_profile: 'research-public' as const,
};
const representation = {
  job_id: '550e8400-e29b-41d4-a716-446655440000', status: 'queued' as const,
  created_at: '2026-08-11T00:00:00.000Z', updated_at: '2026-08-11T00:00:00.000Z',
  finished_at: null, cancelled_at: null, artifacts: [], source_refs: [],
};

describe('Night Watch public route contracts', () => {
  it('never accepts authenticated tenant or owner identity in the create body', () => {
    expect(harnessJobBody.safeParse(request).success).toBe(true);
    expect(harnessJobBody.safeParse({ ...request, cell_id: 'forged' }).success).toBe(false);
    expect(harnessJobBody.safeParse({ ...request, owner_id: 'forged' }).success).toBe(false);
    expect(harnessJobBody.safeParse({ ...request, scope: { ...request.scope, cell_id: 'forged' } }).success).toBe(false);
  });

  it('publishes operation-specific create and status representations', () => {
    expect(harnessJobCreateRoute.response.safeParse({ ...representation, replayed: false, identifiers }).success).toBe(true);
    expect(harnessJobGetRoute.response.safeParse({ ...representation, identifiers }).success).toBe(true);
    expect(harnessJobGetRoute.response.safeParse({ status: 'queued', identifiers }).success).toBe(false);
  });

  it('bounds resumable cursor queries and validates event payload by kind', () => {
    expect(harnessJobEventsRoute.query!.safeParse({ after_cursor: '4', limit: '200' }).success).toBe(true);
    expect(harnessJobEventsRoute.query!.safeParse({ after_cursor: '-1' }).success).toBe(false);
    expect(harnessJobEventsRoute.query!.safeParse({ limit: '201' }).success).toBe(false);
    const valid = { ...representation, events: [{ job_id: representation.job_id, cursor: 5, kind: 'terminal', occurred_at: representation.updated_at, payload: { status: 'cancelled' } }], next_cursor: 5, identifiers };
    expect(harnessJobEventsRoute.response.safeParse(valid).success).toBe(true);
    expect(harnessJobEventsRoute.response.safeParse({ ...valid, events: [{ ...valid.events[0], payload: { summary: 'missing terminal status' } }] }).success).toBe(false);
  });

  it('requires cancellation idempotency in the public body', () => {
    expect(harnessJobCancelRoute.body!.safeParse({ idempotency_key: 'cancel-one' }).success).toBe(true);
    expect(harnessJobCancelRoute.body!.safeParse({ reason: 'stop' }).success).toBe(false);
  });
});

describe('attachment upload polling contract', () => {
  it('does not expose attachment_id until all durable attachment state exists', () => {
    const pending = { upload: { upload_id: 'upload-1', reservation_state: 'uploading' }, identifiers };
    expect(attachmentUploadStatusRoute.response.safeParse(pending).success).toBe(true);
    expect(attachmentUploadStatusRoute.response.safeParse({ ...pending, upload: { ...pending.upload, attachment_id: representation.job_id } }).success).toBe(false);
    expect(attachmentUploadStatusRoute.response.safeParse({ upload: { upload_id: 'upload-1', reservation_state: 'completed', attachment_id: representation.job_id, attachment_state: 'scanning', scan_state: 'pending', extraction_state: 'none' }, identifiers }).success).toBe(true);
  });
});
