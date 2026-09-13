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
| Manual local backup archive | `/srv/frank/backups/owner-crm/`, root-only mode `0700` |
| Browser exposure | `127.0.0.1:18081` only, with no Caddy route |

The compose project is named `owner-crm`, keeps data services on an internal-only Docker network,
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

Mail defaults to disabled at two levels: the native scheduler is behind the opt-in
`owner-mail` profile, and common/site config default to `mute_emails=1` and `enable_scheduler=0`. The setup wizard
therefore has no scheduled or normal Frappe mail path. Enabling mail, a
scheduler, a Caddy route, a sender, or any paid service is a separate change
with its own review and test.

`owner-crm backup` creates a manual native `bench backup --with-files` archive
at `/srv/frank/backups/owner-crm/`. It records checksums plus custom-field,
attachment-member, and site-config artifact manifests, all root-only. It is a
local copy only: there is no schedule, off-host destination, or RPO claim.

`owner-crm restore-drill` checks the newest local archive and restores it only
into a unique, temporary, internal-only compose project/site/database. Mail and
the scheduler stay disabled; the live owner site and every customer service are
not targets. A passing drill leaves its root-only receipt beside the archive,
then retires only the marked temporary drill resources. The receipt reports
actual restored public/private file counts: zero counts prove archive structure,
not non-empty attachment recovery. It verifies only `db_type`, mail, and scheduler
configuration, never restores database credentials; the original encryption key alone is restored without copying database credentials.
With `OWNER_CRM_VERIFY_EMAIL_ACCOUNT=1`, the isolated drill decrypts the real
Blockwise Owner Inbox credential and verifies a private HMAC against its protected
source secret, never printing either value. Without this flag, real credential
round-trip verification remains explicitly false. The drill also
creates harmless public/private attachments and an encrypted temporary setting only
inside its restored temporary source site, then uses a second native `--with-files`
backup and temporary recovery site to verify those staged fixtures and their original
encryption key. That receipt is explicitly staged-fixture provenance, not a claim
that the live backup contained those fixture records. `backup-preflight` remains the
separate `age`/off-host readiness gate; off-host escrow is unresolved.

## Health evidence

`owner-crm health` checks the loopback ping, active frontend, and that CRM,
Telephony, and Helpdesk are installed. It also checks the live site config for
both mail and scheduler disablement by default. `health --mail-enabled` instead
requires the explicitly enabled native site and running scheduler. Backend and
queue workers have a separate egress bridge for SMTP/IMAP; database and Redis do not. A green compose configuration or image
build alone is not runtime evidence.
