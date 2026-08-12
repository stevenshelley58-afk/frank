# Decisions

Append-only. Every non-obvious choice and its reason.

## 2026-08-12 — Frank is a platform, Blockwise is tenant #1
Modules are generic. Project specifics live in packs/<project>/.
Check before every commit: `grep -ri blockwise modules/<name>/` must return nothing.
packs/acme is a deliberately different vertical; every module's tests must pass against it too.

## 2026-08-12 — One release contract, not two
The AdStudio plan defined TemplatePack; the migration plan defined frank.project-release.
Collapsed into one envelope with typed payloads. TemplatePack is a payload type.

## 2026-08-12 — Process ceremony removed, technical spec preserved
Signed freeze hashes, three-party signatures, universe manifests, adversarial verifier
phases and write fences are gone. This box serves ~9 req/day on a 43 MB database.
Every schema, limit, rejection code and acceptance test from the original plans is kept.

## 2026-08-12 — Delete before building
On a dev box, deferring deletion until after replacement is what accumulated 291 GB.

## 2026-08-12 — Graphify indexes the LIVE repos, not staged snapshots
Previously codegraph mounted a staged copy under codegraph-inputs/. Now it mounts
/frank/repo and /projects/* read-only so the graph reflects current working state.
Registry: /frank/deployed/codegraph-inputs/20260812T-multiproject/projects.json
The accepted fead0c4b input set is preserved untouched.

## 2026-08-12 — frank-codegraph-internal network recreated
It was removed by a docker network prune during teardown. Recreated with --internal,
which is what enforces blocked egress for the Graphify supervisor.

## 2026-08-12 — repo file permissions normalised
~2200 files in frank/repo and blockwise/repo-clean were 0600/0700 and unreadable by
UID 10001, which broke the bounded filesystem scan. Made source world-readable.
No .env or secret files were touched.
