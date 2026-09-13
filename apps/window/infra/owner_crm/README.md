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

## One controlled Helpdesk reply acceptance

`bin/support-reply-acceptance.py` is bounded to ticket `0003`. Preview mode
logs in as the fixed owner Agent and reads the controlled ticket, parent
Communication, native reply flag and current thread parent. It neither enables
mail nor sends. `--execute` is reserved for a separate explicit run after the
commit is on `main`.

Execution calls native `HD Ticket.reply_via_agent` with `dt` and `dn`, so
Frappe loads the stored ticket. Before that call, the helper atomically records
a unique marker in a root-only receipt and takes a single-instance lock. A
restart with a non-final receipt only reconciles that marker and never sends it
again. Acceptance requires the linked native Email Queue to reach exactly
`Sent`, then exact parsed `From`, `To`, `Subject` and `In-Reply-To` headers plus
the marker in the decoded read-only mailbox body. Administrator credentials are
used only for the thread-parent and Email Queue proofs. The reply itself is
made by `owner@blockwise.sale`.

## Private owner web access

`python3 bin/private-access.py` previews existing native Tailscale Serve configuration; `--apply` adds only private HTTPS ports 8445 (CRM) and 8446 (ntfy). Existing Serve services are preserved, occupied ports and public Funnel flags are rejected, and native CRM/ntfy authentication remains required. No public CRM ingress, custom proxy, or new account is created. An enrolled phone with Tailscale plus native ntfy setup is still required for actual mobile notification receipt.

## Prepared off-host recovery

`bin/offhost-backup.sh` is manual and disabled by default. Its `--offhost` mode first creates the existing native Frappe SQL/files/config archive, then requires explicit root-only R2/restic configuration and four explicit Mautic/ntfy artifact paths (native Mautic MySQL dump, config, media, and ntfy state). It never schedules, prunes, or guesses a path. It does not claim Mautic or ntfy restore acceptance until an actual restore drill is recorded.

## Mautic and ntfy local recovery

`bin/marketing-backup.sh` makes a manual root-only local archive: native consistent Mautic MariaDB dump, explicit Mautic config/media volumes, and ntfy cache/auth state with its private configuration. It makes no off-host or restore-success claim. A disposable network-none restore drill is required before claiming Mautic or ntfy recovery.
`bin/marketing-backup.sh` creates the separate root-only local Mautic and ntfy archive. It uses a transactional native MySQL dump and SQLite's online backup API for both live ntfy databases, so WAL state is never approximated with a raw volume copy. `bin/marketing-restore-drill.sh` restores an archive into a disposable MySQL 8.4 container with networking disabled, compares every Mautic table count, all Mautic config and media hashes, all private runtime-config hashes, every ntfy table count and both SQLite integrity checks with the live source. A passing run writes a new root-private receipt beside the preserved archive. It never targets production databases, creates a schedule or writes off host.
