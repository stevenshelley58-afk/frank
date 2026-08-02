'use client';

/**
 * Memory control surface — BRAIN-006, FRANK-§4.6.
 *
 * The one place a human reviews and prunes what Frank remembers. Talks ONLY to
 * /api/memory, which talks ONLY to the MemoryProvider port — there is no other
 * path to the data. Every memory is reviewable (list), editable (rewrite),
 * expirable (set an expiry), and deletable (remove). Scope selector mirrors the
 * room model: Central (whole-owner), then each project room.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface StoredFactView {
  id: string;
  fact: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

interface ListResponse {
  backend: string;
  healthy: boolean;
  facts: StoredFactView[];
}

const SCOPES: Array<{ id: string; label: string; sub: string }> = [
  { id: '', label: 'Central', sub: 'whole-owner · everything Frank knows' },
  { id: 'blockwise', label: 'Blockwise', sub: 'Meta ads · project-scoped' },
  { id: 'chase', label: "Chase's Game", sub: 'life project · project-scoped' },
  { id: 'merrypaws', label: 'MerryPaws', sub: 'pet ops · project-scoped' },
  { id: 'lotfile', label: 'LotFile', sub: 'docs & lots · project-scoped' },
];

function scopeQuery(roomId: string): string {
  return roomId ? `?roomId=${encodeURIComponent(roomId)}` : '';
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return !Number.isNaN(t) && t < Date.now();
}

export function MemoryConsole() {
  const [roomId, setRoomId] = useState('');
  const [backend, setBackend] = useState('—');
  const [healthy, setHealthy] = useState(false);
  const [facts, setFacts] = useState<StoredFactView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Row interaction state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add form
  const [newFact, setNewFact] = useState('');
  const [adding, setAdding] = useState(false);

  const activeScope = useMemo(
    () => SCOPES.find((s) => s.id === roomId) ?? SCOPES[0]!,
    [roomId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory${scopeQuery(roomId)}`, { cache: 'no-store' });
      const data: ListResponse = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error ?? res.statusText);
      setBackend(data.backend);
      setHealthy(data.healthy);
      setFacts(data.facts);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    setBusyId(id);
    try {
      const res = await fetch('/api/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, fact: text }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`edit failed: ${String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function expireIn(id: string, hours: number) {
    setBusyId(id);
    try {
      const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
      const res = await fetch('/api/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, expiresAt }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      await load();
    } catch (err) {
      setError(`expire failed: ${String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(`delete failed: ${String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function addFact() {
    const text = newFact.trim();
    if (!text) return;
    setAdding(true);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: roomId || undefined,
          messages: [{ role: 'user', content: text }],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setNewFact('');
      await load();
    } catch (err) {
      setError(`add failed: ${String(err)}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-5 py-5">
      {/* Scope rail */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SCOPES.map((s) => {
          const active = s.id === roomId;
          return (
            <button
              key={s.id}
              onClick={() => setRoomId(s.id)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-line bg-card text-muted hover:border-line hover:text-ink2'
              }`}
            >
              {s.label}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide">
          <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-success' : 'bg-red-400'}`} />
          <span className={healthy ? 'text-success' : 'text-red-500'}>
            {backend}
          </span>
        </span>
      </div>

      <p className="mt-2 text-[12.5px] text-muted">{activeScope.sub}</p>

      {/* Add a memory */}
      <div className="mt-4 flex items-center gap-2">
        <input
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addFact();
          }}
          placeholder={`Add a memory to ${activeScope.label}…`}
          className="flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none placeholder:text-muted/60 focus:border-accent/50"
        />
        <button
          onClick={() => void addFact()}
          disabled={adding || !newFact.trim()}
          className="rounded-lg border border-line bg-ink px-3 py-2 text-[12.5px] font-medium text-rail transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-600">
          {error}
        </div>
      )}

      {/* List */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-10 text-center text-[12.5px] text-muted">Loading memories…</div>
        ) : facts.length === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-muted">
            Nothing stored in {activeScope.label} yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {facts.map((f) => {
              const editing = editingId === f.id;
              const confirming = confirmDeleteId === f.id;
              const busy = busyId === f.id;
              const expired = isExpired(f.expiresAt);
              return (
                <li
                  key={f.id}
                  className={`rounded-xl border bg-card p-3 transition-colors ${
                    expired ? 'border-line opacity-60' : 'border-line'
                  }`}
                >
                  {editing ? (
                    <div className="flex items-start gap-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="flex-1 resize-y rounded-lg border border-accent/40 bg-card px-3 py-2 text-[13px] text-ink outline-none"
                        autoFocus
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => void saveEdit(f.id)}
                          disabled={busy || !editText.trim()}
                          className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:text-ink2"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13.5px] leading-snug text-ink">{f.fact}</p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-muted">
                    <span>added {fmtDate(f.createdAt)}</span>
                    {f.expiresAt && (
                      <span className={expired ? 'text-red-500' : 'text-accent'}>
                        {expired ? 'expired' : 'expires'} {fmtDate(f.expiresAt)}
                      </span>
                    )}
                  </div>

                  {!editing && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => {
                          setEditingId(f.id);
                          setEditText(f.fact);
                        }}
                        className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink2 hover:border-accent/40 hover:text-accent"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void expireIn(f.id, 24)}
                        className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink2 hover:border-accent/40 hover:text-accent"
                      >
                        Expire 24h
                      </button>
                      {f.expiresAt && !expired && (
                        <button
                          onClick={() => void expireIn(f.id, 100 * 365 * 24)}
                          className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink2 hover:text-ink2"
                        >
                          Clear expiry
                        </button>
                      )}

                      {confirming ? (
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="text-[11px] text-red-500">Delete permanently?</span>
                          <button
                            onClick={() => void remove(f.id)}
                            disabled={busy}
                            className="rounded-md bg-red-500 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
                          >
                            {busy ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:text-ink2"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(f.id)}
                          className="ml-auto rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-red-500 hover:border-red-300 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
