'use client';

import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/* ------------------------------------------------------------------ */
/* Research Pipeline console — Blockwise research engine health + jobs */
/* Reads from the Blockwise research health API via a Frank proxy.     */
/* ------------------------------------------------------------------ */

interface ResearchHealth {
  app: string;
  service: string;
  status: string;
  checks?: Record<string, { ok: boolean; value: unknown }>;
  latest_fetch_started_at?: string | null;
  latest_ingest_at?: string | null;
  due_backlog_size?: number | null;
  blocked_job_count?: number | null;
  apify_state?: string | null;
  paid_spend_without_ingest?: boolean | null;
}

interface PipelineStage {
  id: string;
  name: string;
  description: string;
  status: 'ok' | 'warn' | 'error' | 'idle' | 'unknown';
}

const STAGES: PipelineStage[] = [
  { id: 'trigger', name: 'Trigger', description: 'Cron fires, selects due locations', status: 'unknown' },
  { id: 'fetch', name: 'Apify Fetch', description: 'Scrapes Meta Ad Library via Apify actors', status: 'unknown' },
  { id: 'ingest', name: 'Ingest', description: 'Raw ads → research DB (dedup, normalize)', status: 'unknown' },
  { id: 'enrich', name: 'Enrich', description: 'LLM tagging, creative analysis, swipe-file scoring', status: 'unknown' },
  { id: 'serve', name: 'Serve', description: 'REST API → Blockwise web (ad radar, swipe file)', status: 'unknown' },
];

export function ResearchConsole() {
  const [health, setHealth] = useState<ResearchHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState(Date.now());

  const probe = useCallback(async () => {
    try {
      const res = await fetch('/api/research-health');
      if (res.ok) {
        const data = (await res.json()) as ResearchHealth;
        setHealth(data);
      } else {
        setHealth({ app: 'blockwise', service: 'research', status: 'unreachable' });
      }
    } catch {
      setHealth({ app: 'blockwise', service: 'research', status: 'unreachable' });
    } finally {
      setLoading(false);
      setLastCheck(Date.now());
    }
  }, []);

  useEffect(() => {
    probe();
    const t = window.setInterval(probe, 30_000);
    return () => window.clearInterval(t);
  }, [probe]);

  const stages = deriveStages(health);
  const isUp = health?.status !== 'unreachable' && health?.status !== 'disabled';

  /* Track A5: skeleton while the first probe resolves — no layout jump,
     the pipeline cards shimmer in place. */
  if (loading && !health) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10" aria-label="Checking research pipeline status">
        <div className="mb-8 flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <div className="flex items-stretch gap-1.5">
          {STAGES.map((s) => (
            <Skeleton key={s.id} className="h-24 flex-1 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* header */}
      <div className="mb-8 flex items-center gap-4">
        <span
          className={`grid h-10 w-10 place-items-center rounded-xl ${
            isUp ? 'bg-success/10 text-success' : 'bg-[#DC2626]/10 text-[#DC2626]'
          }`}
        >
          <span className={`h-3 w-3 rounded-full ${isUp ? 'bg-success' : 'bg-[#DC2626]'} ${isUp ? '' : 'animate-pip'}`} />
        </span>
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Research Pipeline</h1>
          <p className="text-[12.5px] text-muted">
            {isUp
              ? `Research engine ${health?.status ?? 'running'}`
              : health?.status === 'disabled'
                ? 'Research is disabled in the current niche config'
                : 'Research engine unreachable'}
            {' · checked '}
            {new Date(lastCheck).toLocaleTimeString('en-AU', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); probe(); }}
          className="ml-auto rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:border-accent/40 hover:text-accent"
        >
          Re-probe
        </button>
      </div>

      {/* pipeline stages */}
      <section className="mb-8">
        <SectionTitle>Pipeline Stages</SectionTitle>
        <div className="flex items-stretch gap-1.5">
          {stages.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center gap-1.5">
              <div
                className={`flex-1 rounded-xl border px-3 py-3 ${
                  s.status === 'ok'
                    ? 'border-success/30 bg-success/[0.04]'
                    : s.status === 'warn'
                      ? 'border-[#f59e0b]/30 bg-[#f59e0b]/[0.04]'
                      : s.status === 'error'
                        ? 'border-[#DC2626]/30 bg-[#DC2626]/[0.04]'
                        : 'border-line bg-white'
                }`}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      s.status === 'ok'
                        ? 'bg-success'
                        : s.status === 'warn'
                          ? 'bg-[#f59e0b]'
                          : s.status === 'error'
                            ? 'bg-[#DC2626]'
                            : 'bg-muted/40'
                    }`}
                  />
                  <b className="text-[11.5px] font-semibold text-ink">{s.name}</b>
                </div>
                <p className="text-[10.5px] leading-snug text-muted">{s.description}</p>
              </div>
              {i < stages.length - 1 && (
                <span className="shrink-0 text-muted/40">→</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* health details */}
      {isUp && health && (
        <section className="mb-8">
          <SectionTitle>Health Metrics</SectionTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricCard
              label="Latest fetch"
              value={health.latest_fetch_started_at ? timeAgo(health.latest_fetch_started_at) : 'never'}
              ok={!!health.latest_fetch_started_at}
            />
            <MetricCard
              label="Latest ingest"
              value={health.latest_ingest_at ? timeAgo(health.latest_ingest_at) : 'never'}
              ok={!!health.latest_ingest_at}
            />
            <MetricCard
              label="Due backlog"
              value={String(health.due_backlog_size ?? 0)}
              ok={(health.due_backlog_size ?? 0) < 50}
              warn={(health.due_backlog_size ?? 0) >= 50}
            />
            <MetricCard
              label="Blocked jobs"
              value={String(health.blocked_job_count ?? 0)}
              ok={(health.blocked_job_count ?? 0) === 0}
              warn={(health.blocked_job_count ?? 0) > 0}
            />
            <MetricCard
              label="Apify state"
              value={health.apify_state ?? 'unknown'}
              ok={health.apify_state === 'ready' || health.apify_state === 'running'}
            />
            <MetricCard
              label="Paid spend w/o ingest"
              value={health.paid_spend_without_ingest ? 'YES ⚠' : 'no'}
              ok={!health.paid_spend_without_ingest}
              warn={!!health.paid_spend_without_ingest}
            />
          </div>
        </section>
      )}

      {/* checks detail */}
      {isUp && health?.checks && Object.keys(health.checks).length > 0 && (
        <section className="mb-8">
          <SectionTitle>Checks</SectionTitle>
          <div className="space-y-1.5">
            {Object.entries(health.checks).map(([key, check]) => (
              <div
                key={key}
                className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2.5"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${check.ok ? 'bg-success' : 'bg-[#DC2626]'}`}
                />
                <span className="flex-1 font-mono text-[12px] text-ink2">{key}</span>
                <span className="font-mono text-[11px] text-muted">
                  {typeof check.value === 'object' ? JSON.stringify(check.value) : String(check.value)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* architecture note */}
      <section>
        <SectionTitle>Architecture</SectionTitle>
        <div className="rounded-xl border border-line bg-white px-4 py-4 text-[12.5px] leading-relaxed text-ink2">
          <p>
            The research pipeline is owned by <b>Blockwise</b> — it scrapes the Meta Ad Library
            via Apify, ingests into a Supabase research DB, enriches with LLM tagging, and serves
            the ad radar + swipe file through Blockwise&apos;s REST API.
          </p>
          <p className="mt-2">
            Frank Console reads the pipeline&apos;s health endpoint read-only. The{' '}
            <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[11px]">pipeline-graph</code>{' '}
            package renders interactive traces (seed context → resolved prompt → outputs) when a
            specific job is selected.
          </p>
          <p className="mt-2 text-muted">
            Containers: research-gateway, research-db, research-rest, research-backup,
            listing-scraper, steel (browser).
          </p>
        </div>
      </section>
    </div>
  );
}

