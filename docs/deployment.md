# Deployment

Frank Hub deploys to the Hostinger KVM 4 VPS with Docker Compose. Do not deploy
until the repository is private, the VPS deploy key is added to GitHub, and the
`.env` file has been reviewed on the server.

## VPS Deploy Key

Preferred mode is a read-only GitHub deploy key. On the VPS, generate and print
the public key:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh && if [ ! -f ~/.ssh/frank_hub_deploy ]; then ssh-keygen -t ed25519 -C "frank-hub-vps read-only deploy key for stevenshelley58-afk/frank" -f ~/.ssh/frank_hub_deploy -N ""; fi && chmod 600 ~/.ssh/frank_hub_deploy && chmod 644 ~/.ssh/frank_hub_deploy.pub && touch ~/.ssh/known_hosts && (ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null || true) && sort -u ~/.ssh/known_hosts -o ~/.ssh/known_hosts && cat ~/.ssh/frank_hub_deploy.pub
```

Add the printed public key in GitHub:

`Settings -> Deploy keys -> Add deploy key -> Allow write access unchecked`

After the repository is cloned, `scripts/setup_deploy_key.sh` provides the same
flow for key rotation or rebuilding a VPS.

## First Clone And Deploy

After the read-only deploy key is added:

```bash
sudo mkdir -p /opt/frank-hub
sudo chown "$USER:$USER" /opt/frank-hub
cd /opt/frank-hub
GIT_SSH_COMMAND='ssh -i ~/.ssh/frank_hub_deploy -o IdentitiesOnly=yes' git clone git@github.com:stevenshelley58-afk/frank.git .
cp -n .env.example .env
./scripts/bootstrap_vps.sh
./scripts/deploy.sh
./scripts/healthcheck.sh
```

Edit `.env` before using this for anything beyond first health verification.
The file must stay on the VPS and must not be committed.

## HTTPS Token Fallback

Use a fine-grained GitHub token only if deploy keys are blocked. The token must:

- be read-only for this repository;
- never be committed;
- never be printed into logs;
- be stored outside the repo, such as in a root-only file or one-time shell
  variable.

## Cloudflare Tunnel Routes

This tunnel is remote-managed in Cloudflare Zero Trust. Do not rely on
`cloudflared tunnel route dns` commands for route setup.

Use the dashboard:

1. Open Cloudflare Zero Trust.
2. Go to `Networks -> Connectors -> Cloudflare Tunnels`.
3. Select `frank-hub-vps`.
4. Open `Routes/Public Hostnames`.
5. Select `Add route`.
6. Add `hub.frank.fail` with service `http://localhost:3000`.
7. Add `api.frank.fail` with service `http://localhost:8080`.

The dashboard calls the API through same-origin `/api/*` on `hub.frank.fail`.
`api.frank.fail` is kept as a direct API hostname for later/admin/debug use.

Keep `hub.frank.fail` as the canonical Frank Hub app URL. Configure
`frank.fail/* -> https://hub.frank.fail/$1` with Cloudflare Redirect Rules /
Single Redirects, not as a Cloudflare Tunnel public hostname. Use a permanent
redirect, preferring `308` when available and `301` otherwise, with path and
query string preservation enabled.

## Verification

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:3000/
./scripts/healthcheck.sh
```

Expected results:

- web loads on localhost port `3000`;
- API healthcheck loads on localhost port `8080`;
- Postgres and Redis checks pass;
- `/v1/*` fails closed without a Cloudflare Access JWT when Access is enabled;
- audit log contains API and worker startup events;
- model roles count is `17`;
- provider registry count is `15`.
