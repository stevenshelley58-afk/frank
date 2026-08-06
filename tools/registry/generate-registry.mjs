#!/usr/bin/env node
/**
 * FRANK requirement registry generator.
 *
 * FRANK-§0: "The repository generates a requirement registry from both requirement
 * IDs and normative section locators. Each registry record has an owner,
 * implementation links, SLI or test, dataset version where relevant, threshold,
 * evidence artifact, and current status. A cross-cutting rule is not optional
 * merely because it is written as prose."
 *
 * It extracts two kinds of record from the specification markdown:
 *
 *   kind "requirement"  every ID row in the §4 functional-requirement tables.
 *                       ID prefixes are DISCOVERED from the table rows, never
 *                       hardcoded, so a new §4.x table with a new prefix is
 *                       picked up automatically.
 *   kind "section"      every numbered `## N.` / `### N.M` heading, emitted with
 *                       locator `FRANK-§N.M` — these are the cross-cutting
 *                       normative rules written as prose.
 *
 * Stewardship fields (owner, implementation, test, threshold, evidence, status)
 * are HUMAN-MAINTAINED. Regeneration merges them forward from the committed
 * registry.json by record id, so assigning an owner does not create drift, and
 * changing the specification does.
 *
 * Usage:
 *   node tools/registry/generate-registry.mjs [--spec <file>] [--root <repoRoot>]
 *   node tools/registry/generate-registry.mjs --check
 *
 * --check regenerates in memory and fails if either:
 *   (a) the committed docs/requirements/registry.{json,md} differ  -> drift, or
 *   (b) any record still has owner: null                           -> Slice 0
 *       exit gate 5, "unowned rows fail CI" (FRANK-§0).
 *
 * Exit codes: 0 = ok, 1 = drift and/or unowned records, 2 = tool/usage error.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');

/** Candidate in-repo locations for the controlling specification. */
const SPEC_CANDIDATES = [
  'docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md',
  'docs/product/FRANK_SPEC.md',
  'docs/product/spec.md',
];

const REGISTRY_JSON = 'docs/requirements/registry.json';
const REGISTRY_MD = 'docs/requirements/registry.md';

/** The §N whose tables hold functional requirement IDs (FRANK-§4). */
const REQUIREMENT_SECTION = '4';

/** A requirement ID: uppercase prefix, hyphen, digits. Prefix is discovered. */
const REQUIREMENT_ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** Stewardship fields carried forward across regeneration. */
const STEWARDSHIP_DEFAULTS = Object.freeze({
  owner: null,
  implementation: [],
  test: null,
  threshold: null,
  evidence: null,
  status: 'unowned',
});

/* -------------------------------------------------------------------- cli --- */

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, spec: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      opts.check = true;
    } else if (arg === '--root' || arg === '--spec') {
      const value = argv[i + 1];
      if (!value) toolError(`${arg} requires a path`);
      if (arg === '--root') opts.root = path.resolve(value);
      else opts.spec = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      opts.root = path.resolve(arg.slice('--root='.length));
    } else if (arg.startsWith('--spec=')) {
      opts.spec = path.resolve(arg.slice('--spec='.length));
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: generate-registry.mjs [--spec <file>] [--root <repoRoot>] [--check]\n'
      );
      process.exit(0);
    } else {
      toolError(`unknown argument: ${arg}`);
    }
  }
  if (!opts.spec && process.env.FRANK_SPEC) opts.spec = path.resolve(process.env.FRANK_SPEC);
  return opts;
}

function toolError(message) {
  process.stderr.write(`generate-registry: ${message}\n`);
  process.exit(2);
}

function resolveSpec(opts) {
  if (opts.spec) {
    if (!existsSync(opts.spec)) toolError(`specification not found at ${opts.spec}`);
    return opts.spec;
  }
  for (const candidate of SPEC_CANDIDATES) {
    const full = path.join(opts.root, candidate);
    if (existsSync(full)) return full;
  }
  toolError(
    `no specification found. Looked for ${SPEC_CANDIDATES.join(', ')} under ${opts.root}. ` +
      `Pass --spec <file> or set FRANK_SPEC.`
  );
}

/* ------------------------------------------------------------------ parse --- */

/** Split a markdown table row into trimmed cells, honouring escaped pipes. */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = [];
  let current = '';
  for (let i = 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) cells.push(current.trim());
  return cells;
}

/**
 * Parse the specification into registry records, in document order.
 * @returns {{records: any[], prefixes: Map<string, number>, warnings: string[]}}
 */
