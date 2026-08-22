---
{"schema":"schema://mini-frank.architecture/v1","id":"architecture-responsive-small-business-dashboard","title":"Responsive small-business dashboard","kind":"architecture","status":"approved","summary":"Use one scoped project home, a versioned known-widget catalog and isolated cards over authoritative data, with explicit mobile and failure behaviour.","tags":["small-business","dashboard","mobile","forms","records","responsive"],"source_refs":["src-frank-project-contract","src-frank-design-contract"],"verified_at":"2026-08-22","stale_after":"2027-02-22","privacy":"public","applies_when":["a business needs a compact operational view","data comes from authoritative project or provider sources"],"not_for":["invented metrics","arbitrary executable widgets","cross-project data"],"related_refs":["ui-mobile-first-dashboard","ui-isolated-failure-states","craft-reuse-before-build"]}
---
# Responsive small-business dashboard

Use a small set of task-focused cards and forms. Each widget renders known
data and explicit ready, empty, attention, unavailable or error states. Keep
the main workflow usable on a phone and avoid horizontal overflow.
