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

## Documentation precedence

Begin with [README.md](README.md) and [docs/README.md](docs/README.md).
Component guides under `apps/window/` and current contracts linked by the
index provide component-specific requirements, not competing shared rules.
