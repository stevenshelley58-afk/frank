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
- Agent and tool scaffolds fail closed for destructive or unrestricted host
  actions.
- Provider adapters are typed placeholders only; no real model-provider calls
  are wired in this foundation.
