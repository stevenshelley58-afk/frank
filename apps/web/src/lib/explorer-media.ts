/**
 * Thumbnail cache for the Console Files module.
 *
 * Images → sharp resize. Videos → ffmpeg frame grab at ~1s.
 * Cache key = SHA256(absPath + mtime) so a changed source regenerates.
 * Cache dir is a writable Docker volume (FRANK_EXPLORER_CACHE, default /tmp/explorer-cache).
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileP = promisify(execFile);
const CACHE_DIR = process.env.FRANK_EXPLORER_CACHE ?? '/tmp/explorer-cache';

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']);
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);

export function mediaKind(ext: string): 'image' | 'video' | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

async function cacheKey(absPath: string): Promise<string> {
  const info = await stat(absPath);
  return createHash('sha256')
    .update(`${absPath}:${info.mtimeMs}`)
    .digest('hex')
    .slice(0, 20);
}

/** Returns the path to a cached JPEG thumbnail, generating it if needed. */
export async function ensureThumb(absPath: string, ext: string): Promise<string | null> {
  const kind = mediaKind(ext);
  if (!kind) return null;

  await mkdir(CACHE_DIR, { recursive: true });
  const key = await cacheKey(absPath);
  const outPath = path.join(CACHE_DIR, `${key}.jpg`);

  if (existsSync(outPath)) return outPath;

  try {
    if (kind === 'image') {
      await sharp(absPath)
        .resize(320, undefined, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(outPath);
    } else {
      // ffmpeg: seek to 1s, grab 1 frame, scale to 320px wide.
      await execFileP('ffmpeg', [
        '-ss', '1',
        '-i', absPath,
        '-frames:v', '1',
        '-vf', 'scale=320:-1',
        '-y',
        outPath,
      ], { timeout: 15_000 });
    }
    return outPath;
  } catch {
    return null; // corrupt/unsupported — UI shows a placeholder
  }
}
