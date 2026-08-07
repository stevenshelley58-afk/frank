/**
 * CH-05 — secret hygiene for the Channels adapter.
 *
 * FRANK-§16.4 posture: the Telegram bot token enters through the environment
 * (`TELEGRAM_BOT_TOKEN`) injected by the accepted secret path (see
 * `docs/channels/SECRETS.md`); it is never committed, logged, or embedded in
 * code. These helpers make accidental disclosure mechanically unlikely:
 *
 *   - `redactSecret`    — mask a secret value for any display surface.
 *   - `redactLine`      — scan one log line and mask every secret in it.
 *   - `createRedactingConsole` — wraps a console so every emitted line is
 *     scanned before it reaches the underlying sink.
 */

/** Matches `123456:ABC-def_...` style Telegram bot tokens (id:payload). */
export const TELEGRAM_TOKEN_PATTERN = /\b\d{8,10}:[A-Za-z0-9_-]{30,45}\b/g;

/** What a masked secret renders as: shape kept, material destroyed. */
export const REDACTED_PLACEHOLDER = '[REDACTED:telegram-bot-token]';

/** Mask a secret value. Never returns the secret itself. */
export function redactSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${'*'.repeat(8)}`;
}

/** Mask every secret-looking value in one line of text. */
export function redactLine(line: string): string {
  return line.replace(TELEGRAM_TOKEN_PATTERN, REDACTED_PLACEHOLDER);
}

/** A console-shaped sink whose output is redacted line by line. */
export interface RedactingConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** The unredacted sink underneath, for tests and diagnostics. */
  readonly underlying: Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
}

/**
 * Wrap a console so every string argument is redacted before emission.
 * Non-string arguments pass through untouched.
 */
export function createRedactingConsole(
  sink: Pick<Console, 'log' | 'info' | 'warn' | 'error'>,
): RedactingConsole {
  const wrap =
    (method: 'log' | 'info' | 'warn' | 'error') =>
    (...args: unknown[]): void => {
      const redacted = args.map((a) =>
        typeof a === 'string' ? redactLine(a) : a,
      );
      sink[method](...redacted);
    };
  return {
    log: wrap('log'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    underlying: sink,
  };
}
