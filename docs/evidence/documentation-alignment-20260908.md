# Documentation alignment audit (8 September 2026)

This is dated coverage/evidence, not a second current documentation index.
Use [the maintained index](../README.md) for current authority.

Three Luna reviewers inventoried Frank and Blockwise and checked the generator
integration. Parent review corrected a stale branch selection, inaccurate score
aliases and hard-coded runtime paths. Authority/consistency review is not
certification of every product feature, customer-guide claim or historical fact.

Frank's pre-change first-party tracked Markdown/RST/TXT inventory was 81 files:
27 current/component references, 33 references, 19 historical records/proposals
and 2 fixtures. Third-party vendored material was excluded. Unrelated uncommitted
source and documents, including MINI_FRANK.md and DEVELOPMENT.md, were preserved.

Global/bootstrap and installed skill entry points now route to the shared
rulebook and current project indexes. Prior copies are retained in restricted
configuration backups outside active instruction discovery. The stale Frank
Git core.worktree override was backed up and removed; canonical path resolution
was verified without resetting the index or changing source.

Template policy is owned by AD_TEMPLATE_GENERATOR.md. Documentation alignment
does not deploy the paused quality-gate changes or approve templates.
No application release or provider operation was performed for this audit.

## Pre-change file inventory

### Current/component reference

- AGENTS.md
- README.md
- apps/window/DESIGN.md
- apps/window/graph/ASSEMBLY.md
- apps/window/infra/hermes_connections/README.md
- apps/window/infra/infisical/README.md
- apps/window/infra/knowledge/README.md
- apps/window/infra/memory/README.md
- apps/window/infra/runtime_monitoring/README.md
- apps/window/tools/REUSE.md
- apps/window/tools/ad-intelligence/README.md
- apps/window/tools/content-factory/README.md
- apps/window/tools/mail/README.md
- apps/window/tools/outreach/README.md
- apps/window/tools/prospect-discovery/README.md
- apps/window/web/mini/mini_api.md
- docs/AD_TEMPLATE_GENERATOR_NAMING.md
- docs/CONNECTIONS_AGENT_CONTRACT.md
- docs/DEVELOPMENT.md
- docs/FRANK_AGENTTRAIL_ARCHIFY.md
- docs/FRANK_RELEASE_RUNBOOK.md
- docs/MEMORY.md
- docs/OPS_CONSOLE.md
- docs/PROJECT.md
- docs/README.md
- docs/VAULT_BROKER.md
- docs/tool-app-platform.md

### Reference

- apps/window/infra/knowledge/project-seeds/mini-frank/README.md
- apps/window/infra/knowledge/project-seeds/mini-frank/build-kit/README.md
- apps/window/infra/knowledge/project-seeds/mini-frank/build-kit/licenses/README.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/build/architectures/native-batch-knowledge.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/build/architectures/responsive-small-business-dashboard.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/build/repositories/shadcn-ui.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/build/ui-patterns/isolated-failure-states.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/build/ui-patterns/mobile-first-dashboard.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/feedback/README.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/governance/derived-views-only.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/governance/hermes-owns-execution.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/governance/one-frank.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/governance/private-context-boundary.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/governance/project-isolation.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/index.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/intersections/README.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l0-craft/evidence-and-provenance.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l0-craft/focused-repair.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l0-craft/reuse-before-build.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l0-craft/sanitise-before-release.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l1-platform/hindsight-memory-boundary.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l2-pattern/gate-external-actions.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l2-pattern/public-data-not-consent.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/layers/l3-vertical/australian-real-estate-creative-intake.md
- apps/window/infra/knowledge/project-seeds/mini-frank/knowledge/templates/knowledge-page.md
- apps/window/requirements-acceptance.txt
- apps/window/requirements.txt
- apps/window/tools/ad-intelligence/migration_map.md
- docs/specs/shared-graph-trace-contract.md
- governance/control-plane/decisions/open-source-register.md
- governance/control-plane/decisions/oss-catalog-decision.md
- governance/control-plane/decisions/research-sources.md
- governance/control-plane/decisions/runtime-observability-decision.md

### Historical

- docs/CLEANUP-20260905.md
- docs/contracts/FRANK_HERMES_V021_CONTRACT.md
- docs/evidence/frank-v021/BACKUP_AND_ROLLBACK.md
- docs/evidence/frank-v021/ESTATE_ROLLOUT_AND_CANARY.md
- docs/evidence/frank-v021/HERMES_V021_PROBES.md
- docs/evidence/frank-v021/HOST_ATTACHMENT_BINDS.md
- docs/evidence/frank-v021/MIGRATION_REHEARSAL.md
- docs/evidence/frank-v021/PRODUCTION_BASELINE.md
- docs/evidence/frank-v021/WORKSPACE_INVENTORY.md
- docs/handoffs/S5_S2_WAKEUP.md
- docs/handoffs/frank-v021-codex-vps-runbook.md
- docs/handoffs/frank-v021-contract-mismatch.md
- docs/handoffs/frank-v021-foundation.md
- docs/handoffs/frank-v021-hermes-adapter-mismatch.md
- docs/handoffs/frank-v021-hub-functional.md
- docs/handoffs/frank-v021-shared-estate.md
- docs/handoffs/frank-v021-work-routines.md
- docs/superpowers/plans/2026-09-07-ad-template-generator.md
- docs/superpowers/specs/2026-09-07-ad-template-generator-design.md

### Fixture

- docs/contracts/fixtures/canonical-fixture-checksums.txt
- docs/contracts/fixtures/tool-runs-404.txt

## Provenance repair addendum

The consolidated AGENTS.md rules changed its normalized UTF-8 SHA-256
fingerprint. The Frank agent-rules source manifest now records the observed
digest and verification date. No integrity check was bypassed; the focused
Mini Frank knowledge verification passed all 4 tests.
