// Ads overview: three questions, answered in place.
//
// The Overview used to be a wall of tiles — spend, results, cost per result,
// clicks, CTR, leads, and a chart — which left an owner to work out for
// themselves what any of it implied. It now answers exactly three questions, in
// this order, and every answer is actionable where it is read:
//
//   1. What needs my attention?      a ranked list of concrete things
//   2. Where is spend producing
//      useful outcomes?              lanes ranked by outcome per unit of spend,
//                                    provider and observed kept apart
//   3. What should I test next?      evidence-backed recommendations
//
// Nothing is decided here. `ads-decisions.js` owns every rule, ranking and
// threshold; this file renders what it returns. That split is what lets the
// rules be tested without a browser and stops a rendering tweak from quietly
// changing a verdict.
//
// Three things this screen must never do, and does not:
//
//   * render a missing number as a zero, or an unobserved outcome as "0";
//   * say "nothing needs you" while a reader has not answered;
//   * send anything. A pause or budget change proposed here writes a local
//     draft through `ctx.drafts`, and the interface says so at the control.

import {
  el,
  clear,
  block,
  button,
  segmented,
  statTile,
  statusBadge,
  evidenceBadge,
  sourceNote,
  svg,
  ICONS,
  notConnectedPanel,
  emptyPanel,
  errorPanel,
  skeleton,
  definitionRow,
  staleBanner,
  rowsReadNote,
  relativeAge,
  createDrawer,
} from "./ads-ui.js";
import { overviewDeliveryChart } from "./ads-chart.js";
import {
  EVIDENCE_FLOOR,
  METRICS,
  formatDay,
  formatInt,
  formatMoney,
  formatPercent,
  formatRatio,
  formatWhen,
  metricValue,
  num,
  rowKey,
  rowName,
  stateOf,
} from "./ads-contracts.js";
import { READER_REQUIREMENTS } from "./ads-source.js";
import { accountCurrency } from "./ads-views.js";
import {
  DESTINATION_LANE,
  RANK_LANES,
  adsForArticle,
  adsForCampaign,
  adsForCreative,
  adsetsForCreative,
  buildDecisions,
  laneEntry,
  outcomeText,
  renditionOf,
} from "./ads-decisions.js";

/** How many items each section shows before it offers the rest. Nothing is
 *  dropped silently: the count of what is not shown is printed beside the
 *  control that shows it. */
const ATTENTION_VISIBLE = 6;
const RECOMMENDATION_VISIBLE = 6;
const LANE_VISIBLE = 8;
const DESTINATION_VISIBLE = 6;

/** One label per reader, used wherever the screen says where a reading came
 *  from. The reader id stays in the title attribute. */
const READER_LABELS = Object.freeze({
  context: "the account record",
  overview: "the window totals",
  entities: "the reporting rows",
  creatives: "the creative rows",
  blogs: "the article rows",
  tracking: "the tracking findings",
  queue: "the publishing queue",
  drafts: "the local draft store",
});

const LEVEL_LABELS = Object.freeze({ campaign: "Campaigns", adset: "Ad sets", ad: "Ads", blog: "Articles" });

/** Which measurement each outcome counter belongs to. Kept here as well as in
 *  the decision module so a number can be labelled at the point of display. */
const COUNTER_MEASUREMENTS = Object.freeze({
  results: "provider_attributed",
  siteConversions: "site_observed",
  qualifiedLeads: "crm_observed",
});

const OUTCOME_METRICS = new Set(Object.keys(COUNTER_MEASUREMENTS));

