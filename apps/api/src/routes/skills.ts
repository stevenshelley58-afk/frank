/**
 * `GET /v1/skills` + `GET /v1/skills/:id` — W3-2, the Skills page.
 *
 * Lists every skill the running Hermes can see: one entry per directory that
 * contains a `SKILL.md`, with the name (folder name), the description
 * (frontmatter, parsed with `gray-matter` — never a hand-rolled parser), and
 * the rendered-markdown source fetched on demand.
 *
 * ## Read-only, by construction
 *
 * This route only ever opens files for reading, and only `SKILL.md` files at
 * that. The skill library is Hermes' own store
 * (`C:\Users\steve\AppData\Local\hermes\skills`), and writing to it is
 * forbidden in this task — nothing in this module writes.
 *
 * ## Path safety
 *
 * A skill id must resolve *inside* the skills root. Three independent checks:
 *
 *   1. the id must match `SKILL_PATH_PATTERN` — no leading slash, no `..`
 *      segment (a segment cannot start with `.`), no backslashes, no drive
 *      letters, no empty segments;
 *   2. the candidate is resolved against the **realpath** of the root, so a
 *      `..`-free id that would still escape through a symlink is caught by
 *      realpath containment (`pathIsWithin` on the canonical paths);
 *   3. the `SKILL.md` itself is realpath'd and must stay inside the root, so
 *      a symlinked `SKILL.md` pointing outside is refused too.
 *
 * This mirrors the containment discipline of `routes/codegraph.ts`
 * (`pathIsWithin` + realpath), which is the same problem class.
 *
 * ## Malformed frontmatter is data, not a crash
 *
 * A skill whose `SKILL.md` has unparseable YAML still appears in the list and
 * still opens — with a `frontmatter_error` field describing the problem and
 * the raw text as `content` — instead of taking the whole page down with a
 * 500. `gray-matter` throws on invalid YAML inside a closed fence; that throw
 * is caught here and converted into the field.
 *
 * ## The list never reads whole files
 *
 * The library is big (many folders). The list reads only the first
 * `MAX_SKILL_HEAD_BYTES` of each `SKILL.md` — frontmatter lives at the top —
 * and the full file is fetched only by the detail paths (`?path=` or `:id`),
 * capped at `MAX_SKILL_BYTES`.
 */

import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import matter from 'gray-matter';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { identifiersOf } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';

/**
 * The Hermes skill library on this machine. `FRANK_SKILLS_ROOT` overrides it
 * (tests point at a tiny fixture directory). In a deployment where Frank and
 * Hermes are not colocated, set `FRANK_SKILLS_ROOT` to the mounted library.
 */
const DEFAULT_SKILLS_ROOT = 'C:\\Users\\steve\\AppData\\Local\\hermes\\skills';

/** List reads stop after this many bytes — frontmatter is at the top. */
const MAX_SKILL_HEAD_BYTES = 8 * 1024;
/** Detail content cap. A SKILL.md beyond this is refused, not truncated. */
const MAX_SKILL_BYTES = 1024 * 1024;
/** Root (0) + up to three nesting levels: root/category/subcategory/name. */
const MAX_SKILL_DEPTH = 3;
/** The one file that makes a directory a skill. */
const SKILL_FILE = 'SKILL.md';
/** Bounded, relative skill ids: `creative/ascii-art`, `hello-world`, … */
const SKILL_PATH_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

/* ---------------------------------------------------------------- schemas --- */

const skillSummarySchema = z
  .object({
    /** Relative path from the skills root; the stable identity. */
    id: z.string().min(1).max(200),
    /** Folder name (the leaf segment of `path`). */
    name: z.string().min(1).max(160),
    /** Frontmatter `description`, or the first paragraph of the body. */
    description: z.string().max(500),
    /** Relative path from the skills root (same value as `id`). */
    path: z.string().min(1).max(200),
    /** Non-null when the SKILL.md frontmatter could not be parsed. */
    frontmatter_error: z.string().max(500).nullable(),
  })
  .strict();

