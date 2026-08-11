'use client';

/**
 * Channels console — room↔platform binding status (UI-09).
 *
 * Data flow (frozen contract — CH-06, merged on main):
 *  - room picker → GET  /v1/rooms/:roomId/channel-bindings → { bindings: [...] }
 *  - bind form   → POST /v1/rooms/:roomId/channel-bindings
 *                  body { platform, platform_conversation_id } + Idempotency-Key
 *  - revoke      → DELETE /v1/rooms/:roomId/channel-bindings/:id + Idempotency-Key
 *
 * Truthful health (never fake-healthy):
 *  - live binding (revoked_at === null)  → "active"
 *  - only revoked bindings               → "revoked"
 *  - no bindings at all                  → "not bound"
 *  - fetch failure                       → "status unavailable" — the web
 *    frame remains authoritative while the channel surface is down.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_ROOMS } from '@/lib/rooms';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Wire types — CH-06 routes/channels.ts on main                       */
/* ------------------------------------------------------------------ */

interface ChannelBinding {
  id: string;
  cell_id: string;
  room_id: string;
  platform: string;
  platform_conversation_id: string;
  /** null = active; ISO timestamp = revoked */
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

const CHANNELS_API = {
  listForRoom: (roomId: string) =>
    `/v1/rooms/${encodeURIComponent(roomId)}/channel-bindings`,
  bind: (roomId: string) =>
    `/v1/rooms/${encodeURIComponent(roomId)}/channel-bindings`,
  revoke: (roomId: string, bindingId: string) =>
    `/v1/rooms/${encodeURIComponent(roomId)}/channel-bindings/${encodeURIComponent(bindingId)}`,
};

/** Truthful binding health — derived only from what the API returned. */
type BindingHealth = 'active' | 'revoked' | 'not-bound';

function healthOf(bindings: ChannelBinding[]): BindingHealth {
  if (bindings.some((b) => b.revoked_at === null)) return 'active';
  if (bindings.length > 0) return 'revoked';
  return 'not-bound';
}

/** Extract an RFC 9457 problem detail if the API sent one. */
async function problemDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown; title?: unknown };
    if (typeof body?.detail === 'string' && body.detail) return body.detail;
    if (typeof body?.title === 'string' && body.title) return body.title;
  } catch {
    /* not JSON — fall through to the status text */
  }
  return null;
}

const HEALTH_META: Record<BindingHealth, { label: string; className: string }> = {
  active: {
    label: 'active',
    className: 'border-success/30 bg-success/10 text-success',
  },
  revoked: {
    label: 'revoked',
    className: 'border-danger/30 bg-danger/10 text-danger',
  },
  'not-bound': {
    label: 'not bound',
    className: 'border-line bg-subtle text-muted',
  },
};

function HealthBadge({ health }: { health: BindingHealth }) {
  const meta = HEALTH_META[health];
  return (
    <Badge variant="outline" className={cn('font-mono text-[11px] uppercase tracking-wide', meta.className)}>
      {meta.label}
    </Badge>
  );
}

function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/* ------------------------------------------------------------------ */
/* Console body                                                         */
/* ------------------------------------------------------------------ */

