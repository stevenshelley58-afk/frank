# Frank v0.21 shared estate — interface-contract mismatch handoff

Status: **MISMATCH — interface contract not yet published.** This branch contains
coordination only; no implementation exists on it yet.

## Gate state (Prompt 5 of 5)

- Gate rule 3 requires `origin/codex/frank-v021-contract` with
  `INTERFACE_CONTRACT_STATUS: READY` before implementation. That ref does not
  exist on the remote.
- Polls performed (2026-09-03, UTC): `git ls-remote origin 'refs/heads/codex/frank-v021*'`
  at session start and after each discovery phase (4 polls total, exit 0, zero
  matching refs). `codex/frank-v021-adapter-base` is also absent.
- Per gate rule 5/6 this mismatch is committed and pushed; work continues as
  read-only discovery plus this handoff. No implementation code has been
  written against `main`, and none will be until the READY contract is fetched.

## Read-only discovery completed (evidence for the contract authors)

Repository `/projects/frank` @ `49d75ad` (main):

- Governing docs read: `AGENTS.md`, `docs/PROJECT.md`, `docs/MEMORY.md`,
  `docs/tool-app-platform.md`, `apps/window/DESIGN.md`,
  `apps/window/graph/ASSEMBLY.md`, `apps/window/infra/memory/README.md`,
  `apps/window/infra/knowledge/README.md`.
- Project registry: `apps/window/project_store.py` (atomic JSON store),
  `DEFAULT_PROJECTS` at `apps/window/server.py:188` — ids/roots:
  `blockwise→blockwise`, `merrypaws→merrypaws`, `elfwonder→elfandwonder`,
  `pavone→pavone-demo`, `mini-frank→mini-frank`. Public projection sets
  `memory_scope = workspace/<root>` (`server.py:571`); the Hindsight bank is
  derived from `project["root"]` in `memory_inspector.py:_bank_id`
  (`steven-<root>`). Legacy-root derivation must be preserved exactly.
- Compose (`apps/window/docker-compose.yml`): six static read-only project
  mounts, including the host/container name difference
  `/projects/blockwise-product-release-21a192cd2420:/vps/projects/blockwise:ro`.
  Window data mount `/srv/frank/data/window:/data`; upload root env
  `HERMES_SHARED_UPLOAD_ROOT=/srv/frank/data/window/uploads`.
- Explorer/uploads in `server.py`: `ROOTS["vps"]` (env `VPS_ROOT`, default
  `/vps`), staged uploads under `UPLOAD_DIR = CHAT_DIR/uploads`
  (`/data/uploads` in-container; host twin `/srv/frank/data/window/uploads`),
  routes `/api/chat/uploads`, `/api/chat/uploads/vps`, delete/get variants.
- Tool/home platform: `tool_apps/home_manifest.py` (fail-closed validation,
  `discover_tool_homes`), five tool packages with `home.json`
  (content-factory, ad-intelligence, mail, outreach, prospect-discovery);
  `infra/discovery/` has a systemd refresh timer already.
- Memory: `memory_inspector.py` (private HTTP bridge to Hindsight, client
  pinned to `http://`), `infra/memory` deploys the systemd socket proxy on
  `172.16.1.1:9178`; Hindsight client pinned `0.6.1` (Hermes 0.20.1 contract).
- Tests: 81 files under `apps/window/tests`; delivery check is
  `python -m unittest discover -s tests` + `node --check` per `AGENTS.md`.

## VPS host facts observed (read-only)

- Skill roots re-inventoried (counts differ from the v0.21 audit; top-level
  counts, deeper inventory pending): `/home/hermes/.hermes/skills` 25 dirs /
  10 `SKILL.md` (≤2 depth); `/home/codex/.hermes/skills` 17 / 1;
  `/home/codex/.codex/skills` 0 / 0; `/root/.codex/skills` 17 / 17;
  `/srv/skills` empty (target, correctly not referenced by any consumer).
- Codex CLI present at `/usr/bin/codex`; `codex` user uid/gid 1001 with groups
  `codex, sudo, users, docker` — not in group `hermes` (gid 1002). The sudo
  and docker memberships are broader than least privilege; the Codex ACL
  runbook must record and narrow these before any writable launch.
- `/root/.codex/config.toml` exists (contents intentionally not read/printed).

## What Session 1 must publish

1. `origin/codex/frank-v021-contract` with `INTERFACE_CONTRACT_STATUS: READY`
   and canonical `docs/contracts`, shared schemas, fixtures, and the frozen
   project-visibility mechanism (explicit read-only restart mounts vs
   restricted broker) for Part G step 8.
2. Later, `origin/codex/frank-v021-adapter-base` with `ADAPTER_STATUS: READY`
   and matching interface/foundation hashes.

## Next step for this branch

When the READY contract is fetched: create the isolated worktree from the exact
contract commit, merge this branch forward without rewriting history, record
the new SHA, and begin the foundation checkpoint (resolver + lease) per the
approved plan. All live-host changes (skills promotion, consumer redirect,
memory config, mounts, Codex ACLs) remain Session-1-owned cutover steps; this
branch only prepares and tests them in isolation.
