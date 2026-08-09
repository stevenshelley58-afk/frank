'use client';

import { useEffect, useRef, useState } from 'react';
import type { Room } from '@/lib/rooms';
import type { ChatMessage } from '@/lib/frank';
import { IconEdit, IconSend, IconStop } from './icons';

interface ComposerProps {
  room: Room;
  disabled: boolean;
  /** session still minting — placeholder says so until ready */
  booting?: boolean;
  /** Frank is mid-stream — send button becomes a Stop affordance */
  running?: boolean;
  /** Central is waiting for the durable mission record to be created. */
  submitting?: boolean;
  /** Central has durably closed the mission to new work. */
  stopping?: boolean;
  /** ChatGPT-style edit-and-resend: an existing user message being rewritten. */
  editing?: ChatMessage | null;
  onSend: (text: string) => void;
  onStop?: () => void;
  onCancelEdit?: () => void;
  onTyping: (active: boolean) => void;
}

/**
 * The composer — FRANK Atlantic Design System 1.1.
 *
 * Central is the mission deck: a deep Atlantic surface, cool-white text, a mono
 * scope label so you always know the objective becomes durable work, and a
 * signal-orange send. It is the anchor of the shell.
 *
 * Project rooms: a blue-white box with a faint wash of the room's tint and a
 * tint ring + solid-tint send — identity reads at a glance (DS principle 04:
 * scope by sight), without competing with the thread above.
 */
export function Composer({
  room,
  disabled,
  booting,
  running,
  submitting,
  stopping,
  editing,
  onSend,
  onStop,
  onCancelEdit,
  onTyping,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Edit mode: load the message being edited into the box and focus it.
  useEffect(() => {
    if (editing) {
      setValue(editing.text ?? '');
      // Focus after the frame settles so the cursor lands in the field.
      const t = window.setTimeout(() => taRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow to a couple of lines, cap around 6.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  const isCentral = room.isHome;

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || booting || (isCentral && text.length < 12)) return;
    onSend(text);
    setValue('');
    onTyping(false);
    taRef.current?.focus();
  };

  const sendActive =
    value.trim().length >= (isCentral ? 12 : 1) && !disabled && !booting;

  const textareaProps = {
    ref: taRef,
    rows: 1,
    value,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      onTyping(e.target.value.length > 0);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && editing) {
        e.preventDefault();
        setValue('');
        onTyping(false);
        onCancelEdit?.();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    placeholder: booting
      ? 'Connecting to Frank…'
      : editing
        ? 'Rewrite your message…'
        : isCentral
          ? 'Set a substantial objective for Frank...'
          : room.placeholder,
    'aria-label': isCentral ? 'Mission objective' : `Message ${room.agent}`,
  };

  /** Editing banner — sits above either composer variant. */
  const editingBanner = editing && (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-accent/35 bg-accent/8 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
        <IconEdit size={12} className="shrink-0" />
        Editing — this replaces everything after it
      </span>
      <button
        type="button"
        onClick={() => {
          setValue('');
          onTyping(false);
          onCancelEdit?.();
        }}
        className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );

  return (
    <div className="shrink-0 px-4 pb-4 pt-3 md:px-7 md:pb-6">
      {isCentral ? (
        /* ---------- Central: the deep Atlantic command deck ---------- */
        <div>
          {editingBanner}
          <div
            className={`frank-central-composer rounded-2xl p-3 transition-shadow duration-200 ${
              focused
                ? 'shadow-[0_0_0_2px_rgba(242,59,29,0.5),0_16px_40px_-18px_rgba(6,17,31,0.42)]'
                : 'shadow-[0_2px_4px_rgba(6,17,31,0.10),0_16px_40px_-18px_rgba(6,17,31,0.28)]'
            }`}
          >
            <div className="ds-label px-1 pb-2 text-white/45">
              Central · Mission Deck
              {submitting
                ? ' · Creating mission'
                : stopping
                  ? ' · Stopping mission'
                  : running
                    ? ' · Mission active'
                    : ''}
            </div>
            <div className="flex items-end gap-2.5">
              <textarea
                {...textareaProps}
                className="max-h-[132px] min-h-[42px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-[14px] leading-[1.5] text-white outline-none placeholder:text-white/40"
              />
              {running ? (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stopping}
                  aria-label="Stop mission"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-white/12 text-white transition-all duration-150 hover:scale-[1.05] hover:bg-white/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  <IconStop size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!sendActive}
                  aria-label="Start durable mission"
                  title="Start a durable mission"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-accent text-[#06111f] transition-all duration-150 hover:scale-[1.05] hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                >
                  <IconSend size={17} />
                </button>
              )}
            </div>
          </div>
          <p className="px-1 pt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted/70">
            12+ characters · Enter starts a durable mission · Shift+Enter adds a line
          </p>
        </div>
      ) : (
        /* ---------- Project room: tint-ringed, scope by sight ---------- */
        <div>
          {editingBanner}
          <div
            className="flex items-end gap-3 rounded-2xl border px-4 py-3.5 transition-[background,box-shadow,border-color] duration-200"
            style={{
              background: `rgba(${room.rgb}, 0.06)`,
              borderColor: `rgba(${room.rgb}, ${focused ? 0.55 : 0.32})`,
              boxShadow: focused
                ? `0 0 0 2px rgba(${room.rgb}, 0.22), 0 12px 30px -16px rgba(21,23,17,0.16)`
                : '0 1px 2px rgba(21,23,17,0.05)',
            }}
          >
            {/* room identity chip — tint lives here, concentrated not spread */}
            <span
              className="mb-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg font-display text-[10px] font-bold text-white shadow-sm"
              style={{ background: room.tint }}
              aria-hidden
            >
              {room.initials}
            </span>
            <textarea
              {...textareaProps}
              className="max-h-[132px] min-h-[24px] flex-1 resize-none border-none bg-transparent text-[14px] leading-[1.5] text-ink outline-none placeholder:text-muted/60"
            />
            {running ? (
              <button
                onClick={onStop}
                aria-label="Stop"
                className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-[10px] bg-ink/85 text-white transition-all duration-150 hover:scale-[1.06] hover:bg-ink active:scale-95"
              >
                <IconStop size={14} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!sendActive}
                aria-label={editing ? 'Save and send' : 'Send'}
                title={editing ? 'Save and send — replaces later messages' : undefined}
                className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-[10px] text-white transition-all duration-150 hover:scale-[1.06] active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                style={{ background: sendActive ? room.tint : `rgba(${room.rgb}, 0.4)` }}
              >
                <IconSend size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
