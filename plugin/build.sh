#!/usr/bin/env bash
# plugin/build.sh — regenerate the Frank Claude plugin from the canonical
# in-repo skills/ tree (Track D2). Idempotent; run after skill changes.
#
# Selection (Track D1, deliberately small — see FRANK_PREBUILT_INTEGRATION_PLAN.md §4):
#   frank-tdd, frank-debug, preview-deploy, verify-preview, code-review,
#   to-tickets, frank-rules (distilled from AGENTS.md)
#
# In-repo skills stay canonical. Never edit plugin/skills/ by hand —
# rerun this script instead, and bump the version in
# .claude-plugin/plugin.json per regeneration.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugin"
SKILLS_SRC="$REPO_ROOT/skills/engineering"
SKILLS_DEST="$PLUGIN_DIR/skills"

CORE_SKILLS=(frank-tdd frank-debug preview-deploy verify-preview code-review to-tickets)

echo "→ regenerating $SKILLS_DEST from $SKILLS_SRC"
rm -rf "$SKILLS_DEST"
mkdir -p "$SKILLS_DEST"

for skill in "${CORE_SKILLS[@]}"; do
  src="$SKILLS_SRC/$skill"
  if [ ! -d "$src" ]; then
    echo "ERROR: core skill missing from in-repo tree: $src" >&2
    exit 1
  fi
  cp -r "$src" "$SKILLS_DEST/$skill"
  echo "  copied $skill"
done

# Distilled frank-rules skill — RULE 0 + precedence, written fresh each
# build from this script so it can never drift from the generator.
mkdir -p "$SKILLS_DEST/frank-rules"
cat > "$SKILLS_DEST/frank-rules/SKILL.md" <<'SKILL'
---
name: frank-rules
description: Frank's operating rules — RULE 0 preview-first workflow, branch and deploy discipline, precedence order. Load before any Frank build, deploy, or review decision.
---

# Frank Rules (distilled)

## RULE 0 — preview-first (non-negotiable)

No local testing. No localhost. No "it works on my machine."

1. **Create a hosted preview first.** Before feature code, deploy a skeleton
   to `https://preview.frank.fail/<topic>-v1/`.
2. **Iterate on the preview URL.** `--update` for same-version fixes; bump the
   version for significant changes.
3. **The deliverable is a link.** Not a branch, not a PR, not commands.
4. **Promote to production only after the user approves the live preview.**

Deploy:

```bash
ssh vps '/frank/deployed/infra/preview-deploy.sh <topic> /path/to/output/'          # new version
ssh vps '/frank/deployed/infra/preview-deploy.sh <topic> /path/to/output/ --update'  # overwrite latest
ssh vps '/frank/deployed/infra/preview-deploy.sh <slug> /path/ --exact'              # exact slug
```

Rules: topics auto-sanitize to `[a-z0-9-]`; previews are PUBLIC (no secrets);
previews are STATIC (backends deploy as real services); `_`-prefix reserved.

After EVERY deploy: Chrome-verify the click-path, capture evidence
(screenshots + console excerpt), deliver the link WITH the evidence
(verify-preview skill). Broken → fix and redeploy before handover; max 3
cycles, then escalate.

## Branch + deploy discipline

- **main is the prod trunk** (locked 2026-08-03). Build on a branch cut from
  main; merge back; deploy from the VPS working tree on main.
- GitHub does gates + tracking + secret scanning. Review happens on preview
  URLs, never PR review theater.
- `pnpm run verify` is the gate — CI enforces it on every push.

## Precedence (when docs disagree)

1. AGENTS.md (repo root)
2. FRANK_ROOMS_ARCHITECTURE.md (product decisions D1–D12)
3. FRANK_BUILD_PLAN.md (engineering build order)
4. docs/product specification + requirements registry (FRANK-§0)
5. Everything else
SKILL
echo "  generated frank-rules"

echo "→ plugin/skills now contains:"
ls "$SKILLS_DEST"
echo "✓ regenerated — bump .claude-plugin/plugin.json version if this is a release"
