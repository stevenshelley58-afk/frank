#!/usr/bin/env node
/**
 * FRANK contract schema + example validator.
 *
 * Enforces FRANK-§6 (core modular contracts) and FRANK-§18.1 "Static" test layer
 * ("Formatting, lint, types, schema, dependency direction, secrets, licenses").
 *
 * What it does:
 *   1. Loads every `packages/contracts/schemas/*.schema.json`.
 *   2. Registers them all in one Ajv 2020-12 instance so cross-schema `$ref`s such as
 *      `schema://frank.classification/v1#/$defs/DataClass` resolve, then compiles each.
 *   3. Loads every `packages/contracts/examples/*.example.json` and validates it against
 *      the schema selected by filename convention.
 *   4. Fails if a schema has no example, or an example has no schema, or any `$id` is
 *      missing/duplicated, or any example fails validation.
 *
 * Filename convention (example -> schema):
 *      foo.v1.example.json           -> foo.v1.schema.json
 *      foo.v1.<variant>.example.json -> foo.v1.schema.json   (extra examples for one schema)
 *
 * Usage:
 *   node tools/registry/validate-contracts.mjs [--root <repoRoot>] [--json]
 *
 * Exit codes: 0 = all contracts valid, 1 = at least one failure, 2 = tool/usage error.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');

const SCHEMA_SUFFIX = '.schema.json';
const EXAMPLE_SUFFIX = '.example.json';

/* ------------------------------------------------------------------ cli --- */

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) fail(`--root requires a path`);
      opts.root = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      opts.root = path.resolve(arg.slice('--root='.length));
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: validate-contracts.mjs [--root <repoRoot>] [--json]\n'
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`validate-contracts: ${message}\n`);
  process.exit(2);
}

/* ----------------------------------------------------------------- util --- */

async function listJsonFiles(dir, suffix) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => e.name)
    .sort();
}

async function readJson(file) {
  const raw = await readFile(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid JSON: ${message}`);
  }
}

/** Render one Ajv error as a single readable line. */
function formatAjvError(error) {
  const location = error.instancePath === '' ? '<root>' : error.instancePath;
  const parts = [`${location}: ${error.message}`];
  const params = error.params ?? {};
  const detail = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? JSON.stringify(v) : String(v)}`)
    .join(', ');
  if (detail) parts.push(`(${detail})`);
  if (error.schemaPath) parts.push(`[schemaPath ${error.schemaPath}]`);
  return parts.join(' ');
}

/**
 * example basename -> candidate schema basenames, most specific first.
 *   "event-envelope.v1"          -> ["event-envelope.v1"]
 *   "policy-decision.v1.allow"   -> ["policy-decision.v1.allow", "policy-decision.v1"]
 */
function schemaCandidates(exampleBase) {
  const candidates = [exampleBase];
  const versioned = /^(.*\.v\d+)\..+$/.exec(exampleBase);
  if (versioned && versioned[1] !== exampleBase) candidates.push(versioned[1]);
  return candidates;
}

