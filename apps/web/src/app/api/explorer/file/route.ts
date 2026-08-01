/**
 * /api/explorer/file?path=<repo-relative>
 *
 * Returns one file's contents for the preview pane (read-only). Binary files
 * are reported as such (no body) so the UI can render a friendly placeholder
 * instead of garbage. Large files are truncated with a `truncated` flag.
 */
import { NextRequest } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { resolveSafe } from '@/lib/explorer-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_BYTES = 256 * 1024; // 256 KB preview cap
const MAX_BINARY_SNIFF = 8000;

const TEXT_EXT = new Set([
  '.md', '.mdx', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.html',
  '.sh', '.bash', '.env', '.example', '.sql', '.csv', '.xml', '.svg',
  '.gitignore', '.dockerignore', '.npmrc', '.nvmrc',
]);

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, MAX_BINARY_SNIFF);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true; // NUL byte → binary
  }
  return false;
}

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
  if (!info.isFile()) {
    return Response.json({ error: 'not a file' }, { status: 400 });
  }

  const ext = path.extname(abs).toLowerCase();
  const name = path.basename(abs);
  const buf = await readFile(abs);

  const isText =
    TEXT_EXT.has(ext) ||
    name.startsWith('.') ||
    (!looksBinary(buf) && buf.length <= MAX_TEXT_BYTES * 4);

  if (!isText) {
    return Response.json({
      path: rel,
      name,
      ext,
      size: info.size,
      binary: true,
    });
  }

  const truncated = buf.length > MAX_TEXT_BYTES;
  const content = truncated
    ? buf.subarray(0, MAX_TEXT_BYTES).toString('utf8')
    : buf.toString('utf8');

  return Response.json({
    path: rel,
    name,
    ext,
    size: info.size,
    binary: false,
    truncated,
    content,
  });
}
