/**
 * /api/explorer/tidy?path=<repo-relative dir>
 *
 * AI "keep it neat" — hands a folder's listing to Goose (Frank's harness,
 * model set centrally in Goose config) and asks for concrete rename/organize
 * suggestions. Returns structured suggestions, each carrying the exact
 * `git mv` command so the user can apply it (or ask Frank to) without the
 * read-only explorer ever writing to the repo.
 */
import { NextRequest } from 'next/server';

import { listDir, resolveSafe } from '@/lib/explorer-fs';
import { createSession, streamMessage } from '@/lib/goose-server';

// Goose runs outside the web container, so it can't see the in-container
// read-only mount (EXPLORER_ROOT=/srv/frank/repo-view). Give it the real
// repo path instead — tidy suggestions are relative paths regardless.
const GOOSE_REPO_CWD = process.env.GOOSE_REPO_CWD ?? '/srv/frank/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export type TidySuggestion = {
  path: string;
  kind: 'rename' | 'move';
  current: string;
  suggested: string;
  reason: string;
  command: string;
};

const PROMPT = (dirLabel: string, listing: string) => `You are organizing Steven's Frank monorepo. Here is the listing of the folder "${dirLabel}" (entries are "type  name"):

${listing}

Suggest concrete improvements to keep it neat and accurately named. Rules:
- Only suggest RENAMES of poorly/ambiguously named files or folders, or MOVES of obviously misplaced files. Do not invent files that aren't listed.
- Names should be kebab-case, lowercase, descriptive. Folders singular unless genuinely plural.
- Prefer accuracy and clarity over cleverness. If the folder is already clean, return an empty list.
- For each suggestion give the exact shell command using "git mv" with paths relative to the repo root.

Respond with ONLY a JSON array (no prose, no code fences). Each element:
{"path":"<repo-relative path>","kind":"rename"|"move","current":"<current name>","suggested":"<new name or new relative path>","reason":"<one short sentence>","command":"git mv ..."}
`;

function extractJsonArray(text: string): TidySuggestion[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is TidySuggestion =>
        s && typeof s.path === 'string' && typeof s.command === 'string',
    );
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rel = url.searchParams.get('path') ?? '';

  const abs = resolveSafe(rel);
  if (!abs) {
    return Response.json({ error: 'invalid path' }, { status: 400 });
  }

  let entries;
  try {
    entries = await listDir(abs);
  } catch {
    return Response.json({ error: 'not a directory' }, { status: 400 });
  }
  if (entries.length === 0) {
    return Response.json({ path: rel, suggestions: [], note: 'empty folder' });
  }

  const listing = entries
    .map((e) => `${e.type.padEnd(5)} ${e.name}`)
    .join('\n');
  const dirLabel = rel || 'repo root';

  try {
    const sessionId = await createSession(GOOSE_REPO_CWD);
    let text = '';
    for await (const chunk of streamMessage(sessionId, PROMPT(dirLabel, listing))) {
      text += chunk;
      if (text.length > 60_000) break; // safety cap
    }
    const suggestions = extractJsonArray(text);
    return Response.json({ path: rel, count: suggestions.length, suggestions });
  } catch (err) {
    return Response.json(
      { error: `tidy failed: ${String(err instanceof Error ? err.message : err)}` },
      { status: 502 },
    );
  }
}