export function ChannelsConsole() {
  const { api } = useAuth();
  const [roomId, setRoomId] = useState('central');
  const [bindings, setBindings] = useState<ChannelBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bind form state.
  const [platform, setPlatform] = useState('telegram');
  const [conversationId, setConversationId] = useState('');
  const [binding, setBinding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const roomName = useMemo(
    () => DEFAULT_ROOMS.find((r) => r.id === roomId)?.name ?? roomId,
    [roomId],
  );

  const load = useCallback(async () => {
    try {
      if (!api) throw new Error('The authenticated API bridge is unavailable.');
      const res = await api(CHANNELS_API.listForRoom(roomId));
      const data = (await res.json()) as { bindings?: ChannelBinding[] };
      setBindings(Array.isArray(data.bindings) ? data.bindings : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBindings([]);
    } finally {
      setLoading(false);
    }
  }, [api, roomId]);

  useEffect(() => {
    setLoading(true);
    setActionError(null);
    setActionNotice(null);
    load();
  }, [load]);

  const health = useMemo(() => healthOf(bindings), [bindings]);

  async function handleBind(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const convId = conversationId.trim();
    if (!convId) {
      setActionError('A platform conversation id is required.');
      return;
    }
    setBinding(true);
    setActionError(null);
    setActionNotice(null);
    try {
      if (!api) throw new Error('The authenticated API bridge is unavailable.');
      await api(CHANNELS_API.bind(roomId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          platform,
          platform_conversation_id: convId,
        }),
      });
      setActionNotice(`Bound ${roomName} to ${platform}:${convId}.`);
      setConversationId('');
      await load();
    } catch (err) {
      setActionError(`Bind failed — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBinding(false);
    }
  }

  async function handleRevoke(bindingId: string) {
    setRevokingId(bindingId);
    setActionError(null);
    setActionNotice(null);
    try {
      if (!api) throw new Error('The authenticated API bridge is unavailable.');
      await api(CHANNELS_API.revoke(roomId, bindingId), {
        method: 'DELETE',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setActionNotice('Binding revoked — it routes nothing now.');
      await load();
    } catch (err) {
      setActionError(`Revoke failed — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold text-ink">Channels</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Room↔platform bindings — bind or inspect a room&apos;s Telegram conversation and see its
          truthful health.
        </p>
      </div>

      {/* Room picker */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger className="h-8 w-56 text-[13px]" aria-label="Pick a room">
            <SelectValue placeholder="Room" />
          </SelectTrigger>
          <SelectContent>
            {DEFAULT_ROOMS.map((room) => (
              <SelectItem key={room.id} value={room.id} className="text-[13px]">
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-warning"
        >
          Channel status unavailable ({error}) — the web frame remains authoritative while the
          channel surface is down.
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-label="Loading channel bindings">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-line bg-card px-4 py-6 text-[12.5px] text-muted">
          No binding data to show while the channels API is unreachable. Bindings created earlier
          are unaffected — this is a display outage, not a health claim.
        </div>
      ) : (
        <>
          {/* Truthful room-level health */}
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
            <span className="text-[13px] font-medium text-ink">{roomName}</span>
            <HealthBadge health={health} />
            <span className="text-[12px] text-muted">
              {health === 'active' && 'A live binding routes platform messages into this room.'}
              {health === 'revoked' &&
                'Only revoked bindings remain — the platform routes nothing into this room.'}
              {health === 'not-bound' && 'No binding yet — bind a conversation below.'}
            </span>
          </div>

          {/* Binding rows */}
          {bindings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-subtle px-4 py-8 text-center text-[12.5px] text-muted">
              Not bound — no channel bindings recorded for {roomName}.
            </div>
          ) : (
            <ul aria-label={`Channel bindings for ${roomName}`} className="space-y-2">
              {bindings.map((b) => {
                const revoked = b.revoked_at !== null;
                return (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-4 py-3"
                  >
                    <HealthBadge health={revoked ? 'revoked' : 'active'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12.5px] text-ink">
                        {b.platform}:{b.platform_conversation_id}
                      </p>
                      <p className="text-[11px] text-muted">
                        bound {formatStamp(b.created_at)}
                        {revoked && ` · revoked ${formatStamp(b.revoked_at)}`}
                      </p>
                    </div>
                    {!revoked && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevoke(b.id)}
                        disabled={revokingId === b.id}
                        aria-label={`Revoke binding ${b.platform}:${b.platform_conversation_id}`}
                      >
                        {revokingId === b.id ? 'Revoking…' : 'Revoke'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Bind form */}
          <form
            onSubmit={handleBind}
            className="mt-6 rounded-xl border border-line bg-card p-4"
            aria-label={`Bind ${roomName} to a platform conversation`}
          >
            <h2 className="text-[13px] font-semibold text-ink">Bind a conversation</h2>
            <p className="mt-0.5 text-[11.5px] text-muted">
              One live binding per room + platform. Binding is idempotent and reversible — revoking
              routes nothing but keeps the record.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="channels-platform" className="text-[12px] text-muted">
                  Platform
                </Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger
                    id="channels-platform"
                    aria-label="Platform"
                    className="h-8 w-40 text-[13px]"
                  >
                    <SelectValue placeholder="Platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="telegram" className="text-[13px]">
                      Telegram
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="channels-conversation-id" className="text-[12px] text-muted">
                  Conversation id
                </Label>
                <Input
                  id="channels-conversation-id"
                  placeholder="e.g. -1001234567890"
                  value={conversationId}
                  onChange={(e) => setConversationId(e.target.value)}
                  className="h-8 font-mono text-[13px]"
                />
              </div>
              <Button type="submit" size="sm" className="h-8" disabled={binding}>
                {binding ? 'Binding…' : 'Bind'}
              </Button>
            </div>
            {actionError && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {actionError}
              </p>
            )}
            {actionNotice && (
              <p role="status" className="mt-2 text-[12px] text-success">
                {actionNotice}
              </p>
            )}
          </form>

          <p className="mt-6 text-[11px] text-muted/70">
            Frank&apos;s web frame stays authoritative even when a channel is down — a binding only
            mirrors state, it never owns it.
          </p>
        </>
      )}
    </div>
  );
}
