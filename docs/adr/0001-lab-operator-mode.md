# ADR-0001: Lab Operator Mode For Frank

## Status

Accepted

## Context

Frank Hub is currently running as a private VPS test system. The goal is for
Frank and its agents to do as much useful development and operations work as
possible from the VPS, including working on Frank itself.

The earlier foundation denied host and destructive work by default. That is too
restrictive for the current lab goal. The remaining hard constraints are still
important: secrets must not be committed or exposed, backups must be protected,
and irreversible infrastructure damage must stay blocked.

## Decision

Frank supports an operator mode:

- `lab`: broad write, host, and development work is allowed outside protected
  paths.
- `guarded`: writes require approval; destructive and unrestricted host work are
  denied.
- `production`: conservative posture for future locked-down operation.

The lab allowlist includes the Frank repo workspace, task workspaces, and
project workspaces. Protected paths remain denied even in lab mode.

Frank access credentials are configured through a VPS-only env file at
`runtime/access/frank-access.env`. The dashboard exposes only a redacted access
summary.

## Consequences

Frank can become self-referential: agents can run against `/opt/frank-hub`, edit
the repo, run checks, and prepare self-upgrade changes.

The VPS remains a high-trust runtime. Operators must keep backups outside the
repo and treat Hermes as privileged infrastructure.

WhatsApp, mobile, email, and API credentials can be registered now. WhatsApp
runtime wiring is allowed only through the Hermes-native lab slice in ADR-0002;
mobile and email runtime integrations remain future work.
