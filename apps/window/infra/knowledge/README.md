# Frank knowledge infrastructure

This directory is an operator scaffold for private knowledge services. It is
not a second Frank, Hermes profile, agent loop, or memory store. Hermes owns
memory and reasoning; Frank may consume only an explicitly authorised,
content-free projection.

## Combined projection contract

`knowledge_projection.py` emits `schema://frank.graph/v2`, with the exact
root fields `schema`, `graph_id`, `graph_revision`, `generated_at`, `provider`,
`subject`, `scope`, `lens`, `capabilities`, `nodes`, `edges`, `groups`,
`trace_ref`, and `extensions`. Subject and scope are the exact requested
`project/<id>` and the lens is `knowledge.combined`. Node and edge provenance
is always the generic five-field `source` object. IDs and revisions are hashes
of canonical allowlisted metadata; the projection is bounded at 5,000 nodes
and 10,000 edges.

The Frank-facing projection listener uses the pinned Neo4j driver directly
with a fixed, parameterized, read-only `group_id` query; it does not construct
Graphiti or require an LLM key. The private Hermes mutation provider remains
the only Graphiti client. Vault input must
be `frank.vault-projection.v1`; only labels, wikilinks, tags and hashes are
adapted. Graphify 0.9.45 is consumed from its current `graph.json`
`nodes`/`links` export; snippets, content, and absolute paths are rejected.
Missing or corrupt source files fail closed to an empty source.

## Components and pins

* **Graphify supervisor/indexer:** the upstream PyPI `graphifyy` package,
  pinned to `0.9.45`. `graphify_supervisor.py` is the one canonical,
  cross-platform runner. It requires a reviewed `.graphifyignore`, a
  dedicated output directory outside the project, and rejects symlinked paths;
  it never publishes raw source or `graph.json`.
* **Vault:** ordinary `.md` files readable by Obsidian and SilverBullet. The
  `vault_projection.py` command emits deterministic metadata (wikilinks and
  tags) without note bodies. The projection is the only shape Frank may read.
* **Hermes Graphiti provider boundary:** an out-of-process provider contract
  for Graphiti `0.29.3` and Neo4j Community 5.26. The provider is
  private-only and exposes health/readiness plus explicitly bounded,
  namespaced append/search/correction operations. Frank must call an authorised Hermes projection, never Neo4j or
  Graphiti directly.

The deployment requires `NEO4J_IMAGE=neo4j@sha256:<digest>`; a mutable tag is
rejected. The compose file keeps Neo4j and the mutation provider on a private internal
network, gives the provider a separate egress network for its model calls, and
attaches only the dedicated projection listener to Frank's external network.
The projection listener has no mutation or search routes. Put credentials
in the deployment secret store (for example
`/srv/frank/secrets/window.env`), never in Git. `compose.yml` is a template and
does not claim that services are running.

## Operator model

1. Create a per-project output directory outside the Frank source checkout and
   run `python knowledge_runner.py project/<id> PROJECT --vault VAULT` with
   `FRANK_KNOWLEDGE_ROOT=/srv/frank/knowledge` (or an equivalent private
   root). On the VPS, run the refresh as root or UID 65532; root refreshes
   normalize only generated output directories/files to UID/GID 65532 and
   mode 0750/0640. Review the report;
   do not publish raw source or `graph.json` to Frank.
2. Keep the Markdown vault on a private volume. The runner invokes
   `vault_projection.py VAULT PROJECTION` as a one-way export.
   The output contains filenames, hashes, tags, and links only. Refresh is an
   explicit operator job; this bundle does not claim a continuous Graphify or
   Obsidian watcher or automatic vault synchronisation.
3. Deploy the provider and Neo4j on the VPS private network with `deploy.sh`.
   Require separate `HERMES_GRAPHITI_PROVIDER_TOKEN` and
   `FRANK_KNOWLEDGE_PROJECTION_TOKEN` values, TLS at the ingress, and exact
   namespace/project allow-lists.
4. Back up Neo4j with `neo4j-admin database dump` while stopped (Community has
   no clustering/hot-backup promise); encrypt and test restores offline.
5. Corrections are recorded as explicitly named correction episodes. Do not
   edit Neo4j manually; no removal operation is exposed by this boundary.

See `hermes-graphiti-provider.md` for the boundary and `SECURITY.md` for the
threat model and release procedure.

The current Hermes plugin requires one explicit project namespace because the
MemoryProvider API does not expose a trusted per-turn project selector. A
multi-project default profile must remain disabled until that selector is
available; this prevents cross-project memory recall.

Licensing: the reviewed `graphifyy` PyPI metadata identifies MIT; Graphiti is Apache-2.0 upstream;
Neo4j Community is distributed under Neo4j's Community Edition terms. Confirm
those terms with legal before commercial redistribution.
