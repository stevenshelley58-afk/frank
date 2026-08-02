/**
 * /api/explorer/tree?path=<repo-relative>
 *
 * Lists one directory of the Frank monorepo (read-only). Returns breadcrumbs
 * plus sorted children (dirs first, noise dirs + dotfiles hidden). The `path`
 * param is jailed to FRANK_EXPLORER_ROOT by resolveSafe — escapes → 400.
 */
import { NextRequest } from 'next/server';
import { stat } from 'node:fs/promises';

import { resolveSafe, toRelative, listDir, EXPLORER_ROOT } from '@/lib/explorer-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rel = url.searchParams.get('path') ?? '';

  const abs = resolveSafe(rel);
  if (!abs) {
    return Response.json({ error: 'invalid path' }, { status: 400 });
  }

  let info;
  try {
    info = await stat(abs);
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  if (!info.isDirectory()) {
    return Response.json({ error: 'not a directory' }, { status: 400 });
  }

  const entries = await listDir(abs);
  const current = toRelative(abs);

  // Breadcrumbs: root → … → current.
  const parts = current ? current.split('/') : [];
  const crumbs = [{ name: 'repo', path: '' }];
  let acc = '';
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    crumbs.push({ name: p, path: acc });
  }

  return Response.json({ root: EXPLORER_ROOT, path: current, breadcrumbs: crumbs, entries });
}
