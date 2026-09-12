# Owner CRM integration contract

Implementation began 12 September 2026 following the owner review. This guide
covers Steven's Blockwise customer business, not a customer's property-lead CRM.
Follow the canonical engineering rules and existing component release guides.

## Authorities and boundaries

- A dedicated Frappe site owns the owner sales pipeline, contacts, tasks and
  Helpdesk tickets. Use upstream CRM and Helpdesk, not a custom replacement UI.
  Existing customer-agency Frappe sites and their data remain separate.
- Stripe owns invoices, payments and subscription status. Blockwise owns its
  workspace access and trial state. CRM displays a read-only mirror, never an
  independently editable billing ledger. Do not install ERPNext just for billing.
- Ad Radar research is the prospect source. Prospect Discovery owns private
  contact evidence; Outreach owns eligibility, approval and suppression.
  Hermes is the execution boundary. Frank remains a launcher/read-only Hub,
  without a duplicate mail, CRM, queue or agent runtime.
- Mautic is the upstream flow engine being provisioned privately. A business mailbox owns ordinary mail;
  the sending provider for cold outreach remains unresolved. Neither Resend nor Purelymail is an
  allowed cold-outreach transport. Purelymail is restricted here to ordinary
  mailbox use, not marketing or advertising. Auth and requested transactional mail must
  not be disabled merely because prospecting is gated.
- ntfy is the upstream phone notification transport running privately. Native CRM in-app alerts
  and a webapp manifest alone do not prove background phone notifications.

## Identity and synchronization

Start with one person per signup and one ad account. Preserve existing product
workspace isolation. Do not add enterprise/multi-account workflows now.

Use immutable source identifiers, not email alone, for integration identity:
research agent UUID for a prospect; Blockwise profile UUID and explicit workspace
UUID for a signed-up customer; provider event ID for a delivery or billing event.
Native Frappe Contact is shared by CRM Deals and Helpdesk tickets on the same
site. CRM Leads have their own prospect fields. Email/phone matches may suggest
an association but must not silently merge conflicting identities. CRM
Organization and HD Customer are distinct records, not a proven native sync.

Each integration must have one owner, repeatable writes, a bounded retry policy,
an observable failure state, and reconciliation after missed or out-of-order
events. Mirroring a subscription must not grant access or send another receipt.
Store minimal source references and a last-synchronized timestamp; do not copy
raw research metadata, provider secrets, full card data or unrelated customers.

## Contact handoff established with Ad Radar

The task "Review Ad Radar costs" confirmed contact storage in the separate
`blockwise-research-db` database `blockwise_research`, schema `research`.
`research.agents` has direct email/phone/website columns and private enrichment
under `metadata.cold_email_enrichment.v1`. The older `metadata.email_enrichment`
is a different shape. Preserve these sources when clearing CRM experiments.

A read-only aggregate on 12 September found 12,356 agents, 3,419 nonempty direct
email fields and 3,166 non-null v1 enrichment email fields. Counts overlap and
are not unique deliverable recipients. Historical v1 status counts were 3,176
ready, 158 needs_review, 8,760 missing_email and 262 unset. These are discovery
labels, not consent, permission, verified deliverability or sending approval.

The public Ad Radar prospect projection deliberately omits contact fields.
Keep it that way. A later authorized server-side import must retain contact
source/evidence URLs, source-document references, observation time, confidence
and ambiguity. Separate recipient eligibility, legal-basis evidence, objection,
suppression and provider-policy decisions from discovery quality. Do not infer
personal ownership from an agency page or an email merely appearing in ad copy.

## Customer journey and mail ownership

Approved eligible prospect -> local ad examples with observation date -> public
Blockwise area audit -> signup/free trial or public call booking -> customer,
subscription lifecycle and support. A booking remains on Blockwise through the
Frank-owned SnagTime service. Customers must never enter the operator Hub.

Requested audit/report messages, auth recovery, billing notices, ordinary human
replies, opted-in marketing and cold prospecting are separate categories.
Assign exactly one sender to each event. Recheck suppression and approval at
actual dispatch, not only at enrolment. A reply stops the prospecting sequence
and creates one follow-up task. A marketing opt-out must not block an essential
requested service message. AI-personalized mail remains draft until approved.

