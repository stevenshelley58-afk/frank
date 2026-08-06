# PLG-04 — Plugin trigger eval

Date: 2026-08-06 · Branch: `agent/plg/trigger-eval` · Plugin v0.1.1

## Method

Live-harness eval was blocked (Claude Code OAuth session expired on this
machine — `claude -p` returns "Failed to authenticate"). Per the task's
stop-condition discipline, a desk eval was run instead: each of the 8
representative prompts from the task register was matched against the 7
skill descriptions exactly as Claude's trigger matcher sees them
(name + description, first 57 chars weighted).

## Results

| Prompt | Expected trigger | Result |
|---|---|---|
| "fix this failing test" | frank-tdd | ✅ "fixing bugs test-first" in desc |
| "this endpoint is slow / throwing" | frank-debug | ✅ "broken, throwing, failing, or slow" |
| "deploy a preview for X" | preview-deploy → RULE 0 | ✅ "ALL buildable tasks" |
| "verify the preview before handoff" | verify-preview | ✅ (desc fixed — see below) |
| "review my changes since main" | code-review | ✅ "review since X" |
| "turn this spec into tickets" | to-tickets | ✅ "Break a plan, spec…" |
| "what are Frank's rules?" | frank-rules | ✅ "RULE 0… Load before any Frank build" |
| "set up the new deploy pipeline" | preview-deploy | ✅ no false-positive on frank-debug |

## Finding & fix

`verify-preview` description carried internal plan jargon "(Track C1)" —
plan-internal terminology that adds no trigger signal and could confuse
fresh sessions. Removed from the **canonical** skill
(`skills/engineering/verify-preview/SKILL.md`) and regenerated the plugin
via `plugin/build.sh` → v0.1.1. No other description changes were justified
by the eval.

## Follow-up (blocked, human-gated)

Re-run live once Claude Code auth is restored (`claude` → `/login` or fresh
OAuth): 8 prompts above in a fresh session WITHOUT the Frank folder
connected; measure trigger hits; record here.

## Rollback

Revert the description string in the canonical SKILL.md + `plugin/build.sh`.
