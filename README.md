# FRANK — Personal Operating System

FRANK is Steven's private, always-on personal operating system for life administration, knowledge, communication, software creation, research, automation, and continuous improvement. It is not a skin over Hermes, Goose, Codex, Claude Code, Qoder, Buzz, Cognee, LiteLLM, or any single model provider. FRANK is a durable kernel with replaceable AI agents, models, and tools plugged into stable data contracts.

**Status:** Slice 0 in progress. No services are running yet. This is the repository authority and skeleton phase — contracts validate, CI enforces dependency rules, and environment definitions are in place.

## What's in this repository

```
frank/
├─ apps/              # Next.js web, Fastify API, workers, Tauri shell, extension, operator console
├─ packages/          # Shared contracts, domain types, design system, auth, observability, SDK, testkit
├─ modules/           # Domain-specific services: today, work, brain, calendar, email, etc.
├─ adapters/          # Provider integrations: harnesses, models, connectors, memory, storage, workflow, deployment
├─ skills/            # Versioned instruction and workflow packages
├─ packs/             # Customer and industry packs (configuration, not forked code)
├─ infra/             # Infrastructure as code: docker-compose, Caddy, observability, backup, recovery
├─ docs/              # Specification, ADRs, requirements, architecture, threat models, runbooks
├─ evals/             # Evaluation datasets and benchmarks
├─ tests/             # End-to-end and integration tests
└─ tools/             # Registry generation, dependency checking, validation
```

## How to run the gates

All gates are integrated into one command:

```bash
pnpm run verify
```

This runs in sequence:

1. **Dependency direction** — `pnpm run deps:check` — validates that apps depend on modules and packages (not other apps), and that circular dependencies are rejected.
2. **Contract validation** — `pnpm run contracts:validate` — ensures every schema in `packages/contracts` has valid examples.
3. **Requirement registry** — `pnpm run registry:check` — confirms every requirement ID and normative section locator has an owner and implementation link.
4. **Typecheck** — `pnpm run typecheck` — TypeScript strict mode across the workspace.
5. **Lint and test** — `pnpm run lint` and `pnpm run test` — style, format, and unit/contract tests via Turbo.

Each tool can also be run individually. See `package.json` scripts for details.

## Where the authority lives

The specification is the source of truth for what FRANK is and does. The delivery plan sequences workstreams into slices. Architecture Decision Records explain why specific technologies and patterns were chosen.

When instructions conflict, this precedence applies (§0.1):

1. safety, privacy, and legal obligations;
2. Steven's current explicit instruction;
3. **the FRANK Complete Build Plan and System Specification** — `/docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`;
4. **Architecture Decision Records** — `/docs/adr/` (20 accepted ADRs covering kernel, storage, workflow, APIs, clients, protocols, secrets, execution, evidence, and customer cells);
5. repository runbooks in `/docs/runbooks/`;
6. implementation details and third-party defaults.

The **requirement registry** — `/docs/requirements/registry.json` and `.md` — is generated from the specification and contains every requirement ID (`UX-001`, `WORK-002`, etc.) and normative section locator (`FRANK-§15.4`) with owner, implementation status, test, and evidence links.

**FRANK-§0.2 change control:** breaking contract changes require an ADR, migration, compatibility tests, and rollback path. Generated code is held to the same standard as hand-written code. All current product behaviour must be discoverable from the requirement catalogue, not from tribal knowledge.
