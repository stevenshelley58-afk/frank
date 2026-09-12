# Private owner notifications (ntfy)

This is a small OSS-first ntfy service for Frank owner alerts. It is private,
loopback-only, and has no public signup or DNS/Caddy route. The image is the
official `binwiederhier/ntfy:v2.14.0` image pinned by manifest digest.

The first deploy creates `/srv/frank/secrets/owner-notifications/server.yml`
and `owner-notifications.env`, both mode `0600`, outside Git. The cache and
native ntfy auth database live in the named Docker volume
`frank_owner_notifications_cache`; cached messages are retained for 24 hours.
The generated credentials are not printed or committed.

The `owner` account has read-only access to `owner-notifications`; the
`publisher` account has write-only access. Anonymous/default access is
`deny-all`. Native ntfy ACLs are converged idempotently by `deploy.sh`.

## Verify and run locally on the VPS

From the exact committed Frank revision:

```bash
cd /projects/frank/apps/window/infra/owner_notifications
./test.sh
./deploy.sh
./check.sh
```

The service listens only on `http://127.0.0.1:18104` by default. Set
`NTFY_HOST_PORT` and `NTFY_SECRET_DIR` before the first deploy to choose a
free loopback port and external secret directory. Do not put secrets in the
checkout. No production device notification is claimed by this bundle.

A future native Frappe webhook can publish to the authenticated ntfy endpoint
using the `publisher` credential. That hook is intentionally disabled and no
provider or external-message write occurs here.

## Operations

Use `./deploy.sh` for upgrades and `./check.sh` for health. Never run
`docker compose down -v`: the named cache/auth volume is durable. To roll back,
restore the prior committed image digest and rerun deploy/check. Back up the
external secret files and named volume using the VPS backup policy before
maintenance.
