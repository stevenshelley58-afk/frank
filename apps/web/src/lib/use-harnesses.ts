'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Live view of the harness registry + per-room routes (spec §8.4). */

export interface ProviderInfo {
  id: string;
  label: string;
  blurb: string;
  healthy: boolean;
  /** What model the harness reports it is running right now. */
  model?: string | null;
  modelProvider?: string | null;
  expectedModel?: string | null;
  modelMismatch?: boolean;
  /** Explicit selections this provider can execute for the current health state. */
  models?: Array<{ id: string; name: string; short: string; sub: string }>;
}

interface ProvidersResponse {
  providers: ProviderInfo[];
  routes: Record<string, string>;
}

export function useHarnesses(): {
  providers: ProviderInfo[];
  routes: Record<string, string>;
  loading: boolean;
  refresh: () => Promise<boolean>;
} {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/providers', { cache: 'no-store' });
      if (!res.ok) return false;
      const data = (await res.json()) as ProvidersResponse;
      if (!mounted.current) return false;
      setProviders(data.providers);
      setRoutes(data.routes);
      return true;
    } catch {
      return false;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const t = window.setInterval(() => { void refresh(); }, 20_000);
    return () => {
      mounted.current = false;
      window.clearInterval(t);
    };
  }, [refresh]);

  return { providers, routes, loading, refresh };
}
