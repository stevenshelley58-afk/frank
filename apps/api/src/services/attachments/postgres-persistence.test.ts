import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./postgres-persistence.ts', import.meta.url), 'utf8');

describe('PostgresAttachmentPersistence SQL safety contract', () => {
  it('scopes idempotency and locks concrete quota rows', () => {
    expect(source).toContain('owner_id=${x.ownerId}');
    expect(source).toContain('conversation_id=${x.conversationId}::uuid');
    expect(source).toContain('for update of q,m');
  });
  it('fails closed on missing host-free observation and preserves completion replay', () => {
    expect(source).toContain('hostFreeBytes=async()=>0n');
    expect(source).toContain("if(v.state==='completed')");
  });
  it('persists complete canonical manifests with a safe JSON size', () => {
    expect(source).toContain('bucket,object_key,sha256,size_bytes,media_type,manifest');
    expect(source).toContain('Number.isSafeInteger(size)');
  });
  it('records valid termination evidence and bounds stale leased outbox work', () => {
    expect(source).toContain("state='terminating'");
    expect(source).toContain('termination_requested_at=now()');
    expect(source).toContain("state='leased' and available_at<=now()-interval '5 minutes'");
    expect(source).toContain("attempts>=10 then 'failed'");
  });
  it('updates extraction manifest and releases quotas through terminal paths', () => {
    expect(source).toContain("jsonb_set(manifest,'{extraction}'");
    expect(source).toContain('private async release');
    expect(source).toContain('await this.release(tx,reservation(q.rows[0]))');
  });
});
