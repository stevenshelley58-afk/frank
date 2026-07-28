#!/usr/bin/env node
/**
 * FRANK dependency-direction linter.
 *
 * Mechanical enforcement of FRANK-§17.2 ("Dependency rules") and the FRANK-§18.1
 * "Static" test layer, which lists dependency direction as a required check.
 *
 * Layers are derived from the directory a workspace package sits in:
 *
 *   packages/contracts   -> contracts       (frozen cross-cutting contracts, FRANK-§6)
 *   packages/*           -> packages        (shared libraries)
 *   modules/*            -> domain-module   (domain logic, FRANK-§6.1)
 *   adapters/*           -> adapter         (provider coupling lives here, FRANK-§6.5)
 *   apps/*               -> app             (composition roots, FRANK-§17.1)
 *   packs/* / packs/*­/*  -> pack            (composition of modules + config, FRANK-§6.10)
 *   tools/*              -> tool            (repo tooling)
 *
 * Rules enforced (rule id -> FRANK-§17.2 bullet):
 *
 *   contracts-import-nothing   packages/contracts may import nothing from the workspace.
 *   apps-not-another-app       "Apps depend on modules and shared packages, never another app's internals."
 *   module-no-provider-sdk     "Domain modules do not import provider SDKs."  (denylist in provider-sdks.json)
 *   pack-no-app-or-core        "Packs compose modules and configuration; they do not fork core code."
 *   layer-direction            general allowed-layer matrix for everything else.
 *   declared-may-depend-on     package.json `frank.mayDependOn` allowlist, when present.
 *   cross-package-relative     a relative import that escapes its own package (import by name instead).
 *   circular-dependency        "Circular dependencies fail continuous integration."
 *
 * Usage:
 *   node tools/lint/dependency-direction.mjs [--root <repoRoot>] [--json] [--verbose]
 *
 * Exit codes: 0 = clean, 1 = at least one violation, 2 = tool/usage error.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
const DENYLIST_FILE = path.join(HERE, 'provider-sdks.json');

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs']); // per FRANK Slice 0 scope
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.turbo',
  '.next',
  '.git',
  'coverage',
  '.venv',
  '__pycache__',
]);

/* ------------------------------------------------------------- layer map --- */

/** Ordered longest-prefix-first so `packages/contracts` wins over `packages`. */
const LAYER_RULES = [
  { prefix: ['packages', 'contracts'], layer: 'contracts' },
  { prefix: ['packages'], layer: 'packages' },
  { prefix: ['modules'], layer: 'domain-module' },
  { prefix: ['adapters'], layer: 'adapter' },
  { prefix: ['apps'], layer: 'app' },
  { prefix: ['packs'], layer: 'pack' },
  { prefix: ['tools'], layer: 'tool' },
];

/**
 * Allowed import targets per layer. A layer never needs itself listed for
 * self-imports (a package may always import its own files); listing a layer
 * means "may import a *different* package in that layer".
 */
const LAYER_ALLOW = {
  // FRANK-§6: contracts are frozen and stand alone.
  contracts: [],
  // Shared libraries may build on contracts and on each other.
  packages: ['contracts', 'packages'],
  // FRANK-§17.2: modules use contracts + shared packages, and may reference
  // sibling modules' declared domain services. They may not reach adapters,
  // apps, or packs.
  'domain-module': ['contracts', 'packages', 'domain-module'],
  // FRANK-§17.2: "Adapters implement contracts declared in packages/contracts."
  // An adapter must not depend on domain modules, apps, or packs.
  adapter: ['contracts', 'packages'],
  // FRANK-§17.2: "Apps depend on modules and shared packages, never another
  // app's internals." Apps are composition roots so they may wire adapters and
  // enable packs.
  app: ['contracts', 'packages', 'domain-module', 'adapter', 'pack'],
  // FRANK-§17.2: "Packs compose modules and configuration; they do not fork
  // core code." No app internals, no adapter internals.
  pack: ['contracts', 'packages', 'domain-module'],
  // Repo tooling may look at anything.
  tool: ['contracts', 'packages', 'domain-module', 'adapter', 'app', 'pack', 'tool'],
};

