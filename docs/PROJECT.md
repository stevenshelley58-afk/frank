# Frank project contract

Frank is a single, intentionally thin visual Window and Hub. It owns the user
interface and a small transport boundary to Hermes. Hermes owns reasoning,
models, memory, tools, skills, and execution.

Hermes runs one profile on the VPS: `default`. Frank chats are ordinary,
unassigned sessions in that profile. Blockwise, Merrypaws, Elf & Wonder,
Pavone, and future bodies of work are projects/workspaces within the same
profile; they are never separate Hermes profiles.

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
| Window data | `/srv/frank/data/window` |
| Window secrets | `/srv/frank/secrets/window.env` |
| Shared knowledge | `/srv/vault` |
| Shared skills | `/srv/skills` |
| Project source | `/projects/<project>` |
| Hermes state | `/home/hermes/.hermes` |

The Window container sees only `/projects`, `/srv/vault`, and `/srv/skills`
through a read-only virtual `/vps` tree.
