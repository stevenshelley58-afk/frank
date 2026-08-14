# Reuse report

The Frank package is a declarative adapter and validator only. It does not
rebuild the generator, renderer, provider client, editor, or publisher.

## Canonical Blockwise evidence inspected

Canonical `/projects/blockwise` main at
`ae89ca5847e5389db120b686c202cf90cb42c8b5` contains the requested paths:

- `packages/ad-template-pack-contract/src/types.ts`, `schema.ts`, `hash.ts`,
  and `contract.test.ts`.
- `packages/ad-deterministic-renderer/src/renderer.ts` and its tests.
- `scripts/adstudio/v2/subject-invariance.mjs`.
- `hermes/skills/adstudio-template-builder-v2/SKILL.md`.
- The fixture under `public/adstudio-templates/`.

The current uncommitted user deletions are only under
`frank/template-factory/**`. This task does not resurrect, overwrite, or
otherwise modify those deletions.

The older, still-relevant clone-only lineage is `1c91bda6`, `dcaaf47a`, and
`0cd587b4`. The Frank adapter references these commits instead of copying
their code.

The adapted boundary is provider-neutral request, trace, release, health,
widget, command, event, graph-projection, and settings metadata. Blockwise
real-estate goals and Meta lead-form requirements remain in the project pack.
The home manifest contains exactly the dashboard-owned seven-field schema.