/** Rule id used when a specific FRANK-§17.2 bullet names the violation. */
function specificRule(fromLayer, toLayer) {
  if (fromLayer === 'contracts') {
    return {
      id: 'contracts-import-nothing',
      spec: 'FRANK-§6 / FRANK-§17.2',
      why: 'packages/contracts is the frozen contract surface and may not import any workspace package',
    };
  }
  if (fromLayer === 'app' && toLayer === 'app') {
    return {
      id: 'apps-not-another-app',
      spec: 'FRANK-§17.2',
      why: "apps depend on modules and shared packages, never another app's internals",
    };
  }
  if (fromLayer === 'pack' && (toLayer === 'app' || toLayer === 'adapter' || toLayer === 'pack')) {
    return {
      id: 'pack-no-app-or-core',
      spec: 'FRANK-§17.2 / FRANK-§6.10',
      why: 'packs compose modules and configuration; they do not import app internals or fork core code',
    };
  }
  return {
    id: 'layer-direction',
    spec: 'FRANK-§17.2',
    why: `layer "${fromLayer}" may only import [${LAYER_ALLOW[fromLayer].join(', ') || 'nothing'}]`,
  };
}

/* -------------------------------------------------------------------- cli --- */

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, json: false, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      if (!argv[i + 1]) toolError('--root requires a path');
      opts.root = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      opts.root = path.resolve(arg.slice('--root='.length));
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: dependency-direction.mjs [--root <repoRoot>] [--json] [--verbose]\n'
      );
      process.exit(0);
    } else {
      toolError(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function toolError(message) {
  process.stderr.write(`dependency-direction: ${message}\n`);
  process.exit(2);
}

/* ------------------------------------------------------- workspace discovery */

/**
 * Minimal reader for the `packages:` list in pnpm-workspace.yaml. We only need a
 * top-level sequence of scalars, so a full YAML parser would be a new core
 * dependency for no benefit (FRANK-§0.2).
 */
function parseWorkspaceGlobs(yamlText) {
  const globs = [];
  let inPackages = false;
  for (const rawLine of yamlText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      const inline = line.slice(line.indexOf(':') + 1).trim();
      if (inline.startsWith('[')) {
        for (const part of inline.replace(/^\[|\]$/g, '').split(',')) {
          const value = part.trim().replace(/^["']|["']$/g, '');
          if (value) globs.push(value);
        }
        inPackages = false;
      }
      continue;
    }
    if (inPackages) {
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (item) {
        globs.push(item[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }
      if (/^\S/.test(line)) inPackages = false; // next top-level key
    }
  }
  return globs;
}

/** Expand a workspace glob (only `*` / `**` path segments) into directories. */
async function expandGlob(root, glob) {
  const segments = glob.split('/').filter((s) => s.length > 0 && s !== '.');
  let current = [root];
  for (const segment of segments) {
    const next = [];
    for (const dir of current) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (segment === '*' || segment === '**' || segment === entry.name) {
          next.push(path.join(dir, entry.name));
        }
      }
    }
    current = next;
  }
  return current;
}

function layerForDir(root, dir) {
  const rel = path.relative(root, dir).split(path.sep);
  for (const rule of LAYER_RULES) {
    if (rule.prefix.every((seg, i) => rel[i] === seg)) return rule.layer;
  }
  return null;
}

async function discoverPackages(root) {
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) toolError(`no pnpm-workspace.yaml at ${workspaceFile}`);
  const globs = parseWorkspaceGlobs(await readFile(workspaceFile, 'utf8'));
  if (globs.length === 0) toolError('pnpm-workspace.yaml declares no packages');

  /** @type {Map<string, any>} name -> pkg */
  const byName = new Map();
  /** @type {any[]} */
  const list = [];
  const seenDirs = new Set();

  for (const glob of globs) {
    for (const dir of await expandGlob(root, glob)) {
      if (seenDirs.has(dir)) continue;
      const manifestPath = path.join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      seenDirs.add(dir);

      const raw = await readFile(manifestPath, 'utf8');
      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch (error) {
        toolError(`${path.relative(root, manifestPath)}: invalid JSON (${error.message})`);
      }
      const layer = layerForDir(root, dir);
      if (!layer) {
        toolError(
          `${path.relative(root, dir)} matched workspace glob "${glob}" but sits in no known layer directory. ` +
            `Known layer roots: ${LAYER_RULES.map((r) => r.prefix.join('/')).join(', ')} (FRANK-§17.1).`
        );
      }
      const pkg = {
        name: manifest.name ?? path.relative(root, dir),
        dir,
        rel: path.relative(root, dir),
        manifestPath,
        manifestRaw: raw,
        manifest,
        layer,
        mayDependOn: Array.isArray(manifest?.frank?.mayDependOn)
          ? manifest.frank.mayDependOn
          : null,
        declaredLayer: manifest?.frank?.layer ?? null,
      };
      if (byName.has(pkg.name)) {
        toolError(
          `duplicate workspace package name "${pkg.name}" in ${byName.get(pkg.name).rel} and ${pkg.rel}`
        );
      }
      byName.set(pkg.name, pkg);
      list.push(pkg);
    }
  }
  // Longest dir first so nested packages (packs/*/*) win the ownership lookup.
  list.sort((a, b) => b.dir.length - a.dir.length);
  return { list, byName };
}

/* ------------------------------------------------------------ source scan --- */

async function collectSourceFiles(dir) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
      }
    }
  }
  await walk(dir);
  files.sort();
  return files;
}

