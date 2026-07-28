# ADR-007 — Browser/PWA is the complete client; Tauri adds native capability

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §3.2–3.7, §16.2 |

## Context

FRANK must be accessible on desktop, mobile, and browser without forcing Steven to use a native app. A progressive web application (PWA) provides one codebase and responsive UI across all platforms. Tauri adds native capabilities (system tray, desktop shortcuts, local credential bridge) for power users without forking the product.

## Decision

The browser application is the complete product surface. A signed Tauri shell wraps the same product modules and adds system tray, native notifications, secure local credential bridge, and optional local execution node.

## Alternatives considered

- Native desktop app as primary (rejected: duplicate codebase; mobile loses parity)
- Electron (rejected: larger footprint and less transparent than Tauri)
- Mobile app only (rejected: loses desktop power-user workflows)

## Consequences

- **Buys:** Single responsive codebase; accessible without installation; mobile-first design; Tauri users gain system integration and offline queue
- **Costs:** Tauri-specific features cannot be required for core workflows; browser security model limits local access; desktop-only capabilities must be optional

## Measured evidence

§3.4–3.7 define desktop and mobile acceptance criteria. §14.2 (build lifecycle) includes responsive and accessibility testing on all client forms.

## Migration and exit trigger

Browser product remains authoritative; Tauri wrapper is replaceable. If native requirements exceed Tauri capabilities, consider native wrappers per platform while preserving API and data model stability.
