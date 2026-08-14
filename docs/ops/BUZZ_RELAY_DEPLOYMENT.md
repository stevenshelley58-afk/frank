# Buzz Relay Deployment (FRANK cell)

Real upstream [block/buzz](https://github.com/block/buzz) relay, deployed 2026-08-01.
This is the S6 infrastructure base; the `frank-buzz` boundary layer (BuzzPort,
signed-event projections, §4.13 / BUZZ-001…012) is a later build on top.

## Where it lives
- Compose bundle: `/frank/deployed/buzz/` (vendored from `deploy/compose/`, NOT in this repo).
- Secrets: `/frank/deployed/buzz/.env` (git-ignored; relay private key, DB/Redis/S3
  passwords, git-hook HMAC, owner pubkey). Back these up before upgrades.
- Image: `ghcr.io/block/buzz:main` (pin to a digest/semver per spec §7.3 before prod).

## Stack
relay (Rust/Axum, port 3000 inside, host 3384) + postgres:17 + redis:7 + minio.
All on the `buzz-prod_buzz-net`; relay is ALSO connected to the external `frank`
network so frank-caddy can reach it by container name.

## Public access — `https://buzz.frank.fail`
Routed through **frank-caddy** (owns 80/443), not Buzz's own Caddyfile (that
would fight for 80/443). Added a `buzz.frank.fail` block in
`/frank/deployed/infra/Caddyfile` reverse-proxying to `buzz-prod-relay-1:3000`.
- DNS: **grey-cloud** A record `buzz → 76.13.209.160` (proxy OFF) so Let's
  Encrypt ACME (http-01/tls-alpn-01) can issue the cert. Proxy-on blocks ACME.
- Cert auto-managed by Caddy; first issuance can race DNS propagation — it
  retries in 60s and succeeds once the A record is globally live.

## Operations
cd /frank/deployed/buzz && ./run.sh {start|stop|restart|status|logs|upgrade}
./run.sh add-member <npub-or-hex> [--role member|admin]   # sleep 1 between adds
./run.sh list-members

Health: GET https://buzz.frank.fail/_liveness -> ok ; /_readiness -> {"status":"ready"}

## Gotchas
- Host port 3000 was taken by mem0 dashboard; relay uses 3384. Only the relay is
  host-published — postgres/redis/minio are internal to buzz-net.
- Closed relay: `BUZZ_REQUIRE_AUTH_TOKEN=true`, membership required. Owner pubkey
  is auto-registered; add agents/humans via `add-member`.
- A Nostr/WS client connects at `wss://buzz.frank.fail` (Caddy passes WS through).
