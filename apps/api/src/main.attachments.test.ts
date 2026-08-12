import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('attachment process composition', () => {
  it('measures the mounted durable path with bigint statfs and fails closed on observation errors', () => {
    expect(source).toContain("statfs(process.env.FRANK_ATTACHMENT_DURABLE_PATH ?? '/var/lib/frank/artifacts', { bigint: true })");
    expect(source).toContain('return observed.bavail * observed.bsize');
    expect(source).toContain('return 0n;');
  });

  it('aborts and awaits attachment maintenance before closing the database', () => {
    const abort = source.indexOf('attachmentAbort.abort()');
    const drain = source.indexOf('await stopAttachmentMaintenance?.()');
    const close = source.indexOf('store.close()');
    expect(abort).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(abort);
    expect(close).toBeGreaterThan(drain);
  });
});
