# ADR-008 — ACP for harness sessions, MCP for tools, A2A only at system boundaries

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §6.2, §8.1, §8.2 |

## Context

FRANK orchestrates multiple agents and services. Each communication pattern must be clear and auditable: agent-to-FRANK (ACP), FRANK-to-tools (MCP), and only at system boundaries does agent-to-agent (A2A) routing occur. Mixing protocols or allowing agents to bypass FRANK creates uncontrolled parallelism and defeats policy enforcement.

## Decision

Harness sessions use the Agent Control Protocol (ACP). Tools and connectors use the Model Context Protocol (MCP). A2A messaging occurs only at explicit system boundaries and remains auditable through FRANK.

## Alternatives considered

- All communication through one protocol (rejected: loses expressiveness and service-specific optimizations)
- Direct agent-to-tool access (rejected: bypasses policy, budgets, and audit)
- Buzz alone for agent coordination (rejected: Buzz is collaboration, not execution authority)

## Consequences

- **Buys:** Clear responsibility boundaries; policy enforcement before any tool access; auditable cross-harness coordination; replaceable harness and tool adapters
- **Costs:** Protocol specificity requires adapter development; FRANK remains in critical path for all tool calls; cannot optimize agent-to-tool latency without policy

## Measured evidence

§8 (harness and protocol architecture) and §6.2 (harness adapter) define conformance tests. §6.5 (capability and connector adapter) specifies MCP tool contracts. §21 (workstream 6) includes broker integration testing.

## Migration and exit trigger

Protocols are versioned contracts; implementations remain swappable. If ACP or MCP standards evolve, adopt new versions while maintaining backward compatibility through adapters.
