# Step 1 research sources

Reviewed 2026-08-30 (UTC). URLs are primary project documentation, source
repositories, release pages or official APIs. Web text is reference only; it
does not grant installation or enablement approval. Every selected source is
recorded at an exact commit, tag, or package version in the machine-validated
receipts under `decisions/oss/`; mutable links below are navigation aids only.

## Runtime and graph authorities

- [AgentTrail source](https://github.com/sodiumsun/agenttrail), pinned by Step 0 at `5b97cf3cef548a0c668731e7f569fa36c14832f2`, MIT; [Archify source](https://github.com/tt-a1i/archify), pinned by Step 0 at `b36d79fdbc3aec3728744341485a7e79f03c0071`, MIT. Their upstream boards/generator remain authorities; Frank owns only thin embedding/projection seams.
- [Backstage catalog](https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/index.md), [NetBox](https://github.com/netbox-community/netbox), [OpenMetadata Standards](https://github.com/open-metadata/OpenMetadataStandards), [Cartography](https://github.com/cartography-cncf/cartography) were compared for catalog vocabulary and collector patterns.
- [Beszel](https://github.com/henrygd/beszel/releases/tag/v0.18.8), [Grafana](https://github.com/grafana/grafana), [Prometheus](https://github.com/prometheus/prometheus), [Loki](https://github.com/grafana/loki), [Alloy](https://github.com/grafana/alloy), [OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector) were compared for the unavailable Step 0 runtime provider. No provider was installed.

## Current instruction, skill and plugin references

- Codex: [AGENTS.md configuration](https://developers.openai.com/codex/agent-configuration/agents-md), [skills](https://developers.openai.com/codex/build-skills), [OpenAI skills repository](https://github.com/openai/skills), and [OpenAI plugins](https://developers.openai.com/plugins). These describe scoped instruction discovery and packaging; Frank records pointers/hashes and never copies full instruction bodies.
- Claude: [memory/CLAUDE.md](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills), [plugins](https://code.claude.com/docs/en/plugins), [plugin discovery](https://code.claude.com/docs/en/discover-plugins), and [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces). These are format/discovery references, not runtime authority.
- Hermes: [skills documentation](https://hermes-agent.nousresearch.com/docs/skills). Hermes remains the only reasoning, tool, memory and action authority; no second skill runtime is approved.
- [Official MCP Registry repository](https://github.com/modelcontextprotocol/registry) and [Registry API documentation](https://registry.modelcontextprotocol.io/docs) provide read-only metadata discovery.
- Workflow candidates: [gstack](https://github.com/garrytan/gstack), [Brooklyn skills](https://github.com/OutThisLife/brooklyn-skills), and [refactoring-ui-plugin](https://github.com/gnurio/refactoring-ui-plugin); evaluate individually, never install as a monolith.

## Cleanup, evaluation and discovery

- Report-only cleanup candidates: [Knip](https://github.com/webpro-nl/knip), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [jscpd](https://github.com/kucherenko/jscpd), [Vulture](https://github.com/jendrikseipp/vulture), [Renovate](https://github.com/renovatebot/renovate), [OSV-Scanner](https://github.com/google/osv-scanner), [jscodeshift](https://github.com/facebook/jscodeshift), [ts-morph](https://github.com/dsherret/ts-morph), and [LibCST](https://github.com/Instagram/LibCST). Findings never directly delete or rewrite source.
- Evaluation candidate: [Promptfoo](https://github.com/promptfoo/promptfoo) and [documentation](https://www.promptfoo.dev/docs/), only if existing Hermes/Codex checks fail the fresh-context golden contract.
- Metadata and security evidence: [GitHub repository search API](https://docs.github.com/en/rest/search/search#search-repositories), [repository metadata API](https://docs.github.com/en/rest/repos/repos), [Trending](https://github.com/trending), [deps.dev API](https://docs.deps.dev/api/), [OpenSSF Scorecard](https://scorecard.dev/), [OSV](https://osv.dev/) and [OSV-Scanner](https://google.github.io/osv-scanner/). Discovery feeds are untrusted leads and remain disabled.

Limitations: unauthenticated GitHub API/search and public project pages can be
rate-limited or stale; no claim is made about private issues, complete
transitive dependency health, or live VPS provider state. Exact pins,
license evidence and explicitly unavailable security signals are preserved in
the decision receipts and must be re-evaluated before a later enablement.
