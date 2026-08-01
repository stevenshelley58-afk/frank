/**
 * Path jail for the Console Files (explorer) module.
 *
 * The explorer browses the Frank monorepo READ-ONLY. Every requested path is
 * resolved and must land inside FRANK_EXPLORER_ROOT — any escape attempt
 * (`..`, absolute paths, symlink hops) is rejected. The container mounts the
 * repo at /srv/frank/repo-view read-only (see infra/docker-compose.dev.yml),
 * so even a logic bug here can only read, never write.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const EXPLORER_ROOT =
  process.env.FRANK_EXPLORER_ROOT ?? '/srv/frank/repo-view';

/** Directories never worth surfacing in the browser. */
const HIDDEN = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  '.cache',
  'coverage',
]);

/** Resolve a repo-relative path safely, or null if it escapes the jail. */
export function resolveSafe(rel: string): string | null {
  const clean = (rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(EXPLORER_ROOT, clean);
  if (abs !== EXPLORER_ROOT && !abs.startsWith(EXPLORER_ROOT + path.sep)) {
    return null;
  }
  return abs;
}

/** Strip the root prefix → repo-relative posix path ('' for the root itself). */
export function toRelative(abs: string): string {
  const rel = path.relative(EXPLORER_ROOT, abs).replace(/\\/g, '/');
  return rel === '.' ? '' : rel;
}

export type DirEntry = {
  name: string;
  path: string; // repo-relative
  type: 'dir' | 'file';
  size: number;
};

/** List a directory's children, hiding noise dirs and dotfiles. */
export async function listDir(abs: string): Promise<DirEntry[]> {
  const items = await readdir(abs, { withFileTypes: true });
  const out: DirEntry[] = [];
  for (const it of items) {
    if (it.name.startsWith('.')) continue;
    if (HIDDEN.has(it.name)) continue;
    const childAbs = path.join(abs, it.name);
    let type: 'dir' | 'file';
    let size = 0;
    if (it.isDirectory()) {
      type = 'dir';
    } else if (it.isFile()) {
      type = 'file';
    } else {
      continue; // sockets, devices, etc.
    }
    out.push({ name: it.name, path: toRelative(childAbs), type, size });
  }
  out.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name)
      : a.type === 'dir'
        ? -1
        : 1,
  );
  return out;
}
