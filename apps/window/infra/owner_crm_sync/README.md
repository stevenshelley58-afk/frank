# Owner customer sync

Minimal custom connection because neither native Frappe nor Blockwise exposes an upstream integration for this application-specific snapshot. All contacts, unique indexes and review tasks are native Frappe records. No custom queue, customer dashboard, provider runtime or model loop.

Source: protected existing product loopback ingress `http://127.0.0.1:8080/api/internal/ops/owner-crm-snapshot`, fixed Host `blockwise.sale`, dedicated HMAC credential, no public edge dependency, replay protection, bounded ordered pages. Destination: only owner.crm.internal on loopback18081. Never the customer-agency CRM.

Native identity `crm-sync@blockwise.sale` has Contact and CRM Task read/create/write, Custom Field read only. No administrator role or billing privileges. Role permissions exclude deletion, email and export. Upstream Frappe Contact permission hooks can nevertheless allow document deletion, so provisioning installs a native Before Delete Server Script for this identity; the actual DELETE denial is tested. No custom Frappe app is installed. Bootstrap uses committed `provision.py --apply`; credentials are private in `/srv/hermes/secrets/owner-crm-sync.env` and are never given to Frank Window.

`customer_sync.py` defaults to preview. Apply uses immutable profile+workspace IDs, holds conflicts/ambiguous owners, rejects stale observations, carries native modified concurrency tokens and reconciles uncertain writes. Initial email/name are populated atomically; later operator names and primary emails are preserved, while a changed source email is appended as an alternate through the parent Contact update. Raw source trial/access/subscription facts mirror without granting access or charging. Every successful observation updates its watermark; replaying the identical observation is unchanged.

`operate.py preview|run|pause|resume|status` is the deterministic Hermes script entry point. It holds an exclusive lock and private aggregate last-run receipt under `/srv/hermes/state/owner-crm-sync`. Review exceptions use native CRM Tasks. Native Hermes script-only cron supplies cadence without model calls; activation must follow signed-source and native round-trip verification. A zero exit code does not imply no held records: inspect summary and native review tasks.

Tests: `python3 -m unittest discover -s apps/window/infra/owner_crm_sync`.

Build boundary: this component does not configure human mail, sequences, signup billing, phone notification receipt or offsite backups. These require separate end-to-end acceptance. Never treat this connector as proof of the whole CRM launch.
