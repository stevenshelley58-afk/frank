# Frank

## Purpose

Frank is the visual window onto Steven's VPS. It shows conversations, project
files, skills, traces, factory runs, and signed releases. Hermes is the only
agent runtime: Frank forwards requests to Hermes and renders the results.

## Boundaries

Frank may:

- display and submit Hermes conversations;
- browse explicitly exposed project files and shared skills;
- display deterministic traces and factory output;
- sign, publish, and deliver approved release artifacts;
- show project status assembled from authoritative project sources.

Frank must not:

- choose or call language models directly;
- load skills or run an independent agent loop;
- own a second memory store;
- duplicate project source, the shared vault, or Hermes state;
- treat previews, logs, caches, or build evidence as product source.

## VPS layout

| Responsibility | Authoritative path |
| --- | --- |
| Frank source | `/projects/frank` |
| Other project source | `/projects/<name>` |
| Shared knowledge | `/srv/vault` |
| Shared skills | `/srv/skills` |
| Hermes profiles and state | `/home/hermes/.hermes` |

The legacy `/frank/repo` and `/frank/deployed` trees are migration inputs only.
New work belongs in `/projects/frank` and must originate from Git.

## Repository shape

- `apps/`: user-facing applications and services
- `packages/`: shared product packages
- `adapters/`: boundaries to external services and storage
- `infra/`: checked-in deployment configuration
- `skills/`: Frank-specific skill definitions, not the shared VPS library
- `tools/` and `scripts/`: repository verification and release tooling
- `docs/`: durable architecture, contracts, and runbooks

Generated dependencies, build output, caches, previews, backups, release
evidence, databases, secrets, and local agent state are not source and must not
be committed or copied into the canonical project tree.

## Change and release contract

1. Start from the current default branch.
2. Keep one implementation and one durable document per responsibility.
3. Run `pnpm install --frozen-lockfile` when dependencies are needed.
4. Run `pnpm verify` and `pnpm build` before release.
5. Commit the exact revision being released.
6. Deploy through the checked-in preview and production workflow.
7. Keep persistent data and secrets outside the source checkout.

If an experiment is retained, give it an owner and expiry. Otherwise remove it
after 30 days.
