'use client';

import { useEffect, useRef, useState } from 'react';
import type { Room } from '@/lib/rooms';
import { IconSend } from './icons';

interface ComposerProps {
  room: Room;
  disabled: boolean;
  /** session still minting — placeholder says so until ready */
  booting?: boolean;
  onSend: (text: string) => void;
  onTyping: (active: boolean) => void;
}

/**
 * The composer.
 *
 * Central: a white surface with a hairline border and a soft lift — ink
 * text, one blue send. The anchor: quiet but unmistakable.
 *
 * Project rooms: a white box with a FAINT wash of the room's tint and a
 * tint ring — identity reads at a glance through the ring + solid-tint
 * send button + initials chip, without competing with the thread above.
 */
export function Composer({ room, disabled, booting, onSend, onTyping }: ComposerProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow to a couple of lines, cap around 6.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || booting) return;
    onSend(text);
    setValue('');
    onTyping(false);
    taRef.current?.focus();
  };

  const isCentral = room.isHome;
  const sendActive = value.trim().length > 0 && !disabled && !booting;

  return (
    <div className="shrink-0 px-5 pb-6 pt-3 md:px-7">
      <div
        className={`composer-ring flex items-end gap-3 rounded-2xl px-4 py-3.5 transition-[background,box-shadow,border-color] duration-200 ${
          isCentral
            ? 'border border-line bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_10px_30px_-16px_rgba(28,25,23,0.18)]'
            : 'border'
        }`}
        style={
          isCentral
            ? undefined
            : {
                background: `rgba(${room.rgb}, 0.05)`,
                borderColor: `rgba(${room.rgb}, 0.30)`,
                boxShadow: focused
                  ? `0 0 0 2px rgba(${room.rgb}, 0.24), 0 10px 30px -16px rgba(28,25,23,0.18)`
                  : '0 1px 2px rgba(28,25,23,0.04)',
              }
        }
      >
        {/* room identity chip — tint lives here, concentrated not spread */}
        {!isCentral && (
          <span
            className="mb-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg font-display text-[10px] font-bold text-white shadow-sm"
            style={{ background: room.tint }}
            aria-hidden
          >
            {room.initials}
          </span>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setValue(e.target.value);
            onTyping(e.target.value.length > 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={booting ? 'Connecting to Frank…' : room.placeholder}
          aria-label={`Message ${room.isHome ? 'Frank' : room.agent}`}
          className="max-h-[132px] min-h-[24px] flex-1 resize-none border-none bg-transparent text-[14px] leading-[1.5] text-ink outline-none placeholder:text-muted/60"
        />
        <button
          onClick={submit}
          disabled={!sendActive}
          aria-label="Send"
          className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-white transition-all duration-150 active:scale-95 ${
            isCentral ? 'bg-accent hover:scale-[1.06] hover:bg-accent/90' : 'hover:scale-[1.06]'
          } disabled:pointer-events-none disabled:opacity-35`}
          style={isCentral ? undefined : { background: sendActive ? room.tint : `rgba(${room.rgb}, 0.4)` }}
        >
          <IconSend size={16} />
        </button>
      </div>
    </div>
  );
}
