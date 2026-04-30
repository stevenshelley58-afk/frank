# Build Gates

Build gates classify work before implementation starts. They are process
guardrails for Codex, Hermes, and Frank operators; they are not runtime code.

## Small Task

Use for narrow, low-risk changes with obvious intent.

- Direct implementation is allowed.
- Keep edits scoped.
- Run the relevant checks for touched files.

## Medium Task

Use for bounded feature work or fixes with clear scope but non-trivial behavior.

- Write a short implementation plan.
- Use TDD where code changes are involved.
- Prefer one vertical tracer bullet before expanding coverage.
- Run typecheck, tests, and build when code paths are touched.

## Large Task

Use for broad features, multi-module changes, unclear requirements, or work
that spans dashboard, API, workers, infra, or model routing.

Workflow:

1. `grill-with-docs`
2. `to-prd`
3. `to-issues`
4. Implement vertical slices with `tdd`

Do not begin implementation until the work is split into independently
reviewable vertical slices.

## Architecture Or System Task

Use for hard-to-reverse design changes, runtime integration, deployment shape,
security boundaries, persistence contracts, model-routing contracts, or worker
execution semantics.

Workflow:

1. `grill-with-docs`
2. ADR for hard-to-reverse decisions
3. `to-prd`
4. Vertical-slice issues
5. TDD implementation

Stage-level Hermes integration is large architecture/system work and must use
this gate.

## Debug Failure

Use when builds fail, tests regress, production behavior breaks, or performance
regresses.

- Use `diagnose` before patching.
- Reproduce or characterize the failure.
- Minimize the failing surface.
- Add a regression test when code changes are required.

## Refactor

Use when changing structure without changing intended behavior.

- Use `zoom-out` first to understand the surrounding system.
- Keep changes incremental.
- Add or preserve tests through public interfaces.
- Avoid cosmetic churn that does not improve locality, depth, or testability.

## Post-large-merge

After large merges or repeated design friction, run
`improve-codebase-architecture` to find shallow modules, duplicate concepts,
weak boundaries, and testability problems.
