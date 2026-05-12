# Frank VPS AI Workstation

Frank Hub can run AI tools inside the VPS so the laptop only opens
`hub.frank.fail`.

## Components

- Frank Host Agent: a systemd service outside Docker for `tmux`, `git`,
  Docker, Codex, Claude Code, and browser controls.
- Codex Workstation: dashboard page for Codex, ChatGPT Browser, Claude
  Browser, Claude Code, handoffs, terminal attach, and session stop.
- VPS Browser: internal Compose service at `/vps-browser/` with persistent
  profile data in `runtime/browser`. ChatGPT and Claude buttons start or reuse
  the same private browser service; when the container is first created, it
  opens the selected startup URL.
- Shared instructions: `AGENTS.md`, `CONTEXT.md`, ADRs, and `CLAUDE.md`
  synced into `runtime/ai-instructions`.

## VPS Setup

1. Deploy Frank from GitHub.
2. On the VPS, run `scripts/install_ai_tools.sh`.
3. Run `scripts/install_host_agent.sh`.
4. Redeploy or restart the API. The installer writes
   `FRANK_HOST_AGENT_ENABLED`, `FRANK_HOST_AGENT_BASE_URL`, and the redacted
   token source into `runtime/access/frank-access.env`.
5. Run `scripts/ai_doctor.sh`.
6. Start the embedded browser with `scripts/browser_up.sh` or from the Codex Workstation.
7. Log into ChatGPT, Codex, Claude, and Claude Code once from the VPS user.
   ChatGPT and Claude web sessions persist in `runtime/browser` for as long as
   the provider accepts the saved browser profile.

## Daily Workflow

Open `hub.frank.fail`. Frank opens to the Codex Workstation, then:

- start Codex or Claude Code in `/opt/frank-hub` or a project workspace;
- attach to the terminal panel to send input and read tmux output;
- use ChatGPT or Claude in the embedded VPS browser for subscription-backed
  web chat;
- create handoff prompts when moving context between Frank and tool sessions.

Secrets stay in VPS runtime env files and are never shown back in the UI.
