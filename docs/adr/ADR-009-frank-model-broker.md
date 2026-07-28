# ADR-009 — FRANK Model Broker above LiteLLM

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §9, §23.2 |

## Context

Multiple model providers exist with different APIs, pricing, regional availability, and privacy terms. LiteLLM normalizes provider APIs but remains a transport layer. FRANK must add policy routing, quality evaluation, cost accounting, privacy enforcement, and fallback logic on top of any gateway.

## Decision

FRANK Model Broker owns routing logic, capability requirements, data-class eligibility, quality gates, cost optimization, and fallback chains. LiteLLM handles provider API normalization and key management behind the `ModelProviderAdapter` contract.

## Alternatives considered

- Direct LiteLLM usage without wrapping (rejected: loses FRANK policy control and evaluation routing)
- Custom provider adapters only (rejected: duplicate low-level API work and key rotation)

## Consequences

- **Buys:** Provider-independent policy enforcement; quality-floor and privacy gates before model selection; transparent cost accounting; seamless fallback without losing request context
- **Costs:** Added routing layer and latency; cost tracking complexity; must evaluate model changes before promotion

## Measured evidence

§9.3 (route score) and §9.4 (provider pools) define the routing algorithm and eligibility rules. §9.6 (promotion and rollback) and §21 (workstream 6) include conformance tests for model promotion, health probing, and fallback chains.

## Migration and exit trigger

LiteLLM remains replaceable through the `ModelProviderAdapter` contract. If LiteLLM maintenance burden increases, adopt another gateway while keeping FRANK's routing policy stable. Provider pools and eligibility rules remain independent of gateway choice.
