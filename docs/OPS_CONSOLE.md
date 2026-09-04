# Blockwise customer operations console

Frank's `/ops` view is a read-only customer operations surface. Hermes is the
only publisher of its data and the only executor of actions.

## Projection contract

Hermes writes one JSON envelope per projection into
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

The publisher entrypoint is
`apps/window/scripts/publish_ops_projections.py` (run from the repository root
as `PYTHONPATH=.:$PWD/apps/window python -m apps.window.scripts.publish_ops_projections`).
When `BLOCKWISE_OPS_BASE_URL` is configured it is a signed, bounded HTTP client
for the Hermes-published Blockwise service-only `GET /api/internal/ops/customers` read contract and its
workspace detail endpoint; otherwise it consumes a Hermes-owned
bundle (`project_id`, `workspace_ids`, `source_revision`,
`source_receipt_ids`, and a `projections` object), validates every known field,
then publishes all projection files with atomic replacement and a publication
receipt. `infra/ops/frank-ops-projections.service` and `.timer` are installed
by the existing control-plane installer and use the production
`/srv/frank/data/window/ops-source` and `ops-projections` mounts.
The client reads the shared canonical secret only from
`BLOCKWISE_INTERNAL_AUTH_SECRET_FILE` (production path
`/srv/frank/secrets/blockwise-internal-auth.secret`); installers require an
existing regular root:hermes mode-0640 file and never generate or print it.
Requests use Blockwise's canonical raw-hex HMAC over
`v1\ntimestamp\nnonce\nops.read\nMETHOD\npath?query\nsha256(body)` and send
`x-blockwise-timestamp`, `x-blockwise-nonce`, and `x-blockwise-scope: ops.read`.
Each successful read validates the top-level `blockwise.ops.read.v1` envelope
(`schema`, `project_id`, `generated_at`, `fresh_until`, `source_revision`, and
`source_receipt_ids`) before parsing its `{data}` list/detail shape. The public
Blockwise envelope/list/detail fixtures are retained under
`apps/window/tests/fixtures`; omitted provider-normalized sections remain
`setup_needed` rather than becoming ready-empty projections.

## Routes

- `GET /api/ops/overview` — status, safe customer summaries, and projection health
- `GET /api/ops/projections/<name>` — one validated projection
- `GET /api/ops/customers` — bounded searchable customer list
- `GET /api/ops/customers/<id>` — correlated customer sections
- `GET /api/ops/enquiries/unassigned` — global/unassigned enquiries, never correlated to a customer
- `GET /api/ops/activity?customer_id=<id>` — unified activity and receipt correlation
- `POST /api/ops/actions` — forwards a typed request through the existing Hermes control/action boundary; it never calls a provider locally
