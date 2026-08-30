# Frank project contract

Frank is a single, intentionally thin visual Window and Hub. It owns the user
interface and a small transport boundary to Hermes. Hermes owns reasoning,
models, memory, tools, skills, and execution.

Hermes runs one profile on the VPS: `default`. Frank chats are ordinary,
unassigned sessions in that profile. Blockwise, Merrypaws, Elf & Wonder,
Pavone, and future bodies of work are projects/workspaces within the same
profile; they are never separate Hermes profiles.

## Mini Frank hierarchy

Mini Frank is `project:mini-frank` inside this same Frank source, Window
runtime, control boundary, Hermes profile, and release. Its public route is the
thin client at `/mini-frank/`; it renders state and submits typed requests but
does not reason, select models, run tools, or maintain its own skills, rules,
policies, memory service, repository, or control plane. Hermes is the only
brain for intake, research, building, revisions, and tool execution.

Customer work is subordinate to the Mini project:

```text
project:mini-frank
└── account:mini-frank/<account-id>
    └── job:mini-frank/<account-id>/<job-id>
        └── revisions, runs, artifacts, shares and service requests
```

These are stable scopes in Frank, not extra checkouts or Hermes profiles. Mini
uses centrally versioned Frank capabilities and deterministic policies through
project-scoped bindings. Shared Hermes skills remain in the one central skills
library and are executed only by Hermes; a Mini binding never copies their
implementation.

Mini currently ships in the central `apps/window` image on Frank's main VPS.
Moving its public edge to another VPS later must be a deployment-adapter change
against the same committed Frank revision, not a fork of its source or state.
The retired `/projects/mini-frank` checkout is not a product source. Only its
`customer-projects` directory remains mounted as narrowly scoped legacy data
so retention and migration cleanup can preserve or erase old customer work
safely; the retired `site` directory is never mounted or served.

The sole product source is `apps/window`. The previous Next.js/API platform,
databases, caches, embedded skills, agent harnesses, and alternate preview
applications were retired because they duplicated Hermes or produced multiple
competing versions of Frank.

The Window may grow through modular visual widgets, but those widgets remain
views and controls over authoritative VPS or Hermes capabilities. They must not
become independent brains or duplicate source/data owned elsewhere.

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
- OpenBao is the credential boundary, Activepieces CE is the preferred broad
  connector/workflow runtime, and Hermes remains the policy/execution boundary.
  Provider systems remain authoritative.

## VPS layout

| Responsibility | Path |
| --- | --- |
| Frank source | `/projects/frank` |
| External project workspaces | `/projects/<slug>` |
| Window data | `/srv/frank/data/window` |
| Window secrets | `/srv/frank/secrets/window.env` |
| Shared skills | `/srv/skills` |
| Hermes state | `/home/hermes/.hermes` |

The Window container sees only its explicit read-only mounts through the
virtual `/vps` tree. Hindsight and Hermes state are never mounted into Frank.

The authoritative memory design is [MEMORY.md](MEMORY.md): one Hindsight
service in Hermes' `default` profile, with private project/account/job scopes
and a separately approved, provenance-bearing industry knowledge scope.

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
