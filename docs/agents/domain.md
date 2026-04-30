# Domain Docs

Frank is a single-context repo for now. Agents should use one shared domain
language and one system-wide ADR directory.

## Read Order

Before large, ambiguous, architecture, or system work, read:

1. `AGENTS.md`
2. `CONTEXT.md`
3. Relevant files in `docs/adr/`
4. Relevant implementation docs under `docs/`

For small tasks, read the smallest set of docs needed to avoid violating
`AGENTS.md`.

## Decision Records

Create ADRs only for hard-to-reverse decisions, such as changes to runtime
architecture, deployment shape, access model, task lifecycle, persistence
strategy, or model-routing contracts.

Use short Markdown files in `docs/adr/` with a numbered filename and a clear
title, for example `0001-use-github-issues-for-agent-workflow.md`.

## Conflict Handling

If a user request contradicts `AGENTS.md`, surface the conflict and fail closed.
If a request contradicts an ADR, call out the ADR by filename and ask for an
explicit decision to supersede it before implementing.

When new domain terms are established through planning, update `CONTEXT.md`.
