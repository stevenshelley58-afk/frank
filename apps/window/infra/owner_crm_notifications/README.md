# Private owner CRM notifications

This bundle configures five native Frappe Webhooks: four private alerts plus a
second Communication `after_insert` hook for owner-mail reply stopping. The Communication hooks are
restricted by native Frappe condition to communication_medium == Email and
sent_or_received == Received, so outgoing email does not alert. All hooks
enqueue on Frappe's existing short worker and POST a static, generic JSON alert
to the ntfy JSON publish root. No custom Frappe app, DocType, event server,
customer route, mail, or phone delivery is introduced.

The reply hook sends only the Communication identity, sender/recipient fields,
reply-link fields and bounded stored email headers. It never sends message
content. Native Frappe signs the exact JSON body with HMAC-SHA256 and sends it
only to the host-gateway receiver on `172.16.1.1:18085`; there is no public
route. The shared secret comes from the root-owned 0600
`/srv/hermes/secrets/owner-mail-events.env` file and is never committed or
printed.

ntfy joins the existing external Docker network `owner-crm_owner-crm-internal`
only to accept these private Webhook requests. Its public listener remains
loopback-only. The Webhook Authorization header is constructed at apply time
from the root-owned 0600 ntfy publisher credential and is never committed or
printed. Native ntfy keeps deny-all default ACLs, with publisher write-only and
owner read-only access to `owner-notifications`.

Run the adapter from a clean committed revision. Without `--apply` it only
preflights native DocTypes and rejects duplicates or incompatible Webhooks.

```bash
python3 apps/window/infra/owner_crm_notifications/setup_adapter.py
python3 apps/window/infra/owner_crm_notifications/setup_adapter.py --apply
```

A canary may create one clearly-labelled internal CRM Task. It is retained as
evidence. No device subscription or public route is enabled by this bundle.
