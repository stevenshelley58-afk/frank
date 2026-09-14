// Creative intelligence.
//
// This screen exists to answer four questions about the creative library, and
// nothing else:
//
//   1. Which value of a dimension — concept, hook, format, image style,
//      audience, funnel stage, blog topic — holds up when the creatives in it
//      are added together, and is there enough behind the row to rank it at all?
//   2. Are we testing genuinely different ideas, or the same idea made twice?
//   3. Is anything measurably losing performance across the loaded window?
//   4. What do the numbers actually say about qualified leads and destinations,
//      as opposed to which ad bought the cheapest click?
//
// Three decisions shape the whole file.
//
// First, the row carries its classification in `tags`, each tag with its own
// `source`. A tag read from the generation prompt describes *intent*; a tag read
// from the image or the copy describes the *finished asset*. They answer
// different questions, so the screen never merges them into one claim about
// "what this creative is": the drawer prints them as two labelled groups, the
// table headers say which side each column came from, and the prompt is shown as
// a prompt rather than as a description of the asset.
//
// Second, nothing here re-derives a metric. A row's performance lives under
// `totals`; `flatten()` lifts those base counters to the top level once, and
// every number after that comes from `METRICS`, `evidenceFor()` or
// `compareRates()` in ads-contracts.js. A "losing" flag is only raised when the
// two halves' Wilson intervals separate, so a quiet fortnight is never read as a
// decline.
//
// Third, a total over a group where one member's counter is missing is unknown,
// not smaller. `sumOrNull()` returns null rather than dropping the missing row
// from the sum, because a partial total quietly understates a concept and the
// reader has no way to see that it happened.
//
// Frank's own tags are an analysis aid on this screen only. They are not sent to
// the provider, and no provider score is derived from them.

import {
  el,
  clear,
  block,
  button,
  chip,
  segmented,
  statusBadge,
  evidenceBadge,
  sourceNote,
  statTile,
  sparkline,
  svg,
  ICONS,
  notConnectedPanel,
  emptyPanel,
  errorPanel,
  skeleton,
  staleBanner,
  definitionRow,
  createDrawer,
} from "./ads-ui.js";
import { createTable, column, createSelection, columnChooser, sortControl } from "./ads-table.js";
import { field, filterBar, applyFilters, bulkBar } from "./ads-views.js";
import {
  DEFAULT_COLUMNS,
  COLUMN_CATALOG,
  CREATIVE_DIMENSIONS,
  CREATIVE_DIMENSION_LABELS,
  CREATIVE_TAG_LABELS,
  TAG_SOURCE_LABELS,
  DELIVERY_STATE_LABELS,
  EVIDENCE_FLOOR,
  EVIDENCE_LABELS,
  METRICS,
  metricValue,
  evidenceFor,
  compareRates,
  num,
  divide,
  formatInt,
  formatPercent,
  formatMoney,
  formatDay,
  rowName,
  rowKey,
} from "./ads-contracts.js";
import { READER_REQUIREMENTS } from "./ads-source.js";

// A tag below this confidence wears the dashed marker. It matches the threshold
// the saved rows themselves use for `needsReview`, so the table's review flag
// and the tag's marker never disagree about the same tag.
const TAG_LOW_CONFIDENCE = 0.6;

// Ten days is the shortest window in which a half-to-half comparison has five
// observations on each side. Below that the screen says nothing rather than
// something noisy.
const MIN_TREND_DAYS = 10;

// The duplicate block is a sample of the pairs, not an inventory: the inline
// flag in the table is what makes the rest findable.
const DUPLICATE_PAIRS_SHOWN = 8;

// A creative is a duplicate candidate when its concept, hook and format all
// match another's. All three, because two ads with the same hook and different
// concepts are a test, not a repeat.
const DUPLICATE_SIGNATURE = Object.freeze(["concept", "hook", "format"]);

const BASE_COUNTERS = Object.freeze(["spend", "impressions", "reach", "linkClicks", "results", "qualifiedLeads", "landingViews"]);

const COLUMN_LABELS = Object.freeze({
  name: "Creative",
  format: "Format",
  concept: "Concept",
  hook: "Hook",
  visual_style: "Image style",
  spend: "Spend",
  impressions: "Impr.",
  ctr: "CTR",
  results: "Results",
  costPerResult: "Cost / result",
  qualifiedLeads: "Qualified",
  costPerQualifiedLead: "Cost / qualified",
  confidence: "Confidence",
  source: "Tag source",
  lineage: "Lineage",
  spendTrend: "Spend trend",
});

// Where each classification column was read from. On the header, so the
// intent / result split is visible without opening a drawer.
const COLUMN_TITLES = Object.freeze({
  format: "Read from the finished asset — the format that was actually made.",
  concept: "Read from the generation prompt — describes intent, not necessarily the result.",
  hook: "Read from the generation prompt — describes intent, not necessarily the result.",
  visual_style: "Read from the finished image — describes what was actually made.",
  confidence: "How sure the classifier is, 0–100%. Below the review threshold the row is flagged.",
  source: "Which sources classified this creative. A corrected tag was set by hand and overrides the machine tag.",
  lineage: "The creative this one was generated from, its generation, and the pack it came out of.",
});

const TAG_GROUPS = Object.freeze([
  Object.freeze({
    id: "intent",
    title: "From the generation prompt — describes intent",
    sources: Object.freeze(["prompt"]),
    note: "What was asked for. A prompt describes intent and not necessarily the result: the same prompt can produce a different asset, and this group never describes the image itself.",
  }),
  Object.freeze({
    id: "result",
    title: "From the finished asset — describes what was actually made",
    sources: Object.freeze(["image", "copy"]),
    note: "Read from the image or the copy that was produced. This is the only group that describes the asset rather than the request.",
  }),
  Object.freeze({
    id: "other",
    title: "Corrected by hand, or derived from lineage",
    sources: Object.freeze(["manual", "lineage"]),
    note: "An operator's correction overrides the machine tag and keeps the value it replaced. A lineage tag is inferred from the creative this one was generated from.",
  }),
]);

const text = (value) => (typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim());
const dash = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));

/** Sum a counter, keeping "we do not know" out of the total. A group with one
 *  unknown member has an unknown total, not a smaller one. */
function sumOrNull(values) {
  let total = 0;
  for (const value of values) {
    const n = num(value);
    if (n === null) return null;
    total += n;
  }
  return total;
}

/** Ascending by a picked number, with missing values always last: a blank is not
 *  a small one, and an operator scanning for the worst cost should not have to
 *  page past blanks to find it. */
function byNumber(pick, direction = "asc") {
  const dir = direction === "desc" ? -1 : 1;
  return (a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * dir;
  };
}

function emptyDuplicates() {
  return { pairs: [], flagged: new Set(), marked: new Set(), shared: new Set(), byKey: new Map() };
}

let blockSeq = 0;

