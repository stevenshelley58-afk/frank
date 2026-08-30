# Mini Frank browser API contract

`mini_api.mjs` is Mini Frank's only browser transport boundary. Frank owns
authentication, policy, version checks, idempotency and durable state; Hermes
is the only reasoning/build brain. The browser renders typed server state and
does not infer provider availability, prices, DNS settings or authority.

Every claimed job/intake request sends `X-Mini-Claim` and a bearer header.
Every mutation sends `Idempotency-Key`. Versioned mutations include
`base_version` in JSON plus `X-Mini-Base-Version`/`If-Match` transport hints.

Mini's browser account continuity token is separate from each job claim. The
server returns `account_claim_token` (`ma1.<payload>.<signature>`); the browser
stores it under its own key and sends it only as `X-Mini-Account-Claim` when
creating a later intake. It never appears in a URL, share or customer-facing
screen.

## Core project lifecycle

| Method | Route | Main response |
| --- | --- | --- |
| GET | `/api/mini/config` | product capabilities and attachment limits |
| POST | `/api/mini/intakes` | `claim_token`, `account_claim_token`, `intake` |
| GET / DELETE | `/api/mini/intakes/:id` | `intake` / deletion receipt |
| POST / DELETE | `/api/mini/intakes/:id/attachments[/:attachment]` | updated intake |
| POST | `/api/mini/intakes/:id/chat` | Hermes SSE/JSON reply |
| POST | `/api/mini/intakes/:id/submit` | `job`, `claim_token`, `account_claim_token` |
| GET | `/api/mini/jobs/:id` | typed owner job projection |
| POST / DELETE | `/api/mini/jobs/:id/attachments[/:attachment]` | updated job |
| POST | `/api/mini/jobs/:id/dispatch` | updated job |
| POST | `/api/mini/jobs/:id/changes` | next free revision |
| DELETE | `/api/mini/jobs/:id` | deletion receipt |
| POST | `/api/mini/jobs/:id/revoke` | owner-return-link revocation receipt |

Planning, builds, revisions and later projects retain a free path. There is no
paid additional-project entitlement or quota copy in the browser. A transient
capacity response is recoverable and must not be converted into a sales gate.

## Result continuation

Ready jobs carry versioned `guidance` and `self_host` objects. Dedicated reads
are also available at `GET /api/mini/jobs/:id/guidance` and
`GET /api/mini/jobs/:id/self-host-guide`. Guidance is specific to the current
revision: use now, free revisions, related free work and an optional larger
implementation path. The self-host guide contains honest applicability,
requirements, steps, ongoing operations and a server-owned service boundary.

## Sharing

| Method | Route | Purpose |
| --- | --- | --- |
| GET / PATCH | `/api/mini/jobs/:id/sharing` | read/change mode, role and scope using the sharing version |
| POST | `/api/mini/jobs/:id/shares` | atomically create a fresh bearer link from restricted mode |
| POST | `/api/mini/jobs/:id/shares/:share/rotate` | rotate the active link |
| DELETE | `/api/mini/jobs/:id/shares/:share` | revoke the active link |
| GET | `/api/mini/shares/:token` | read the safe shared projection |
| GET / POST | `/api/mini/shares/:token/comments` | read/add comments or suggestions allowed by the role |
| GET | `/api/mini/published/:job` | read the published projection |

Modes are `restricted|link|published`, roles are
`viewer|commenter|editor`, and the shipped scopes are `result|project`.
Named invitations remain unavailable while identity/email delivery is
deferred; the UI says so plainly. Shared users can never execute, pay, request
service, or obtain owner/account claims.

## Optional money and service requests

`GET /api/mini/tips/config` and `POST /api/mini/tips/intents` return a
provider-neutral tip intent. Unless the server explicitly advertises amount
support, the browser sends `{}` and lets the provider collect the amount. Tips
never alter entitlement or priority.

`GET /api/mini/jobs/:id/service-options` supplies the available hands-on paths,
contact methods, honest availability message and `price_status`. The browser
does not invent options when this state is unavailable.

`GET|POST /api/mini/jobs/:id/service-requests` lists or submits an explicitly
owner-reviewed request. Kinds are `self_host_help`, `managed_hosting`,
`video_call`, `perth_visit`, or `custom_project`. The required private contact
is `{method: email|phone|whatsapp|other, value}` so the saved request has an
actionable reply path. A successful request is
`saved_for_review`; no notification, execution or payment is implied unless
the typed response explicitly reports it.

Errors are JSON with a human-readable `error` and optional stable `code`.
`404` means a private/shared record is unavailable; `409` means the supplied
version or current state conflicts. The browser preserves the conversation and
offers a safe retry without inventing a commercial explanation.
