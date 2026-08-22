# Hermes memory deployment

This bundle configures the Hindsight provider already shipped by Hermes. It
does not add a Frank memory API, database, worker, or second Hermes profile.

Run from the committed production checkout as root:

```bash
cd /projects/frank
bash apps/window/infra/memory/deploy.sh
```

The deploy installs the all-in-one local runtime version compatible with the
production Hermes release, copies the existing DeepSeek key into Hermes'
provider-specific secret variable without printing it, activates the provider,
restarts Hermes, and runs the health contract.

Project isolation is supplied by Hermes runtime context. A session bound to
`/projects/blockwise` passes the stable workspace slug `blockwise`; the native
bank template resolves that to `steven-blockwise`. An unassigned session uses
the explicit `steven-unassigned` fallback. No caller may set one static
workspace value for every session.
