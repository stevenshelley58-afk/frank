#!/usr/bin/env node
/**
 * FRANK environment definition validator.
 *
 * Enforces FRANK-§16.4 (the six environments), Slice 0 exit gate 7 (all six have a real
 * definition; staging and recovery are not stubs), and the FRANK-§18.1 "Static" test layer
 * ("Formatting, lint, types, schema, dependency direction, secrets, licenses").
 *
 * What it does:
 *   1. Loads `infra/environments/schema.json` (schema://frank.environment/v1) and compiles
 *      it with Ajv 2020-12 + ajv-formats.
 *   2. Loads every `infra/environments/<name>.env.yaml` and validates it against the schema.
 *   3. Applies the cross-file invariants a single-document schema cannot express — spec
 *      rules that only exist as a property of the whole set of environments.
 *
 * Cross-file invariants (rule id -> spec locator):
 *
 *   env-set-complete          FRANK-§16.4 names exactly six environments; all six files exist
 *                             and no seventh file is present.
 *   env-name-matches-file     `<name>.env.yaml` declares `name: <name>`.
 *   env-slice0-not-stub       Slice 0 exit gate 7: staging and recovery may not be stubs.
 *   env-service-coverage      FRANK-§16.2: every baseline service appears exactly once across
 *                             present/optional/absent, and service notes reference known ids.
 *   env-single-side-effect    FRANK-§16.4: production is the only environment permitted real
 *                             external side effects.
 *   env-single-evidence-anchor FRANK-§18.2 "Release identity": exactly one environment anchors
 *                             release evidence, and it is staging; the digest recorded there is
 *                             the digest production promotion requires.
 *   env-digest-chain          The staging digest must actually reach production: production
 *                             pins `digestSource: staging` and forbids rebuild.
 *   env-write-authority       FRANK-§16.1/§16.7: only production and recovery may hold canonical
 *                             data or become the active writer; recovery must fence the prior one.
 *   env-promotion-symmetry    A promotion edge is declared by both ends or by neither.
 *   env-distinct-cell-ids     FRANK-§2.4 + FRANK-§16.4: no two environments share a cell id.
 *   env-no-shared-state       FRANK-§16.4: no environment shares credentials or writable databases.
 *   env-preview-domain        FRANK-§16.3: `SANDBOX_BASE_DOMAIN` is a separately owned registrable
 *                             domain, never a child of `frank.fail`; no preview hostname may sit
 *                             under a domain listed in `mustNotBeChildOf`.
 *   env-resource-envelope     FRANK-§16.6: declared memory envelopes plus the OS reserve equal
 *                             total memory, and disk quotas sum to total disk.
 *
 * Usage:
 *   node tools/lint/validate-environments.mjs [--root <repoRoot>] [--json]
 *
 * Exit codes: 0 = all environments valid, 1 = at least one failure, 2 = tool/usage error.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');

const ENV_SUFFIX = '.env.yaml';
const SCHEMA_FILE = 'schema.json';
const SCHEMA_ID = 'schema://frank.environment/v1';

/** FRANK-§16.4. The set is closed. */
const REQUIRED_ENVIRONMENTS = [
  'local',
  'integration',
  'preview',
  'staging',
  'production',
  'recovery',
];

/** Slice 0 exit gate 7. */
const MUST_NOT_BE_STUB = ['staging', 'recovery'];

/** FRANK-§16.1/§16.7: the canonical write pair. */
const CANONICAL_ENVIRONMENTS = ['production', 'recovery'];

/* ------------------------------------------------------------------ cli --- */

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) fail('--root requires a path');
      opts.root = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      opts.root = path.resolve(arg.slice('--root='.length));
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: validate-environments.mjs [--root <repoRoot>] [--json]\n');
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`validate-environments: ${message}\n`);
  process.exit(2);
}

/* ----------------------------------------------------------------- util --- */

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

