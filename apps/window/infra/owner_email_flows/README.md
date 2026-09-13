# Owner CRM email flows

This pack creates native Mautic Contact fields, static source Segments, published
template Emails and unpublished Campaigns. It never enables Mautic cron/workers,
global sending, imports recipients or sends an Email.

## Native flow structure

There are eight source-event Campaigns. Six are one-response lifecycle flows:
onboarding and trial help, trial ending, trial ended, paid welcome, cancellation
follow-up and winback. They deliberately have no invented follow-up timing.

The opted-in education Campaign has the only documented multi-step cadence:
welcome, a two-day wait, useful guide, then a further three-day wait and a
check-in. Before every send it checks authoritative opted_in consent and an
active nurture-exit state. A negative condition has no next event, so it exits.
Each send is Mautic marketing mail, not transactional, and Mautic Do Not Contact
is enforced by its sender.

The cold local-audit Campaign is an unpublished held draft with no send action
and an unpublished template. It cannot enrol through the bridge.

## Ownership and consent

Blockwise's durable outbox remains the sole sender for authentication, password
recovery, invoices/receipts, demo-request acknowledgements and manual
onboarding-booking invitations. Mautic does not duplicate them.

Each bridge enrolment requires immutable profile, workspace and source-event IDs,
explicit opted-in consent, active nurture state and no native Mautic Do Not
Contact. The released protected snapshot now carries explicit marketing-consent events and
verified-owner evidence. No event means ineligible; the live read-only preview on
13 September found five ungranted customers and no eligible enrolments.

The committed Hermes source adapter consumes verified explicit consent and the
protected snapshot's raw workspace, trial and billing facts. It selects one
currently eligible native source path, removes stale non-cold source segments,
then records Mautic email Do Not Contact on a consent withdrawal. Paid welcome
requires paid access plus `billingCheckoutCompletedAt`; cancellation requires
actual `canceled` access plus the authoritative billing-event high-water.
`cancelAtPeriodEnd` alone never implies cancellation. Its deterministic UUID5
action IDs are local bridge identities, not asserted Stripe event IDs. Mautic Do
Not Contact does not automatically suppress the separate Blockwise transactional
outbox.

The default timing policy is deliberately narrow and configurable: trial-ending
is eligible only in the three days before authoritative `trial.endsAt`; winback
is eligible only from 30 through 37 days after an authoritative trial end or
actual cancellation period end. Neither carries an offer, price or incentive.
`OWNER_EMAIL_FLOWS_TRIAL_ENDING_WINDOW_DAYS`,
`OWNER_EMAIL_FLOWS_WINBACK_DELAY_DAYS` and
`OWNER_EMAIL_FLOWS_EVENT_FRESHNESS_DAYS` can be overridden through the native
operator command, with `--as-of` available for deterministic review. The
default seven-day freshness window holds old lifecycle facts, so enabling a new
adapter cannot backfill historical signups or lifecycle emails. The adapter
never derives timing from `sourceObservedAt`, signup or an agency lead event.
Reply, conversion, bounce and complaint exits are native/email-side gates, not
asserted Blockwise customer-lead events.

## Copy provenance

Copy was revised from canonical VPS product material, not inferred offers:

- public/guides/resources/sold-price-list-seller-leads/delivery-email.txt for
  clear request-first delivery and no unasked ongoing updates.
- src/lib/notify/demo-request-email.ts for campaign-plan and launch-checklist
  vocabulary.
- src/lib/email/outbox.ts and src/lib/operator/customers.ts to avoid duplicating
  demo-request and booking transactions.
- src/lib/email/lead-lifecycle.ts and docs/runbooks/transactional-email.md for
  consent, exit rules and the only allowed two-day then three-day cadence.
- src/lib/email-design/renderer.ts for the maintained Blockwise visual system:
  quiet-card, personal-letter and operations-brief hierarchy, restrained CTA and
  real preference links. It was reviewed as inspiration only; no Blockwise code
  was copied into Frank.
- /srv/blockwise/previews/email/catalog-builder.py,
  library-cli-check/weekly-newsletter-SAMPLE.html and
  notifications-cli-check/daily-digest-quiet-SAMPLE.html as historical visual
  references only. Their sample prices, dates, addresses and preview URLs are
  not Blockwise product facts and were not used.

All authored copy avoids invented pricing, trial timing, performance claims and
support promises. It uses no em dash. The committed pinned Mautic image includes
DomCrawler and CssSelector, so the ten native templates now contain HTML and
plaintext alternatives. Native pixels and trackable URL rewriting are disabled.
The actual own-mailbox delivery, direct CTA, native unsubscribe and post-DNC
blocked-send acceptance passed; see evidence/2026-09-13-html-native-acceptance.md.

## Public consent surface

Every template includes native unsubscribe and global Do Not Contact links.
Required public ingress is only GET and POST email unsubscribe and email DNC paths
on the public Mautic mail hostname. Admin, API, campaign, contacts and webview
routes remain loopback-only. Tracking pixels are disabled by Mautic configuration.

## Runbook and remaining integration

