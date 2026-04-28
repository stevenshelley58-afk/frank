# Stage 2 Audit And Ops API

Workstream 5 adds protected, read-only API surfaces for audit inspection and
operational status.

## Audit Log

- `GET /v1/audit-log`
- Protected by Cloudflare Access through the existing `/v1/*` hook.
- Returns newest audit rows first.
- `limit` is capped at `100`.
- `resource_type` maps to the existing `audit_log.target_type` column.
- `risk_level` and `project_id` filter against `audit_log.metadata`.
- Sensitive metadata keys are redacted recursively before response.
- Audit-log reads do not write a new audit event. This avoids recursive
  self-generating audit-log noise where reading the audit log creates another
  audit-log row to read.

## Read-Only Ops

- `GET /v1/ops/status`
- `GET /v1/ops/services`
- `GET /v1/ops/system`
- `GET /v1/ops/deploy`

Collectors are strictly allowlisted and best-effort. Docker, cloudflared, and
git status return unavailable fields when the runtime cannot safely access the
needed command or metadata. Ops routes do not accept command input and do not
return raw environment variables.
