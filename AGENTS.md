# Frank project rules

The single canonical rulebook for this VPS is
[`/projects/blockwise/AGENTS.md`](/projects/blockwise/AGENTS.md). It carries the
shared engineering rules, the Frank and Hermes boundaries, the non-negotiable
constitution, and the permission posture. Read it first.

This file adds Frank-specific detail only. It does not repeat the canonical
rules and it is not a second rulebook. If a historical handoff or component note
conflicts with the current guides, follow the current guide and record the
correction in the right document.

## Product boundary

- Frank is one lightweight Window and Hub. Its only application source and
  canonical production checkout are `apps/window` and `/projects/frank` on the
  VPS.
- Hermes is the sole brain and executor. Frank renders and forwards work; it
  must not add an agent loop, provider runtime, duplicate memory store, or
  second Hermes profile.
- Hermes uses one VPS profile, `default`. Product workspaces are projects
  inside that profile. Blockwise is a separate customer product, not a second
  Frank application or deployment.

## Data and security boundary

- Keep Frank chats and uploads in `/srv/frank/data/window` and runtime secrets
  in `/srv/frank/secrets/window.env`; neither belongs in Git.
- Never expose dotfiles, credentials, databases, private keys, or Hermes state.
- Preserve existing chat data during releases. Keep authentication, approval,
  consent, and fail-closed controls intact.

## Source and checkout hygiene

- `/projects/frank` on `main` is the sole maintained source and the only
  production checkout. It is for reading, fetching, releasing and merging only.
  Every other checkout is a dated snapshot whose rule and doc files never
  override the canonical ones.
- **Edit in your own worktree, never in `/projects/frank`.** Sessions share the
  canonical checkout, so an uncommitted edit there is not private: it lands in
  whatever another session stages next. Claim one with

      git -C /projects/frank worktree add -b <task> /projects/frank-worktrees/<task> origin/main

  and commit there. Remove the worktree and its branch once the work is merged
  or abandoned; the hourly sweep removes them for you once they are merged,
  clean and idle.
- `/projects/frank-worktrees` is the single parent for those worktrees. It is
  owned `root:hermes` with mode `2775` (setgid and group-writable), so every
  agent account in the `hermes` group claims and removes its own without root;
  `apps/window/infra/checkout/install-checkout-hygiene.sh` creates it and
  verifies that mode and the hook permissions on every release.
- A commit guard refuses a commit that would publish a file last modified before
  this session started: that file is another session's work, not yours. Commit
  only files you changed. For a deliberate exception, and only then, use
  `FRANK_ALLOW_PRIOR_FILES=1 git commit ...`.
- `apps/window/infra/checkout/` owns the automation behind all of this: an
  hourly sweep, a weekly backstop that bounds release worktrees and reports every
  retained checkout, and a sweep on every release. It appends to
  `/srv/frank/checkout-hygiene.log`. Nothing here needs a human to remember a
  command. It never deletes unmerged commits or uncommitted work; see
  [the component guide](apps/window/infra/checkout/README.md).

## Documentation precedence

Begin with [README.md](README.md) and [docs/README.md](docs/README.md).
Component guides under `apps/window/` and current contracts linked by the
index provide component-specific requirements, not competing shared rules.
