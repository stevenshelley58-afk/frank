# Release Checklist — FRANK

Run this checklist on every branch before it merges to `main`, and in full
before any release tag. Owner: the merging agent or human. Every item needs
evidence, not a mental check.

## 1. Secrets attestation (DEL-04) — REQUIRED, every branch

- [ ] **No bot token, VPS secret, or environment file entered the branch.**
      Prove it with commands, then paste the empty/negative results into the
      PR or issue comment:

      ```bash
      # a) gitleaks over the full history of the branch (CI also runs this —
      #    confirm the secret-scan check is green on the branch)
      gh run list -b <branch> -w secret-scan --limit 1

      # b) grep for common secret shapes in files the branch changed
      git diff --name-only main...HEAD | xargs -r grep -nIE \
        '([0-9]+:AA[A-Za-z0-9_-]{33}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' || echo CLEAN

      # c) confirm no env/credentials files were added by the branch
      git diff --name-only --diff-filter=A main...HEAD | grep -E '\.env(\..+)?$|id_(rsa|ed25519)|credentials' || echo CLEAN
      ```

- [ ] GitHub push protection reported no blocked pushes for this branch
      (`gh api repos/stevenshelley58-afk/frank/secret-scanning/alerts` —
      no open alerts attributable to the branch).
- [ ] Any secret the feature needs enters via OpenBao/env at deploy time
      (see `docs/ops/SECRET_HANDLING.md`) — never from a committed file.

## 2. Code gates — REQUIRED, every branch

- [ ] `pnpm run verify` green on the branch (deps:check → contracts:validate
      → env:validate → registry:check → turbo typecheck/lint/test).
- [ ] GitHub `verify` workflow green for the branch tip.
- [ ] Dependency direction respected: contracts import nothing from apps or
      adapters; adapters depend on contracts only.
- [ ] No changes outside the task's allowed paths (per the task's GitHub
      issue) without AG-0 approval recorded in the PR description.

## 3. Preview evidence (DEL-01/DEL-02) — REQUIRED for user-visible changes

- [ ] Deployed to `https://preview.frank.fail/<slug>/` and verified in Chrome
      per `skills/engineering/verify-preview/SKILL.md`.
- [ ] Screenshots/GIF evidence stored under the versioned slug convention and
      linked in the PR.
- [ ] No console errors or failed network requests in the verified path.

## 4. Release-only additions — REQUIRED before tagging a release

- [ ] Release manifest updated (GOV-05): task status, branch, commit, CI,
      preview, gate per merged task.
- [ ] `docs/plans/EXECUTION_STATUS.md` reflects merged work and gate state.
- [ ] Human-gated items (e.g., Telegram bot token) confirmed injected via
      OpenBao/env in the target environment — not present anywhere in the
      repository.
- [ ] Merge happened by dependency order (GOV-05), not finish order.

## If any item fails

Stop the merge. Fix or escalate per the task's issue. Do not force-merge a
branch with a red secret scan or an unproven secrets attestation.
