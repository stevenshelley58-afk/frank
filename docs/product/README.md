# FRANK Product and Authority Index

This directory contains the specification, delivery plan, and supporting product documentation for FRANK.

## The specification

**File:** `FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` (also at `/root/.claude/uploads/...`)

This is the source of truth for every requirement, architectural principle, contract, and acceptance criterion. It is organized as:

- **§0–1:** How to use the spec; product charter and non-negotiable principles.
- **§2–4:** Functional requirements (users, work model, communication, finance, knowledge, UI, builders, operations).
- **§5–15:** System architecture and technical rules (failure domains, contracts, kernel, brokers, quality gates, deployment, observability).
- **§16–24:** Operations, supply chain, decisions, ADRs, and run contract.
- **§25–29:** Failure modes, white-label readiness, technology candidates, and the final build directive.

When in doubt, the specification is the authority. Changes must trace to a requirement ID, a section locator, or an ADR.

## The delivery plan

**File:** `/home/claude/FRANK_DELIVERY_PLAN.md`

Maps 15 workstreams onto 10 vertical slices, because workstreams describe dependencies, not build order. Each slice has:

- a defining outcome (one sentence a non-technical person can verify);
- spec coverage (workstreams, requirements, sections);
- frozen contracts (expensive to change after this slice);
- an exit gate (hard, demonstrable, binary);
- explicitly out-of-scope work.

The plan includes the **run contract** — seven fields every agent run must declare before starting (Slice, Requirement, Contract, Budget, Checkpoint, Evidence, Reviewer). It also includes the deferral register (what is intentionally deferred and why) and the failure modes to watch.

## The requirement registry

**Location:** `/docs/requirements/`

Files: `registry.json` (machine-readable) and `registry.md` (human-readable)

Generated from the specification by `tools/registry/generate-registry.mjs`. Every requirement and normative section locator becomes a record with:

- requirement ID or section locator (e.g., `UX-001`, `FRANK-§15.4`);
- owner (who is responsible for implementation);
- status (draft, in progress, done, deferred);
- implementation link (commit, PR, or code path);
- test or procedure (how to verify it);
- evidence artifact (where proof lives);
- acceptance criteria.

Run `pnpm run registry:generate` to regenerate from the specification. Run `pnpm run registry:check` to verify no requirements are unowned or missing traces.

## Architecture Decision Records

**Location:** `/docs/adr/`

Index: `README.md` (links all 20 accepted ADRs)

Each ADR covers one significant decision and includes context, alternatives considered, consequences, measured evidence, migration plan, owner, and review date. ADRs are immutable once accepted; future changes create new ADRs.

Key ADRs you'll see referenced:

- **ADR-001:** Kernel is independent of harness and model vendors.
- **ADR-003:** PostgreSQL and object storage are canonical; everything else is a projection.
- **ADR-005:** Temporal for durable workflows.
- **ADR-013:** Hardened microVM execution boundary for untrusted code.
- **ADR-019:** Source/assertion model for the second brain.

## How requirements, ADRs, and specs connect

1. **Specification** sets requirements (§4) and architectural rules (§5–15).
2. **ADR** clarifies *why* a specific technology or pattern was chosen (context, alternatives, exit triggers).
3. **Requirement registry** links each requirement to its owner, implementation, and test.
4. **Delivery plan** sequences workstreams into slices, each with exit gates.
5. **Code** traces back to a requirement ID or ADR in commit messages and tests.

A change without a trace to one of these does not merge.

## Running the gates

See `/README.md` for how to run `pnpm run verify` and its individual steps.

## Other documentation

- **Architecture:** `/docs/architecture/overview.md` — the durable centre, brokers, ports, and contracts.
- **Threat model:** `/docs/threat-model/` — security assumptions, risks, and mitigations.
- **Runbooks:** `/docs/runbooks/` — operational procedures for incidents, recovery, and deployments.

For questions about what to build or how something should work, consult the specification (§) and ADRs first. If you find an omission or conflict, open an issue and tag it `@question`.
