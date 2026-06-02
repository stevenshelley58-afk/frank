# Frank Hub Context

## Mission

Frank Hub is a private, dashboard-first infrastructure control plane for
`frank.fail`. Normal operation should be controlled from the dashboard, with
terminal-first workflows reserved for setup, diagnostics, and explicit
operator actions.

## Architecture

- Frontend: static Vite React SPA served by Nginx.
- API: Fastify TypeScript service running on the VPS.
- Workers: Node TypeScript background services.
- Runtime: Docker Compose with Postgres, pgvector, and Redis.
- Access: Cloudflare Tunnel and Cloudflare Access.
- Model routing: provider-agnostic routing through model roles.

## Domain Language

- **Frank Hub**: the private dashboard and control-plane foundation for
  `frank.fail`.
- **Dashboard-first**: the expected operator path is the web dashboard rather
  than direct terminal commands.
- **Control plane**: the coordination surface for infrastructure status,
  tasks, model routing, workers, audit trails, and operator actions.
- **Model role**: a provider-neutral capability request used by agents instead
  of hardcoded model names.
- **Provider adapter**: the boundary between Frank model-routing abstractions
  and a concrete model provider.
- **Tool permission**: a typed policy decision controlling which tool actions
  are allowed.
- **Worker**: a background Node service that processes tasks outside the API
  request path.
- **Runner**: an execution adapter responsible for carrying out a task through
  a bounded runtime.
- **Hermes**: the agent/runtime integration path for delegated build and task
  execution.
- **AionUi**: the embedded private WebUI runtime exposed through Frank and
  Cloudflare Access, with shared project workspaces mounted from
  `/opt/frank-projects`.
- **Frank Host Agent**: the VPS-local systemd service that gives Frank Hub
  controlled access to host tools such as `tmux`, `git`, Docker, Codex,
  Claude Code, and browser controls.
- **Shared project workspace**: a VPS project folder under
  `/opt/frank-projects/<slug>` materialized from the uploaded C:\Dev inventory
  or cloned from a project remote.
- **AI Workstation**: the Frank dashboard surface for embedded VPS browser
  chat, Codex sessions, Claude Code sessions, handoffs, and terminal attach.
- **VPS Browser**: the internal browser/noVNC runtime used for subscription
  web chat through ChatGPT or Claude without moving the session to the laptop.
- **Audit log**: the append-only record of operator-relevant actions and
  system events.
- **Build gate**: a workflow rule that chooses the right planning, issue, test,
  and review path before implementation starts.
- **Vertical slice**: a small end-to-end increment that can be specified,
  tested, implemented, and reviewed independently.
- **ADR**: an architecture decision record for hard-to-reverse technical or
  product decisions.

## Non-goals

- Do not use managed Supabase.
- Do not use a Vercel backend.
- Do not run production-destructive actions.
- Do not hardcode model names into agent logic.
- Do not wire Infisical, LiteLLM runtime, SearXNG, Playwright, code-server,
  or image-generation runtimes in this foundation.
- WhatsApp runtime wiring is allowed only through the Hermes-native lab slice
  documented in `docs/adr/0002-hermes-native-whatsapp-lab.md`.
- Do not commit secrets, API keys, tokens, private keys, or production `.env`
  files.
