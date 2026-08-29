# Frank frontend API contract

`mini_api.mjs` is the only transport boundary used by the Frank UI. The
frontend sends `Accept: application/json` on every request, `credentials: omit`,
`X-Mini-Claim`, and `Authorization: Bearer <claim>` on claimed requests. Every
mutation also sends a unique `Idempotency-Key`. The server should treat retries
with the same key as the same effect.

The normal first-request path creates an intake, uploads any files, then streams
one concise Hermes conversation turn. This is the customer-facing fast path:
the UI renders the answer as it arrives and keeps the intake resumable if the
browser disconnects. When the customer chooses **Resume**, the UI submits the
intake. Submit returns `202` with `{ job, claim_token }`; the job is durably
`queued` and the UI polls its status. Submit itself does not create a Hermes
session or run; the background reconciler owns full build dispatch.

## Existing routes

| Method | Route | Response used by the UI |
| --- | --- | --- |
| GET | `/api/mini/config` | `attachments`, `job_attachment_uploads`; optional `delete_available`, `revoke_available`, `make_another` |
| POST | `/api/mini/intakes` | `claim_token`, `intake` |
| GET / DELETE | `/api/mini/intakes/:id` | `intake` / `{ deleted }` |
| POST / DELETE | `/api/mini/intakes/:id/attachments[/:attachment]` | `intake` |
| POST | `/api/mini/intakes/:id/chat` | JSON reply or SSE assistant stream |
| POST | `/api/mini/intakes/:id/submit` | `job`, optional `claim_token` |
| GET | `/api/mini/jobs/:id` | `job` |
| POST / DELETE | `/api/mini/jobs/:id/attachments[/:attachment]` | `job` |
| POST | `/api/mini/jobs/:id/dispatch` | `job` |
| POST | `/api/mini/jobs/:id/changes` | `job` |

The UI expects `job.id`, `stage`, `problem`, `created_at`, `updated_at`,
`available_until`, `retry_available`, `automatic_retry_at` when queued, and
`result` when `stage` is `ready`. A result can include `title`, `summary`,
`preview_url`, `artifacts[]`, `checks`, `limitations`, and `details_url`.
Artifact items use `kind` (`interactive` or `download`), `label`, `url`, and
optional `media_type`. Preview URLs are rendered in a sandboxed iframe.

## Optional lifecycle routes

These controls stay hidden until the server advertises the corresponding
capability in `/api/mini/config` or the job response:

- `POST /api/mini/jobs/:id/feedback` with `{ rating: "useful" | "not_yet", reason?: "missing_piece" | "wrong_format" | "needs_more_context" | "hard_to_use" | "other" }`.
- `DELETE /api/mini/jobs/:id` to immediately delete the conversation, files, and result.
- `POST /api/mini/jobs/:id/revoke` to revoke bearer-link access.

Delete/revoke responses should be successful and idempotent. Error responses
should be JSON with a human-readable `error` and optional stable `code`.
`404` means the private record is no longer available; `409` means the current
state does not allow that mutation; `429` should explain when to retry.
