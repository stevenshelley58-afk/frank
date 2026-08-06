---
name: frank-tdd
description: Red-green-refactor loop for Frank adapters and modules. Use when building features or fixing bugs test-first. Enforces failing-test-first, vertical slices, pre-agreed seams.
---

# Frank TDD

Red → Green. Refactoring is a separate review pass, not part of the loop.

## The loop

1. **Agree seams.** Name the public boundaries under test. Confirm with the user before writing any test. No test at an unconfirmed seam.
2. **Red.** Write one failing test at a seam.
3. **Green.** Write only enough code to pass it. No speculative features, no anticipating future tests.
4. **Repeat.** One seam → one test → one minimal implementation. Each test is a tracer bullet responding to what the last cycle taught.

Refactor after green, in a separate pass. Never inside the loop.

## What a good test is

- Verifies behavior through public interfaces, not implementation details
- Reads like a specification: "adapter starts a session and streams chunks"
- Survives refactors — doesn't care about internal structure
- One logical assertion per test
- Expected values from an independent source (literal, worked example, spec) — never recomputed the way the code computes it

## Anti-patterns to refuse

| Anti-pattern | Tell |
|---|---|
| **Implementation-coupled** — mocks internal collaborators, tests private methods, verifies through a side channel | Breaks on refactor without behavior change |
| **Tautological** — assertion recomputes expected value the way the code does | Passes by construction, can never disagree |
| **Horizontal slicing** — all tests first, then all implementation | Tests verify imagined behavior; commits to structure before understanding |

## Mocking rules

Mock at **system boundaries** only:
- External APIs (payment, email, provider endpoints)
- Databases (prefer a test DB)
- Time / randomness
- Filesystem (sometimes)

Never mock your own classes, modules, or internal collaborators.

Design for mockability: dependency injection over internal construction; SDK-style interfaces (one function per operation) over generic fetchers.

## Frank-specific seams

- `HarnessAdapter` interface methods (`startSession`, `sendMessage`, `switchModel`, `stopSession`, `status`)
- Room protocol boundaries
- Adapter public methods and their return types
- `ProviderConfig` / `StreamChunk` contract shapes

Tests live in `adapters/harness/<name>/` alongside source, run with vitest.

## Before starting

- Read `CONTEXT.md` (if it exists) so test names match the project's domain language
- Check ADRs in the area you're touching (especially ADR-008 for protocol decisions)
