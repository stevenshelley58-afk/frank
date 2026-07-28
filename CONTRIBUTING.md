# Contributing to FRANK

This document outlines the rules and expectations for all contributors — human and agent — to the FRANK monorepo.

## Traceability

Every change must trace to exactly one of the following (FRANK-§0):

1. a requirement ID from the specification (e.g., `UX-001`, `BUILD-002`);
2. a normative section locator such as `FRANK-§15.4` when the change implements a cross-cutting rule or architectural principle;
3. an accepted Architecture Decision Record (e.g., `ADR-003`);
4. a GitHub issue derived from one of the above sources;
5. an incident, dependency update, or research finding whose impact record links back to the affected requirement.

A change without this trace does not merge. Use the `Requirement:` or `ADR:` trailer in your commit message and link the GitHub issue to an accepted ADR or requirement row.

## The agent-run operating model

Every bounded agent run declares — before it starts — all seven fields of the run contract (from the delivery plan's "Agent-run operating model" section):

| Field | Definition | Example |
|-------|-----------|---------|
| **Slice** | The delivery phase this work belongs to (0–8, T0) | Slice 1 |
| **Requirement** | A requirement ID or normative section locator | `FRANK-§15.4` or `BUILD-003` |
| **Contract** | Which `packages/contracts` schema it implements or consumes | `frank.screen/v1`, `frank.evidence/v1` |
| **Budget** | Hard currency + token ceiling; run aborts at ceiling, does not ask | 10 USD, 50k tokens |
| **Checkpoint** | A bounded unit after which state is durable | "All three calendar providers synced" |
| **Evidence** | The §14.4 evidence pack it must produce | A signed manifest with tests, checks, and evidence artifacts |
| **Reviewer** | A different model family than the builder | If builder is Claude Code, reviewer is Codex |

A run without all seven fields is not started. This is the machine-enforced version of FRANK-§0's traceability rule.

## Change control

### Breaking contract changes

Changes to schemas in `packages/contracts/` that break backward compatibility require:

1. an Architecture Decision Record (see `/docs/adr/`) explaining why and what alternatives were considered;
2. a migration path documenting how existing records transition;
3. compatibility tests proving old and new data coexist correctly;
4. a rollback procedure and evidence it has been tested.

### Third-party dependencies

A third-party package may not become a core dependency merely because an agent can install it (FRANK-§0.2). Dependencies must:

- have a clear maintenance owner and release cadence;
- pass security and supply-chain checks before entering `node_modules`;
- be pinned to exact versions in `pnpm-workspace.yaml` and `package.json` (see `.npmrc`);
- have a documented exit strategy and alternatives if they are in a critical path.

A free offer or promotional package entering the build does not automatically become core infrastructure.

### Generated code

Generated code — from agents, scaffolding tools, or code generators — is held to the same tests, review rules, provenance, and operational controls as human-written code. Every generated change needs:

- a schema or template that produced it (linked in commit message);
- the same unit and contract tests as hand-written code;
- evidence from a cross-model-family review (not the builder's model);
- traceability to a requirement or ADR.

Code produced by AI agents runs through the same evidence pack review process as human code changes (see `/docs/architecture/overview.md` on brokers and the build pipeline).

### Research and experiments

Research findings, benchmarks, and feature evaluations create tested branches and proposals; they do not silently alter production. An experiment that proves valuable is promoted through the normal evidence and review process, not merged directly.

## Dependency rules (FRANK-§17.2)

These rules are machine-enforced by `tools/lint/dependency-direction.mjs`:

- Apps depend on modules and shared packages, never on another app's internals.
- Domain modules do not import provider SDKs directly; they use adapters declared in `packages/contracts`.
- Adapters implement contracts declared in `packages/contracts`, not the other way around.
- UI modules receive API contracts and view models, not database clients.
- Cross-module state changes use declared domain services or typed events, never shared mutable stores.
- Skills cannot bypass tool policy or access credentials directly; they declare what they need, and the kernel brokers it.
- Packs compose modules and configuration; they do not fork core code.
- Infrastructure code does not contain secrets or credentials; those come from OpenBao.
- Circular dependencies fail CI immediately.

Violations fail the `deps:check` gate and block merge.

## Commit and PR expectations

### Before you open a change

- [ ] I have read the relevant section of the specification or the ADR this change traces to.
- [ ] I have updated `package.json` or touched a contract schema? I have added or updated tests and examples.
- [ ] This is a module or adapter change? I have verified dependency direction with `pnpm run deps:check`.
- [ ] This is a requirement implementation? I have added the trace to the commit message and linked the GitHub issue.
- [ ] This changes a schema or public API? I have an ADR or a requirement justifying the change, and a migration + tests if it breaks backward compatibility.
- [ ] I have run `pnpm run verify` locally and confirmed all gates pass.

### Commit messages

Use this format:

```
Brief imperative summary of the change.

Longer explanation if needed, describing the why and what.

Requirement: FRANK-§15.4
or
ADR: ADR-003
or
Requirement: BUILD-002

Fixes: #123 (if applicable)
Co-Authored-By: [Name] <[email]> (if collaborative)
```

Example:

```
Add field encryption for sensitive data in WorkItem.

Sensitive health and finance records are now encrypted at rest using
the per-cell envelope key, with blind indexes for searchable fields.
This satisfies the §15.7 requirement and lands in Slice 1 per the
delivery plan.

Requirement: FRANK-§15.7
Fixes: #42
```

### Pull requests

- Keep PRs small — one requirement or one contract, not one module.
- If your PR touches more than one `modules/` directory, split it.
- If your diff exceeds what a fresh-context reviewer can hold in one pass, split it.
- Link the GitHub issue to the requirement or ADR; GitHub will auto-link them if you use `Fixes: #123` in the description.
- Include evidence of testing: test output, screenshots for UI changes, benchmark results for performance changes.
- Do not merge your own PR; ask for a review from someone else.

### What passes CI

The `verify` workflow requires:

1. **Dependency direction** — no circular imports, correct cross-module boundaries.
2. **Contract validation** — every schema example validates against its schema definition.
3. **Requirement registry** — every requirement ID and section locator is owned and linked.
4. **Typecheck** — TypeScript strict mode.
5. **Tests** — unit and contract tests pass.

A red CI status blocks merge, even if the change "looks good." Fix the failures before asking for review.

## Helpful links

- **Specification:** `/docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` (also at `/root/.claude/uploads/...`)
- **Delivery Plan:** `/home/claude/FRANK_DELIVERY_PLAN.md`
- **ADRs:** `/docs/adr/` (index in `README.md`)
- **Requirements:** `/docs/requirements/registry.json` (generated from the spec)
- **Architecture:** `/docs/architecture/overview.md` (durable centre, brokers, ports)

## Questions?

If a requirement is unclear, an ADR is missing, or the gate is blocking valid work, open an issue and tag it `@question`. The product owner reviews and clarifies.
