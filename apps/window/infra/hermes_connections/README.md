# Live Hermes Connections and vault broker

This bundle installs the named `connections-agent` user plugin into the existing
single Hermes `default` profile and runs the narrow vault broker as the
dedicated `hermes` user. It does not add an agent loop to Frank. The broker is
bound only to Frank's private Docker gateway at `172.16.1.1:18083`, protected
by a dedicated bearer credential, and uses Universal Auth against the private
Infisical CE service at `127.0.0.1:18082`.

From the exact committed Frank revision on the VPS, after Infisical bootstrap:

```bash
cd /projects/frank/apps/window/infra/hermes_connections
./deploy.sh
./check.sh
```

The deploy creates dedicated random Connections and broker keys in
`/srv/hermes/secrets/connections.env`, copies only those two values and the
loopback broker URL into `/srv/frank/secrets/window.env`, enables the Hermes
plugin, installs the hardened systemd unit, and restarts the existing Hermes
services. Secret values are never printed or committed.
