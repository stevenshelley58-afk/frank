'use client';

import { useEffect, useState } from 'react';

import type { WorkbenchDetail } from './types';
import { WORKBENCH_API } from './types';

export interface WorkbenchDetailResult {
  readonly detail: WorkbenchDetail | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** Fetch the durable plan/receipt snapshot through the same-origin BFF. */
export function useWorkbenchDetail(
  workbenchId: string,
  refreshKey: number | null = null,
): WorkbenchDetailResult {
  const [detail, setDetail] = useState<WorkbenchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workbenchId) return;
    const controller = new AbortController();
    setDetail((current) =>
      current?.workbench.id === workbenchId ? current : null,
    );
    setLoading(true);
    setError(null);

    fetch(WORKBENCH_API.get(workbenchId), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<WorkbenchDetail>;
      })
      .then((next) => {
        if (controller.signal.aborted) return;
        setDetail(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [workbenchId, refreshKey]);

  return { detail, loading, error };
}
