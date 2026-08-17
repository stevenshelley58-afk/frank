# Security and operations

No credentials, vault bodies, graph databases, indexes, or generated output
belong in Git. The compose template requires an external secret environment;
use the existing VPS secret path and restrict it to the provider service.

Graphify output is derived per project. Run it with an explicit project path,
review `.graphifyignore`, and publish only a reviewed report or authorised
projection. Never expose `graph.json` or raw vault Markdown through Frank.
The adapter currently consumes only Graphify 0.9.45's
`graphify-out/graph.json` `nodes`/`links` shape. If that export changes or is
missing, the adapter fails closed; it does not guess from cache or reports.

Neo4j remains private. The mutation provider binds to loopback and the
projection-only listener is the sole knowledge service attached to Frank's
external Docker network. In production, put the services on private
Docker/VPS networks, require a separate bearer token for projection, and
monitor both `/readyz` endpoints. Network policy must prevent the Frank
container from reaching ports 7687 and 8091.

Upgrade Graphiti only after reviewing its release and security advisories;
`0.28.2` fixed the known Cypher-injection issue and this scaffold uses `0.29.3`.
Pin image digests during deployment, scan images, and verify the package lock
in the provider environment.

For Community backups, stop writes, run `neo4j-admin database dump neo4j
--to-path=/backup`, encrypt the archive, and store it outside the host. Test a
restore into an isolated Neo4j instance before relying on it. Community does
not provide Enterprise clustering or hot-backup guarantees.
