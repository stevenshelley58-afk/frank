# Frank documentation

## Current guides

Read the canonical rulebook at
[`/projects/blockwise/AGENTS.md`](/projects/blockwise/AGENTS.md) and the
[Frank project rules](../AGENTS.md) first. This is the sole current Frank
documentation index. Worktree snapshots and dated records do not override it.

Start with the [root README](../README.md), then use
[DEVELOPMENT.md](DEVELOPMENT.md) for VPS verification and supported extensions.

- [Ad Template Generator](AD_TEMPLATE_GENERATOR.md) owns the cross-system
  operator workflow and acceptance policy.
- [PROJECT.md](PROJECT.md) defines the Window, Hermes, project, and Mini
  deployment-versus-product boundary.
- [MEMORY.md](MEMORY.md) defines durable-memory ownership and distinguishes
  intended shared-industry knowledge from the currently available adapter.
- [tool-app-platform.md](tool-app-platform.md) defines discoverable Tools,
  widgets, and read-only graph projections.
- [FRANK_AGENTTRAIL_ARCHIFY.md](FRANK_AGENTTRAIL_ARCHIFY.md),
  [VAULT_BROKER.md](VAULT_BROKER.md), and
  [CONNECTIONS_AGENT_CONTRACT.md](CONNECTIONS_AGENT_CONTRACT.md) are current
  integration and operator contracts.
- [OPS_CONSOLE.md](OPS_CONSOLE.md) and
  [FRANK_RELEASE_RUNBOOK.md](FRANK_RELEASE_RUNBOOK.md) are current operator and
  release guides.
- [apps/window/DESIGN.md](../apps/window/DESIGN.md) is the current Window
  design contract; [apps/window/infra](../apps/window/infra) and each
  non-vendored Tool README contain component-specific runbooks.
- [CLEANUP-20260905.md](CLEANUP-20260905.md) records dated cleanup evidence
  and explicitly deferred work.

- [Owner CRM integration](OWNER_CRM.md) records the owner-only CRM boundary,
  private Ad Radar contact handoff and remaining activation gates.

## Historical material

The files in `evidence/`, `handoffs/`, and
`contracts/FRANK_HERMES_V021_CONTRACT.md` are dated evidence, migration
records, or point-in-time handoffs. They remain useful for provenance, but do
not override the current guides above. In particular, a historical module,
route, test count, probe result, or deployment statement is not a claim about
the current checkout or production state.

The vendored documentation under `apps/window/vendor/` belongs to its
upstream projects and is not Frank operational guidance.

## Owner CRM private foundations

[Owner CRM contract](OWNER_CRM.md) records the owner/customer boundary and
remaining activation gates. Component runbooks: [native CRM and Helpdesk](../apps/window/infra/owner_crm/README.md),
[native field setup](../apps/window/infra/owner_crm_setup/README.md),
[private Mautic](../apps/window/infra/owner_marketing/README.md), and
[private ntfy](../apps/window/infra/owner_notifications/README.md), and
[native CRM alert hooks](../apps/window/infra/owner_crm_notifications/README.md).
These are private foundations, not a completed customer-lifecycle acceptance.
