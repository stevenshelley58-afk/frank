# Task specifications

Drop this directory into `frank/.build/tasks/`. Each file is the full brief for one task — a cheap agent should need nothing else except `EXECUTION-PLAN.md` §1–2 for the commit contract and file-ownership rules.

## Index

| ID | File | Wave | Model | Parallel with |
|---|---|---|---|---|
| `F0-1…4` | *(in EXECUTION-PLAN §3)* | 0 | cheap | serial |
| `F1-1` | `F1-1-project-registry.md` | 1 | **strong** | serial |
| `F1-2` | `F1-2-release-contract.md` | 1 | **strong** | serial |
| `F1-3` | `F1-3-module-manifest.md` | 1 | **strong** | serial |
| `F1-4` | `F1-4-delivery.md` | 1 | **strong** | serial |
| `F2-A1` | `F2-A1-renderer.md` | 2 | cheap | group A |
| `F2-A2` | `F2-A2-template-factory.md` | 2 | cheap + strong rubric | group A, after A1 |
| `F2-B1…B4` | `F2-B-intelligence-prospect-mail-outreach.md` | 2 | cheap | group B |
| `F2-C1` | `F2-C1-content-factory.md` | 2 | cheap | group C |
| `F3-0` | `F3-0-chat.md` | 3 | cheap ×3 lanes | 3 lanes then serial |
| `F3-1` | `F3-1-project-home.md` | 3 | cheap, strong review | after F3-0 |
| `F3-2/3` | `F3-2-3-widgets-nightwatch.md` | 3 | cheap, one per group | after F3-1 |
| `F3-4` | `F3-4-graphify-lakehouse.md` | 3 | cheap / medium | independent |
| `B4-1` | `B4-1-deletion.md` | 4 | cheap | **starts immediately** |
| `B4-2/3/5` | `B4-2-3-5-consumer-catalogue-save.md` | 4 | cheap, strong for Save | after B4-1 |
| `B4-4` | `B4-4-editor.md` | 4 | cheap ×3 sub-lanes | after B4-3 |
| `B4-6` | `B4-6-publish-meta.md` | 4 | **strong** | after B4-5 |

## Spend strong models here only

`F1-1` `F1-2` `F1-3` `F1-4` — the architecture. Four tasks that decide whether the next fifty are mechanical or agony.

`B4-6` — money and provider state.

`F2-A2` review rubric — the thing that decides whether a template ships.

Everything else is cheap.

## Three rules every task repeats, because they are the ones that get skipped

1. **`grep -ri blockwise modules/<name>/` must return nothing.** Project specifics live in `packs/`. Run it before every commit.
2. **Commit at every green checkpoint** using the §1 message format, with an accurate `Next:`. Never leave uncommitted work.
3. **Never edit an applied migration.** Request a new number from the coordinator; Frank is at `0013`.

## What is deliberately NOT in these specs

Signed freeze hashes, three-party signatures, universe manifests, adversarial verifier phases, write fences, coupled rollback rehearsals.

Those exist in the original plans to protect a regulated production system. This box serves 9 requests a day with a 43 MB database. That machinery would cost weeks and protect nothing — and it is the reason deletion kept getting deferred until 291 GB of dead weight accumulated.

**The technical specification is fully preserved.** Every schema, field list, limit, rejection code, escalation rule and acceptance test from the original plans is in these files. Only the ceremony is gone.
