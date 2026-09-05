# Frank

Frank is Steven's visual Window and Hub on the VPS. Hermes is the brain: it
owns reasoning, model selection, tools, skills, memory, sessions, and
execution. Frank renders and forwards work; it does not duplicate Hermes
state.

There is one application source: [apps/window](apps/window). Start with
[docs/README.md](docs/README.md), then use [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
for verification and supported extensions.

## Production

- Source: `/projects/frank`
- App: `frank-window`
- Gateway: `frank-caddy`
- Persistent chats/uploads: `/srv/frank/data/window`
- Runtime secrets: `/srv/frank/secrets/window.env`
- Public URL: `https://frank.fail`

Deployments originate from a committed Git revision:

```bash
cd /projects/frank/apps/window
npm ci --ignore-scripts
npm run verify
cd /projects/frank
bash apps/window/deploy.sh
```

The deployment preserves data, builds the Window image, performs a short
atomic cutover, and checks container health. Follow
[docs/FRANK_RELEASE_RUNBOOK.md](docs/FRANK_RELEASE_RUNBOOK.md) for the full
release and browser-acceptance procedure.