function parseSpec(specText, specRelPath) {
  const lines = specText.split(/\r?\n/);
  const records = [];
  const prefixes = new Map();
  const warnings = [];
  const seenIds = new Map();

  let inFence = false;
  let fenceMarker = '';
  let currentH2 = null; // { number, locator }
  let currentH3 = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    /* fenced code blocks are not specification structure */
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    /* headings -> section locators */
    const heading = /^(#{2,3})\s+(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const number = heading[2];
      const title = heading[3].trim();
      const locator = `FRANK-§${number}`;

      if (level === 2) {
        currentH2 = { number, locator };
        currentH3 = null;
      } else {
        currentH3 = { number, locator };
      }

      const parentLocator =
        level === 2 ? null : currentH2 ? currentH2.locator : null;

      pushRecord(records, seenIds, warnings, {
        id: locator,
        kind: 'section',
        title,
        text: null,
        acceptance: null,
        sourceSection: parentLocator,
        specLine: lineNo,
      });
      continue;
    }

    /* any other `##`/`###` heading is non-normative structure (e.g. "Workstream 3") */
    if (/^#{2,3}\s/.test(line)) {
      if (/^##\s/.test(line)) {
        currentH2 = null;
        currentH3 = null;
      } else {
        currentH3 = null;
      }
      continue;
    }

    /* §4 requirement table rows */
    if (!currentH2 || currentH2.number !== REQUIREMENT_SECTION) continue;
    const cells = tableCells(line);
    if (!cells || cells.length !== 3) continue;
    const [id, text, acceptance] = cells;
    if (!REQUIREMENT_ID.test(id)) continue;

    const prefix = id.slice(0, id.lastIndexOf('-'));
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);

    pushRecord(records, seenIds, warnings, {
      id,
      kind: 'requirement',
      title: null,
      text,
      acceptance: acceptance || null,
      sourceSection: (currentH3 ?? currentH2).locator,
      specLine: lineNo,
    });
  }

  if (records.filter((r) => r.kind === 'requirement').length === 0) {
    toolError(
      `parsed 0 requirement rows out of ${specRelPath}. The §${REQUIREMENT_SECTION} tables ` +
        `did not match the expected "| ID | Requirement | Acceptance evidence |" shape.`
    );
  }

  return { records, prefixes, warnings };
}

function pushRecord(records, seenIds, warnings, record) {
  const previous = seenIds.get(record.id);
  if (previous) {
    warnings.push(
      `duplicate record id ${record.id}: spec line ${previous.specLine} and line ${record.specLine}. ` +
        `The later occurrence is ignored.`
    );
    return;
  }
  seenIds.set(record.id, record);
  records.push(record);
}

/* -------------------------------------------------------------- assemble --- */

function loadExistingStewardship(registryPath) {
  if (!existsSync(registryPath)) return new Map();
  let doc;
  try {
    doc = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    return new Map();
  }
  const map = new Map();
  for (const record of doc?.records ?? []) {
    if (typeof record?.id !== 'string') continue;
    map.set(record.id, {
      owner: record.owner ?? null,
      implementation: Array.isArray(record.implementation) ? record.implementation : [],
      test: record.test ?? null,
      threshold: record.threshold ?? null,
      evidence: record.evidence ?? null,
      status: typeof record.status === 'string' ? record.status : null,
    });
  }
  return map;
}

function buildRegistry({ parsed, specRelPath, specSha, stewardship }) {
  const records = parsed.records.map((r) => {
    const carried = stewardship.get(r.id) ?? {};
    const owner = carried.owner ?? STEWARDSHIP_DEFAULTS.owner;
    const status =
      owner === null
        ? 'unowned'
        : carried.status && carried.status !== 'unowned'
          ? carried.status
          : 'owned';
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      text: r.text,
      acceptance: r.acceptance,
      sourceSection: r.sourceSection,
      owner,
      implementation: carried.implementation ?? [...STEWARDSHIP_DEFAULTS.implementation],
      test: carried.test ?? STEWARDSHIP_DEFAULTS.test,
      threshold: carried.threshold ?? STEWARDSHIP_DEFAULTS.threshold,
      evidence: carried.evidence ?? STEWARDSHIP_DEFAULTS.evidence,
      status,
    };
  });

  const requirements = records.filter((r) => r.kind === 'requirement');
  const sections = records.filter((r) => r.kind === 'section');
  const unowned = records.filter((r) => r.owner === null);

  return {
    generator: 'tools/registry/generate-registry.mjs',
    specification: specRelPath,
    specificationSha256: specSha,
    schemaVersion: 1,
    note:
      'FRANK-§0. Generated from the specification. Spec-derived fields are overwritten on ' +
      'every run; owner/implementation/test/threshold/evidence/status are human-maintained ' +
      'and merged forward by record id. Run `pnpm registry:generate` after editing the spec.',
    counts: {
      total: records.length,
      requirement: requirements.length,
      section: sections.length,
      unowned: unowned.length,
      requirementPrefixes: Object.fromEntries(
        [...parsed.prefixes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      ),
    },
    records,
  };
}

