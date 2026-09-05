# Blog Studio v2

Blog Studio is the user-facing name for Frank's stable `content-factory` tool.
This package is declarative: it tells Frank what to display and what closed
requests it may forward. It contains no worker, agent loop, prompt library,
model router, scheduler, queue consumer, publisher, credential store, or
project-specific execution code. Hermes remains the only brain.

## Lifecycle

The v2 process is deliberately linear and auditable:

`source → research → brief → draft → edit → package → qa → human-approval → immutable-release`

`package` assembles the requested article, SEO, media briefs, and companion
drafts. `qa` produces evidence, claim, quality, and sanitization receipts.
Release is impossible without both a passing QA receipt and a human approval
receipt bound to the reviewed artifact versions. Approving causes Hermes'
deterministic service—not the model—to copy those exact bytes into an immutable
release in the same atomic action. Withdrawal creates a signed tombstone; it
never mutates a released version.

## Public run request

Frank forwards only this closed payload to Hermes:

```json
{
  "project_id": "blockwise",
  "content_id": "guide-seller-evidence",
  "job_name": "Seller evidence field guide",
  "topic": "Why local evidence creates a better seller conversation",
  "source_bundle": {
    "text": "Pasted source material",
    "urls": [{"url": "https://example.com/source", "title": "Primary source"}],
    "attachments": []
  },
  "direction": {
    "audience": "Australian real-estate operators",
    "outcome": "Understand the practical decision",
    "cta": "Create three ads free",
    "locale": "en-AU",
    "must_include": "Source-backed claims",
    "must_avoid": "Unsupported certainty",
    "slug": "seller-evidence"
  },
  "outputs": {
    "length": "deep",
    "research_mode": "verify-enrich",
    "media": "briefs",
    "companions": ["email", "social"],
    "publication_target_id": "blockwise-guides"
  },
  "project_context": "Optional context resolved from the selected Frank project"
}
```

`project_id`, `content_id`, `source_bundle`, `direction`, and `outputs` are
required. `job_name`, `topic`, and `project_context` are optional. A topic or
direction may start a run without pasted source material. Stage instructions,
capability selection, research tools, fallback policy, and execution state are
resolved by Hermes and are not accepted in this public request.

## Contracts

- `manifest.json` declares the v2 graph, actions, events, and explicit gates.
- `home.json` is the exact seven-field home manifest under tool ID
  `content-factory`.
- `blockwise-pack.json` provides Blockwise direction/output defaults and a
  revision-pinned legacy adoption map. It does not select Hermes internals.
- `release.schema.json` remains the closed public article-release contract.
- `fixtures/content-release-v1.json` is its golden producer-consumer payload.
- `schemas.json` records the closed run, review, trace, and release summaries.

Structured artifact and release hashes use SHA-256 over RFC 8785 canonical
JSON. Frank projects runtime state through allowlists and never exposes source
bodies, hidden execution state, credentials, or private provenance material.
