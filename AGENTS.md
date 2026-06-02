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
- Do not wire Infisical, LiteLLM runtime, SearXNG, Playwright, code-server,
  or image-generation runtimes in this foundation.
- WhatsApp runtime wiring is allowed only through the Hermes-native lab slice
  documented in `docs/adr/0002-hermes-native-whatsapp-lab.md`.
- Do not run production-destructive actions.
- Do not run unrestricted host commands.
- Fail closed when unsure.
- Keep normal operation dashboard-first, not terminal-first.
- AionUi WebUI is allowed only as the private Frank runtime slice documented
  in `docs/aionui-runtime.md`; never expose it without Frank/Cloudflare Access.

## Architecture Defaults

- Frontend: static Vite React SPA served by Nginx.
- API: Fastify TypeScript service on the VPS.
- Workers: Node TypeScript background services.
- Runtime: Docker Compose with Postgres + pgvector and Redis.
- Access: Cloudflare Tunnel and Cloudflare Access.
- Model routing: model-role based and provider-agnostic.
- Shared project workspaces live under `/opt/frank-projects` and are mounted
  into approved runtimes only.

## Agent skills

Frank uses external engineering skills as build-process guardrails, not as
product runtime code. These instructions are subordinate to the hard rules in
this file.

- Issue tracker: GitHub Issues. See `docs/agents/issue-tracker.md`.
- Domain layout: single-context repo for now. Domain language lives in
  `CONTEXT.md`.
- Architecture decisions: ADRs live in `docs/adr/`.
- Large ambiguous changes must use `grill-with-docs` before implementation.
- Feature shaping should use `to-prd` and `to-issues` to create vertical
  slices.
- Code work should use vertical tracer bullets and TDD instead of horizontal
  bulk implementation.
- Failures should be diagnosed with `diagnose` before patching.
- Run `improve-codebase-architecture` after large merges or repeated design
  friction.

## Current Public URLs

- `hub.frank.fail` -> Frank Hub dashboard
- `api.frank.fail` -> Frank API
- `aionui.frank.fail` -> private AionUi WebUI runtime, served at the origin root
  through Frank/Nginx behind Cloudflare Access
- `hub.frank.fail/aionui/` -> Frank AionUi bootstrap, then AionUi runtime

## Reserved URLs

- `code.frank.fail` -> Frank Code
- `jobs.frank.fail` -> Frank Jobs
- `vault.frank.fail` -> Frank Vault
- `router.frank.fail` -> Frank Router
- `status.frank.fail` -> Frank Status
