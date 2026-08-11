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
  it('exports the exact production cell before the mint environment or command', () => {
    const section = tokenMintSection();
    const assignment = section.indexOf("export FRANK_CELL_ID='frank'");
    const assertion = section.indexOf(`test "$FRANK_CELL_ID" = 'frank'`);
    const cellEnvironment = section.indexOf('--env FRANK_CELL_ID');
    const mintCommand = section.indexOf('/app/scripts/production/mint-service-token.ts');

    expect(assignment).toBeGreaterThan(0);
    expect(assignment).toBeLessThan(assertion);
    expect(assertion).toBeLessThan(cellEnvironment);
    expect(cellEnvironment).toBeLessThan(mintCommand);
  });

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

  it('verifies signature and exact cell through trusted API tooling before installation', () => {
    const section = tokenMintSection();
    const minted = section.indexOf('> "$domain_token_tmp"');
    const verifier = section.indexOf(
      'import { LocalSignedSessionProvider } from "/app/packages/identity/src/index.ts";',
    );
    const authentication = section.indexOf('const result = await provider.authenticate({');
    const scopeGuard = section.indexOf(
      'if (!result.authenticated || result.principal.cellId !== "frank")',
    );
    const installed = section.indexOf('mv -f -- "$domain_token_tmp" "$domain_token_file"');

    expect(minted).toBeGreaterThan(0);
    expect(minted).toBeLessThan(verifier);
    expect(verifier).toBeLessThan(authentication);
    expect(authentication).toBeLessThan(scopeGuard);
    expect(scopeGuard).toBeLessThan(installed);
    expect(section).toContain('if (expectedCell !== "frank")');
    expect(section).toContain('--read-only --user 10001:10001');
    expect(section).toContain('dst=/run/secrets/domain-service-token,readonly');

    const acceptsProductionScope = (authenticated: boolean, cellId?: string): boolean =>
      authenticated && cellId === 'frank';
    expect(acceptsProductionScope(true, 'frank')).toBe(true);
    expect(acceptsProductionScope(true, 'another-cell')).toBe(false);
    expect(acceptsProductionScope(true, undefined)).toBe(false);
    expect(acceptsProductionScope(false, 'frank')).toBe(false);
  });
});
