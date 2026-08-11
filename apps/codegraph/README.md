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
networkless init service performs a bounded, no-follow migration of a legacy
`/data/codegraph` tree before the UID 10001 service starts, refusing special
files, hard-link anomalies and every symlink except the exact contained
`<project>/current -> releases/<release>` selector. Production keeps the reviewed release
worktree and bare cache private. The runbook atomically stages a `.git`/secret/build-free
tracked snapshot and its hash-matched registry in a root-owned, group-10001 read-only
directory; explicit production bind paths ensure both inputs belong to the same reviewed
commit without making the private Git source readable to the container or unrelated users.

The runtime dependency set is hash-locked and the Graphify archive is pinned by
commit and SHA-256. The credential-free builder is official Python 3.14.6 on
Alpine 3.24, pinned by immutable multi-architecture index digest; production's
amd64 child digest is recorded in the Dockerfile and final OCI metadata.

The final stage starts from `scratch`. A build-time assembler copies only the
Python standard library, target-installed runtime dependencies, application,
licenses/notices, `/etc/os-release`, numeric user records and the recursively
resolved ELF/musl closure. Dependency discovery reads only bounded
`DT_NEEDED`/`RUNPATH` metadata through the pinned build-only `scanelf`; it
never executes target ELF objects or treats undefined symbols as libraries.
Resolution mirrors musl loader order: the requesting object's validated
RUNPATH/RPATH directories are checked in declaration order, followed by each
bounded `needed_by` ancestor's paths in order, then `/lib`, `/usr/local/lib`,
and `/usr/lib`. Directories are canonical-deduplicated across that chain.
Canonical object identity preserves deterministic first-load ancestry and
terminates dependency cycles. Package vendor directories such as
`numpy.libs` and `rapidfuzz.libs` are reachable only when that object declares
them itself or inherits them through its loader ancestry; they are never mixed
into a global search pool or seeded as independent loader roots. Importable
extensions and non-vendor runtime ELFs remain deterministic roots. The image
retains a bounded `/app/sbom/elf-resolution.json` audit of every source object,
search-tier owner, declared/expanded path, selected directory, and canonical
candidate.
It physically excludes `tarfile.py`, `html/parser.py`, the unused Tk GUI surface
(`_tkinter`, `tkinter`, `idlelib`, and `turtledemo`), bytecode caches, pip,
setuptools, wheel, shells and package managers. Tk removal is explicit rather
than a generic missing-library exception: every other unresolved `DT_NEEDED`
entry still fails the build. The scratch image runs `/usr/local/bin/python3 -P -m frank_codegraph`
as UID/GID 10001. Its only configured Python module roots are the fixed trusted
`/app:/opt/frank-codegraph/site-packages` path; supervisor extraction children
receive the same exact value, explicit `-P`, `PYTHONSAFEPATH=1`, and disabled
user-site loading. The runtime startup policy fails closed unless safe-path is
active, the trusted roots occur exactly once in order, neither the current
repository nor any `/repositories` path is importable, and Frank/Graphify
resolve below `/app` and the pinned target site-packages respectively. Every
build runs the verifier from `/tmp`, proving Frank imports do not depend on
`/app` as the working directory, verifies the removed modules cannot be imported,
and completes a real Graphify extraction before publication.

CI generates the final SBOM, signs it, verifies the exact returned bundle and
requires its signed predicate to equal the generated document byte-for-byte
after canonicalization. It attests provenance and scans the exact GHCR digest
with the newest Grype database and `only-fixed: false`. The raw
High/Critical set must be exactly the three audited CPython module findings.
CI then creates an exact-digest OpenVEX statement documenting the physically
absent vulnerable code, signs it through GitHub OIDC, verifies its signature
and subject, and requires a VEX-aware scan to report zero actionable
High/Critical findings. No external registry credential is required.
