# Runtime observability decision

Reviewed: 2026-08-30. Step 0 says `runtime_monitoring.provider: null` and
`status: unavailable`; AgentTrail is explicitly not runtime-health authority.

## Decision

Do not install a provider in Step 1. Prepare a disabled, read-only provider
seam and re-check the VPS inventory in Step 4B, including its private
authenticated health endpoint and retention. If the gap remains, Beszel hub
plus one agent is the smallest fallback for host/container health and history.
A full Grafana / Prometheus / Loki / Alloy / OTel composition is deferred until
a measured missing signal requires it. Frank will show compact evidence and
deep-link to the provider; it will not build a dashboard.

| Candidate | Reviewed official source | Licence | Fit/cost signal | Decision |
|---|---|---|---|---|
| Beszel | https://github.com/henrygd/beszel/tree/v0.18.8; https://github.com/henrygd/beszel/blob/v0.18.8/LICENSE; tip `467f1767132b8b4e68ae6652b3763e3cbf609586` | MIT | v0.18.8 (2026-08-17), pushed 2026-08-27. Planning minimum 1 vCPU/256 MB RAM and 1 GB for 7-day history; private auth/deep-link still requires Step 4B verification. OSV exact Go query: 0 matching advisories; Scorecard API 404 (no project record). | first fallback, disabled |
| Grafana + Prometheus | https://github.com/grafana/grafana; https://github.com/prometheus/prometheus | AGPL-3.0 / Apache-2.0 | Grafana v13.2.0 + Prometheus v3.14.0; planning 1 vCPU/1 GB RAM and 7 GB storage combined for low-volume 7-day metrics/UI. Requires reverse-proxy auth and two services; overlaps Frank presentation. OSV: Grafana 39 and Prometheus 1 exact-version matches, requiring remediation review. | reject as default |
| Loki | https://github.com/grafana/loki; https://github.com/grafana/loki/blob/v3.7.7/LICENSE | AGPL-3.0 | v3.7.7 (2026-08-27); planning 1 vCPU/512 MB RAM and 5 GB for 7-day low-volume logs. Logs only, adds shipper/auth/storage burden. OSV exact-version: GO-2026-5115. | defer until searchable-log gap |
| Grafana Alloy | https://github.com/grafana/alloy; https://github.com/grafana/alloy/blob/v1.19.2/LICENSE | Apache-2.0 | v1.19.2 (2026-08-26); planning 0.25 vCPU/128 MB RAM and 512 MB buffer. Collector only; requires configured destination and private auth. OSV exact-version: 0; Scorecard API 404. | defer |
| OpenTelemetry Collector | https://github.com/open-telemetry/opentelemetry-collector; https://github.com/open-telemetry/opentelemetry-collector/blob/v0.159.0/LICENSE | Apache-2.0 | v0.159.0 (2026-08-17); planning 0.25 vCPU/128 MB RAM and 512 MB buffer. Vendor-neutral pipeline; backend/auth/config still required. OSV exact-version: 0; Scorecard 7.9 (2026-08-21). | defer |

The existing-provider search is mandatory before promotion. Remaining unknowns
are current private VPS package versions, retained history volume, auth/deep-link
route, and advisories in transitive dependencies. No provider is installed or
enabled by this receipt. Fallback budget is <=1 vCPU, <=256 MB RAM, <=1 GB
retained metrics/log metadata initially, with a 7-day retention cap; exceed
budget or lack authenticated evidence means remain unavailable. The exact
release OSV queries were made against `https://api.osv.dev/v1/query`; Scorecard
outcomes came from `https://api.securityscorecards.dev/projects/github.com/<repo>`.

Removal: set `runtime_monitoring: false`, stop/remove only the isolated
provider definition, retain evidence receipts, and restore the previous
deep-link/manifest. No Frank, Blockwise, Hermes or Hindsight data is touched.

Sources: [Beszel release v0.18.8](https://github.com/henrygd/beszel/releases/tag/v0.18.8), [Grafana](https://github.com/grafana/grafana), [Prometheus](https://github.com/prometheus/prometheus), [Loki](https://github.com/grafana/loki), [Alloy](https://github.com/grafana/alloy), [OTel Collector](https://github.com/open-telemetry/opentelemetry-collector). Research limitation: no provider was reachable in Step 0; versions, advisories and resource use require a controlled isolated test before promotion.
