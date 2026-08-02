---
name: frank-spec
description: Lazy-load the FRANK build spec one chapter at a time. Use instead of reading the full 3468-line spec — run scripts/chapter.py <N> to pull just the chapter you need.
metadata:
  frank:
    source: virgiliojr94/book-to-skill (concept adapted to Frank's skill format)
---

# FRANK Spec — Lazy-Load Index

The master spec `docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` is 3,468
lines across 30 chapters. **Never read the whole thing.** Load one chapter at a
time with the extractor:

```bash
python3 skills/misc/frank-spec/scripts/chapter.py <N> [--max-chars 4000]
```

Default 4000-char cap. Big chapters (§6 Core contracts 441 ln, §21 workstreams
354 ln, §16 infra 224 ln) truncate — rerun with a higher `--max-chars` for the rest.

## Chapter map (pick by topic, load by number)

| § | Lines | Chapter — when to load it |
|---|-------|---------------------------|
| 0 | 17–59 | How to use this spec — precedence & change control |
| 1 | 60–113 | Product charter — outcomes, principles, boundaries |
| 2 | 114–183 | Users, trust zones, data classification (§2.3 trust labels) |
| 3 | 184–362 | Experience spec — nav, routes, screen contracts |
| 4 | 363–583 | Functional requirements — capture, work model, calendar/email, Buzz (§4.13) |
| 5 | 584–654 | System architecture overview |
| 6 | 655–1095 | **Core modular contracts** — the package interfaces (BIG) |
| 7 | 1096–1232 | Agent kernel — context pack (§7.4), memory port |
| 8 | 1233–1314 | Harness & protocol architecture (§8.4 broker) |
| 9 | 1315–1418 | Model Broker & inference capacity |
| 10 | 1419–1514 | **Memory & second-brain architecture** (BRAIN-006) |
| 11 | 1515–1662 | Canonical data model |
| 12 | 1663–1798 | API, events, real-time updates |
| 13 | 1799–1972 | Durable workflows & automation |
| 14 | 1973–2068 | App factory specification |
| 15 | 2069–2200 | Security, privacy, safety — action boundary (§15.6 egress) |
| 16 | 2201–2424 | Infrastructure & deployment (BIG) |
| 17 | 2425–2519 | Repository & codebase design |
| 18 | 2520–2609 | Quality, evaluation, release gates |
| 19 | 2610–2678 | Observability & operations |
| 20 | 2679–2703 | Acceptance scorecard |
| 21 | 2704–3057 | **Construction workstreams & dependency order** (BIG) |
| 22 | 3058–3136 | White-label readiness |
| 23 | 3137–3203 | Technology candidate decisions |
| 24 | 3204–3232 | ADR index |
| 25 | 3233–3254 | Risks & mitigations |
| 26 | 3255–3318 | Required product runbooks |
| 27 | 3319–3414 | Source & standards register |
| 28 | 3415–3441 | Source-to-requirement trace |
| 29 | 3442–3468 | Final build directive |

## Rules

1. **Load by topic.** Decide the 1–2 chapters a task actually touches; load only those.
2. **Decisions beat spec.** The locked product decisions in `references/frank-home-rooms-architecture.md` (in the frank-product skill) override spec-derived instinct. Load the spec chapter for detail, not to re-derive the product.
3. **Big chapters paginate.** §6, §16, §21 won't fit in one 4000-char pull — page with `--max-chars`.
