# Blockwise customer operations console

Frank's `/ops` view is a read-only customer operations surface. Hermes is the
only publisher of its data and the only executor of actions.

## Projection contract

Hermes writes one JSON envelope per projection into a complete generation under
`HERMES_OPS_PROJECTION_ROOT` (default `/data/ops-projections`):

```json
{
  "schema": "schema://frank.ops.customer-summary/v1",
  "version": 1,
  "projection": "customers",
  "project_id": "blockwise",
  "workspace_ids": ["123e4567-e89b-12d3-a456-426614174000"],
  "source_scope": {"project_id": "blockwise", "workspace_ids": ["123e4567-e89b-12d3-a456-426614174000"], "system": "customers"},
  "published_at": "2026-09-04T00:00:00Z",
  "fresh_until": "2026-09-04T00:15:00Z",
  "source_revision": "hermes-revision",
  "source_receipt_ids": ["receipt:ops/source-20260904"],
  "publication_receipt_id": "receipt:ops/20260904000000",
  "items": [{"id": "customer-1", "display_name": "Example", "email_masked": "e•••@example.test"}]
}
```

The nine projection names and exact schema identifiers are declared in
`apps/window/ops_projections.py`. Unknown fields, schema versions, malformed
timestamps, symlinks, and oversized files fail closed. Missing files are
reported as `setup_needed`; expired `fresh_until` values are reported as
`stale`. Unknown fields are never copied into the response.

The Blockwise/Hermes provider worker owns upstream reads, normalization,
publication, freshness, and provenance. Frank contains no Blockwise endpoint,
signing key, poller, publisher, scheduler, or provider adapter. It only reads
the Hermes-staged root, which production mounts at `/ops-projections:ro`.
Readers pin the `current.json` generation pointer and validate its publication
receipt, every envelope receipt/source revision, workspace scope, timestamps,
and safe fields before exposing data. A missing section is `setup_needed`, an
expired section is `stale`, and malformed or mismatched evidence is `error`.
The provider-neutral `blockwise.ops.read.v1` envelope/list/detail fixtures are
retained under `apps/window/tests/fixtures` as contract tests for the worker;
they are not fetched by Frank.

## Routes

- `GET /api/ops/overview` — status, safe customer summaries, and projection health
- `GET /api/ops/projections/<name>` — one validated projection
- `GET /api/ops/customers` — bounded searchable customer list
- `GET /api/ops/customers/<id>` — correlated customer sections
- `GET /api/ops/enquiries/unassigned` — global/unassigned enquiries, never correlated to a customer
- `GET /api/ops/activity?customer_id=<id>` — unified activity and receipt correlation
- `POST /api/ops/customer-actions` — forwards a typed request through the private Blockwise Control Edge; it never calls a provider locally

## Operator actions

The customer-ops controls use the private Blockwise Control Edge contract
`blockwise.ops.action.v1`. Frank creates the envelope server-side, derives the
operator identity from a root-owned AAL2 identity file, and signs each request
with timestamp, nonce, and scope (`ops.write` or `ops.read`). The browser sees
neither the Control Edge URL nor its secret, and no bearer-token action path is
used by the customer-ops controls.

The available controls are deliberately narrow and optimistic-concurrency
safe: invite, resend or cancel a pending teammate invitation; revoke an exact
customer session by the member's `profile_id`; assign an exact global
unassigned enquiry to a workspace member; and request billing reconciliation
against the authoritative workspace billing row. Every action requires an
explicit reason, a target-specific `ops_version`, and an idempotency key. The
Control Edge's `pending`/`completed`/failure states are mapped to Frank's
queued/processing/succeeded/retryable/permanently failed/unavailable receipt
states; Frank does not present a local mutation as successful.

Frank durably reserves each canonical operator intent in
`FRANK_OPS_ACTION_JOURNAL_FILE` before the signed POST. The journal is bounded,
append-safe, and atomically replaced; a timeout or lost response after a
restart reuses the stored action and idempotency identities. Key/fingerprint
conflicts fail closed, and a new identity is only available after a terminal
receipt or a genuinely new intent.

Replying to or closing enquiries, changing consent or roles, rescheduling or
canceling bookings, and opening a billing portal are not exposed until the
provider contract supplies those capabilities. Billing reconciliation is an
operation request only; payment state remains provider-owned.

### Provisioning checklist

Set `FRANK_OPS_CONTROL_URL`, `FRANK_OPS_OPERATOR_ROLE=support` or `owner`, and
`FRANK_OPS_OPERATOR_AAL=aal2`. Mount two separate root-owned mode-0600 regular
files at `FRANK_OPS_CONTROL_SECRET_FILE` and
`FRANK_OPS_OPERATOR_ID_FILE`; symlinked paths, non-owned parent directories,
and broad file or any-ancestor directory permissions are rejected at request
time. Root-owned 0755 system ancestors (and the sticky root-owned `/tmp`
staging root) are allowed; writable non-sticky or non-root-owned ancestors are
not.
The Control Edge must allow the Frank host's `ops.write` and
`ops.read` HMAC scopes and expose the `blockwise.ops.action.v1` receipt API.
Do not put secret values in `.env`, the browser bundle, projection files, or
source control.
