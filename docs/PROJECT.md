# Frank project contract

Frank is a single, intentionally thin visual Window and Hub. It owns the user
interface and a small transport boundary to Hermes. Hermes owns reasoning,
models, memory, tools, skills, and execution.

The sole product source is `apps/window`. The previous Next.js/API platform,
databases, caches, embedded skills, agent harnesses, and alternate preview
applications were retired because they duplicated Hermes or produced multiple
competing versions of Frank.

The Window may grow through modular visual widgets, but those widgets remain
views and controls over authoritative VPS or Hermes capabilities. They must not
become independent brains or duplicate source/data owned elsewhere.

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
