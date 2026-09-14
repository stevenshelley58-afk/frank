// Ads overview.
//
// The first screen answers four questions and then stops: what did we spend,
// what did it produce, what did it cost, and what needs me. It is deliberately
// not a wall of charts. There is exactly one chart, because a management screen
// where every metric has its own sparkline is a screen nobody reads.
//
// The two measurement kinds stay apart here more visibly than anywhere else:
// Meta-attributed results sit beside observed CRM outcomes with their source
// labelled on the tile, never summed into one "conversions" number.

import {
  el,
  clear,
  block,
  button,
  statTile,
  statusBadge,
  svg,
  ICONS,
  notConnectedPanel,
  emptyPanel,
  errorPanel,
  skeleton,
  definitionRow,
  sourceNote,
  staleBanner,
  rowsReadNote,
} from "./ads-ui.js";
import {
  METRICS,
  metricValue,
  formatInt,
  formatMoney,
  formatPercent,
  formatDay,
} from "./ads-contracts.js";
import { isUnresolved } from "./ads-source.js";

export function createOverviewScreen(ctx, host) {
  const node = el("div", "ads-overview");
  host.append(node);
  let disposed = false;
  const controller = new AbortController();

  async function load({ force = false } = {}) {
    clear(node);
    node.append(skeleton(5, 5));
    const result = await ctx.reader.read("overview", ctx.params, { signal: controller.signal, force });
    if (disposed) return;
    clear(node);

    if (result.status === "not_connected") {
      node.append(
        notConnectedPanel({
          title: "Not connected",
          requirement: "a completed reporting sync for the selected window",
          action: button("Turn on Preview", {
            variant: "ink",
            onClick: () => ctx.say("Use the Preview switch in the header to rehearse against sample rows."),
          }),
        }),
      );
      return;
    }

    const data = result.data?.meta;
    if (!data || !data.totals) {
      // A read that did not complete is not an empty window, and saying "the
      // sync returned nothing" would be a claim about the data that nothing
      // observed.
      if (isUnresolved(result)) {
        node.append(
          errorPanel({
            title: "That read did not complete",
            detail: result.detail || "The Frank read model did not answer.",
            onRetry: () => void load({ force: true }),
          }),
        );
        return;
      }
      node.append(emptyPanel({ title: "No rows for this window", detail: "The sync returned nothing for the selected dates and attribution setting." }));
      return;
    }

    // The reader kept an earlier copy because this read did not complete: show
    // the rows, and say which read failed and how old they are.
    if (isUnresolved(result)) {
      node.append(
        staleBanner({
          status: result.failedStatus || result.status,
          fetchedAt: result.fetchedAt,
          detail: result.detail,
          onRefresh: () => void load({ force: true }),
        }),
      );
    }

    render(data, result);
  }

  // A metric reads from the rollup row; a metric whose inputs the rollup does
  // not carry renders as a dash rather than as a zero.
  function read(metricId, row) {
    return metricValue(metricId, row);
  }

  function deltaFor(metricId, totals, previous) {
    const a = read(metricId, totals);
    const b = read(metricId, previous);
    if (a === null || b === null || b === 0) return null;
    return (a - b) / Math.abs(b);
  }

  function polarity(metricId) {
    const metric = METRICS[metricId];
    if (!metric || metric.higherIsBetter === null) return null;
    return metric.higherIsBetter ? "up" : "down";
  }

  function render(data, result) {
    const { totals, previous, series = [], attention = [] } = data;
    const currency = ctx.context?.account?.currency || "GBP";

    // ------------------------------------------------------------- headline --
    const stats = el("div", "ads-stats");
    stats.setAttribute("role", "group");
    stats.setAttribute("aria-label", "Headline results for the selected window");

    const cards = [
      {
        id: "spend",
        label: "Spend",
        value: formatMoney(read("spend", totals), currency),
        delta: deltaFor("spend", totals, previous),
      },
      {
        id: "results",
        label: "Results",
        value: formatInt(read("results", totals)),
        delta: deltaFor("results", totals, previous),
        measurement: "provider_attributed",
      },
      {
        id: "costPerResult",
        label: "Cost per result",
        value: formatMoney(read("costPerResult", totals), currency),
        delta: deltaFor("costPerResult", totals, previous),
        measurement: "provider_attributed",
      },
      {
        id: "linkClicks",
        label: "Link clicks",
        value: formatInt(read("linkClicks", totals)),
        delta: deltaFor("linkClicks", totals, previous),
      },
      {
        id: "ctr",
        label: "CTR (link)",
        value: formatPercent(read("ctr", totals)),
        delta: deltaFor("ctr", totals, previous),
      },
      {
        id: "qualifiedLeads",
        label: "Qualified leads",
        value: formatInt(read("qualifiedLeads", totals)),
        delta: deltaFor("qualifiedLeads", totals, previous),
        measurement: "crm_observed",
      },
      {
        id: "costPerQualifiedLead",
        label: "Cost per qualified lead",
        value: formatMoney(read("costPerQualifiedLead", totals), currency),
        delta: deltaFor("costPerQualifiedLead", totals, previous),
        measurement: "crm_observed",
      },
    ];

    for (const card of cards) {
      const metric = METRICS[card.id];
      stats.append(
        statTile({
          label: card.label,
          value: card.value,
          measurement: card.measurement || "",
          definition: metric?.definition || "",
          delta: card.delta,
          deltaOptions: { polarity: polarity(card.id) || (card.id === "spend" || card.id === "linkClicks" ? null : undefined) },
          series: card.id === "spend" ? series.map((p) => p.spend) : card.id === "results" ? series.map((p) => p.results) : null,
        }),
      );
    }
    node.append(stats);

    // --------------------------------------------------------- measurement --
    node.append(measurementNote(currency));

    // -------------------------------------------------------------- trend ---
    node.append(trendBlock(series, currency));

    // ---------------------------------------------------------- attention ---
    node.append(attentionBlock(attention));

    // ------------------------------------------------------------- footer ---
    node.append(definitionsBlock(currency, result));
  }

  /**
   * The measurement note. This is the single most important paragraph on the
   * screen: it tells the reader why the results tile and the qualified-leads
   * tile will never agree, and which one is closer to the truth.
   */
  function measurementNote(currency) {
    const section = block("How to read these numbers", {
      note: `Spend is in ${currency}. Every delta is against the comparison period set in the header.`,
    });
    const list = el("dl", "ads-defs");
    list.append(
      definitionRow(
        "Meta-attributed results",
        "Counted by Meta under the selected attribution setting. It is a claim about Meta's own reporting, not a measurement of the business. Changing the attribution window re-reads the saved rows.",
      ),
      definitionRow(
        "CRM-observed qualified leads",
        "Counted by the CRM after a human-qualified stage. This is the only number here that can speak to qualified demand, and it lags the spend that produced it.",
      ),
      definitionRow(
        "Cost per qualified lead",
        "Joins a provider cost to an observed outcome, so the two halves come from different systems and will not reconcile exactly.",
      ),
      definitionRow(
        "Reach",
        "Provider-modelled and not additive across rows. Reach for a group is not the sum of its parts, which is why it is not totalled on this screen.",
      ),
    );
    section.append(list);
    return section;
  }

  // ---------------------------------------------------------------- trend --

  /**
   * One chart. Daily spend as columns with the day's results as a line over it,
   * because the question an operator actually has is "am I buying results at a
   * steady rate or did something break", and that is a shape, not a number.
   *
   * The chart is decorative-with-a-table: the same data is reachable as text
   * through the summary line and the title attributes, so it is not the only
   * way to read the numbers.
   */
  function trendBlock(series, currency) {
    const section = block("Spend and results by day", {
      note: "Columns are spend. The line is provider-attributed results on the same days.",
    });
    if (!series.length) {
      section.append(emptyPanel({ title: "No daily rows", detail: "The sync returned no day-level rows for this window." }));
      return section;
    }

    const width = 760;
    const height = 160;
    const padLeft = 8;
    const padBottom = 22;
    const plotHeight = height - padBottom - 10;
    const maxSpend = Math.max(...series.map((p) => p.spend), 0) || 1;
    const maxResults = Math.max(...series.map((p) => p.results), 0) || 1;
    const step = (width - padLeft * 2) / series.length;
    const barWidth = Math.max(2, step * 0.62);

    const ns = "http://www.w3.org/2000/svg";
    const svgNode = document.createElementNS(ns, "svg");
    svgNode.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgNode.setAttribute("class", "ads-chart");
    svgNode.setAttribute("role", "img");
    const totalSpend = series.reduce((sum, p) => sum + p.spend, 0);
    const totalResults = series.reduce((sum, p) => sum + p.results, 0);
    svgNode.setAttribute(
      "aria-label",
      `Daily spend and results over ${series.length} days. ${formatMoney(totalSpend, currency)} spent and ${formatInt(totalResults)} provider-attributed results in total.`,
    );

    // Baseline. Without it the columns float and the eye cannot judge height.
    const base = document.createElementNS(ns, "line");
    base.setAttribute("x1", String(padLeft));
    base.setAttribute("x2", String(width - padLeft));
    base.setAttribute("y1", String(plotHeight + 10));
    base.setAttribute("y2", String(plotHeight + 10));
    base.setAttribute("class", "ads-chart-axis");
    svgNode.append(base);

    const linePoints = [];
    series.forEach((point, index) => {
      const x = padLeft + index * step + (step - barWidth) / 2;
      const barHeight = Math.max(1, (point.spend / maxSpend) * plotHeight);
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", x.toFixed(1));
      rect.setAttribute("y", (plotHeight + 10 - barHeight).toFixed(1));
      rect.setAttribute("width", barWidth.toFixed(1));
      rect.setAttribute("height", barHeight.toFixed(1));
      rect.setAttribute("rx", "1.5");
      rect.setAttribute("class", "ads-chart-bar");
      const title = document.createElementNS(ns, "title");
      title.textContent = `${formatDay(point.date)}: ${formatMoney(point.spend, currency)} spend, ${formatInt(point.results)} results`;
      rect.append(title);
      svgNode.append(rect);
      const cx = padLeft + index * step + step / 2;
      const cy = plotHeight + 10 - (point.results / maxResults) * plotHeight;
      linePoints.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);
    });

    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", linePoints.join(" "));
    line.setAttribute("class", "ads-chart-line");
    svgNode.append(line);

    // First, middle and last date labels only. A label per day is noise.
    [0, Math.floor(series.length / 2), series.length - 1].forEach((index) => {
      const point = series[index];
      if (!point) return;
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", String(padLeft + index * step + step / 2));
      text.setAttribute("y", String(height - 4));
      text.setAttribute("text-anchor", index === 0 ? "start" : index === series.length - 1 ? "end" : "middle");
      text.setAttribute("class", "ads-chart-label");
      text.textContent = formatDay(point.date).replace(/ \d{4}$/, "");
      svgNode.append(text);
    });

    const wrap = el("div", "ads-chart-wrap");
    wrap.append(svgNode);

    const legend = el("div", "ads-chart-legend");
    legend.append(legendItem("bar", "Spend"), legendItem("line", "Results (Meta-attributed)"));
    const peak = series.reduce((best, p) => (p.spend > best.spend ? p : best), series[0]);
    legend.append(el("span", "ads-chart-peak", `Highest spend: ${formatDay(peak.date)} at ${formatMoney(peak.spend, currency)}.`));
    wrap.append(legend);

    section.append(wrap);
    return section;
  }

  function legendItem(kind, label) {
    const item = el("span", "ads-chart-legend-item");
    const swatch = el("span", `ads-chart-swatch ads-chart-swatch-${kind}`);
    item.append(swatch, el("span", "", label));
    return item;
  }

  // ------------------------------------------------------------ attention --

  function attentionBlock(attention) {
    const section = block("What needs attention", {
      note: "Ranked by how much it costs to ignore. Each line opens the record that owns it.",
    });
    if (!attention.length) {
      section.append(
        emptyPanel({
          title: "Nothing flagged in this window",
          detail: "No campaign dropped out of learning, no frequency spike, no tracking defect and no uncertain write. That is a real result, not a missing one.",
        }),
      );
      return section;
    }
    const list = el("ul", "ads-attention");
    for (const item of attention) {
      const row = el("li", "ads-attention-item");
      row.dataset.severity = item.severity || "info";
      const head = el("div", "ads-attention-head");
      const icon = svg(item.severity === "error" ? ICONS.alert : item.severity === "warning" ? ICONS.alert : ICONS.info, { size: 13, width: 1.8 });
      icon.classList.add("ads-attention-icon");
      head.append(icon);
      head.append(el("strong", "", item.title));
      head.append(statusBadge(item.severity === "error" ? "failed" : item.severity === "warning" ? "blocked" : "draft", { label: item.severity === "error" ? "Act now" : item.severity === "warning" ? "Warning" : "For information" }));
      row.append(head);
      if (item.detail) row.append(el("p", "ads-attention-detail", item.detail));
      const actions = el("div", "ads-attention-actions");
      const target = item.kind === "queue" ? "queue" : item.kind === "tracking" ? "tracking" : item.kind === "evidence" ? "campaigns" : "campaigns";
      actions.append(
        button(item.action || "Open", {
          onClick: () => ctx.navigate(target),
          title: `Open ${target}`,
        }),
      );
      row.append(actions);
      list.append(row);
    }
    section.append(list);
    return section;
  }

  // ------------------------------------------------------------ glossary --

  function definitionsBlock(currency, result) {
    const section = block("Definitions used on this screen", {
      note: "Shown so the numbers can be argued with rather than trusted.",
    });
    const list = el("dl", "ads-defs");
    for (const id of ["spend", "results", "costPerResult", "resultRate", "cpm", "frequency", "costPerQualifiedLead"]) {
      const metric = METRICS[id];
      if (!metric) continue;
      list.append(definitionRow(metric.label, metric.definition));
    }
    section.append(list);

    section.append(rowsReadNote(result.fetchedAt, { suffix: "When the reporting sync runs it re-fetches a recent window to pick up delayed attribution, so the last few days can still move. Nothing on this screen calls the provider." }));
    return section;
  }

  const settled = load();
  return {
    node,
    dispose() {
      disposed = true;
      controller.abort();
    },
    settled: () => settled,
    reload: (options = {}) => load({ force: Boolean(options.force) }),
  };
}
