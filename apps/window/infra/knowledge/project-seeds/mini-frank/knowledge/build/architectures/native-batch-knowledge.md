---
{"schema":"schema://mini-frank.architecture/v1","id":"architecture-native-batch-knowledge","title":"Native batch knowledge compiler","kind":"architecture","status":"approved","summary":"Compile knowledge outside the request path from committed source and atomically publish disposable artifacts into Frank's existing knowledge root.","tags":["batch","knowledge","compiler","rebuildable","vps"],"source_refs":["src-frank-memory-contract","src-frank-knowledge-generator-contract"],"verified_at":"2026-08-22","stale_after":"2027-02-22","privacy":"public","applies_when":["knowledge can refresh asynchronously","last completed output must remain readable"],"not_for":["live reasoning","memory retention","request-time agent work"],"related_refs":["governance-derived-views-only"]}
---
# Native batch knowledge compiler

Read a clean committed source, validate it, generate into staging, then replace
the previous derived output atomically. The compiler has no database, worker
daemon or public endpoint.
