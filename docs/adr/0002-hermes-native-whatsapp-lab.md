# ADR-0002: Hermes-Native WhatsApp Lab Runtime

## Status

Accepted

## Context

Frank Hub is running as a private VPS lab where the operator wants Frank to be
reachable from WhatsApp and to use Hermes as the privileged execution runtime.
The original foundation blocked all WhatsApp runtime wiring. That protected the
base system, but it now blocks the explicit lab goal.

Hermes already supports WhatsApp as a messaging gateway and persists its user
data under `/opt/data`. Frank can keep Hermes private on the Docker Compose
network while using Hermes' own WhatsApp bridge and webhook delivery.

## Decision

Allow WhatsApp runtime wiring only for the lab slice:

- provider: Hermes-native WhatsApp;
- runtime data: `/opt/frank-hub/runtime/hermes`;
- WhatsApp session path: `runtime/hermes/platforms/whatsapp/session`;
- gateway API and webhook ports: exposed only inside the Compose network;
- user access: `WHATSAPP_ALLOWED_USERS` must be configured;
- unauthorized direct messages should be ignored for a private Frank number;
- secrets stay in `runtime/access/frank-access.env` or Hermes' private data
  directory and are never committed.

Frank remains the system of record for tasks, self-upgrades, backups, deploys,
audit events, artifacts, and dashboard state. WhatsApp is a control and
notification channel, not a replacement for the dashboard.

## Consequences

Frank can notify the operator through WhatsApp and can later accept operator
commands there, while keeping Hermes private and auditable through Frank.

The WhatsApp session directory is effectively a credential and must remain in
protected paths. If the session is compromised, unlink Frank's WhatsApp linked
device and re-pair through `hermes whatsapp`.
