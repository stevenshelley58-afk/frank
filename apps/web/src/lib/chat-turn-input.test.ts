import { describe, expect, it } from 'vitest';
import { chatTurnInput } from './chat-turn-input';

describe('chatTurnInput', () => {
  it('produces the canonical Hermes turn body (W2-1 contract)', () => {
    const turn = chatTurnInput({
      conversationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'turn-1',
      message: 'Review this',
      profile: 'hub',
      sessionKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(turn).toEqual({
      conversation_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: 'turn-1',
      profile: 'hub',
      session_key: '11111111-1111-4111-8111-111111111111',
      message: 'Review this',
    });
    // No legacy wire fields survive — the strict body would 400 on them.
    expect(JSON.stringify(turn)).not.toContain('content');
    expect(JSON.stringify(turn)).not.toContain('attachment_ids');
    expect(JSON.stringify(turn)).not.toContain('requested_capability');
  });

  it('defaults the profile to hub and the session key to the conversation id', () => {
    const turn = chatTurnInput({
      conversationId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'turn-1',
      message: 'Hello',
    });
    expect(turn.profile).toBe('hub');
    expect(turn.session_key).toBe('11111111-1111-4111-8111-111111111111');
    expect(turn.message).toBe('Hello');
  });
});
