# ADR-001 — FRANK Kernel is independent of harness and model vendors

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §1.2.4, §7, §8.1 |

## Context

FRANK must support multiple AI agent harnesses and model providers while remaining the authoritative owner of goals, work, data, and evidence. If the kernel is built around a single vendor's agent loop, harnesses cannot be substituted without rewriting core identity and control.

## Decision

The Agent Kernel remains a permanent independent control plane that owns goals, work, policies, data, and evidence. Harnesses such as Goose, Hermes, Codex, Claude Code, and Qoder are pluggable workers constrained by bounded assignments and FRANK contracts.

## Alternatives considered

- Build FRANK around a single preferred harness as the primary orchestrator and kernel (rejected: creates unavoidable vendor lock-in)
- Make all harnesses equal service meshes with no privileged kernel (rejected: loses unified policy, evidence, and control)

## Consequences

- **Buys:** Model and harness freedom; no single provider outage affects the run record; policies are enforceable across any worker
- **Costs:** Additional adapter layer between harness and FRANK; harness-native schedulers and child-agent creation must be disabled; agents must request capabilities through FRANK contracts rather than invoke tools directly

## Measured evidence

§7.2 (agent profiles and capability scope) and §14.3 (adversarial review lattice) define the conformance suite that verifies harness isolation and kernel authority.

## Migration and exit trigger

Not reversible without reimplementing FRANK's fundamental authority. If a single harness becomes superior and standard, consider whether its design should inform FRANK's next generation; never embed it as the kernel.
