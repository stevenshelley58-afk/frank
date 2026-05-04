# Frank Hub

Frank Hub is the private dashboard and control-plane foundation for `frank.fail`.
This repository contains the first deployable base for the dashboard, API,
worker, Postgres + pgvector schema, Redis integration, model-routing scaffolds,
and VPS deployment scripts.

## System

- System name: Frank Hub
- Dashboard URL: `https://hub.frank.fail`
- API URL: `https://api.frank.fail`
- Cloudflare Tunnel: `frank-hub-vps`
- VPS: Hostinger KVM 4, Ubuntu 24.04, Docker
- Public VPS IP: `76.13.209.160`

## Stack

- TypeScript monorepo with pnpm workspaces and Turborepo
- `apps/web`: Vite React static dashboard served by Nginx
- `apps/api`: Fastify API
- `apps/workers`: Node background worker
- `packages/shared`: shared types and constants
- `packages/model-sdk`: model-provider and routing interfaces
- `packages/tool-sdk`: tool permission interfaces
- Postgres 16 with pgvector
- Redis 7

## Lab Control Surfaces

- Command Center: live task queue, active Hermes posture, backups, deploy
  status, access health, WhatsApp status, limits, and Hermes kill switch.
- Projects: VPS workspace registry for `/opt/frank-projects/<slug>`.
- Self-Upgrades: dashboard-created Frank self-upgrade runs backed by Hermes
  tasks in `/opt/frank-hub`.
- Messaging: Hermes-native WhatsApp status and Frank-to-WhatsApp notification
  tests.
- Settings: redacted access state and optional lab-only writes to the VPS
  access env file.

## Local Development

```bash
npm exec --yes pnpm@10.20.0 -- install
npm exec --yes pnpm@10.20.0 -- typecheck
npm exec --yes pnpm@10.20.0 -- test
npm exec --yes pnpm@10.20.0 -- build
```

Docker Compose is the source of truth for the VPS runtime:

```bash
cp -n .env.example .env
docker compose up -d --build
./scripts/healthcheck.sh
```

## Routing

The browser dashboard uses same-origin API calls:

- `hub.frank.fail` routes to the web container on `http://localhost:3000`
- `hub.frank.fail/api/*` is proxied by Nginx to the API container
- `api.frank.fail` remains available as a direct API hostname on
  `http://localhost:8080`
- `frank.fail/*` redirects to canonical app URL `https://hub.frank.fail/$1`

Cloudflare Tunnel routes are configured in the Cloudflare Zero Trust dashboard,
not with local `cloudflared tunnel route dns` commands.

## Security Defaults

- No secrets are committed.
- `/healthz` is public.
- `/v1/*` routes require Cloudflare Access when
  `CLOUDFLARE_ACCESS_ENABLED=true`.
- Multiple Cloudflare Access audiences are supported with
  `CLOUDFLARE_ACCESS_AUDS`; `CLOUDFLARE_ACCESS_AUD` remains a single-AUD
  fallback.
- Agent and tool scaffolds fail closed for destructive or unrestricted host
  actions.
- Provider adapters are typed placeholders only; no real model-provider calls
  are wired in this foundation.
- Operator mode can be set to `lab` on the private VPS so Frank and Hermes can
  work directly on `/opt/frank-hub` while protected paths stay blocked.
- Frank's email, mobile, WhatsApp, and private API access are configured through
  `runtime/access/frank-access.env` on the VPS; the real file is ignored by Git.
- Hermes-native WhatsApp is allowed only for the accepted lab ADR. Hermes stays
  private on the Compose network, and WhatsApp/session credentials stay in VPS
  runtime paths.
