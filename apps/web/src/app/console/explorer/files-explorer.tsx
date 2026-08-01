'use client';

/**
 * Console Files — a read-only file explorer over the Frank monorepo.
 *
 * Browses the live repo (mounted read-only at /srv/frank/repo-view) through
 * /api/explorer/{tree,file,search}. No curation: anything in the repo shows up.
 * The left rail is just pinned starting points into the real tree; the user can
 * pin anything they open (pins live in the browser, not the repo).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConsoleIcon } from '../components/console-icon';
import { Markdown } from './markdown';

type Entry = { name: string; path: string; type: 'dir' | 'file'; size: number };
type Crumb = { name: string; path: string };
type TreeResponse = { path: string; breadcrumbs: Crumb[]; entries: Entry[] };

type FileResponse = {
  path: string;
  name: string;
  ext: string;
  size: number;
  binary: boolean;
  truncated?: boolean;
  content?: string;
};

type SearchHit = { path: string; name: string; kind: 'name' | 'content'; snippet?: string };

type Pin = { path: string; name: string; type: 'dir' | 'file' };

const PINS_KEY = 'frank.explorer.pins';

/** Quick starting points — each is just a real path into the repo. */
const QUICK: Array<{ label: string; path: string }> = [
  { label: 'Repo root', path: '' },
  { label: 'Skills', path: 'skills' },
  { label: 'Flows', path: 'flows' },
  { label: 'Projects', path: 'projects' },
  { label: 'Agents', path: 'adapters' },
  { label: 'Prompts', path: 'prompts' },
  { label: 'Docs', path: 'docs' },
  { label: 'Contracts', path: 'packages' },
  { label: 'Config', path: 'infra' },
];

const MARKDOWN_EXT = new Set(['.md', '.mdx']);
const MONO_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.yaml',
  '.yml', '.toml', '.css', '.scss', '.html', '.sh', '.bash', '.sql', '.xml',
  '.svg', '.env', '.example', '.npmrc', '.nvmrc',
]);

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function loadPins(): Pin[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PINS_KEY);
    return raw ? (JSON.parse(raw) as Pin[]) : [];
  } catch {
    return [];
  }
}

