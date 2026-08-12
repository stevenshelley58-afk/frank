'use client';

import { useEffect, useRef, useState } from 'react';
import type { ThinkingMode } from '@/lib/chat-api';
import { SharedRichComposer } from '@/components/shared-rich-composer';
import type { ChatAttachmentRef, ChatTurnInput } from '@/lib/chat-turn-input';

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface ModelOption {
  id: string;
  name: string;
  sub: string;
  short: string;
}

/**
 * `auto` first, on purpose: the harness registry already resolves a room to
 * Goose or Letta (spec §8.4), so the honest default is "let Frank pick" and the
 * rest are overrides for one chat.
 */
const AUTO_MODEL: ModelOption = { id: 'auto', name: 'Auto', sub: 'let the harness registry choose', short: 'Auto' };

// Retained only to render historical state safely if a stale DOM event arrives;
// no visible control exposes this until a provider supports an effective depth.
const THINKING: Record<ThinkingMode, { label: string; short: string; sub: string }> = {
  off: { label: 'Thinking off', short: 'Thinking', sub: 'answers straight away' },
  think: { label: 'Think', short: 'Think', sub: 'not currently supported by a provider' },
  deep: { label: 'Think harder', short: 'Think harder', sub: 'not currently supported by a provider' },
};

/* ------------------------------------------------------------------ */
/* Speech recognition — feature-detected, never assumed                */
/* ------------------------------------------------------------------ */

interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ------------------------------------------------------------------ */

interface ComposerBarProps {
  /** 'Frank' or the project's name — the only scope label there is. */
  scopeLabel: string;
  /** null for Frank (the deep Atlantic deck), a hex tint for a project. */
  tint: string | null;
  rgb: string | null;
  streaming: boolean;
  disabled?: boolean;
  model: string;
  models: ModelOption[];
  /** Historical conversation setting; no provider currently executes it. */
  thinking: ThinkingMode;
  /** Fraction of the context window in use, 0–1. */
  contextUsed: number;
  conversationId?: string;
  onSend: (input: ChatTurnInput) => void;
  onStop: () => void;
  onModelChange: (model: string) => void;
  onThinkingChange: (mode: ThinkingMode) => void;
  onCompact: () => void;
  onNewChat: () => void;
}

/**
 * The composer — one input, and a tool row that says exactly what this turn
 * will cost and how it will be answered: dictate, model, thinking depth, and
 * how full the context window is.
 */
