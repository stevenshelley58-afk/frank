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

For Frank's private email, mobile, WhatsApp, and provider credentials, copy
`operator-assets/frank-access.example.env` to
`runtime/access/frank-access.env` on the VPS and edit that runtime-only file.
The real access file is ignored by Git.

Home chat needs `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` in that access file.
The API and worker containers load it through `FRANK_ACCESS_ENV_FILE`.

## Standard GitHub Deploy Flow

Frank's normal deploy path is:

1. commit locally;
2. push the current branch to GitHub;
3. paste one command into the VPS to pull that branch, deploy, and healthcheck.

Use this from the VPS for every branch deploy:

```bash
cd /opt/frank-hub && ./scripts/deploy_from_github.sh codex/c-dev-project-import
```

Replace `codex/c-dev-project-import` with the branch that was just pushed.
The helper refuses to deploy if the VPS worktree has uncommitted changes,
fetches the branch from GitHub, fast-forwards only, runs `scripts/deploy.sh`,
and then runs `scripts/healthcheck.sh`.

For normal `main` deploys:

```bash
cd /opt/frank-hub && ./scripts/deploy_from_github.sh main
```

`scripts/deploy.sh` writes `runtime/deploy.json` before building containers.
That file is safe deploy metadata for the Ops Console: current branch, current
commit, deploy timestamp, schema version, and package version when available.
It must not contain raw env values, tokens, secrets, or arbitrary command
output.

When `HERMES_ENABLED=true`, `scripts/deploy.sh` includes
`docker-compose.hermes.yml`, refuses to continue without
`HERMES_API_SERVER_KEY`, and starts Hermes with the rest of Frank.

When `AIONUI_ENABLED=true`, `scripts/deploy.sh` includes
`docker-compose.aionui.yml`, builds the pinned AionUi WebUI image, and starts
the embedded AionUi runtime with Frank.

## Lab Self-Upgrade And WhatsApp

For the high-autonomy VPS lab, enable the operator features deliberately:

```env
FRANK_OPERATOR_MODE=lab
FRANK_SECRET_WRITE_ENABLED=true
HERMES_ENABLED=true
WHATSAPP_ENABLED=true
WEBHOOK_ENABLED=true
```

Put real phone numbers, WhatsApp allowlists, webhook secrets, and API keys in
`/opt/frank-hub/runtime/access/frank-access.env`, not in `.env.example`.

Frank self-upgrade runs are created from the dashboard and stored in
`self_upgrade_runs`. Each run creates a queued Hermes task in `/opt/frank-hub`,
uses local VPS backups under `FRANK_BACKUP_ROOT`, and records validation/deploy
state for review. Hermes and its webhook port remain internal to Docker Compose.

## First Deploy Of The GitHub Helper

If the VPS branch does not have `scripts/deploy_from_github.sh` yet, use this
bootstrap form once. After that, use the standard command above.

```bash
cd /opt/frank-hub && branch=codex/c-dev-project-import && git fetch origin "$branch" && (git checkout "$branch" 2>/dev/null || git checkout --track "origin/$branch") && git pull --ff-only origin "$branch" && ./scripts/deploy_from_github.sh "$branch"
```

Replace `codex/c-dev-project-import` with the branch that was just pushed.

## Merge Stage 2 To Main

Before merging, confirm the deployed branch is healthy on the VPS:

```bash
cd /opt/frank-hub
git branch --show-current
git rev-parse --short HEAD
./scripts/healthcheck.sh
```

The branch should be `stage2-api-control-plane`, and the healthcheck should
pass. Then merge locally without rewriting history or force pushing:

```bash
git status --short
git fetch origin
git checkout stage2-api-control-plane
git pull --ff-only origin stage2-api-control-plane
git checkout main
git pull --ff-only origin main
git merge --ff-only stage2-api-control-plane
git push origin main
```

If `git merge --ff-only stage2-api-control-plane` reports that a fast-forward
is not possible, stop and inspect the divergence. If the histories are expected
to diverge and the merge is clean, use a normal merge commit instead:

```bash
git merge --no-ff stage2-api-control-plane
git push origin main
```

Do not force push and do not rewrite either branch history.

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
8. Add `aionui.frank.fail` with service `http://localhost:3000` and the same
   Cloudflare Access policy as `hub.frank.fail`.

The dashboard calls the API through same-origin `/api/*` on `hub.frank.fail`.
`api.frank.fail` is kept as a direct API hostname for later/admin/debug use.
`aionui.frank.fail` is served by Frank's web/Nginx container and redirects to
the embedded Frank AionUi page. The embedded page proxies to the private
`aionui` Compose service through `hub.frank.fail/aionui/`.

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
