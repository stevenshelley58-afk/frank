# Blockwise owner native application launch

## Scope

Frank's owner-only `/project/blockwise` route is a small launch surface, not an operations dashboard. It opens the native application that owns each task. It has no copied records, metrics, inbox, editor, campaign flow, billing state, connection simulator, provider transport, or browser persistence.

The real technical project home remains at `/project/blockwise?technical=1`. Other project homes and Frank's actual custom applications, including Ad Radar, audit, and templates, are unchanged.

## Native destinations

- Frappe CRM: `/crm/dashboard` and `/crm/leads` on private port 8445.
- Frappe Helpdesk: `/helpdesk/dashboard` and `/helpdesk/tickets` on private port 8445.
- Purelymail: `https://inbox.purelymail.com/`.
- Mautic: `/s/dashboard`, `/s/campaigns`, and `/s/emails` on private port 8447. Its native login is required. This is not SSO.
- Stripe, GA4, Search Console, Meta Ads, Google Ads, and Clarity: their official native dashboards.
- ntfy: private port 8446.

Private destinations are visibly marked as requiring Tailscale. Each native link opens in a new tab with `noopener noreferrer` and `no-referrer`. Frank does not embed an app, carry credentials, promise an existing login, or execute a provider action.

Scheduling has no deployed native interface. The launch surface says so and provides no demo or substitute control.

## Design

The surface preserves Frank's white, Inter, hairline, text-first shell. One `Open CRM` action is primary. The remaining destinations sit in short labelled lists, not a card wall. The mobile layout becomes one column and keeps each link's name, destination description, and Tailscale requirement visible.

## Verification boundary

Frontend checks prove known destinations, private-link labeling, safe external-link attributes, no embedding, routing to the Blockwise launch route, and retention of the technical home. They do not prove application authentication, SSO, data synchronization, reporting, delivery, billing, scheduling, or any provider write.