export function createOverviewScreen(ctx, host) {
  const node = el("div", "ads-overview");
  host.append(node);
  let disposed = false;
  const controller = new AbortController();

  // The drawer is hosted beside the screen node, not inside it: every render
  // clears the screen node, and an open drawer must survive that.
  const drawer = createDrawer({ host, title: "Decision" });

  const state = {
    loading: true,
    reads: {},
    decisions: null,
    level: "campaign",
    expanded: new Set(),
  };

  // The account currency, or nothing. A screen that invents "GBP" mislabels
  // every money figure on it; an empty code makes the formatter say the unit is
  // unknown instead, which is the honest answer when the context has not read.
  const currency = () => accountCurrency(ctx.context);

  // -------------------------------------------------------------- loading --

  async function load({ force = false } = {}) {
    state.loading = true;
    render();
    const params = ctx.params;
    const read = (reader, extra = null) =>
      ctx.reader.read(reader, extra ? { ...params, ...extra } : reader === "context" ? {} : params, { signal: controller.signal, force });

    // Nine reads, because the three answers need rows at every level: a
    // learning-limited ad set lives on the ad set rows, an uncertain write on
    // the queue, and a ranking needs the level the owner is managing. They are
    // all reads of saved rows; none of them calls the provider.
    const [context, overview, campaign, adset, ad, creatives, blogs, tracking, queue] = await Promise.all([
      read("context"),
      read("overview"),
      read("entities", { level: "campaign" }),
      read("entities", { level: "adset" }),
      read("entities", { level: "ad" }),
      read("creatives"),
      read("blogs"),
      read("tracking"),
      read("queue"),
    ]);
    if (disposed) return;
    state.loading = false;
    state.reads = { context, overview, entities: { campaign, adset, ad }, creatives, blogs, tracking, queue };
    recompute();
    render();
  }

  /** Rebuild the decisions from the rows already in hand. Called after a level
   *  switch and after anything that changes the draft store, so the screen
   *  never shows a judgement about rows it no longer holds. */
  function recompute() {
    const drafts = typeof ctx.drafts?.list === "function" ? ctx.drafts.list() : [];
    state.decisions = buildDecisions({ sources: state.reads, drafts, level: state.level, params: ctx.params, now: Date.now() });
  }

  // ------------------------------------------------------------ rendering --

  function render() {
    clear(node);
    if (state.loading) {
      node.append(skeleton(6, 4));
      return;
    }
    const { coverage } = state.decisions;

    if (coverage.allMissing) {
      node.append(
        notConnectedPanel({
          title: "Not connected",
          requirement: READER_REQUIREMENTS.overview,
          action: button("Turn on Preview", {
            variant: "ink",
            title: "Rehearse this screen against clearly labelled synthetic rows.",
            onClick: () => ctx.say("Use the Preview switch in the header to rehearse against sample rows."),
          }),
        }),
      );
      return;
    }

    // Every read failed and none of them kept an earlier copy: there is nothing
    // truthful to draw, and an empty screen would be a claim of its own.
    const nothingRetained = coverage.entries.every((entry) => !entry.answered && !entry.rows);
    if (nothingRetained) {
      const first = coverage.entries.find((entry) => entry.failed);
      node.append(
        errorPanel({
          title: "That read did not complete",
          detail: `${first?.detail || "The Frank read model did not answer."} No earlier copy of these rows is held, so there is nothing honest to show yet.`,
          onRetry: () => void load({ force: true }),
        }),
      );
      return;
    }

    node.append(readStateStrip(coverage));
    node.append(deliveryChartBlock());
    node.append(attentionBlock(state.decisions.attention));
    node.append(outcomesBlock(state.decisions.outcomes));
    node.append(recommendationsBlock(state.decisions.recommendations));
    node.append(footerBlock());
  }

  /**
   * What this reading covers.
   *
   * The strip is deliberately not a wall of tiles: four facts, each labelled
   * with the measurement it belongs to, plus the age of the rows and a named
   * list of anything that could not be checked. That last line is what makes
   * the empty state in section 1 honest.
   */
  function readStateStrip(coverage) {
    const section = el("section", "ads-overview-strip");
    const failed = coverage.entries.filter((entry) => entry.failed);
    if (failed.length) {
      const status = failed.some((entry) => entry.status === "throttled")
        ? "throttled"
        : failed.some((entry) => entry.status === "error")
          ? "error"
          : failed.some((entry) => entry.status === "syncing")
            ? "syncing"
            : "stale";
      // The age in the banner is the age of the rows the reader kept, not of
      // the freshest answer on the screen: one stale source would otherwise
      // read as if nothing at all had answered.
      const retained = coverage.entries.filter((entry) => entry.retained && Number.isFinite(entry.observedAt));
      section.append(
        staleBanner({
          status,
          fetchedAt: retained.length ? Math.min(...retained.map((entry) => entry.observedAt)) : null,
          detail: `The reads that did not complete: ${failed.map((entry) => `${entry.label} (${entry.status})`).join(", ")}. Rows the reader kept stay on screen with their own reading time.`,
          onRefresh: () => ctx.refresh(),
        }),
      );
    }

    const record = state.reads.overview?.data?.meta;
    const totals = record && record.totals && typeof record.totals === "object" ? record.totals : null;
    const previous = record && record.previous && typeof record.previous === "object" ? record.previous : null;

    const strip = el("div", "ads-decisions-strip");
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", "What this reading covers");
    const facts = el("div", "ads-decisions-strip-facts");
    facts.append(stripFact("Window", `${formatDay(ctx.params.from)} → ${formatDay(ctx.params.to)}`));
    if (totals) {
      facts.append(stripFact("Spend", formatMoney(num(totals.spend), currency()), "provider_attributed", deltaFor("spend", totals, previous, "currency")));
      facts.append(stripFact("Meta-attributed results", formatInt(num(totals.results)), "provider_attributed", deltaFor("results", totals, previous)));
      facts.append(stripFact("CRM-qualified leads", formatInt(num(totals.qualifiedLeads)), "crm_observed", deltaFor("qualifiedLeads", totals, previous)));
    } else {
      facts.append(stripFact("Window totals", "Not in this read", "", null, "The overview reader did not return a totals row, so no spend or outcome total is shown."));
    }
    facts.append(stripFact("Rows read", relativeAge(state.reads.overview?.fetchedAt || null)));
    strip.append(facts);

    if (!coverage.complete) {
      const unknowns = coverage.entries.filter((entry) => !entry.answered);
      strip.append(
        el(
          "p",
          "ads-decisions-strip-note",
          `Not checked in this reading: ${unknowns.map((entry) => `${entry.label} (${entry.status})`).join(", ")}. Nothing below is a clean bill of health for those parts of the account.`,
        ),
      );
    }
    return section;
  }

  function stripFact(label, value, measurement = "", delta = null, title = "") {
    const fact = el("div", "ads-decisions-fact");
    const head = el("div", "ads-decisions-fact-head");
    head.append(el("span", "ads-decisions-fact-label", label));
    const note = sourceNote(measurement);
    if (note) head.append(note);
    fact.append(head);
    const valueRow = el("div", "ads-decisions-fact-value");
    valueRow.append(el("span", "ads-num", value));
    if (delta) valueRow.append(delta);
    fact.append(valueRow);
    if (title) fact.title = title;
    return fact;
  }

  /** Movement against the comparison period, computed from the read model's own
   *  previous rollup. A metric the previous period did not carry, or a previous
   *  value of zero, produces no delta at all rather than a made-up percentage. */
  function deltaFor(metricId, totals, previous, kind = "percent") {
    if (!previous) return null;
    const a = metricValue(metricId, totals);
    const b = metricValue(metricId, previous);
    if (a === null || b === null || b === 0) return null;
    const relative = (a - b) / Math.abs(b);
    const higher = METRICS[metricId]?.higherIsBetter;
    const polarity = higher === true ? "up" : higher === false ? "down" : null;
    const magnitude = kind === "currency" ? formatMoney(Math.abs(a - b), currency()) : `${Math.abs(relative * 100).toFixed(1)}%`;
    const text = `${a >= b ? "+" : "−"}${magnitude}`;
    const tone = polarity === null ? "mute" : (a - b >= 0) === (polarity === "up") ? "ok" : "bad";
    const delta = el("span", `ads-delta ads-delta-${tone}`);
    delta.append(svg(a >= b ? ICONS.arrowUp : ICONS.arrowDown, { size: 11, width: 2 }), el("span", "", text));
    delta.title = `${text} against the comparison period, from the read model's own previous rollup.`;
    return delta;
  }

  /**
   * The one chart this screen carries.
   *
   * `DESIGN.md` allows the overview exactly one chart, and this is it: the
   * window's daily delivery, drawn once from the overview reader's own series.
   * `ads-chart.js` owns what it draws and, just as much, what it refuses to
   * draw — a reader that has not answered gets the honest not-connected state
   * rather than a series nobody measured.
   */
  function deliveryChartBlock() {
    return overviewDeliveryChart(state.reads.overview?.data?.meta || null, { currency: currency() });
  }

  // ------------------------------------------------ 1. what needs me --

  function attentionBlock(attention) {
    const items = attention.items;
    const section = block("1 · What needs my attention?", {
      note: "Ranked by what it costs to ignore. Every item names the record by name and immutable id, shows the evidence behind it, how old that reading is, and what it proposes. Selecting an item opens it here.",
    });

    if (!items.length) {
      section.append(
        attention.complete
          ? emptyPanel({
              title: "Nothing needs you in this window",
              detail:
                "Every source answered, and none of them reported a broken tracking URL, a risky budget, a learning-limited ad set, a failed or uncertain write, a stale reading, or spend with no observed outcome.",
            })
          : emptyPanel({
              title: "Nothing found in the parts of the account that answered",
              detail: "That is not the same as nothing being wrong: the reads named above did not answer, so this list cannot cover them.",
            }),
      );
      return section;
    }

    const shown = state.expanded.has("attention") ? items : items.slice(0, ATTENTION_VISIBLE);
    const list = el("ul", "ads-attention");
    for (const item of shown) list.append(attentionRow(item));
    section.append(list);

    if (items.length > shown.length) {
      section.append(
        moreRow(
          `Showing ${formatInt(shown.length)} of ${formatInt(items.length)} items, most costly to ignore first.`,
          "Show every item",
          "attention",
          () => state.expanded.add("attention"),
        ),
      );
    } else if (items.length > ATTENTION_VISIBLE) {
      section.append(moreRow("", "Show fewer", "attention", () => state.expanded.delete("attention")));
    }

    const counts = new Map();
    for (const item of items) counts.set(item.label, (counts.get(item.label) || 0) + 1);
    section.append(el("p", "ads-block-note", `Across the whole list: ${Array.from(counts, ([label, count]) => `${formatInt(count)} ${label.toLowerCase()}`).join(" · ")}.`));
    return section;
  }

  function attentionRow(item) {
    const row = el("li", "ads-attention-item");
    row.dataset.severity = item.severity;

    const head = el("div", "ads-attention-head");
    const icon = svg(item.severity === "info" ? ICONS.info : ICONS.alert, { size: 13, width: 1.8 });
    icon.classList.add("ads-attention-icon");
    head.append(icon);
    const title = el("button", "ads-attention-title", item.title);
    title.type = "button";
    title.title = "Open the supporting rows and the proposed action here.";
    title.addEventListener("click", () => openAttention(item));
    head.append(title);
    head.append(statusBadge(item.severity === "error" ? "failed" : item.severity === "warning" ? "blocked" : "draft", { label: item.label }));
    if (item.entity?.id) head.append(idChip(item.entity.id, `The immutable id of the ${item.entity.kind || "record"} this is about. Ids never change; names do.`));
    row.append(head);

    row.append(el("p", "ads-attention-detail", item.detail));
    const evidence = compactEvidence(item);
    if (evidence) row.append(evidence);
    row.append(readingLine(item));

    const actions = el("div", "ads-decisions-actions");
    actions.append(
      button("Inspect and act", {
        icon: ICONS.chevronRight,
        onClick: () => openAttention(item),
        title: "Open the supporting rows and the proposed action without leaving this screen.",
      }),
    );
    if (item.action) actions.append(el("span", "ads-decisions-proposal", `Proposed: ${item.action.label}`));
    row.append(actions);
    return row;
  }

  /** The evidence, in the list, as numbers rather than adjectives. A failing URL
   *  is shown in full because it is the thing a person can go and look at. */
  function compactEvidence(item) {
    const rows = item.evidence.filter((entry) => entry.value !== null && entry.value !== undefined && entry.value !== "");
    if (!rows.length) return null;
    const list = el("ul", "ads-decisions-evidence");
    for (const entry of rows.slice(0, 3)) {
      const line = el("li", "ads-decisions-ev");
      line.append(el("span", "ads-decisions-ev-label", entry.label));
      const value = el("span", entry.kind === "url" ? "ads-decisions-ev-url" : "ads-num", evidenceText(entry));
      if (entry.kind === "url") value.title = String(entry.value);
      line.append(value);
      list.append(line);
    }
    if (rows.length > 3) list.append(el("li", "ads-decisions-ev-more", `+${formatInt(rows.length - 3)} more lines in the evidence`));
    return list;
  }

  function readingLine(item) {
    const line = el("p", "ads-decisions-age");
    const reader = READER_LABELS[item.reader] || "the read model";
    line.append(document.createTextNode(item.observedAt ? `Read from ${reader} ${relativeAge(item.observedAt)}.` : `Read from ${reader}; the read did not report when.`));
    line.title = `Observation time reported by the ${item.reader} reader.`;
    return line;
  }

  // --------------------------------------------- 2. where spend works --

  function outcomesBlock(outcomes) {
    const levelSwitch = segmented(
      ["campaign", "adset", "ad"].map((level) => ({ id: level, label: LEVEL_LABELS[level] })),
      state.level,
      (level) => {
        if (level === state.level) return;
        state.level = level;
        state.expanded.delete("lane");
        recompute();
        render();
      },
      { label: "Which level to rank" },
    );

    const section = block("2 · Where is spend producing useful outcomes?", {
      actions: [levelSwitch],
      note: "Ranked by outcome per unit of spend, separately for each measurement kind. Meta-attributed results and website/CRM-observed outcomes are different facts and are never added together. Below the evidence floor nothing is ranked, and spend with no observed outcome yet is said in those words.",
    });

    if (outcomes.settling) section.append(el("p", "ads-screen-note", outcomes.settling.message));

    if (!outcomes.rowCount) {
      section.append(
        emptyPanel({
          title: `No ${LEVEL_LABELS[state.level].toLowerCase()} in this window`,
          detail: "The rows reader answered with nothing for these dates, the attribution setting and the filters in the header.",
        }),
      );
    } else {
      const lanes = el("div", "ads-lanes");
      for (const lane of outcomes.lanes) lanes.append(laneBlock(lane));
      section.append(lanes);
    }

    section.append(destinationsBlock(outcomes.destinations));
    section.append(
      el(
        "p",
        "ads-block-note",
        `The floor this window uses: ${formatInt(EVIDENCE_FLOOR.results)} of the ranked outcome and ${formatMoney(EVIDENCE_FLOOR.spendMinor / 100, currency())} of spend. Below either one a row is listed with its numbers and no rank. Frequency, reach and daily rows live on the record, not in the ranking.`,
      ),
    );
    return section;
  }

  function laneBlock(lane) {
    const panel = el("section", "ads-lane");
    panel.dataset.lane = lane.id;
    panel.append(laneHead(lane));

    if (lane.leader) {
      panel.append(
        statTile({
          label: `${lane.costLabel} — best this window`,
          value: formatMoney(lane.leader.costPerOutcome, currency()),
          measurement: lane.measurement,
          definition: METRICS[lane.metric]?.definition || "",
        }),
      );
      const who = el("p", "ads-lane-leader");
      who.append(el("strong", "", lane.leader.name));
      who.append(document.createTextNode(` · ${lane.leader.id}`));
      panel.append(who);
      panel.append(el("p", "ads-lane-note", lane.leaderReason));
    } else {
      panel.append(el("p", "ads-lane-note", lane.leaderReason));
    }

    if (lane.ranked.length) panel.append(laneTable(lane, lane.ranked));

    if (lane.belowFloor.length) {
      const expanded = state.expanded.has(`lane:${lane.id}`);
      const cap = expanded ? lane.belowFloor.length : LANE_VISIBLE;
      panel.append(el("h5", "ads-lane-subtitle", "Below the evidence floor — listed, not ranked"));
      panel.append(laneTable(lane, lane.belowFloor.slice(0, cap)));
      if (lane.belowFloor.length > cap) {
        panel.append(
          moreRow(
            `${formatInt(lane.belowFloor.length - cap)} more below the floor are not shown.`,
            `Show all ${formatInt(lane.belowFloor.length)}`,
            `lane:${lane.id}`,
            () => state.expanded.add(`lane:${lane.id}`),
          ),
        );
      } else if (expanded && lane.belowFloor.length > LANE_VISIBLE) {
        panel.append(moreRow("", "Show fewer", `lane:${lane.id}`, () => state.expanded.delete(`lane:${lane.id}`)));
      }
    }

    if (lane.unmeasured.length) panel.append(unmeasuredNote(lane));
    return panel;
  }

  function laneHead(lane) {
    const head = el("div", "ads-lane-head");
    const title = el("h4", "ads-lane-title", lane.label);
    head.append(title);
    const note = sourceNote(lane.measurement);
    if (note) head.append(note);
    return head;
  }

  function unmeasuredNote(lane) {
    const silent = lane.unmeasured.filter((entry) => !entry.spendReported);
    const spendless = lane.unmeasured.filter((entry) => entry.spendReported);
    const line = el("p", "ads-lane-note");
    if (silent.length) {
      line.append(
        document.createTextNode(
          `${formatInt(silent.length)} row${silent.length === 1 ? "" : "s"} cleared the floor but carried no spend in this read, so there is no per-unit-spend rate: ${silent
            .slice(0, 3)
            .map((entry) => entry.name)
            .join(", ")}${silent.length > 3 ? ` and ${formatInt(silent.length - 3)} more` : ""}. A missing spend is not a zero. `,
        ),
      );
    }
    if (spendless.length) {
      line.append(
        document.createTextNode(
          `${formatInt(spendless.length)} row${spendless.length === 1 ? "" : "s"} recorded no spend in this window, so there is nothing to rank per unit of spend.`,
        ),
      );
    }
    return line;
  }

  function laneTable(lane, entries) {
    const wrap = el("div", "ads-decisions-table-wrap");
    const table = el("table", "ads-decisions-table");
    table.append(el("caption", "ads-visually-hidden", `${lane.label} — ranked by ${lane.rateLabel.toLowerCase()}`));
    const thead = el("thead");
    const hr = el("tr");
    const columns = [
      ["#", "start"],
      ["Record", "start"],
      ["Status", "start"],
      ["Spend", "end"],
      [lane.metric === "results" ? "Results" : "Qualified leads", "end"],
      [lane.costLabel, "end"],
      ["Evidence", "start"],
    ];
    for (const [label, align] of columns) {
      const th = el("th", `ads-decisions-th ads-decisions-${align}`, label);
      th.scope = "col";
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el("tbody");
    for (const entry of entries) {
      const tr = el("tr", "ads-decisions-tr");
      tr.append(el("td", "ads-decisions-td ads-decisions-start ads-num", entry.rank === null ? "—" : String(entry.rank)));

      const nameCell = el("td", "ads-decisions-td ads-decisions-start");
      const name = el("button", "ads-decisions-name", entry.name);
      name.type = "button";
      name.title = "Open the supporting rows here";
      name.addEventListener("click", () => openOutcome(entry, lane));
      nameCell.append(name, el("span", "ads-decisions-id", entry.id));
      tr.append(nameCell);

      const statusCell = el("td", "ads-decisions-td ads-decisions-start");
      if (entry.state) {
        statusCell.append(statusBadge(entry.state, { title: entry.proofOfDelivery ? "The provider is serving or has served this row." : "This state is not proof of delivery." }));
      } else {
        const none = el("span", "ads-decisions-missing", "—");
        none.title = "This reader's rows do not carry a delivery state.";
        statusCell.append(none);
      }
      tr.append(statusCell);

      tr.append(
        el(
          "td",
          `ads-decisions-td ads-decisions-end ads-num${entry.spend ? "" : " ads-decisions-missing"}`,
          entry.spend === null ? "Not in this read" : entry.spend === 0 ? "No spend recorded" : formatMoney(entry.spend, currency()),
        ),
      );

      const outcomeCell = el(
        "td",
        `ads-decisions-td ads-decisions-end ads-num${entry.outcomeReported && entry.outcome > 0 ? "" : " ads-decisions-missing"}`,
        entry.outcomeReported && entry.outcome > 0 ? formatInt(entry.outcome) : outcomeText(entry),
      );
      tr.append(outcomeCell);

      tr.append(
        el(
          "td",
          `ads-decisions-td ads-decisions-end ads-num${entry.costPerOutcome === null ? " ads-decisions-missing" : ""}`,
          entry.costPerOutcome === null ? (entry.outcomeReported ? "No observed outcome yet" : "Not in this read") : formatMoney(entry.costPerOutcome, currency()),
        ),
      );

      const evidenceCell = el("td", "ads-decisions-td ads-decisions-start");
      evidenceCell.append(evidenceBadge(entry.evidence));
      tr.append(evidenceCell);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  /**
   * Destinations: the articles an ad promoted, ranked on CRM-qualified leads
   * per unit of the spend the article's own row reports.
   *
   * This is the entry point to the article drill-down, and it is a lane of its
   * own rather than a column on the campaign lanes because the spend and the
   * outcomes come from different readers. Website-observed sessions and
   * conversions stay on the article and are never added into this column.
   */
  function destinationsBlock(destinations) {
    const panel = el("section", "ads-lane ads-lane-wide");
    panel.dataset.lane = "destinations";
    panel.append(laneHead(destinations));
    panel.append(
      el(
        "p",
        "ads-lane-note",
        `Ranked on CRM-qualified leads per unit of the article's own ad spend. Website-observed sessions and conversions are on the article's record and are never added to this column. ${formatInt(
          destinations.unpromotedCount,
        )} article${destinations.unpromotedCount === 1 ? "" : "s"} in this read had no spend in the window and are not ranked.`,
      ),
    );

    if (!destinations.promotedCount) {
      panel.append(el("p", "ads-lane-note", "No article in this read carries ad spend for this window, so there is nothing to rank."));
      return panel;
    }

    if (destinations.leader) {
      panel.append(
        statTile({
          label: `${destinations.costLabel} — best this window`,
          value: formatMoney(destinations.leader.costPerOutcome, currency()),
          measurement: destinations.measurement,
          definition: METRICS.qualifiedLeads.definition,
        }),
      );
      const who = el("p", "ads-lane-leader");
      who.append(el("strong", "", destinations.leader.name));
      who.append(document.createTextNode(` · ${destinations.leader.id}`));
      panel.append(who);
    }
    panel.append(el("p", "ads-lane-note", destinations.leaderReason));

    if (destinations.ranked.length) panel.append(laneTable(destinations, destinations.ranked));

    if (destinations.belowFloor.length) {
      const expanded = state.expanded.has("lane:destinations");
      const cap = expanded ? destinations.belowFloor.length : DESTINATION_VISIBLE;
      panel.append(el("h5", "ads-lane-subtitle", "Below the evidence floor — listed, not ranked"));
      panel.append(laneTable(destinations, destinations.belowFloor.slice(0, cap)));
      if (destinations.belowFloor.length > cap) {
        panel.append(
          moreRow(
            `${formatInt(destinations.belowFloor.length - cap)} more articles are below the floor and not shown.`,
            `Show all ${formatInt(destinations.belowFloor.length)}`,
            "lane:destinations",
            () => state.expanded.add("lane:destinations"),
          ),
        );
      } else if (expanded && destinations.belowFloor.length > DESTINATION_VISIBLE) {
        panel.append(moreRow("", "Show fewer", "lane:destinations", () => state.expanded.delete("lane:destinations")));
      }
    }
    return panel;
  }

  // --------------------------------------------- 3. what to test next --

  function recommendationsBlock(recommendations) {
    const items = recommendations.items;
    const section = block("3 · What should I test next?", {
      note: "Each recommendation carries the evidence it came from and states what would change its mind. Selecting one opens that evidence and the change it would stage, here.",
    });

    if (!items.length) {
      section.append(
        recommendations.complete
          ? emptyPanel({
              title: "No test is indicated by these rows",
              detail:
                "Nothing in this window separated two creatives, showed a strong rate short of volume, repeated an idea, or left a creative unjudged with spend behind it.",
            })
          : emptyPanel({
              title: "Nothing can be recommended from the rows that answered",
              detail: "The creative rows did not come back, so no recommendation about them would be honest.",
            }),
      );
      return section;
    }

    const order = diverseOrder(items);
    const shown = state.expanded.has("recommendations") ? order : order.slice(0, RECOMMENDATION_VISIBLE);
    const list = el("ul", "ads-attention");
    for (const item of shown) list.append(recommendationRow(item));
    section.append(list);

    if (order.length > shown.length) {
      section.append(
        moreRow(
          `Showing ${formatInt(shown.length)} of ${formatInt(order.length)} recommendations, strongest first, at most two of a kind before the rest.`,
          "Show every recommendation",
          "recommendations",
          () => state.expanded.add("recommendations"),
        ),
      );
    } else if (order.length > RECOMMENDATION_VISIBLE) {
      section.append(moreRow("", "Show fewer", "recommendations", () => state.expanded.delete("recommendations")));
    }

    const counts = new Map();
    for (const item of items) counts.set(item.label, (counts.get(item.label) || 0) + 1);
    section.append(el("p", "ads-block-note", `Across the whole list: ${Array.from(counts, ([label, count]) => `${formatInt(count)} ${label.toLowerCase()}`).join(" · ")}.`));
    return section;
  }

  /**
   * Weight order, then interleaved so the first screenful shows different kinds
   * of decision rather than five of one kind. Nothing is dropped: the rest
   * follow in weight order.
   */
  function diverseOrder(items) {
    const first = [];
    const rest = [];
    const perKind = new Map();
    for (const item of items) {
      const count = perKind.get(item.kind) || 0;
      perKind.set(item.kind, count + 1);
      (count < 2 ? first : rest).push(item);
    }
    return [...first, ...rest];
  }

  function recommendationRow(item) {
    const row = el("li", "ads-attention-item");
    row.dataset.severity = item.kind === "keep_running" ? "info" : "warning";

    const head = el("div", "ads-attention-head");
    const icon = svg(item.kind === "keep_running" ? ICONS.info : ICONS.layers, { size: 13, width: 1.8 });
    icon.classList.add("ads-attention-icon");
    head.append(icon);
    const title = el("button", "ads-attention-title", item.title);
    title.type = "button";
    title.title = "Open the supporting evidence and the proposed change here.";
    title.addEventListener("click", () => openRecommendation(item));
    head.append(title);
    head.append(statusBadge("draft", { label: item.label }));
    if (item.entity?.id) head.append(idChip(item.entity.id, `The immutable id of the ${item.entity.kind || "record"} this is about.`));
    row.append(head);

    row.append(el("p", "ads-attention-detail", item.detail));
    const evidence = compactEvidence(item);
    if (evidence) row.append(evidence);
    row.append(readingLine(item));

    if (item.whatWouldChange.length) {
      const change = el("p", "ads-decisions-whatif");
      change.append(el("strong", "", "What would change it: "));
      change.append(document.createTextNode(item.whatWouldChange.join(" ")));
      row.append(change);
    }

    const actions = el("div", "ads-decisions-actions");
    actions.append(
      button("See the evidence and the change", {
        icon: ICONS.chevronRight,
        onClick: () => openRecommendation(item),
        title: "Open the supporting rows and the proposed change without leaving this screen.",
      }),
    );
    actions.append(el("span", "ads-decisions-proposal", `Proposed: ${item.action?.label || "no change"}`));
    row.append(actions);
    return row;
  }

  // ------------------------------------------------------------ footer --

  function footerBlock() {
    const section = block("How to read this screen", { note: "The rules the three answers use, stated so they can be argued with." });
    const list = el("dl", "ads-defs");
    list.append(
      definitionRow(
        "Attention ranking",
        "Ordered by what it costs to ignore: a broken tracking URL invalidates every number that depends on it, an uncertain write can duplicate an ad, and a low-volume row is a question rather than a loss.",
      ),
      definitionRow(
        "Outcome per unit of spend",
        "Outcomes divided by spend within one measurement kind. Meta-attributed results and website/CRM-observed outcomes are ranked in separate lanes and are never added together.",
      ),
      definitionRow(
        "Evidence floor",
        `A rate is ranked only once the outcome count and the spend behind it clear the floor (${formatInt(EVIDENCE_FLOOR.results)} of the ranked outcome, ${formatMoney(
          EVIDENCE_FLOOR.spendMinor / 100,
          currency(),
        )} of spend). Below it a row is listed with its numbers and no rank.`,
      ),
      definitionRow("No observed outcome yet", "A counter that answered zero, and a counter that did not come back at all, are both shown in those words. Neither is rendered as zero."),
      definitionRow("Submission is not delivery", "Nothing here claims Meta accepted anything. Only the Delivering and Paused states mean the provider actually served an ad."),
      definitionRow("Where staging happens", "A pause or a budget change proposed here is written to the local draft queue. Nothing is sent to the provider from this screen."),
    );
    section.append(list);
    section.append(rowsReadNote(state.reads.overview?.fetchedAt || null, { suffix: "Nothing on this screen calls the provider." }));
    return section;
  }

  // ----------------------------------------------------------- drawers --

  function idChip(id, title) {
    const chip = el("span", "ads-decisions-id", id);
    if (title) chip.title = title;
    return chip;
  }

  /** A "show the rest" control that keeps the keyboard where it was: the button
   *  is replaced by the render, so focus is moved back to it by its toggle id. */
  function moreRow(note, label, toggleId, mutate) {
    const row = el("div", "ads-decisions-more");
    if (note) row.append(el("span", "ads-block-note", note));
    const control = button(label, {
      variant: "ghost",
      onClick: () => {
        mutate();
        render();
        node.querySelector(`[data-toggle="${toggleId}"]`)?.focus();
      },
    });
    control.dataset.toggle = toggleId;
    row.append(control);
    return row;
  }

  /** The value of one evidence line, with the two rules that matter: a missing
   *  value says so, and an observed zero is never printed as zero. */
  function evidenceText(row) {
    if (row.value === null || row.value === undefined || row.value === "") return row.note || "Not in this read";
    if (row.kind === "missing") return row.note || "Not in this read";
    if (OUTCOME_METRICS.has(row.metric) && num(row.value) === 0) return "No observed outcome yet";
    if (row.metric === "spend" && num(row.value) === 0) return "No spend recorded in this window";
    switch (row.kind) {
      case "currency":
        return formatMoney(num(row.value), currency());
      case "count":
        return formatInt(num(row.value));
      case "percent":
        return formatPercent(num(row.value));
      case "ratio":
        return formatRatio(num(row.value));
      case "when":
        return row.value ? formatWhen(row.value) : "—";
      default:
        return String(row.value);
    }
  }

  function factRow(term, value, measurement = "", title = "") {
    const definition = definitionRow(term, "");
    const target = definition.lastChild;
    target.append(document.createTextNode(value));
    if (measurement) {
      const note = sourceNote(measurement);
      if (note) target.append(document.createTextNode(" "), note);
    }
    if (title) definition.title = title;
    return definition;
  }

  function evidenceBlock(rows, title = "Evidence") {
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", title));
    const list = el("dl", "ads-defs");
    for (const row of rows) list.append(factRow(row.label, evidenceText(row), row.measurement, row.note || ""));
    section.append(list);
    return section;
  }

  /** Every measurement a row carries, each labelled and never combined. */
  function measurementFacts(row) {
    const list = el("dl", "ads-defs");
    const spend = num(row?.spend);
    const results = num(row?.results);
    const site = num(row?.siteConversions);
    const leads = num(row?.qualifiedLeads);
    list.append(
      factRow("Spend in this window", spend === null ? "Not in this read" : formatMoney(spend, currency()), "provider_attributed"),
      factRow("Meta-attributed results", results === null ? "Not in this read" : results === 0 ? "No observed outcome yet" : formatInt(results), "provider_attributed"),
      factRow("Cost per result", results ? formatMoney(spend / results, currency()) : results === 0 ? "No observed outcome yet" : "Not in this read", "provider_attributed"),
      factRow("Website-observed conversions", site === null ? "Not in this read" : site === 0 ? "No observed outcome yet" : formatInt(site), "site_observed"),
      factRow("CRM-qualified leads", leads === null ? "Not in this read" : leads === 0 ? "No observed outcome yet" : formatInt(leads), "crm_observed"),
      factRow("Cost per qualified lead", leads ? formatMoney(spend / leads, currency()) : leads === 0 ? "No observed outcome yet" : "Not in this read", "crm_observed"),
    );
    return list;
  }

  /**
   * Every record an item concerns, as buttons that ask the workspace to open
   * it. `openRecord` is the workspace's own routing: when it is absent or
   * answers false, the screen says so instead of pretending it worked.
   */
  function recordsBlock(item) {
    if (!item.records.length) return null;
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Records this is about"));
    const list = el("div", "ads-decisions-records");
    for (const record of item.records) {
      const line = el("div", "ads-decisions-record");
      const body = el("div", "ads-decisions-record-body");
      body.append(el("strong", "", record.name || record.id));
      body.append(el("span", "ads-decisions-id", `${record.kind || "record"} · ${record.id}`));
      line.append(body);
      line.append(
        button("Open", {
          onClick: () => openRecord(record),
          title: `Open this ${record.kind || "record"} in the screen that owns it.`,
        }),
      );
      list.append(line);
    }
    section.append(list);
    return section;
  }

  function openRecord(record) {
    const open = ctx.openRecord;
    if (typeof open !== "function") {
      ctx.say(`Opening ${record.kind || "a record"} in place is not wired into this build yet. Nothing was changed.`);
      return false;
    }
    let result = null;
    try {
      result = open({ kind: record.kind, id: record.id, screen: screenFor(record.kind) });
    } catch {
      result = false;
    }
    if (result && typeof result.then === "function") {
      result.then((value) => {
        if (value === false) ctx.say(`Frank could not open ${record.kind || "that record"} ${record.id} here. Nothing was changed.`);
      });
      return true;
    }
    if (result === false) {
      ctx.say(`Frank could not open ${record.kind || "that record"} ${record.id} here. Nothing was changed.`);
      return false;
    }
    return true;
  }

  function screenFor(kind) {
    if (kind === "creative") return "creative";
    if (kind === "blog") return "blogs";
    if (kind === "batch" || kind === "queue_row" || kind === "draft") return "queue";
    return "campaigns";
  }

  function rowsAtLevel(level) {
    const source = state.reads.entities?.[level];
    const rows = Array.isArray(source?.data?.rows) ? source.data.rows : [];
    return rows.map((row) => ({ ...row, ...(row.totals || {}), level: String(row.level || level) }));
  }

  function rowById(id) {
    for (const level of ["ad", "adset", "campaign"]) {
      const found = rowsAtLevel(level).find((row) => rowKey(row) === String(id));
      if (found) return found;
    }
    return null;
  }

  function creativeById(id) {
    const rows = Array.isArray(state.reads.creatives?.data?.rows) ? state.reads.creatives.data.rows : [];
    return rows.map((row) => ({ ...row, ...(row.totals || {}) })).find((row) => rowKey(row) === String(id)) || null;
  }

  function articleById(id) {
    const rows = Array.isArray(state.reads.blogs?.data?.rows) ? state.reads.blogs.data.rows : [];
    const found = rows.find((row) => rowKey(row) === String(id));
    // The article's outcomes live under `totals`; lifting them here means the
    // same metric reads the same way wherever the row is inspected.
    return found ? { ...found, ...(found.totals || {}), level: "blog" } : null;
  }

  function laneFor(id) {
    return (
      state.decisions?.outcomes?.lanes?.find((entry) => entry.id === id) ||
      state.decisions?.outcomes?.destinations || {
        id,
        label: "Meta-attributed results",
        metric: "results",
        rateLabel: "Results per unit of spend",
        costLabel: "Cost per result",
        leaderReason: "",
        ranked: [],
      }
    );
  }

  // ------------------------------------------------- attention drawer --

  function openAttention(item) {
    drawer.setTitle(item.title);
    drawer.show((body) => {
      const head = el("div", "ads-detail-head");
      head.append(statusBadge(item.severity === "error" ? "failed" : item.severity === "warning" ? "blocked" : "draft", { label: item.label }));
      if (item.entity?.id) head.append(el("span", "ads-detail-id", item.entity.id));
      body.append(head);
      body.append(el("p", "ads-screen-note", item.detail));
      body.append(evidenceBlock(item.evidence));

      // What the flagged record is actually doing, so the reader can see the
      // money behind the flag rather than only the flag itself.
      const numbers = entityNumbersBlock(item.entity);
      if (numbers) body.append(numbers);

      const freshness = el("div", "ads-block");
      freshness.append(el("h3", "ads-block-title", "How old this reading is"));
      freshness.append(rowsReadNote(item.observedAt, { suffix: `Read from ${READER_LABELS[item.reader] || "the read model"}.` }));
      body.append(freshness);

      const drill = drilldownBlock(item.entity);
      if (drill) body.append(drill);
      const records = recordsBlock(item);
      if (records) body.append(records);
      body.append(proposalBlock(item));
    });
  }

  /** The measurements of the record an item is about, looked up by id. Absent
   *  for anything this screen did not read rows for (a queue batch, a draft). */
  function entityNumbersBlock(entity) {
    if (!entity?.id) return null;
    const row = entityRow(entity.kind, entity.id);
    if (!row) return null;
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "The numbers behind it"));
    section.append(measurementFacts(row));
    const issues = Array.isArray(row.issues) ? row.issues : [];
    if (issues.length) {
      section.append(el("p", "ads-block-note", "Flags this row carries in the read:"));
      const list = el("ul", "ads-decisions-whatif-list");
      for (const issue of issues) list.append(el("li", "", `${issue.kind || "flag"}: ${issue.detail || ""}`.trim()));
      section.append(list);
    }
    return section;
  }

  function entityRow(kind, id) {
    if (kind === "creative") return creativeById(id);
    if (kind === "blog") return articleById(id);
    if (kind === "ad" || kind === "adset" || kind === "campaign") return rowById(id);
    return null;
  }

  // --------------------------------------------------- outcome drawer --

  function openOutcome(entry, lane) {
    drawer.setTitle(entry.name);
    drawer.show((body) => rowDetailBody(body, entry, lane, `Ranked by ${lane.rateLabel.toLowerCase()}. ${lane.leaderReason}`));
  }

  /** A row opened from a drill-down rather than from the ranking. It uses the
   *  same evidence maths, so the floor is applied identically wherever a row is
   *  inspected. */
  function openRowDetail(row, level) {
    const entry = laneEntry(row, RANK_LANES.provider_attributed, level);
    drawer.setTitle(entry.name);
    drawer.show((body) => rowDetailBody(body, entry, null, `${LEVEL_LABELS[level] || "Rows"} opened from a drill-down, not from the ranking.`));
  }

  function rowDetailBody(body, entry, lane, note) {
    const head = el("div", "ads-detail-head");
    head.append(statusBadge(entry.state, { title: entry.proofOfDelivery ? "The provider is serving or has served this row." : "This state is not proof of delivery." }));
    head.append(el("span", "ads-detail-id", entry.id));
    body.append(head);
    body.append(el("p", "ads-screen-note", note));

    const facts = el("div", "ads-block");
    facts.append(el("h3", "ads-block-title", "The numbers behind it"));
    facts.append(measurementFacts(entry.row));
    const floor = entry.evidence;
    const rankLine = el("p", "ads-block-note", `${entry.rank === null ? "Not ranked in this lane" : `Rank ${formatInt(entry.rank)} of ${formatInt(lane?.ranked.length || 1)}`} · ${floor.reason} The floor is ${formatInt(floor.floor)} of the ranked outcome and ${formatMoney(floor.spendFloorMinor / 100, currency())} of spend.`);
    facts.append(rankLine);
    const badges = el("div", "ads-state-strip");
    badges.append(evidenceBadge(floor));
    facts.append(badges);
    body.append(facts);

    const series = Array.isArray(entry.row?.series) ? entry.row.series : [];
    if (series.length) {
      const daily = el("div", "ads-block");
      daily.append(el("h3", "ads-block-title", "Delivery by day"));
      const wrap = el("div", "ads-decisions-table-wrap");
      const table = el("table", "ads-decisions-table");
      const thead = el("thead");
      const hr = el("tr");
      for (const [label, align] of [["Day", "start"], ["Spend", "end"], ["Results", "end"], ["Cost per result", "end"]]) {
        const th = el("th", `ads-decisions-th ads-decisions-${align}`, label);
        th.scope = "col";
        hr.append(th);
      }
      thead.append(hr);
      const tbody = el("tbody");
      for (const point of series.slice(-14).reverse()) {
        const spend = num(point.spend);
        const results = num(point.results);
        const tr = el("tr", "ads-decisions-tr");
        tr.append(el("td", "ads-decisions-td", formatDay(point.date)));
        tr.append(el("td", "ads-decisions-td ads-decisions-end ads-num", spend === null ? "Not in this read" : formatMoney(spend, currency())));
        tr.append(el("td", `ads-decisions-td ads-decisions-end ads-num${results ? "" : " ads-decisions-missing"}`, results === null ? "Not in this read" : results === 0 ? "No observed outcome yet" : formatInt(results)));
        tr.append(el("td", "ads-decisions-td ads-decisions-end ads-num", results ? formatMoney(spend / results, currency()) : "—"));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      wrap.append(table);
      daily.append(wrap);
      daily.append(el("p", "ads-block-note", "Daily Meta-attributed results are the provider's own attribution for that day, and the last few days of the window are still settling."));
      body.append(daily);
    }

    const drill = drilldownBlock({ kind: entry.level, id: entry.id, name: entry.name });
    if (drill) body.append(drill);

    const proposal = el("div", "ads-block");
    proposal.append(el("h3", "ads-block-title", "Proposed action"));
    proposal.append(stagingNote());
    proposal.append(stagingControls(proposalTargets(entry), { allowBudget: true, allowPause: true }));
    body.append(proposal);
  }

  /** What a proposed change would actually be staged against. For an article
   *  that is the ads promoting it; for anything else it is the row itself. */
  function proposalTargets(entry) {
    if (entry.level === "blog") {
      const article = articleById(entry.id);
      const creatives = Array.isArray(state.reads.creatives?.data?.rows) ? state.reads.creatives.data.rows : [];
      const ads = article ? adsForArticle(article, rowsAtLevel("ad"), creatives) : [];
      return ads.map((ad) => ({ kind: "ad", id: rowKey(ad), name: rowName(ad), level: "ad" }));
    }
    return [{ kind: entry.level, id: entry.id, name: entry.name, level: entry.level }];
  }

  // -------------------------------------------- recommendation drawer --

  function openRecommendation(item) {
    drawer.setTitle(item.title);
    drawer.show((body) => {
      const head = el("div", "ads-detail-head");
      head.append(statusBadge("draft", { label: item.label }));
      if (item.entity?.id) head.append(el("span", "ads-detail-id", item.entity.id));
      body.append(head);
      body.append(el("p", "ads-screen-note", item.detail));
      body.append(evidenceBlock(item.evidence));

      const change = el("div", "ads-block");
      change.append(el("h3", "ads-block-title", "What would change this conclusion"));
      const list = el("ul", "ads-decisions-whatif-list");
      for (const line of item.whatWouldChange) list.append(el("li", "", line));
      change.append(list);
      body.append(change);

      const drill = drilldownBlock(item.entity);
      if (drill) body.append(drill);
      const records = recordsBlock(item);
      if (records) body.append(records);
      body.append(proposalBlock(item));
    });
  }

  function proposalBlock(item) {
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Proposed action"));
    section.append(el("p", "ads-block-note", item.action?.label || "No change is proposed for this item."));
    section.append(stagingNote());
    const action = item.action;
    if (!action) return section;

    if (action.kind === "refresh") {
      section.append(
        button("Re-read the saved rows", {
          variant: "ink",
          icon: ICONS.refresh,
          onClick: () => {
            ctx.refresh();
            drawer.close();
          },
          title: "Re-reads the rows Frank already saved. Nothing is sent to the provider.",
        }),
      );
      return section;
    }
    if (action.kind === "open_record" && action.record) {
      section.append(button(action.label, { variant: "ink", onClick: () => openRecord(action.record) }));
      section.append(launchSeedButton(action));
      return section;
    }
    if (action.kind === "open_draft") {
      section.append(
        button(action.label, {
          variant: "ink",
          onClick: () => {
            ctx.openDraft(action.draftId);
            drawer.close();
          },
          title: "Open the staged change in the publishing queue.",
        }),
      );
      return section;
    }
    if (action.kind === "stage_pause") {
      section.append(stagingControls(action.targets, { allowBudget: false, allowPause: true }));
      section.append(launchSeedButton(action));
      return section;
    }
    if (action.kind === "stage_budget") {
      section.append(stagingControls(action.targets, { allowBudget: true, allowPause: false, percents: action.percents }));
      section.append(launchSeedButton(action));
      return section;
    }
    return section;
  }

  /**
   * Start a test from a creative the evidence points at.
   *
   * The launch flow owns that draft: this only opens it with the creative
   * already chosen. Nothing is staged here, and nothing is sent.
   */
  function launchSeedButton(action) {
    const ids = Array.isArray(action?.launchSeed?.creativeIds) ? action.launchSeed.creativeIds.filter(Boolean) : [];
    if (!ids.length || typeof ctx.openPublish !== "function") return el("span", "ads-sr", "");
    return button("Start a launch seeded with this creative", {
      onClick: () => {
        ctx.openPublish({ creativeIds: ids });
        drawer.close();
      },
      title: "Opens the bulk launch flow with this creative selected. Everything it stages stays local until a gated write exists.",
    });
  }

  /** The one sentence that has to sit beside every control that stages. */
  function stagingNote() {
    return el(
      "p",
      "ads-decisions-staging-note",
      ctx.isPreview()
        ? "This is a rehearsal against synthetic rows. Staging writes a rehearsal draft in this browser and nothing is sent — not to Meta, and not to the live queue."
        : "Staging is local: it adds a draft to the publishing queue in this browser. Nothing is sent to Meta from this screen, and no state here claims that Meta accepted anything.",
    );
  }

  /**
   * The staging controls for a set of rows.
   *
   * The percentage is the owner's choice, never a default this screen picked:
   * until they choose one there is nothing to stage, because a budget number
   * invented here would be a number nobody decided.
   */
  function stagingControls(targets, { allowBudget = true, allowPause = true, percents = [10, 25, 50] } = {}) {
    const wrap = el("div", "ads-decisions-staging");
    const rows = targets.map((target) => rowById(target.id)).filter(Boolean);
    if (!rows.length) {
      wrap.append(el("p", "ads-block-note", "The row this would change is not in the rows on screen, so nothing can be staged from here. Re-read the screen and try again."));
      return wrap;
    }
    const withBudget = rows.filter((row) => num(row.budget) !== null);
    const withoutBudget = rows.length - withBudget.length;

    wrap.append(el("p", "ads-block-note", `${formatInt(rows.length)} row${rows.length === 1 ? "" : "s"} would change, each listed with its before and after value in the publishing queue.`));
    if (withoutBudget) {
      wrap.append(
        el("p", "ads-block-note", `${formatInt(withoutBudget)} of them have no budget in this read. A missing budget is not zero, so those rows are left out of a budget change and can be paused instead.`),
      );
    }

    if (allowPause) {
      wrap.append(
        button("Stage a pause", {
          onClick: () => stageChange("pause", rows, 0),
          title: "Stage a local pause of every row listed. Nothing is sent to Meta.",
        }),
      );
    }

    if (allowBudget) {
      if (!withBudget.length) {
        wrap.append(el("p", "ads-field-hint", "No row here carries a budget in this read, so no budget change can be staged."));
        return wrap;
      }
      let percent = null;
      const row = el("div", "ads-decisions-staging-row");
      const picker = el("div", "ads-decisions-percent");
      picker.setAttribute("role", "group");
      picker.setAttribute("aria-label", "Budget change");
      const options = [];
      for (const value of percents) {
        const option = el("button", "ads-decisions-percent-option", `${value > 0 ? "+" : ""}${value}%`);
        option.type = "button";
        option.setAttribute("aria-pressed", "false");
        option.addEventListener("click", () => {
          percent = Number(value);
          for (const other of options) other.setAttribute("aria-pressed", other === option ? "true" : "false");
          stage.disabled = false;
        });
        options.push(option);
        picker.append(option);
      }
      const stage = button("Stage the budget change", {
        variant: "ink",
        disabled: true,
        title: "Choose a percentage first. This screen does not pick a budget number for you.",
        onClick: () => stageChange("budget", withBudget, percent),
      });
      wrap.append(el("p", "ads-field-hint", "Choose how much to change each budget by. The exact before and after values are listed in the queue before anything would be sent."));
      row.append(picker, stage);
      wrap.append(row);
    }
    return wrap;
  }

  /**
   * Write one staged change through the shared draft model.
   *
   * `origin` follows the preview switch, so a rehearsal draft can never appear
   * in a live queue: the store keeps the two sides apart. The phase stays local
   * — a draft cannot claim that Meta accepted anything.
   */
  function stageChange(kind, rows, percent) {
    if (typeof ctx.drafts?.save !== "function") {
      ctx.say("The draft store is not available in this build, so nothing could be staged.");
      return;
    }
    const levels = new Set(rows.map((row) => row.level));
    const noun = levels.size === 1 ? LEVEL_LABELS[rows[0].level]?.toLowerCase() || "rows" : "rows";
    const saved = ctx.drafts.save({
      kind: kind === "pause" ? "pause" : "budget",
      origin: ctx.isPreview() ? "preview" : "live",
      approval: "staged",
      state: "queued",
      title: kind === "pause" ? `Pause ${rows.length} ${noun}` : `${percent > 0 ? "+" : ""}${percent}% budget across ${rows.length} ${noun}`,
      campaign: { currency: currency(), budgetKind: "daily" },
      changes: {
        kind: kind === "pause" ? "pause" : "budget",
        percent: kind === "pause" ? 0 : percent,
        direction: kind === "pause" || percent < 0 ? "decrease" : "increase",
        batches: [],
        gaps: [],
        rows: rows.map((row) => {
          const before = num(row.budget);
          const after = before === null ? null : kind === "pause" ? before : Math.max(1, Math.round(before * (1 + percent / 100) * 100) / 100);
          return { key: rowKey(row), name: rowName(row), level: row.level, state: stateOf(row), before, after };
        }),
      },
    });
    ctx.say(
      kind === "pause"
        ? `Staged a local pause for ${formatInt(saved.changes.rows.length)} rows in the publishing queue. Nothing has been sent to Meta.`
        : `Staged a local ${percent > 0 ? "+" : ""}${percent}% budget change for ${formatInt(saved.changes.rows.length)} rows in the publishing queue. Nothing has been sent to Meta.`,
    );
    drawer.close();
    recompute();
    render();
  }

  // ----------------------------------------------------- drill-downs --

  /**
   * The drill-downs the brief names, all reachable without leaving the screen:
   * a campaign's ads, an ad set's ads, an ad's creative version with the prompt
   * that produced it and its destination, a creative's ads and ad sets, and an
   * article's traffic sources, ads and conversions. Everything joins on ids.
   */
  function drilldownBlock(record) {
    if (!record || !record.id) return null;
    if (record.kind === "campaign") return campaignDrilldown(record.id);
    if (record.kind === "adset") return adsetDrilldown(record.id);
    if (record.kind === "ad") return adDrilldown(record.id);
    if (record.kind === "creative") return creativeDrilldown(record.id);
    if (record.kind === "blog") return articleDrilldown(record.id);
    return null;
  }

  function campaignDrilldown(campaignId) {
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Its ads"));
    const attached = adsForCampaign(campaignId, rowsAtLevel("adset"), rowsAtLevel("ad"));
    section.append(attached.length ? adTable(attached) : el("p", "ads-block-note", "No ad row in this window has an ad set that belongs to this campaign."));
    return section;
  }

  function adsetDrilldown(adsetId) {
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Its ads"));
    const attached = rowsAtLevel("ad").filter((ad) => String(ad.parentId || "") === String(adsetId));
    section.append(attached.length ? adTable(attached) : el("p", "ads-block-note", "No ad row in this window belongs to this ad set."));
    return section;
  }

  function adTable(ads) {
    const wrap = el("div", "ads-decisions-table-wrap");
    const table = el("table", "ads-decisions-table");
    const thead = el("thead");
    const hr = el("tr");
    // The id sits under the name in the first column rather than taking a
    // column of its own: it is part of how the row is identified, and the
    // drawer is narrow enough that a separate column pushes the cost off the
    // edge.
    for (const [label, align] of [["Ad", "start"], ["Status", "start"], ["Spend", "end"], ["Results", "end"], ["Cost per result", "end"]]) {
      const th = el("th", `ads-decisions-th ads-decisions-${align}`, label);
      th.scope = "col";
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el("tbody");
    for (const ad of ads) {
      const tr = el("tr", "ads-decisions-tr");
      const nameCell = el("td", "ads-decisions-td");
      const name = el("button", "ads-decisions-name", rowName(ad));
      name.type = "button";
      name.title = "Open the supporting rows here";
      name.addEventListener("click", () => openRowDetail(ad, "ad"));
      nameCell.append(name, el("span", "ads-decisions-id", rowKey(ad)));
      tr.append(nameCell);
      const statusCell = el("td", "ads-decisions-td");
      statusCell.append(statusBadge(stateOf(ad)));
      tr.append(statusCell);
      const spend = num(ad.spend);
      const results = num(ad.results);
      tr.append(el("td", `ads-decisions-td ads-decisions-end ads-num${spend ? "" : " ads-decisions-missing"}`, spend === null ? "Not in this read" : formatMoney(spend, currency())));
      tr.append(el("td", `ads-decisions-td ads-decisions-end ads-num${results ? "" : " ads-decisions-missing"}`, results === null ? "Not in this read" : results === 0 ? "No observed outcome yet" : formatInt(results)));
      tr.append(el("td", "ads-decisions-td ads-decisions-end ads-num", results ? formatMoney(spend / results, currency()) : results === 0 ? "No observed outcome yet" : "—"));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  function adDrilldown(adId) {
    const ad = rowById(adId);
    if (!ad) return null;
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "This ad"));
    const facts = el("dl", "ads-defs");
    facts.append(definitionRow("Destination URL", String(ad.destination || "—")));
    if (ad.tracking && typeof ad.tracking === "object") {
      for (const [key, value] of Object.entries(ad.tracking)) facts.append(definitionRow(key, value ? String(value) : "Not set"));
    }
    section.append(facts);

    const creative = creativeById(ad.creativeId);
    if (!creative) {
      section.append(el("p", "ads-block-note", "The creative row for this ad is not in this read, so its version and prompt are not shown."));
      return section;
    }
    const rendition = renditionOf(creative);
    const version = el("dl", "ads-defs");
    version.append(
      definitionRow("Creative", `${rowName(creative)} (${rowKey(creative)})`),
      definitionRow("Version fingerprint", rendition ? `${rendition.digest} — ${rendition.format || "format not in this read"}${rendition.ratio ? ` · ${rendition.ratio}` : ""}` : "—"),
      definitionRow("Version identity", rendition?.versionId || "No stored version id in this read; the fingerprint is the version identity."),
      definitionRow("Prompt that produced it", String(creative.prompt?.text || "Not in this read")),
      definitionRow("Prompt model", String(creative.prompt?.model || "—")),
    );
    section.append(version);
    section.append(measurementFacts(creative));
    section.append(
      el(
        "p",
        "ads-block-note",
        "The version is content-addressed: the same asset at the same crop and format is the same version, so re-generating an asset mints a version while renaming or reclassifying does not.",
      ),
    );
    section.append(button("Inspect the creative", { onClick: () => openRecord({ kind: "creative", id: rowKey(creative), name: rowName(creative) }) }));
    return section;
  }

  function creativeDrilldown(creativeId) {
    const creative = creativeById(creativeId);
    if (!creative) return null;
    const section = el("div", "ads-block");
    const rendition = renditionOf(creative);
    section.append(el("h3", "ads-block-title", "This creative"));
    const facts = el("dl", "ads-defs");
    facts.append(
      definitionRow("Prompt that produced it", String(creative.prompt?.text || "Not in this read")),
      definitionRow("Version fingerprint", rendition ? `${rendition.digest} — ${rendition.format || "—"}${rendition.ratio ? ` · ${rendition.ratio}` : ""}` : "—"),
    );
    section.append(facts);
    section.append(measurementFacts(creative));

    const ads = adsForCreative(creativeId, rowsAtLevel("ad"));
    section.append(el("h3", "ads-block-title", "Ads running it"));
    section.append(ads.length ? adTable(ads) : el("p", "ads-block-note", "No ad row in this read carries this creative."));

    const adsets = adsetsForCreative(creativeId, rowsAtLevel("ad"), rowsAtLevel("adset"));
    if (adsets.length) {
      const list = el("dl", "ads-defs");
      for (const adset of adsets) list.append(definitionRow(rowName(adset), `${rowKey(adset)} · ${formatMoney(num(adset.budget), currency())} ${adset.budgetKind || ""}`.trim()));
      section.append(el("h3", "ads-block-title", "Ad sets behind those ads"));
      section.append(list);
    }
    return section;
  }

  function articleDrilldown(articleId) {
    const article = articleById(articleId);
    if (!article) return null;
    const totals = { ...(article.totals || {}) };
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "This article"));
    const facts = el("dl", "ads-defs");
    facts.append(
      factRow("Slug", String(article.slug || "—")),
      factRow("Published", article.publishedAt ? formatWhen(article.publishedAt) : "—"),
      factRow("Sessions", num(totals.siteSessions) === null ? "Not in this read" : formatInt(num(totals.siteSessions)), "site_observed"),
      factRow("Onward clicks", num(totals.onwardClicks) === null ? "Not in this read" : formatInt(num(totals.onwardClicks)), "site_observed"),
      factRow(
        "Site conversions",
        num(totals.siteConversions) === null ? "Not in this read" : num(totals.siteConversions) === 0 ? "No observed outcome yet" : formatInt(num(totals.siteConversions)),
        "site_observed",
      ),
      factRow(
        "Qualified leads",
        num(totals.qualifiedLeads) === null ? "Not in this read" : num(totals.qualifiedLeads) === 0 ? "No observed outcome yet" : formatInt(num(totals.qualifiedLeads)),
        "crm_observed",
      ),
      factRow("Ad spend", num(totals.spend) === null ? "Not in this read" : formatMoney(num(totals.spend), currency()), "provider_attributed"),
    );
    section.append(facts);

    section.append(el("h3", "ads-block-title", "Its traffic sources"));
    const bySource = article.bySource && typeof article.bySource === "object" ? article.bySource : null;
    if (!bySource) {
      section.append(el("p", "ads-block-note", "The article row carries no split by traffic source in this read."));
    } else {
      const list = el("dl", "ads-defs");
      for (const [key, value] of Object.entries(bySource)) {
        const sessions = num(value?.siteSessions);
        const onward = num(value?.onwardClicks);
        list.append(
          definitionRow(
            key === "paid" ? "Paid" : key === "organic" ? "Organic" : key,
            `${sessions === null ? "sessions not in this read" : `${formatInt(sessions)} sessions`} · ${onward === null ? "onward clicks not in this read" : `${formatInt(onward)} onward clicks`}`,
          ),
        );
      }
      section.append(list);
      section.append(el("p", "ads-block-note", "Sessions are counted from tracking parameters. They identify the traffic; they do not prove the article caused what followed."));
    }

    const creatives = Array.isArray(state.reads.creatives?.data?.rows) ? state.reads.creatives.data.rows : [];
    const promoting = adsForArticle(article, rowsAtLevel("ad"), creatives);
    section.append(el("h3", "ads-block-title", "Ads promoting it"));
    section.append(promoting.length ? adTable(promoting) : el("p", "ads-block-note", "No ad in this read carries a creative this article names."));
    return section;
  }

  // --------------------------------------------------------- lifecycle --

  const settled = load();
  return {
    node,
    /**
     * A record another screen asked this one to show.
     *
     * The Overview holds the rows every one of its items is drawn from, so a
     * request routed here is shown in the same drawer the lists use. Anything
     * this screen cannot place answers `false`, which the workspace turns into
     * an honest "that record is not in the rows on screen" rather than a link
     * that looks like it worked.
     */
    focusRecord(request) {
      const id = String(request?.id || "");
      const kind = String(request?.kind || "");
      if (!id) return false;
      const row = entityRow(kind, id);
      if (!row) return false;
      if (kind === "blog") {
        openOutcome(laneEntry(row, DESTINATION_LANE, "blog"), state.decisions?.outcomes?.destinations || laneFor("destinations"));
        return true;
      }
      openRowDetail(row, kind);
      return true;
    },
    dispose() {
      disposed = true;
      controller.abort();
      drawer.close({ restoreFocus: false });
    },
    settled: () => settled,
    reload: (options = {}) => load({ force: Boolean(options.force) }),
  };
}