export function ComposerBar({
  scopeLabel,
  tint,
  rgb,
  streaming,
  disabled = false,
  model,
  models,
  thinking,
  contextUsed,
  conversationId,
  onSend,
  onStop,
  onModelChange,
  onThinkingChange,
  onCompact,
  onNewChat,
}: ComposerBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState<'model' | 'thinking' | 'context' | null>(null);
  const [recording, setRecording] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachmentRef[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isDeck = tint === null;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [value]);

  // Close menus on Escape or an outside click.
  useEffect(() => {
    if (menu === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-composer-menu]')) setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [menu]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend({ text, attachment_ids: attachments.map((attachment) => attachment.id), attachments });
    setValue('');
    taRef.current?.focus();
  };

  const toggleMic = () => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (Ctor === null) {
      // No Web Speech API (Firefox, some mobile browsers). Say so rather than
      // leaving a button that silently does nothing.
      window.alert('Dictation needs a browser with the Web Speech API — Chrome or Edge.');
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-AU';
    recognition.onresult = (event) => {
      let heard = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const alternative = event.results[i]?.[0];
        if (alternative) heard += alternative.transcript;
      }
      setValue((prev) => (prev ? `${prev} ${heard.trim()}` : heard.trim()));
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
      taRef.current?.focus();
    };
    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  const pct = Math.min(100, Math.round(contextUsed * 100));
  const circumference = 2 * Math.PI * 7;
  const availableModels = [AUTO_MODEL, ...models];
  const selectedModel = availableModels.find((m) => m.id === model) ?? AUTO_MODEL;
  const think = { short: 'Thinking' };

  const toolClass = isDeck
    ? 'text-white/55 hover:bg-white/10 hover:text-white'
    : 'text-muted hover:bg-hover hover:text-ink';

  return (
    <div className="relative shrink-0 px-4 pb-5 pt-2 md:px-7">
      <div className="relative mx-auto max-w-[760px]">
        <div
          className={`rounded-2xl px-3 pb-2.5 pt-3 transition-shadow duration-200 ${
            isDeck ? 'frank-central-composer' : 'border border-line bg-shell'
          }`}
          style={
            isDeck
              ? {
                  boxShadow: focused
                    ? '0 0 0 2px rgba(242,59,29,0.5), 0 16px 40px -18px rgba(6,17,31,0.42)'
                    : '0 2px 4px rgba(6,17,31,0.10), 0 16px 40px -18px rgba(6,17,31,0.28)',
                }
              : {
                  borderColor: focused && tint ? tint : undefined,
                  boxShadow: focused && rgb ? `0 0 0 2px rgba(${rgb},0.22)` : undefined,
                }
          }
        >
          {/* scope: just who you are talking to */}
          <div
            className={`flex items-center gap-2 px-1 pb-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] ${
              isDeck ? 'text-white/45' : 'text-muted/80'
            }`}
          >
            {tint && (
              <span
                className="h-2 w-2 rounded-[3px]"
                style={{ background: tint }}
                aria-hidden
              />
            )}
            {scopeLabel}
          </div>

          <div className="flex items-end gap-2">
            <SharedRichComposer
              disabled={disabled}
              dark={isDeck}
              conversationId={conversationId}
              pasteTargetRef={taRef}
              onAttachmentsChange={setAttachments}
            />
            <textarea
              ref={taRef}
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={recording ? 'Listening…' : ''}
              aria-label={`Message ${scopeLabel}`}
              className={`max-h-[150px] min-h-[40px] flex-1 resize-none border-none bg-transparent px-1 py-2 text-[14px] leading-[1.5] outline-none ${
                isDeck
                  ? 'text-white placeholder:text-white/40'
                  : 'text-ink placeholder:text-muted/60'
              }`}
            />
            {streaming ? (
              <button
                onClick={onStop}
                aria-label="Stop"
                className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] transition-transform active:scale-95 ${
                  isDeck ? 'bg-white/12 text-white' : 'bg-ink text-white'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!value.trim() || disabled}
                aria-label="Send"
                className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-accent text-white transition-all duration-150 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                style={isDeck ? { color: '#06111f' } : undefined}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m22 2-7 20-4-9-9-4z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            )}
          </div>

          {/* tool row */}
          <div
            data-composer-menu
            className={`mt-1.5 flex items-center gap-1.5 border-t pt-2 ${
              isDeck ? 'border-white/10' : 'border-line'
            }`}
          >
            <button
              onClick={toggleMic}
              title="Dictate"
              aria-pressed={recording}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors ${
                recording ? 'bg-danger/10 text-danger' : toolClass
              }`}
            >
              {recording ? (
                <>
                  <span className="flex h-3 items-end gap-[2px]">
                    {[5, 11, 7, 12, 6].map((h, i) => (
                      <i
                        key={i}
                        className="w-[2px] rounded-[1px] bg-current"
                        style={{ height: `${h}px`, animation: `typing 0.9s ${i * 0.12}s infinite` }}
                      />
                    ))}
                  </span>
                  Stop
                </>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v3" />
                </svg>
              )}
            </button>

            <button
              onClick={() => setMenu(menu === 'model' ? null : 'model')}
              aria-expanded={menu === 'model'}
              aria-label={`Route for this chat: ${selectedModel.short}`}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors ${toolClass}`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9" />
              </svg>
              {selectedModel.short}
            </button>

            <button
              onClick={() => setMenu(menu === 'thinking' ? null : 'thinking')}
              className={`hidden h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors ${
                thinking === 'off' ? toolClass : 'bg-accent/10 text-accent'
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2z" />
                <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2z" />
              </svg>
              {think.short}
            </button>

            <span className="flex-1" />

            <button
              onClick={() => setMenu(menu === 'context' ? null : 'context')}
              title={`Context — ${pct}% of the window in use`}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 transition-colors ${toolClass}`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: 'rotate(-90deg)' }}>
                <circle
                  cx="9"
                  cy="9"
                  r="7"
                  fill="none"
                  strokeWidth="2.5"
                  className={isDeck ? 'stroke-white/20' : 'stroke-line'}
                />
                <circle
                  cx="9"
                  cy="9"
                  r="7"
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  stroke={pct >= 75 ? 'var(--color-accent)' : 'var(--color-running)'}
                  strokeDasharray={`${((circumference * pct) / 100).toFixed(1)} ${circumference.toFixed(1)}`}
                />
              </svg>
              <span className="font-mono text-[10px]">{pct}%</span>
            </button>
          </div>
        </div>

        {/* menus */}
        {menu === 'model' && (
          <Menu label="Route for this chat" hint="Saved with this chat. Other chats keep their own route." className="left-0">
            {availableModels.map((m) => (
              <MenuItem
                key={m.id}
                title={m.name}
                sub={m.sub}
                selected={m.id === model}
                onClick={() => {
                  onModelChange(m.id);
                  setMenu(null);
                }}
              />
            ))}
          </Menu>
        )}

        {menu === 'thinking' && (
          <Menu label="Extended thinking" className="left-24">
            {(Object.keys(THINKING) as ThinkingMode[]).map((key) => (
              <MenuItem
                key={key}
                title={THINKING[key].label}
                sub={THINKING[key].sub}
                selected={key === thinking}
                onClick={() => {
                  onThinkingChange(key);
                  setMenu(null);
                }}
              />
            ))}
          </Menu>
        )}

        {menu === 'context' && (
          <Menu label="Context window" className="right-0">
            <div className="px-2.5 pb-2 pt-1">
              <div className="h-[5px] overflow-hidden rounded-[3px] bg-line">
                <i className="block h-full rounded-[3px] bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-muted">
                <b className="text-ink">{pct}% used</b> — this chat&rsquo;s history and the
                project&rsquo;s recalled memory.
              </p>
            </div>
            <MenuItem
              title="Compact conversation"
              sub="summarise the early turns, keep the facts"
              onClick={() => {
                onCompact();
                setMenu(null);
              }}
            />
            <MenuItem
              title="Start a fresh chat"
              sub="same project, clean context"
              onClick={() => {
                onNewChat();
                setMenu(null);
              }}
            />
          </Menu>
        )}
      </div>

      <p className="pt-2 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-muted/70">
        Enter sends · Shift+Enter adds a line
      </p>
    </div>
  );
}

function Menu({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-composer-menu
      className={`animate-slide-in absolute bottom-[calc(100%+8px)] z-50 min-w-[236px] rounded-[13px] border border-line bg-shell p-1.5 shadow-[0_12px_34px_rgba(6,17,31,0.16)] ${className}`}
    >
      <div className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted/80">
        {label}
      </div>
      {hint && <p className="px-2.5 pb-1 text-[10px] leading-snug text-muted">{hint}</p>}
      {children}
    </div>
  );
}

function MenuItem({
  title,
  sub,
  selected = false,
  onClick,
}: {
  title: string;
  sub: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <b className="block text-[12.5px] font-semibold text-ink">{title}</b>
        <span className="mt-px block font-mono text-[9.5px] text-muted">{sub}</span>
      </span>
      {selected && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-accent"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}
