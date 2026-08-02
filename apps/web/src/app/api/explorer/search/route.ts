/**
 * /api/explorer/search?q=<term>&path=<optional subtree>
 *
 * Filename + content search across the repo (read-only), capped at MAX_HITS.
 * Case-insensitive. Walks the tree skipping noise dirs / dotfiles and skips
 * content-sniffing on binary files. Returns matching files with a small
 * context snippet for content hits.
 */
import { NextRequest } from 'next/server';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { resolveSafe, toRelative } from '@/lib/explorer-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HIDDEN = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', '.cache', 'coverage',
  'public', // fonts/assets — never a meaningful text hit
]);
const MAX_HITS = 60;
const MAX_FILE_SCAN = 512 * 1024; // don't content-scan huge files
const SKIP_CONTENT_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf',
  '.otf', '.eot', '.mp3', '.mp4', '.ico', '.pdf', '.zip',
]);

type Hit = { path: string; name: string; kind: 'name' | 'content'; snippet?: string };

function snippetAround(text: string, idx: number, term: string): string {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + term.length + 60);
  const pre = start > 0 ? '…' : '';
  const post = end < text.length ? '…' : '';
  return pre + text.slice(start, end).replace(/\s+/g, ' ').trim() + post;
}

async function walk(
  dir: string,
  term: string,
  lower: string,
  hits: Hit[],
): Promise<void> {
  if (hits.length >= MAX_HITS) return;
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    if (hits.length >= MAX_HITS) return;
    if (it.name.startsWith('.') || HIDDEN.has(it.name)) continue;
    const abs = path.join(dir, it.name);
    if (it.isDirectory()) {
      await walk(abs, term, lower, hits);
      continue;
    }
    if (!it.isFile()) continue;

    const rel = toRelative(abs);
    // Filename match.
    if (it.name.toLowerCase().includes(lower)) {
      hits.push({ path: rel, name: it.name, kind: 'name' });
      continue;
    }
    // Content match.
    const ext = path.extname(it.name).toLowerCase();
    if (SKIP_CONTENT_EXT.has(ext)) continue;
    try {
      const info = await stat(abs);
      if (info.size > MAX_FILE_SCAN) continue;
      const buf = await readFile(abs);
      if (buf.includes(0)) continue; // binary
      const text = buf.toString('utf8');
      const idx = text.toLowerCase().indexOf(lower);
      if (idx >= 0) {
        hits.push({ path: rel, name: it.name, kind: 'content', snippet: snippetAround(text, idx, term) });
      }
    } catch {
      /* unreadable — skip */
    }
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const sub = url.searchParams.get('path') ?? '';

  if (q.length < 2) {
    return Response.json({ error: 'query must be at least 2 chars' }, { status: 400 });
  }

  const abs = resolveSafe(sub);
  if (!abs) {
    return Response.json({ error: 'invalid path' }, { status: 400 });
  }

  const hits: Hit[] = [];
  await walk(abs, q, q.toLowerCase(), hits);

  return Response.json({ query: q, path: sub, count: hits.length, capped: hits.length >= MAX_HITS, hits });
}
