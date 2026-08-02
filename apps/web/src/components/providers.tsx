'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  makeApiFetch,
  type ApiFetch,
  type DevSession,
  type TodayResponse,
  type WorkListResponse,
} from '@/lib/api';
import { TIME_ZONE } from '@/lib/time';
import { IconAlert } from './icons';

/* ------------------------------------------------------------------ */
/* Auth — dev-session mint on mount, silent re-mint on 401             */
/* ------------------------------------------------------------------ */

type AuthStatus = 'connecting' | 'ready' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  session: DevSession | null;
  error: string | null;
  api: ApiFetch | null;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  status: 'connecting',
  session: null,
  error: null,
  api: null,
  retry: () => {},
});

async function mintSession(): Promise<DevSession> {
  const res = await fetch('/v1/auth/dev-session', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Session request failed (${res.status})`);
  }
  return (await res.json()) as DevSession;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('connecting');
  const [session, setSession] = useState<DevSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<DevSession | null>(null);
  const minting = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('connecting');
    setError(null);

    mintSession()
      .then((s) => {
        if (cancelled) return;
        sessionRef.current = s;
        setSession(s);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not reach Frank');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** Re-mint (single-flight). Used by the api fetcher on 401. */
  const reauth = useCallback(async (): Promise<string> => {
    if (!minting.current) {
      minting.current = mintSession()
        .then((s) => {
          sessionRef.current = s;
          setSession(s);
          return s.access_token;
        })
        .finally(() => {
          minting.current = null;
        });
    }
    return minting.current;
  }, []);

  const api = useMemo<ApiFetch | null>(() => {
    if (!session) return null;
    return makeApiFetch(() => sessionRef.current?.access_token ?? null, reauth);
  }, [session, reauth]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, error, api, retry: () => setAttempt((n) => n + 1) }),
    [status, session, error, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * The room renders immediately (so the Central shell is present even before
 * the session mints); auth failure surfaces as a compact, recoverable card
 * overlaid in the chat column instead of blanking the whole app.
 */
export function AuthErrorCard() {
  const { status, error, retry } = useAuth();
  if (status !== 'error') return null;

  return (
    <div className="mx-5 mb-4 flex shrink-0 items-start gap-3 rounded-2xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3.5 md:mx-7">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#DC2626]/10 text-[#DC2626]">
        <IconAlert size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[12.5px] font-semibold text-ink">Can&rsquo;t reach Frank&rsquo;s cell</b>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
          {error ?? 'The session request failed.'} The API may be restarting.
        </p>
      </div>
      <button
        onClick={retry}
        className="inline-flex h-7 shrink-0 items-center rounded-lg bg-ink px-3 text-[11.5px] font-semibold text-white transition-colors hover:bg-ink2"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Legacy full-screen gate — kept for callers that want a hard boot screen.
 * The shell no longer uses it; the room renders behind the session mint.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error, retry } = useAuth();

  if (status === 'connecting') {
    return (
      <div className="flex h-dvh items-center justify-center bg-shell">
        <div className="animate-msg-in flex flex-col items-center gap-4">
          <span className="animate-pip grid h-11 w-11 place-items-center rounded-xl bg-ink font-display text-[22px] font-bold text-white">
            F
          </span>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted/70">
            waking frank…
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-dvh items-center justify-center bg-shell px-6">
        <div className="animate-msg-in w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-full bg-[#DC2626]/10 text-[#DC2626]">
            <IconAlert size={17} />
          </div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
            Can&rsquo;t reach Frank
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {error ?? 'The session request failed.'} The API may be restarting — try again in a
            moment.
          </p>
          <button
            onClick={retry}
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-ink2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/* Living-frame data — /v1/today + /v1/work, refreshed on a slow poll  */
/* ------------------------------------------------------------------ */

interface DataContextValue {
  today: TodayResponse | null;
  work: WorkListResponse | null;
  loading: boolean;
}

const DataContext = createContext<DataContextValue>({
  today: null,
  work: null,
  loading: true,
});

export function DataProvider({ children }: { children: ReactNode }) {
  const { api, status } = useAuth();
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [work, setWork] = useState<WorkListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api || status !== 'ready') return;
    let cancelled = false;

    const load = async () => {
      try {
        const [t, w] = await Promise.all([
          api(`/v1/today?timezone=${encodeURIComponent(TIME_ZONE)}`).then(
            (r) => r.json() as Promise<TodayResponse>,
          ),
          api('/v1/work?limit=25&sort=updated_at&order=desc').then(
            (r) => r.json() as Promise<WorkListResponse>,
          ),
        ]);
        if (cancelled) return;
        setToday(t);
        setWork(w);
      } catch {
        // quiet — the frame shows its warm-up state; the chat keeps working
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, status]);

  const value = useMemo(() => ({ today, work, loading }), [today, work, loading]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  return useContext(DataContext);
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  push: (tone: ToastTone, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-slide-in pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-ink shadow-[0_8px_30px_rgba(11,13,10,0.16)] ${
              t.tone === 'success'
                ? 'border-success/40'
                : t.tone === 'error'
                  ? 'border-danger/40'
                  : 'border-line'
            }`}
          >
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                t.tone === 'success' ? 'bg-success' : t.tone === 'error' ? 'bg-danger' : 'bg-muted/50'
              }`}
            />
            <p className="text-[12.5px] font-medium leading-snug">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/* ------------------------------------------------------------------ */
/* Root composition — wraps the app in the layout                    */
/* ------------------------------------------------------------------ */

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>{children}</DataProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
