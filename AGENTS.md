# Frank project rules

The shared engineering, verification, security, and delivery rules live in
[docs/standards/engineering-rules.md](docs/standards/engineering-rules.md).
This file is the project-specific entry point. If a historical handoff or
component note conflicts with the current guides, follow the current guide and
record any necessary correction in the appropriate document.

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
