# Frank project contract

Frank is a single, intentionally thin visual Window and Hub. It owns the user
interface and a small transport boundary to Hermes. Hermes owns reasoning,
models, memory, tools, skills, and execution.

Hermes runs one profile on the VPS: `default`. Frank chats are ordinary,
unassigned sessions in that profile. Blockwise, Merrypaws, Elf & Wonder,
Pavone, and future bodies of work are projects/workspaces within the same
profile; they are never separate Hermes profiles.

## Mini Frank hierarchy

Mini Frank is an independent peer project boundary in the shared Hermes profile,
not a Frank feature. It has isolated customer account and job scopes; private
scoped memory remains separate, while shared Hermes execution and centrally
maintained capabilities are reached only through explicit project-scoped
bindings.

The intended Mini public surface is a standalone staged application. It has not
cut over: the public Mini route is still served by Frank's `apps/window` image.
Do not infer a separate deployed runtime or claim a completed cutover from the
staged standalone work, especially while concurrent Mini edits remain dirty.
The remaining `/projects/mini-frank/customer-projects` path is legacy customer
data, retained only for safe migration or retention work.

The shared skills library remains central and runs only through Hermes.
Approved references are a separate, scoped reference boundary; they do not
merge private memory, copy implementation, or create a second agent loop.

## Homes, widgets, and connections

Every project, tool, agent, and service may have one shared home assembled from
the same versioned widget catalog. The left rail remains the stable navigation
contract; tool and agent homes open inside the existing content pane.

- Layouts and safe custom note/link widgets persist under Window data.
- A widget reads a Frank provider endpoint and renders explicit ready, empty,
  attention, unavailable, or error state. Missing data is never invented.
- Widget failures are isolated to their own card. Layout saves use a revision
  precondition so an older browser cannot silently overwrite a newer layout.
- Widget Builder is a Window tool. It does not accept code, HTML, credentials,
  or arbitrary provider calls.
- Connections is a catalog and control surface. Frank stores provider, scope,
  capabilities, recorded status, and opaque connection/vault references only.
- One shared Inbox, Calendar, Notifications, and CRM is the target surface,
  with project-filtered views rather than per-project copies. It does not claim
  provider integrations that are not yet implemented and verified.
- Infisical CE is the credential boundary, Activepieces CE is the preferred
  broad connector/workflow runtime, and Hermes remains the policy/execution
  boundary. Provider systems remain authoritative.

## VPS structure and guardrails

This is a role-based layout, not a claim that every child of `/projects` is a
canonical project. Current canonical project sources use `/projects/<slug>`;
release snapshots, worktrees, canaries, and historical checkouts are separate
roles and must be reference-audited before archival or deletion.

| Role | Current location | Boundary |
| --- | --- | --- |
| Canonical Frank source | `/projects/frank` | Version-controlled product source only. |
| Canonical project source | `/projects/<slug>` | One project boundary per slug, including Mini. |
| Shared skills | `/srv/skills` | Reusable capability library, not project-private data. |
| Hermes profile/runtime state | `/home/hermes/.hermes` | One shared Hermes runtime/profile. |
| Hermes secrets | `/srv/hermes/secrets` | Private service state, outside source control. |
| Hindsight provider data | `/home/hermes/.pg0/instances/hindsight-embed-hermes/data` | Native provider-managed state; do not move merely to standardise paths. |
| Frank private data, secrets, and backups | `/srv/frank/data`, `/srv/frank/secrets`, `/srv/frank/backups` | Per-service state, outside source control. |
| Derived project knowledge | `/srv/frank/data/window/knowledge/<slug>` | Rebuildable projection, not a second shared semantic database. |

The active Hermes services are `hermes-gateway.service` and
`hermes-serve.service`, both operating as `hermes` from
`/home/hermes/.hermes`; `frank-serve-bridge.service` is the narrow Frank
bridge. Hindsight is one semantic-memory service with isolated project,
account, and job scopes. A shared reference is not permission to merge private
memory, duplicate project context, or add a second brain.

The Window container sees only explicit read-only project mounts through
`/vps`; its writable data and preview mounts are service state, not source.
The authoritative memory design is [MEMORY.md](MEMORY.md).

### Current exceptions

- `/projects` contains mixed release and worktree directories. Classify each
  against active deployment references and backup retention before cleanup.
- Active Blockwise Compose references span two live release paths. The currently
  bound Caddy and database-init files are content-identical, so this is a
  cleanup/reference hazard rather than evidence of a broken runtime.
- Frank still has the writable legacy Mini `customer-projects` bind. Back it
  up, reference-audit it, and migrate it to an approved private state root
  before any removal; do not delete it blindly.

These guardrails apply when cleanup resumes: retain current runtime paths,
avoid mass moves, version-control nonsecret deployment configuration and
runbooks, and keep credentials and private runtime state outside Git.

This source revision supports project creation, listing, metadata editing,
archive, and restore. Archive preserves files, sessions, and running work.
The approved release pointer and live health response identify which source
revision is deployed; a working branch is not deployment evidence.

## Creating projects

Frank's New Project flow records safe project metadata in Window data, creates
one authoritative Hermes session in the existing `default` profile, and binds
that session to `/projects/<project-id>`. Hermes provisions that directory
before the first turn; the visible bootstrap turn initializes it or clones the
requested repository into it. Frank's `/projects` mount remains read-only.
The canonical `/projects` parent stays root-owned and setgid to the `hermes`
group so Hermes can create new child workspaces without broadening Frank's
filesystem access.

The session workspace is the shared scoping key for chat grouping, repository
instructions, tools, and long-term memory. Memory providers must derive their
workspace/bank from the bound session workspace so project memory cannot cross
into another project. Frank stores the session-to-project association for
navigation only; it never stores transcripts, recalled memories, model state,
or an agent loop.

Project creation fails if Hermes cannot create the bound session. If Frank
cannot persist the project registry after Hermes creates the empty session, it
best-effort deletes that session rather than presenting a disconnected project.

Mini customer accounts and jobs do not use this generic project-creation flow.
They remain children of the already registered `project:mini-frank`, use
isolated private workspaces and memory scopes, and call the same central Hermes
session boundary. Creating a Mini job must never create another Frank project,
repository, provider profile, skill tree, or policy source.
