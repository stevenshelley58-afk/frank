# Frank release runbook

## Mautic and Chatwoot operator contract

Set `MAUTIC_BASE_URL` and `CHATWOOT_BASE_URL` only to HTTPS origins and leave
both connector statuses `unconfigured` until the Hermes provider adapters have
verified them. Use `configured` for credentials present but verification
pending, `ready` only after Hermes/operator verification, and `error` when
Hermes reports a safe failure category. Frank does not receive or print any
provider secret. Hermes may refresh the redacted support projection at
`SUPPORT_CONVERSATIONS_FILE`; validate it through
`GET /api/support/conversations` before enabling a Blockwise support link.

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
FRANK_BROWSER_BASIC_AUTH_USER="$FRANK_BASIC_AUTH_USER" \
FRANK_BROWSER_BASIC_AUTH_PASSWORD="$FRANK_BASIC_AUTH_PASSWORD" \
  python acceptance/browser_journey.py --url https://frank.fail --output /secure/frank-browser-receipt.json
```

The storage-state file and both Basic Auth variables are supplied only by the
operator and are never committed, printed, or copied into the receipt. The
receipt contains both desktop and mobile journeys and must be reviewed by the
release gate.

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
   The deploy installs/verifies all host control-plane units and creates
   `/srv/frank/backups/control-plane` as a root-owned `0750` directory. A fresh
   install (or an invalid/missing current release pointer) leaves every timer
   stopped and disabled; a routine deploy preserves timers only when the
   existing production current pointer and immutable release record validate.
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

## Production control maps

### First-release Step 5 browser bootstrap

On a fresh host, the read-only browser journey cannot exercise `/live`,
`/map`, or `/control` while all flags are at their default `false` values.
After the six-map preview has been promoted, bootstrap only the Step 5 flags
with the fixed helper, then recreate Window and run the real desktop/mobile
browser journey. The helper writes a separate private canary flag file, never
touches the canonical release flag file or release `current.json`, and refuses
to run if any release selector already exists:

```sh
sudo /usr/bin/python3 /projects/frank/apps/window/scripts/bootstrap_step5_canary.py apply
FRANK_STORAGE_STATE=/secure/frank-storage-state.json \
FRANK_BROWSER_BASIC_AUTH_USER="$FRANK_BASIC_AUTH_USER" \
FRANK_BROWSER_BASIC_AUTH_PASSWORD="$FRANK_BASIC_AUTH_PASSWORD" \
  python3 /projects/frank/apps/window/acceptance/browser_journey.py \
  --url https://frank.fail --output /srv/frank/data/window/evidence/browser.json
```

Capture and promote the Step 5 release using that receipt. If the canary must
be abandoned, restore the pre-canary state and recreate Window deterministically:

```sh
sudo /usr/bin/python3 /projects/frank/apps/window/scripts/bootstrap_step5_canary.py cleanup
```

After Step 5 promotion, run cleanup once to complete the guarded handoff from
the temporary canary flags to the validated canonical Step 5 release. The
helper rejects a missing, invalid, or non-Step-5 release selector. Every later
stage follows the same order: capture fixed inputs, promote exactly one stage,
recreate Window, wait for health, and run the canary before proceeding. The
required order is `step5 -> step6c ->
step7c -> step8`; Step 8 additionally requires the passing restore-drill
receipt. Promote maps before evidence capture because capture reads the
production `maps/current.json` selector.

Before enabling `retention_restore_drills`, run the fixed-input restore drill
as root on the VPS. It archives the bounded control-graph tree, restores it
under a new isolated backup directory, compares every file hash, and emits a
redacted `receipt.json`; it never writes over live state:

```sh
sudo /usr/bin/python3 /projects/frank/apps/window/scripts/run_restore_drill.py
```

Require the nested evidence schema `frank.restore-drill-evidence/v1`,
`status: passed`, `outcome: pass`, `content_match: true`, and the
non-placeholder `receipt_id` from the resulting JSON. Supply that receipt to
the Step 8 evidence capture; it is deliberately not the generic control-plane
receipt schema, and a metadata-only scheduled-job receipt is not restore proof.

Capture staged release evidence with the same fixed inputs before promotion;
use `--stage step5`, `step6c`, or `step7c` for the corresponding flag set, and
`--stage step8 --restore-receipt` only after the restore drill passes:

```bash
python3 /projects/frank/apps/window/scripts/capture_control_release_evidence.py \
  --stage step7c --maps-root /srv/frank/data/window/maps \
  --browser-receipt /srv/frank/data/window/evidence/browser.json \
  --tests /srv/frank/data/window/evidence/tests.json \
  --runtime-evidence /srv/frank/data/window/evidence/runtime.json \
  --release-id rel-step7c --source-sha <source-sha> --deployed-sha <deployed-sha> \
  --image-digest <image-digest> --rollback-target <rollback-sha> \
  --reviewer <reviewer> --output-dir /srv/frank/data/window/evidence/rel-step7c
```

The accepted graph input is the regular pointer at
`/srv/frank/data/window/control-graph/graph/current.json`. The generator reads
that pointer and emits one passing receipt containing exactly six maps: VPS
World, Frank Architecture, Blockwise Runtime, Mini Frank Knowledge Flow, Ad
Template Builder Architecture, and Ad Template Builder Workflow. Preview
artifacts remain under `/srv/frank/data/window/maps/maps/` until promotion.

Persist the generator receipt atomically, then promote that exact regular file:

```sh
map_receipt=/srv/frank/data/window/control-graph/evidence/map-generation-receipt.json
sudo /usr/bin/python3 /projects/frank/apps/window/scripts/generate_control_maps.py \
  --graph /srv/frank/data/window/control-graph/graph/current.json \
  --preview-root /srv/frank/data/window/maps \
  --receipt-out "$map_receipt" \
  --timeout 120
sudo /usr/bin/python3 /projects/frank/apps/window/scripts/promote_map_release.py \
  "$map_receipt" \
  --production-root /srv/frank/data/window/maps \
  --timeout 300
```

Promotion verifies every persisted manifest and artifact hash, writes an
immutable release record, and then atomically advances only
`/srv/frank/data/window/maps/current.json`. That selector contains the shared
graph revision plus each projection's manifest path, artifact path, and hashes;
the Window reads it as one consistent production snapshot. A failed or
tampered promotion leaves the previous selector (the last-known-good release)
untouched. Set `MAP_PREVIEW_RUN_KEY` only for an explicitly isolated preview;
production compose has no default preview key.

## Ownership boundary

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
  --production-root /srv/frank/data/window/maps
```

Promotion publishes immutable manifests and atomically advances `current.json`;
any validation, hash, timeout, or path failure preserves the last-known-good
pointer. Keep the receipt, graph/reconciliation hashes, Archify pin, test
evidence, and rollback SHA together for sign-off. Never claim Ad Builder
consumption from a diagram or declaration alone.
