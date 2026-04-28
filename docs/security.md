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
missing or the JWT is invalid. Keys are fetched remotely through `jose`, so key
rotation does not require hardcoding a public key in the repo.

## Runtime

- Services bind to `127.0.0.1` host ports for tunnel access.
- Postgres and Redis are internal Compose services.
- Cloudflare Tunnel publishes `hub.frank.fail` and `api.frank.fail`.
- The dashboard uses `/api` same-origin calls to avoid first-stage CORS and
  browser auth friction.
