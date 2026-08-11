import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const runbook = readFileSync(
  resolve(repositoryRoot, 'docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md'),
  'utf8',
);
const snapshot = readFileSync(
  resolve(repositoryRoot, 'scripts/production/snapshot-codegraph-release.sh'),
  'utf8',
);
const rollback = readFileSync(
  resolve(repositoryRoot, 'scripts/production/rollback-codegraph-release.sh'),
  'utf8',
);

describe('CodeGraph rollback bundle contract', () => {
  it('captures and seals Caddy before the first production configuration mutation', () => {
    expect(snapshot).toContain('pre-release-Caddyfile');
    expect(snapshot).toMatch(/sha256sum[\s\S]*pre-release-Caddyfile[\s\S]*SNAPSHOT_COMPLETE > SHA256SUMS/);
    expect(snapshot.indexOf("printf 'schema_version=2\\n' > \"$snapshot_real/SNAPSHOT_COMPLETE\"")).toBeLessThan(
      snapshot.indexOf('sha256sum --check SHA256SUMS'),
    );
    expect(snapshot.indexOf('sha256sum --check SHA256SUMS')).toBeLessThan(
      snapshot.indexOf("printf 'snapshot=passed\\n'"),
    );

    const snapshotGuard = "grep -Fx 'snapshot=passed' \"$evidence_dir/codegraph-snapshot.result\"";
    const firstRuntimeMutation = 'mv -f -- "$runtime_tmp" "$root_runtime_env"';
    expect(runbook.indexOf(snapshotGuard)).toBeGreaterThan(-1);
    expect(runbook.indexOf(snapshotGuard)).toBeLessThan(runbook.indexOf(firstRuntimeMutation));
    expect(runbook).not.toContain('"$rollback_config_dir/Caddyfile"');
  });

  it('fails closed on an incomplete bundle and restores Caddy before recreation', () => {
    const requiredGuard = '[[ -f "$snapshot/$required_file" && ! -L "$snapshot/$required_file" ]]';
    const checksum = 'sha256sum --check SHA256SUMS';
    const destructiveStop = '"${compose[@]}" stop';
    const caddyStage = 'install -o root -g root -m 0644 -- "$snapshot/pre-release-Caddyfile" "$caddy_tmp"';
    const caddyStageVerify = 'cmp -s -- "$snapshot/pre-release-Caddyfile" "$caddy_tmp"';
    const caddyRestore = 'mv -f -- "$caddy_tmp" "$caddyfile"';
    const recreate = '"${compose[@]}" up -d --no-build --force-recreate';

    expect(rollback).toContain('SHA256SUMS SNAPSHOT_COMPLETE');
    expect(rollback).toContain('pre-release-Caddyfile');
    expect(rollback).toContain(requiredGuard);
    expect(rollback).toContain("[[ \"$(<\"$snapshot/SNAPSHOT_COMPLETE\")\" == 'schema_version=2' ]]");
    expect(rollback.indexOf(requiredGuard)).toBeLessThan(rollback.indexOf(checksum));
    expect(rollback.indexOf(checksum)).toBeLessThan(rollback.indexOf(destructiveStop));
    expect(rollback.indexOf(caddyStage)).toBeLessThan(rollback.indexOf(destructiveStop));
    expect(rollback.indexOf(caddyStageVerify)).toBeLessThan(rollback.indexOf(destructiveStop));
    expect(rollback.indexOf(caddyRestore)).toBeLessThan(rollback.indexOf(recreate));
    expect(rollback).toMatch(/frank-codegraph frank-api frank-web frank-caddy/);
  });
});
