import { describe, expect, it, vi } from 'vitest';
import { reserveAttachmentUpload } from './attachment-upload-auth';

describe('reserveAttachmentUpload', () => {
  it('uses the same-origin reservation contract before Tus starts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ attachment_id: 'att_1', tus_creation_url: '/uploads/1', capability_header: { name: 'Authorization', value: 'cap' }, capability_expires_at: '2030-01-01T00:00:00Z' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await reserveAttachmentUpload({ conversation_id: 'conv_1', draft_message_id: '11111111-1111-4111-8111-111111111111', idempotency_key: 'key', size_bytes: '12', original_name: 'brief.pdf' });
    expect(fetchMock).toHaveBeenCalledWith('/v1/attachments/uploads', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ conversation_id: 'conv_1', size_bytes: '12', original_name: 'brief.pdf' });
  });
});
