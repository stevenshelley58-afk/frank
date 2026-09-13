# Owner CRM integration contract

Implementation began 12 September 2026 following the owner review. This guide
covers Steven's Blockwise customer business, not a customer's property-lead CRM.
Follow the canonical engineering rules and existing component release guides.


## Current acceptance ledger, 13 September 2026 10:18 UTC

This ledger supersedes the older checkpoint below. It records private, sanitized
receipts and current runtime evidence. It is not a completed-CRM or launch
approval.

### Completed and evidenced

- Native customer subscription details were verified on desktop and mobile. Ordinary IMAP
  reply send, Sent-copy handling and native reply threading passed. The mailbox
  receipt is `/srv/frank/verification/owner-crm-final-20260913/mailbox-native-acceptance.json`.
- Native support routing passed: ticket `0003`, one notification, and zero
  duplicate receipts on repeat delivery. Receipt:
  `/srv/frank/verification/owner-crm-final-20260913/support-native-acceptance.json`.
- CRM native task, Helpdesk and inbound-mail notifications are private and
  generic. The native owner Agent role and HD Agent record are reconciled, and desktop assignment persisted on mobile reload. The phone-sized Helpdesk email view has no horizontal overflow. Receipts: `/srv/frank/verification/owner-crm-final-20260913/helpdesk-owner-reconcile.jsonl` and `helpdesk-owner-browser-acceptance.json` in the same directory.
- Mautic acceptance now covers rendered HTML and plain variants, direct CTA,
  token rendering and the restricted unsubscribe/DNC negative path. No negative
  message was sent; the negative check left the sent count unchanged. There are
  eight canonical draft campaigns, ten native flow emails, and a separate unpublished newsletter (email 11, segment 9); nothing is
  activated. Receipt:
  `/srv/frank/verification/owner-crm-final-20260913/mautic-html-final-acceptance.json`.
- Current runtime evidence is Mautic image `a47a2aa68fff2680206282255743fe18654b2492`,
  Frank/Window revision `f03920780d9b6cd7bf708069525028e333a00916`, and the
  private receiver source is `516d821` (sanitized identifier). CRM admin/root,
  Mautic app DB, new Resend SMTP and receiver credentials were rotated and
  runtime-verified. No credential values belong in this document.
- Local backup and isolated restore passed, including encryption-key and
  encrypted-credential round trips and staged attachment recovery. It is local
  only, with no off-host RPO claim. Receipt:
  `/srv/frank/backups/owner-crm/local-20260913T073405Z-91df4513e9df/drill-receipt.json`.
  Mautic and ntfy private restore checks also passed without changing production;
  receipt `/srv/frank/backups/owner-marketing/local-20260913T074805Z/restore-receipt-20260913T074818Z-1102792.json`.

### Remaining gates and explicit non-claims

- Actual new-reply, bounce and complaint acceptance is still being finished by
  a separate work item; do not claim those paths passed. A reply currently stops
  or alerts only; a durable reply follow-up task is not implemented.
- Off-host backup is not done and needs Cloudflare authorization. An actual
  phone notification is not done and needs the intended OS/login and device
  receipt. Public 15-minute owner booking is not wired.
- The old exposed Resend key still needs exact identification and revocation;
  its value is intentionally omitted. Resend and Purelymail remain disallowed
  for cold prospecting. No provider, campaign, prospect enrolment or customer
  send was activated.
- Audit-plan intake is released within `959860336febdc060e4c403f08712b32e36162dc`. The exact intake change passed repository checks and an isolated canary; another independent main update superseded its original release candidate before activation. Live bounded signed reads, authentication rejection, replay rejection and no-store passed. Evidence: `/srv/blockwise/verification/owner-crm-sync-20260913/audit-intake-live-acceptance.json`. This does not attest unrelated changes in that later release. Final consolidated browser acceptance, public audit freshness and remaining lifecycle exits are separate gates. Historical evidence below must not be read as current acceptance.

### Saved email design inspiration

The owner's latest direction is to use the VPS templates as inspiration, not
preserve old tests because of sunk cost. Maintained Blockwise
`src/lib/email-design/renderer.ts` contains Quiet card, Personal letter and
Operations brief. Historical examples also exist under
`/srv/blockwise/previews/email/`. These guide visual hierarchy, concise copy and
clear actions. Never reuse their fictional sample prices, addresses, expiry
periods or preview links as verified business facts. Frank must not import
Blockwise source; use native Mautic templates for its own flow engine.

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

- Individual owner login, least-privilege roles, MFA and protected daily access;
  the private CRM + Helpdesk runtime is already verified.
- Prospect import and outreach handoff remain gated. The customer/billing mirror is active, as recorded below.
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

## Native event and recovery checkpoint, 13 September Perth time

Two native Frappe Webhooks now connect new CRM Tasks and Helpdesk tickets to
private ntfy. One retained, clearly labelled CRM Task exercised the native short
worker. Its replay verified the corrected ntfy JSON endpoint and a parsed generic
notification title/message. Two native request logs have responses and no errors.
This is at-least-once delivery, not an exactly-once guarantee; a separate retained native Helpdesk ticket canary subsequently produced one
parsed generic support notification without a customer contact or recipient. No public route,
phone subscription or real device receipt is claimed.

