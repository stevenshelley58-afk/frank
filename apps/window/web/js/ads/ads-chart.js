// The one chart the Ads overview carries.
//
// `DESIGN.md` is explicit: the overview carries exactly one chart, because a
// screen where every metric has its own sparkline is a screen nobody reads.
// This module is that chart. It is inline SVG built here, in the same idiom as
// the rest of `web/js/ads/` — no charting library, no vendor bundle, no canvas
// — and it draws the window's daily delivery from the rows the overview reader
// already returned.
//
// Three rules shape it, and each exists because the opposite is a claim nobody
// made:
//
//   * A missing figure is not zero. A day whose spend is not in the read is a
//     gap between the bars, not a bar of height zero, because a zero bar says
//     nothing was delivered that day. A gap in the results line breaks the line
//     instead of being bridged.
//   * Nothing is invented when the read has not answered. A reader that is not
//     connected, or that answered without dated daily rows, gets the honest
//     state named in `data-state`. No synthesised, sampled or randomised
//     series, and no transplanted copy of the approved preview's sample
//     metrics.
//   * The two series never share a scale. Spend and Meta-attributed results are
//     different units, so they are drawn in two panels of one figure, each with
//     its own baseline, rather than as two lines crossing on one axis a reader
//     would compare against each other. Both are the provider's own
//     attribution; website-observed and CRM-observed outcomes are deliberately
//     absent, because they are a different measurement.
//
// Colour is never the only evidence of state: the legend names both series and
// carries the source of each number, and the swatch shape matches the mark.

import { block, el, emptyPanel, notConnectedPanel, sourceNote, visuallyHidden } from "./ads-ui.js";
import { READER_REQUIREMENTS } from "./ads-source.js";
import { formatDay, formatInt, formatMoney, num } from "./ads-contracts.js";

/**
 * The figure's coordinate space.
 *
 * The width is the geometry's own unit, not a pixel size: the SVG stretches to
 * its container and keeps the height its stylesheet gives it, so a phone gets
 * narrower bars rather than unreadable labels. That is also why every label on
 * this chart is HTML beside the figure — text inside a stretched SVG distorts,
 * and geometry does not.
 */
const VIEW = Object.freeze({
  width: 720,
  height: 232,
  padLeft: 10,
  padRight: 10,
  padTop: 12,
  padBottom: 12,
  panelGap: 16,
});

const INNER_WIDTH = VIEW.width - VIEW.padLeft - VIEW.padRight;

/** A line needs two days before it is a shape rather than a fact. */
export const MIN_PLOT_DAYS = 2;

/** The one chart's name, so a test or a probe can find it without guessing at
 *  a class name, and so there is exactly one of it on the screen. */
export const CHART_SLOT = "delivery";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/**
 * The days this figure can actually draw.
 *
 * A point without a date is not a day. A figure that is not a finite number is
 * not zero either: it is `null` here, and the figure leaves the gap rather than
 * drawing a floor the rows never reported.
 */
