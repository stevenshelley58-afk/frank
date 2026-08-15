# Hermes Connections Agent contract

Frank is only the authenticated transport and display boundary. It does not
reason, select models, invoke tools, run provider adapters, or host an agent
loop. Hermes remains the sole brain and executor.

## Existing compatibility surface

`GET /api/connections` is unchanged. Existing consumers continue to receive
`connections[]` records with `id`, `name`, `provider`, `status`, `scope_kind`,
`scope_id`, `connection_ref`, `credential_ref`, `last_verified_at`, and
`capabilities`. The catalog continues to expose `provider`, `title`,
`capabilities`, and `setup_mode`. The only additive connection field is
`revision` for optimistic concurrency. Status values remain exactly:
`setup_needed`, `connected`, `verified`, and `error`; `connected` means
configured and awaiting verification.

## Additive endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/connections/plan` | Manual plan creation; source is derived as `manual`. |
| `POST /api/connections/apply` | Same-origin manual confirmation/apply endpoint. |
| `POST /api/connections/agent/plan` | Authenticated Hermes-produced plan ingress. |
| `POST /api/connections/agent/apply` | Authenticated application of a Hermes-issued plan. |
| `GET /api/connections/agent/inspect?activity_limit=N` | Authenticated bounded Hermes read model: compatible connections, newest attention, and newest activity. `N` is capped at 50. |
| `GET /api/connections/attention` | Latest unresolved action per correlation id. |
| `GET /api/connections/activity` | Cursor-pollable safe action activity (`?after=<sequence>`); add `latest=1` for a newest-first page. |
| `GET /api/connections/events` | Alias of the activity projection for widget polling. |
| `GET /api/connections/receipts/<receipt_id>` | Safe receipt lookup. |

All plan/apply/mutation requests require a validated `Idempotency-Key` (or the
equivalent JSON field). Plan/apply responses and errors are `no-store`.
Activity, attention, and receipt responses and errors are also `no-store`.
The activity endpoint preserves its existing oldest-first `after` cursor
behavior by default. `latest=1` is an additive newest-first projection over
the same append-only records; `after=N` still restricts it to sequences newer
than `N`, and action fields are unchanged.
Manual writes require a strict same-origin `Origin`; missing, `null`, or
foreign origins are rejected against the explicit
`FRANK_CONNECTION_ALLOWED_ORIGINS` allowlist (default includes canonical
`https://frank.fail` and explicitly configured local test origins; Host and
X-Forwarded-Proto are never used to infer trust). Agent routes require `Authorization: Bearer <HERMES_CONNECTIONS_AGENT_KEY>`,
which is separate from the ordinary browser/session boundary, and require the
`default` Hermes profile (`X-Hermes-Profile: default`). Source and actor are
fixed by the trusted route/auth context as `connections-agent` and
`hermes.connections-agent`; request payloads cannot forge them.

The inspect seam is the single private Hermes read boundary. It accepts only
the optional `activity_limit` query parameter, defaults to 50, and clamps it
to 50; arbitrary paths and query parameters are rejected. It returns only the
compatible connection fields plus newest safe attention and activity
projections. Those projections contain opaque vault references and
allowlisted receipt/result metadata only: no provider URLs, admin URLs,
secrets, request bodies, or free-form provider error prose. The browser never
calls this endpoint; the named Hermes Connections Agent uses it with the same
Bearer key and `default` profile contract as the agent mutation routes.

Mutation request bodies are capped at 64 KiB and are rate-limited per source
address. Plans persist only normalized connection-schema deltas and allowlisted
opaque target metadata; raw request bodies never reach the plan store. Ledger
and plan state are fail-closed: malformed JSON, unknown actions/states, and
unsafe records return a safe `503` error and are never silently discarded.

Manual deletion is an explicit sequence: create a delete plan, present its
one-time `confirmation_token` to the user, then apply it through
`POST /api/connections/apply` with a new idempotency key. The exact UI request
sequence is:

1. `POST /api/connections/plan` with `{action, target/connection_id,
   expected_revision, idempotency_key}`. The response contains `plan_id` and,
   for revoke/delete, the one-time `confirmation_token`.
2. For destructive actions, show an explicit confirmation UI and send
   `POST /api/connections/apply` with `{plan_id, confirmation_token,
   idempotency_key}`. For manual verify/sync/revoke this returns `202` with
   `action.state=waiting_for_provider`; it never claims provider completion.
3. Hermes later calls the authenticated
   `POST /api/connections/agent/apply` route for that same `plan_id`, with a new
   idempotency key plus `{provider_receipt, provider_outcome}`. Success uses
   the action-specific outcome (`verified`, `synced`, `revoked`, etc.). A
   provider failure uses `provider_outcome: "failed"` plus only
   `provider_error_code` and an allowlisted `provider_error_category` (such as
   `timeout`, `unavailable`, or `permission_denied`). The response is `200`
   with `action.state=failed`, never `completed`; relevant connection metadata
   is recorded as `error` and the failure receipt remains in attention.

Manual create may record only `setup_needed` or `connected` metadata. Manual
update may omit `status` for ordinary metadata edits, preserving an existing
provider-owned `verified` or `error` status; any explicit manual status change
is limited to setup metadata and cannot escalate or downgrade provider-owned
truth. Only a receipt-backed Hermes result may record `verified` or `error`.
Provider
failure text is not accepted; only the opaque receipt and safe code/category
are persisted. Agent
create/update/delete also require provider evidence. Agent `discover` is local
metadata discovery and may complete without provider evidence. Frank never
marks provider work complete, verified, synced, or revoked from a plan alone.
All routes use the same mutation service, append a reservation before any
local mutation, append completion/failure afterward, and honor idempotency keys,
one-time confirmation consumption, and `expected_revision` preconditions.
Revoke and delete plans require the exact current connection `revision`; the
revision is recorded with the action and target in the plan, then revalidated
while applying the confirmation. A changed, missing, or replayed destructive
plan fails with a safe `409` rather than mutating a newer connection.

Home binding validation and connection delete/rescope share one Frank process
transaction lock. Connection mutations take their service lock before that
shared lock; home saves take the shared lock only. This makes binding
validation plus persistence atomic against delete/rescope and prevents a
dangling or out-of-scope widget binding.

Required frontend delta: do not change the existing reusable widget files in
this backend lane. The UI lane must send fresh idempotency keys, use the
plan/confirm/apply sequence above, render `202 waiting_for_provider` as pending,
and poll attention/activity/receipts until Hermes supplies the provider result.
The current backend intentionally returns `409` for a direct DELETE without a
confirmed plan so deletion cannot bypass the one-time token.

Ledger records are safe metadata only: source, actor, action, target provider/
connection/consumer/project/environment, state/progress/result, timestamps,
receipt/correlation IDs, and redacted errors. Credentials, provider secrets,
confirmation hashes, and request bodies are not included in ledger read models.

## Hermes registration boundary

This Frank repository does not register a Hermes skill, private session, model,
tool, or provider adapter. Runtime registration remains pending in Hermes. The
intended registration is one named private Connections Agent skill/session
inside the single `default` Hermes profile, invoking these two ingress routes
with `HERMES_CONNECTIONS_AGENT_KEY`; it must call provider adapters through
Hermes policy and use the returned receipts for follow-up. Until Hermes
registers that skill/session and supplies the separate key, the Frank agent
routes intentionally return `503` rather than implying that Frank can execute
the agent.
