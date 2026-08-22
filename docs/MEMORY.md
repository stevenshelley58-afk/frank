# Memory contract

Hermes owns memory. Hindsight is the single external semantic memory provider;
Hermes' built-in `MEMORY.md` and `USER.md` remain active alongside it. Frank is
only the Window: it forwards chat and renders Hermes' answers and status. Frank
does not own a memory database, extraction worker, provider API, or agent loop.

## Identity and isolation

Hermes has one VPS profile: `default`. Projects are workspaces inside that
profile, with canonical paths `/projects/<slug>` and project-scoped sessions.
The session binding must pass the stable `<slug>` as Hermes runtime
`agent_workspace` context. It must never pass a constant value shared by every
project.

The native provider uses:

```json
{
  "bank_id": "steven-unassigned",
  "bank_id_template": "steven-{workspace}"
}
```

This produces one isolated bank per project (`steven-frank`,
`steven-blockwise`, and so on). Session IDs are document lineage, not bank
identity. Unassigned sessions use `steven-unassigned`; they do not silently
write to a project bank.

## Runtime flow

1. Frank creates or resumes a Hermes session bound to one canonical project
   workspace.
2. Hermes supplies the profile, workspace slug, platform, and session context
   to its bundled provider.
3. Hindsight resolves the project bank, recalls relevant durable context before
   the turn, and offers explicit retain, recall, and reflect tools.
4. Hermes retains completed turns asynchronously and keeps its small built-in
   memory files active for high-value operator preferences.
5. Frank's project Memory inspector reads the native Hindsight API through a
   private VPS bridge and renders an allowlisted view of the project's bank.
   Frank never stores a second copy of provider state.

The extraction mission keeps durable decisions, requirements, corrections,
preferences, outcomes, and open work. It excludes credentials, tokens, raw
tool output, and temporary failures.

## Files and other coding agents

Hindsight is semantic memory, not file storage. Project files remain canonical
under `/projects/<slug>`. Hermes and VPS-hosted coding agents can read or write
those same paths according to Unix permissions. Desktop coding agents use the
same Git repositories and can connect to the same Hindsight API when an
authenticated endpoint or SSH tunnel is deliberately configured.

For Codex, use Hindsight's maintained coding-agent integration and configure
one bank per repository. Its derived bank must equal the Hermes name
`steven-<slug>`; do not include the client name in the bank identity. This lets
Codex and Hermes share project memory without sharing sessions or profiles.

## Frank project knowledge view

Open a project and choose **Memory**. The Window presents one human-readable
project knowledge surface with five views:

- **Overview** combines Hindsight living project-guide pages with the
  source-grounded application wiki.
- **Rules & facts** separates the living rulebook, explicit Hindsight
  directives, durable facts, and their retained sources.
- **How it works** renders source-grounded Mermaid architecture, data-flow,
  and sequence diagrams.
- **Knowledge map** renders Hindsight's entity relationships in Frank's
  existing read-only graph workbench.
- **Memory activity** keeps recall testing, source correction/forgetting,
  asynchronous operations, and provider failures available as the advanced
  evidence view.

Hindsight remains authoritative for semantic facts, directives, entities, and
living project summaries. The application wiki is a rebuildable projection of
committed source code, not memory and not a second source of truth.

Corrections replace the selected native Hindsight source document and ask
Hindsight to re-extract its facts. Forget deletes that source and all facts
derived from it after explicit confirmation. Source text is loaded only when
the operator opens that source; project summaries never include raw retained
conversation text.

Frank reaches the loopback-only Hindsight API through a systemd socket proxy
bound to the existing private Frank Docker network (`172.16.1.1:9178`). The
proxy has no database, worker, model, or memory logic. Hindsight remains the
single source of truth and is not exposed on a public interface.

### Source-grounded application wiki

Frank uses the pinned MIT-licensed FSoft CodeWiki CLI as a native VPS batch
generator. It is not deployed as another web app, database, agent runtime, or
container. A refresh clones the current committed `/projects/<slug>` revision
into a temporary read-only working directory, so it never changes or includes
uncommitted work in the canonical checkout. Completed Markdown and Mermaid
artifacts are atomically published beneath
`/srv/frank/data/window/knowledge/<slug>`.

Install or update the pinned generator, then rebuild one project:

```bash
cd /projects/frank
bash apps/window/infra/knowledge/deploy.sh
frank-project-wiki blockwise
```

Generation is outside Frank's request path. Hermes, Frank, and project work
continue normally while a bulk wiki refresh runs; Frank reads only the last
completed artifact set.

## Operations

The committed deployment contract lives in `apps/window/infra/memory`. The
provider can be deployed independently, and every Frank release verifies the
private inspector bridge before replacing the Window container:

```bash
cd /projects/frank
bash apps/window/infra/memory/deploy.sh
```

The local embedded runtime is vendor-owned and uses Hermes' existing DeepSeek
credential. The provider suite is deliberately pinned to `0.6.1` because
Hermes 0.20.1 enforces that client version at runtime. Upgrade the suite and
Hermes together when that contract changes; do not patch Hermes source or add
a parallel service to chase a newer package.

The provider profile relies on Hindsight's default zero idle timeout instead
of serializing an explicit value. Version 0.6.1 saves only public
`HINDSIGHT_API_*` profile settings; including its internal idle-timeout setting
would create a false configuration change and a repeated daemon restart loop.

Nothing in this contract starts Docker on a developer machine. Hermes and
Hindsight run natively on the VPS. Frank's normal production container build
also runs on the VPS.

The retired graph-backed memory stack, projection API, helper services, and
database volumes have no supported compatibility path. Restores must restore
Hindsight data and Hermes' built-in memory files only.
