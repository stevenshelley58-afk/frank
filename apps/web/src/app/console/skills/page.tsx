import type { Metadata } from 'next';
import Link from 'next/link';
import type { Dirent } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'FRANK — Skills',
  description: 'Installed Frank skills, their instructions, lifecycle, and discovered references.',
};

type Skill = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  lifecycle: 'active' | 'in progress' | 'deprecated';
  references: string[];
  content: string;
  truncated: boolean;
};

const skillRoot = path.resolve(process.env.FRANK_EXPLORER_ROOT ?? '/srv/frank/repo-view', 'skills');
const MAX_SKILL_DEPTH = 6;
const MAX_SKILLS = 400;
const MAX_SKILL_BYTES = 64 * 1024;

type ScanState = { found: number; unreadable: number; truncated: number; depthLimited: boolean; countLimited: boolean };

function frontmatter(source: string): { fields: Record<string, string>; content: string } {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return { fields: {}, content: source };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([\w-]+):\s*(.+)$/);
    if (field) fields[field[1]] = field[2].replace(/^['"]|['"]$/g, '');
  }
  return { fields, content: match[2] };
}

function references(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+\.md(?:#[^)]+)?)\)/g)) {
    const ref = match[1].split('#')[0].replace(/\\/g, '/');
    if (!ref.startsWith('/')) found.add(ref);
  }
  return [...found].slice(0, 8);
}

async function readSkillPrefix(absolute: string): Promise<{ source: string; truncated: boolean }> {
  const handle = await open(absolute, 'r');
  try {
    const { size } = await handle.stat();
    const bytes = Math.min(size, MAX_SKILL_BYTES);
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return { source: buffer.subarray(0, bytesRead).toString('utf8'), truncated: size > MAX_SKILL_BYTES };
  } finally {
    await handle.close();
  }
}

async function collect(dir: string, state: ScanState, root = dir, depth = 0): Promise<Skill[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    state.unreadable += 1;
    return [];
  }
  const results: Skill[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth >= MAX_SKILL_DEPTH) {
        state.depthLimited = true;
      } else {
        results.push(...(await collect(absolute, state, root, depth + 1)));
      }
      continue;
    }
    if (!entry.isFile() || entry.name !== 'SKILL.md') continue;
    if (state.found >= MAX_SKILLS) {
      state.countLimited = true;
      break;
    }
    let source: string;
    let truncated = false;
    try {
      const prefix = await readSkillPrefix(absolute);
      source = prefix.source;
      truncated = prefix.truncated;
    } catch {
      state.unreadable += 1;
      continue;
    }
    state.found += 1;
    if (truncated) state.truncated += 1;
    const rel = path.relative(root, absolute).replace(/\\/g, '/');
    const bits = rel.split('/');
    const parsed = frontmatter(source);
    const category = bits[0] ?? 'uncategorised';
    results.push({
      id: rel,
      category,
      name: parsed.fields.name ?? bits.at(-2) ?? 'unnamed skill',
      description: parsed.fields.description ?? null,
      lifecycle: category === 'deprecated' ? 'deprecated' : category === 'in-progress' ? 'in progress' : 'active',
      references: references(parsed.content),
      content: parsed.content.slice(0, 12_000),
      truncated: truncated || parsed.content.length > 12_000,
    });
  }
  return results;
}

function lifecycleClass(lifecycle: Skill['lifecycle']) {
  return lifecycle === 'active'
    ? 'border-success/30 bg-success/10 text-success'
    : lifecycle === 'in progress'
      ? 'border-accent/30 bg-accent/10 text-accent'
      : 'border-line bg-subtle text-muted';
}

export default async function SkillsPage({ searchParams }: { searchParams?: Promise<{ skill?: string | string[] }> }) {
  const module = moduleById('skills')!;
  const selectedId = (await searchParams)?.skill;
  const selected = Array.isArray(selectedId) ? selectedId[0] : selectedId;

  let skills: Skill[] = [];
  let error: string | null = null;
  const scan: ScanState = { found: 0, unreadable: 0, truncated: 0, depthLimited: false, countLimited: false };
  try {
    skills = (await collect(skillRoot, scan)).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  } catch {
    error = 'The read-only skills mount is unavailable. No skill inventory is being inferred.';
  }
  const activeSkill = skills.find((skill) => skill.id === selected) ?? null;

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="mb-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Registry</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">Skills</h1>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
              Read-only inventory from the mounted <span className="font-mono text-ink">skills/</span> registry. Lifecycle comes from its category; links below are only references found in each skill’s instructions.
            </p>
          </div>

          {error ? (
            <div role="status" className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-warning">{error}</div>
          ) : skills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-subtle px-4 py-8 text-center text-[12.5px] text-muted">No SKILL.md files are present in the mounted registry.</div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{skills.length} installed skills</p>
                {(scan.unreadable > 0 || scan.truncated > 0 || scan.depthLimited || scan.countLimited) && (
                  <p role="status" className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                    Partial inventory: {scan.unreadable > 0 ? `${scan.unreadable} unreadable entr${scan.unreadable === 1 ? 'y was' : 'ies were'} skipped. ` : ''}{scan.truncated > 0 ? `${scan.truncated} oversized skill entr${scan.truncated === 1 ? 'y was' : 'ies were'} read only through ${MAX_SKILL_BYTES / 1024} KB. ` : ''}{scan.depthLimited ? `Nested folders beyond ${MAX_SKILL_DEPTH} levels were skipped. ` : ''}{scan.countLimited ? `Only the first ${MAX_SKILLS} skill files were read.` : ''}
                  </p>
                )}
                {skills.map((skill) => (
                  <Link key={skill.id} href={`/console/skills?skill=${encodeURIComponent(skill.id)}`} className={`block rounded-xl border px-4 py-3 transition-colors ${activeSkill?.id === skill.id ? 'border-accent/40 bg-accent/5' : 'border-line bg-card hover:border-accent/30'}`}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{skill.name}</span>
                      <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${lifecycleClass(skill.lifecycle)}`}>{skill.lifecycle}</span>
                    </div>
                    <p className="mt-1 truncate text-[11.5px] text-muted">{skill.description ?? 'No frontmatter description.'}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted/70">{skill.category}</p>
                  </Link>
                ))}
              </div>

              <aside className="min-w-0 rounded-xl border border-line bg-card p-4">
                {activeSkill ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-[16px] font-bold text-ink">{activeSkill.name}</h2>
                      <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${lifecycleClass(activeSkill.lifecycle)}`}>{activeSkill.lifecycle}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{activeSkill.description ?? 'No frontmatter description.'}</p>
                    {activeSkill.references.length > 0 && <div className="mt-4"><h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Discovered references</h3><div className="mt-2 flex flex-wrap gap-2">{activeSkill.references.map((reference) => <span key={reference} className="rounded-md bg-subtle px-2 py-1 font-mono text-[10px] text-ink2">{reference}</span>)}</div></div>}
                    <div className="mt-4"><h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Instructions</h3><pre className="mt-2 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 font-mono text-[11px] leading-relaxed text-ink2">{activeSkill.content}</pre>{activeSkill.truncated && <p className="mt-2 text-[11px] text-warning">Instructions are shown as an excerpt; scanning reads at most {MAX_SKILL_BYTES / 1024} KB per skill.</p>}</div>
                    <p className="mt-3 text-[11px] text-muted">No delegation launch is shown: the available Workbench route accepts a room/run identifier, not a prefilled skill task.</p>
                  </>
                ) : <p className="text-[12.5px] text-muted">Choose a skill to inspect its installed instructions. This view never executes a skill.</p>}
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
