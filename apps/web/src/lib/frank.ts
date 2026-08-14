import type { TodayResponse } from './api';

/* ------------------------------------------------------------------ */
/* Living-frame derivations from /v1/today                             */
/* ------------------------------------------------------------------ */

export interface BriefSummary {
  count: number;
  topTitle: string | null;
  body: string;
  oneThing: string;
}

export function briefFromToday(today: TodayResponse | null): BriefSummary {
  const cards = (today?.sections ?? []).flatMap((s) => s.cards);
  const open = cards.filter((c) => c.state !== 'done' && c.state !== 'cancelled');
  const top = open[0] ?? cards[0];
  if (!today) {
    return {
      count: 0,
      topTitle: null,
      body: 'Warming up — pulling the board from the cell…',
      oneThing: 'Nothing urgent.',
    };
  }
  if (open.length === 0 && cards.length === 0) {
    return {
      count: 0,
      topTitle: null,
      body: 'Quiet board. Nothing scheduled or tracked for today yet.',
      oneThing: 'Nothing urgent — enjoy the slack.',
    };
  }
  const body =
    open.length === 0
      ? `All ${cards.length} tracked item${cards.length === 1 ? '' : 's'} are closed. Clean board.`
      : `${open.length} item${open.length === 1 ? ' needs' : 's need'} attention${
          top ? ` — next up: "${top.title}".` : '.'
        }`;
  return {
    count: open.length,
    topTitle: top?.title ?? null,
    body,
    oneThing: top ? top.title : 'Nothing urgent.',
  };
}