A native local backup and isolated restore drill succeeded. The restored app
set and all eight customer/prospect field definitions matched. The drill's
temporary containers, network and directories were cleaned up. Evidence is
`/srv/frank/backups/owner-crm/local-20260912T160227Z-d03afcca795b/drill-receipt.json`.
This proves a local fresh-site restore only: both attachment trees contained
zero files, encrypted-credential/encryption-key recovery is unverified, and
there is no off-host backup or hourly recovery-point claim yet. It is not
permission to delete existing customer, research or mailbox history.


### Identity and recovery hardening, 13 September Perth time

Native database uniqueness is now applied to the three immutable source UUID
fields. The adapter first checks all definitions and bounded existing identity
values, and only permits otherwise-identical unique-zero to unique-one upgrades.
All eight fields are unchanged on replay. Native schema inspection confirms
three unique indexes and nullable NULL defaults, retaining ordinary contacts
without a product identity. Fifteen setup tests pass. This prevents duplicate
source identities; it is not a running customer synchronization service or an
atomic transaction across all schema updates.

The Blockwise customer snapshot candidate now has scoped authentication,
no-store responses, safe fixed-label failure logging and native isolated SQL
rehearsal coverage. It preserves raw billing/trial facts rather than inventing
access decisions, and does not select an arbitrary owner where membership is
ambiguous. It remains feature-branch source, not an applied product migration,
released endpoint or enabled CRM writer. Current complete repository checks
passed 1,309 tests with two skips; typecheck and production build also passed.
Native fixture checks cover permissions, bounded pagination, invalid limits,
unchanged data and preserved RLS, with a deliberately broken permission negative
control. Final product release and customer-journey browser acceptance remain
separate.


The strengthened local recovery drill also passed. Receipt:
`/srv/frank/backups/owner-crm/local-20260912T163731Z-e62737974e25/drill-receipt.json`.
The base restore matched all eight definitions including the three applied
unique flags. A separate staged-only native backup and second restore verified
one public attachment, one private attachment, their native File URLs and exact
contents, the original staged encryption key, and a decrypted fixture secret.
The fixture was created only after restoring the base archive, never on the live
site. Native File document insertion avoids the file-manager helper's duplicate
unreferenced blob. Temporary sites, containers and network were removed.
This proves the staged recovery mechanism, not off-host recovery or existing live
encrypted credentials: the base archive still has no attachments. Off-host backup,
recovery-point objectives and real mailbox recovery remain unresolved.


## Customer sync activated, 13 September 2026

This supersedes the earlier candidate-only customer-sync notes, not the remaining launch gates.

- Product revision `db775a3902c00589a3ccc7a768246539e37cb3ab` exposes a bounded, raw-fact customer snapshot. The dedicated HMAC secret cannot fall back to or reuse the shared internal key. Replay, scope, unauthenticated and bearer requests are rejected; all responses are no-store.
- Hermes runtime source `55d026ceddf58e1a17e156cd870d07ad3a3cf7e9` connects through the existing product loopback ingress on 8080 with fixed Host `blockwise.sale`. Public Cloudflare blocked the first server-side attempt; no ingress or security policy was changed. No provider credentials are given to this connector.
- All thirteen native Custom Fields were verified unchanged by setup preflight. Three identity fields retain native unique indexes. Five existing pre-launch Blockwise accounts were mirrored. Four source addresses look like test addresses; none of these records prove a paying/live customer. Existing manual and labelled native acceptance contacts were preserved.
- Native acceptance covered create, identical-observation replay, billing/trial mirror update, stale observation, conflicting single identity, concurrent stale modified token, parent-contact email insertion, changed-source alternate email preserving the operator primary, native CRM review tasks and forbidden Administrator/Email Account access.
- An upstream Frappe Contact permission hook allowed deletion of one labelled acceptance fixture despite a no-delete role. No real customer was deleted. The committed native Before Delete Server Script now denies this identity, and the actual DELETE denial passed. Three labelled native acceptance contacts remain, with their review tasks resolved. This is documented native configuration, not a custom Frappe application.
- Native Hermes job `521151fe28c3`, **Owner CRM customer sync**, is enabled every 15 minutes in the single default profile with `no_agent=true`. A native `hermes cron run` completed successfully. There is no model call per sync, new system timer or Frank worker. Pause, blocked-while-paused, resume, source preview, apply and retry were exercised. A fresh observation advances the watermark; this is reported as an update even when the other facts are unchanged.
- Runtime scripts are under `/home/hermes/.hermes/scripts/owner-crm-sync`. Operator commands are `python3 operate.py status|preview|run|pause|resume` as user hermes. Hermes cron provides native enable/pause/history. Private aggregate receipts are in `/srv/hermes/state/owner-crm-sync`; exceptions are ordinary CRM Tasks, not a second task store. No credentials or customer payloads appear in receipts.
- The actual product database dump was restored into a network-isolated Postgres container and the new migration passed against that schema. Native SQL permission tests, repository tests/typecheck, immutable production build, private compiled-revision/HMAC canary and guarded release passed. The temporary canary was removed and the pre-existing autodeploy timer resumed.
- Post-sync native backup and isolated restore succeeded: `/srv/frank/backups/owner-crm/local-20260913T012436Z-cf6416be85cc/drill-receipt.json`. All thirteen custom fields matched. The isolated staged attachment/encrypted-secret round trip passed and temporary resources were removed. This remains local-only; it is not an offsite backup claim.

Evidence is root-private at `/srv/blockwise/verification/owner-crm-sync-20260913/`. Connector/setup tests currently total 46 passing. No live email, charge, provider write, prospect enrolment or customer-agency CRM mutation was performed. The full mailbox/flows, mobile receipt, prospect eligibility and final consolidated browser acceptance gates above remain open.
