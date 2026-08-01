'use client';

import { useEffect, useState } from 'react';

/** Live view of the harness registry + per-room routes (spec §8.4). */

export interface ProviderInfo {
  id: string;
  label: string;
  blurb: string;
  healthy: boolean;
}

interface ProvidersResponse {
  providers: ProviderInfo[];
  routes: Record<string, string>;
}

export function useHarnesses(): {
  providers: ProviderInfo[];
  routes: Record<string, string>;
  loading: boolean;
} {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error('bad status');
        const data = (await res.json()) as ProvidersResponse;
        if (!alive) return;
        setProviders(data.providers);
        setRoutes(data.routes);
      } catch {
        /* leave empty */
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  return { providers, routes, loading };
}
