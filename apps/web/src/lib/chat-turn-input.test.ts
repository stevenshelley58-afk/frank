import { describe, expect, it } from 'vitest';
import type { ChatTurnInput } from './chat-turn-input';

describe('ChatTurnInput', () => {
  it('keeps a completed attachment to an ID-only transport boundary', () => {
    const turn: ChatTurnInput = { text: 'Review this', attachment_ids: ['att_123'], attachments: [{ id: 'att_123', name: 'brief.pdf', size: 12, relativePath: 'brief/brief.pdf' }] };
    expect(JSON.stringify(turn)).not.toContain('Blob');
    expect(turn.attachment_ids).toEqual(['att_123']);
  });
});
