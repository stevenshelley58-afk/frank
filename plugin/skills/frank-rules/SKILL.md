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
ssh vps '/srv/frank/infra/preview-deploy.sh <topic> /path/to/output/'          # new version
ssh vps '/srv/frank/infra/preview-deploy.sh <topic> /path/to/output/ --update'  # overwrite latest
ssh vps '/srv/frank/infra/preview-deploy.sh <slug> /path/ --exact'              # exact slug
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
