import { describe, expect, it } from 'vitest';
import { chatTurnInput } from './chat-turn-input';

describe('chatTurnInput', () => {
  it('produces the canonical snake_case ID-only transport', () => {
    const turn = chatTurnInput({
      conversationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'turn-1',
      model: 'vision-model',
      thinking: 'deep',
      draft: { text: 'Review this', attachments: [{ id: '22222222-2222-4222-8222-222222222222', name: 'brief.pdf', size: 12, relativePath: 'brief/brief.pdf' }] },
    });
    expect(turn).toEqual({
      conversation_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: 'turn-1',
      content: [{ type: 'text', text: 'Review this' }],
      attachment_ids: ['22222222-2222-4222-8222-222222222222'],
      requested_capability: 'Deep',
      requested_model_alias: 'vision-model',
    });
    expect(JSON.stringify(turn)).not.toContain('brief.pdf');
  });
});