/** True when `host` is `domain` or a subdomain of it. */
function isUnder(host, domain) {
  const h = String(host).toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  const d = String(domain).toLowerCase().replace(/\.$/, '');
  return h === d || h.endsWith(`.${d}`);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function list(values) {
  return values.length === 0 ? '(none)' : values.join(', ');
}

/* ----------------------------------------------------------------- main --- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envDir = path.join(opts.root, 'infra', 'environments');
  const schemaPath = path.join(envDir, SCHEMA_FILE);

  if (!existsSync(envDir)) fail(`no environment directory at ${envDir}`);
  if (!existsSync(schemaPath)) fail(`no schema at ${schemaPath}`);

  const failures = [];
  const addFailure = (file, rule, detail, errors = []) => {
    failures.push({ file, rule, detail, errors });
  };

  /* --- 1. compile the schema --------------------------------------------- */

  let schemaDoc;
  try {
    schemaDoc = JSON.parse(await readFile(schemaPath, 'utf8'));
  } catch (error) {
    fail(`invalid JSON in ${path.relative(opts.root, schemaPath)}: ${error?.message ?? error}`);
  }
  if (schemaDoc.$id !== SCHEMA_ID) {
    fail(`${path.relative(opts.root, schemaPath)} must declare "$id": "${SCHEMA_ID}"`);
  }

  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strictSchema: false,
    validateFormats: true,
    verbose: false,
  });
  addFormats(ajv);

  let validate;
  try {
    validate = ajv.compile(schemaDoc);
  } catch (error) {
    fail(`schema does not compile: ${error?.message ?? error}`);
  }

  const serviceIds = schemaDoc.$defs?.ServiceId?.enum ?? [];
  if (serviceIds.length === 0) fail('schema is missing $defs.ServiceId.enum (FRANK-§16.2 baseline)');

  /* --- 2. load and validate each environment ------------------------------ */

  const entries = await readdir(envDir, { withFileTypes: true });
  const envFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(ENV_SUFFIX))
    .map((e) => e.name)
    .sort();

  /** @type {Map<string, {name: string, rel: string, doc: any}>} declared name -> record */
  const envs = new Map();
  const seenFileNames = new Set();

  for (const fileName of envFiles) {
    const file = path.join(envDir, fileName);
    const rel = path.relative(opts.root, file);
    const base = fileName.slice(0, -ENV_SUFFIX.length);
    seenFileNames.add(base);

    let doc;
    try {
      doc = parseYaml(await readFile(file, 'utf8'));
    } catch (error) {
      addFailure(rel, 'env-parse', `invalid YAML: ${error?.message ?? error}`);
      continue;
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      addFailure(rel, 'env-parse', 'an environment definition must be a YAML mapping');
      continue;
    }

    if (!validate(doc)) {
      addFailure(
        rel,
        'env-invalid',
        `does not satisfy ${SCHEMA_FILE} (${SCHEMA_ID})`,
        (validate.errors ?? []).map(formatAjvError)
      );
      // Keep going: cross-file rules still produce useful output on a partly valid doc.
    }

    if (doc.name !== base) {
      addFailure(
        rel,
        'env-name-matches-file',
        `file is ${fileName} but declares name: ${JSON.stringify(doc.name)}. ` +
          'The filename is how every other tool addresses this environment.'
      );
    }

    const key = typeof doc.name === 'string' ? doc.name : base;
    if (envs.has(key)) {
      addFailure(rel, 'env-duplicate', `environment ${key} is already defined by ${envs.get(key).rel}`);
      continue;
    }
    envs.set(key, { name: key, rel, doc });
  }

  /* --- 3. FRANK-§16.4: exactly six environments --------------------------- */

  const dirRel = path.relative(opts.root, envDir);

  for (const name of REQUIRED_ENVIRONMENTS) {
    if (!seenFileNames.has(name)) {
      addFailure(
        `${dirRel}/${name}${ENV_SUFFIX}`,
        'env-set-complete',
        `FRANK-§16.4 requires a definition for "${name}". Slice 0 exit gate 7 requires all six.`
      );
    }
  }
  for (const base of [...seenFileNames].sort()) {
    if (!REQUIRED_ENVIRONMENTS.includes(base)) {
      addFailure(
        `${dirRel}/${base}${ENV_SUFFIX}`,
        'env-set-complete',
        `FRANK-§16.4 names exactly six environments and "${base}" is not one of them. ` +
          'A seventh environment is a specification change under FRANK-§0.2.'
      );
    }
  }

  /* --- 4. per-environment cross-cutting rules ----------------------------- */

  for (const { name, rel, doc } of envs.values()) {
    /* Slice 0 exit gate 7 */
    if (MUST_NOT_BE_STUB.includes(name) && doc.status === 'stub') {
      addFailure(
        rel,
        'env-slice0-not-stub',
        `Slice 0 exit gate 7 requires "${name}" to be a real definition, not a stub.`
      );
    }

    /* FRANK-§16.2 total service coverage */
    const svc = doc.services ?? {};
    const buckets = [
      ['present', svc.present],
      ['optional', svc.optional],
      ['absent', svc.absent],
    ];
    /** @type {Map<string, string[]>} */
    const placement = new Map();
    for (const [bucket, values] of buckets) {
      for (const id of Array.isArray(values) ? values : []) {
        if (!placement.has(id)) placement.set(id, []);
        placement.get(id).push(bucket);
      }
    }
    const missing = serviceIds.filter((id) => !placement.has(id));
    const duplicated = [...placement.entries()].filter(([, b]) => b.length > 1);
    if (missing.length > 0 || duplicated.length > 0) {
      const detail = [];
      if (missing.length > 0) {
        detail.push(`unplaced: ${list(missing)}`);
      }
      for (const [id, bucketNames] of duplicated) {
        detail.push(`${id} appears in ${bucketNames.join(' and ')}`);
      }
      addFailure(
        rel,
        'env-service-coverage',
        'every FRANK-§16.2 baseline service must appear in exactly one of present/optional/absent. ' +
          'Absence is a decision with a reason, not an omission — and a new baseline row must not be ' +
          'silently ignored by an existing environment.',
        detail
      );
    }
    const noteKeys = Object.keys(svc.notes ?? {});
    const unknownNotes = noteKeys.filter((id) => !serviceIds.includes(id));
    if (unknownNotes.length > 0) {
      addFailure(rel, 'env-service-coverage', `services.notes references unknown service id(s): ${list(unknownNotes)}`);
    }

    /* FRANK-§16.4 no shared credentials or writable databases */
    const iso = doc.isolation ?? {};
    if (iso.sharesCredentials !== false || iso.sharesWritableDatabase !== false) {
      addFailure(
        rel,
        'env-no-shared-state',
        'FRANK-§16.4: "No environment shares credentials or writable databases with another." ' +
          'Both assertions must be present and false.'
      );
    }

    /* FRANK-§16.1/§16.7 write authority */
    const authority = doc.traffic?.canonicalWriteAuthority;
    if (authority && !CANONICAL_ENVIRONMENTS.includes(name)) {
      if (authority.holdsCanonicalData === true || authority.mayBecomeActiveWriter === true) {
        addFailure(
          rel,
          'env-write-authority',
          `only ${CANONICAL_ENVIRONMENTS.join(' and ')} may hold canonical FRANK data or become the ` +
            'active writer (FRANK-§16.1 single active write authority).'
        );
      }
    }
    if (name === 'recovery' && authority?.requiresFencingOfPriorWriter !== true) {
      addFailure(
        rel,
        'env-write-authority',
        'FRANK-§16.1: the warm recovery cell may not become the active writer until the failover ' +
          'controller has verified fencing of the old writer.'
      );
    }

    /* FRANK-§16.3 preview registrable domain */
    const net = doc.network ?? {};
    const forbiddenParents = Array.isArray(net.mustNotBeChildOf) ? net.mustNotBeChildOf : [];
    for (const parent of forbiddenParents) {
      if (typeof net.registrableDomain === 'string' && isUnder(net.registrableDomain, parent)) {
        addFailure(
          rel,
          'env-preview-domain',
          `registrableDomain "${net.registrableDomain}" sits under "${parent}". ` +
            'FRANK-§16.3: SANDBOX_BASE_DOMAIN must be a separately owned registrable domain, ' +
            'never a child of frank.fail — cookie, storage, and service-worker isolation depend on it.'
        );
      }
      for (const host of Array.isArray(net.hostnames) ? net.hostnames : []) {
        if (isUnder(host, parent)) {
          addFailure(
            rel,
            'env-preview-domain',
            `hostname "${host}" sits under "${parent}", which this environment declares it must not.`
          );
        }
      }
    }
    if (name === 'preview' && typeof net.registrableDomain === 'string') {
      if (isUnder(net.registrableDomain, 'frank.fail')) {
        addFailure(
          rel,
          'env-preview-domain',
          'FRANK-§16.3: the preview registrable domain may never be frank.fail or a child of it.'
        );
      }
    }

    /* FRANK-§16.6 envelopes and quotas */
    const res = doc.resources ?? {};
    if (res.memoryEnvelopesGb && typeof res.memoryGb === 'number') {
      const envelopes = sum(Object.values(res.memoryEnvelopesGb).filter((v) => typeof v === 'number'));
      const reserve = res.osReserve?.memoryGb ?? 0;
      if (envelopes + reserve !== res.memoryGb) {
        addFailure(
          rel,
          'env-resource-envelope',
          `FRANK-§16.6 memory does not balance: envelopes ${envelopes} GB + OS reserve ${reserve} GB ` +
            `= ${envelopes + reserve} GB, but memoryGb is ${res.memoryGb} GB.`
        );
      }
    }
    if (res.diskQuotasGb && typeof res.diskGb === 'number') {
      const quotas = sum(Object.values(res.diskQuotasGb).filter((v) => typeof v === 'number'));
      if (quotas !== res.diskGb) {
        addFailure(
          rel,
          'env-resource-envelope',
          `FRANK-§16.6 disk does not balance: quotas sum to ${quotas} GB but diskGb is ${res.diskGb} GB.`
        );
      }
    }
  }

  /* --- 5. set-level rules -------------------------------------------------- */

  const sideEffectEnvs = [...envs.values()].filter((e) => e.doc.externalSideEffects?.allowed === true);
  if (sideEffectEnvs.length !== 1 || sideEffectEnvs[0]?.name !== 'production') {
    addFailure(
      dirRel,
      'env-single-side-effect',
      'FRANK-§16.4: production is the only environment permitted real external side effects. ' +
        `Found: ${list(sideEffectEnvs.map((e) => e.name))}.`
    );
  }

  const anchors = [...envs.values()].filter(
    (e) => e.doc.promotion?.artifact?.isReleaseEvidenceAnchor === true
  );
  if (anchors.length !== 1 || anchors[0]?.name !== 'staging') {
    addFailure(
      dirRel,
      'env-single-evidence-anchor',
      'FRANK-§18.2 "Release identity": one artifact digest travels from staging evidence through ' +
        'production promotion, so exactly one environment anchors release evidence and it is staging. ' +
        `Found: ${list(anchors.map((e) => e.name))}.`
    );
  }

  const production = envs.get('production');
  const staging = envs.get('staging');
  if (production && staging) {
    const art = production.doc.promotion?.artifact ?? {};
    const problems = [];
    if (art.digestSource !== 'staging') {
      problems.push(`production digestSource is ${JSON.stringify(art.digestSource)}, expected "staging"`);
    }
    if (art.requiresDigestMatchingStagingEvidence !== true) {
      problems.push('production does not require the promoted digest to match staging evidence');
    }
    if (art.builtHere !== false || art.rebuildForbidden !== true) {
      problems.push('production must not build or rebuild the artifact (FRANK-§18.4 "build once")');
    }
    if (staging.doc.promotion?.artifact?.builtHere !== false) {
      problems.push('staging must not build the artifact; it rehearses the digest integration produced');
    }
    if (problems.length > 0) {
      addFailure(
        production.rel,
        'env-digest-chain',
        'FRANK-§18.2 "Release identity" requires one artifact digest from staging evidence through ' +
          'production promotion. A rebuilt or re-sourced artifact makes that threshold unverifiable.',
        problems
      );
    }
  }

  for (const { name, rel, doc } of envs.values()) {
    const to = doc.promotion?.promotesTo ?? [];
    const from = doc.promotion?.promotesFrom ?? [];
    for (const target of to) {
      if (!envs.has(target)) continue; // non-environment endpoint, nothing to mirror
      const other = envs.get(target);
      if (!(other.doc.promotion?.promotesFrom ?? []).includes(name)) {
        addFailure(
          rel,
          'env-promotion-symmetry',
          `${name} declares promotesTo: ${target}, but ${target} does not list ${name} in promotesFrom. ` +
            'A promotion edge is declared by both ends or by neither.'
        );
      }
    }
    for (const origin of from) {
      if (!envs.has(origin)) continue;
      const other = envs.get(origin);
      if (!(other.doc.promotion?.promotesTo ?? []).includes(name)) {
        addFailure(
          rel,
          'env-promotion-symmetry',
          `${name} declares promotesFrom: ${origin}, but ${origin} does not list ${name} in promotesTo.`
        );
      }
    }
  }

  /** @type {Map<string, string[]>} */
  const cellIds = new Map();
  for (const { name, doc } of envs.values()) {
    const id = doc.isolation?.cellId;
    if (typeof id !== 'string') continue;
    if (!cellIds.has(id)) cellIds.set(id, []);
    cellIds.get(id).push(name);
  }
  for (const [id, owners] of cellIds) {
    if (owners.length > 1) {
      addFailure(
        dirRel,
        'env-distinct-cell-ids',
        `cell id "${id}" is claimed by ${owners.join(' and ')}. FRANK-§2.4 scopes every record to ` +
          'exactly one cell; a shared identifier makes cross-environment records representable.'
      );
    }
  }

  /* --- 6. report ----------------------------------------------------------- */

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        { ok: failures.length === 0, environments: envs.size, files: envFiles.length, failures },
        null,
        2
      )}\n`
    );
    process.exit(failures.length === 0 ? 0 : 1);
  }

  if (failures.length === 0) {
    process.stdout.write(
      `environments OK: ${envs.size} definition(s) validated against ${SCHEMA_FILE} (${SCHEMA_ID}).\n`
    );
    for (const name of REQUIRED_ENVIRONMENTS) {
      const entry = envs.get(name);
      if (!entry) continue;
      const d = entry.doc;
      const flags = [
        `class<=${d.dataClassification?.ceiling}`,
        `sideEffects=${d.externalSideEffects?.allowed ? 'permitted' : d.externalSideEffects?.mode}`,
        `disposable=${d.lifetime?.disposable}`,
        d.promotion?.artifact?.isReleaseEvidenceAnchor ? 'release-evidence-anchor' : null,
      ].filter(Boolean);
      process.stdout.write(`  ${name.padEnd(12)} ${d.services?.present?.length ?? 0} present  ${flags.join('  ')}\n`);
    }
    process.stdout.write(
      '\n  promotion path: ' +
        REQUIRED_ENVIRONMENTS.map((n) => n).join(' -> ') +
        '\n  digest chain:   integration (built, signed) -> staging (evidence anchor) -> production (pinned) -> recovery (pre-staged)\n'
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nENVIRONMENT VALIDATION FAILED: ${failures.length} problem(s) ` +
      '(FRANK-§16.4, FRANK-§18.1 static gate, Slice 0 exit gate 7)\n\n'
  );
  for (const f of failures) {
    process.stderr.write(`  ${f.file}\n`);
    process.stderr.write(`    rule: ${f.rule}\n`);
    process.stderr.write(`    ${f.detail}\n`);
    for (const e of f.errors) process.stderr.write(`      - ${e}\n`);
    process.stderr.write('\n');
  }
  process.stderr.write(`${failures.length} failure(s) across ${envFiles.length} environment file(s).\n`);
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`validate-environments: unexpected error\n${error?.stack ?? error}\n`);
  process.exit(2);
});
