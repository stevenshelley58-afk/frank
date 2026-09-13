# Owner Lead Intake

Native, no-agent Hermes connector for Blockwise `public.demo_requests` rows sourced as `landing` or `audit-pdf`.

Identity is exactly `blockwise_demo_request:<public.demo_requests.id>`. It never searches or merges by email. Research agents remain a separate namespace and are not imported. New CRM Leads receive `custom_blockwise_eligibility=review_required`; no consent or sendability is inferred. The source reader is bounded and HMAC-scoped.

Before activation, run `provision.py --apply` from committed source. The connector remains disabled pending root-supervised source counts and guarded Blockwise release. Its only native write is CRM Lead creation. It sends no mail and changes no Blockwise customer, billing, or booking data.
The native script-only job uses an exclusive lock and at most 20 pages of 50 requests per run. A private cursor advances only after a whole page succeeds and wraps after a completed scan, so requests inserted behind a UUID cursor are caught on the next scan. Native source-key idempotency handles replay, uncertain writes and concurrent creation. It never equates an unrelated unique-field error with successful import. Private aggregate last-run receipts expose counts and safe failure category, not contact data. Human names preserve native first/last-name fields.
