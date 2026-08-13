# F3-4 — Graphify completion and lakehouse

**Depends:** F0-3 (registry expanded) · **Model:** cheap for Graphify, medium for lake
**Allowed:** `apps/codegraph/**`, `modules/lake/**`, `infra/**` under lease
**Forbidden:** Dashboard UI/API behaviour, attachment lifecycle

Two independent pieces that share an owner because both touch infra.

---

## Part A — Graphify

Graphify already works. Its accepted image is `sha256:8e97261bdb76…`, currently running and healthy. **Production promotion never rebuilds it on the VPS** — the digest is pinned.

### A1. Point it at every project

`infra/production/codegraph-projects.json` currently has one entry: `frank`. Add every project so the graph shows the whole estate:

```json
{ "id": "blockwise",  "name": "Blockwise",  "mount": "/repositories/blockwise" }
{ "id": "merrypaws",  "name": "Merrypaws",  "mount": "/repositories/merrypaws" }
{ "id": "draftcheck", "name": "Draftcheck", "mount": "/repositories/draftcheck" }
```

Each needs a read-only bind mount into the container. Sources live at `/projects/<name>` on the VPS.

### A2. Remove pre-Graphify compatibility

Delete `FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK` · the one-time migration behaviour in `scripts/production/hosted-preflight.sh` and its focused test · runbook language about a legacy Node CodeGraph · rollback code that restores the pre-Graphify Node image instead of the prior accepted Graphify release · snapshot metadata that only serves the pre-Graphify implementation.

**Convert snapshot/rollback from Node semantics to Graphify-to-Graphify semantics**, retaining checksummed Caddy, API, web, CodeGraph, workbench, volume and config capture.

**Do not delete by name.** `apps/codegraph/**`, `apps/api/src/routes/codegraph.ts`, `infra/production/codegraph-projects.json`, the `frank-codegraph` service, its volume-init service, the `frank-codegraph-internal` network and the CodeGraph portions of the release workflows are all **current**. The word "codegraph" is not evidence of legacy.

### A3. Preserve the security posture

UID 10001 · internal-only network, no published host port · blocked egress · authenticated control API · duplicate refresh idempotency · graph within bounds with unique nodes/edges and no dangling or self edges.

---

## Part B — Lakehouse

Long-term history. Additive only — it must not take ownership of attachments or shared object-storage topology.

Deploy private, with **no public ports**: Lakekeeper · OpenFGA · lake worker · query worker · dedicated credentials.

Five Iceberg tables: raw events · normalised events · connector runs · action receipts · daily project metrics.

- Worker reads the PostgreSQL outbox **read-only**.
- Use canonical object references; never copy attachment lifecycle logic.
- Batch commits every minute or 10,000 events.
- Fence checkpoints with the live advisory-lock session and generation.
- Idempotent replay, quarantine, bounded compaction, safe-horizon orphan GC.
- DuckDB queries are **allowlisted**. No arbitrary SQL endpoint, ever.
- Storage thresholds: warn 70% · owner action 80% · pause non-essential ingestion 90%. **Never auto-delete canonical data.**

**Denial matrix — every cell is a test:** lake worker, query worker and monitor are denied attachment staging, canonical and preview buckets. Attachment identities are denied all lake buckets. Mounted secret values must not appear in container inspection or logs.

---

## Done when

**Graphify:** every project appears with a valid graph · zero matches for `FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK` and legacy overlay restore · rollback restores a prior *Graphify* release · service, network, volume, routes and workflows intact · UID 10001, no host port, egress blocked · duplicate refresh maps to one job.

**Lake:** compose renders with zero public ports · outbox failure and replay reach Iceberg without loss · DuckDB reads committed history · query client cannot modify the catalog · every denial-matrix cell passes · each component restarts independently · a disposable stack restores from off-site data · zero-residue cleanup receipt.