export function plotPoints(record) {
  const series = Array.isArray(record?.series) ? record.series : [];
  return series
    .filter((point) => point && typeof point.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(point.date))
    .map((point) => ({ date: point.date, spend: num(point.spend), results: num(point.results) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * What this figure can honestly say about the read.
 *
 * `not_connected` is the reader having no implementation at all; `insufficient`
 * is the reader answering without enough dated days to draw. They are kept
 * apart because they call for different things: one needs a sync, the other
 * needs rows.
 */
export function chartReadiness(record) {
  const points = plotPoints(record);
  const spendDays = points.filter((point) => point.spend !== null).length;
  const resultDays = points.filter((point) => point.results !== null).length;
  const state = !record || String(record.status || "") === "not_connected" ? "not_connected" : "plotted";
  if (state === "not_connected") return { state, points, spendDays, resultDays };
  if (spendDays < MIN_PLOT_DAYS && resultDays < MIN_PLOT_DAYS) return { state: "insufficient", points, spendDays, resultDays };
  return { state, points, spendDays, resultDays };
}

/** Which panels the figure draws, in order, from what the read carried. */
export function drawnPanels(readiness) {
  const drawn = [];
  if (readiness.spendDays >= MIN_PLOT_DAYS) drawn.push("spend");
  if (readiness.resultDays >= MIN_PLOT_DAYS) drawn.push("results");
  return drawn;
}

/** The peak of a series over the days that carry it, or null when none do. */
function peakOf(points, id) {
  const present = points.map((point) => point[id]).filter((value) => value !== null);
  return present.length ? Math.max(...present) : null;
}

/** Panel rectangles for `count` stacked panels, sharing the figure's height. */
function panelRects(count) {
  const usable = VIEW.height - VIEW.padTop - VIEW.padBottom - VIEW.panelGap * (count - 1);
  const height = usable / count;
  return Array.from({ length: count }, (unused, index) => {
    const top = VIEW.padTop + index * (height + VIEW.panelGap);
    return { top, bottom: top + height };
  });
}

function baseline(rect) {
  return svgEl("line", {
    class: "ads-chart-axis",
    "vector-effect": "non-scaling-stroke",
    x1: VIEW.padLeft,
    x2: VIEW.width - VIEW.padRight,
    y1: rect.bottom,
    y2: rect.bottom,
  });
}

/**
 * One bar per day that carries a spend figure.
 *
 * A day that really delivered nothing keeps a one-unit mark on the baseline
 * rather than vanishing into it, so "zero" and "not in this read" do not look
 * the same.
 */
function barMarks(points, rect, max) {
  const slot = INNER_WIDTH / points.length;
  const width = Math.max(1, slot * 0.72);
  const marks = [];
  points.forEach((point, index) => {
    if (point.spend === null) return;
    const height = max > 0 ? (Math.max(point.spend, 0) / max) * (rect.bottom - rect.top) : 0;
    marks.push(
      svgEl("rect", {
        class: "ads-chart-bar",
        x: (VIEW.padLeft + index * slot + (slot - width) / 2).toFixed(2),
        y: (rect.bottom - Math.max(height, 1)).toFixed(2),
        width: width.toFixed(2),
        height: Math.max(height, 1).toFixed(2),
      }),
    );
  });
  return marks;
}

/**
 * The results line, drawn as one polyline per run of consecutive days that
 * carry a count. A day without a count breaks the line instead of being
 * bridged, and a lone day is a dot rather than a trend.
 */
function lineMarks(points, rect, max) {
  const slot = INNER_WIDTH / points.length;
  const marks = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      marks.push(
        svgEl("polyline", {
          class: "ads-chart-line",
          "vector-effect": "non-scaling-stroke",
          points: run.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        }),
      );
    }
    for (const point of run) marks.push(svgEl("circle", { class: "ads-chart-point", cx: point.x.toFixed(2), cy: point.y.toFixed(2), r: 1.6 }));
    run = [];
  };
  points.forEach((point, index) => {
    if (point.results === null) {
      flush();
      return;
    }
    const height = max > 0 ? (Math.max(point.results, 0) / max) * (rect.bottom - rect.top) : 0;
    run.push({ x: VIEW.padLeft + index * slot + slot / 2, y: rect.bottom - height });
  });
  flush();
  return marks;
}

function figureSummary(readiness, drawn, currency) {
  const points = readiness.points;
  const lines = [`Daily delivery across ${formatInt(points.length)} days, ${formatDay(points[0].date)} to ${formatDay(points[points.length - 1].date)}.`];
  if (drawn.includes("spend")) lines.push(`Spend is drawn as bars, peaking at ${formatMoney(peakOf(points, "spend"), currency)}.`);
  if (drawn.includes("results")) lines.push(`Meta-attributed results are drawn as a line, peaking at ${formatInt(peakOf(points, "results"))}.`);
  return lines.join(" ");
}

function legendItem({ kind, label, measurement, value }) {
  const item = el("span", "ads-chart-legend-item");
  item.append(el("span", `ads-chart-swatch ads-chart-swatch-${kind}`));
  item.append(el("span", "ads-chart-legend-label", label));
  const source = sourceNote(measurement);
  if (source) item.append(source);
  item.append(el("span", "ads-chart-legend-value", value));
  return item;
}

function chartNote(readiness, drawn) {
  const parts = [];
  if (drawn.length === 2) {
    parts.push("Spend and Meta-attributed results are different units, so they are drawn in two panels with a baseline each; the height of a bar is not comparable with the height of the line.");
  }
  const missingSpend = readiness.points.filter((point) => point.spend === null).length;
  const missingResults = readiness.points.filter((point) => point.results === null).length;
  if (missingSpend) parts.push(`${formatInt(missingSpend)} of these days carry no spend figure in this read; those days are gaps between the bars, not days of zero delivery.`);
  if (missingResults) parts.push(`${formatInt(missingResults)} carry no Meta-attributed result count; the line breaks there rather than being drawn across the gap.`);
  parts.push(
    drawn.includes("results")
      ? "Website-observed and CRM-observed outcomes are never on this chart: they are a different measurement, and they are ranked below."
      : "No Meta-attributed result count is in this read, so only spend is drawn. Website-observed and CRM-observed outcomes are never on this chart, and are ranked below.",
  );
  return parts.join(" ");
}

function buildFigure(readiness, { currency }) {
  const points = readiness.points;
  const drawn = drawnPanels(readiness);
  const rects = panelRects(drawn.length);
  const summary = figureSummary(readiness, drawn, currency);

  const svg = svgEl("svg", {
    class: "ads-chart",
    viewBox: `0 0 ${VIEW.width} ${VIEW.height}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": summary,
  });
  drawn.forEach((id, index) => {
    const rect = rects[index];
    svg.append(baseline(rect));
    const marks = id === "spend" ? barMarks(points, rect, peakOf(points, "spend")) : lineMarks(points, rect, peakOf(points, "results"));
    for (const mark of marks) svg.append(mark);
  });

  const figure = el("div", "ads-chart-figure");
  figure.append(svg);

  const xaxis = el("div", "ads-chart-xaxis");
  xaxis.append(el("span", "ads-chart-label", formatDay(points[0].date)));
  xaxis.append(el("span", "ads-chart-label", formatDay(points[points.length - 1].date)));

  const legend = el("div", "ads-chart-legend");
  if (drawn.includes("spend")) {
    legend.append(legendItem({ kind: "bar", label: "Spend", measurement: "provider_attributed", value: `peak ${formatMoney(peakOf(points, "spend"), currency)}` }));
  }
  if (drawn.includes("results")) {
    legend.append(legendItem({ kind: "line", label: "Meta-attributed results", measurement: "provider_attributed", value: `peak ${formatInt(peakOf(points, "results"))}` }));
  }

  return [figure, xaxis, legend, el("p", "ads-chart-note", chartNote(readiness, drawn)), visuallyHidden(summary)];
}

/**
 * The overview's one chart.
 *
 * Returns the block the overview appends, holding exactly one chart slot. The
 * slot exists in every state, so a screen with nothing to plot still says so in
 * the place the chart lives rather than silently having no chart at all.
 */
export function overviewDeliveryChart(record, { currency = "" } = {}) {
  const readiness = chartReadiness(record);
  const section = block("Delivery by day", {
    note: "The window's daily figures as the overview reader returned them. Spend and Meta-attributed results are the provider's own attribution, and each is drawn against its own scale.",
  });

  const wrap = el("div", "ads-chart-wrap");
  wrap.dataset.adsChart = CHART_SLOT;
  wrap.dataset.state = readiness.state;

  if (readiness.state === "not_connected") {
    wrap.append(notConnectedPanel({ title: "No delivery to draw yet", requirement: READER_REQUIREMENTS.overview }));
  } else if (readiness.state === "insufficient") {
    wrap.append(
      emptyPanel({
        title: "Not enough days in this window to draw a trend",
        detail: readiness.points.length
          ? `The overview read carried ${formatInt(readiness.points.length)} dated day${readiness.points.length === 1 ? "" : "s"}, and ${formatInt(readiness.spendDays)} of them with a spend figure. Two are needed before a shape means anything, so nothing is plotted rather than a trend drawn through one day.`
          : "The overview read carried no dated daily rows for this window. That is not a window with no delivery: it is a window whose daily rows are not in this read.",
      }),
    );
  } else {
    for (const node of buildFigure(readiness, { currency })) wrap.append(node);
  }

  section.append(wrap);
  return section;
}
