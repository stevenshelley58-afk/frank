/**
 * /api/explorer/thumb?path=<repo-relative>
 *
 * Returns a JPEG thumbnail for an image or video file. Generates on first
 * request and caches to a writable volume (FRANK_EXPLORER_CACHE).
 */
import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveSafe } from '@/lib/explorer-fs';
import { ensureThumb } from '@/lib/explorer-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rel = url.searchParams.get('path') ?? '';

  const abs = resolveSafe(rel);
  if (!abs) {
    return Response.json({ error: 'invalid path' }, { status: 400 });
  }

  const ext = path.extname(abs).toLowerCase();
  try {
    const thumbPath = await ensureThumb(abs, ext);
    if (!thumbPath) {
      return Response.json({ error: 'no thumbnail available' }, { status: 404 });
    }
    const buf = await readFile(thumbPath);
    return new Response(buf, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return Response.json({ error: 'thumbnail generation failed' }, { status: 500 });
  }
}
