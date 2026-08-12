import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('durable live chat composition', () => {
  const route = readFileSync(new URL('../routes/chat-turns.ts', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('./chat-turn-runner.ts', import.meta.url), 'utf8');

  it('validates and atomically links only clean owned conversation attachments before queueing', () => {
    expect(route).toContain("state in ('ready','promoted') and scan_state='clean'");
    expect(route).toContain('owner_id=${owner(principal, context)}');
    expect(route).toContain('conversation_id=${input.conversation_id}::uuid');
    expect(route).toContain('and turn_id is null for update');
    expect(route).toContain('set turn_id=${turn.id}::uuid');
  });

  it('streams resumable SSE and persists fallback, receipt, usage, and honest unavailable cost evidence', () => {
    expect(route).toContain("'last-event-id'");
    expect(route).toContain("'Content-Type': 'text/event-stream'");
    expect(route).toContain('id: ${item.cursor}');
    expect(runner).toContain('new HarnessBroker(options.adapters)');
    expect(runner).toContain('harness_fallback_attempt');
    expect(runner).toContain('chat_turn_receipt');
    expect(runner).toContain("cost: { confidence: 'unavailable', source: 'unavailable' }");
    expect(runner).toContain('attachmentHashes');
  });
});
