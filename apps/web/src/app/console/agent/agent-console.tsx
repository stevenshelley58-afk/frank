'use client';

import { useCallback, useEffect, useState } from 'react';
import { useHarnesses, type ProviderInfo } from '@/lib/use-harnesses';
import { DEFAULT_ROOMS } from '@/lib/rooms';

/* ------------------------------------------------------------------ */
/* Agent Runtime console — Goose health, sessions, provider routes.    */
/* ------------------------------------------------------------------ */

interface SessionInfo {
  roomId: string;
  providerId: string;
  primed: boolean;
}

interface RunState {
  providers: ProviderInfo[];
  routes: Record<string, string>;
  sessions: SessionInfo[];
  gooseLatencyMs: number | null;
  lastCheck: number;
}

const ROOM_LABELS: Record<string, string> = {
  central: 'Central',
  blockwise: 'Blockwise',
  chase: "Chase's Game",
  merrypaws: 'MerryPaws',
  lotfile: 'LotFile',
};

export function AgentConsole() {
  const { providers, routes, loading } = useHarnesses();
  const [latency, setLatency] = useState<number | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState(Date.now());

  // Measure Goose latency via the providers endpoint.
  const probe = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/providers');
      if (res.ok) {
        setLatency(Math.round(performance.now() - t0));
        setLastCheck(Date.now());
      }
    } catch {
      setLatency(null);
    }
  }, []);

  useEffect(() => {
    probe();
    const t = window.setInterval(probe, 15_000);
    return () => window.clearInterval(t);
  }, [probe]);

  async function swapRoute(roomId: string, providerId: string) {
    setSwapping(roomId);
    try {
      await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, providerId }),
      });
    } catch {
      /* toast would go here */
    } finally {
      setSwapping(null);
      probe();
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-[13px] text-muted">Probing agent runtime…</p>
      </div>
    );
  }

  const goose = providers.find((p) => p.id === 'goose');
  const allRooms = DEFAULT_ROOMS.map((r) => r.id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* status header */}
      <div className="mb-8 flex items-center gap-4">
        <span
          className={`grid h-10 w-10 place-items-center rounded-xl ${
            goose?.healthy ? 'bg-success/10 text-success' : 'bg-[#DC2626]/10 text-[#DC2626]'
          }`}
        >
          <span className={`h-3 w-3 rounded-full ${goose?.healthy ? 'bg-success' : 'bg-[#DC2626]'} animate-pip`} />
        </span>
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Agent Runtime</h1>
          <p className="text-[12.5px] text-muted">
            {goose?.healthy ? 'Goose ACP is healthy' : 'Goose ACP is unreachable'}
            {latency !== null && ` · ${latency}ms round-trip`}
            {' · checked '}
            {new Date(lastCheck).toLocaleTimeString('en-AU', {
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            })}
          </p>
        </div>
        <button
          onClick={probe}
          className="ml-auto rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:border-accent/40 hover:text-accent"
        >
          Re-probe
        </button>
      </div>

      {/* providers */}
      <section className="mb-8">
        <SectionTitle>Registered Providers</SectionTitle>
        <div className="space-y-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${p.healthy ? 'bg-success' : 'bg-[#DC2626]'}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="text-[13px] font-semibold text-ink">{p.label}</b>
                  <span className="rounded-full bg-subtle px-2 py-0.5 font-mono text-[10px] text-muted">
                    {p.id}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-muted">{p.blurb}</p>
              </div>
              <span
                className={`font-mono text-[10px] uppercase tracking-wide ${
                  p.healthy ? 'text-success' : 'text-[#DC2626]'
                }`}
              >
                {p.healthy ? 'healthy' : 'down'}
              </span>
            </div>
          ))}
          {providers.length === 0 && (
            <p className="text-[12.5px] text-muted">No providers registered.</p>
          )}
        </div>
      </section>

      {/* room routes */}
      <section className="mb-8">
        <SectionTitle>Room → Harness Routes</SectionTitle>
        <p className="mb-3 text-[12px] leading-relaxed text-muted">
          Each room resolves its harness via the broker. &ldquo;Auto&rdquo; picks the first
          healthy provider. Pin a room to a named harness to override.
        </p>
        <div className="space-y-2">
          {allRooms.map((roomId) => {
            const route = routes[roomId] ?? 'auto';
            const label = ROOM_LABELS[roomId] ?? roomId;
            const room = DEFAULT_ROOMS.find((r) => r.id === roomId);
            return (
              <div
                key={roomId}
                className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-ink/10"
                  style={{ background: room?.tint ?? '#1c1917' }}
                />
                <b className="text-[13px] font-semibold text-ink">{label}</b>
                <span className="font-mono text-[11px] text-muted">{room?.agent}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => swapRoute(roomId, p.id)}
                      disabled={swapping === roomId}
                      className={`rounded-lg px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-all ${
                        route === p.id
                          ? 'bg-accent text-white'
                          : 'border border-line text-muted hover:border-accent/40 hover:text-accent'
                      } disabled:opacity-40`}
                    >
                      {p.id}
                    </button>
                  ))}
                  <button
                    onClick={() => swapRoute(roomId, 'auto')}
                    disabled={swapping === roomId}
                    className={`rounded-lg px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-all ${
                      route === 'auto'
                        ? 'bg-ink text-white'
                        : 'border border-line text-muted hover:border-accent/40 hover:text-accent'
                    } disabled:opacity-40`}
                  >
                    auto
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* architecture note */}
      <section>
        <SectionTitle>Architecture</SectionTitle>
        <div className="rounded-xl border border-line bg-white px-4 py-4 text-[12.5px] leading-relaxed text-ink2">
          <p>
            Every room talks to one <b>harness</b> — an agent runtime behind the{' '}
            <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[11px]">ChatProvider</code>{' '}
            interface. Goose ACP is the current default; new harnesses (Hermes, Codex, Claude Code)
            slot in by implementing the interface and registering — no core change.
          </p>
          <p className="mt-2">
            Per-room routes are hot-swappable at runtime via this console or the{' '}
            <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[11px]">POST /api/providers</code>{' '}
            endpoint. The broker explains its selection in plain language (spec §8.4).
          </p>
          <p className="mt-2 text-muted">
            Sessions persist server-side per room. A harness swap re-creates the session and
            re-primes the room identity on the next turn.
          </p>
        </div>
      </section>
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
