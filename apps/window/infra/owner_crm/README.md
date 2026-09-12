# Owner CRM foundation

This is a native, isolated Frappe site for the owner, not the existing
Blockwise property-lead CRM. It bundles upstream Frappe CRM, Frappe Telephony
(required by Helpdesk), and Frappe Helpdesk in one immutable image. There is no
ERPNext, custom business app, customer network, public route, or mail sender.
Stripe remains the billing authority and Mautic is deliberately outside this
initial foundation.

## Deployment seam

The committed source lives here. Runtime state is outside Git:

| Concern | Location |
| --- | --- |
| Secrets | `/srv/frank/secrets/owner-crm.env`, mode `0600` |
| Database, site files and logs | `/srv/frank/owner-crm/`, mode `0700` |
| Optional encrypted-backup destination | `/srv/frank/owner-crm-backups/` or another mounted disk |
| Browser exposure | `127.0.0.1:18081` only, with no Caddy route |

The compose project is named `owner-crm`, uses an internal-only Docker network,
and is separate from `blockwise-crm` and `blockwise-product`. It must be run
from a committed Frank release checkout, never by editing runtime files.

## Upstream compatibility and image

`pins.env` records the exact accepted upstream source commits. `build-image.sh`
first verifies those refs, then invokes the official `frappe_docker` custom
Containerfile at its pinned revision. CRM and Helpdesk are release tags;
Telephony has no upstream release tag, so the build rejects a moved `develop`
ref rather than silently installing different code. The build also refuses to
start below 15 GiB free disk space.

Frappe Helpdesk `v1.30.1` requires Frappe `>=15.116.1` and Telephony. This
foundation therefore pins Frappe `v15.120.1`, CRM `v1.83.0`, Helpdesk `v1.30.1`,
and the accepted Telephony commit. The build checks that all four app folders
exist in the finished image.

```bash
apps/window/infra/owner_crm/bin/build-image.sh frappe15.120.1-crm1.83.0-helpdesk1.30.1
```

Do not reuse the customer `blockwise-crm-app` image: it carries the
customer-specific Blockwise app and does not contain Helpdesk.

## First provision

Copy `.env.example` to `/srv/frank/secrets/owner-crm.env`, set two long random
passwords, and keep the file out of Git. After the image is built, use only the
wrapper:

```bash
apps/window/infra/owner_crm/bin/owner-crm config
apps/window/infra/owner_crm/bin/owner-crm create-site
# create-site starts the runtime after a successful fresh site build
apps/window/infra/owner_crm/bin/owner-crm health
```

`create-site` creates `owner.crm.internal` only when it does not already exist;
it never drops, resets, or imports an existing site. It installs CRM, Telephony,
and Helpdesk natively, then runs migrations.

## Mail, scheduler, ingress and backup safety

Mail is disabled at two levels: no scheduler container exists, and both common
and site config set `mute_emails=1` and `enable_scheduler=0`. The setup wizard
therefore has no scheduled or normal Frappe mail path. Enabling mail, a
scheduler, a Caddy route, a sender, or any paid service is a separate change
with its own review and test.

This foundation does not claim a backup exists. `owner-crm backup-preflight`
requires an `age` public recipient and a backup root outside the live runtime
before backup work can be enabled. It is only a readiness gate: an off-host
identity escrow and a recorded restore test are still required before a backup
can be called operational.

## Health evidence

`owner-crm health` checks the loopback ping, active frontend, and that CRM,
Telephony, and Helpdesk are installed. It also checks the live site config for
both mail and scheduler disablement. A green compose configuration or image
build alone is not runtime evidence.
