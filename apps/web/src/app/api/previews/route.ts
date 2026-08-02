/**
 * /api/previews — lists all hosted previews grouped by topic.
 *
 * Reads the preview static directory (mounted read-only into frank-web).
 * Each subdirectory is a deployed preview; .preview-meta.json carries
 * topic, slug, timestamp, and deploy mode.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREVIEWS_ROOT =
  process.env.FRANK_PREVIEWS_ROOT ?? '/srv/frank/preview-view';

type PreviewMeta = {
  topic: string;
  slug: string;
  deployed_at: string;
  mode: string;
};

type PreviewEntry = {
  slug: string;
  topic: string;
  version: number;
  deployed_at: string;
  url: string;
  file_count: number;
  total_size: number;
};

type TopicGroup = {
  topic: string;
  versions: PreviewEntry[];
  latest: string;
};

async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (e.isFile() && !e.name.startsWith('.')) {
      const s = await stat(full);
      files += 1;
      bytes += s.size;
    }
  }
  return { files, bytes };
}

export async function GET() {
  let entries: string[];
  try {
    entries = await readdir(PREVIEWS_ROOT);
  } catch {
    return Response.json({ topics: [], total: 0 });
  }

  const previews: PreviewEntry[] = [];

  for (const name of entries) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const full = path.join(PREVIEWS_ROOT, name);
    const info = await stat(full).catch(() => null);
    if (!info?.isDirectory()) continue;

    let meta: PreviewMeta | null = null;
    try {
      const raw = await readFile(path.join(full, '.preview-meta.json'), 'utf-8');
      meta = JSON.parse(raw) as PreviewMeta;
    } catch {
      // No meta — infer topic from slug
    }

    // Parse version from slug: "topic-v3" → topic="topic", version=3
    const vMatch = name.match(/^(.+)-v(\d+)$/);
    const topic = meta?.topic ?? (vMatch ? vMatch[1] : name);
    const version = vMatch ? parseInt(vMatch[2], 10) : 0;

    const { files, bytes } = await dirSize(full);

    previews.push({
      slug: name,
      topic,
      version,
      deployed_at: meta?.deployed_at ?? info.mtime.toISOString(),
      url: `https://preview.frank.fail/${name}/`,
      file_count: files,
      total_size: bytes,
    });
  }

  // Group by topic
  const groups = new Map<string, PreviewEntry[]>();
  for (const p of previews) {
    const list = groups.get(p.topic) ?? [];
    list.push(p);
    groups.set(p.topic, list);
  }

  const topics: TopicGroup[] = [];
  for (const [topic, versions] of groups) {
    versions.sort((a, b) => b.version - a.version);
    topics.push({
      topic,
      versions,
      latest: versions[0]?.slug ?? '',
    });
  }

  // Sort topics by most recent deployment
  topics.sort((a, b) => {
    const aTime = a.versions[0]?.deployed_at ?? '';
    const bTime = b.versions[0]?.deployed_at ?? '';
    return bTime.localeCompare(aTime);
  });

  return Response.json({ topics, total: previews.length });
}
