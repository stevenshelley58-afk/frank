# Frank release runbook

This is the Frank-owned release order for the Connections and private vault
integration. It is executed only after the Frank revision, Hermes plugin
contract, broker route/port, and Infisical bundle have been reviewed together.
No step publishes the private ingress or weakens public Caddy header policy.

## Safe base-Window release

The Window may be released before the separately owned Hermes Connections
Agent or vault broker exists. In that state, keep
`HERMES_CONNECTIONS_AGENT_KEY`, `HERMES_VAULT_BROKER_KEY`, and
`HERMES_VAULT_BROKER_URL` absent rather than inventing placeholders. The
deployment requires only the existing Hermes API and Frank basic-auth values;
authenticated agent routes remain disabled, and vault/provider health reports
`setup_needed`. This is a fail-closed partial activation, not evidence that the
private integrations are live.

Run the full order below before adding any of those three values or claiming
the private integrations are active.

## Release order

1. **Validate `/srv/frank/secrets/window.env`.** Work on the VPS with the
   candidate SHA checked out at `/projects/frank`. Confirm the file exists, is
   a regular non-symlink, and is mode `0600`; refuse the release otherwise.
   Do not print or copy the file to logs. Confirm that the Frank-required keys
   are present, including the exact Hermes-supplied
   `HERMES_VAULT_BROKER_URL`; never invent a dashboard or main-API port.

2. **Seed the Frank keys.** Populate the existing `window.env` through the
   approved secret handoff, preserving its `0600` mode. The required values
   are `HERMES_API_KEY`, basic-auth user/hash,
   `HERMES_CONNECTIONS_AGENT_KEY`, `HERMES_VAULT_BROKER_KEY`, and the exact
   `HERMES_VAULT_BROKER_URL`. Frank stores no Infisical client secret.

3. **Start and private-canary Infisical.** From
   `apps/window/infra/infisical`, run `./deploy.sh` and `./check.sh`. Confirm
   the service is bound only to `127.0.0.1:18082`, its health/status endpoint
   responds through the private path, and its database/Redis remain internal.
   Preserve named volumes; never use `docker compose down -v`.

4. **Bootstrap Hermes config and credentials.** Run the accepted Infisical
   bootstrap with the Hermes-owned `HERMES_SECRET_FILE`. Keep Universal Auth
   client credentials in Hermes' `0600` secret store, not in Frank, and place
   runtime callback/Infisical URLs in Hermes `config.yaml`, not Frank's root
   `.env.example`. The Frank callback URL is the private host-side
   `http://127.0.0.1:18080`.

5. **Deploy and canary the Hermes Connections Agent.** Install the named
   Connections Agent in Hermes' single `default` profile. Configure its exact
   authenticated inspect and plan/apply seams and the exact broker route
   supplied by the Hermes lane. Run the Hermes provider-receipt canary:
   manual connected metadata -> Frank plan/apply `202 waiting_for_provider` ->
   authenticated Hermes receipt -> verified. A direct metadata PATCH to
   `verified` is not a valid canary.

6. **Verify the private ports `18082` and `18080`.** Confirm Infisical remains
   loopback-only and the Frank Window is bound as
   `127.0.0.1:18080:8080`. Exercise the authenticated Hermes callback through
   that private path and verify Authorization is preserved. Public Caddy must
   continue stripping Authorization before proxying to the browser-facing
   Window; do not add a public unauthenticated callback route.

7. **Deploy Frank.** Run `apps/window/deploy.sh` for the exact committed SHA.
   It validates the secret boundary, derives a Caddy env file containing only
   basic-auth settings, and uses the existing private basic-auth hash solely
   for Caddy's overwritten internal vault operator-attestation header. Caddy
   must strip any incoming header and never log or return it. The deploy then
   builds the Window image, imports the runtime modules
   inside the container, waits for the healthcheck, and runs the API health
   canary. Preserve `/srv/frank/data/window`, including chat data and uploads.

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

Frank owns this order, its loopback compose bindings, Caddy least-privilege
environment, image import/health canary, and data-preserving rollback. Hermes
owns its `default` profile, `config.yaml`, Connections Agent registration,
provider adapters, receipt truth, and the final vault broker route/port. The
release is not complete until both owners have signed the same candidate SHA
and route contract.
