# Security

Frank Hub is private infrastructure. This repository should remain private even
though no secrets belong in it.

## Repository And Secrets

- Do not commit `.env`, API keys, private keys, tokens, or provider credentials.
- Keep deploy keys read-only.
- Prefer GitHub deploy keys over a GitHub PAT on the VPS.
- If a fine-grained GitHub token is used as a fallback, never print it or store
  it in repository files.

## Cloudflare Access

`/healthz` is public so Docker, Cloudflare, and uptime checks can verify the API.
All `/v1/*` routes are protected when `CLOUDFLARE_ACCESS_ENABLED=true`.

The API validates the `Cf-Access-Jwt-Assertion` header using Cloudflare Access
remote JWKS:

```text
<CLOUDFLARE_ACCESS_ISSUER>/cdn-cgi/access/certs
```

Validation checks issuer and audience and fails closed when configuration is
missing or the JWT is invalid. Issuer validation stays strict. Audience
validation accepts any value listed in `CLOUDFLARE_ACCESS_AUDS`, a
comma-separated allowlist for hostnames such as `hub.frank.fail/api/*` and
`api.frank.fail/v1/*`. Existing deployments can keep using
`CLOUDFLARE_ACCESS_AUD` as a single-AUD fallback, but new config should prefer
`CLOUDFLARE_ACCESS_AUDS`. Keys are fetched remotely through `jose`, so key
rotation does not require hardcoding a public key in the repo.

## Deploy Metadata

`scripts/deploy.sh` writes safe deployment metadata to `runtime/deploy.json`
before building containers. The file contains only branch, commit, deploy
timestamp, schema version, and package version when available. It does not
include raw environment values, secrets, tokens, or host command output.

The API reads that file read-only for `/v1/ops/deploy`. If it is missing or
invalid, deploy metadata is reported as unavailable instead of falling back to
raw environment display or arbitrary command execution.

## Runtime

- Services bind to `127.0.0.1` host ports for tunnel access.
- Postgres and Redis are internal Compose services.
- Cloudflare Tunnel publishes `hub.frank.fail` and `api.frank.fail`.
- The dashboard uses `/api` same-origin calls to avoid first-stage CORS and
  browser auth friction.
