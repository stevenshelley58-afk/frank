import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const runbookPath = resolve(repositoryRoot, 'docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md');

function tokenMintSection(): string {
  const runbook = readFileSync(runbookPath, 'utf8');
  const match = runbook.match(/### 3C\. Mint the domain service token[\s\S]*?(?=\n### )/);
  if (!match) throw new Error('domain service token runbook section is missing');
  return match[0];
}

describe('offline production service-token mint contract', () => {
  it('uses the exact bundled tsx binary without a package-manager shim', () => {
    const section = tokenMintSection();
    const invocation = [
      'docker run --rm --network none --read-only \\',
      '  --tmpfs /tmp:rw,nosuid,nodev,noexec,mode=1777,size=64m \\',
      '  --env HOME=/tmp \\',
      '  --env FRANK_SESSION_SIGNING_KEY \\',
      '  --env FRANK_API_AUDIENCE \\',
      '  --env FRANK_CELL_ID \\',
      '  --env FRANK_SERVICE_TOKEN_LIFETIME_SECONDS=31536000 \\',
      '  "$FRANK_API_IMAGE" \\',
      '  /app/apps/api/node_modules/.bin/tsx /app/scripts/production/mint-service-token.ts \\',
      '  > "$domain_token_tmp"',
    ].join('\n');

    expect(section).toContain(invocation);
    expect(section).not.toMatch(/\b(?:corepack|pnpm)\b/i);
  });

  it('keeps token output root-only and out of shell tracing', () => {
    const section = tokenMintSection();

    expect(section).toContain('{ set +x; } 2>/dev/null');
    expect(section).toContain('umask 077');
    expect(section).toContain(`test "$(stat -c '%u:%g:%a' "$domain_token_tmp")" = '0:0:600'`);
    expect(section).toContain('chown root:root "$domain_token_tmp"');
    expect(section).toContain('chmod 0400 "$domain_token_tmp"');
    expect(section).toContain('mv -f -- "$domain_token_tmp" "$domain_token_file"');
    expect(section).not.toContain('cat "$domain_token_file"');
  });
});
