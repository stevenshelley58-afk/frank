'use client';

import { useEffect, useState } from 'react';

export type DelegationStatus = 'proposed' | 'running' | 'done' | 'error' | 'rejected';

export interface Delegation {
  id: string;
  key: string;
  task: string;
  why: string;
  fromRoomId: string;
  toRoomId: string;
  toRoomName: string;
  agent: string;
  status: DelegationStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  partial: string;
  result?: string;
  error?: string;
}

type Evt =
  | { type: 'snapshot'; items: Delegation[] }
  | { type: 'created'; d: Delegation }
  | { type: 'update'; d: Delegation };

/**
 * Live delegation list from the server. Reconnects automatically; state is
 * server-owned, so a refresh restores everything including in-flight runs.
 */
export function useDelegations(): Delegation[] {
  const [items, setItems] = useState<Delegation[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/delegations');
    es.onmessage = (m) => {
      let evt: Evt;
      try {
        evt = JSON.parse(m.data) as Evt;
      } catch {
        return;
      }
      setItems((prev) => {
        if (evt.type === 'snapshot') return evt.items;
        const next = prev.filter((x) => x.id !== evt.d.id);
        return [evt.d, ...next].sort((a, b) => b.createdAt - a.createdAt);
      });
    };
    return () => es.close();
  }, []);

  return items;
}

export async function actOnDelegation(id: string, action: 'approve' | 'reject'): Promise<void> {
  await fetch(`/api/delegations/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {});
}
