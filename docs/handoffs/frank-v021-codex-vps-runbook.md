# Codex on the VPS shared estate — setup/check runbook (Session 1 handoff)

Target: a Codex task whose process runs on the VPS inside the private host
workspace resolved from the migrated opaque `workspace_id`, sharing durable
context with Hermes (approved skills, maps, global+project memory scopes)
while keeping transcripts and credentials separate. This remains unproven
until the live canary passes; nothing here is deployed by Session 5.

## 1. Discovered mechanism (read-only, current state)

- Codex CLI installed at `/usr/bin/codex`; subcommands include `exec`,
  `app-server`, `remote-control`. The supported launch path is
  `codex exec` run **on the VPS itself** (the task process is local to the
  checkout), driven by `scripts/codex-vps/launch_codex_task.sh`.
- `/root/.codex/config.toml` exists (contents intentionally not read).
- Session 1 decides whether Codex Desktop remote/saved-project registration
  is required; if no product-supported remote path exists for Desktop, the
  CLI path above is the frozen supported adapter and Desktop stays unmanaged.

## 2. Least privilege (`setup_codex_user.sh`)

- `codex` (uid 1001) is not root and not in group `hermes` — enforced.
- Observed over-broad memberships at audit: `sudo`, `docker`, `users`.
  Narrowing them is a host-owner decision; the script records and fails on
  new memberships only.
- Per-project: group `frank-proj-<slug>`, recursive chgrp/chmod g+rwX,
  inherited setgid on directories, `git config safe.directory` per root.
  The `codex` user can edit only registered authorized projects.
- World-writable project roots are forbidden; the launcher never runs as
  root; no static compose edit is required (visibility below).

## 3. Lease-gated launch (`launch_codex_task.sh`)

1. Resolve `workspace_id` → private host path via the Session-1 resolve
   endpoint (server-side only; browser DTOs never see it).
2. Acquire the exclusive workspace lease (private authenticated endpoint).
   Busy workspace → immediate refusal; the task never enters the checkout.
3. Heartbeat every `FRANK_HEARTBEAT_SECONDS` with the random generation,
   which stays inside the launcher process (never exported to the task).
4. Run `codex exec …` in the resolved path. Codex reads repository
   `AGENTS.md`, sees `/srv/skills` through its supported shared user-skill
   path (runtime-owned `.system` skills remain owned by runtimes), and reads
   current generated knowledge/maps.
5. Release after verified exit; renewal loss terminates the task and fails
   closed. Frank restart reconciliation marks orphaned leases `reconciling`
   and resolves them through the authoritative owner verifier.

## 4. New-project visibility (contract-selected mechanism)

Implement whichever mechanism the frozen contract selects:

- Option A — dynamically generated explicit read-only mounts on controlled
  restart (compose stays generated, not hand-edited), or
- Option B — restricted broker resolving only registered canonical
  workspaces.

Register a disposable project and prove Explorer sees/attaches it without
manual compose edits and without exposing arbitrary host paths.

## 5. Canary protocol (test group 10; disposable registered project)

1. Sequential: fresh Hermes task (lease generation A) creates `hermes-note.md`;
   fresh Codex task (generation B, different executor id) edits it and adds
   `codex-note.md`; a second Hermes task reads both. All under verified
   different lease generations.
2. Shared skill: both invoke the same approved skill from `/srv/skills`
   (checksum-identical with the catalogue).
3. Memory: both retrieve one global preference plus the correctly isolated
   project fact (`steven-v021canary-*` banks at the S5 canary allocation:
   state root `/srv/frank-canaries/s5-hermes-v021`, API `127.0.0.1:18646`,
   rich serve `127.0.0.1:19124`).
4. Maps: both read the same map revision (provenance envelope verified).
5. Race: start both simultaneously; prove exactly one enters the checkout
   and the other refuses/queues without writing anything.
6. Negative: the `codex` OS user cannot reach upstream
   `/api/plugins/kanban/*` (loopback plugin plane) — expect connection/
   authorization failure.
7. No authoritative local copy: verify no clone/checkout was created outside
   the registered VPS root; `C:\Dev` and other PC paths stay non-authoritative.
8. Evidence: redacted outputs only — generations, checksums, file lists,
   exit codes. No secrets, no memory dumps.

## 6. What "same access" covers (and product boundaries)

Shared: registered project files (via lease), approved operator skills
(`/srv/skills`, checksum-parity with the catalogue), generated knowledge/maps
(current revision), Hindsight global+project scopes through the maintained
integration or Session-1-frozen private adapter, the durable Hermes task
interface through the contracted authenticated tool/CLI integration.

Not shared: live conversation transcripts, hidden reasoning, Hermes
credentials, direct database or raw loopback plugin access (negative canary
above), runtime-owned `.system` skill ownership. Codex tasks read the
repository `AGENTS.md` for instructions; they never read Hermes private
state mounts.

## 7. Check before any launch

```bash
bash -n scripts/codex-vps/launch_codex_task.sh
bash -n scripts/codex-vps/setup_codex_user.sh
python3 -m unittest tests.test_codex_launcher      # lease gating + fail-closed
```
