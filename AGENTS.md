# Rules for agents working in this repository

## What Frank is

Frank is a window, not an agent. Hermes does the thinking, tool use, memory,
model selection, and project work. Frank displays Hermes conversations and
factory activity, and signs releases.

If code in this repository loads a skill, chooses a model, stores agent memory,
or creates another agent runtime, it is in the wrong place.

The current build plan is `.build/FRANK-REBUILD.md`.

## Authoritative VPS layout

- Project source: `/projects/frank`
- Other project source: `/projects/<name>`
- Shared knowledge: `/srv/vault`
- Shared skills: `/srv/skills`
- Hermes profiles and state: `/home/hermes/.hermes` (do not edit directly)

The old `/frank/repo` and `/frank/deployed` trees are migration sources, not
places for new work.

## Before building

1. Check whether Hermes already provides the capability.
2. Check the shared skills library.
3. Prefer a maintained library with a compatible licence.
4. Add custom code only when the existing options do not fit, and record why.

## Keep one of each thing

- Do not create a second agent, memory store, skills library, project checkout,
  deployment config, or plan for the same responsibility.
- Do not hardcode provider model names in product code. Use configured roles.
- Do not commit secrets, databases, dependency folders, build output, caches,
  previews, backups, evidence bundles, or local agent state.
- Preserve production data. If a database table with rows must be retired,
  rename it to `legacy_<name>` and record the row count.
- Experiments expire after 30 days unless the owner explicitly keeps them.

## Delivery

Use the repository's checked-in deployment and preview scripts. Production
changes must come from a committed Git revision and pass the repository checks.
Do not patch the live VPS by copying source files into place.

These rules are defaults that the owner may override explicitly.
