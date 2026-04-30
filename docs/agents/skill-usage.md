# Skill Usage

Frank uses Matt Pocock's engineering skills as process guidance for Codex,
Hermes, and operator workflows. Do not vendor third-party skill content into
the product and do not install packages automatically from these docs.

Pinned source for review:
`https://github.com/mattpocock/skills/tree/f71bb975bfae2dc0d31c529c7dd4a8479ecc3748`

## Primary Chain

`grill-with-docs -> to-prd -> to-issues -> tdd -> diagnose -> improve-codebase-architecture`

Use the full chain for large architecture/system work. Use the smallest
applicable part of the chain for smaller tasks.

## First-class Skills

- `setup-matt-pocock-skills`: configure issue tracker, triage labels, and
  domain docs.
- `grill-with-docs`: stress-test ambiguous plans against project language,
  code, and decisions.
- `to-prd`: turn settled context into a PRD issue.
- `to-issues`: split PRDs or plans into vertical-slice GitHub Issues.
- `tdd`: implement features and fixes through red-green-refactor loops.
- `diagnose`: debug failures through reproduce, minimize, hypothesize,
  instrument, fix, and regression-test.
- `zoom-out`: understand a code area in its wider system context before
  refactoring or changing behavior.
- `improve-codebase-architecture`: review architecture after large merges or
  when the codebase shows repeated design friction.

## Deferred Or Optional Skills

- `git-guardrails-claude-code`: later; useful for Claude Code local hooks, not
  Frank runtime.
- `setup-pre-commit`: later; consider only after deciding repository hook
  policy.
- `caveman`: optional communication mode for shorter output with the same
  technical meaning.
- `obsidian-vault`: out of normal Frank workflow.
- `migrate-to-shoehorn`: out of normal Frank workflow unless test fixtures
  adopt `@total-typescript/shoehorn`.
- `scaffold-exercises`: out of normal Frank workflow.

## Install Guidance

If skills are installed manually, prefer a pinned commit or reviewed archive
over floating `@latest` commands. Never add an automatic `npx skills@latest`
script to this repository.