export function FilesExplorer() {
  const [path, setPath] = useState('');
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [file, setFile] = useState<FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [raw, setRaw] = useState(false);

  const [pins, setPins] = useState<Pin[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCapped, setSearchCapped] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate pins from localStorage once on the client.
  useEffect(() => {
    setPins(loadPins());
    setHydrated(true);
  }, []);

  const persistPins = useCallback((next: Pin[]) => {
    setPins(next);
    try {
      window.localStorage.setItem(PINS_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, []);

  // Load a directory listing.
  const openDir = useCallback(async (p: string) => {
    setLoadingTree(true);
    setTreeError(null);
    setSearchHits(null);
    setQuery('');
    try {
      const res = await fetch(`/api/explorer/tree?path=${encodeURIComponent(p)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TreeResponse;
      setTree(data);
      setPath(data.path);
    } catch (err) {
      setTreeError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoadingTree(false);
    }
  }, []);

  // Load a file for preview.
  const openFile = useCallback(async (p: string) => {
    setFileLoading(true);
    setRaw(false);
    try {
      const res = await fetch(`/api/explorer/file?path=${encodeURIComponent(p)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setFile((await res.json()) as FileResponse);
    } catch (err) {
      setFile({ path: p, name: p.split('/').pop() ?? p, ext: '', size: 0, binary: true, content: `Could not load: ${String(err)}` });
    } finally {
      setFileLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void openDir('');
  }, [openDir]);

  const onEntry = useCallback(
    (e: Entry) => {
      if (e.type === 'dir') void openDir(e.path);
      else void openFile(e.path);
    },
    [openDir, openFile],
  );

  // Debounced search over the current subtree.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setSearchHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/explorer/search?q=${encodeURIComponent(query.trim())}&path=${encodeURIComponent(path)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSearchHits(data.hits as SearchHit[]);
        setSearchCapped(Boolean(data.capped));
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, path]);

  const isPinned = (p: string) => pins.some((x) => x.path === p);
  const togglePin = (p: Pin) => {
    if (isPinned(p.path)) persistPins(pins.filter((x) => x.path !== p.path));
    else persistPins([p, ...pins]);
  };

  const ext = file?.ext ?? '';
  const isMarkdown = MARKDOWN_EXT.has(ext);
  const showRendered = isMarkdown && !raw;

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT RAIL — quick locations + pins */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-rail">
        <div className="border-b border-line px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Locations
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {hydrated && pins.length > 0 && (
            <div className="mb-3">
              <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wide text-muted">
                ★ Pinned
              </p>
              {pins.map((p) => (
                <RailRow
                  key={p.path}
                  label={p.name}
                  active={p.type === 'dir' ? path === p.path : file?.path === p.path}
                  onClick={() => (p.type === 'dir' ? void openDir(p.path) : void openFile(p.path))}
                />
              ))}
              <div className="mx-2 my-1.5 border-t border-line" />
            </div>
          )}
          {QUICK.map((q) => (
            <RailRow
              key={q.path || '__root'}
              label={q.label}
              active={path === q.path && !file}
              onClick={() => void openDir(q.path)}
            />
          ))}
        </nav>
        <div className="border-t border-line px-3 py-2">
          <p className="font-mono text-[9.5px] uppercase tracking-wide text-muted/70">
            read-only · live repo
          </p>
        </div>
      </aside>

      {/* MIDDLE — breadcrumbs + search + listing */}
      <section className="flex w-[340px] shrink-0 flex-col border-r border-line bg-card">
        {/* Breadcrumbs */}
        <div className="flex min-h-[40px] flex-wrap items-center gap-1 border-b border-line px-3 py-2">
          {(tree?.breadcrumbs ?? [{ name: 'repo', path: '' }]).map((c, idx, arr) => (
            <span key={c.path || '__root'} className="flex items-center gap-1">
              <button
                onClick={() => void openDir(c.path)}
                className={`rounded px-1 text-[12.5px] transition-colors ${
                  idx === arr.length - 1
                    ? 'font-semibold text-ink'
                    : 'text-muted hover:text-accent'
                }`}
              >
                {c.name}
              </button>
              {idx < arr.length - 1 && <span className="text-muted/40">/</span>}
            </span>
          ))}
        </div>

        {/* Search */}
        <div className="border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-2.5 py-1.5">
            <span className="text-muted">
              <ConsoleIcon name="chart" size={13} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${path ? path : 'repo'}…`}
              className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-muted/60"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setSearchHits(null);
                }}
                className="text-muted hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Listing / search results */}
        <div className="flex-1 overflow-y-auto">
          {searchHits !== null ? (
            <div className="py-1">
              <p className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                {searching ? 'Searching…' : `${searchHits.length} result${searchHits.length === 1 ? '' : 's'}${searchCapped ? ' (capped)' : ''}`}
              </p>
              {searchHits.map((h) => (
                <button
                  key={h.path}
                  onClick={() => void openFile(h.path)}
                  className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <div className="truncate text-[12.5px] text-ink">{h.path}</div>
                  {h.snippet && (
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                      {h.snippet}
                    </div>
                  )}
                </button>
              ))}
              {!searching && searchHits.length === 0 && (
                <p className="px-3 py-4 text-center text-[12.5px] text-muted">No matches.</p>
              )}
            </div>
          ) : loadingTree ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-muted">Loading…</p>
          ) : treeError ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-danger">{treeError}</p>
          ) : (
            <div className="py-1">
              {path !== '' && (
                <button
                  onClick={() => {
                    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
                    void openDir(parent);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-muted transition-colors hover:bg-hover"
                >
                  <span className="w-4 text-center">↩</span>
                  <span>..</span>
                </button>
              )}
              {(tree?.entries ?? []).map((e) => (
                <button
                  key={e.path}
                  onClick={() => onEntry(e)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className={`w-4 shrink-0 text-center ${e.type === 'dir' ? 'text-accent' : 'text-muted'}`}>
                    {e.type === 'dir' ? '▸' : '·'}
                  </span>
                  <span className={`flex-1 truncate text-[12.5px] ${e.type === 'dir' ? 'text-ink' : 'text-ink2'}`}>
                    {e.name}
                  </span>
                  {e.type === 'file' && (
                    <span className="shrink-0 font-mono text-[10px] text-muted/70">{fmtSize(e.size)}</span>
                  )}
                </button>
              ))}
              {tree && tree.entries.length === 0 && (
                <p className="px-3 py-6 text-center text-[12.5px] text-muted">Empty folder.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT — preview */}
      <section className="flex min-w-0 flex-1 flex-col bg-paper">
        {fileLoading ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
            Loading…
          </div>
        ) : file ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <span className="truncate font-mono text-[12px] text-ink2">{file.path}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted">{fmtSize(file.size)}</span>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {isMarkdown && (
                  <div className="flex overflow-hidden rounded-md border border-line">
                    <button
                      onClick={() => setRaw(false)}
                      className={`px-2 py-0.5 text-[11px] transition-colors ${!raw ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
                    >
                      Rendered
                    </button>
                    <button
                      onClick={() => setRaw(true)}
                      className={`px-2 py-0.5 text-[11px] transition-colors ${raw ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
                    >
                      Raw
                    </button>
                  </div>
                )}
                <button
                  onClick={() =>
                    togglePin({ path: file.path, name: file.name, type: 'file' })
                  }
                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    isPinned(file.path)
                      ? 'border-accent/40 text-accent'
                      : 'border-line text-muted hover:text-ink'
                  }`}
                >
                  {isPinned(file.path) ? '★ Pinned' : '☆ Pin'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {file.truncated && (
                <div className="mb-3 rounded-lg border border-line bg-subtle px-3 py-2 text-[12px] text-muted">
                  Showing the first {fmtSize(256 * 1024)} of {fmtSize(file.size)}.
                </div>
              )}
              {file.binary ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <span className="text-3xl">🗎</span>
                  <p className="mt-3 text-[13px] text-ink2">{file.name}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    Binary file — {fmtSize(file.size)}. No preview.
                  </p>
                </div>
              ) : showRendered ? (
                <Markdown source={file.content ?? ''} />
              ) : (
                <pre className="overflow-x-auto whitespace-pre font-mono text-[12px] leading-relaxed text-ink2">
                  {file.content ?? ''}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-subtle text-muted">
              <ConsoleIcon name="folder" size={22} />
            </span>
            <p className="mt-3 text-[13.5px] text-ink2">Select a file to preview</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted">
              Browse the folders on the left. Markdown renders; everything else
              shows as source. Pin anything you reach for often.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function RailRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors ${
        active ? 'bg-hover font-medium text-ink' : 'text-ink2 hover:bg-hover'
      }`}
    >
      {label}
    </button>
  );
}
