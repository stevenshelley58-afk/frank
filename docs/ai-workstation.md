# Frank VPS AI Workstation

Frank Hub can run AI tools inside the VPS so the laptop only opens
`hub.frank.fail`.

## Components

- Frank Host Agent: a systemd service outside Docker for `tmux`, `git`,
  Docker, Codex, Claude Code, and browser controls.
- AI Console: dashboard page for ChatGPT Browser, Claude Browser, Codex,
  Claude Code, handoffs, terminal attach, and session stop.
- VPS Browser: internal Compose service at `/vps-browser/` with persistent
  profile data in `runtime/browser`.
- Shared instructions: `AGENTS.md`, `CONTEXT.md`, ADRs, and `CLAUDE.md`
  synced into `runtime/ai-instructions`.

## VPS Setup

1. Deploy Frank from GitHub.
2. On the VPS, run `scripts/install_ai_tools.sh`.
3. Run `scripts/install_host_agent.sh`.
4. Set `FRANK_HOST_AGENT_ENABLED=true` and make sure
   `FRANK_HOST_AGENT_TOKEN` is available to the API from `.env` or
   `runtime/access/frank-access.env`.
5. Redeploy or restart the API.
6. Run `scripts/ai_doctor.sh`.
7. Start the embedded browser with `scripts/browser_up.sh`.
8. Log into ChatGPT, Codex, Claude, and Claude Code once from the VPS user.

## Daily Workflow

Open `hub.frank.fail`, go to `AI`, then:

- use ChatGPT or Claude in the embedded VPS browser for subscription-backed
  web chat;
- start Codex or Claude Code in `/opt/frank-hub` or a project workspace;
- attach to the terminal panel to send input and read tmux output;
- create handoff prompts when moving context between Frank and tool sessions.

Secrets stay in VPS runtime env files and are never shown back in the UI.
