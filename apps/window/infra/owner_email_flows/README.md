# Owner CRM email flows

This pack creates native Mautic Contact fields, static source Segments,
published template Emails, and unpublished Campaigns. It never enables Mautic
cron/workers, global sending, imports recipients, or sends an Email.

## Ownership and consent

Blockwise's durable outbox remains the sole sender for authentication, password
recovery, invoices/receipts, demo-request acknowledgements and manual
onboarding-booking invitations. Mautic does not duplicate them.

Mautic owns only opt-in lifecycle education. Each bridge enrolment requires an
immutable profile ID, workspace ID and source-event ID, explicit opted-in
consent and no native Mautic email Do Not Contact entry. The active customer
snapshot has no marketing-consent fact today, so no real customer is eligible
until an authoritative consent source is accepted.

Trial flows use exact source events. Mautic does not calculate a trial deadline.
The cold local-audit flow is drafted, unpublished and hard-blocked in the bridge
pending permitted-provider, recipient-eligibility, audit-evidence and
destination approval.

## Public consent surface

Every template includes native unsubscribe and global Do Not Contact links.
Required public ingress is only GET and POST email/unsubscribe and email/dnc
paths on the public Mautic mail hostname. Admin, API, campaign, contacts and
webview routes remain loopback-only. App links disable Mautic click tracking and
tracking pixels are disabled by Mautic configuration.

## Runbook

Run test.sh, apply.sh and verify.sh from an exact committed release checkout.
Apply reads the existing root-only owner-marketing secret file without printing
it, enables private loopback-only Basic API access and creates or checks assets
idempotently. The bridge is dry-run unless passed apply; it still refuses
missing consent, native DNC and all cold enrolment.

## Remaining integration

The owner CRM sync currently mirrors raw facts to Frappe only. A source adapter
must call bridge using the authoritative event and consent fact. Root enables
campaigns/workers only after the adapter, Resend SMTP, public consent route and
controlled own-mailbox unsubscribe test pass.
