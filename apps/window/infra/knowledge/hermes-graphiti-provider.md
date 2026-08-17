# Hermes Graphiti provider boundary

This is a plugin boundary, not an implementation of an agent loop. The
provider runs as a separate Hermes-owned process. Frank receives only an
authorised projection and has no Neo4j driver, Graphiti credentials, or direct
database route.

Install `hermes_plugin/` into the existing default profile's
`$HERMES_HOME/plugins/frank-graphiti-memory/` directory, then set
`memory.provider: frank-graphiti-memory` in that profile's `config.yaml`.
There is one selected external provider and no additional Hermes profile. The
current MemoryProvider API has no trusted project selector on every turn, so
deployment requires exactly one namespace and fails closed for a multi-project
Hermes profile.
Set `HERMES_GRAPHITI_PROVIDER_URL`, `HERMES_GRAPHITI_PROVIDER_TOKEN`, and the
explicit `HERMES_GRAPHITI_NAMESPACE=project/<id>` in the Hermes service
environment.

## Contract

The gateway accepts HTTPS requests with `Authorization: Bearer <token>` and
`X-Hermes-Namespace: project/acme`. The namespace must match an exact startup
allow-list. The gateway rejects missing or unknown namespaces, cross-namespace
IDs, unknown payload fields, and bodies over the configured limit.

The only memory operations are:

* `POST /v1/episodes` — append a bounded user/assistant turn;
* `POST /v1/corrections` — append a consistently named correction episode
  referencing a target; it leaves that target unchanged;
* `POST /v1/search` — return only an explicit JSON-safe search projection;
* `GET /healthz` and `GET /readyz` — liveness/readiness (readiness verifies
  Neo4j connectivity and schema initialization).

Writes use a caller-supplied bounded `request_id`; results include namespace
and episode provenance. Graphiti `group_id` is derived from the validated
namespace, never accepted as an arbitrary Cypher fragment. Raw episode bodies
are not stored by the Graphiti client.

## Frank projection route

`GET /v2/knowledge/projection?project=project/<id>&lens=knowledge.combined` uses a separate
`FRANK_KNOWLEDGE_PROJECTION_TOKEN` and exact
`FRANK_KNOWLEDGE_ALLOWED_PROJECTS` list. It returns only the v2 combined
projection. Frank is not given the Graphiti token, Neo4j credentials, raw
episode or note bodies, source code, prompts, secrets, or arbitrary Graphify
JSON. The projection listener is a separate read-only process on the Frank
Docker network, using the pinned Neo4j driver and a fixed parameterized
metadata query; the mutation provider remains loopback/private and is never
attached to Frank. Neo4j remains on the internal network. The projection
listener has no mutation or search routes and receives no OpenAI secret.

The provider pins `graphiti-core==0.29.3`, above the fixed `0.28.2` Cypher
injection release. Neo4j Community is pinned to `5.26-community`. Keep the
gateway private, put TLS at the ingress, rotate the token, and grant the
Neo4j user only the database privileges needed by this provider.
