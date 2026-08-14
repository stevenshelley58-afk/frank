# Frank vault and provider broker

Frank is a write-only client of a narrow Hermes-side vault broker. Frank does
not receive an Infisical token and does not contain a reveal endpoint or a
generic Infisical proxy.

## Community Edition boundary

The Hermes-side broker may use the direct Infisical v4 secrets API against a
self-hosted Community Edition instance. It must use a project-scoped token
with only the required environment/path permissions, and must request
`viewSecretValue=false` and `expandSecretReferences=false` for metadata lists.
The CE service-token scope is not equivalent to write-without-read access:
Infisical service tokens can be provisioned with read and/or write access, but
the broker must not claim that a read-capable token is write-only. Secret
values, the Infisical credential, and the Infisical client stay on the Hermes
side until CE offers a separately verified write-only capability.

No Infisical secret syncs, enterprise app connections, Universal Auth, or
automatic provider credential injection are assumed here. Activepieces CE is
setup-needed and remains authoritative for its own credentials.

## Frank runtime configuration

Only the narrow Hermes endpoint and its dedicated broker credential belong in
Frank's runtime environment. Frank must not reuse the broad Hermes API key.
Use placeholders in deployment configuration:

```dotenv
HERMES_VAULT_BROKER_URL=https://hermes.example.invalid/api/vault-broker
HERMES_VAULT_BROKER_KEY=replace-with-dedicated-vault-broker-credential
FRANK_VAULT_ALLOWED_ORIGINS=https://frank.fail
FRANK_VAULT_MAX_SECRET_BYTES=65536
FRANK_VAULT_RATE_LIMIT=30
```

Do not add `INFISICAL_TOKEN`, `INFISICAL_CLIENT_SECRET`, or provider keys to
Frank's environment, compose file, JSON data, fixtures, logs, or browser
configuration. The Hermes-side deployment owns those values.

## Write-only API

All responses carry `Cache-Control: no-store`. Secret writes require an
`Origin` accepted by `FRANK_VAULT_ALLOWED_ORIGINS`, a bounded JSON body, a
valid `Idempotency-Key`, and the in-process rate/concurrency guards.
Broker HTTP requests use an explicit no-redirect transport; any same-host or
cross-host redirect is treated as a safe broker failure and never replays the
Bearer credential.

| Endpoint | Contract |
| --- | --- |
| `GET /api/vault/status` | Performs a cached, non-secret Hermes broker health check and reports `setup_needed`, `unavailable`, `permission_denied`, `error`, or `verified`. |
| `GET /api/vault/secrets` | Lists only broker metadata and opaque `vault://frank/<id>` refs. |
| `POST /api/vault/secrets` | Accepts one scoped `secret_value`, forwards create to Hermes, returns metadata only. |
| `POST /api/vault/secrets/<id>/rotate` | Accepts one replacement `secret_value`, returns metadata only. |
| `DELETE /api/vault/secrets/<id>` | Deletes by opaque ref; returns only the removed ref. |
| `GET /api/provider-broker/catalog` | Describes provider capabilities and honest setup state. |
| `GET /api/provider-broker/bindings` | Lists least-privilege opaque-ref bindings. |
| `POST /api/provider-broker/bindings` | Binds a vault ref to an approved provider consumer/capability subset. |

There is deliberately no read, reveal, raw Infisical, or arbitrary upstream
proxy endpoint. The adapter filters even an accidentally value-bearing
Hermes response before it crosses into Frank's response, persistence, or
audit records.

## Provider contracts

Resend is the first available adapter. It binds `RESEND_API_KEY` to
`hermes-resend-mcp` with `email.send` and `email.status` capabilities; Hermes
performs the Resend action. Mautic SMTP and Activepieces remain
`setup_needed` until their adapters are available. Activepieces credentials
must be configured in its own secure CE UI.

## Existing Connections compatibility

The existing `GET /api/connections` endpoint and its mutation semantics are
unchanged. It continues to return the existing connection metadata model,
including `id`, `name`, `provider`, `status`, `scope_kind`, `scope_id`,
`connection_ref`, `credential_ref`, `last_verified_at`, and `capabilities`.
Its status vocabulary remains exactly `setup_needed`, `connected`,
`verified`, and `error`; `connected` means configured and awaiting
verification. The vault/provider endpoints above are additive read models and
do not replace the Connections store.

This Frank commit implements only the client/boundary and safe metadata
surface. It does not implement or claim that the Hermes-side vault broker
service exists; `HERMES_VAULT_BROKER_URL` must point to that separately
deployed service.

The additive provider catalog uses the constrained display states `ready`,
`setup_needed`, and `error`: vault `verified` maps to `ready`; unavailable or
missing setup maps to `setup_needed`; permission or broker errors map to
`error`. The more detailed additive vault status endpoint retains the full
health vocabulary above.
