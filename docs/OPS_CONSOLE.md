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
- `POST /api/ops/actions` — forwards a typed request through the existing Hermes control/action boundary; it never calls a provider locally
