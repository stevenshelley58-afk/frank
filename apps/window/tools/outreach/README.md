# Outreach

`home_snapshot.py` is a pure read-only projection of already-authorized package
runtime state. It accepts only scoped command summaries that pin an immutable
`release://prospect/...` reference, policy/action receipt references, and
recorded connection-capability coverage. It cannot resolve contact records,
call a provider, or send mail.

Outreach owns lists, sequence intent, personalized drafts, approvals, policy checks, suppression, legal-basis evidence, and idempotency decisions. It holds references to the shared Connections/Hermes action receipt and never owns or implements provider action recording.

Mautic owns campaign/segment automation when used; Resend owns delivery when selected through a connection capability. List-Unsubscribe and one-click unsubscribe are required. A delivery request is invalid unless approval, legal basis, policy, project/global suppression, quiet-hours, idempotency, and connection-capability checks run immediately before the request. Scraped availability is never consent.