const skillsListResponseSchema = z
  .object({
    skills: z.array(skillSummarySchema).max(1000),
    total: z.number().int().nonnegative(),
    identifiers: identifiersSchema,
  })
  .strict();

const skillDetailResponseSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(160),
    description: z.string().max(500),
    path: z.string().min(1).max(200),
    /** The SKILL.md body (frontmatter stripped) when it parses; raw text otherwise. */
    content: z.string().max(MAX_SKILL_BYTES),
    frontmatter_error: z.string().max(500).nullable(),
    identifiers: identifiersSchema,
  })
  .strict();

/**
 * The packet contract: `GET /v1/skills` is the list, and adding `?path=`
 * asks for one skill's SKILL.md — the response then carries `content`.
 * Both shapes are declared; the handler returns the matching one.
 */
const skillsResponseSchema = z.union([skillsListResponseSchema, skillDetailResponseSchema]);

const skillsQuerySchema = z
  .object({
    /** One skill's relative path; when present the response is that skill's detail. */
    path: z.string().min(1).max(200).optional(),
  })
  .strict();

const skillIdParamsSchema = z
  .object({
    /** A skill's relative path, single URL segment (slash-encoded). */
    id: z.string().min(1).max(200),
  })
  .strict();

/* ---------------------------------------------------------------- routes --- */

const READER_ROLES = ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'] as const;
const SKILL_ERRORS = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'rate_limited',
  'service_unavailable',
  'internal_error',
] as const;

export const skillsListRoute = defineRoute({
  operationId: 'skillsList',
  method: 'GET',
  path: '/v1/skills',
  group: '/v1/skills',
  summary: 'List skills in the Hermes skill library',
  description:
    'Every skill directory under the skills root (FRANK_SKILLS_ROOT, defaulting to the Hermes library). ' +
    'Each entry carries the folder name and the frontmatter description; malformed frontmatter surfaces as a per-skill `frontmatter_error`, never a crash. ' +
    'Pass `?path=<relative path>` to fetch one skill\'s SKILL.md content instead of the list.',
  actorRoles: READER_ROLES,
  // Skills are shared memory (§8.3) — the read surface is the brain catalogue.
  capability: 'brain.search.read',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'brain.search.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: SKILL_ERRORS,
  rateLimit: { requestsPerMinute: 300, burst: 30 },
  auditObligations: [],
  query: skillsQuerySchema,
  response: skillsResponseSchema,
  successStatus: 200,
});

export const skillsDetailRoute = defineRoute({
  operationId: 'skillsDetail',
  method: 'GET',
  path: '/v1/skills/:id',
  group: '/v1/skills',
  summary: 'Get one skill\u2019s rendered-markdown source',
  description:
    'One skill\u2019s SKILL.md content, ready for client-side markdown rendering. ' +
    'The id is the skill\u2019s relative path (single URL segment; slash-encode multi-segment paths, or use `GET /v1/skills?path=`). ' +
    'Malformed frontmatter returns the raw text plus a `frontmatter_error`, not a 500.',
  actorRoles: READER_ROLES,
  capability: 'brain.search.read',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'brain.search.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: SKILL_ERRORS,
  rateLimit: { requestsPerMinute: 300, burst: 30 },
  auditObligations: [],
  params: skillIdParamsSchema,
  response: skillDetailResponseSchema,
  successStatus: 200,
});

export const skillRoutes = [skillsListRoute, skillsDetailRoute];

/* ------------------------------------------------------------ filesystem --- */

function skillsRoot(): string {
  return process.env.FRANK_SKILLS_ROOT ?? DEFAULT_SKILLS_ROOT;
}

/**
 * True when `child` resolves inside `parent`. Case-insensitive on Windows:
 * `relative()` is pure string math, and realpath can canonicalise the common
 * prefix to a different case than the caller wrote.
 */
function pathIsWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  const normalized = process.platform === 'win32' ? rel.toLowerCase() : rel;
  return normalized !== '..' && !normalized.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Relative path from the root, with forward slashes on every platform. */
function relativeId(root: string, child: string): string {
  return relative(root, child).split(sep).join('/');
}

async function readHead(file: string, maximumBytes: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(maximumBytes);
    const { bytesRead } = await handle.read(buffer, 0, maximumBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** The canonical root, or a 503 when it is missing/unreadable. */
async function requireRoot(): Promise<string> {
  try {
    const root = await realpath(skillsRoot());
    const info = await stat(root);
    if (!info.isDirectory()) {
      throw new ProblemError('service_unavailable', 'The skills root is not a directory.');
    }
    return root;
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ProblemError('service_unavailable', 'The skills library is not available.');
    }
    throw new ProblemError('service_unavailable', 'The skills library could not be read.');
  }
}

/** The one-liner description: frontmatter `description`, else first paragraph. */
function descriptionOf(data: Record<string, unknown>, body: string): string {
  const explicit = data.description;
  if (typeof explicit === 'string') {
    const cleaned = explicit.replace(/[\r\n\t]+/g, ' ').trim();
    if (cleaned.length > 0) return cleaned.slice(0, 500);
  }
  return firstParagraph(body);
}

function firstParagraph(text: string): string {
  const sentences: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (sentences.length > 0) break;
      continue;
    }
    // Headings and horizontal rules are structure, not description.
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^[-*_]{3,}$/.test(trimmed)) continue;
    sentences.push(trimmed);
    if (sentences.length >= 3) break;
  }
  return sentences.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** A parsed head: the frontmatter data plus whatever preceded the parse error. */
type ParsedSkill = {
  readonly name: string;
  readonly description: string;
  readonly frontmatterError: string | null;
  /** Body with frontmatter stripped; raw text when the frontmatter threw. */
  readonly body: string;
};

/**
 * Parse one SKILL.md with gray-matter. A parse failure (invalid YAML inside a
 * closed fence) is a field, not an exception — the skill still appears.
 *
 * `{}` is passed on purpose: gray-matter caches results by content string,
 * storing the file object *before* parsing, so a YAML exception leaves a
 * poisoned cache entry and the next identical parse silently returns
 * unparsed data. The options argument bypasses that cache entirely.
 */
function parseSkillFile(raw: string, name: string): ParsedSkill {
  try {
    const parsed = matter(raw, {});
    return {
      name,
      description: descriptionOf((parsed.data ?? {}) as Record<string, unknown>, parsed.content),
      frontmatterError: null,
      body: parsed.content,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid frontmatter';
    return {
      name,
      description: firstParagraph(raw),
      frontmatterError: message.slice(0, 500),
      body: raw,
    };
  }
}

/** One skill directory, resolved and proven to sit inside the root. */
type ResolvedSkill = {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly dir: string;
  readonly file: string;
};

/**
 * Resolve a validated id to its real SKILL.md. Throws `not_found` when the
 * skill does not exist and `validation_failed` when the id could not have
 * been a skill id in the first place.
 */
async function resolveSkill(id: string): Promise<ResolvedSkill> {
  if (!SKILL_PATH_PATTERN.test(id)) {
    throw new ProblemError(
      'validation_failed',
      'Skill ids are relative paths inside the skills root: no leading slash, no `..`, no drive letters.',
    );
  }
  const root = await requireRoot();
  const candidate = resolve(root, id);
  let dir: string;
  try {
    dir = await realpath(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ProblemError('not_found', 'No skill exists at that path.');
    }
    throw new ProblemError('service_unavailable', 'The skills library could not be read.');
  }
  if (dir === root || !pathIsWithin(dir, root)) {
    throw new ProblemError('not_found', 'No skill exists at that path.');
  }
  let file: string;
  try {
    file = await realpath(join(dir, SKILL_FILE));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ProblemError('not_found', 'That directory is not a skill: it has no SKILL.md.');
    }
    throw new ProblemError('service_unavailable', 'The skills library could not be read.');
  }
  if (!pathIsWithin(file, root) || file === dir) {
    throw new ProblemError('not_found', 'No skill exists at that path.');
  }
  return {
    id: relativeId(root, dir),
    name: relativeId(root, dir).split('/').pop() as string,
    root,
    dir,
    file,
  };
}