/* ----------------------------------------------------------------- main --- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const contractsDir = path.join(opts.root, 'packages', 'contracts');
  const schemasDir = path.join(contractsDir, 'schemas');
  const examplesDir = path.join(contractsDir, 'examples');

  if (!existsSync(schemasDir)) {
    fail(`no schema directory at ${schemasDir}`);
  }

  const failures = [];
  const addFailure = (file, rule, detail, errors = []) => {
    failures.push({ file, rule, detail, errors });
  };

  /* --- 1. load every schema ---------------------------------------------- */

  const schemaFiles = await listJsonFiles(schemasDir, SCHEMA_SUFFIX);
  if (schemaFiles.length === 0) {
    fail(`no *${SCHEMA_SUFFIX} files found in ${schemasDir}`);
  }

  /** @type {Map<string, {base: string, file: string, rel: string, doc: any}>} */
  const schemasByBase = new Map();
  /** @type {Map<string, string>} $id -> base */
  const baseById = new Map();

  for (const name of schemaFiles) {
    const file = path.join(schemasDir, name);
    const rel = path.relative(opts.root, file);
    const base = name.slice(0, -SCHEMA_SUFFIX.length);
    let doc;
    try {
      doc = await readJson(file);
    } catch (error) {
      addFailure(rel, 'schema-parse', error.message);
      continue;
    }
    if (typeof doc?.$id !== 'string' || doc.$id.length === 0) {
      addFailure(
        rel,
        'schema-missing-$id',
        'every contract schema must declare a stable "$id" so other schemas can $ref it'
      );
      continue;
    }
    if (baseById.has(doc.$id)) {
      addFailure(
        rel,
        'schema-duplicate-$id',
        `"$id" ${doc.$id} is already declared by ${baseById.get(doc.$id)}${SCHEMA_SUFFIX}`
      );
      continue;
    }
    baseById.set(doc.$id, base);
    schemasByBase.set(base, { base, file, rel, doc });
  }

  /* --- 2. compile them together ------------------------------------------ */

  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strictSchema: false, // contract schemas carry annotation keywords Ajv does not know
    validateFormats: true,
    verbose: false,
  });
  addFormats(ajv);

  for (const entry of schemasByBase.values()) {
    try {
      ajv.addSchema(entry.doc, entry.doc.$id);
    } catch (error) {
      addFailure(entry.rel, 'schema-register', String(error?.message ?? error));
    }
  }

  /** @type {Map<string, import('ajv').ValidateFunction>} */
  const validators = new Map();
  for (const entry of schemasByBase.values()) {
    try {
      const validate = ajv.getSchema(entry.doc.$id);
      if (!validate) throw new Error(`Ajv could not resolve ${entry.doc.$id} after registration`);
      validators.set(entry.base, validate);
    } catch (error) {
      // Unresolved cross-schema $ref surfaces here.
      addFailure(entry.rel, 'schema-compile', String(error?.message ?? error));
    }
  }

  /* --- 3. examples -------------------------------------------------------- */

  const exampleFiles = await listJsonFiles(examplesDir, EXAMPLE_SUFFIX);
  /** @type {Map<string, string[]>} schema base -> example rel paths */
  const examplesForSchema = new Map();
  for (const base of schemasByBase.keys()) examplesForSchema.set(base, []);

  let validatedExamples = 0;

  for (const name of exampleFiles) {
    const file = path.join(examplesDir, name);
    const rel = path.relative(opts.root, file);
    const exampleBase = name.slice(0, -EXAMPLE_SUFFIX.length);

    const candidates = schemaCandidates(exampleBase);
    const matchedBase = candidates.find((c) => schemasByBase.has(c));
    if (!matchedBase) {
      addFailure(
        rel,
        'example-without-schema',
        `no schema matches this example. Looked for ${candidates
          .map((c) => `schemas/${c}${SCHEMA_SUFFIX}`)
          .join(' or ')}`
      );
      continue;
    }

    examplesForSchema.get(matchedBase).push(rel);

    const validate = validators.get(matchedBase);
    if (!validate) continue; // schema already reported as broken

    let instance;
    try {
      instance = await readJson(file);
    } catch (error) {
      addFailure(rel, 'example-parse', error.message);
      continue;
    }

    validatedExamples += 1;
    const ok = validate(instance);
    if (!ok) {
      addFailure(
        rel,
        'example-invalid',
        `does not satisfy schemas/${matchedBase}${SCHEMA_SUFFIX} (${schemasByBase.get(matchedBase).doc.$id})`,
        (validate.errors ?? []).map(formatAjvError)
      );
    }
  }

  for (const [base, examples] of examplesForSchema) {
    if (examples.length === 0) {
      const entry = schemasByBase.get(base);
      addFailure(
        entry.rel,
        'schema-without-example',
        `every contract schema needs at least one example. Add packages/contracts/examples/${base}${EXAMPLE_SUFFIX}`
      );
    }
  }

  /* --- 4. report ---------------------------------------------------------- */

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: failures.length === 0,
          schemas: schemasByBase.size,
          examples: exampleFiles.length,
          validated: validatedExamples,
          failures,
        },
        null,
        2
      )}\n`
    );
    process.exit(failures.length === 0 ? 0 : 1);
  }

  if (failures.length === 0) {
    process.stdout.write(
      `contracts OK: ${schemasByBase.size} schema(s) compiled, ${validatedExamples} example(s) validated.\n`
    );
    for (const [base, examples] of [...examplesForSchema].sort()) {
      const entry = schemasByBase.get(base);
      process.stdout.write(
        `  ${base}${SCHEMA_SUFFIX}  ${entry.doc.$id}  <- ${examples
          .map((e) => path.basename(e))
          .join(', ')}\n`
      );
    }
    process.exit(0);
  }

  process.stderr.write(
    `\nCONTRACT VALIDATION FAILED: ${failures.length} problem(s) (FRANK-§6, FRANK-§18.1 static gate)\n\n`
  );
  for (const f of failures) {
    process.stderr.write(`  ${f.file}\n`);
    process.stderr.write(`    rule: ${f.rule}\n`);
    process.stderr.write(`    ${f.detail}\n`);
    for (const e of f.errors) process.stderr.write(`      - ${e}\n`);
    process.stderr.write('\n');
  }
  process.stderr.write(
    `${failures.length} failure(s) across ${schemasByBase.size} schema(s) and ${exampleFiles.length} example(s).\n`
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`validate-contracts: unexpected error\n${error?.stack ?? error}\n`);
  process.exit(2);
});
