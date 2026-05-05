#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${FRANK_AI_INSTRUCTIONS_DIR:-${repo_dir}/runtime/ai-instructions}"

mkdir -p "${target_dir}/adr"

cp "${repo_dir}/AGENTS.md" "${target_dir}/AGENTS.md"
cp "${repo_dir}/CONTEXT.md" "${target_dir}/CONTEXT.md"
cp "${repo_dir}/CLAUDE.md" "${target_dir}/CLAUDE.md"
cp "${repo_dir}"/docs/adr/*.md "${target_dir}/adr/"

cat > "${target_dir}/CODEX_PROMPT.md" <<'PROMPT'
# Frank Hub Codex Prompt

Use AGENTS.md, CONTEXT.md, and docs/adr as authoritative project instructions.
Work inside the selected VPS workspace. Do not commit secrets or production env files.
For Frank self-work, prefer /opt/frank-hub. For projects, prefer /opt/frank-projects/<slug>.
PROMPT

cat > "${target_dir}/CLAUDE_CODE_PROMPT.md" <<'PROMPT'
# Frank Hub Claude Code Prompt

Read AGENTS.md first, then CONTEXT.md and docs/adr. These files define Frank Hub's hard rules,
architecture defaults, and current domain language. Keep normal operation dashboard-first.
PROMPT

cat > "${target_dir}/HERMES_PROMPT.md" <<'PROMPT'
# Frank Hub Hermes Prompt

Use AGENTS.md, CONTEXT.md, and docs/adr as the shared build instructions.
Respect the protected path denylist and keep artifacts in Frank runtime/artifacts.
PROMPT

cat > "${target_dir}/BROWSER_PROMPT.md" <<'PROMPT'
# Frank Hub Browser Prompt

You are operating inside Frank Hub's VPS browser. Use AGENTS.md and CONTEXT.md as the project
instructions when discussing Frank Hub work in ChatGPT or Claude web.
PROMPT

echo "AI instruction bundle refreshed at ${target_dir}."
