// GET /api/worktrees — live git worktree status.
//
// Runs `git worktree list --porcelain` and enriches each tree with
// status counts + last commit. 2 s in-memory cache so the 4 s client
// poll never hammers git. Repo discovery: FRANK_EXPLORER_ROOT env
// (set in the container compose) → walk up from cwd looking for .git.

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/* ---------- repo discovery ---------- */

function findRepoRoot(): string | null {
  // 1. Explicit env (container / CI)
  const env = process.env.FRANK_EXPLORER_ROOT;
  if (env && isGitRepo(env)) return resolve(env);

  // 2. Walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (isGitRepo(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isGitRepo(dir: string): boolean {
  try {
    const p = join(dir, '.git');
    return existsSync(p) && (statSync(p).isDirectory() || statSync(p).isFile());
  } catch {
    return false;
  }
}

/* ---------- git helpers ---------- */

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 15_000 }, (err, stdout) => {
      if (err) rej(err);
      else res(stdout);
    });
  });
}

interface RawTree {
  worktree: string;
  HEAD: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
}

function parsePorcelain(raw: string): RawTree[] {
  const trees: RawTree[] = [];
  let cur: Partial<RawTree> = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.worktree) trees.push(cur as RawTree);
      cur = { worktree: line.slice(9), branch: null, detached: false, bare: false };
    } else if (line.startsWith('HEAD ')) {
      cur.HEAD = line.slice(5);
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      cur.detached = true;
    } else if (line === 'bare') {
      cur.bare = true;
    }
  }
  if (cur.worktree) trees.push(cur as RawTree);
  return trees.filter((t) => !t.bare);
}

interface TreeInfo {
  name: string;
  path: string;
  branch: string | null;
  detached: boolean;
  isCurrent: boolean;
  ahead: number;
  behind: number;
  added: number;
  modified: number;
  deleted: number;
  untracked: number;
  lastSha: string;
  lastSubject: string;
  lastRelative: string;
}

async function enrich(raw: RawTree, repoRoot: string): Promise<TreeInfo> {
  const wt = raw.worktree;
  const name = wt === repoRoot ? '(main)' : wt.split(/[\\/]/).pop() || wt;
  const isCurrent = resolve(wt) === resolve(repoRoot);

  let added = 0, modified = 0, deleted = 0, untracked = 0;
  let ahead = 0, behind = 0;
  let lastSha = raw.HEAD?.slice(0, 7) ?? '';
  let lastSubject = '';
  let lastRelative = '';

  try {
    // Status counts (porcelain v1)
    const status = await git(['status', '--porcelain'], wt);
    for (const line of status.split('\n')) {
      if (!line) continue;
      const x = line[0], y = line[1];
      if (x === '?' || y === '?') { untracked++; continue; }
      if (x === 'A' || y === 'A') added++;
      else if (x === 'M' || y === 'M') modified++;
      else if (x === 'D' || y === 'D') deleted++;
      else if (x === 'R') modified++;
      else modified++;
    }
  } catch { /* worktree may be broken */ }

  try {
    // Ahead / behind upstream
    if (raw.branch) {
      const ab = await git(['rev-list', '--left-right', '--count', `HEAD...@{upstream}`], wt);
      const [a, b] = ab.trim().split(/\s+/).map(Number);
      ahead = a || 0;
      behind = b || 0;
    }
  } catch { /* no upstream */ }

  try {
    // Last commit
    const log = await git(['log', '-1', '--format=%h\x1f%s\x1f%cr'], wt);
    const [sha, subject, rel] = log.trim().split('\x1f');
    lastSha = sha || lastSha;
    lastSubject = subject || '';
    lastRelative = rel || '';
  } catch { /* empty repo */ }

  return {
    name, path: wt,
    branch: raw.branch,
    detached: raw.detached,
    isCurrent,
    ahead, behind,
    added, modified, deleted, untracked,
    lastSha, lastSubject, lastRelative,
  };
}

/* ---------- cache ---------- */

let cache: { data: unknown; at: number } | null = null;
const TTL = 2_000;

/* ---------- handler ---------- */

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL) {
    return NextResponse.json(cache.data);
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    return NextResponse.json(
      { repo: null, trees: [], generated_at: new Date().toISOString(), error: 'No git repository found' },
      { status: 200 },
    );
  }

  try {
    const raw = await git(['worktree', 'list', '--porcelain'], repoRoot);
    const parsed = parsePorcelain(raw);
    const trees = await Promise.all(parsed.map((t) => enrich(t, repoRoot)));
    // Current worktree first, then alphabetical
    trees.sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || a.name.localeCompare(b.name));

    const data = { repo: repoRoot, trees, generated_at: new Date().toISOString() };
    cache = { data, at: now };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { repo: repoRoot, trees: [], generated_at: new Date().toISOString(), error: String(e) },
      { status: 200 },
    );
  }
}
