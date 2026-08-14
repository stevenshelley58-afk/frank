# F1-3 — Module manifest and scaffold

**Depends:** F1-1 · **Model:** strong · **Serial**
**Allowed files:** `packages/frank-module/**`, `tools/create-module/**`
**Forbidden:** the modules themselves, apps, hot files

Every Frank module has the same shape. Define it once, generate it forever. Seven modules follow this in Wave 2 — inconsistency here multiplies by seven.

---

## `frank.module/v1`

```ts
type ModuleManifest = {
  schema: "frank.module/v1";
  module_id: string;                 // [a-z0-9-], unique
  version: string;                   // semver
  description: string;

  tables: string[];                  // canonical tables this module OWNS
  reads_from: string[];              // other modules' EVENTS it consumes — never their tables

  capabilities: {
    id: string;
    description: string;
    inputs: string;                  // JSON Schema $id
    outputs: string;
  }[];

  events: {
    name: string;                    // module_id.thing.happened
    version: number;
    payload: string;                 // JSON Schema $id
  }[];

  permissions: { id: string; description: string; default: "deny" }[];

  data_classification: {
    table: string;
    contains_pii: boolean;
    contains_credentials: boolean;
    exportable: boolean;             // may appear in a release payload
  }[];

  health: {
    endpoint: string;
    reports: ("dependencies"|"freshness"|"last_success"|"queue_age"|"cost"|"degraded")[];
  };

  retention: { table: string; days: number; policy: "delete"|"archive" }[];

  project_scoped: boolean;           // true for all Wave 2 modules
};
```

---

## Hard boundaries — enforce in code, not documentation

1. **A module may not query another module's tables.** Cross-module data flows through `subject_ref` values and versioned events. Write a lint rule that fails a build if a module imports another module's schema.
2. **`subject_ref` grants correlation, not access.** Holding a reference to a prospect does not entitle a module to that prospect's fields.
3. **A table marked `exportable: false` may never appear in a release payload.** Enforce in the release builder, with a test.
4. **Every table is project-scoped** — every query filters by `project_id`. A missing filter is a test failure, not a code review note.

---

## Scaffold generator

`pnpm create-module <id>` produces:

```
modules/<id>/
  module.json           manifest, pre-filled
  src/
    index.ts            capability exports
    schema.ts           Drizzle tables, project_id on every one
    events.ts
    health.ts
    provider.ts         optional dashboard widget provider
  migrations/           empty; number assigned by coordinator
  test/
    isolation.test.ts   generated: cross-project denial
    manifest.test.ts    generated: manifest validates
    genericity.test.ts  generated: runs against packs/acme
  README.md
```

The three generated tests must **fail** on a fresh module until it's implemented. A scaffold that passes empty is worthless.

---

## Done when

- [ ] Manifest schema validates; a manifest missing `data_classification` fails
- [ ] Generator produces a module that typechecks and whose generated tests fail correctly
- [ ] Lint rule blocks cross-module schema imports — proven by a deliberately bad fixture
- [ ] Export guard blocks a non-exportable table reaching a payload — proven by test
- [ ] Health contract returns all six fields
- [ ] `packs/acme` runs through `genericity.test.ts` on the scaffold
