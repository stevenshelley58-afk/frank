---
{"schema":"schema://mini-frank.knowledge-page/v1","id":"craft-focused-repair","title":"Repair the failing component in isolation","kind":"craft","status":"approved","summary":"When one interface component fails, contain and repair that component while healthy components remain usable and missing data stays explicit rather than fabricated.","tags":["repair","failure","isolation","honesty"],"source_refs":["src-frank-project-contract","src-frank-design-contract"],"verified_at":"2026-08-30","stale_after":"2027-02-28","privacy":"public","related_refs":["ui-isolated-failure-states"]}
---
# Repair the failing component in isolation

A component failure stays inside its own card or boundary. Repair that focused
surface without destabilising healthy components, and show an honest empty or
error state whenever its source is missing.

Never invent replacement data to make a broken component appear healthy.
