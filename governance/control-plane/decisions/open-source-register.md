# Frank Control Plane — Mandatory Open-Source Register

**Status:** Required input to the Frank control-plane build plan  
**Reviewed:** 2026-08-30  
**Rule:** Search, reuse, adopt or adapt maintained open source before writing a new capability. Custom work is limited to the smallest Frank-specific gap and needs an evidence-backed decision receipt.

---

## 1. The rule Codex must follow

Before creating a new service, daemon, dashboard, catalog, graph/store, agent framework, monitor, evaluator, cleanup tool, skill/plugin manager, discovery index, workflow engine or substantial adapter, the assigned agent must:

1. Search the canonical Frank/Blockwise/Hermes sources and installed capabilities first.
2. Inspect every required source in the relevant row of Section 3.
3. Run at least three bounded GitHub REST searches and retain the query/result receipt.
4. Compare at least three viable candidates when three exist. If fewer exist, record the searches proving that.
5. Inspect the exact candidate revision, licence, latest release, recent maintenance, open issues relevant to the use case, runtime/dependency cost, data model, export/removal path and overlap with the current stack.
6. Check package/dependency evidence with deps.dev, repository practices with OpenSSF Scorecard and known vulnerabilities with OSV where applicable.
7. Choose `reuse_existing`, `adopt`, `adapt`, `compose`, `reject` or `custom_gap`.
8. Create an OSS decision receipt and put its ID in the implementation commit/PR. No receipt means no implementation or merge.

Searching the web is unnecessary for a tiny pure helper that is clearly product-specific and can be written with the language standard library. It is mandatory for a new dependency, externally visible feature, reusable subsystem or anything that could become another competing product/version.

### Mandatory decision receipt

```yaml
id: receipt:oss-decision/<scope>/<slug>
need:
must_have: []
existing_local_solution:
search_queries: []
candidates:
  - name:
    source_url:
    source_revision:
    licence:
    latest_release:
    last_material_activity:
    maintenance_evidence:
    fit:
    gaps: []
    runtime_cost:
    integration_cost:
    overlaps: []
    export_removal_path:
    dependency_health_receipts: []
decision: reuse_existing | adopt | adapt | compose | reject | custom_gap
selected_candidate:
custom_gap:
  why_oss_does_not_cover_it:
  owned_files: []
  estimated_surface:
rollback_removal_path:
reviewed_at:
reviewer:
```

`custom_gap` is not permission to recreate the rejected product. It means a thin source adapter, stable-ID mapping, receipt conversion or Frank-specific presentation seam around the selected upstream authority.

---

## 2. Starting decisions

These are the default decisions unless current VPS/repository evidence disproves them:

| Need | Starting decision |
|---|---|
| Live coding-agent activity | **Adopt AgentTrail.** Embed the pinned real board; do not rebuild it. |
| Architecture/workflow diagrams | **Adopt Archify.** Generate typed validated projections; do not rebuild its viewer. |
| Frank operator shell and inspectors | **Reuse existing Frank Window and design system.** Custom code is only Frank-specific integration/presentation. |
| Catalog/source-of-truth product | **Do not deploy another portal/database initially.** Adapt useful open schemas/patterns into versioned Frank declarations and receipts. |
| Runtime monitoring | **Reuse whatever is already healthy on the VPS.** If absent, compare Beszel with the minimum Grafana/Prometheus/Loki/Alloy/OpenTelemetry composition before installation. |
| Rules and skills | **Reuse canonical Codex, Claude and Hermes skill formats/sources.** Catalogue pointers and hashes; do not invent a competing skills database or auto-install feeds. |
| Cleanup | **Adopt language-specific OSS reporters.** Report first; never infer deletion from one tool. |
| Evaluations | **Adopt Promptfoo unless a current installed evaluator already covers the exact contract.** |
| OSS/MCP discovery | **Use public metadata APIs and registries.** Store metadata links/snapshots, not repository mirrors. |
| Agent workflow packs | **Evaluate gstack, Brooklyn skills and Steven’s existing skills individually.** Import useful skills/patterns; do not install a monolithic competing workflow blindly. |
| Model routing/cost control | **Keep Hermes authoritative.** Evaluate LiteLLM only if Step 0 proves a routing/accounting gap; do not add a second brain. |