/** The detail payload: content + metadata, for both detail accessors. */
async function skillDetailOf(id: string): Promise<{
  id: string;
  name: string;
  description: string;
  path: string;
  content: string;
  frontmatter_error: string | null;
}> {
  const skill = await resolveSkill(id);
  let size: number;
  try {
    size = (await stat(skill.file)).size;
  } catch {
    throw new ProblemError('not_found', 'No skill exists at that path.');
  }
  if (size > MAX_SKILL_BYTES) {
    throw new ProblemError('service_unavailable', 'The skill file is too large to read.');
  }
  const raw = await readFile(skill.file, 'utf8');
  const parsed = parseSkillFile(raw, skill.name);
  return {
    id: skill.id,
    name: skill.name,
    description: parsed.description,
    path: skill.id,
    content: parsed.body,
    frontmatter_error: parsed.frontmatterError,
  };
}

/** Walk the library (bounded depth) collecting every SKILL.md directory. */
async function listSkillSummaries(): Promise<
  Array<{ id: string; name: string; description: string; path: string; frontmatter_error: string | null }>
> {
  const root = await requireRoot();
  const seen = new Set<string>();
  const summaries: Array<{
    id: string;
    name: string;
    description: string;
    path: string;
    frontmatter_error: string | null;
  }> = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_SKILL_DEPTH) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return; // An unreadable subtree is not a skill; skip it quietly.
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const candidate = join(directory, entry.name);
      let real: string;
      try {
        real = await realpath(candidate);
      } catch {
        continue; // A broken link is not a skill.
      }
      if (real === root || !pathIsWithin(real, root)) continue;
      let file: string;
      try {
        file = await realpath(join(real, SKILL_FILE));
      } catch {
        await walk(real, depth + 1); // A category/subcategory: descend.
        continue;
      }
      if (!pathIsWithin(file, root)) continue;
      const id = relativeId(root, real);
      if (seen.has(id)) continue;
      seen.add(id);
      const name = id.split('/').pop() as string;
      try {
        const head = await readHead(file, MAX_SKILL_HEAD_BYTES);
        const parsed = parseSkillFile(head, name);
        summaries.push({
          id,
          name: parsed.name,
          description: parsed.description,
          path: id,
          frontmatter_error: parsed.frontmatterError,
        });
      } catch {
        // Unreadable SKILL.md — list it without metadata rather than dropping
        // the skill from the page (the detail call will explain itself).
        summaries.push({ id, name, description: '', path: id, frontmatter_error: 'SKILL.md could not be read.' });
      }
    }
  };

  await walk(root, 0);
  return summaries.sort((left, right) => left.id.localeCompare(right.id));
}

/* ------------------------------------------------------------- handlers --- */

export function registerSkillRoutes(
  app: FastifyInstance,
  dependencies: RouteHandlerDependencies,
): void {
  registerRoute(app, dependencies, skillsListRoute, async ({ query, context }) => {
    if (query.path !== undefined) {
      // Packet contract: `?path=` asks for one skill's SKILL.md.
      const detail = await skillDetailOf(query.path);
      return { ...detail, identifiers: identifiersOf(context) };
    }
    const skills = await listSkillSummaries();
    return { skills, total: skills.length, identifiers: identifiersOf(context) };
  });

  registerRoute(app, dependencies, skillsDetailRoute, async ({ params, context }) => {
    const detail = await skillDetailOf(params.id);
    return { ...detail, identifiers: identifiersOf(context) };
  });
}
