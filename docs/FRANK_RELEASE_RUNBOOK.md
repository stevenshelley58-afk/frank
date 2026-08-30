# Frank release runbook

This is the Frank-owned release order for the Connections and private vault
integration. It is executed only after the Frank revision, Hermes plugin
contract, broker route/port, and Infisical bundle have been reviewed together.
No step publishes the private ingress or weakens public Caddy header policy.

## Complete production release

### Browser acceptance setup

Run this from `apps/window` in a disposable virtual environment before the
release gate. The browser harness refuses synthetic evidence and requires an
operator-supplied Playwright storage-state file:

```sh
python -m pip install -r requirements-acceptance.txt
python -m playwright install chromium
FRANK_STORAGE_STATE=/secure/frank-storage-state.json \
  python acceptance/browser_journey.py --url https://frank.fail --output /secure/frank-browser-receipt.json
```

The storage-state file is never committed or printed. The receipt contains
both desktop and mobile journeys and must be reviewed by the release gate.

Activate private Infisical and the Hermes Connections bundle before the Window
deploy. The activation generates dedicated keys on the VPS, bootstraps a
fixed-scope Universal Auth identity, enables the opt-in Hermes plugin, starts
the private broker, and writes only the two dedicated Frank credentials plus
the private broker URL into Window's 0600 environment file.

The base Window deploy remains fail-closed when these services are unavailable,
which preserves recovery and rollback safety. A complete release is not signed
off until the Hermes plugin, broker, and vault checks below are live.

## Release order

1. **Validate `/srv/frank/secrets/window.env`.** Work on the VPS with the
   candidate SHA checked out at `/projects/frank`. Confirm the file exists, is
   a regular non-symlink, and is mode `0600`; refuse the release otherwise.
   Do not print or copy the file to logs. Confirm the core Hermes API and Frank
   basic-auth values are present. The activation bundle adds the broker values;
   never invent a dashboard or main-API port.

2. **Start and private-canary Infisical.** From
   `apps/window/infra/infisical`, run `./deploy.sh` and `./check.sh`. Confirm
   the service is bound only to `127.0.0.1:18082`, its health/status endpoint
   responds through the private path, and its database/Redis remain internal.
   Preserve named volumes; never use `docker compose down -v`.

3. **Bootstrap Hermes config and credentials.** Run
   `./bootstrap-instance.sh` from the Infisical bundle. Keep Universal Auth
   client credentials in Hermes' `0600` secret store, not in Frank, and place
   runtime callback/Infisical URLs in Hermes `config.yaml`, not Frank's root
   `.env.example`. The Frank callback URL is the private host-side
   `http://127.0.0.1:18080`.

4. **Deploy the Hermes Connections Agent and broker.** Run `./deploy.sh` and
   `./check.sh` from `apps/window/infra/hermes_connections`. The committed
   `hermes_connections` bundle installs the named plugin in Hermes' single
   `default` profile and starts the authenticated broker on Frank's private
   Docker gateway. The bundle generates the dedicated keys without printing
   them and gives Frank no Infisical identity or client secret.

5. **Verify private ports `18082`, `18083`, and `18080`.** Confirm Infisical remains
   loopback-only and the Frank Window is bound as
   `127.0.0.1:18080:8080`. Exercise the authenticated Hermes callback through
   that private path and verify Authorization is preserved. Public Caddy must
   continue stripping Authorization before proxying to the browser-facing
   Window; do not add a public unauthenticated callback route.

6. **Deploy Frank.** Run `apps/window/deploy.sh` for the exact committed SHA.
   It validates the secret boundary, derives a Caddy env file containing only
   basic-auth settings, and uses the existing private basic-auth hash solely
   for Caddy's overwritten internal vault operator-attestation header. Caddy
   must strip any incoming header and never log or return it. The deploy then
   builds the Window image, imports the runtime modules
   inside the container, waits for the healthcheck, and runs the API health
   canary. Preserve `/srv/frank/data/window`, including chat data and uploads.
   The feature-flag file is a Compose `env_file` and is read only when the
   Window container is created. After `promote_control_release.py` changes a
   release flag set, rerun this exact deploy (or its fixed
   `docker compose up -d --force-recreate frank-window` step), wait for health,
   and verify `/api/control/overview` reports the exact promoted flags. A flag
   promotion without that recreation and canary is incomplete. Rollback must
   restore the prior release record and flags, then recreate and canary Window
   the same way.

