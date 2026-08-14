'use client';

/**
 * /files client — W3-1 read-only projects-root browser.
 *
 * The left pane is a react-arborist tree over FRANK_FILES_ROOT (default
 * C:/Dev); directories load their children lazily from GET /v1/files on
 * expand. The right pane shows the selected file: markdown renders through
 * react-markdown + remark-gfm with shiki-highlighted fenced blocks; every
 * other text file renders as shiki-highlighted code. The server refuses
 * anything that escapes the root, secret-named files, binaries, and files
 * over 2 MB — the client only ever renders what the server allows.
 *
 * The tree is rendered only after mount: react-arborist mounts an
 * HTML5Backend DndProvider internally, which needs a browser `window`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree } from 'react-arborist';
import type { NodeApi, NodeRendererProps } from 'react-arborist';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighter } from 'shiki';
import type { BuiltinLanguage, Highlighter } from 'shiki';

import { useAuth } from '@/components/providers';
import { ApiError, problemMessage } from '@/lib/api';
import { fetchFiles } from '@/lib/files-api';
import type { FilesEntry } from '@/lib/files-api';

/* ---------------------------------------------------------------- tree --- */

type TreeNode = {
  /** The absolute path — the only thing the API needs to know. */
  id: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  /** Dirs: false until their children have been fetched once. */
  loaded: boolean;
  /** Dirs: [] (unloaded) or the fetched children. Files: null. */
  children: TreeNode[] | null;
};

/** Node ids are absolute paths; a child's id is its parent's path + name. */
function childId(parentPath: string, name: string): string {
  return `${parentPath.replace(/[\\/]+$/, '')}/${name}`;
}

function nodeFromEntry(parentPath: string, entry: FilesEntry): TreeNode {
  return {
    id: childId(parentPath, entry.name),
    name: entry.name,
    kind: entry.kind,
    size: entry.size,
    loaded: false,
    children: entry.kind === 'dir' ? [] : null,
  };
}

/** Immutably replace one node's children by id, anywhere in the tree. */
function patchChildren(nodes: TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, loaded: true, children };
    if (node.children !== null) {
      return { ...node, children: patchChildren(node.children, id, children) };
    }
    return node;
  });
}

/* -------------------------------------------------------------- shiki --- */

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],
      langs: [
        'ts', 'tsx', 'js', 'jsx', 'json', 'markdown', 'bash', 'html', 'css',
        'yaml', 'sql', 'python', 'go', 'rust', 'toml', 'ini', 'diff', 'plaintext',
      ],
    });
  }
  return highlighterPromise;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'html', htm: 'html', css: 'css', scss: 'css',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', conf: 'ini',
  sql: 'sql', py: 'python', go: 'go', rs: 'rust',
  diff: 'diff', patch: 'diff',
};

function langFor(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return LANG_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? 'plaintext';
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((highlighter) => highlighter.codeToHtml(code, { lang: lang as BuiltinLanguage, theme: 'github-dark' }))
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        // Highlighting is progressive enhancement; the plain fallback below
        // stays visible when a grammar fails to load.
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html === null) {
    return (
      <pre className="frank-md-pre my-3 overflow-x-auto rounded-xl border border-line bg-ink/90 px-4 py-3.5 text-[12.5px] leading-[1.55] text-white">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <div
      className="my-3 overflow-x-auto rounded-xl border border-line [&_pre]:px-4 [&_pre]:py-3.5"
      // shiki emits a complete <pre class="shiki"> with inline token colors.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MarkdownView({ content }: { content: string }) {
  return (
    <div className="frank-md text-[13.5px] leading-[1.6] text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent" />
          ),
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className ?? '');
            if (match !== null) {
              return <HighlightedCode code={String(children)} lang={match[1] ?? 'plaintext'} />;
            }
            return (
              <code
                className="rounded-[5px] bg-ink/8 px-[5px] py-[1px] font-mono text-[12.5px] text-accent"
                {...props}
              >
                {children}
              </code>
            );
          },
          // HighlightedCode already renders its own <pre>; the wrapper must
          // not double-wrap it.
          pre: ({ node, children }) => <>{children}</>,
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border-b border-line px-2.5 py-1.5 text-left font-semibold text-ink" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border-b border-line px-2.5 py-1.5 align-top text-ink2" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function rootDisplayName(path: string): string {
  const last = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop();
  return last ?? path;
}

/* ------------------------------------------------------------- page --- */

