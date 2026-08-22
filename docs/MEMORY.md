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
5. Frank renders only safe Hermes output and memory status. Raw provider state
   never crosses the Window boundary.

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

## Operations

The committed deployment contract lives in `apps/window/infra/memory` and is
run independently of a Frank Window release:

```bash
cd /projects/frank
bash apps/window/infra/memory/deploy.sh
```

The local embedded runtime is vendor-owned and uses Hermes' existing DeepSeek
credential. Version `0.6.1` is deliberately pinned because Hermes 0.20.1 pins
the matching client. Upgrade both together when Hermes changes that contract;
do not patch Hermes source or add a parallel service to chase a newer package.

The retired graph-backed memory stack, projection API, helper services, and
database volumes have no supported compatibility path. Restores must restore
Hindsight data and Hermes' built-in memory files only.
