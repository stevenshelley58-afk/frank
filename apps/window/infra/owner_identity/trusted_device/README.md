# Owner trusted-device verifier

This host service adds a proof header only when the remote Tailscale peer exactly matches an explicitly allowed owner device. It is not login and never grants a session. Failures return `200` without proof so normal owner sign-in remains available; a missing or wrong edge gate returns `403`.

## Contract

Caddy calls `GET http://172.31.50.1:18089/verify` with `X-Frank-Device-Gate` and `X-Frank-Device-Address` set to Caddy's `{remote_host}` literal IP. It accepts only Tailscale CGNAT IPv4 or Tailscale IPv6 and calls `/localapi/v0/whois?addr=...` via `/var/run/tailscale/tailscaled.sock`.

`Node.StableID` must equal `node_id`, while both `Node.User` and `UserProfile.ID` must equal `user_id` in one allowlist row. There is no subnet, tailnet, hostname, email, or phone-wide trust. Timeout, bad reply, changed identity, or a removed row denies trust.

## Root-owned configuration

Create `/srv/frank/secrets/owner-trusted-devices.json` as a root-owned `0600` regular file, never in Git or logs:

```json
{"gate_secret":"edge-to-verifier-secret","proof_secret":"verifier-to-caddy-secret","devices":[{"node_id":"n6HvGtfdy221CNTRL","user_id":"6781099988612671","label":"owner laptop"}]}
```

Do not add a phone until its actual StableID and user IDs are verified. Systemd passes this file as `$CREDENTIALS_DIRECTORY/config` through `LoadCredential`; the service does not read the host secret path.

## Install

Run as root from clean `/projects/frank` on `main`:

```sh
cd /projects/frank/apps/window/infra/owner_identity/trusted_device
./install.sh
```

The installer rejects uncommitted or untracked component source, archives the selected commit to `/srv/frank/releases/trusted-device/<full-sha>`, compares archive and canonical source, and points the unit through `CURRENT`. It never copies configuration. Caddy and secret setup remain owner identity/edge work.

```sh
python3 -m unittest discover -s tests -v
```
