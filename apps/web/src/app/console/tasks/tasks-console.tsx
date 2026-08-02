'use client';

import { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Tasks console — Frank's work board (API) + Plane + Google Tasks.    */
/* ------------------------------------------------------------------ */

interface WorkItem {
  id: string;
  title: string;
  state: string;
  priority: string;
  updated_at: string;
}

const STATE_COLORS: Record<string, string> = {
  inbox: 'bg-muted/20 text-muted',
  planned: 'bg-accent/10 text-accent',
  ready: 'bg-accent/10 text-accent',
  active: 'bg-success/10 text-success',
  waiting: 'bg-[#f59e0b]/10 text-[#b45309]',
  blocked: 'bg-[#DC2626]/10 text-[#DC2626]',
  done: 'bg-success/10 text-success',
  cancelled: 'bg-muted/10 text-muted/60',
  failed: 'bg-[#DC2626]/10 text-[#DC2626]',
};

const PRIORITY_DOTS: Record<string, string> = {
  critical: 'bg-[#DC2626]',
  high: 'bg-[#f59e0b]',
  normal: 'bg-accent',
  low: 'bg-muted/50',
  none: 'bg-transparent',
};

export function TasksConsole() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        // Get a dev session first
        const authRes = await fetch('/v1/auth/dev-session', { method: 'POST' });
        if (!authRes.ok) throw new Error('auth failed');
        const session = await authRes.json();
        const token = session.access_token;

        const res = await fetch('/v1/work?limit=50&sort=updated_at&order=desc', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (alive) {
          setItems(data.items ?? []);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(String(err));
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // Group by state
  const groups = items.reduce<Record<string, WorkItem[]>>((acc, item) => {
    const key = item.state;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const stateOrder = ['active', 'ready', 'planned', 'inbox', 'waiting', 'blocked', 'done', 'cancelled', 'failed'];
  const orderedStates = stateOrder.filter((s) => groups[s]?.length);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold text-ink">Tasks</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Frank&apos;s work board — the 11-state machine. Plane and Google Tasks mirror land here
          once deployed.
        </p>
      </div>

      {/* Engine status cards */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <EngineCard
          title="Frank DB"
          status="live"
          detail={`${items.length} work items`}
        />
        <EngineCard
          title="Plane"
          status="deploying"
          detail="Self-hosted PM engine"
        />
        <EngineCard
          title="Google Tasks"
          status="planned"
          detail="Pixel 10 mirror"
        />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-[12.5px] text-[#DC2626]">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-muted">Loading work items…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
          <p className="text-[13px] text-muted">
            No work items yet. Tell Frank something in Central and it&apos;ll land here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {orderedStates.map((state) => (
            <div key={state}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATE_COLORS[state] ?? 'bg-muted/10 text-muted'}`}
                >
                  {state}
                </span>
                <span className="font-mono text-[10px] text-muted/60">
                  {groups[state].length}
                </span>
              </div>
              <div className="space-y-1.5">
                {groups[state].map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2.5"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOTS[item.priority] ?? 'bg-transparent'}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {item.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted/60">
                      {relTime(item.updated_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EngineCard({
  title,
  status,
  detail,
}: {
  title: string;
  status: 'live' | 'deploying' | 'planned';
  detail: string;
}) {
  const dot =
    status === 'live' ? 'bg-success' : status === 'deploying' ? 'bg-accent animate-pip' : 'bg-muted/40';
  const label =
    status === 'live' ? 'live' : status === 'deploying' ? 'deploying…' : 'planned';
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <b className="text-[13px] font-semibold text-ink">{title}</b>
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        {detail} · <span className="font-mono text-[10px] uppercase">{label}</span>
      </p>
    </div>
  );
}

function relTime(iso: string): string {
  const age = Date.now() - Date.parse(iso);
  const mins = Math.floor(age / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
