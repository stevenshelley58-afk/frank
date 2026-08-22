---
{"schema":"schema://mini-frank.knowledge-page/v1","id":"craft-sanitise-before-release","title":"Sanitise before release","kind":"craft","status":"approved","summary":"Public or reusable outputs must pass PII and secret checks and expose only allowlisted fields and opaque private references.","tags":["privacy","pii","secrets","allowlist","release"],"source_refs":["src-ad-intelligence-contract","src-ad-intelligence-release-schema","src-prospect-discovery-contract"],"verified_at":"2026-08-22","stale_after":"2027-02-22","privacy":"public","related_refs":["governance-private-context-boundary","pattern-public-data-not-consent"]}
---
# Sanitise before release

Reject arbitrary nested payloads, raw provider bodies, credentials, internal
paths and contact details. Preserve private detail behind scoped references
when an authorised consumer needs it.
