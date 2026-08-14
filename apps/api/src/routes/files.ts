/**
 * `/v1/files` — a read-only browser over the projects root.
 *
 * The owner cannot use a terminal, so this one endpoint is how he reads
 * project files: a directory resolves to a bounded listing, a file resolves
 * to its text content. There is no write, upload, rename, or delete — the
 * filesystem is a read-only dependency of this route.
 *
 * ## The trust boundary (FRANK-§15.1 reconnaissance, FRANK-§17.3)
 *
 * The requested path is resolved against `FRANK_FILES_ROOT` (default
 * `C:/Dev`; the parent of this repository) and refused when it escapes that
 * root, in four independent layers so no single mistake opens the box:
 *
 *   1. **Segment check.** Any `..` segment (on either separator) is refused
 *      before path resolution, so `C:/Dev/../Windows` and `frank/../..`
 *      never reach the resolver.
 *   2. **Windows colon tricks.** The only colon a Windows path may carry is
 *      its drive letter's; an NTFS alternate data stream (`file.txt:secret`)
 *      or a drive-relative path is refused. This layer is Windows-only.
 *   3. **Lexical containment.** `resolve(root, requested)` must stay inside
 *      the root (or the root's real path) as a string prefix, so an absolute
 *      path on another drive or under another tree is refused before any
 *      filesystem call — deterministically, even when the target does not
 *      exist.
 *   4. **Real-path containment.** The target is `realpath`'d — following
 *      every symlink — and must still be inside the `realpath`'d root. A
 *      symlink inside the root that points outside it is refused.
 *
 * Layer 4 is the one the specification insists on: "a root-escape check on
 * the REAL path (not the raw string)".
 *
 * ## What is never returned
 *
 * `.env` files (and `.env.*` variants) and anything whose name contains
 * `secret`, `key`, or `token` are refused with 403 and, when they appear as
 * directory entries, are not even named in listings. Files over 2 MB and
 * files containing NUL bytes (binary) are refused rather than mangled.
 *
 * ## Capability note
 *
 * The identity matrix (`@frank/identity` `ROLE_CAPABILITIES`) has no
 * `files.read` row yet, so this route reuses `codegraph.read` — the closest
 * existing capability, with the same audience (owner/operator/builder read
 * project internals) and the same reconnaissance classification. When the
 * matrix grows a `files.read` row, this declaration changes in one place.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { identifiersOf } from '../context.js';
import type { RequestContext } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_PATH_LENGTH = 4096;

const filesQuerySchema = z
  .object({ path: z.string().min(1).max(MAX_PATH_LENGTH).optional() })
  .strict();

const fileEntrySchema = z
  .object({
    name: z.string().min(1).max(255),
    kind: z.enum(['file', 'dir']),
    size: z.number().int().nonnegative(),
  })
  .strict();

const directoryResponseSchema = z
  .object({
    kind: z.literal('dir'),
    /** Resolved absolute path — safe to re-send as `?path=` for children. */
    path: z.string().min(1).max(MAX_PATH_LENGTH),
    entries: z.array(fileEntrySchema).max(MAX_ENTRIES),
    /** True when `entries` was capped at MAX_ENTRIES. */
    truncated: z.boolean(),
    identifiers: identifiersSchema,
  })
  .strict();

const fileResponseSchema = z
  .object({
    kind: z.literal('file'),
    /** Resolved absolute path — what the client asked for. */
    path: z.string().min(1).max(MAX_PATH_LENGTH),
    name: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
    content: z.string(),
    identifiers: identifiersSchema,
  })
  .strict();

const filesResponseSchema = z.discriminatedUnion('kind', [
  directoryResponseSchema,
  fileResponseSchema,
]);

const READERS = ['owner', 'operator', 'builder', 'service_identity'] as const;

export const filesReadRoute = defineRoute({
  operationId: 'filesRead',
  method: 'GET',
  path: '/v1/files',
  group: '/v1/files',
  summary: 'Browse a directory or read a file under the projects root',
  description:
    'Read-only. A directory resolves to a bounded listing (name, kind, size); a file resolves to its text content ' +
    '(up to 2 MB). Paths are resolved against FRANK_FILES_ROOT (default C:/Dev) and refused when they escape it, ' +
    'traverse with `..`, carry a Windows alternate-data-stream colon, name a secret-bearing file, or point outside ' +
    'the root through a symlink.',
  actorRoles: READERS,
  // See the module comment: the identity matrix has no files.read row yet, so
  // the closest read capability is reused. Same audience, same classification.
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'not_found',
    'rate_limited',
    'service_unavailable',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 240, burst: 40 },
  auditObligations: [],
  query: filesQuerySchema,
  response: filesResponseSchema,
  successStatus: 200,
});

export const filesRoutes = [filesReadRoute];

export interface FilesRouteDependencies extends RouteHandlerDependencies {
  /** Test/operator override; production defaults to `FRANK_FILES_ROOT` or `C:/Dev`. */
  readonly filesRoot?: string;
}