/**
 * Blank out comments while preserving byte offsets (so line numbers stay exact).
 * Tracks quotes and template literals so `//` inside a string is not treated as
 * a comment. Regex literals are not tracked; the worst case is a missed import
 * inside a regex literal, which cannot be a real import anyway.
 */
function blankComments(source) {
  const out = source.split('');
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        if (quote !== '`' && source[i] === '\n') break;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function lineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineForOffset(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const IMPORT_PATTERNS = [
  // import x from 'y' / import type {A} from 'y' / import 'y'
  { kind: 'import', re: /\bimport\s+(?:type\s+)?(?:[\w${}*,\s[\]]+?\s+from\s+)?(['"])([^'"\n]+)\1/g, group: 2 },
  // export * from 'y' / export { a } from 'y'
  { kind: 'export-from', re: /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+(['"])([^'"\n]+)\1/g, group: 2 },
  // import('y')
  { kind: 'dynamic-import', re: /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, group: 2 },
  // require('y') — ESM-only repo, but a stray CJS require must not evade the gate
  { kind: 'require', re: /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, group: 2 },
];

function extractImports(source) {
  const scrubbed = blankComments(source);
  const starts = lineIndex(source);
  /** @type {Map<string, {specifier: string, line: number, kind: string}>} */
  const found = new Map();
  for (const { kind, re, group } of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(scrubbed)) !== null) {
      const specifier = match[group];
      if (!specifier) continue;
      const line = lineForOffset(starts, match.index);
      const key = `${line}:${specifier}`;
      if (!found.has(key)) found.set(key, { specifier, line, kind });
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

/* --------------------------------------------------------- specifier tools --- */

/** `@scope/name/sub/path` -> `@scope/name`; `name/sub` -> `name`. */
function barePackageName(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

function matchesDenyEntry(entry, packageName, specifier) {
  if (entry === packageName || entry === specifier) return true;
  if (entry.endsWith('/*')) {
    const prefix = entry.slice(0, -1); // keep trailing slash
    return packageName.startsWith(prefix) || specifier.startsWith(prefix);
  }
  return false;
}

/** Find the workspace package that owns an absolute path. */
function ownerOfPath(packages, absPath) {
  for (const pkg of packages) {
    if (absPath === pkg.dir || absPath.startsWith(pkg.dir + path.sep)) return pkg;
  }
  return null;
}

/* ------------------------------------------------------------------- main --- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root;

  if (!existsSync(DENYLIST_FILE)) toolError(`missing denylist file ${DENYLIST_FILE}`);
  let denyConfig;
  try {
    denyConfig = JSON.parse(await readFile(DENYLIST_FILE, 'utf8'));
  } catch (error) {
    toolError(`provider-sdks.json: invalid JSON (${error.message})`);
  }
  const denyPackages = Array.isArray(denyConfig.packages) ? denyConfig.packages : [];
  const deniedLayers = new Set(
    Array.isArray(denyConfig.deniedLayers) ? denyConfig.deniedLayers : ['domain-module']
  );

  const { list: packages, byName } = await discoverPackages(root);

  /** @type {Array<{file: string, line: number|null, specifier: string, rule: string, spec: string, message: string}>} */
  const violations = [];
  const addViolation = (v) => violations.push(v);

  /** @type {Map<string, Set<string>>} package name -> imported package names */
  const graph = new Map();
  for (const pkg of packages) graph.set(pkg.name, new Set());

  let scannedFiles = 0;
  let scannedImports = 0;

  /** Shared check for one resolved edge. */
  function checkEdge(fromPkg, toPkg, file, line, specifier, viaLabel) {
    if (toPkg.name === fromPkg.name) return;
    graph.get(fromPkg.name).add(toPkg.name);

    const allowed = LAYER_ALLOW[fromPkg.layer] ?? [];
    if (!allowed.includes(toPkg.layer)) {
      const rule = specificRule(fromPkg.layer, toPkg.layer);
      addViolation({
        file,
        line,
        specifier,
        rule: rule.id,
        spec: rule.spec,
        message:
          `${fromPkg.rel} (layer "${fromPkg.layer}") ${viaLabel} ${toPkg.rel} (layer "${toPkg.layer}"): ${rule.why}`,
      });
      return;
    }

    if (fromPkg.mayDependOn) {
      const permitted =
        fromPkg.mayDependOn.includes(toPkg.name) || fromPkg.mayDependOn.includes(toPkg.layer);
      if (!permitted) {
        addViolation({
          file,
          line,
          specifier,
          rule: 'declared-may-depend-on',
          spec: 'FRANK-§6.1 / FRANK-§17.2',
          message:
            `${fromPkg.rel} declares frank.mayDependOn = [${fromPkg.mayDependOn.join(', ') || 'nothing'}] ` +
            `but ${viaLabel} ${toPkg.rel} (${toPkg.name})`,
        });
      }
    }
  }

  for (const pkg of packages) {
    /* ---- declared manifest layer must agree with directory layer ---------- */
    if (pkg.declaredLayer && pkg.declaredLayer !== pkg.layer) {
      addViolation({
        file: path.relative(root, pkg.manifestPath),
        line: findLine(pkg.manifestRaw, '"layer"'),
        specifier: pkg.declaredLayer,
        rule: 'declared-layer-mismatch',
        spec: 'FRANK-§17.1',
        message: `package.json declares frank.layer "${pkg.declaredLayer}" but ${pkg.rel} sits in layer "${pkg.layer}"`,
      });
    }

    /* ---- declared workspace dependencies ---------------------------------- */
    const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const field of depFields) {
      const deps = pkg.manifest[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const depName of Object.keys(deps)) {
        const target = byName.get(depName);
        const manifestRel = path.relative(root, pkg.manifestPath);
        const line = findLine(pkg.manifestRaw, `"${depName}"`);
        if (target) {
          checkEdge(pkg, target, manifestRel, line, depName, `declares a ${field} on`);
          continue;
        }
        // external dependency: provider SDK gate
        if (deniedLayers.has(pkg.layer) && field !== 'devDependencies') {
          const base = barePackageName(depName);
          const hit = denyPackages.find((e) => matchesDenyEntry(e, base, depName));
          if (hit) {
            addViolation({
              file: manifestRel,
              line,
              specifier: depName,
              rule: 'module-no-provider-sdk',
              spec: 'FRANK-§17.2',
              message:
                `${pkg.rel} (layer "${pkg.layer}") declares a ${field} on provider SDK "${depName}" (denylist entry "${hit}"). ` +
                `Domain modules do not import provider SDKs — put it behind an adapter in adapters/*.`,
            });
          }
        }
      }
    }

    /* ---- source imports ---------------------------------------------------- */
    const files = await collectSourceFiles(pkg.dir);
    for (const file of files) {
      const owner = ownerOfPath(packages, file);
      if (!owner || owner.name !== pkg.name) continue; // nested package owns it
      scannedFiles += 1;
      const source = await readFile(file, 'utf8');
      const rel = path.relative(root, file);
      for (const { specifier, line } of extractImports(source)) {
        scannedImports += 1;
        if (specifier.startsWith('node:') || specifier.startsWith('data:')) continue;

        /* relative / absolute path imports */
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          const resolved = specifier.startsWith('/')
            ? path.resolve(root, `.${specifier}`)
            : path.resolve(path.dirname(file), specifier);
          const target = ownerOfPath(packages, resolved);
          if (!target) continue; // outside any workspace package (e.g. repo-root config)
          if (target.name === pkg.name) continue; // inside own package: fine
          addViolation({
            file: rel,
            line,
            specifier,
            rule: 'cross-package-relative',
            spec: 'FRANK-§17.2',
            message:
              `relative import escapes ${pkg.rel} and reaches into ${target.rel}. ` +
              `Cross-package access must go through the package name (${target.name}) so the ` +
              `dependency is declared, versioned, and checkable.`,
          });
          checkEdge(pkg, target, rel, line, specifier, 'reaches into');
          continue;
        }

        /* bare specifier */
        const base = barePackageName(specifier);
        const target = byName.get(base) ?? byName.get(specifier);
        if (target) {
          checkEdge(pkg, target, rel, line, specifier, 'imports');
          continue;
        }

        /* external package: provider SDK gate */
        if (deniedLayers.has(pkg.layer)) {
          const hit = denyPackages.find((e) => matchesDenyEntry(e, base, specifier));
          if (hit) {
            addViolation({
              file: rel,
              line,
              specifier,
              rule: 'module-no-provider-sdk',
              spec: 'FRANK-§17.2',
              message:
                `${pkg.rel} (layer "${pkg.layer}") imports provider SDK "${specifier}" (denylist entry "${hit}"). ` +
                `Domain modules do not import provider SDKs — put it behind an adapter in adapters/* ` +
                `that implements a contract from packages/contracts.`,
            });
          }
        }
      }
    }
  }

  /* ---- circular dependencies --------------------------------------------- */
  for (const cycle of findCycles(graph)) {
    const first = byName.get(cycle[0]);
    addViolation({
      file: first ? path.relative(root, first.manifestPath) : cycle[0],
      line: null,
      specifier: cycle.join(' -> '),
      rule: 'circular-dependency',
      spec: 'FRANK-§17.2',
      message: `circular dependency between workspace packages: ${cycle.join(' -> ')}`,
    });
  }

  /* ---- report ------------------------------------------------------------- */
  const summary = {
    ok: violations.length === 0,
    packages: packages.length,
    files: scannedFiles,
    imports: scannedImports,
    violations,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    process.stdout.write(
      `dependency direction OK: ${packages.length} workspace package(s), ` +
        `${scannedFiles} source file(s), ${scannedImports} import(s) checked (FRANK-§17.2).\n`
    );
    if (opts.verbose) {
      for (const pkg of [...packages].sort((a, b) => a.rel.localeCompare(b.rel))) {
        const edges = [...(graph.get(pkg.name) ?? [])].sort();
        process.stdout.write(
          `  ${pkg.rel.padEnd(34)} layer=${pkg.layer.padEnd(14)} -> ${edges.join(', ') || '(none)'}\n`
        );
      }
    }
    process.exit(0);
  }

  process.stderr.write(
    `\nDEPENDENCY DIRECTION FAILED: ${violations.length} violation(s) (FRANK-§17.2, FRANK-§18.1 static gate)\n\n`
  );
  const byRule = new Map();
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }
  for (const [rule, items] of [...byRule].sort()) {
    process.stderr.write(`  [${rule}]  ${items[0].spec}  (${items.length})\n`);
    for (const v of items) {
      const where = v.line === null ? v.file : `${v.file}:${v.line}`;
      process.stderr.write(`    ${where}\n`);
      process.stderr.write(`      specifier: ${v.specifier}\n`);
      process.stderr.write(`      ${v.message}\n`);
    }
    process.stderr.write('\n');
  }
  process.stderr.write(
    `${violations.length} violation(s) across ${packages.length} workspace package(s) / ${scannedFiles} source file(s).\n`
  );
  process.exit(1);
}

/** 1-based line of the first occurrence of `needle`, or null. */
function findLine(text, needle) {
  const idx = text.indexOf(needle);
  if (idx === -1) return null;
  return text.slice(0, idx).split('\n').length;
}

/** Iterative Tarjan-free DFS cycle enumeration; returns each cycle once. */
function findCycles(graph) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const node of graph.keys()) color.set(node, WHITE);
  const cycles = [];
  const seen = new Set();
  const stack = [];

  function visit(node) {
    color.set(node, GREY);
    stack.push(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (!graph.has(next)) continue;
      const c = color.get(next);
      if (c === GREY) {
        const start = stack.indexOf(next);
        const cycle = stack.slice(start).concat(next);
        // canonical key: rotate so the smallest name is first
        const bare = cycle.slice(0, -1);
        const min = bare.indexOf([...bare].sort()[0]);
        const rotated = bare.slice(min).concat(bare.slice(0, min));
        const key = rotated.join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(rotated.concat(rotated[0]));
        }
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of [...graph.keys()].sort()) {
    if (color.get(node) === WHITE) visit(node);
  }
  return cycles;
}

main().catch((error) => {
  process.stderr.write(`dependency-direction: unexpected error\n${error?.stack ?? error}\n`);
  process.exit(2);
});