export function createCreativeScreen(ctx, host) {
  const doc = ctx.doc || globalThis.document;

  // The root owns the drawer; `content` is what a render rebuilds. Keeping them
  // apart matters, because a render clears its own container and a drawer
  // appended into that container would be detached by the first re-render.
  const node = el("div", "ads-block");
  node.setAttribute("role", "region");
  node.setAttribute("aria-label", "Creative intelligence");
  const content = el("div", "ads-block");
  node.append(content);
  host.append(node);

  let disposed = false;
  const controller = new AbortController();
  const drawer = createDrawer({ host: node, title: "Creative" });
  const selection = createSelection({ getKey: rowKey });
  const view = ctx.store;

  const state = {
    loading: true,
    status: "loading",
    detail: "",
    fetchedAt: null,
    rows: null,
    search: "",
    restoreSearch: false,
    lastSelectedKey: "",
    dimension: CREATIVE_DIMENSIONS.includes(view.state.groupBy) ? view.state.groupBy : CREATIVE_DIMENSIONS[0],
  };

  // Derived per row and cached, because the trend test is not cheap and the same
  // row is asked about by the table, the losing block and the drawer.
  const views = new Map();
  const trends = new Map();
  let duplicates = emptyDuplicates();

  // `createTable` decides the next selection itself, so the only place to learn
  // which row moved is the toggle it calls. Recording the key lets the render
  // that follows put keyboard focus back on that row rather than on the page.
  const baseToggle = selection.toggle.bind(selection);
  selection.toggle = (key, options) => {
    state.lastSelectedKey = String(key || "");
    baseToggle(key, options);
  };

  // `options` is passed through, not dropped: the evidence floor is held in
  // minor units and must be formatted as such, or the note states a floor a
  // hundred times the real one.
  const money = (value, currency, options = {}) => formatMoney(value, currency, options);

  // ------------------------------------------------------- the reader's shape --

  /** Base counters lifted to the top level so `METRICS` can derive from a row
   *  without this screen restating any metric's arithmetic. */
  function flatten(row) {
    const totals = row?.totals && typeof row.totals === "object" ? row.totals : {};
    const base = {};
    for (const key of BASE_COUNTERS) if (key in totals) base[key] = totals[key];
    return { ...row, ...base };
  }

  function viewOf(row) {
    const key = rowKey(row);
    if (!views.has(key)) views.set(key, flatten(row));
    return views.get(key);
  }

  const metric = (id, row) => metricValue(id, viewOf(row));

  /** The row's raw delivery state. Never defaulted to a state the provider did
   *  not report — a missing state renders as a dash. */
  const rawState = (row) => text(row?.state) || text(row?.status);

  function classificationTag(row, fieldId) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    return tags.find((tag) => tag && tag.field === fieldId) || null;
  }

  /**
   * A dimension's value for a row: the tag first, because a corrected tag is the
   * operator's own classification and outranks the copy in the row, then the
   * row's own field. Empty means unclassified, and an unclassified row is
   * counted and reported rather than dropped silently.
   */
  function dimensionValue(row, dimension) {
    const tagged = text(classificationTag(row, dimension)?.value);
    if (tagged) return tagged;
    return text(row?.[dimension]);
  }

  const seriesOf = (row) => (Array.isArray(row?.series) ? row.series.filter((point) => point && typeof point.date === "string") : []);

  const currencyOf = () => ctx.context?.account?.currency || "GBP";

  /** Names are for reading; keys are for joining. A pair can name a creative the
   *  current filters exclude, and then the id is the honest label. */
  function nameOf(key) {
    const found = (state.rows || []).find((row) => rowKey(row) === key);
    return found ? rowName(found) : key;
  }

  function crmNote() {
    const note = sourceNote("crm_observed");
    // The in-cell variant is smaller than the standalone pill: this one repeats
    // down every table row.
    note?.classList.add("ads-source-inline");
    return note;
  }

  // -------------------------------------------------------------- evidence ---

  /** One row per value of the dimension, with the group's totals and the
   *  evidence verdict for the group as a whole. */
  function aggregateBy(rows, dimension) {
    const groups = new Map();
    for (const row of rows) {
      const value = dimensionValue(row, dimension);
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return Array.from(groups, ([value, members]) => {
      const group = {
        value,
        members,
        count: members.length,
        spend: sumOrNull(members.map((row) => metric("spend", row))),
        impressions: sumOrNull(members.map((row) => metric("impressions", row))),
        linkClicks: sumOrNull(members.map((row) => metric("linkClicks", row))),
        results: sumOrNull(members.map((row) => metric("results", row))),
        qualifiedLeads: sumOrNull(members.map((row) => metric("qualifiedLeads", row))),
      };
      group.costPerResult = divide(group.spend, group.results);
      group.ctr = divide(group.linkClicks, group.impressions);
      group.costPerClick = divide(group.spend, group.linkClicks);
      group.costPerQualifiedLead = divide(group.spend, group.qualifiedLeads);
      // The verdict is computed on the aggregated row, exactly as the contract
      // intends: a concept is judged on everything spent behind it.
      group.evidence = evidenceFor(group, { metric: "results" });
      return group;
    });
  }

  /** The one ranking this screen is allowed to state: groups that clear the
   *  evidence floor and have a computable cost per qualified lead. */
  function rankByQualifiedLead(groups) {
    return groups
      .filter((group) => group.evidence.level !== "insufficient" && group.costPerQualifiedLead !== null)
      .sort(byNumber((group) => group.costPerQualifiedLead));
  }

  // ---------------------------------------------------------------- trends ---

  function halfTotals(points) {
    let impressions = 0;
    let linkClicks = 0;
    let results = 0;
    let spend = 0;
    for (const point of points) {
      const i = num(point.impressions);
      const c = num(point.linkClicks);
      const r = num(point.results);
      const s = num(point.spend);
      if (i === null || c === null || r === null || s === null) return null;
      impressions += i;
      linkClicks += c;
      results += r;
      spend += s;
    }
    // `evidenceFor` and `compareRates` read the success counter as `clicks`
    // whenever the metric is clicks; the row shape calls that same number
    // linkClicks, so both names are carried on the half.
    return { days: points.length, impressions, linkClicks, clicks: linkClicks, results, spend };
  }

  /**
   * Recent half against the earlier half of the loaded window.
   *
   * Two rates are tested, because performance decays in two independent ways:
   * fewer clicks per impression, and fewer results per click. A flag needs the
   * intervals to separate on one of them. When the volume is too thin the answer
   * is "unknown", which the screen prints — a quiet row is not a declining one.
   */
  function trendFor(row) {
    const key = rowKey(row);
    if (trends.has(key)) return trends.get(key);

    const points = seriesOf(row);
    let result;
    if (points.length < MIN_TREND_DAYS) {
      result = {
        state: "unknown",
        reason: `Only ${formatInt(points.length)} day${points.length === 1 ? "" : "s"} of saved series in this window; a half-to-half comparison needs at least ${MIN_TREND_DAYS}.`,
      };
    } else {
      const size = Math.floor(points.length / 2);
      const earlier = halfTotals(points.slice(0, size));
      const recent = halfTotals(points.slice(points.length - size));
      if (!earlier || !recent) {
        result = { state: "unknown", reason: "The saved series has gaps, so its two halves are not comparable." };
      } else if (evidenceFor(earlier, { metric: "clicks" }).level === "insufficient" || evidenceFor(recent, { metric: "clicks" }).level === "insufficient") {
        result = {
          state: "unknown",
          reason: `One half of the window has fewer than ${formatInt(EVIDENCE_FLOOR.clicks)} clicks, which is too little to separate a decline from noise.`,
        };
      } else {
        const ctrVerdict = compareRates(earlier, recent, { metric: "clicks", denominator: "impressions" });
        const rateVerdict = compareRates(earlier, recent, { metric: "results", denominator: "linkClicks" });
        const ctr = { earlier: divide(earlier.linkClicks, earlier.impressions), recent: divide(recent.linkClicks, recent.impressions) };
        const rate = { earlier: divide(earlier.results, earlier.linkClicks), recent: divide(recent.results, recent.linkClicks) };
        const falling = ctrVerdict.verdict === "a" ? "ctr" : rateVerdict.verdict === "a" ? "results" : "";
        const rising = ctrVerdict.verdict === "b" ? "ctr" : rateVerdict.verdict === "b" ? "results" : "";
        const describe = (kind) =>
          kind === "ctr"
            ? `Click-through rate moved from ${formatPercent(ctr.earlier)} to ${formatPercent(ctr.recent)}`
            : `Results per click moved from ${formatPercent(rate.earlier)} to ${formatPercent(rate.recent)}`;
        if (falling) {
          result = { state: "declining", reason: `${describe(falling)}, and the two confidence intervals do not overlap.`, ctr, rate, earlier, recent };
        } else if (rising) {
          result = { state: "improving", reason: `${describe(rising)}, and the two confidence intervals do not overlap.`, ctr, rate, earlier, recent };
        } else {
          result = {
            state: "flat",
            reason: `The recent half is inside the noise of the earlier half (CTR ${formatPercent(ctr.earlier)} to ${formatPercent(ctr.recent)}).`,
            ctr,
            rate,
            earlier,
            recent,
          };
        }
        // The spend change is only meaningful when both halves are known, and it
        // is what the trend column sorts on.
        result.spendChange = earlier.spend > 0 ? (recent.spend - earlier.spend) / earlier.spend : null;
      }
    }
    trends.set(key, result);
    return result;
  }

  // ------------------------------------------------------------ duplicates ---

  /**
   * Two creatives are a possible near-duplicate when one is explicitly marked as
   * a near-duplicate of the other, or when they share a concept, hook and
   * format. Both signals describe the request rather than the finished asset: two
   * creatives can come out of the same prompt and still differ, which is why the
   * block says "possible".
   *
   * The index is built over the whole loaded window, not the filtered view,
   * because whether two creatives are near-duplicates is a fact about the
   * library. The filter and the block then both read the same answer.
   */
  function buildDuplicates(rows) {
    const pairs = new Map();
    const bySignature = new Map();
    const byKey = new Map();

    const note = (key, kind, other) => {
      if (!byKey.has(key)) byKey.set(key, { marked: [], shared: [] });
      byKey.get(key)[kind].push(other);
    };

    const addPair = (a, b, { kind, detail }) => {
      const pairKey = [a, b].sort().join("→");
      const existing = pairs.get(pairKey);
      if (existing) {
        // An explicit marker is the stronger statement, so it wins the label.
        if (kind === "marked" && existing.kind !== "marked") {
          existing.kind = kind;
          existing.detail = detail;
        }
        return;
      }
      pairs.set(pairKey, { a, b, kind, detail });
    };

    for (const row of rows) {
      const key = rowKey(row);
      const marked = text(row?.nearDuplicateOf);
      if (marked && marked !== key) {
        addPair(key, marked, { kind: "marked", detail: marked });
        note(key, "marked", marked);
        note(marked, "marked", key);
      }
      const parts = DUPLICATE_SIGNATURE.map((dimension) => dimensionValue(row, dimension));
      if (parts.every(Boolean)) {
        const signature = parts.join(" · ").toLowerCase();
        if (!bySignature.has(signature)) bySignature.set(signature, { parts, keys: [] });
        bySignature.get(signature).keys.push(key);
      }
    }

    for (const { parts, keys } of bySignature.values()) {
      if (keys.length < 2) continue;
      // Every member of a shared-signature cluster is flagged, not only the
      // first, and the pair list carries the signature so the reader can see
      // which three fields matched.
      keys.forEach((key) => {
        for (const other of keys) if (other !== key) note(key, "shared", other);
      });
      for (let i = 0; i < keys.length; i += 1) {
        for (let j = i + 1; j < keys.length; j += 1) {
          addPair(keys[i], keys[j], { kind: "shared", detail: parts.join(" · ") });
        }
      }
    }

    const result = emptyDuplicates();
    result.pairs = Array.from(pairs.values());
    result.byKey = byKey;
    for (const pair of result.pairs) {
      result.flagged.add(pair.a);
      result.flagged.add(pair.b);
    }
    for (const [key, entry] of byKey) {
      if (entry.marked.length) result.marked.add(key);
      if (entry.shared.length) result.shared.add(key);
    }
    return result;
  }

  function duplicateTitle(row) {
    const entry = duplicates.byKey.get(rowKey(row));
    if (!entry) return "";
    // The id is kept beside the name: a name is for reading, and the saved rows
    // join on the id.
    if (entry.marked.length) return `Marked as a near-duplicate of ${entry.marked.map((key) => (nameOf(key) === key ? key : `${nameOf(key)} (${key})`)).join(", ")}.`;
    return `Shares a concept, hook and format with ${formatInt(entry.shared.length)} other creative${entry.shared.length === 1 ? "" : "s"}.`;
  }

  // ---------------------------------------------------------------- fields ---

  function optionsFrom(pick, labelOf = (value) => value) {
    const counts = new Map();
    for (const row of state.rows || []) {
      const value = pick(row);
      if (value === null || value === undefined || value === "") continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({ value: String(value), label: `${labelOf(value)} (${formatInt(count)})` })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  /** Enum choices come from the rows actually loaded, so a filter menu can never
   *  offer a value this window does not contain. */
  function buildFields() {
    const dimensions = CREATIVE_DIMENSIONS.map((dimension) =>
      field({
        id: dimension,
        label: CREATIVE_DIMENSION_LABELS[dimension],
        kind: "enum",
        get: (row) => dimensionValue(row, dimension),
        options: () => optionsFrom((row) => dimensionValue(row, dimension)),
        hint: dimension === "visual_style" || dimension === "format" ? "From the finished asset" : "From the prompt",
        group: "Classification",
      }),
    );
    return [
      field({ id: "name", label: "Name", kind: "text", get: (row) => rowName(row), hint: "Name or internal id", group: "Creative" }),
      field({
        id: "state",
        label: "State",
        kind: "enum",
        get: (row) => rawState(row),
        options: () => optionsFrom((row) => rawState(row), (value) => DELIVERY_STATE_LABELS[value] || value),
        group: "Creative",
      }),
      ...dimensions,
      field({ id: "confidence", label: "Confidence", kind: "number", get: (row) => num(row?.confidence), group: "Classification" }),
      field({ id: "spend", label: "Spend", kind: "number", get: (row) => metric("spend", row), group: "Performance" }),
      field({ id: "results", label: "Results", kind: "number", get: (row) => metric("results", row), group: "Performance" }),
      field({ id: "ctr", label: "CTR", kind: "number", get: (row) => metric("ctr", row), group: "Performance" }),
      field({ id: "costPerResult", label: "Cost per result", kind: "number", get: (row) => metric("costPerResult", row), group: "Performance" }),
      field({ id: "qualifiedLeads", label: "Qualified leads", kind: "number", get: (row) => metric("qualifiedLeads", row), group: "Performance" }),
      field({
        id: "costPerQualifiedLead",
        label: "Cost per qualified lead",
        kind: "number",
        get: (row) => metric("costPerQualifiedLead", row),
        group: "Performance",
      }),
      field({ id: "corrected", label: "Corrected by hand", kind: "boolean", get: (row) => row?.corrected === true, group: "Flags" }),
      field({ id: "needsReview", label: "Needs review", kind: "boolean", get: (row) => row?.needsReview === true, group: "Flags" }),
      field({ id: "nearDuplicate", label: "Possible near-duplicate", kind: "boolean", get: (row) => duplicates.flagged.has(rowKey(row)), group: "Flags" }),
      field({ id: "losing", label: "Losing performance", kind: "boolean", get: (row) => trendFor(row).state === "declining", group: "Flags" }),
    ];
  }

  function applyView(rows, fields) {
    const needle = state.search.trim().toLowerCase();
    const searched = needle
      ? rows.filter((row) =>
          [rowName(row), rowKey(row), dimensionValue(row, "concept"), dimensionValue(row, "hook")].some((value) =>
            String(value || "").toLowerCase().includes(needle),
          ),
        )
      : rows;
    return applyFilters(searched, view.state.filters, fields);
  }

  // -------------------------------------------------------------- compare ---

  function compareSection(rows) {
    const control = segmented(
      CREATIVE_DIMENSIONS.map((dimension) => ({ id: dimension, label: CREATIVE_DIMENSION_LABELS[dimension] })),
      state.dimension,
      (id) => {
        if (!CREATIVE_DIMENSIONS.includes(id) || id === state.dimension) return;
        state.dimension = id;
        view.update({ groupBy: id, page: 0 });
        render();
        restoreSegmentFocus("dimension", id);
      },
      { label: "Compare creatives by", size: "sm" },
    );
    // `segmented` replaces its own buttons on every render, which would drop
    // keyboard focus to the page body after an arrow-key change. Tagging the
    // buttons lets the next render put focus back on the segment just chosen.
    control.dataset.segmentGroup = "dimension";
    control.querySelectorAll(".ads-segment").forEach((segment, index) => {
      segment.dataset.segment = CREATIVE_DIMENSIONS[index] || "";
    });

    const section = block("Compare creatives", { actions: [control] });
    const title = section.querySelector(".ads-block-title");
    const titleId = `ads-creative-compare-${(blockSeq += 1)}`;
    title.id = titleId;

    const label = CREATIVE_DIMENSION_LABELS[state.dimension] || state.dimension;
    const note = el("p", "ads-block-note");
    note.append(
      doc.createTextNode(
        `Grouped by ${label.toLowerCase()} over the ${formatInt(rows.length)} creative${rows.length === 1 ? "" : "s"} in view, ordered by cost per result with the lowest first. The badge on a row says whether its evidence can carry that order as a difference: a ranking floor is ${formatInt(EVIDENCE_FLOOR.results)} results and ${money(EVIDENCE_FLOOR.spendMinor, currencyOf(), { minor: true })} of spend. Cost per qualified lead joins a provider cost to an observed outcome `,
      ),
      crmNote(),
      doc.createTextNode("."),
    );
    section.querySelector(".ads-block-head").append(note);

    const groups = aggregateBy(rows, state.dimension);
    if (!groups.length) {
      section.append(
        emptyPanel({
          title: `No ${label.toLowerCase()} to compare`,
          detail: `No creative in view carries a ${label.toLowerCase()} tag, so there is nothing to group. The tags come from the saved creative rows; a window with no classified creatives has no comparison.`,
        }),
      );
      return section;
    }

    const ranked = groups
      .slice()
      .sort((a, b) => byNumber((group) => group.costPerResult)(a, b) || byNumber((group) => group.spend, "desc")(a, b));

    const wrap = el("div", "ads-table-wrap");
    const scroller = el("div", "ads-table-scroll");
    const table = el("table", "ads-table");
    table.setAttribute("aria-labelledby", titleId);
    table.append(el("caption", "ads-visually-hidden", `Creatives grouped by ${label}, ranked by cost per result`));

    // The shared table engine renders rows, not an aggregate: this table has no
    // paging and no selection, so it is the same classes on a plain table rather
    // than a pager under seven rows.
    const head = el("tr");
    const headings = [
      { label, align: "start" },
      { label: "Spend", align: "num" },
      { label: "Results", align: "num" },
      { label: "Cost per result", align: "num" },
      { label: "CTR", align: "num" },
      { label: "Qualified leads", align: "num" },
      { label: "Cost per qualified lead", align: "num" },
      { label: "Evidence", align: "start" },
    ];
    for (const heading of headings) {
      const th = el("th", `ads-th ads-th-${heading.align}`);
      th.scope = "col";
      th.append(el("span", "ads-th-label", heading.label));
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);

    const tbody = el("tbody");
    for (const group of ranked) {
      const tr = el("tr", "ads-tr");
      const valueCell = el("td", "ads-td");
      valueCell.append(el("span", "", group.value));
      // The count is printed beside every ratio on purpose: a cost per result
      // built on two results and one built on two hundred look identical.
      valueCell.append(el("span", "ads-cell-sub", ` · ${formatInt(group.count)} creative${group.count === 1 ? "" : "s"}`));
      tr.append(valueCell);
      tr.append(el("td", "ads-td ads-td-num", money(group.spend, currencyOf())));
      tr.append(el("td", "ads-td ads-td-num", formatInt(group.results)));
      tr.append(el("td", "ads-td ads-td-num", money(group.costPerResult, currencyOf())));
      tr.append(el("td", "ads-td ads-td-num", formatPercent(group.ctr)));
      const leads = el("td", "ads-td ads-td-num");
      leads.append(doc.createTextNode(formatInt(group.qualifiedLeads)), crmNote());
      tr.append(leads);
      const cost = el("td", "ads-td ads-td-num");
      cost.append(doc.createTextNode(money(group.costPerQualifiedLead, currencyOf())), crmNote());
      tr.append(cost);
      const evidence = el("td", "ads-td");
      evidence.append(evidenceBadge(group.evidence));
      tr.append(evidence);
      tbody.append(tr);
    }

    table.append(thead, tbody);
    scroller.append(table);
    wrap.append(scroller);
    section.append(wrap);

    const unclassified = rows.length - groups.reduce((total, group) => total + group.count, 0);
    if (unclassified > 0) {
      section.append(
        el(
          "p",
          "ads-block-note",
          `${formatInt(unclassified)} creative${unclassified === 1 ? " has" : "s have"} no ${label.toLowerCase()} tag and ${unclassified === 1 ? "is" : "are"} in no row above. They are counted here rather than folded into a value they do not belong to.`,
        ),
      );
    }
    return section;
  }

  // -------------------------------------------------------------- answers ---

  function answerRow(term, children) {
    const row = el("div", "ads-def-row");
    row.append(el("dt", "", term));
    const dd = el("dd");
    for (const child of [].concat(children)) if (child) dd.append(child);
    row.append(dd);
    return row;
  }

  function insufficientAnswer(nodes, reason) {
    nodes.append(
      evidenceBadge({ level: "insufficient", label: EVIDENCE_LABELS.insufficient, reason }),
      el("span", "", reason ? ` Not ranked: ${reason}` : " Nothing in view has enough of a measured outcome in this window to rank."),
    );
  }

  /** The fullest group is the honest one to quote a floor reason from: it is the
   *  row that came closest to being rankable. A group whose result count is
   *  unknown is not "fullest", so it sorts last like every other missing value. */
  function fullestGroup(groups) {
    return groups.slice().sort(byNumber((group) => group.results, "desc"))[0] || null;
  }

  function qualifiedAnswer(groups, emptyText, tail) {
    const nodes = el("span");
    if (!groups.length) {
      nodes.append(doc.createTextNode(emptyText));
      return nodes;
    }
    const ranked = rankByQualifiedLead(groups);
    if (!ranked.length) {
      const fullest = fullestGroup(groups);
      insufficientAnswer(nodes, fullest?.evidence?.reason);
      return nodes;
    }
    const shown = ranked.slice(0, 3);
    nodes.append(doc.createTextNode("Ranked by cost per qualified lead: "));
    shown.forEach((group, index) => {
      if (index) nodes.append(doc.createTextNode(index === shown.length - 1 ? " and " : ", "));
      nodes.append(
        el(
          "span",
          "",
          `“${group.value}” at ${money(group.costPerQualifiedLead, currencyOf())} (${formatInt(group.qualifiedLeads)} qualified lead${group.qualifiedLeads === 1 ? "" : "s"} from ${money(group.spend, currencyOf())} of spend)`,
        ),
      );
    });
    nodes.append(doc.createTextNode(ranked.length > shown.length ? `. ${formatInt(ranked.length - shown.length)} more pass the floor. ` : ". "));
    nodes.append(crmNote(), doc.createTextNode(tail || " Read the counts beside each ratio: a rate built on a handful of CRM records moves a lot."));
    return nodes;
  }

  function cheapClickAnswer(groups, bestLead) {
    const nodes = el("span");
    const withCost = groups
      .filter((group) => group.evidence.level !== "insufficient" && group.costPerClick !== null)
      .sort(byNumber((group) => group.costPerClick));
    if (!withCost.length) {
      insufficientAnswer(nodes, fullestGroup(groups)?.evidence?.reason);
      return nodes;
    }
    const cheapest = withCost[0];
    const clicks = ` across ${formatInt(cheapest.linkClicks)} link clicks.`;
    if (!bestLead) {
      nodes.append(
        doc.createTextNode(
          `The lowest cost per link click is “${cheapest.value}” at ${money(cheapest.costPerClick, currencyOf())}${clicks} Nothing in view has enough of a measured outcome to say whether those clicks turn into qualified leads.`,
        ),
      );
      return nodes;
    }
    if (bestLead.value === cheapest.value) {
      nodes.append(
        doc.createTextNode(
          `The lowest cost per link click is “${cheapest.value}” at ${money(cheapest.costPerClick, currencyOf())}${clicks} It is also the row that leads on cost per qualified lead, so here the cheap click and the qualified lead agree.`,
        ),
      );
      return nodes;
    }
    nodes.append(
      doc.createTextNode(
        `The lowest cost per link click is “${cheapest.value}” at ${money(cheapest.costPerClick, currencyOf())}${clicks} The row that produces qualified leads is “${bestLead.value}” at ${money(bestLead.costPerQualifiedLead, currencyOf())} per qualified lead — a different answer, because a cheap click is a Meta-attributed click and not qualified demand.`,
      ),
    );
    return nodes;
  }

  function answersSection(rows) {
    const section = block("What this says");
    const note = el("p", "ads-block-note");
    note.append(
      doc.createTextNode(
        `Computed from the ${formatInt(rows.length)} creative${rows.length === 1 ? "" : "s"} in view and nothing else, under the same evidence floor as the comparison above. Nothing here predicts what a creative will do next; it describes what the saved window already shows.`,
      ),
    );
    section.querySelector(".ads-block-head").append(note);

    const concepts = aggregateBy(rows, "concept");
    const topics = aggregateBy(rows, "blog_topic");
    const rankedConcepts = rankByQualifiedLead(concepts);

    const answers = el("dl", "ads-defs");
    answers.append(
      answerRow(
        "Concepts that produce qualified leads",
        qualifiedAnswer(concepts, "No creative in view carries a concept tag, so there is no concept comparison to make."),
      ),
      answerRow("Cheap clicks are a different question", cheapClickAnswer(concepts, rankedConcepts[0] || null)),
      answerRow(
        "Blog topics as paid destinations",
        qualifiedAnswer(
          topics,
          "No creative in view carries a blog topic, so there is no destination comparison to make.",
          " Spend here is the Meta-attributed spend on the creatives whose copy points at that topic.",
        ),
      ),
    );
    section.append(answers);
    return section;
  }

  // ----------------------------------------------------------- duplicates ---

  function duplicateSection(rows) {
    const section = block("Possibly near-duplicate", {
      note: "Two creatives count as a possible near-duplicate when one is explicitly marked as a near-duplicate of the other, or when they share a concept, hook and format. Both signals describe the request rather than the finished asset: two creatives can share a prompt and still differ, so this is a question to answer, not a verdict.",
    });

    const inView = new Set(rows.map(rowKey));
    const pairs = duplicates.pairs.filter((pair) => inView.has(pair.a) && inView.has(pair.b));
    const flagged = rows.filter((row) => duplicates.flagged.has(rowKey(row))).length;
    const shared = rows.filter((row) => duplicates.shared.has(rowKey(row))).length;
    const marked = rows.filter((row) => duplicates.marked.has(rowKey(row))).length;
    const concepts = new Set(rows.map((row) => dimensionValue(row, "concept")).filter(Boolean));

    const summary = el("p", "ads-block-note");
    // The two counts are built as clauses so a zero never reads as "0 share …":
    // the sentence only claims what is actually there.
    const clauses = [];
    if (shared) clauses.push(`${formatInt(shared)} share a concept, hook and format with another creative`);
    if (marked) clauses.push(`${formatInt(marked)} carry an explicit near-duplicate marker`);
    const listed = pairs.length ? "" : " Their counterpart is outside the current filters, so no pair is listed below.";
    summary.append(
      doc.createTextNode(
        `${formatInt(rows.length)} creative${rows.length === 1 ? "" : "s"} in view across ${formatInt(concepts.size)} distinct concept${concepts.size === 1 ? "" : "s"}. ` +
          (flagged
            ? `${formatInt(flagged)} ${flagged === 1 ? "is a possible near-duplicate" : "are possible near-duplicates"}: ${clauses.join(", and ")}.${listed}`
            : "None is a near-duplicate by either test: every creative here has its own concept, hook and format, and none carries a near-duplicate marker."),
      ),
    );
    section.append(summary);

    if (pairs.length) {
      const list = el("div", "ads-creative-list");
      for (const pair of pairs.slice(0, DUPLICATE_PAIRS_SHOWN)) {
        const item = el("div", "ads-creative-item");
        const body = el("div", "ads-creative-item-main");
        const names = [pair.a, pair.b].map((key) => nameOf(key));
        body.append(
          el(
            "div",
            "",
            pair.kind === "marked"
              ? `“${names[0]}” is marked as a near-duplicate of “${names[1]}”`
              : `“${names[0]}” and “${names[1]}” share a concept, hook and format`,
          ),
        );
        body.append(
          el(
            "div",
            "ads-block-note",
            pair.kind === "marked"
              ? "The saved rows carry an explicit near-duplicate marker for this creative."
              : `Concept, hook and format: ${pair.detail}.`,
          ),
        );
        item.append(body);
        list.append(item);
      }
      section.append(list);
      if (pairs.length > DUPLICATE_PAIRS_SHOWN) {
        section.append(
          el(
            "p",
            "ads-block-note",
            `${formatInt(pairs.length - DUPLICATE_PAIRS_SHOWN)} more pair${pairs.length - DUPLICATE_PAIRS_SHOWN === 1 ? "" : "s"} are not listed here. Every flagged creative is marked in the table below.`,
          ),
        );
      }
    }
    return section;
  }

  // --------------------------------------------------------------- losing ---

  function losingSection(rows) {
    const section = block("Losing performance", {
      note: "The recent half of the loaded window against the earlier half, tested on click-through rate and on results per click. A row is only flagged when the two confidence intervals separate, so a quiet fortnight is never read as a decline.",
    });

    const declining = rows.filter((row) => trendFor(row).state === "declining");
    const judged = rows.filter((row) => trendFor(row).state !== "unknown").length;

    const summary = el("p", "ads-block-note");
    const unjudged = rows.length - judged;
    summary.append(
      doc.createTextNode(
        `${formatInt(declining.length)} of ${formatInt(rows.length)} creative${rows.length === 1 ? "" : "s"} in view ${declining.length === 1 ? "is" : "are"} measurably worse in the recent half of the window. ` +
          (unjudged
            ? `${formatInt(unjudged)} could not be judged at all and ${unjudged === 1 ? "is" : "are"} not flagged: too few saved days, a series with gaps, or too few clicks in one half for the intervals to separate.`
            : "Every creative in view had enough saved days and clicks in both halves to be judged, so nothing here is unknown for want of volume."),
      ),
    );
    section.append(summary);

    if (declining.length) {
      const list = el("div", "ads-creative-list");
      for (const row of declining.slice().sort(byNumber((entry) => metric("spend", entry), "desc"))) {
        const trend = trendFor(row);
        const item = el("div", "ads-creative-item");
        const body = el("div", "ads-creative-item-main");
        body.append(el("div", "", rowName(row)));
        body.append(el("div", "ads-block-note", trend.reason));
        item.append(body);
        item.append(el("span", "ads-creative-item-value", money(metric("spend", row), currencyOf())));
        list.append(item);
      }
      section.append(list);
    }
    return section;
  }

  // ---------------------------------------------------------------- table ---

  function thumb(row) {
    const preview = row?.preview && typeof row.preview === "object" ? row.preview : {};
    const box = el("span", "ads-creative-thumb");
    box.append(svg(preview.hasImage || preview.hasVideo ? ICONS.image : ICONS.minus, { size: 14, width: 1.6 }));
    // The read carries the asset's metadata, not its pixels; saying what the box
    // stands for is more honest than drawing a picture that is not there.
    box.title = preview.hasVideo
      ? "Video creative. This read has the asset's metadata, not its pixels."
      : preview.hasImage
        ? "Image creative. This read has the asset's metadata, not its pixels."
        : "This read carries no preview information for this creative.";
    return box;
  }

  function nameCell(row) {
    const wrap = el("div", "ads-cell-with-thumb");
    wrap.append(thumb(row));
    const body = el("div", "ads-cell-name");
    body.append(el("strong", "", rowName(row)));
    const sub = [rowKey(row), dimensionValue(row, "format"), text(row?.preview?.ratio)].filter(Boolean).join(" · ");
    body.append(el("span", "ads-cell-sub", sub || "—"));

    const flags = el("span", "ads-cell-flags");
    const duplicate = duplicateTitle(row);
    if (duplicate) {
      const flag = el("span", "ads-tag", "Near-duplicate");
      flag.title = duplicate;
      flags.append(flag);
    }
    const trend = trendFor(row);
    if (trend.state === "declining") {
      const flag = el("span", "ads-tag", "Losing");
      flag.title = trend.reason;
      flags.append(flag);
    }
    if (row?.needsReview) {
      const flag = el("span", "ads-tag", "Review");
      flag.title = row?.corrected
        ? "A tag on this creative was corrected by hand, so the classification is worth a second look."
        : `Classifier confidence is below ${formatPercent(TAG_LOW_CONFIDENCE, 0)}.`;
      flags.append(flag);
    }
    if (flags.childElementCount) body.append(flags);
    wrap.append(body);
    return wrap;
  }

  function metricCell(value, extra = null) {
    const cell = el("span", "ads-metric-cell");
    cell.append(el("span", "", value));
    if (extra) cell.append(extra);
    return cell;
  }

  function tagSources(row) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    const sources = [];
    for (const tag of tags) {
      const source = text(tag?.source);
      if (source && !sources.includes(source)) sources.push(source);
    }
    return sources;
  }

  function sourceCell(row) {
    const sources = tagSources(row);
    if (!sources.length) return "—";
    return sources.map((source) => TAG_SOURCE_LABELS[source] || source).join(" · ");
  }

  function lineageCell(row) {
    const lineage = row?.lineage && typeof row.lineage === "object" ? row.lineage : {};
    const parts = [];
    const parentId = text(lineage.parentId);
    if (parentId) parts.push(nameOf(parentId));
    const generation = num(lineage.generation);
    if (generation !== null && generation > 0) parts.push(`generation ${formatInt(generation)}`);
    const packId = text(lineage.packId);
    if (packId) parts.push(packId);
    return parts.length ? parts.join(" · ") : "—";
  }

  /** A text column whose value comes from the row's own classification. */
  function dimensionColumn(id) {
    return column({
      id,
      label: COLUMN_LABELS[id],
      title: COLUMN_TITLES[id] || "",
      render: (row) => dash(dimensionValue(row, id)),
      sortValue: (row) => dimensionValue(row, id).toLowerCase() || null,
    });
  }

  function metricColumn(id, render) {
    return column({
      id,
      label: COLUMN_LABELS[id],
      align: "num",
      metric: id,
      sortValue: (row) => metric(id, row),
      render,
    });
  }

  function activeColumnIds() {
    const saved = Array.isArray(view.state.columns) ? view.state.columns.filter((id) => COLUMN_CATALOG.creative.includes(id)) : [];
    const ids = saved.length ? saved.slice() : DEFAULT_COLUMNS.creative.slice();
    // A table whose first column is not the name is a list of numbers with no
    // referent, so `name` is always present and always first.
    if (!ids.includes("name")) ids.unshift("name");
    return ids;
  }

  function buildColumns() {
    const columns = {
      name: column({ id: "name", label: COLUMN_LABELS.name, width: 280, sortValue: (row) => rowName(row).toLowerCase(), render: nameCell }),
      format: dimensionColumn("format"),
      concept: dimensionColumn("concept"),
      hook: dimensionColumn("hook"),
      visual_style: dimensionColumn("visual_style"),
      spend: metricColumn("spend", (row) => money(metric("spend", row), currencyOf())),
      impressions: metricColumn("impressions", (row) => formatInt(metric("impressions", row))),
      ctr: metricColumn("ctr", (row) => formatPercent(metric("ctr", row))),
      results: metricColumn("results", (row) => formatInt(metric("results", row))),
      costPerResult: metricColumn("costPerResult", (row) => money(metric("costPerResult", row), currencyOf())),
      qualifiedLeads: metricColumn("qualifiedLeads", (row) => metricCell(formatInt(metric("qualifiedLeads", row)), crmNote())),
      costPerQualifiedLead: metricColumn("costPerQualifiedLead", (row) =>
        metricCell(money(metric("costPerQualifiedLead", row), currencyOf()), crmNote()),
      ),
      confidence: column({
        id: "confidence",
        label: COLUMN_LABELS.confidence,
        align: "num",
        title: COLUMN_TITLES.confidence,
        sortValue: (row) => num(row?.confidence),
        render: (row) => {
          const confidence = num(row?.confidence);
          if (confidence === null) return "—";
          const cell = el("span", "ads-metric-cell");
          cell.append(el("span", "", formatPercent(confidence, 0)));
          if (row?.needsReview) {
            const flag = el("span", "ads-tag", "low");
            flag.dataset.confidence = "low";
            flag.title = "Below the review threshold, or a tag was corrected by hand.";
            cell.append(flag);
          }
          return cell;
        },
      }),
      source: column({
        id: "source",
        label: COLUMN_LABELS.source,
        title: COLUMN_TITLES.source,
        sortValue: (row) => {
          const sources = tagSources(row);
          return sources.length ? sources.join(" · ").toLowerCase() : null;
        },
        render: sourceCell,
      }),
      lineage: column({
        id: "lineage",
        label: COLUMN_LABELS.lineage,
        title: COLUMN_TITLES.lineage,
        sortValue: (row) => {
          const generation = num(row?.lineage?.generation);
          const parent = text(row?.lineage?.parentId);
          // Sorting on a string keeps parents together; a row with neither a
          // parent nor a generation sorts as missing.
          return generation === null && !parent ? null : `${parent} ${generation ?? 0}`;
        },
        render: lineageCell,
      }),
      spendTrend: column({
        id: "spendTrend",
        label: COLUMN_LABELS.spendTrend,
        sortValue: (row) => num(trendFor(row).spendChange),
        render: (row) => {
          const trend = trendFor(row);
          return sparkline(
            seriesOf(row).map((point) => num(point.spend)),
            {
              title: trend.state === "unknown" ? trend.reason : `Day-by-day spend. ${trend.reason}`,
              positive: trend.state === "declining" ? false : trend.state === "improving" ? true : null,
            },
          );
        },
      }),
    };
    return activeColumnIds()
      .map((id) => columns[id])
      .filter(Boolean);
  }

  function toggleFlagFilter(id) {
    const filters = view.state.filters;
    const existing = filters.find((filter) => filter.field === id);
    const next = existing ? filters.filter((filter) => filter !== existing) : [...filters, { field: id, op: "is_true", value: true }];
    view.update({ filters: next, page: 0 });
    render();
  }

  function tableSection(rows, fields) {
    const section = block("Creatives", {
      note: "Concept, hook, audience and offer are read from the generation prompt; format, image style, subject and composition from the finished asset; CTA and blog topic from the copy. These are Frank's own analysis tags: they are not sent to the provider and no provider score is derived from them.",
    });
    const title = section.querySelector(".ads-block-title");
    const titleId = `ads-creative-table-${(blockSeq += 1)}`;
    title.id = titleId;

    const columns = buildColumns();
    const chooser = columnChooser({
      all: COLUMN_CATALOG.creative,
      active: activeColumnIds(),
      onChange: (next) => {
        // `columnChooser` captures its active list when it is built, so the
        // control is rebuilt by the render that follows this update.
        view.update({ columns: next });
        render();
        restoreControlFocus("columns");
      },
    });
    chooser.dataset.control = "columns";
    const sorter = sortControl(
      columns.map((entry) => ({ id: entry.id, label: entry.label })),
      view.state.sort,
      (sort) => {
        view.update({ sort });
        render();
        restoreControlFocus("sort");
      },
    );
    sorter.dataset.control = "sort";

    section.append(
      filterBar({
        fields,
        filters: view.state.filters,
        onChange: (filters) => {
          view.update({ filters, page: 0 });
          render();
        },
        search: state.search,
        onSearch: (value) => {
          state.search = value;
          state.restoreSearch = true;
          view.update({ page: 0 }, { persist: false });
          render();
        },
        savedViews: view.saved(),
        onSaveView: (name) => {
          view.save(name);
          render();
          ctx.say(`Saved the view “${name}”.`);
        },
        onApplyView: (saved) => {
          view.apply(saved);
          render();
          ctx.say(`Applied the view “${saved.name}”.`);
        },
        onRemoveView: (saved) => {
          view.remove(saved.id);
          render();
        },
        resultCount: rows.length,
        totalCount: (state.rows || []).length,
        extra: [
          chip("Near-duplicate", {
            active: view.state.filters.some((filter) => filter.field === "nearDuplicate"),
            title: "Creatives that share a concept, hook and format with another, or that carry a near-duplicate marker.",
            onClick: () => toggleFlagFilter("nearDuplicate"),
          }),
          chip("Losing", {
            active: view.state.filters.some((filter) => filter.field === "losing"),
            title: "Creatives whose recent half is measurably worse than the earlier half, on the evidence of the intervals.",
            onClick: () => toggleFlagFilter("losing"),
          }),
          chip("Needs review", {
            active: view.state.filters.some((filter) => filter.field === "needsReview"),
            title: `Confidence below ${formatPercent(TAG_LOW_CONFIDENCE, 0)}, or a tag corrected by hand.`,
            onClick: () => toggleFlagFilter("needsReview"),
          }),
          chooser,
          sorter,
        ],
      }),
    );

    const table = createTable({
      columns,
      rows,
      getKey: rowKey,
      state: view.state,
      labelledBy: titleId,
      selection,
      onSelectionChange: () => {
        render();
        restoreRowFocus();
      },
      onSort: (sort) => view.update({ sort }),
      onRowActivate: (row) => openDetail(row),
      rowTone: (row) => (duplicates.flagged.has(rowKey(row)) || trendFor(row).state === "declining" ? "warn" : null),
      emptyNode: el(
        "p",
        "ads-empty-line",
        (state.rows || []).length
          ? "No creative matches the current filters. Clearing a filter brings the rest of the window back."
          : "No creative rows in this window.",
      ),
      footerExtra: () =>
        el(
          "span",
          "ads-block-note",
          "Qualified leads and cost per qualified lead are CRM-observed. Every other number in this table is Meta-attributed. The two are never summed.",
        ),
    });
    section.append(table.node);

    if (selection.size()) {
      section.append(
        bulkBar({
          count: selection.size(),
          noun: "creative",
          note: "Space selects a row, Enter opens it. Selecting never writes anything.",
          onClear: () => {
            selection.clear();
            render();
          },
          actions: [
            button("Add to a launch", {
              variant: "ink",
              icon: ICONS.upload,
              title: "Opens the bulk publish flow with these creatives preselected. Nothing is submitted until the last step of that flow.",
              onClick: () => {
                const keys = selection.keys();
                ctx.openPublish({ creativeIds: keys });
                ctx.say(`${formatInt(keys.length)} creative${keys.length === 1 ? "" : "s"} carried into the launch flow. Nothing has been submitted.`);
              },
            }),
          ],
        }),
      );
    }
    return section;
  }

  // --------------------------------------------------------------- drawer ---

  function defRow(term, value) {
    if (typeof value === "string") return definitionRow(term, value);
    const row = el("div", "ads-def-row");
    row.append(el("dt", "", term));
    const dd = el("dd");
    dd.append(value);
    row.append(dd);
    return row;
  }

  function compareCell(label, value) {
    const cell = el("div", "ads-compare-cell");
    cell.append(el("span", "ads-compare-label", label));
    const body = el("div", "ads-compare-value");
    body.append(el("span", "", dash(value)));
    cell.append(body);
    return cell;
  }

  function tagChip(tag) {
    const node_ = el("span", "ads-tag");
    const confidence = num(tag?.confidence);
    const corrected = tag?.corrected === true || Boolean(text(tag?.originalValue));
    if (confidence !== null && confidence < TAG_LOW_CONFIDENCE) node_.dataset.confidence = "low";
    if (corrected) node_.dataset.corrected = "true";
    node_.append(el("span", "", CREATIVE_TAG_LABELS[tag?.field] || text(tag?.field) || "Field"));
    node_.append(el("span", "", dash(text(tag?.value))));
    node_.append(el("span", "ads-tag-source", TAG_SOURCE_LABELS[tag?.source] || text(tag?.source) || "Unknown source"));
    if (confidence !== null) node_.append(el("span", "ads-tag-source", `${formatPercent(confidence, 0)} confidence`));
    // Confidence is never colour alone: the word is printed beside the dashed
    // border that carries the same meaning.
    if (confidence !== null && confidence < TAG_LOW_CONFIDENCE) node_.append(el("span", "ads-tag-source", "low"));
    if (corrected) {
      // The replaced value is the point of the marker: it is what the classifier
      // said before a human disagreed with it.
      node_.append(
        el("span", "ads-tag-corrected", text(tag?.originalValue) ? `corrected by hand, was “${text(tag.originalValue)}”` : "corrected by hand"),
      );
    }
    return node_;
  }

  function detailBody(row) {
    const currency = currencyOf();
    const fragment = doc.createDocumentFragment();

    const identity = el("dl", "ads-defs");
    identity.append(
      definitionRow("Internal id", rowKey(row) || "—"),
      defRow("State", rawState(row) ? statusBadge(rawState(row)) : "—"),
      definitionRow(
        "Preview",
        [text(row?.preview?.ratio), row?.preview?.hasVideo ? "video" : row?.preview?.hasImage ? "image" : ""].filter(Boolean).join(" · ") || "—",
      ),
      definitionRow("Tag confidence", num(row?.confidence) === null ? "—" : formatPercent(num(row.confidence), 0)),
    );
    fragment.append(identity);

    const classification = el("div", "ads-compare-grid");
    // The comparison axes plus the two fields a buyer reads first: the offer and
    // the call to action. Everything else the classifier produced is in the tag
    // groups below, where its source and confidence sit beside it.
    for (const dimension of [...CREATIVE_DIMENSIONS, "offer", "cta"]) {
      const cell = compareCell(CREATIVE_TAG_LABELS[dimension] || dimension, dimensionValue(row, dimension));
      const tag = classificationTag(row, dimension);
      if (tag) {
        cell.title = `${TAG_SOURCE_LABELS[tag.source] || tag.source}${num(tag.confidence) === null ? "" : `, ${formatPercent(num(tag.confidence), 0)} confidence`}${tag.corrected ? ", corrected by hand" : ""}.`;
      }
      classification.append(cell);
    }
    fragment.append(classification);

    const prompt = block("Generation prompt", {
      note: "What was asked for. It describes intent, not necessarily what the asset shows.",
    });
    const promptText = text(row?.prompt?.text);
    prompt.append(el("p", "ads-prompt", promptText || "—"));
    prompt.append(
      el(
        "p",
        "ads-block-note",
        promptText
          ? [`Model ${dash(text(row?.prompt?.model))}`, `Version ${dash(text(row?.prompt?.version))}`, `Captured ${text(row?.prompt?.capturedAt) ? formatDay(text(row.prompt.capturedAt)) : "—"}`].join(" · ")
          : "No prompt was saved with this creative, so there is nothing to show here.",
      ),
    );
    fragment.append(prompt);

    const lineageRow = row?.lineage && typeof row.lineage === "object" ? row.lineage : {};
    const generation = num(lineageRow.generation);
    const lineageList = el("dl", "ads-defs");
    lineageList.append(
      definitionRow("Parent creative", text(lineageRow.parentId) ? nameOf(text(lineageRow.parentId)) : "—"),
      definitionRow("Generation", generation !== null && generation > 0 ? formatInt(generation) : "—"),
      definitionRow("Generation pack", text(lineageRow.packId) || "—"),
    );
    const lineageBlock = block("Lineage", { note: "What this creative was generated from. A root creative has no parent and no generation." });
    lineageBlock.append(lineageList);
    fragment.append(lineageBlock);

    const numbers = block("Performance in this window", {
      note: "Meta-attributed counters and CRM-observed outcomes stay apart here as everywhere else. Cost per qualified lead joins a provider cost to an observed outcome, so its two halves come from different systems and will not reconcile exactly.",
    });
    const stats = el("div", "ads-stats");
    stats.append(
      statTile({
        label: METRICS.spend.label,
        value: money(metric("spend", row), currency),
        definition: METRICS.spend.definition,
        measurement: "provider_attributed",
        series: seriesOf(row).map((point) => num(point.spend)),
      }),
      statTile({
        label: METRICS.results.label,
        value: formatInt(metric("results", row)),
        definition: METRICS.results.definition,
        measurement: "provider_attributed",
      }),
      statTile({
        label: METRICS.costPerResult.label,
        value: money(metric("costPerResult", row), currency),
        definition: METRICS.costPerResult.definition,
        measurement: "provider_attributed",
      }),
      statTile({
        label: METRICS.ctr.label,
        value: formatPercent(metric("ctr", row)),
        definition: METRICS.ctr.definition,
        measurement: "provider_attributed",
      }),
      statTile({
        label: METRICS.qualifiedLeads.label,
        value: formatInt(metric("qualifiedLeads", row)),
        definition: METRICS.qualifiedLeads.definition,
        measurement: "crm_observed",
      }),
      statTile({
        label: METRICS.costPerQualifiedLead.label,
        value: money(metric("costPerQualifiedLead", row), currency),
        definition: METRICS.costPerQualifiedLead.definition,
        measurement: "crm_observed",
      }),
    );
    numbers.append(stats);
    fragment.append(numbers);

    const tags = Array.isArray(row?.tags) ? row.tags : [];
    const tagBlock = block("Classification tags", {
      note: "Frank's own analysis tags, read on this screen only. They are not sent to the provider and no provider score is derived from them.",
    });
    for (const group of TAG_GROUPS) {
      const members = tags.filter((tag) => group.sources.includes(text(tag?.source)));
      const groupBlock = block(group.title, {
        note: `${group.note} ${members.length ? `${formatInt(members.length)} tag${members.length === 1 ? "" : "s"} on this creative.` : "No tags from this source on this creative."}`,
      });
      if (members.length) {
        const chips = el("div", "ads-state-strip");
        for (const tag of members) chips.append(tagChip(tag));
        groupBlock.append(chips);
      }
      tagBlock.append(groupBlock);
    }
    fragment.append(tagBlock);

    const trend = trendFor(row);
    const duplicate = duplicateTitle(row);
    const flags = el("dl", "ads-defs");
    flags.append(
      definitionRow("Near-duplicate", duplicate || "No near-duplicate marker, and no other creative in view shares this concept, hook and format."),
      definitionRow("Performance trend", trend.state === "unknown" ? `${trend.reason} It is not flagged either way.` : trend.reason),
    );
    const flagBlock = block("Flags");
    flagBlock.append(flags);
    fragment.append(flagBlock);

    return fragment;
  }

  function openDetail(row) {
    drawer.setTitle(rowName(row));
    drawer.show((body) => body.append(detailBody(row)));
    ctx.say(`Opened ${rowName(row)}.`);
  }

  // ---------------------------------------------------------------- focus ---

  function restoreRowFocus() {
    const active = doc.activeElement;
    // Only when the render actually dropped focus to the page. Stealing it back
    // from a control the operator is still using would be worse.
    if (active && active !== doc.body) return;
    const key = state.lastSelectedKey;
    if (!key) return;
    const safe = String(key).replace(/["\\]/g, "\\$&");
    content.querySelector(`.ads-tr[data-key="${safe}"]`)?.focus();
  }

  function restoreSearchFocus() {
    if (!state.restoreSearch) return;
    state.restoreSearch = false;
    const input = content.querySelector(".ads-search-input");
    if (!input) return;
    // The bar is rebuilt by render(), so the input the operator was typing into
    // has just been replaced. Without this the caret lands on the page body
    // 120ms after the first keystroke.
    input.focus({ preventScroll: true });
    // Guarded because the selection API is not on every input type, and a
    // restore that throws would be worse than a caret in the wrong place.
    if (typeof input.setSelectionRange === "function") input.setSelectionRange(input.value.length, input.value.length);
  }

  function restoreSegmentFocus(groupName, id) {
    // Queued as a microtask because `segmented` focuses its own (now detached)
    // button after it calls onSelect; without the queue that call undoes the
    // restore.
    queueMicrotask(() => content.querySelector(`[data-segment-group="${groupName}"] [data-segment="${id}"]`)?.focus());
  }

  function restoreControlFocus(control) {
    queueMicrotask(() => content.querySelector(`[data-control="${control}"] .ads-btn`)?.focus({ preventScroll: true }));
  }

  // --------------------------------------------------------------- render ---

  function render() {
    clear(content);
    if (state.loading) {
      content.append(skeleton(8, 6));
      return;
    }
    if (state.status === "not_connected") {
      content.append(
        notConnectedPanel({
          title: "Not connected",
          requirement: READER_REQUIREMENTS.creatives,
          action: button("Refresh", { onClick: () => ctx.refresh() }),
        }),
      );
      return;
    }
    if (state.status === "error") {
      content.append(
        errorPanel({
          title: "The creative rows did not load",
          detail: state.detail,
          onRetry: () => void load({ force: true }),
        }),
      );
      return;
    }
    if (state.rows === null) {
      content.append(
        errorPanel({
          title: "That read answered without rows",
          detail: "The creatives reader answered but carried no row list, so there is nothing truthful to draw. Retrying re-reads the saved window.",
          onRetry: () => void load({ force: true }),
        }),
      );
      return;
    }
    if (!state.rows.length) {
      content.append(
        emptyPanel({
          title: "No creatives in this window",
          detail: "The reader returned no creative rows for the selected dates. That is an empty window, not a missing connection, and it is shown as empty rather than as a zero.",
          action: button("Refresh", { onClick: () => ctx.refresh() }),
        }),
      );
      return;
    }

    // Cached rows stay visible through a throttled or stale sync, with their
    // age stated. Any other status that still carried rows is not a state this
    // banner can describe honestly, so it is not shown.
    if (state.status === "stale" || state.status === "throttled" || state.status === "syncing") {
      content.append(
        staleBanner({
          status: state.status,
          fetchedAt: state.fetchedAt,
          detail: state.detail,
          onRefresh: () => ctx.refresh(),
        }),
      );
    }

    const fields = buildFields();
    const rows = applyView(state.rows, fields);

    content.append(compareSection(rows));
    content.append(answersSection(rows));

    const flags = el("div", "ads-cols-2");
    flags.append(duplicateSection(rows), losingSection(rows));
    content.append(flags);

    content.append(tableSection(rows, fields));
    restoreSearchFocus();
  }

  // -------------------------------------------------------------- reading ---

  async function load({ force = false } = {}) {
    state.loading = true;
    render();
    const result = await ctx.reader.read("creatives", ctx.params, { signal: controller.signal, force });
    if (disposed) return;

    state.loading = false;
    state.status = result.status;
    state.detail = result.detail || "";
    state.fetchedAt = result.fetchedAt || null;
    // A missing row list and an empty row list are different facts, and the
    // render keeps them apart.
    state.rows = Array.isArray(result.data?.rows) ? result.data.rows : null;
    views.clear();
    trends.clear();
    // The duplicate index is a fact about the library, so it is built once per
    // read over every loaded row and not over the filtered view.
    duplicates = buildDuplicates(state.rows || []);
    selection.retain((state.rows || []).map(rowKey));
    render();
    if (state.status === "ready" && state.rows) {
      ctx.say(`${formatInt(state.rows.length)} creative${state.rows.length === 1 ? "" : "s"} loaded.`);
    }
  }

  const settled = load();

  return {
    node,
    dispose() {
      disposed = true;
      controller.abort();
      // The drawer's scrim lives inside `node`, so it goes with the screen;
      // closing first keeps focus from being restored into a detached node.
      drawer.close({ restoreFocus: false });
    },
    settled: () => settled,
  };
}
