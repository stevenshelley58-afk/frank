# Hermes memory deployment

This bundle configures the Hindsight provider already shipped by Hermes and a
private read/write bridge used by Frank's project Memory inspector. It does not
add a database, worker, model runtime, or second Hermes profile. Frank stores
no memory data.

Run from the committed production checkout as root:

```bash
cd /projects/frank
bash apps/window/infra/memory/deploy.sh
```

The deploy installs the all-in-one local runtime version compatible with the
production Hermes release, copies the existing DeepSeek key into Hermes'
provider-specific secret variable without printing it, activates the provider,
restarts Hermes, and runs the health contract.

The inspector bridge uses `systemd-socket-proxyd` to expose the native
loopback Hindsight API only on the existing Frank Docker network at
`172.16.1.1:9178`. No public listener and no local-development Docker runtime
are required.

Project isolation is supplied by Hermes runtime context. A session bound to
`/projects/blockwise` passes the stable workspace slug `blockwise`; the native
bank template resolves that to `steven-blockwise`. An unassigned session uses
the explicit `steven-unassigned` fallback. No caller may set one static
workspace value for every session.
