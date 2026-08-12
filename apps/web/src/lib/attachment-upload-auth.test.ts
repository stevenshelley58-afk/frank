import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelAttachmentUpload, renewAttachmentUploadCapability, reserveAttachmentUpload } from './attachment-upload-auth';

afterEach(() => vi.unstubAllGlobals());

describe('attachment upload controls', () => {
  it('binds authorisation idempotency in both header and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reservation_id: 'r', upload_id: 'u' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await reserveAttachmentUpload({ conversation_id: 'conv', draft_message_id: '11111111-1111-4111-8111-111111111111', idempotency_key: 'key-1', size_bytes: '12', original_name: 'brief.pdf' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/attachments/uploads', expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'Idempotency-Key': 'key-1' }) }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body)).toMatchObject({ idempotency_key: 'key-1', size_bytes: '12' });
  });

  it('uses canonical renew and cancel endpoints with required keys', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await renewAttachmentUploadCapability('upload-1', 'renew-1');
    await cancelAttachmentUpload('upload-1', 'capability', 'cancel-1');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/attachments/uploads/upload-1/capability');
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ 'Idempotency-Key': 'renew-1' });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/attachments/uploads/upload-1');
    expect(fetchMock.mock.calls[1]![1]!.headers).toMatchObject({ 'Idempotency-Key': 'cancel-1', 'X-Frank-Upload-Capability': 'capability' });
  });
});
