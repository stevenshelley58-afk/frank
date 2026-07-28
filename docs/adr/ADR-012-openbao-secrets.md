# ADR-012 — OpenBao machine secrets and opaque credential handles

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §15.3, §23.2 |

## Context

Agents must not receive raw provider keys or database passwords. OpenBao is an open, self-hosted secret store with policy, audit, dynamic-credential patterns, and short-lived token issuance. Agents receive opaque credential handles and FRANK brokers the actual credential through policy-gated operations.

## Decision

OpenBao is the machine-secret system with integrated Raft storage and KMS auto-unseal. Agents receive opaque credential handles; OpenBao issues short-lived derived credentials where providers support them. Long-lived keys remain scoped, broker-injected at the last moment, and rotated regularly.

## Alternatives considered

- Infisical (rejected: cloud-dependent for critical path; unclear open-source sustainability)
- SOPS only (rejected: loses dynamic credential and policy patterns)
- In-database secrets with encryption (rejected: loses separation of duty and key rotation)

## Consequences

- **Buys:** Centralized secret policy and audit; dynamic short-lived credentials where supported; scoped long-lived keys; secret rotation and revocation tracking; clear secret lifecycle
- **Costs:** Separate OpenBao deployment with HA and backup considerations; KMS dependency for auto-unseal; secret broker integration overhead

## Measured evidence

§15.3 specifies production requirements: Raft storage, KMS auto-unseal, offline recovery shares, boot order verification, and restart/restore conformance. §26 (required runbooks, RB-SEC-001) includes secret compromise and rotation drills.

## Migration and exit trigger

`SecretBroker` contract remains stable. If OpenBao operational burden exceeds benefits, adopt another secret-management platform while preserving handle-based access patterns and policy contracts.
