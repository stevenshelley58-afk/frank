# Secret Handling — FRANK delivery controls (DEL-04)

Status: **live as of 2026-08-06.** Applies to the `stevenshelley58-afk/frank`
repository, the VPS, and every agent session that touches either.

## The one rule

**Bot tokens, VPS credentials, and environment files enter Frank exclusively
through OpenBao (or the accepted runtime secret path) at deploy/run time.
They never enter a commit, a branch, a PR, a synced folder, or a chat log.**

Concretely:

- No secret value in git — not in code, tests, fixtures, docs, logs, or CI config.
- No `.env`, `.env.*`, or credentials file committed; they are ignored and
  server-side only.
- No secret in a Syncthing-synced folder (synced folders flow into workbench
  mounts; a secret there becomes mountable content).
- No secret pasted into issue bodies, PR descriptions, or Telegram cards.
- Placeholder values in examples must be obviously fake (`REPLACE_ME`,
  `xoxb-EXAMPLE-…`).

## One-time GitHub setting (done)

GitHub secret scanning and push protection are **enabled at the repository
level**. The repo is public, so both are available at no cost; no GHAS
license was required.

What was run (2026-08-06, by the authenticated repo admin):

```bash
gh api -X PATCH repos/stevenshelley58-afk/frank \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

Result: the API response `security_and_analysis` block reported

```json
"secret_scanning": { "status": "enabled" },
"secret_scanning_push_protection": { "status": "enabled" }
```

and `gh api repos/stevenshelley58-afk/frank/secret-scanning/alerts` returned
`[]` (no existing alerts at the time).

Effect: known-provider secret patterns are blocked **at push time** (push
protection) and any that slip through historical scans raise repository
alerts. Verify the setting any time with:

```bash
gh api repos/stevenshelley58-afk/frank --jq '.security_and_analysis'
```

This setting does not need to be repeated unless the repository is deleted
and recreated or the feature is manually disabled.

## Defense-in-depth: gitleaks in CI

GitHub's patterns cover known providers only. As a second layer,
`.github/workflows/secret-scan.yml` runs
[`gitleaks/gitleaks-action`](https://github.com/gitleaks/gitleaks-action)
against the **full git history** on every push and pull request.

- Config: `.gitleaks.toml` at the repo root (default ruleset; allowlist is
  empty by design).
- If a fixture ever false-positives, add a narrowly scoped allowlist entry in
  `.gitleaks.toml` with a comment. Never disable a rule globally.
- A repository secret scan runs before every push session finishes (see the
  release checklist).

## If a secret does leak

1. **Rotate it immediately** — rotation beats cleanup. A leaked Telegram bot
   token is revoked/reissued via BotFather; VPS credentials are rotated on
   the host.
2. Block the push if push protection caught it; do not bypass with
   `--force` style overrides without AG-0 sign-off.
3. Purge from history (`git filter-repo`), force-update, and confirm
   `gh api repos/.../secret-scanning/alerts` shows the alert resolved.
4. Record the incident in the private security tracker; do not put secret
   material in the repository.

## Where each secret actually lives

| Secret | Source of truth | How it reaches runtime |
|---|---|---|
| Telegram bot token | OpenBao | Injected as env into `apps/channels-listener` at deploy (CH-05) |
| VPS access credentials | Password manager / OpenBao | SSH config on operator machines only; never in-repo |
| `COPILOTKIT_TELEMETRY_DISABLED=true` | Deployment config | Not a secret, but deployment-only — set in server env, never hard-coded per CH-05 |
| Provider/model API keys | OpenBao / provider registry | Runner reads via the provider registry at runtime (SS-05); never baked into task definitions |

## Related

- `.github/workflows/secret-scan.yml` — gitleaks CI layer
- `docs/ops/RELEASE_CHECKLIST.md` — pre-merge secret attestation item
- Master plan §8B DEL-04, §11 (operational requirements for a safe release)
