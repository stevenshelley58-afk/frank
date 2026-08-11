# frank-codegraph

`frank-codegraph` is Frank's internal Graphify v0.9.39 AST-only supervisor.
It never exposes Graphify MCP and never configures an LLM provider.
Extraction deliberately uses `--no-cluster`: Frank's architecture view is the
explicit typed overlay, while code drill-down consumes bounded upstream nodes
and edges. Enabling clustering would add build cost and a second architecture
classification without a current API/UI consumer.

The operator-owned registry is
`infra/production/codegraph-projects.json`. Every project must have a dedicated
read-only `/repositories/<id>` bind mount and a matching manual registry entry.
The control endpoint accepts only that opaque `id`.

Each successful extraction atomically selects an immutable release. Consumers
must read only these paths:

```text
/data/codegraph/<id>/current/graphify-out/graph.json
/data/codegraph/<id>/current/frank-overlay.json
/data/codegraph/<id>/current/status.json
```

`current` must be the relative symlink `releases/<release>`. The service keeps
the selected release plus the three newest prior releases. It refuses unsafe
links, bounds release size/file count, and removes only canonical abandoned
staging directories at startup.

`GET /health` is the only unauthenticated route and is healthy after every
registered project has a validated published release. A failed background
refresh leaves that good release ready and reports `refresh_degraded: true`.
All control calls require
`Authorization: Bearer <token>` loaded from
`CODEGRAPH_CONTROL_TOKEN_FILE` (the production Docker secret). `GET /status`
is the live operational manifest. `POST /projects/<id>/refresh` additionally
requires a bounded JSON body `{"command_id":"..."}` and returns `202` with a
stable job. Replaying the command id returns the original job/result; bounded
job and idempotency records persist in the project runtime directory, expire
after 24 hours, and self-evict by LRU. Coalesced jobs expose the retained
`commandIds` membership list (maximum 256), while the direct acceptance response
also echoes its unambiguous `commandId`. Jobs can be polled at
`GET /projects/<id>/jobs/<jobId>`. Source changes are debounced and
coalesced into at most one running and one queued rebuild per project.

The accepted/polled job shape is camel-case JSON:

```text
{ jobId, state, requestedAt, commandIds?, commandId?, startedAt?,
  completedAt?, release?, graph?: { nodes, edges }, error? }
```

`state` is `queued`, `running`, `succeeded`, or `failed`. `commandId` appears
only on the direct response for that command; polling uses `commandIds` to
avoid an ambiguous scalar on a coalesced job. The authenticated live status is
`{ schema_version: 1, generated_at, projects: [...] }`; each project includes
build/queue state, current release, last success/error, degradation, and the
ten newest bounded jobs.

The Frank overlay is deterministic and adds only explicit metadata:
`package.json` packages and declared dependencies, `SKILL.md` frontmatter, and
tool declarations from `package.json` `frank.tools` or a `tool.json`,
`tool.manifest.json`, or `mcp.json` with `kind: "tool"`. It never infers a
skill-to-tool relation by name alone.

Publication shares the API's hard limits: each Graphify graph is at most
32 MiB, and the combined upstream graph plus overlay is at most 50,000 nodes
and 200,000 edges. Oversized output fails the refresh without switching
`current`.

Production places the API and codegraph service on a dedicated internal Docker
network. The codegraph service has no general egress network. A one-shot,
networkless init service fixes ownership of only `/data/codegraph` for legacy
volumes before the UID 10001 service starts. Repository and registry binds both
come from `FRANK_RELEASE_SOURCE`, ensuring the image, registry and indexed tree
belong to the same release.

The runtime dependency set is hash-locked, the Graphify archive is pinned by
commit and SHA-256, the Python base is digest-pinned, and the image carries a
generated CycloneDX dependency/license inventory at
`/app/sbom/dependencies.cdx.json`. CI also builds the final image, emits a
final-image CycloneDX SBOM, and blocks promotion on high/critical known
vulnerabilities.
