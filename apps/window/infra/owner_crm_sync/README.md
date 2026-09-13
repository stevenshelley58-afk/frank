# Owner customer sync

Minimal custom connection because neither native Frappe nor Blockwise exposes an upstream integration for this application-specific snapshot. All contacts, unique indexes and review tasks are native Frappe records. No custom queue, customer dashboard, provider runtime or model loop.

Source: protected `https://blockwise.sale/api/internal/ops/owner-crm-snapshot`, dedicated HMAC credential, replay protection, bounded ordered pages. Destination: only owner.crm.internal on loopback18081. Never the customer-agency CRM.

Native identity `crm-sync@blockwise.sale` has Contact and CRM Task read/create/write, Custom Field read only. No administrator, deletion, email, export or billing privileges. Bootstrap uses committed `provision.py --apply`; credentials are private in `/srv/hermes/secrets/owner-crm-sync.env` and are never given to Frank Window.

`customer_sync.py` defaults to preview. Apply uses immutable profile+workspace IDs, holds conflicts/ambiguous owners, rejects stale observations, carries native modified concurrency tokens and reconciles uncertain writes. Initial email/name are populated atomically; later operator contact details are preserved. Raw source trial/access/subscription facts mirror without granting access or charging. Every successful observation updates its watermark; replaying the identical observation is unchanged.

`operate.py preview|run|pause|resume|status` is the deterministic Hermes script entry point. It holds an exclusive lock and private aggregate last-run receipt under `/srv/hermes/state/owner-crm-sync`. Review exceptions use native CRM Tasks. Native Hermes script-only cron supplies cadence without model calls; activation must follow signed-source and native round-trip verification. A zero exit code does not imply no held records: inspect summary and native review tasks.

Tests: `python3 -m unittest discover -s apps/window/infra/owner_crm_sync`.

Build boundary: this component does not configure human mail, sequences, signup billing, phone notification receipt or offsite backups. These require separate end-to-end acceptance. Never treat this connector as proof of the whole CRM launch.
