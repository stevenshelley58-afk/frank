# Owner Lead Intake

Native, no-agent Hermes connector for Blockwise `public.demo_requests` rows sourced as `landing`, `audit-pdf`, or `audit-plan`.

Identity is exactly `blockwise_demo_request:<public.demo_requests.id>`. It never searches or merges by email. Research agents remain a separate namespace and are not imported. New CRM Leads receive `custom_blockwise_eligibility=review_required`; no consent or sendability is inferred. The source reader is bounded and HMAC-scoped.

Before activation, run `provision.py --apply` from committed source. The guarded source route and native connector are released. The existing script-only Hermes job runs every 15 minutes; inspect its current status and aggregate last-run receipt before claiming a particular request was imported. Its only native write is CRM Lead creation. It sends no mail and changes no Blockwise customer, billing, or booking data.
The native script-only job uses an exclusive lock and at most 20 pages of 50 requests per run. A private cursor advances only after a whole page succeeds and wraps after a completed scan, so requests inserted behind a UUID cursor are caught on the next scan. Native source-key idempotency handles replay, uncertain writes and concurrent creation. It never equates an unrelated unique-field error with successful import. Private aggregate last-run receipts expose counts and safe failure category, not contact data. Human names preserve native first/last-name fields.

## Controlled verification

Run the installed native connector as its service user:

```bash
runuser -u hermes -- /home/hermes/.hermes/hermes-agent/venv/bin/python /home/hermes/.hermes/scripts/owner-lead-intake/operate.py run
```

A successful empty scan does not prove public form-to-CRM acceptance. For an explicitly authorized owner-controlled request, retain its immutable request ID, prove exactly one native Lead with the matching source key and `review_required`, then replay and check that no duplicate was created. The public form owns its separate requested transactional message; this connector never sends it or grants marketing consent.


## Native lead ownership

New intake Leads set native `lead_owner` to the dedicated owner System User
`owner@blockwise.sale`; the integration identity remains the authenticated
creator only. Replay repairs an older imported Lead only when its immutable
`custom_blockwise_source_key` matches and its current `lead_owner` is still the
service identity `crm-sync@blockwise.sale`. It never overwrites another owner.
The source email maps to the native CRM Lead `email` field; no consent is
derived from that contact detail.
