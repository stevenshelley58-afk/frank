const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Compact relative age: "just now", "4m", "2h", "3d". */
export function relTime(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const age = Math.max(0, nowMs - t);
  const s = Math.floor(age / 1000);
  if (s < 45) return 'just now';
  if (s < HOUR) return `${Math.round(s / MIN)}m ago`;
  if (s < DAY) return `${Math.round(s / HOUR)}h ago`;
  return `${Math.round(s / DAY)}d ago`;
}

/** Age in the API's own units: "as of 2m ago" style. */
export function ageLabel(ageSeconds: number | null | undefined): string {
  if (ageSeconds == null) return '—';
  if (ageSeconds < 45) return 'just now';
  if (ageSeconds < HOUR) return `${Math.round(ageSeconds / MIN)}m ago`;
  if (ageSeconds < DAY) return `${Math.round(ageSeconds / HOUR)}h ago`;
  return `${Math.round(ageSeconds / DAY)}d ago`;
}

function partsInZone(date: Date, timeZone: string): { y: number; m: number; d: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = fmt.format(date).split('-').map(Number);
    return { y, m, d };
  } catch {
    return null;
  }
}

function weekdayName(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone,
      weekday: 'long',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(date);
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Saturday, 1 August" — resolved in the requested zone when possible. */
export function humanDate(isoDate: string, timeZone?: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;

  if (timeZone) {
    // Anchor midday UTC on that date, then re-read the wall clock in-zone so
    // the weekday lines up even near zone boundaries.
    const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const zp = partsInZone(anchor, timeZone);
    if (zp) {
      const zoned = new Date(Date.UTC(zp.y, zp.m - 1, zp.d, 12, 0, 0));
      return `${weekdayName(zoned)}, ${zp.d} ${MONTHS[zp.m - 1]}`;
    }
  }
  const plain = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return `${weekdayName(plain)}, ${d} ${MONTHS[m - 1]}`;
}

/** Short clock time in a zone: "9:41 am". */
export function clockTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(
      new Date(iso),
    );
  }
}

/** "Fri, 1 Aug · 9:41 am" for list rows. */
export function shortStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(d);
  return `${day} · ${clockTime(iso)}`;
}

export const TIME_ZONE = 'Australia/Melbourne';
