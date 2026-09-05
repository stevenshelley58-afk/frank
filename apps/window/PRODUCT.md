# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Confirmed: Steven operates projects and durable tool runs through Frank.
- Inferred from the existing Frank and Blockwise products: Ad Radar's primary user is an operator researching public advertising creative, monitoring collection quality, and approving reusable releases.
- Confirmed: Blockwise is a downstream product consumer, not the owner of Ad Radar execution.

## Product Purpose

Frank is the visual Window for Hermes-owned work. Ad Radar is a first-class Frank app that lets an operator define public-ad research coverage, run and monitor the research pipeline, inspect and compare normalized creative, resolve quality exceptions, approve publication, and issue auditable releases for downstream consumers.

Success means the operator can move from source coverage to an approved creative release without using Blockwise's legacy operator surfaces or losing the evidence, history, or approval trail.

## Positioning

Ad Radar joins creative research with durable execution evidence. Every visible creative can be traced back to a public source observation, normalization/classification decisions, media-quality checks, and the immutable release that exposed it; Frank shows that chain while Hermes owns the work.

## Operating Context

- Confirmed: Ad Radar lives inside the single Frank Window beside Ad Studio and uses the same project context.
- Confirmed: Hermes is the only execution owner. Frank submits commands and renders durable runs, events, outputs, health, and release evidence.
- Inferred from the legacy implementation: operators research by location, advertiser/agency/agent, status, ad type, format, hook, and recency or longevity.
- Inferred from the legacy implementation: collection uses public Meta Ad Library observations, advertiser resolution, media capture, classification, geographic matching, media QA, accuracy audits, quarantine, and customer-safe publication.
- Confirmed by the rebuild plan: the existing Blockwise research store is adopted in place after backup and compatibility gates; it is not copied into a second database.

## Capabilities and Constraints

- Configure project-scoped sources, markets, taxonomy, cadence, model policy, media policy, thresholds, retention, connections, and approval policy through immutable settings revisions.
- Start manual research runs and inspect scheduled runs.
- Show the declared pipeline and observed progress for discover, resolve, capture, normalize, classify, media QA, and publish.
- Support bounded retry, pause, quarantine, low-confidence review, and explicit publish approval with receipts.
- Browse, search, filter, compare, and inspect normalized creative and its evidence without exposing raw provider payloads, private paths, prompts, credentials, contact data, or prospect data.
- Publish closed, immutable `schema://frank.ad-intelligence-release/v1` releases for approved consumers.
- Preserve identifiers, hashes, observation history, evidence references, queue state, and media references during cutover.
- Open decision: the exact central Hermes adapter/deployment boundary for the legacy Blockwise TypeScript workers must be proven on the VPS before the old copies are retired.
- Open decision: production row counts, schema version, and runtime connectivity are verified during cutover and must not be guessed in UI copy or fixtures.

## Brand Commitments

- Confirmed: the product is named Frank; the app is named Ad Radar.
- Confirmed: Frank is a window, not a second brain. Product copy must say what Frank shows and what Hermes runs.
- Confirmed: the existing Frank mark, voice, one-viewport shell, and operator interaction language remain authoritative.

## Evidence on Hand

- `DESIGN.md` and the current Frank Window implementation define the incumbent visual system.
- `tools/ad-template-generator/` and `/ad-studio` demonstrate the canonical dedicated-app, durable-run, event, approval, and release integration pattern.
- `tools/ad-intelligence/` contains the current manifest, pipeline, public export and release schemas, deterministic run state, safe home projection, fixtures, and migration map.
- The Blockwise repository contains the legacy public-ad capture, resolver/classifier, media QA, accuracy audit, refresh/work queue, evidence retention, customer read model, search/filter, and creative-card implementations.
- No production runtime state or customer/prospect data is fabricated for the build. Synthetic UI fixtures, when needed for tests, are labelled and never presented as live state.

## Product Principles

1. Show the evidence chain, not an unexplained result.
2. Keep execution durable and singular in Hermes.
3. Make attention states actionable: explain why work stopped and offer only valid recovery actions.
4. Separate public creative intelligence from contacts, prospects, outreach, and raw provider evidence.
5. Cut over in place with measurable gates; never duplicate the production research plane.

## Accessibility & Inclusion

The operator app must remain fully keyboard-usable, expose named landmarks and tab relationships, preserve visible focus, announce live status changes without stealing focus, avoid color-only status meaning, and adapt to desktop and mobile web viewports.
