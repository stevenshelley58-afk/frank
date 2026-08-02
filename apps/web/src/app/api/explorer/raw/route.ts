/**
 * /api/explorer/raw?path=<repo-relative>
 *
 * Streams the raw bytes of any file (jailed to the repo). Used by the
 * preview pane to show full-resolution images and play videos inline.
 */
import { NextRequest } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { resolveSafe } from '@/lib/explorer-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rel = url.searchParams.get('path') ?? '';

  const abs = resolveSafe(rel);
  if (!abs) {
    return Response.json({ error: 'invalid path' }, { status: 400 });
  }

  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      return Response.json({ error: 'not a file' }, { status: 400 });
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    const buf = await readFile(abs);
    return new Response(buf, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(buf.length),
      },
    });
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
