---
{"schema":"schema://mini-frank.knowledge-page/v1","id":"craft-immutable-release","title":"Release immutable verified versions","kind":"craft","status":"approved","summary":"A deliverable version is immutable, checksum-addressed and released only after required quality and sanitisation gates pass.","tags":["release","version","checksum","quality","rebuild"],"source_refs":["src-ad-intelligence-release-schema","src-template-pack-contract","src-content-factory-contract"],"verified_at":"2026-08-22","stale_after":"2027-08-22","privacy":"public","related_refs":["architecture-portable-artifact","craft-focused-repair"]}
---
# Release immutable verified versions

Changes create a new version. Consumers reject unsupported versions, failed
integrity checks, failed quality gates or missing referenced assets. This makes
undo and later production handoff dependable.