/* ---------------------------------------------------------------- render --- */

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderMarkdown(registry) {
  const out = [];
  const { counts } = registry;
  out.push('# FRANK requirement registry');
  out.push('');
  out.push(
    '> Generated by `tools/registry/generate-registry.mjs` from ' +
      `\`${registry.specification}\`. Do not edit spec-derived columns by hand; ` +
      'run `pnpm registry:generate`. Owner, implementation, test, threshold, and evidence ' +
      'are human-maintained and merged forward on regeneration (FRANK-§0).'
  );
  out.push('');
  out.push('| Metric | Value |');
  out.push('|---|---|');
  out.push(`| Specification | \`${registry.specification}\` |`);
  out.push(`| Specification SHA-256 | \`${registry.specificationSha256}\` |`);
  out.push(`| Total records | ${counts.total} |`);
  out.push(`| Requirement rows | ${counts.requirement} |`);
  out.push(`| Section locators | ${counts.section} |`);
  out.push(`| Unowned records | ${counts.unowned} |`);
  out.push('');
  out.push('## Requirement ID prefixes discovered in §4');
  out.push('');
  out.push('| Prefix | Rows |');
  out.push('|---|---|');
  for (const [prefix, count] of Object.entries(counts.requirementPrefixes)) {
    out.push(`| ${prefix} | ${count} |`);
  }
  out.push('');

  out.push('## Requirements (FRANK-§4)');
  out.push('');
  out.push('| ID | Section | Requirement | Acceptance evidence | Owner | Test | Evidence | Status |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of registry.records.filter((x) => x.kind === 'requirement')) {
    out.push(
      `| ${r.id} | ${escapeCell(r.sourceSection)} | ${escapeCell(r.text)} | ` +
        `${escapeCell(r.acceptance)} | ${escapeCell(r.owner) || '—'} | ` +
        `${escapeCell(r.test) || '—'} | ${escapeCell(r.evidence) || '—'} | ${r.status} |`
    );
  }
  out.push('');

  out.push('## Normative section locators');
  out.push('');
  out.push('| Locator | Title | Parent | Owner | Test | Evidence | Status |');
  out.push('|---|---|---|---|---|---|---|');
  for (const r of registry.records.filter((x) => x.kind === 'section')) {
    out.push(
      `| ${r.id} | ${escapeCell(r.title)} | ${escapeCell(r.sourceSection) || '—'} | ` +
        `${escapeCell(r.owner) || '—'} | ${escapeCell(r.test) || '—'} | ` +
        `${escapeCell(r.evidence) || '—'} | ${r.status} |`
    );
  }
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const specPath = resolveSpec(opts);
  const specRelPath = path.relative(opts.root, specPath).split(path.sep).join('/');
  const specTextRaw = await readFile(specPath, 'utf8');
  // Line-ending normalization (Track B1 CI parity): Windows checkouts with
  // core.autocrlf=true materialize the spec as CRLF, which would change the
  // content hash even though the specification is unchanged. Canonicalize to
  // LF before hashing/parsing so the registry is identical on every platform.
  const specText = specTextRaw.replace(/\r\n?/g, '\n');
  const specSha = createHash('sha256').update(specText, 'utf8').digest('hex');

  const jsonPath = path.join(opts.root, REGISTRY_JSON);
  const mdPath = path.join(opts.root, REGISTRY_MD);

  const parsed = parseSpec(specText, specRelPath);
  const stewardship = loadExistingStewardship(jsonPath);
  const registry = buildRegistry({ parsed, specRelPath, specSha, stewardship });

  const jsonText = `${JSON.stringify(registry, null, 2)}\n`;
  const mdText = `${renderMarkdown(registry)}`;

  for (const warning of parsed.warnings) {
    process.stderr.write(`generate-registry: warning: ${warning}\n`);
  }

  if (!opts.check) {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, jsonText, 'utf8');
    await writeFile(mdPath, mdText, 'utf8');
    process.stdout.write(
      `registry written: ${REGISTRY_JSON} and ${REGISTRY_MD}\n` +
        `  ${registry.counts.total} record(s) = ${registry.counts.requirement} requirement(s) + ` +
        `${registry.counts.section} section locator(s)\n` +
        `  requirement prefixes: ${Object.entries(registry.counts.requirementPrefixes)
          .map(([p, n]) => `${p}(${n})`)
          .join(' ')}\n` +
        `  unowned: ${registry.counts.unowned}\n`
    );
    process.exit(0);
  }

  /* ---------------------------------------------------------------- --check */
  let failed = false;

  const driftMessages = [];
  if (!existsSync(jsonPath)) {
    driftMessages.push(`${REGISTRY_JSON} is missing`);
  } else {
    const committedText = await readFile(jsonPath, 'utf8');
    if (committedText !== jsonText) {
      driftMessages.push(`${REGISTRY_JSON} differs from the specification`);
      let committed;
      try {
        committed = JSON.parse(committedText);
      } catch {
        driftMessages.push(`  ${REGISTRY_JSON} is not valid JSON`);
      }
      if (committed) {
        if (committed.specificationSha256 !== registry.specificationSha256) {
          driftMessages.push(
            `  specification SHA-256 changed: committed ${committed.specificationSha256} vs current ${registry.specificationSha256}`
          );
        }
        const committedIds = new Set((committed.records ?? []).map((r) => r.id));
        const currentIds = new Set(registry.records.map((r) => r.id));
        const added = [...currentIds].filter((id) => !committedIds.has(id));
        const removed = [...committedIds].filter((id) => !currentIds.has(id));
        const byId = new Map((committed.records ?? []).map((r) => [r.id, r]));
        const changed = registry.records
          .filter((r) => byId.has(r.id))
          .filter((r) => {
            const c = byId.get(r.id);
            return (
              c.text !== r.text ||
              c.title !== r.title ||
              c.acceptance !== r.acceptance ||
              c.sourceSection !== r.sourceSection ||
              c.kind !== r.kind
            );
          })
          .map((r) => r.id);
        if (added.length) driftMessages.push(`  added (${added.length}): ${added.join(', ')}`);
        if (removed.length) driftMessages.push(`  removed (${removed.length}): ${removed.join(', ')}`);
        if (changed.length)
          driftMessages.push(`  changed (${changed.length}): ${changed.join(', ')}`);
      }
    }
  }

  if (!existsSync(mdPath)) {
    driftMessages.push(`${REGISTRY_MD} is missing`);
  } else if ((await readFile(mdPath, 'utf8')) !== mdText) {
    driftMessages.push(`${REGISTRY_MD} differs from the specification`);
  }

  if (driftMessages.length > 0) {
    failed = true;
    process.stderr.write('\nREGISTRY DRIFT (FRANK-§0 traceability)\n');
    for (const message of driftMessages) process.stderr.write(`  ${message}\n`);
    process.stderr.write('\n  Fix: run `pnpm registry:generate` and commit the result.\n');
  }

  const unowned = registry.records.filter((r) => r.owner === null);
  process.stdout.write(
    `registry: ${registry.counts.total} record(s) ` +
      `(${registry.counts.requirement} requirement, ${registry.counts.section} section), ` +
      `${unowned.length} unowned.\n`
  );

  if (unowned.length > 0) {
    failed = true;
    const byKind = { requirement: 0, section: 0 };
    for (const r of unowned) byKind[r.kind] += 1;
    process.stderr.write(
      `\nUNOWNED REGISTRY RECORDS: ${unowned.length} record(s) have owner: null ` +
        `(${byKind.requirement} requirement, ${byKind.section} section)\n` +
        `Slice 0 exit gate 5 — FRANK-§0: every registry record needs an owner, ` +
        `implementation links, an SLI or test, a threshold, and an evidence artifact.\n\n`
    );
    const sample = unowned.slice(0, 25);
    for (const r of sample) {
      const label = r.kind === 'requirement' ? r.text : r.title;
      process.stderr.write(
        `  ${r.id.padEnd(14)} ${r.sourceSection ?? '—'}  ${String(label).slice(0, 96)}\n`
      );
    }
    if (unowned.length > sample.length) {
      process.stderr.write(`  ... and ${unowned.length - sample.length} more\n`);
    }
    process.stderr.write(
      `\n  Fix: set "owner" on each record in ${REGISTRY_JSON}, then run \`pnpm registry:generate\`.\n`
    );
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`generate-registry: unexpected error\n${error?.stack ?? error}\n`);
  process.exit(2);
});