Run test.sh, apply.sh and verify.sh from an exact committed release checkout.
Apply reads the root-only secret file without printing it and enables private
loopback-only Basic API access. The bridge is dry-run unless passed --apply, and
still refuses missing consent, native DNC and cold enrolment.

The owner CRM sync is not a lifecycle-email event source. The paused source
adapter requires an accepted consent UI and the released protected customer
snapshot facts before it can run. It maps only present raw facts and never
dispatches from an agency lead lifecycle event. Root enables campaigns/workers
only after the consent source, Resend SMTP, public consent route and controlled
own-mailbox unsubscribe test pass.

## Hermes consent bridge

The committed but paused native Hermes bridge reads only the protected customer
snapshot. Its exact input is a verified owner email timestamp and the snapshot's
latest exact marketingConsent event: eventId, granted, occurredAt and policyVersion.
No event means ungranted. It cannot infer consent from signup, billing, trial or
email address.

A latest granted event with a verified email permits the selected current
education or lifecycle path. A latest revoked event writes Mautic email Do Not
Contact, stops nurture and removes non-cold source-segment paths. The adapter
has no customer-agency lead reply or conversion source. Its dedicated Mautic
role has contact create/view/edit access plus
the native static-segment edit capability required for membership. Mautic has no
membership-only permission, so that segment edit capability is broader than the
adapter needs and does not grant campaign, email, publish, send, delete or admin
access. Hermes installation creates the no-agent job Owner email consent bridge
every 15 minutes in a paused state. Root alone may install its dedicated Mautic
API credential and resume it after the controlled recipient test.

## Native acceptance evidence

On 2026-09-13, the dedicated API identity completed a controlled, no-send
canary against the live private Mautic API. It read fields, segments, campaigns
and email metadata; created then replayed exactly one clearly labelled `.invalid`
contact; rejected a different immutable profile with the same email before a
POST merge; recorded email Do Not Contact; and was denied campaign creation.
The canary remains preserved for audit. Campaigns were still unpublished, the
Hermes job stayed paused, and no email-send endpoint was called.

The actual Mautic 7 route for static membership is
`POST /api/segments/{segmentId}/contact/{contactId}/add`, not the obsolete
contact-first route. Native contact totals are returned as decimal JSON strings,
which the bounded lookup accepts only after strict decimal validation.

## HTML dependency ownership

The upstream image omitted optional HTML-validation dependencies. The maintained
fix is the committed, pinned image build in ../owner_marketing/Dockerfile,
including real Crawler.filter() acceptance. No live vendor overlay is used.

## Resend bounce and complaint receiver

`POST /api/owner-mail-events/resend` is the single public callback path. Caddy
allows only that POST with a 64 KiB body limit and strips browser credentials.
The Flask handler verifies the raw Svix signature and short timestamp window
before doing anything. It accepts only `email.bounced` and `email.complained`.

It uses the fixed Resend `GET /emails/{email_id}` endpoint, extracts one native
Mautic unsubscribe tracking hash from stored provider content, then requires
exactly one Mautic `email_stats` match. The provider recipient, statistic,
contact ID, contact email, immutable Blockwise profile ID and workspace ID must
all agree. Address matching alone is never authority. An unprovable relationship
does not change Mautic.

After proof, the receiver removes non-cold owner source segments and writes
native email Do Not Contact plus `blockwise_nurture_exit=stopped`. These native
operations are replay-safe. Temporary Resend or Mautic failure returns 503 for
provider retry. It never sends email, publishes campaigns, creates contacts, or
accepts provider-controlled URLs.

Before deployment root must provision root-only
`/srv/frank/secrets/owner-mail-events.env` (or set
`OWNER_MAIL_EVENTS_ENV_FILE`) with no source-controlled values:
`RESEND_WEBHOOK_SECRET`, `OWNER_MAIL_EVENTS_RESEND_API_KEY`,
`OWNER_MAIL_EVENTS_MAUTIC_USERNAME`, `OWNER_MAIL_EVENTS_MAUTIC_PASSWORD`, and
optionally `OWNER_MAIL_EVENTS_MAUTIC_URL`. The Mautic role needs Stats read,
contact view/edit and source static-segment membership edit only. Root registers
the Resend webhook after endpoint deployment; this repository creates no keys or
webhook registrations.
## Manual newsletter draft

`newsletter.py` creates one unpublished native dynamic segment and one unpublished native list email. The segment includes contacts only when `blockwise_marketing_conse` is exactly `opted_in` and `blockwise_nurture_exit` is exactly `active`. Native Mautic email Do Not Contact remains the final sending suppression.

The first held issue reuses the approved useful-guide email structure and its current Ad Studio checklist destination. It has no guessed cadence, campaign, contact import or custom sender. Each issue requires a human to review the current consent audience and draft, then explicitly approve native publication and sending. This helper never publishes or sends it and never enables Mautic scheduled jobs.

Run it only with the existing root-only owner-marketing secret loaded:

```bash
python3 newsletter.py plan
python3 newsletter.py apply
python3 newsletter.py verify
```

Replays are read-only when the native objects match. Duplicate names, changed audience filters, a published or previously sent email, changed copy, or a changed segment binding stop for review. The helper never deletes an existing native object. It can only make its canonical segment safer by turning publication off. Any other drift stops for review.
