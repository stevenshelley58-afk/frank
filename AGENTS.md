# AGENTS.md

## Mission

Build and maintain Frank Hub as a private, dashboard-first infrastructure
control plane. The system name is Frank Hub.

## Hard Rules

- Do not commit secrets, API keys, tokens, private keys, or production `.env`
  files.
- Do not hardcode model names into agent logic. Agents request model roles.
- Do not use Vercel backend or managed Supabase.
- Do not deploy from this repository unless explicitly asked.
- Do not wire WhatsApp, Infisical, LiteLLM runtime, SearXNG, Playwright,
  code-server, or image-generation runtimes in this foundation.
- Do not run production-destructive actions.
- Do not run unrestricted host commands.
- Fail closed when unsure.
- Keep normal operation dashboard-first, not terminal-first.

## Architecture Defaults

- Frontend: static Vite React SPA served by Nginx.
- API: Fastify TypeScript service on the VPS.
- Workers: Node TypeScript background services.
- Runtime: Docker Compose with Postgres + pgvector and Redis.
- Access: Cloudflare Tunnel and Cloudflare Access.
- Model routing: model-role based and provider-agnostic.

## Current Public URLs

- `hub.frank.fail` -> Frank Hub dashboard
- `api.frank.fail` -> Frank API

## Reserved URLs

- `code.frank.fail` -> Frank Code
- `jobs.frank.fail` -> Frank Jobs
- `vault.frank.fail` -> Frank Vault
- `router.frank.fail` -> Frank Router
- `status.frank.fail` -> Frank Status