## Remaining activation gates

- Dedicated CRM + Helpdesk runtime, native roles and fresh owner site verified.
- Private idempotent prospect/customer/billing handoffs implemented and tested.
- Mailbox inbound, outbound, Sent and reply threading verified using @blockwise.sale.
- Reviewed templates and approved flow definitions, with safe test recipients.
- Cold provider policy and recipient eligibility resolved before live enrolment.
- Public audit ad freshness, signup attribution and public booking connected.
- Authenticated phone subscription and an actual device notification receipt.
- Restore-tested backups before any reset; archive nonempty retired test data.
- One consolidated final VPS browser matrix across prospect, trial, paid,
  past-due, cancelled, duplicate/delayed event, reply/opt-out and isolation cases.

No complete-CRM or launch-ready claim is supported until these gates are met.
Missing business identity/ABN, final commercial terms and provider account
approvals remain explicit. Use placeholders only in drafts, never legal invoices
or live sending settings. No purchase is implied by the absence of a budget cap.

## Private foundation verification, 12 September 2026

The ntfy service is healthy on loopback port 18104 with deny-all default access,
a publisher that can only publish and an owner that can only subscribe to the
owner topic. Actual HTTP checks rejected anonymous reads/writes and the two
wrong-role operations. A private test message was accepted; no phone was
subscribed. The image content and pinned digest were checked, not just its
label. This is backend verification, not actual phone delivery.

Native Frappe field setup has ten passing tests including a real loopback HTTP
transport test. Its actual owner-site apply created all eight fields; a second dry-run
reported all eight unchanged. Anonymous lead reads and reuse of a logged-out
Administrator session both returned HTTP 403. No prospect
or customer records have been imported and no billing mirror is running yet.

The Blockwise signup-attribution and watchdog-recipient changes passed 1,301
tests with two skips on the current integration candidate. The full build also passed. Production release and
final browser acceptance remain separate checks. This does not prove public signup, inbox delivery,
CRM data synchronization or lifecycle E2E.

### Sending and phone-provider constraints

Purelymail's current [provider policy](https://support.purelymail.com/support/solutions/articles/159000430367-instantly-ai-connectivity-issues)
explicitly prohibits marketing/advertising and unsolicited outreach. Existing
DNS records or a working mailbox do not waive that restriction. Keep it out of
Mautic marketing and Ad Radar outreach; select a permitted transport separately.
The mailbox admin currently requires the owner's login. No new paid account
has been purchased.

For an iPhone, self-hosted ntfy's native app needs an upstream push wake-up
service, per [upstream configuration](https://docs.ntfy.sh/config/#ios-instant-notifications).
The private service currently has no public authenticated route or device
subscription. Do not claim background delivery until the intended phone has
received and opened a test notification. Lock-screen messages must omit
customer contact details and link back to an authenticated owner surface.

The fresh owner CRM site now runs upstream Frappe 15.120.1, CRM 1.83.0,
Helpdesk 1.30.1 and Helpdesk's required Telephony dependency. All required
services passed the runtime health check, the host loopback endpoint answered,
and native Administrator login was tested. Email and scheduling are disabled.
Only the frontend has an ingress bridge; data and worker services remain on
the internal-only network. This is private foundation readiness, not complete
CRM activation. The installed framework licence is MIT; the installed CRM,
Helpdesk and Telephony licence files are AGPLv3. No upstream fork was created.

Mautic 7.2 is now installed with a native administrator on loopback port 18106.
Its verifier exercised a real login, dashboard response and anonymous access
denial; contacts and campaigns are both empty. Only a fixed upstream Nginx
reverse proxy has the extra ingress network, while Mautic and MySQL remain
internal-only. The sending transport is deliberately non-delivering and cron
is disabled. No email flow has been activated and no marketing contact has
been imported. A native sales-stage mapping is recorded in the setup guide;
standard conversion and won/lost meanings are preserved.
