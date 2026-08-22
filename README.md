# Frank

Frank is Steven’s visual Window and Hub on the VPS. Hermes is the brain.

There is one implementation: [`apps/window`](apps/window). It provides the
Hub chat, VPS file explorer, project surfaces, tools, traces, and releases,
while forwarding thinking and tool work to Hermes.

## Production

- Source: `/projects/frank`
- App: `frank-window`
- Gateway: `frank-caddy`
- Persistent chats/uploads: `/srv/frank/data/window`
- Runtime secrets: `/srv/frank/secrets/window.env`
- Public URL: `https://frank.fail`

Deployments originate from a committed Git revision:

```bash
cd /projects/frank
git pull --ff-only
bash apps/window/deploy.sh
```

The deployment preserves data, builds the Window image, performs a short
atomic cutover, and checks container health.

Hermes memory is deployed separately because it belongs to the brain, not the
Window. See [`docs/MEMORY.md`](docs/MEMORY.md).