export function registerFilesRoutes(
  app: FastifyInstance,
  dependencies: FilesRouteDependencies,
): void {
  registerRoute(app, dependencies, filesReadRoute, async ({ query, context }) => {
    const root = resolve(filesRootOf(dependencies));
    const requested = (query.path ?? '').trim();
    const targetRaw = requested.length === 0 ? root : resolve(root, requested);

    assertPathSyntaxSafe(requested);

    // The root's real path is the boundary. It is also resolved once per
    // request so a root that is itself a symlink (C:/Dev → D:/dev) still
    // defines containment physically.
    const rootReal = await realpathOrThrow(root);

    // Layer 3: lexical containment — catches absolute paths outside the root
    // deterministically (the target may not exist, but the refusal must).
    if (!isWithin(root, targetRaw) && !isWithin(rootReal, targetRaw)) {
      throw new ProblemError('forbidden', 'The requested path is outside the files root.');
    }

    // Secret names are refused before any filesystem call, so existence is
    // never disclosed for a path we would refuse anyway.
    if (isForbiddenName(basename(targetRaw))) {
      throw new ProblemError('forbidden', 'Files that may carry secrets are not readable.');
    }

    // Layer 4: real-path containment — the symlink escape check.
    let targetReal: string;
    try {
      targetReal = await realpath(targetRaw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ProblemError('not_found', 'No such file or directory under the files root.');
      }
      throw error;
    }
    if (isForbiddenName(basename(targetReal))) {
      throw new ProblemError('forbidden', 'Files that may carry secrets are not readable.');
    }
    if (!isWithin(rootReal, targetReal)) {
      throw new ProblemError('forbidden', 'The requested path resolves outside the files root.');
    }

    const entry = await stat(targetReal);

    if (entry.isDirectory()) {
      return await listDirectory(targetRaw, targetReal, context);
    }

    // Anything that is neither a regular file nor a directory (FIFO, socket,
    // device) is refused: reading it could block the request forever.
    if (!entry.isFile()) {
      throw new ProblemError('forbidden', 'Only regular files can be previewed.');
    }

    if (entry.size > MAX_FILE_BYTES) {
      throw new ProblemError(
        'forbidden',
        'This file is larger than the 2 MB preview limit and is not readable through the files browser.',
      );
    }

    const content = await readFile(targetReal, 'utf8');
    if (content.includes('\0')) {
      throw new ProblemError('forbidden', 'Binary files cannot be previewed.');
    }

    return {
      kind: 'file' as const,
      path: targetRaw,
      name: basename(targetReal),
      size: entry.size,
      content,
      identifiers: identifiersOf(context),
    };
  });
}

async function listDirectory(
  displayPath: string,
  realPath: string,
  context: RequestContext,
) {
  const names = await readdir(realPath);
  const entries: Array<{ name: string; kind: 'file' | 'dir'; size: number }> = [];
  let truncated = false;

  for (const name of names) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    // Secret-bearing entries are not even named; a listing that reveals
    // ".env exists here" is already a disclosure.
    if (isForbiddenName(name)) continue;

    let childStat;
    try {
      childStat = await stat(resolve(realPath, name));
    } catch {
      // Broken symlink or unreadable entry — skip it rather than leak an error.
      continue;
    }
    if (childStat.isDirectory()) {
      entries.push({ name, kind: 'dir', size: 0 });
    } else if (childStat.isFile()) {
      entries.push({ name, kind: 'file', size: childStat.size });
    }
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    kind: 'dir' as const,
    path: displayPath,
    entries,
    truncated,
    identifiers: identifiersOf(context),
  };
}

function filesRootOf(dependencies: FilesRouteDependencies): string {
  return dependencies.filesRoot ?? process.env.FRANK_FILES_ROOT ?? 'C:/Dev';
}

async function realpathOrThrow(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProblemError(
        'service_unavailable',
        'The files root is not available. Check FRANK_FILES_ROOT.',
      );
    }
    throw error;
  }
}

/** The literal `.env` file, its variants (`.env.local`, `.env.production`), and any name that smells like a credential. */
function isForbiddenName(name: string): boolean {
  const lower = name.toLowerCase();
  // `.env` and `.env.*` — the dotfile family. Note: this also covers `.envrc`.
  if (/^\.env(\.|$)/.test(lower)) return true;
  // Anything matching *secret*, *key*, or *token*. A substring match on
  // purpose: the requirement is the literal glob, and a false positive here
  // costs a preview while a false negative costs a credential.
  return /(secret|key|token)/.test(lower);
}

/**
 * Case-insensitive containment of `candidate` inside `root`, both normalized
 * to forward slashes so the prefix check is separator-agnostic.
 */
function isWithin(root: string, candidate: string): boolean {
  const rootKey = normalizeForCompare(root);
  const candidateKey = normalizeForCompare(candidate);
  if (candidateKey === rootKey) return true;
  return candidateKey.startsWith(`${rootKey}/`);
}

function normalizeForCompare(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized.replace(/\/+$/, '');
}

/**
 * Layer 1 + 2: reject `..` segments (either separator) and Windows colon
 * tricks before the path is ever resolved.
 */
function assertPathSyntaxSafe(requested: string): void {
  if (requested.length === 0) return;
  const segments = requested.split(/[/\\]+/);
  if (segments.some((segment) => segment === '..')) {
    throw new ProblemError('forbidden', 'Path traversal is not permitted.');
  }
  if (process.platform === 'win32') {
    // The only permitted colon is the drive letter's (`C:/...`). Anything
    // else — an ADS (`file.txt:secret`), a drive-relative path (`D:foo`), a
    // second drive — is a smuggling vector.
    const rest = /^[a-zA-Z]:/.test(requested) ? requested.slice(2) : requested;
    if (rest.includes(':')) {
      throw new ProblemError('forbidden', 'Windows alternate data stream paths are not permitted.');
    }
  }
}