7. **Run the end-to-end private canary.** Exercise authenticated Hermes inspect
   and the vault health route through Frank. Then run the provider-receipt
   sequence: connected metadata -> Frank plan/apply `202 waiting_for_provider`
   -> authenticated Hermes receipt -> verified. A direct metadata PATCH to
   `verified` is not a valid canary.

## Rollback

Record the previous Frank SHA, image digest, Hermes config revision, and
Infisical image/compose revision before step 1. If any private canary or
healthcheck fails, stop the cutover and restore the previous Frank revision
and image, then run its health/API canary. Keep the existing chat data and
Infisical named volumes; do not delete or recreate them as a first response.

If the Hermes plugin or broker contract fails, roll Hermes back to its prior
config/plugin revision first, restore the previous Frank revision if needed,
and retain the dedicated keys until the incident is understood. Re-run the
private port checks and provider-receipt canary before attempting the release
again. A blank or guessed vault broker URL is always a release blocker.

## Ownership boundary

## Production control maps

The accepted graph input is the regular pointer at
`/srv/frank/data/window/control-graph/graph/current.json`. The generator reads
that pointer and emits one passing receipt containing exactly six maps: VPS
World, Frank Architecture, Blockwise Runtime, Mini Frank Knowledge Flow, Ad
Template Builder Architecture, and Ad Template Builder Workflow. Preview
artifacts remain under `/srv/frank/data/window/maps/maps/` until promotion.

Promotion verifies every persisted manifest and artifact hash, writes an
immutable release record, and then atomically advances only
`/srv/frank/data/window/maps/current.json`. That selector contains the shared
graph revision plus each projection's manifest path, artifact path, and hashes;
the Window reads it as one consistent production snapshot. A failed or
tampered promotion leaves the previous selector (the last-known-good release)
untouched. Set `MAP_PREVIEW_RUN_KEY` only for an explicitly isolated preview;
production compose has no default preview key.

Frank owns this order, its loopback compose bindings, Caddy least-privilege
environment, image import/health canary, and data-preserving rollback. Hermes
owns its `default` profile, `config.yaml`, Connections Agent registration,
provider adapters, receipt truth, and the final vault broker route/port. The
release is not complete until both owners have signed the same candidate SHA
and route contract.

## Control, map, and scheduled evidence

The Window Control/Live/Map surfaces are read-only projections. Hermes remains
the action boundary; browser requests never execute collectors or provider
actions directly. Scheduled jobs are opt-in feature flags and use fixed inputs:
cleanup, discovery, evaluation, chat-pattern candidates, and retention drills
write only redacted metadata receipts under the schedules root. They never
install, delete, or mutate source data.

Run a bounded scheduler manually with:

```bash
python3 apps/window/scripts/run_scheduled_control_job.py discovery --timeout 1800
```

Map promotion is separate from deploy health and is fail-closed. It requires a
passing preview receipt containing exactly the six mandatory projections; the
Ad Builder-to-Blockwise flow is omitted unless runtime-consumption evidence is
explicitly present:

```bash
python3 apps/window/scripts/promote_map_release.py RECEIPT.json \
  --production-root /srv/frank/data/window/control-graph/maps
```

Promotion publishes immutable manifests and atomically advances `current.json`;
any validation, hash, timeout, or path failure preserves the last-known-good
pointer. Keep the receipt, graph/reconciliation hashes, Archify pin, test
evidence, and rollback SHA together for sign-off. Never claim Ad Builder
consumption from a diagram or declaration alone.
