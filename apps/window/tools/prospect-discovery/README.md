# Prospect Discovery

Prospect Discovery owns public-contact discovery, enrichment evidence, and qualification. Every contact field is minimized and linked to public source evidence. A scraped availability signal is not consent and this package cannot draft, approve, or send outreach.

`ad_intelligence` is a stable subject reference only. It cannot carry PII or expose an identity graph.

## Verified Prospect release

`release.schema.json` and `release.py` define the immutable
`schema://frank.prospect-discovery-release/v1` boundary consumed by Outreach.
The public release contains opaque prospect, contact, evidence, settings,
trace, sanitization, policy, and verification receipt references only. Email
addresses, phone numbers, raw provider payloads, consent claims, direct
Blockwise lead IDs, and mutable Ad Radar state have no public field.

Detailed source attribution, validation results, Australian attribution checks,
repair evidence, and revert metadata remain in the Hermes data plane behind
each `verification_receipt_ref`. The release never expands those private
records. Its `release_hash` is SHA-256 over RFC 8785 JCS of the complete release
excluding only `release_hash`.
