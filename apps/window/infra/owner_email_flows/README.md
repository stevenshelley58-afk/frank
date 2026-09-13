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

The future source adapter must set blockwise_nurture_exit to non-active on reply,
conversion, consent withdrawal, bounce or complaint. That stops the next pending
education checkpoint. This pack does not implement the adapter. Mautic Do Not
Contact does not automatically suppress the separate Blockwise transactional
outbox. Trial flows consume exact events and do not calculate trial deadlines.

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

The owner CRM sync currently mirrors raw facts to Frappe only. A source adapter
and consent UI must provide recorded explicit consent, source events and nurture
exit updates before bridge use. Root enables campaigns/workers only after that
adapter, Resend SMTP, public consent route and controlled own-mailbox unsubscribe
test pass.

## Hermes consent bridge

The committed but paused native Hermes bridge reads only the protected customer
snapshot. Its exact input is a verified owner email timestamp and the snapshot's
latest exact marketingConsent event: eventId, granted, occurredAt and policyVersion.
No event means ungranted. It cannot infer consent from signup, billing, trial or
email address.

A latest granted event with a verified email enrols only opted-in education. A
latest revoked event writes Mautic email Do Not Contact and stops nurture. The
adapter has no reply or conversion source, so it does not claim those exits are
connected. Hermes installation creates the no-agent job Owner email consent
bridge every 15 minutes in a paused state. Root alone may install its dedicated
Mautic API credential and resume it after the controlled recipient test.
