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
Contact. The active snapshot has no marketing-consent fact, so no real customer
is eligible until an authoritative consent source is accepted.

The committed Hermes source adapter currently consumes only verified explicit
consent from the protected customer snapshot. It can enrol opted-in education or
record a consent withdrawal as email Do Not Contact. It has no reply, conversion,
bounce, complaint or lifecycle-event source, so it does not claim those exits are
connected. Mautic Do Not Contact does not automatically suppress the separate
Blockwise transactional outbox. Trial flows consume exact events and do not
calculate trial deadlines.

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
support promises. It uses no em dash. Installed Mautic cannot save HTML templates
because its HTML-link validator lacks Symfony DomCrawler, so templates are plain
text with native preference and global unsubscribe tokens. This avoids open-pixel
and HTML-link tracking.

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
snapshot facts before it can run. Only opted-in education is wired through that
adapter; no trial, paid, cancellation, winback, reply or conversion event is
wired. Root enables campaigns/workers only after the consent source, Resend SMTP,
public consent route and controlled own-mailbox unsubscribe test pass.

## Hermes consent bridge

The committed but paused native Hermes bridge reads only the protected customer
snapshot. Its exact input is a verified owner email timestamp and the snapshot's
latest exact marketingConsent event: eventId, granted, occurredAt and policyVersion.
No event means ungranted. It cannot infer consent from signup, billing, trial or
email address.

A latest granted event with a verified email enrols only opted-in education. A
latest revoked event writes Mautic email Do Not Contact and stops nurture. The
adapter has no reply or conversion source, so it does not claim those exits are
connected. Its dedicated Mautic role has contact create/view/edit access plus
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

## HTML template handoff

The installed `mautic/mautic:7.2-apache` image has no
`vendor/symfony/dom-crawler` directory, although its lockfile contains optional
constraints referring to that package. This explains the previously observed
HTML-link-validation dependency boundary but is not a safe reason to overlay a
vendor directory. The maintained fix is a separately reviewed, pinned Mautic
image or Composer build that includes a compatible DomCrawler package, followed
by a controlled HTML-template save and own-mailbox render test. Until then these
native templates deliberately remain plain text, with native preference and
unsubscribe tokens and no tracking pixel.
