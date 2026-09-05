# Frank documentation

## Current guides

Start with the [root README](../README.md), then use
[DEVELOPMENT.md](DEVELOPMENT.md) for VPS verification and supported extensions.

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
- [CLEANUP-20260905.md](CLEANUP-20260905.md) records current cleanup evidence
  and explicitly deferred work.

## Historical material

The files in `evidence/`, `handoffs/`, and
`contracts/FRANK_HERMES_V021_CONTRACT.md` are dated evidence, migration
records, or point-in-time handoffs. They remain useful for provenance, but do
not override the current guides above. In particular, a historical module,
route, test count, probe result, or deployment statement is not a claim about
the current checkout or production state.

The vendored documentation under `apps/window/vendor/` belongs to its
upstream projects and is not Frank operational guidance.