function deriveStages(health: ResearchHealth | null): PipelineStage[] {
  if (!health || health.status === 'unreachable') {
    return STAGES.map((s) => ({ ...s, status: 'idle' as const }));
  }
  if (health.status === 'disabled') {
    return STAGES.map((s) => ({ ...s, status: 'idle' as const }));
  }

  return STAGES.map((s) => {
    switch (s.id) {
      case 'trigger':
        return { ...s, status: health.latest_fetch_started_at ? 'ok' as const : 'warn' as const };
      case 'fetch':
        return {
          ...s,
          status:
            health.apify_state === 'ready' || health.apify_state === 'running'
              ? 'ok' as const
              : health.apify_state
                ? 'warn' as const
                : 'idle' as const,
        };
      case 'ingest':
        return {
          ...s,
          status: health.latest_ingest_at
            ? (health.due_backlog_size ?? 0) > 100
              ? 'warn' as const
              : 'ok' as const
            : 'warn' as const,
        };
      case 'enrich':
        return { ...s, status: 'idle' as const }; // no direct health signal yet
      case 'serve':
        return {
          ...s,
          status: health.blocked_job_count ? 'warn' as const : 'ok' as const,
        };
      default:
        return { ...s, status: 'idle' as const };
    }
  });
}

function MetricCard({
  label,
  value,
  ok,
  warn,
}: {
  label: string;
  value: string;
  ok?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted/70">{label}</p>
      <p
        className={`mt-1 text-[14px] font-semibold ${
          warn ? 'text-[#b45309]' : ok ? 'text-ink' : 'text-[#DC2626]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-muted/80">
      {children}
    </h2>
  );
}

function timeAgo(iso: string): string {
  const age = Date.now() - Date.parse(iso);
  const mins = Math.floor(age / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
