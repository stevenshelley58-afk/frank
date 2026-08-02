---
name: frank-debug
description: Structured reproduce-to-fix loop for hard bugs and performance regressions. Use when something is broken, throwing, failing, or slow. Phase 1 (feedback loop) is the skill.
---

# Frank Debug

A discipline for hard bugs. Skip phases only when explicitly justified.

Read `CONTEXT.md` (if it exists) and check ADRs in the area you're touching before starting.

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a tight pass/fail signal that goes red on _this_ bug, you will find the cause. If you don't, no amount of staring at code will save you.

Spend disproportionate effort here. Be aggressive. Be creative. Refuse to give up.

### Try in roughly this order

1. Failing test at whatever seam reaches the bug (unit, integration, e2e)
2. Curl / HTTP script against a running dev server
3. CLI invocation with fixture input, diff stdout against known-good
4. Headless browser script (Playwright / Puppeteer)
5. Replay a captured trace (HAR, payload, event log)
6. Throwaway harness (minimal subset, one function call)
7. Property / fuzz loop (1000 random inputs)
8. Bisection harness (`git bisect run`)
9. Differential loop (old vs new version, two configs)
10. HITL bash script — last resort; drive the human so the loop stays structured

### Tighten the loop

Treat the loop as a product:
- Faster? (cache setup, skip unrelated init, narrow scope)
- Sharper signal? (assert on the specific symptom, not "didn't crash")
- More deterministic? (pin time, seed RNG, isolate filesystem, freeze network)

A 30-second flaky loop is barely better than none. A 2-second deterministic one is a superpower.

### Non-deterministic bugs

Goal is a higher reproduction rate, not a clean repro. Loop 100×, parallelise, add stress, narrow timing windows, inject sleeps. 50% is debuggable; 1% is not — keep raising the rate.

### When you genuinely cannot build a loop

Stop and say so. List what you tried. Ask the user for: (a) access to the reproducing environment, (b) a captured artifact (HAR, log dump, core dump, recording with timestamps), or (c) permission to add temporary instrumentation. Do NOT proceed to hypothesise without a loop.

### Completion criterion

Phase 1 is done when you can name **one command** — already run at least once (paste the invocation and output) — that is:

- [ ] **Red-capable** — drives the actual bug code path and asserts the user's exact symptom
- [ ] **Deterministic** — same verdict every run (flaky bugs: pinned high repro rate)
- [ ] **Fast** — seconds, not minutes
- [ ] **Agent-runnable** — unattended; human only via HITL script

If you catch yourself reading code to build a theory before this command exists, **stop.**

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red.

Confirm:
- [ ] The loop produces the failure the **user** described — not a nearby one
- [ ] Reproducible across multiple runs (or at a high enough rate)
- [ ] Exact symptom captured (error message, wrong output, slow timing)

### Minimise

Shrink to the smallest scenario that still goes red. Cut inputs, callers, config, data, steps — one at a time, re-running after each cut. Done when every remaining element is load-bearing.

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any. Each must be falsifiable:

> "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

Cannot state the prediction? It's a vibe — discard or sharpen.

Show the ranked list to the user before testing. They often re-rank instantly. Don't block — proceed with your ranking if AFK.

## Phase 4 — Instrument

Each probe maps to a specific prediction. **Change one variable at a time.**

Preference order:
1. Debugger / REPL inspection (one breakpoint beats ten logs)
2. Targeted logs at boundaries that distinguish hypotheses
3. Never "log everything and grep"

Tag every debug log: `[DEBUG-xxxx]`. Cleanup becomes one grep. Untagged logs survive; tagged logs die.

**Perf branch:** logs are usually wrong. Establish a baseline measurement (timing harness, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5 — Fix + regression test

Write the regression test **before the fix** — but only if a correct seam exists (one that exercises the real bug pattern at the call site).

If no correct seam exists, that itself is the finding. Note it. Flag for architecture review.

If a seam exists:
1. Turn the minimised repro into a failing test
2. Watch it fail
3. Apply the fix
4. Watch it pass
5. Re-run the Phase 1 loop against the original (un-minimised) scenario

## Phase 6 — Cleanup + post-mortem

Required before declaring done:
- [ ] Original repro no longer reproduces
- [ ] Regression test passes (or absence of seam documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted
- [ ] Correct hypothesis stated in the commit / PR message

Then ask: **what would have prevented this bug?** If the answer involves architectural change (no good seam, tangled callers, hidden coupling), recommend it AFTER the fix is in — you have more information now.
