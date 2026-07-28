# ADR-018 — Plain system-font design system and progressive disclosure

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §1.2.7, §3.2, §3.3 |

## Context

FRANK is Steven's personal operating system and must remain simple to use. Trendy design and animation create cognitive overhead and fragility. System fonts are fast, familiar, and respect user preferences. Progressive disclosure shows essential information first and details on demand.

## Decision

Use plain system-font typography, restrained color (high contrast), clear hierarchy, and progressive disclosure. No decorative animation or effects that distract from content.

## Alternatives considered

- Branded design system with custom fonts (rejected: increases CSS/JavaScript; creates maintenance burden; Steven says it makes the system harder to use)
- Dark mode only (rejected: loses high-contrast flexibility; users can apply OS-level dark mode)

## Consequences

- **Buys:** Fast load times; accessible to users with motion sensitivity; respects system preferences; simple CSS; familiar interface; reduces cognitive load
- **Costs:** Cannot use decorative design trends; must resist scope creep in visual effects

## Measured evidence

§3.1 (design direction) states the direction. §14.2 (accessibility review) and §14.3 (product review) measure UI clarity and usability. §25 (risks) notes "too much UI complexity" as a managed risk.

## Migration and exit trigger

Design tokens may be updated through theming; contracts remain stable. If users consistently report confusion or accessibility issues, refine the design system following the same progressive-disclosure and system-font principles.
