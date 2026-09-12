# Private owner CRM notifications

This bundle configures exactly two native Frappe Webhooks: `after_insert` for
`CRM Task` and `HD Ticket`. Both enqueue on Frappe's existing short worker and
POST a static, generic JSON alert to the ntfy JSON publish root, selecting the private topic from the payload. No custom Frappe
app, DocType, scheduler, event server, customer route, mail, or phone delivery
is introduced.

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