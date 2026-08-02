'use client';

/**
 * Console Previews — browse every hosted preview, grouped by topic, versioned.
 *
 * Reads /api/previews which scans the preview static directory. Each topic
 * shows its version chain (v1 → v2 → v3…) with the latest flagged. Links
 * go straight to preview.frank.fail.
 */
import { useCallback, useEffect, useState } from 'react';

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

type PreviewsResponse = { topics: TopicGroup[]; total: number };

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function PreviewsBrowser() {
  const [data, setData] = useState<PreviewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/previews');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
          <span className="text-[13px]">Loading previews…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-[13px] text-danger">{error}</p>
          <button
            onClick={() => { setLoading(true); load(); }}
            className="mt-3 rounded-lg border border-line bg-card px-4 py-2 text-[12px] font-medium text-ink transition-colors hover:bg-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="mx-auto max-w-sm text-center">
          <div className="text-[28px]">🖥️</div>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            No previews yet. When an agent builds something, it deploys here first.
          </p>
          <p className="mt-2 rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-[11px] text-ink2">
            preview-deploy.sh &lt;topic&gt; &lt;source&gt;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-[20px] font-bold text-ink">Previews</h1>
            <p className="mt-1 text-[13px] text-muted">
              {data.total} preview{data.total !== 1 ? 's' : ''} across {data.topics.length} topic{data.topics.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => { setLoading(true); load(); }}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-hover"
          >
            Refresh
          </button>
        </div>

        {data.topics.map((group) => (
          <div key={group.topic} className="mb-6">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                {group.topic}
              </span>
              <span className="rounded-full bg-rail px-2 py-0.5 font-mono text-[10px] text-muted">
                {group.versions.length} version{group.versions.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {group.versions.map((v) => {
                const isLatest = v.slug === group.latest;
                return (
                  <div
                    key={v.slug}
                    className={`flex items-center gap-3.5 rounded-xl border bg-card px-4 py-3 transition-all duration-200 ${
                      isLatest
                        ? 'border-line hover:border-accent/40 hover:shadow-[0_6px_20px_-12px_rgba(28,25,23,0.25)]'
                        : 'border-line opacity-70 hover:opacity-90'
                    }`}
                  >
                    {/* Version badge */}
                    <span
                      className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-medium ${
                        isLatest
                          ? 'border-success/35 bg-success/10 text-[#4a7a0a]'
                          : 'border-line bg-subtle text-ink2'
                      }`}
                    >
                      {v.version > 0 ? `v${v.version}` : '—'}
                    </span>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-ink">
                        {v.slug}
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {timeAgo(v.deployed_at)} · {v.file_count} file{v.file_count !== 1 ? 's' : ''} · {fmtSize(v.total_size)}
                      </div>
                    </div>

                    {/* Status */}
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${isLatest ? 'bg-success' : 'bg-line'}`}
                      />
                      <span className={isLatest ? 'text-[#4a7a0a]' : 'text-muted'}>
                        {isLatest ? 'latest' : 'superseded'}
                      </span>
                    </span>

                    {/* Open link */}
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[12px] font-medium text-accent hover:underline"
                    >
                      Open ↗
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
