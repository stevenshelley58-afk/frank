# Hermes owner CRM Contact sync

A deterministic, opt-in Hermes `default` plugin that reads only the protected Blockwise owner snapshot and calls the isolated owner Frappe CRM loopback API. It has no LLM, queue, dashboard, public listener, database access, mail action, deletion, or entitlement inference.

Preview performs no writes. Apply matches Contacts only by both immutable Blockwise IDs. It never searches, merges, or updates email addresses, preserving operator-managed Contact email rows. It preserves unrelated fields, holds source ambiguities/conflicting IDs, skips stale `sourceObservedAt`, prechecks Frappe `modified`, carries that value in the update, and reads back every write before counting success.

The root-owned activation file is `/srv/hermes/secrets/owner-crm-sync.env`, `hermes:hermes`, mode `0600`: `OWNER_CRM_SNAPSHOT_AUTH_SECRET`, `OWNER_CRM_FRAPPE_API_KEY`, `OWNER_CRM_FRAPPE_API_SECRET`, `HERMES_OWNER_CRM_SYNC_SNAPSHOT_URL`, and `HERMES_OWNER_CRM_SYNC_FRAPPE_URL`. The snapshot is signed with the canonical `internal-auth.ts` newline format, scope `owner-crm.customer-snapshot`. Frappe credentials belong to `crm-sync@blockwise.sale`, a least-privilege Contact read/create/write user, not Administrator.

`deploy.sh` installs source/plugin only. `activate-cron.sh` creates the supported native Hermes `cron create 15m --script ... --no-agent` job after endpoint and service-account acceptance. Pause or rollback with native Hermes cron disable/remove; no systemd timer is installed.
