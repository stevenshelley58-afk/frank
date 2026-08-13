# CH-00 — Throwaway Telegram spike plan (needs bot token)

Status: ⛔ gated on Telegram bot token (asked Steven 2026-08-06).
Location: OUTSIDE the monorepo (`/frank/deployed/spikes/channels-telegram/`).
Rule: after verification, DELETE the spike. Nothing from it (MemoryStore,
hardcoded state) may be promoted into the repo.

## Token handling (secret rules, plan §3.5)

1. Steven creates bot via @BotFather (`/newbot`), pastes token to agent.
2. Agent writes it to `/frank/deployed/infra/env` as `TELEGRAM_BOT_TOKEN=***
   (`chmod 600`, compose env-file path — the existing secret mechanism).
3. NEVER in: repo, preview content, synced folders, logs, screenshots.

## Spike scope (answers the three Wave-0 questions)

- Direct Telegram adapter from `@copilotkit/channels` pinned 0.7.3,
  **polling mode** (no public webhook) — Q3.
- `channel["ɵruntime"].start()` on the VPS outside the scratch probe — Q1.
- Hardcoded card: room title, action text, **Approve / Deny inline buttons**;
  tap hits a stub HTTP endpoint on the VPS and logs the interaction — Q2.
- `COPILOTKIT_TELEMETRY_DISABLED=true` from the first run.
- Identity stub: only Steven's Telegram user id accepted; unknown → reject.

## Verify

1. Deploy spike process on VPS (systemd or tmux; polling → no port needed).
2. Steven taps a button on his phone → VPS log shows the interaction payload.
3. Kill + restart the process → polling resumes, no webhook state lost.

## Exit

- Log evidence attached to the CH-00 issue.
- `rm -rf /frank/deployed/spikes/channels-telegram/`, stop the process.
- Findings recorded in EXECUTION_STATUS.md → CH-01/CH-02 proceed on facts.
