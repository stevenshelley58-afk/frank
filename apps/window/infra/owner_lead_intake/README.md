# Owner Lead Intake

Native, no-agent Hermes connector for Blockwise `public.demo_requests` rows sourced as `landing` or `audit-pdf`.

Identity is exactly `blockwise_demo_request:<public.demo_requests.id>`. It never searches or merges by email. Research agents remain a separate namespace and are not imported. New CRM Leads receive `custom_blockwise_eligibility=review_required`; no consent or sendability is inferred. The source reader is bounded and HMAC-scoped.

Before activation, run `provision.py --apply` from committed source. The connector remains disabled pending root-supervised source counts and guarded Blockwise release. Its only native write is CRM Lead creation. It sends no mail and changes no Blockwise customer, billing, or booking data.