---

## 3. Sources Codex must inspect

### A. Already selected upstream products

| Source | Use |
|---|---|
| [AgentTrail](https://github.com/sodiumsun/agenttrail) | Live agent plans, file activity and progress. MIT; upstream says it observes rather than controls agents. |
| [Archify](https://github.com/tt-a1i/archify) | Deterministic architecture, workflow, sequence, data-flow and lifecycle artifacts. MIT; preserve its typed IR, checks and viewer. |

### B. Catalog, topology and source-of-truth patterns

These are comparison inputs. They are not automatic installation instructions.

| Source | What to evaluate | Default posture |
|---|---|---|
| [Backstage](https://github.com/backstage/backstage) and its [Software Catalog model](https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/index.md) | Git-owned metadata, entity ownership, relationships and templates | Adapt schema/ownership ideas; avoid deploying a second developer portal unless the small Frank model fails measured needs. |
| [NetBox](https://github.com/netbox-community/netbox) | Infrastructure source-of-truth concepts and relationship modelling | Evaluate data model; likely too network/DCIM-heavy for this single VPS. |
| [OpenMetadata Standards](https://github.com/open-metadata/OpenMetadataStandards) | JSON Schema, provenance, lineage and typed relationships | Adapt relevant schema/provenance concepts without deploying the full OpenMetadata platform. |
| [Cartography](https://github.com/cartography-cncf/cartography) | Infrastructure asset/relationship collection | Study collector/adaptor patterns; reject initial deployment because it requires a competing Neo4j graph store. |

### C. Runtime monitoring and telemetry

Use the existing healthy VPS provider first. Only compare/install a fallback when Step 0 proves a gap.

| Source | Appropriate use |
|---|---|
| [Beszel](https://github.com/henrygd/beszel) | Lightweight single/multi-server and container health, history and alerts. Strong first fallback for a dedicated VPS. |
| [Grafana](https://github.com/grafana/grafana) | Existing/full observability UI when already installed or genuinely required. |
| [Prometheus](https://github.com/prometheus/prometheus) | Metrics collection/querying. |
| [Grafana Alloy](https://github.com/grafana/alloy) | OpenTelemetry-compatible collection pipeline for logs, metrics, traces and profiles. |
| [Grafana Loki](https://github.com/grafana/loki) | Log aggregation when persistent searchable logs are required. |
| [OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector) | Vendor-neutral telemetry collection when current services emit OTel. |

Do not install the whole Grafana stack merely because it is popular. Pick the smallest composition that fills evidence gaps, and deep-link from Frank rather than cloning dashboards.

### D. Rules, skills, plugins and MCP sources

| Source | Use |
|---|---|
| [Official OpenAI skills catalog](https://github.com/openai/skills) | Canonical Codex skill examples and curated/system skill source. |
| [Codex AGENTS.md documentation](https://developers.openai.com/codex/agent-configuration/agents-md) | Instruction discovery, scope and precedence. |
| [Codex skill documentation](https://developers.openai.com/codex/build-skills) | Current skill structure and invocation behaviour. |
| [Anthropic skills repository](https://github.com/anthropics/skills) | Canonical Claude skill examples. |
| [OpenAI plugin documentation](https://developers.openai.com/plugins) | Current plugin packaging, capabilities and distribution guidance. |
| [Claude project-memory documentation](https://code.claude.com/docs/en/memory) | CLAUDE.md discovery, imports and scope. |
| [Claude skills documentation](https://code.claude.com/docs/en/skills) | Current Claude skill discovery and invocation. |
| [Claude plugin documentation](https://code.claude.com/docs/en/plugins), [plugin discovery](https://code.claude.com/docs/en/discover-plugins) and [plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) | Plugin composition, discovery and private/public marketplace patterns. |
| [Hermes skills documentation](https://hermes-agent.nousresearch.com/docs/skills) | Hermes skill format and lifecycle. Hermes remains runtime authority. |
| [Official MCP Registry](https://github.com/modelcontextprotocol/registry) and [live Registry API documentation](https://registry.modelcontextprotocol.io/docs) | Read-only MCP metadata discovery; never treat listing as approval. |
| [Brooklyn skills](https://github.com/OutThisLife/brooklyn-skills) | Engineering-skill candidates and patterns. Review one skill at a time. |
| [gstack](https://github.com/garrytan/gstack) | Opinionated agent workflow/role patterns. Extract useful bounded workflows rather than creating another orchestrator. |
| [refactoring-ui plugin](https://github.com/gnurio/refactoring-ui-plugin) | UI review skill candidates. Check its licence and source material rights at the pinned revision before use. |
| Steven’s existing `grilling` and custom skills | Canonical local/VPS sources discovered in Step 0/2. Prefer repairing/consolidating these over downloading duplicates. |

### E. Code cleanliness, dependency health and old-version removal

| Source | Use |
|---|---|
| [Knip](https://github.com/webpro-nl/knip) | Unused JavaScript/TypeScript files, exports and dependencies. |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | Dependency rules, cycles, orphans and visual reports for JS/TS. |
| [jscpd](https://github.com/kucherenko/jscpd) | Copy/paste and duplicate-code candidates across languages. |
| [Vulture](https://github.com/jendrikseipp/vulture) | Dead Python-code candidates with confidence values. |
| [Renovate](https://github.com/renovatebot/renovate) | Bounded dependency-update proposals where it fits the existing Git workflow. |
| [OSV-Scanner](https://github.com/google/osv-scanner) | Known dependency/container vulnerabilities and guided remediation evidence. |
| [jscodeshift](https://github.com/facebook/jscodeshift), [ts-morph](https://github.com/dsherret/ts-morph) and [LibCST](https://github.com/Instagram/LibCST) | Candidate engines for narrowly scoped, reviewable JavaScript/TypeScript/Python codemods. Never run broad automatic rewrites merely because a reporter found debt. |

Each tool produces a candidate. A source path is retired only after reference/runtime evidence, replacement confirmation, focused tests and a recoverable commit.

### F. Evaluations, dependency research and discovery feeds

| Source | Use |
|---|---|
| [Promptfoo](https://github.com/promptfoo/promptfoo) | Fresh-context rule/skill/agent golden evaluations and JSON/CSV/HTML receipts. |
| [GitHub repository search API](https://docs.github.com/en/rest/search/search#search-repositories), [repository metadata API](https://docs.github.com/en/rest/repos/repos) and [GitHub Trending](https://github.com/trending) | Current repository metadata and bounded discovery leads. Use versioned API requests; trending is never approval. |
| [deps.dev API](https://docs.deps.dev/api/) and [source](https://github.com/google/deps.dev) | Package versions, licences, dependency graphs, advisories and project associations. |
| [OpenSSF Scorecard](https://scorecard.dev/) and [source](https://github.com/ossf/scorecard) | Repository maintenance/security-practice evidence. Use individual checks, not the aggregate score as approval. |
| [OSV service](https://osv.dev/), [OSV source](https://github.com/google/osv.dev) and [OSV-Scanner documentation](https://google.github.io/osv-scanner/) | Open vulnerability/advisory data and scanning evidence. |
| [Official MCP Registry API](https://registry.modelcontextprotocol.io/docs) and [API source](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md) | MCP server metadata and exact versions. |

Trending/star counts are discovery signals only. Approval needs fit, licence, maintenance, exact revision, dependency and removal evidence.

---

## 4. Merge-blocking enforcement

The control-plane build is incomplete unless:

- `build-context.yaml` names this register’s hash and review date;
- every non-trivial custom component has an `oss_decision_id`;
- CI rejects an implementation record whose decision receipt is missing, stale, schema-invalid or does not name exact source revisions;
- the PR/release receipt lists upstream packages reused, added, removed and rejected;
- custom code declares the upstream boundary and the specific gap it fills;
- the Control inspector displays the OSS source URL, licence, pinned revision, decision and removal path;
- the discovery job refreshes metadata without auto-installing or auto-enabling anything;
- final acceptance includes a report of custom modules with their OSS decisions and confirms there is no duplicated upstream UI/runtime.

The frontier integrator can reject a poor OSS candidate and choose a small custom gap. It cannot skip the search or hide the reason.
