# Frank agent rules

## One Frank

Frank is one lightweight Window and Hub. Its only application source is
`apps/window`, and its only production checkout is `/projects/frank` on the
VPS. Do not create a second Frank UI, API, agent runtime, checkout, deployment
stack, memory store, skills tree, or database.

## Boundary

Frank displays work, chats, files, tools, traces, and releases. Hermes is the
only brain: reasoning, model selection, tools, skills, memory, and autonomous
work belong to Hermes. Frank may forward requests and render results; it must
not implement an agent loop or duplicate Hermes state.

Hermes has one VPS profile (`default`). Frank is an unassigned session in that
profile. Product bodies of work are projects/workspaces inside the profile,
never additional Hermes profiles.

## Data and security

- Browse only the explicit read-only mounts beneath `/vps` in the container.
- Keep chats in `/srv/frank/data/window` and secrets in
  `/srv/frank/secrets/window.env`; neither belongs in Git.
- Never expose dotfiles, credentials, databases, private keys, or Hermes state.
- Preserve existing chat data during deploys.

## Delivery

1. Start from current `main`.
2. Run `python -m unittest discover -s apps/window/tests` from `apps/window`
   and `node --check` on every JavaScript file.
3. Build the container before release.
4. Commit and push the exact revision.
5. Deploy only that committed revision with `apps/window/deploy.sh` on the VPS.
6. Verify `frank.fail` in a real browser, including the changed interaction.

Do not patch production source files in place.