export function FilesPageClient() {
  const { api, status } = useAuth();

  const [rootLabel, setRootLabel] = useState<string | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [view, setView] = useState<{ name: string; path: string; size: number; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [treeHeight, setTreeHeight] = useState(400);

  const treeAreaRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, NodeApi<TreeNode>>());
  const viewPathRef = useRef<string | null>(null);

  // HTML5Backend (react-arborist's internal DndProvider) needs a browser.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const area = treeAreaRef.current;
    if (!area) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (typeof height === 'number' && height > 0) setTreeHeight(Math.floor(height));
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [mounted]);

  const loadRoot = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const listing = await fetchFiles(api);
      if (listing.kind !== 'dir') return;
      setRootLabel(rootDisplayName(listing.path));
      setNodes(listing.entries.map((entry) => nodeFromEntry(listing.path, entry)));
    } catch (err) {
      setError(problemMessage(err instanceof ApiError ? err.problem : null, 'Could not load the files root.'));
    }
  }, [api]);

  useEffect(() => {
    if (status === 'ready' && api) void loadRoot();
  }, [status, api, loadRoot]);

  const loadChildren = useCallback(
    async (node: NodeApi<TreeNode>) => {
      if (!api || node.data.kind !== 'dir' || node.data.loaded) return;
      try {
        const listing = await fetchFiles(api, node.data.id);
        if (listing.kind !== 'dir') return;
        const children = listing.entries.map((entry) => nodeFromEntry(listing.path, entry));
        setNodes((prev) => patchChildren(prev, node.data.id, children));
      } catch (err) {
        setError(problemMessage(err instanceof ApiError ? err.problem : null, 'Could not load this directory.'));
      }
    },
    [api],
  );

  const onToggle = useCallback(
    (id: string) => {
      const node = nodeRefs.current.get(id);
      if (node !== undefined && node.data.kind === 'dir' && !node.data.loaded) {
        void loadChildren(node);
      }
    },
    [loadChildren],
  );

  const openFile = useCallback(
    async (node: NodeApi<TreeNode>) => {
      if (!api || node.data.kind !== 'file' || viewPathRef.current === node.data.id) return;
      setError(null);
      try {
        const file = await fetchFiles(api, node.data.id);
        if (file.kind !== 'file') return;
        viewPathRef.current = file.path;
        setView({ name: file.name, path: file.path, size: file.size, content: file.content });
      } catch (err) {
        setError(problemMessage(err instanceof ApiError ? err.problem : null, 'This file could not be read.'));
      }
    },
    [api],
  );

  const NodeRow = useCallback(
    ({ node, style }: NodeRendererProps<TreeNode>) => {
      nodeRefs.current.set(node.id, node);
      const isDir = node.data.kind === 'dir';
      return (
        <div
          style={style}
          className={`flex items-center gap-1.5 pr-2 text-[12.5px] ${
            node.isSelected ? 'bg-accent/15 text-ink' : 'text-ink2'
          }`}
        >
          <button
            onClick={(event) => {
              event.stopPropagation();
              node.toggle();
            }}
            aria-label={node.isOpen ? `Collapse ${node.data.name}` : `Expand ${node.data.name}`}
            className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink ${
              isDir ? 'visible' : 'invisible'
            }`}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              className={`transition-transform ${node.isOpen ? 'rotate-90' : ''}`}
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
          <span className="shrink-0 text-[13px] leading-none">{isDir ? '📁' : '📄'}</span>
          <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
          {!isDir && node.data.size > 0 && (
            <span className="shrink-0 font-mono text-[9.5px] text-muted">{formatBytes(node.data.size)}</span>
          )}
        </div>
      );
    },
    [],
  );

  const isMarkdown = view !== null && /\.md(?:$|\.)/i.test(view.name);

  return (
    <div className="flex h-dvh flex-col bg-shell text-ink">
      {/* header */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-rail px-4">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          ← Home
        </a>
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Files</span>
        <span className="hidden max-w-[40%] truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted/80 sm:block">
          {rootLabel ?? '…'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted/70">read-only</span>
      </header>

      {error !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12px] text-ink">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-[11px] font-medium text-muted transition-colors hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* tree pane */}
        <aside className="w-[300px] shrink-0 border-r border-line bg-rail">
          <div ref={treeAreaRef} className="h-full overflow-hidden px-2 pb-2 pt-2">
            {!mounted || status !== 'ready' ? (
              <p className="px-2.5 py-3 text-[12px] text-muted/80">Loading…</p>
            ) : (
              <Tree<TreeNode>
                data={nodes}
                width="100%"
                height={treeHeight}
                rowHeight={30}
                indent={14}
                openByDefault={false}
                disableDrag
                disableDrop
                disableEdit
                disableMultiSelection
                disableDeselectOnClick
                onToggle={onToggle}
                onActivate={openFile}
                className="text-[12.5px]"
                aria-label="Project files"
              >
                {NodeRow}
              </Tree>
            )}
          </div>
        </aside>

        {/* viewer pane */}
        <main className="min-w-0 flex-1 overflow-auto bg-shell">
          {view === null ? (
            <div className="flex h-full items-center justify-center">
              <p className="max-w-[320px] text-center text-[12.5px] leading-relaxed text-muted/80">
                Select a file to read it. Markdown renders formatted; every other text file is shown with syntax
                highlighting. The files browser is read-only.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-[860px] px-6 py-5">
              <div className="mb-3 flex items-baseline gap-2.5">
                <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{view.name}</h1>
                <span className="shrink-0 font-mono text-[10px] text-muted">{formatBytes(view.size)}</span>
              </div>
              <p className="mb-4 truncate font-mono text-[10.5px] text-muted/80">{view.path}</p>
              {isMarkdown ? (
                <MarkdownView content={view.content} />
              ) : (
                <HighlightedCode code={view.content} lang={langFor(view.name)} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
