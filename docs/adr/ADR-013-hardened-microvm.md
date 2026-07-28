# ADR-013 — Hardened microVM execution for untrusted code plus privileged Ops envelopes

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §14.2, §15.4, §16.1 |

## Context

FRANK runs untrusted repositories, agent-generated code, and user-supplied scripts. A hardened microVM isolates execution from the control-plane kernel, providing a strong threat boundary. Privileged operations (deployments, secret rotation) use signed work envelopes audited by the Ops service, not direct shell access.

## Decision

Untrusted code runs in a hardened Firecracker microVM on a separate execution worker. Rootless containers are allowed only for trusted, pinned first-party jobs. Privileged operations use explicit signed work envelopes executed by the Ops service.

## Alternatives considered

- Rootless containers for all work (rejected: insufficient kernel boundary for untrusted code)
- Direct execution in the control plane (rejected: sandbox escape risks; compromised code affects FRANK)

## Consequences

- **Buys:** Strong kernel-level isolation for untrusted code; explicit privilege escalation through audited work envelopes; separate scaling for compute-intensive work; clear attack surface boundary
- **Costs:** MicroVM boot latency; agent-generated code cannot directly access VPS resources; image management and security updates required

## Measured evidence

§15.4 specifies containment requirements: CPU/memory/process/disk/duration limits, default-deny egress, no SSH or cloud credential access, read-only base images. §14.2 (build lifecycle, step 5) and § 26 (runbooks, RB-OPS-001) include sandbox-escape and containment-violation tests.

## Migration and exit trigger

Execution worker adapter remains stable. If Firecracker scaling becomes problematic, evaluate other microVM systems while keeping the same containment and isolation guarantees.
