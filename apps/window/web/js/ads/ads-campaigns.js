// Ads campaigns: one management table, three levels.
//
// Campaigns, ad sets and ads are the same shape at different altitudes, so they
// share one table rather than three near-identical screens. The level switch
// swaps the row source and the default columns; everything else — sorting,
// filtering, saved views, selection, comparison, bulk review — is identical.
//
// Two behaviours here exist specifically to stop an operator doing damage:
//
// 1. Comparison refuses a verdict when the confidence intervals overlap, and
//    says "insufficient evidence" instead of crowning a winner.
// 2. A bulk change cannot be applied without a before/after review that lists
//    every affected row. Bulk edits that silently touch filtered-out rows are
//    how budgets get moved by accident, so hidden rows are dropped from the
//    selection and the operator is told.

import {
  el,
  clear,
  block,
  button,
  chip,
  segmented,
  svg,
  ICONS,
  statusBadge,
  evidenceBadge,
  sourceNote,
  sparkline,
  notConnectedPanel,
  emptyPanel,
  errorPanel,
  skeleton,
  definitionRow,
  createDrawer,
  staleBanner,
  rowsReadNote,
} from "./ads-ui.js";
import { createTable, column, createSelection, columnChooser, sortControl } from "./ads-table.js";
import {
  applyFilters,
  field,
  filterBar,
  bulkBar,
  hiddenSelectionNotice,
  accountCurrency,
  formatAccountMoney,
  formatAccountMoneyDelta,
  summariseChangeEntries,
  appliedViewSentence,
  CURRENCY_UNKNOWN_NOTE,
} from "./ads-views.js";
import { isUnresolved } from "./ads-source.js";
import {
  ENTITY_LEVELS,
  ENTITY_LEVEL_LABELS,
  DEFAULT_COLUMNS,
  COLUMN_CATALOG,
  METRICS,
  metricValue,
  evidenceFor,
  compareRates,
  formatInt,
  formatPercent,
  formatRatio,
  formatDay,
  formatWhen,
  num,
  rowName,
  rowKey,
  stateOf,
  DELIVERY_STATE_LABELS,
  DELIVERY_PROOF_STATES,
} from "./ads-contracts.js";

/**
 * The parent a row sits under, as an identity.
 *
 * The reader names the parent field differently depending on how it was built,
 * so all the spellings are accepted — but only ever a value that is an id. A
 * parent *name* is not a parent: two campaigns may share one, and a filter on
 * the name would show rows from both.
 */
export function parentIdentity(row) {
  if (!row) return { id: "", name: "" };
  const id = row.level === "ad" ? row.adsetId ?? row.parentId : row.campaignId ?? row.parentId;
  const name = row.level === "ad" ? row.adsetName ?? row.parentName : row.campaignName ?? row.parentName;
  return { id: id === null || id === undefined ? "" : String(id), name: name ? String(name) : "" };
}

/** The parent field a level filters on, and what that filter is called. */
export const PARENT_FIELD = Object.freeze({
  adset: Object.freeze({ id: "campaignId", label: "In campaign", noun: "campaign" }),
  ad: Object.freeze({ id: "adsetId", label: "In ad set", noun: "ad set" }),
});

/**
 * The filter a drill-down applies: one parent, by id.
 *
 * Stated as a function because it is the whole contract of the drill-down — the
 * child rows are selected by the parent's identity and by nothing else.
 */
export function parentFilterFor(level, id) {
  const fieldDef = PARENT_FIELD[level];
  if (!fieldDef || !id) return null;
  return Object.freeze({ field: fieldDef.id, op: "is", value: String(id) });
}

export function createCampaignsScreen(ctx, host) {
  const node = el("div", "ads-campaigns");
  host.append(node);
  let disposed = false;
  const controller = new AbortController();

  const state = {
    level: ctx.store.state.level || "campaign",
    rows: [],
    filtered: [],
    search: "",
    loading: true,
    status: "loading",
    readStatus: "",
    detail: "",
    fetchedAt: null,
    compareKeys: [],
  };

  const selection = createSelection({ getKey: rowKey });
  // The URL-applied view is announced once per mount, not on every render.
  let announcedUrlView = false;
  // The drawer is hosted beside the screen node, not inside it: every render
  // clears the screen node, which used to take an open drawer with it.
  const drawer = createDrawer({ host, title: "Record" });

  // ------------------------------------------------------------- loading --

  async function load({ force = false } = {}) {
    state.loading = true;
    render();
    const result = await ctx.reader.read("entities", { ...ctx.params, level: state.level }, { signal: controller.signal, force });
    if (disposed) return;
    state.loading = false;
    state.status = result.status;
    // Which read actually failed, when the rows on screen came from an earlier
    // one the reader kept.
    state.readStatus = result.failedStatus || result.status;
    state.detail = result.detail || "";
    state.fetchedAt = result.fetchedAt || null;
    // Metrics read from the row directly, so the level's totals are lifted to
    // the top level once here instead of in every column renderer. A read that
    // carried no row list must not replace rows already on screen with none.
    const rows = Array.isArray(result.data?.rows) ? result.data.rows : null;
    if (rows) state.rows = rows.map((row) => ({ ...row, ...(row.totals || {}) }));
    selection.setMatching(state.rows);
    render();
    // A view that arrived in the link is announced once, because a screen that
    // silently opens filtered is a screen somebody will misread.
    if (!announcedUrlView && ctx.store.urlView?.applied) {
      announcedUrlView = true;
      ctx.say(
        `Opened with the ${ctx.store.urlView.kind === "built-in" ? "built-in" : "saved"} view "${ctx.store.urlView.name}" from this link. Removing a filter chip leaves the view.`,
      );
    }
    // A drill-down from another screen arrives before these rows exist, so the
    // request waits for them and is honoured here, once.
    const pending = ctx.takePendingRecord?.();
    if (pending) {
      void Promise.resolve(focusRecord(pending)).then((opened) => {
        if (!opened) ctx.recordMiss?.(pending);
      });
    }
  }

  /**
   * Show one record another screen asked for, at the level that record lives at.
   *
   * Returns false when the record is not in this reader's rows, so the caller
   * can say so instead of pretending a drawer opened.
   */
  async function focusRecord({ kind = "", id = "" } = {}) {
    const wanted = String(id || "");
    if (!wanted) return false;
    const level = ENTITY_LEVELS.includes(String(kind)) ? String(kind) : "";
    if (level && level !== state.level) {
      await switchLevel(level);
      if (disposed) return false;
    }
    const row = state.rows.find((candidate) => rowKey(candidate) === wanted || String(candidate?.id || "") === wanted);
    if (!row) return false;
    openDetail(row);
    return true;
  }

  // ------------------------------------------------------------ hierarchy --

  /** The row's delivery state as a word this read actually carried. `stateOf`
   *  falls back to "draft" for an unknown value, which is right for a badge's
   *  tone and wrong for a before/after review, where it would claim a state. */
  function stateText(row) {
    const raw = reviewState(row);
    if (!raw) return "—";
    return DELIVERY_STATE_LABELS[raw] || raw;
  }

  /** The same state, but empty when this read did not carry one. The review's
   *  arithmetic keys off emptiness: "—" is a display, and counting it as a state
   *  would make an unmeasured row look like a row that changes. */
  function reviewState(row) {
    return String(row?.state || row?.status || "").toLowerCase();
  }

  /** The one sentence a screen shows when the context read carried no
   *  currency. Shown wherever a money figure appears, because a figure whose
   *  unit was assumed is a wrong number. */
  function currencyNote() {
    const note = el("p", "ads-currency-note");
    note.append(svg(ICONS.info, { size: 12, width: 1.8 }), el("span", "", CURRENCY_UNKNOWN_NOTE));
    return note;
  }

  /**
   * Move to another level, keeping only the filters that level can evaluate.
   *
   * A filter naming a field the new level has no definition for would match
   * nothing at all (see the unknown-field path in `matchesFilter`), so the table
   * would read as empty. Dropping the filter and saying so is the only honest
   * option: the alternative is a blank table nobody can explain.
   */
  async function switchLevel(level, { filters = null, say = "" } = {}) {
    if (!ENTITY_LEVELS.includes(level)) return false;
    const allowed = new Set(buildFields(level).map((def) => def.id));
    const wanted = filters || ctx.store.state.filters;
    const kept = wanted.filter((f) => allowed.has(f.field));
    const dropped = wanted.filter((f) => !allowed.has(f.field));
    state.level = level;
    // The rows on screen answer the old level's question. Keeping them under the
    // new level's heading would describe a table that is not the one being asked
    // for, and a failed read must not leave them there.
    state.rows = [];
    state.compareKeys = [];
    selection.clear();
    ctx.store.update({ level, filters: kept });
    await load();
    if (disposed) return false;
    if (dropped.length) {
      ctx.say(
        `${dropped.length} filter${dropped.length === 1 ? "" : "s"} (${dropped.map((f) => f.field).join(", ")}) do not apply at the ${ENTITY_LEVEL_LABELS[level].toLowerCase()} level and ${dropped.length === 1 ? "was" : "were"} removed.`,
      );
    } else if (say) {
      ctx.say(say);
    }
    return true;
  }

  /**
   * Drill down from a row to the level below it, filtered to that one parent —
   * by id, never by name. The filter is an ordinary filter chip: it is visible
   * in the bar, it can be removed like any other, and the screen says which
   * record the table is narrowed to.
   */
  function drillDown(row) {
    const level = row.level === "campaign" ? "adset" : row.level === "adset" ? "ad" : "";
    if (!level) return;
    const id = String(rowKey(row));
    if (!id) {
      ctx.say(`This ${ENTITY_LEVEL_LABELS[row.level] || row.level} row did not carry an identity, so there is nothing to filter the next level by.`);
      return;
    }
    void switchLevel(level, {
      filters: [parentFilterFor(level, id)],
      say: `Showing the ${level === "adset" ? "ad sets" : "ads"} in this ${ENTITY_LEVEL_LABELS[row.level].toLowerCase()}, ${id}. The filter is in the bar and can be removed.`,
    });
  }

  // ------------------------------------------------------------- columns --

  function renderValue(row, id, currency) {
    switch (id) {
      case "name":
        return nameCell(row);
      case "status":
        return statusBadge(stateOf(row), {
          title: DELIVERY_PROOF_STATES.includes(stateOf(row))
            ? "The provider is serving or has served this."
            : "This is not proof of delivery.",
        });
      case "objective":
        return row.objective || "—";
      case "optimisation":
        return row.optimisation || "—";
      case "audience":
        return row.audience || "—";
      case "placements":
        return row.placements || "—";
      case "schedule":
        return row.schedule || "—";
      case "creative":
        return row.creativeName || "—";
      case "destination": {
        const url = String(row.destination || "");
        if (!url) return "—";
        const cell = el("span", "ads-mono-cell", url.replace(/^https?:\/\//, ""));
        cell.title = url;
        return cell;
      }
      case "tracking": {
        const t = row.tracking;
        if (!t) return "—";
        const unstable = Object.values(t).some((v) => typeof v === "string" && /\.name\}\}/.test(v));
        return statusBadge(unstable ? "blocked" : "validated", { label: unstable ? "Unstable id" : "Stable id", title: unstable ? "A parameter uses the ad or campaign name, so renaming will split reporting." : "Every parameter uses a stable internal identifier." });
      }
      case "budget":
        return row.budget === undefined || row.budget === null
          ? "—"
          : `${formatAccountMoney(row.budget, currency)}${row.budgetKind === "daily" ? "/day" : row.budgetKind === "lifetime" ? " lifetime" : ""}`;
      case "budgetDelta":
        return row.budgetDelta === undefined || row.budgetDelta === null ? "—" : formatAccountMoneyDelta(row.budgetDelta / 100, currency);
      case "spendTrend":
        return sparkline((row.series || []).map((p) => p.spend), { width: 76, height: 20 });
      case "lastEdit":
        return formatWhen(row.lastEdit);
      case "issues": {
        const issues = row.issues || [];
        if (!issues.length) return "—";
        const first = issues[0];
        const pill = statusBadge("blocked", { label: `${issues.length} flag${issues.length === 1 ? "" : "s"}` });
        pill.title = issues.map((i) => i.detail).join(" ");
        return pill;
      }
      default:
        break;
    }
    const metric = METRICS[id];
    if (!metric) return row[id] ?? "—";
    const value = metricValue(id, row);
    const measurement = metric.measurement || "";
    const formatted =
      metric.kind === "currency"
        ? formatAccountMoney(value, currency) ?? "—"
        : metric.kind === "percent"
          ? formatPercent(value)
          : metric.kind === "ratio"
            ? formatRatio(value)
            : formatInt(value);
    if (measurement) {
      const cell = el("span", "ads-metric-cell");
      cell.append(el("span", "ads-num", formatted));
      const note = sourceNote(measurement);
      if (note) {
        note.classList.add("ads-source-inline");
        cell.append(note);
      }
      return cell;
    }
    return el("span", "ads-num", formatted);
  }

  function nameCell(row) {
    const wrap = el("div", "ads-cell-name");
    const title = el("strong", "", rowName(row));
    wrap.append(title);
    const bits = [];
    if (row.level === "campaign" && row.objective) bits.push(row.objective);
    if (row.level === "adset" && row.audience) bits.push(row.audience);
    if (row.level === "ad" && row.format) bits.push(row.format);
    if (!DELIVERY_PROOF_STATES.includes(stateOf(row)) && stateOf(row) !== "draft") bits.push(DELIVERY_STATE_LABELS[stateOf(row)] || stateOf(row));
    if (bits.length) wrap.append(el("span", "ads-cell-sub", bits.join(" · ")));
    // The path, not just the leaf. An ad that does not say which ad set holds it
    // is a name floating in a list, and the id is what makes the path real: two
    // ad sets can share a name, and only the id says which one this is.
    const parent = parentIdentity(row);
    if (row.level !== "campaign") {
      const line = el("span", "ads-cell-parent");
      const fieldDef = PARENT_FIELD[row.level === "ad" ? "ad" : "adset"];
      line.append(el("span", "ads-cell-parent-label", fieldDef ? fieldDef.label : "In"));
      const idNode = el("span", "ads-cell-parent-id", parent.id || "—");
      idNode.title = parent.id ? "The parent's immutable id. The filter uses this, never the name." : "This read did not carry the parent's identity, so the path cannot be shown.";
      line.append(idNode);
      if (parent.name) line.append(el("span", "ads-cell-parent-name", parent.name));
      wrap.append(line);
    }
    if ((row.issues || []).length) {
      const flag = el("span", "ads-flag");
      flag.append(svg(ICONS.alert, { size: 11, width: 2 }));
      flag.title = row.issues.map((i) => i.detail).join(" ");
      title.append(flag);
    }
    return wrap;
  }

  function buildColumns(level, currency) {
    const active = ctx.store.state.columns?.length ? ctx.store.state.columns : DEFAULT_COLUMNS[level];
    const catalog = COLUMN_CATALOG[level];
    const ordered = [...active.filter((id) => catalog.includes(id)), ...catalog.filter((id) => !active.includes(id))];
    return ordered
      .filter((id) => active.includes(id))
      .map((id) => {
        const metric = METRICS[id];
        const label = metric ? metric.short || metric.label : COLUMN_LABELS[id] || id;
        const align = metric ? "num" : id === "spendTrend" || id === "issues" ? "end" : "start";
        return column({
          id,
          label,
          align,
          // The name cell *is* the row's identity: it says which record this is
          // and, for a child row, which parent it hangs under. On a phone it is
          // pinned to the leading edge so the subject never scrolls away.
          identity: id === "name",
          title: metric?.definition || COLUMN_TITLES[id] || "",
          sortable: true,
          sortValue:
            id === "name"
              ? (row) => rowName(row).toLowerCase()
              : id === "status"
                ? (row) => stateOf(row)
                : id === "spendTrend"
                  ? (row) => (row.series || []).reduce((sum, p) => sum + p.spend, 0)
                  : id === "issues"
                    ? (row) => (row.issues || []).length
                    : metric
                      ? (row) => metricValue(id, row)
                      : (row) => (row[id] === null || row[id] === undefined ? null : String(row[id]).toLowerCase()),
          render: (row) => renderValue(row, id, currency),
        });
      });
  }

  const COLUMN_LABELS = {
    name: "Name",
    status: "Status",
    objective: "Objective",
    optimisation: "Optimisation",
    audience: "Audience",
    placements: "Placements",
    schedule: "Schedule",
    creative: "Creative",
    destination: "Destination",
    tracking: "Tracking",
    budget: "Budget",
    budgetDelta: "Budget change",
    spendTrend: "Spend trend",
    lastEdit: "Last edit",
    issues: "Flags",
  };

  const COLUMN_TITLES = {
    name: "The row name. A rename never changes the internal id reporting joins on.",
    status: "Provider delivery state. Only Delivering and Paused prove the provider served the ad.",
    destination: "The landing URL this row sends traffic to.",
    tracking: "Whether the UTM parameters use stable internal identifiers.",
    issues: "Flags raised by the sync against this row.",
  };

  // ------------------------------------------------------------ filtering --

  function buildFields(level) {
    const dimensionFields = {
      campaign: [
        field({ id: "objective", label: "Objective", kind: "enum", options: () => distinct(level, "objective"), group: "Delivery" }),
        field({ id: "optimisation", label: "Optimisation event", kind: "enum", options: () => distinct(level, "optimisation"), group: "Delivery" }),
      ],
      adset: [
        field({ id: "audience", label: "Audience", kind: "enum", options: () => distinct(level, "audience"), group: "Delivery" }),
        field({ id: "placements", label: "Placements", kind: "enum", options: () => distinct(level, "placements"), group: "Delivery" }),
      ],
      ad: [
        field({ id: "creativeName", label: "Creative", kind: "enum", options: () => distinct(level, "creativeName"), group: "Creative" }),
        field({ id: "destination", label: "Destination", kind: "text", group: "Delivery" }),
      ],
    }[level];

    // The parent filter is an ordinary filter: it appears as a chip with the id
    // in it, it can be removed like any other, and it joins on the identity the
    // drill-down used. A name would match every campaign that shares it.
    const parentField = PARENT_FIELD[level]
      ? [
          field({
            id: PARENT_FIELD[level].id,
            label: PARENT_FIELD[level].label,
            kind: "text",
            group: "Hierarchy",
            hint: `The ${PARENT_FIELD[level].noun}'s immutable id, never its name`,
            get: (row) => parentIdentity(row).id,
          }),
        ]
      : [];

    return [
      field({
        id: "name",
        label: "Name",
        kind: "text",
        group: "Row",
        get: (row) => rowName(row),
      }),
      field({
        id: "state",
        label: "Delivery state",
        kind: "enum",
        options: () => distinct(level, "state"),
        get: (row) => stateOf(row),
        group: "Row",
      }),
      ...parentField,
      ...dimensionFields,
      field({ id: "spend", label: "Spend", kind: "number", group: "Cost and results" }),
      field({ id: "results", label: "Results (Meta-attributed)", kind: "number", group: "Cost and results" }),
      field({ id: "costPerResult", label: "Cost per result", kind: "number", group: "Cost and results" }),
      field({ id: "ctr", label: "CTR (link)", kind: "number", group: "Cost and results" }),
      field({ id: "frequency", label: "Frequency", kind: "number", group: "Delivery" }),
      field({ id: "qualifiedLeads", label: "Qualified leads (CRM-observed)", kind: "number", group: "Outcomes" }),
      field({
        id: "hasIssues",
        label: "Has a flag",
        kind: "boolean",
        get: (row) => (row.issues || []).length > 0,
        group: "Row",
      }),
      field({
        id: "insufficient",
        label: "Below the evidence floor",
        kind: "boolean",
        get: (row) => evidenceFor(row).level === "insufficient",
        group: "Evidence",
      }),
    ];
  }

  function distinct(level, key) {
    const seen = new Set();
    for (const row of state.rows) {
      const value = key === "state" ? stateOf(row) : row[key];
      if (value !== null && value !== undefined && value !== "") seen.add(String(value));
    }
    return Array.from(seen).sort().map((value) => ({ value, label: value }));
  }

  function applyView() {
    const fields = buildFields(state.level);
    const filtered = applyFilters(state.rows, ctx.store.state.filters, fields).filter((row) => {
      if (!state.search) return true;
      const needle = state.search.toLowerCase();
      return rowName(row).toLowerCase().includes(needle) || String(row.internalId || row.id).toLowerCase().includes(needle);
    });
    state.filtered = filtered;
    selection.setMatching(filtered);
    // A row hidden by a filter must not stay selected into a bulk action.
    selection.retain(filtered.map(rowKey));
    return { fields, filtered };
  }


  // ------------------------------------------------------------- compare --

  function compareRows() {
    const chosen = state.compareKeys.map((key) => state.rows.find((row) => rowKey(row) === key)).filter(Boolean);
    if (chosen.length < 2) return;
    const currency = accountCurrency(ctx.context);
    drawer.setTitle(`Compare ${chosen.length} rows`);
    drawer.show((body) => {
      if (!currency) body.append(currencyNote());
      const note = el("p", "ads-screen-note");
      note.append(
        document.createTextNode(
          "Rates are compared with a Wilson 95% interval. When the intervals overlap the difference is inside the noise, and this screen says so rather than crowning a winner.",
        ),
      );
      body.append(note);

      const grid = el("div", "ads-compare-grid");
      const metricIds = ["spend", "results", "costPerResult", "ctr", "cpc", "qualifiedLeads", "costPerQualifiedLead"];
      for (const id of metricIds) {
        const metric = METRICS[id];
        const cell = el("div", "ads-compare-cell");
        cell.append(el("span", "ads-compare-label", metric.label));
        const values = el("div", "ads-compare-values");
        for (const row of chosen) {
          const value = metricValue(id, row);
          const line = el("div", "ads-compare-value");
          line.append(el("span", "ads-compare-row-name", rowName(row)));
          line.append(
            el(
              "span",
              "ads-num",
              metric.kind === "currency"
                ? formatAccountMoney(value, currency) ?? "—"
                : metric.kind === "percent"
                  ? formatPercent(value)
                  : formatInt(value),
            ),
          );
          values.append(line);
        }
        cell.append(values);
        if (metric.measurement) {
          const note2 = sourceNote(metric.measurement);
          if (note2) cell.append(note2);
        }
        grid.append(cell);
      }
      body.append(grid);

      if (chosen.length === 2) {
        const verdicts = el("div", "ads-block");
        verdicts.append(el("h3", "ads-block-title", "Verdict"));
        for (const [metricId, denominator] of [
          ["results", "linkClicks"],
          ["qualifiedLeads", "linkClicks"],
        ]) {
          const cmp = compareRates(chosen[0], chosen[1], { metric: metricId, denominator });
          const row = el("div", "ads-verdict");
          row.dataset.verdict = cmp.verdict;
          row.append(el("span", "ads-verdict-metric", METRICS[metricId].label));
          const label =
            cmp.verdict === "insufficient"
              ? "Insufficient evidence"
              : cmp.verdict === "tie"
                ? "No material difference"
                : cmp.verdict === "a"
                  ? `${rowName(chosen[0])} is ahead`
                  : `${rowName(chosen[1])} is ahead`;
          row.append(el("strong", "", label));
          row.append(el("span", "ads-verdict-reason", cmp.reason));
          if (cmp.a && cmp.b) {
            row.append(
              el(
                "span",
                "ads-verdict-intervals",
                `Intervals: ${(cmp.a.low * 100).toFixed(1)}–${(cmp.a.high * 100).toFixed(1)}% vs ${(cmp.b.low * 100).toFixed(1)}–${(cmp.b.high * 100).toFixed(1)}%`,
              ),
            );
          }
          verdicts.append(row);
        }
        body.append(verdicts);
      }

      const table = el("table", "ads-map-table");
      const thead = el("thead");
      const hr = el("tr");
      hr.append(el("th", "", "Attribute"));
      for (const row of chosen) hr.append(el("th", "", rowName(row)));
      thead.append(hr);
      const tbody = el("tbody");
      for (const [label, get] of [
        ["Internal id", (r) => String(r.internalId || r.id)],
        ["Delivery state", (r) => DELIVERY_STATE_LABELS[stateOf(r)] || stateOf(r)],
        ["Objective", (r) => r.objective || "—"],
        ["Optimisation", (r) => r.optimisation || "—"],
        ["Budget", (r) => (r.budget === null || r.budget === undefined ? "—" : `${formatAccountMoney(r.budget, currency) ?? "—"}${r.budgetKind === "daily" ? "/day" : ""}`)],
        ["Last edit", (r) => formatWhen(r.lastEdit)],
        ["Flags", (r) => (r.issues || []).map((i) => i.detail).join("; ") || "None"],
        ["Evidence", (r) => {
          const e = evidenceFor(r);
          return `${e.label} — ${e.reason}`;
        }],
      ]) {
        const tr = el("tr");
        tr.append(el("td", "ads-map-fixed", label));
        for (const row of chosen) tr.append(el("td", "", get(row)));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      body.append(table);
    });
  }

  function toggleCompare(row) {
    const key = rowKey(row);
    if (state.compareKeys.includes(key)) state.compareKeys = state.compareKeys.filter((k) => k !== key);
    else state.compareKeys = [...state.compareKeys, key].slice(-3);
    render();
    if (state.compareKeys.length >= 2) compareRows();
  }

  // ------------------------------------------------------------ bulk edit --

  /**
   * The before/after review. Every affected row is listed with its current and
   * proposed value and an explicit total, because a bulk budget change is the
   * single easiest way to spend money by accident.
   */
  function openBulkReview(kind) {
    // Only rows the current filters keep can be selected, so this is both the
    // exact set the operator chose and the exact set the review lists.
    const chosen = selection.keys().map((key) => state.filtered.find((row) => rowKey(row) === key)).filter(Boolean);
    if (!chosen.length) return;
    const currency = accountCurrency(ctx.context);
    drawer.setTitle(kind === "pause" ? "Review a bulk pause" : "Review a bulk budget change");
    drawer.show((body, close) => {
      const intro = el("p", "ads-screen-note");
      intro.append(
        document.createTextNode(
          kind === "pause"
            ? "Pausing stops delivery immediately. Nothing is sent from this screen: the change is staged here for review and goes to the provider only through a gated write."
            : "Budgets are daily unless the row says otherwise. Nothing is sent from this screen: the change is staged here for review and goes to the provider only through a gated write.",
        ),
      );
      body.append(intro);
      if (!currency) body.append(currencyNote());

      let percent = 10;
      const preview = el("div", "ads-bulk-preview");
      const rowsHost = el("div", "ads-bulk-rows");

      // A budget the read did not carry is unknown, not zero. Turning it into
      // £0 made the review promise a change from nothing to £1, which is a
      // number Frank invented; an unknown value is shown as — and left out of
      // the total, and the rows it affects are named.
      const afterBudget = (before) =>
        before === null ? null : kind === "pause" ? before : Math.max(1, Math.round(before * (1 + percent / 100) * 100) / 100);

      const beforeAfter = () => {
        clear(rowsHost);
        // One arithmetic, shared with the queue's review: unknown values are
        // excluded from the totals rather than counted as zero, and the count of
        // excluded rows is stated.
        const plan = summariseChangeEntries(
          kind,
          chosen.map((row) => ({
            key: rowKey(row),
            name: rowName(row),
            // The row's own state is carried through the arithmetic so the
            // review never has to guess it back from a name.
            state: stateText(row),
            before: kind === "pause" ? reviewState(row) : num(row.budget),
            after: kind === "pause" ? "Paused" : afterBudget(num(row.budget)),
          })),
        );
        for (const entry of plan.entries) {
          const line = el("div", "ads-ba-row");
          const named = el("span", "ads-ba-name");
          named.append(el("span", "", entry.name));
          // The identity, beside the name. Names repeat across a hierarchy —
          // "Broad 1" exists in every campaign — so a review that lists names
          // alone cannot be checked against the rows it will change.
          named.append(el("span", "ads-ba-id", entry.key || "no identity in this read"));
          line.append(named);
          // The row's own state, never a guessed one: a "before" column that
          // says Delivering for a paused row is a claim about delivery.
          line.append(el("span", "ads-ba-state", entry.state));
          const ba = el("span", "ads-ba-values");
          const beforeText = kind === "pause" ? (entry.before ? DELIVERY_STATE_LABELS[entry.before] || entry.before : "—") : formatAccountMoney(entry.before, currency);
          const afterText = kind === "pause" ? "Paused" : formatAccountMoney(entry.after, currency);
          const beforeNode = el("span", "ads-ba-before", beforeText ?? "—");
          if (!entry.known && kind !== "pause") beforeNode.title = "This read did not carry a budget for this row. A missing value is not zero.";
          ba.append(beforeNode);
          ba.append(svg(ICONS.chevronRight, { size: 12, width: 2 }));
          const afterNode = el("span", "ads-ba-after", afterText ?? "—");
          if (!entry.known && kind !== "pause") afterNode.title = "Without a before value the after value cannot be computed.";
          ba.append(afterNode);
          line.append(ba);
          rowsHost.append(line);
        }
        const counted = plan.known.length;
        const excluded = plan.unknown.length;
        const excludedNote = excluded ? ` · ${formatInt(excluded)} excluded (no ${kind === "pause" ? "state" : "budget"} in this read)` : "";
        const total = el("div", "ads-ba-total");
        total.append(
          el(
            "span",
            "",
            counted === 0
              ? // Every affected row is unknown, so there is no total to state.
                // "0 of 4 rows stop delivering" would be a claim about rows this
                // read never measured.
                `— · nothing to total: ${excluded ? `all ${formatInt(excluded)} rows carry no ${kind === "pause" ? "state" : "budget"} in this read` : "no rows are affected"}`
              : kind === "pause"
                ? `${formatInt(plan.changed)} of ${formatInt(plan.entries.length)} rows stop delivering${excludedNote}`
                : `Combined daily budget (${formatInt(counted)} of ${formatInt(plan.entries.length)} rows)${excludedNote}`,
          ),
        );
        const totals =
          plan.beforeTotal === null || plan.afterTotal === null
            ? "—"
            : `${formatAccountMoney(plan.beforeTotal, currency) ?? "—"} → ${formatAccountMoney(plan.afterTotal, currency) ?? "—"}`;
        total.append(el("span", "ads-ba-values", kind === "pause" ? "" : totals));
        rowsHost.append(total);
        if (excluded) {
          const note = el(
            "p",
            "ads-field-hint",
            kind === "pause"
              ? `${formatInt(excluded)} selected row${excluded === 1 ? " did" : "s did"} not carry a delivery state in this read, so ${excluded === 1 ? "it is" : "they are"} shown as — and excluded from the count above. An unknown state is not "delivering".`
              : `${formatInt(excluded)} selected row${excluded === 1 ? " has" : "s have"} no budget in this read, so ${excluded === 1 ? "it is" : "they are"} shown as — and excluded from both totals above. A missing budget is not zero.`,
          );
          rowsHost.append(note);
        }
      };

      if (kind !== "pause") {
        const control = el("div", "ads-bulk-control");
        control.append(el("span", "ads-field-label", "Change every selected budget by"));
        const seg = segmented(
          [-25, -10, 10, 25, 50].map((p) => ({ id: String(p), label: `${p > 0 ? "+" : ""}${p}%` })),
          String(percent),
          (id) => {
            percent = Number(id);
            beforeAfter();
          },
          { label: "Budget change", size: "sm" },
        );
        control.append(seg);
        preview.append(control);
      }

      beforeAfter();
      preview.append(rowsHost);

      const guard = el("div", "ads-banner");
      guard.dataset.tone = "warn";
      guard.append(svg(ICONS.alert, { size: 13, width: 1.8 }));
      guard.append(
        el(
          "span",
          "",
          // The exclusion count is stated under the totals, where it is refreshed
          // whenever the percentage changes; this sentence is written once.
          `${chosen.length} row${chosen.length === 1 ? "" : "s"} will change, each listed above with its before and after value. A row hidden by the current filters cannot be in this selection: selecting a page or every matching row only ever selects rows the filters keep.`,
        ),
      );
      preview.append(guard);
      body.append(preview);

      const foot = el("div", "ads-wizard-foot");
      foot.append(el("span", "ads-wizard-spacer"));
      foot.append(button("Cancel", { onClick: () => close() }));
      foot.append(
        button(kind === "pause" ? "Stage the pause" : "Stage the budget change", {
          variant: "ink",
          onClick: () => {
            // One shared draft record, so this staged change appears in the
            // publishing queue with the same before/after rows the operator just
            // approved, rather than living only in this drawer.
            const saved = ctx.drafts.save({
              kind: kind === "pause" ? "pause" : "budget",
              approval: "staged",
              state: "queued",
              title:
                kind === "pause"
                  ? `Pause ${chosen.length} ${state.level === "ad" ? "ads" : state.level === "adset" ? "ad sets" : "campaigns"}`
                  : `${percent > 0 ? "+" : ""}${percent}% budget across ${chosen.length} ${state.level === "ad" ? "ads" : state.level === "adset" ? "ad sets" : "campaigns"}`,
              campaign: { currency, budgetKind: "daily" },
              changes: {
                kind: kind === "pause" ? "pause" : "budget",
                percent: kind === "pause" ? 0 : percent,
                amount: null,
                direction: percent < 0 ? "decrease" : "increase",
                batches: [],
                gaps: [],
                rows: chosen.map((row) => {
                  const before = num(row.budget);
                  return {
                    key: rowKey(row),
                    name: rowName(row),
                    level: state.level,
                    state: stateOf(row),
                    before,
                    after: afterBudget(before),
                  };
                }),
              },
            });
            ctx.say(
              kind === "pause"
                ? `Staged a pause for ${formatInt(saved.changes.rows.length)} rows in the publishing queue. Nothing has been sent to the provider.`
                : `Staged a ${percent > 0 ? "+" : ""}${percent}% budget change for ${formatInt(saved.changes.rows.length)} rows in the publishing queue. Nothing has been sent to the provider.`,
            );
            // The staged rows are in the queue now; leaving them selected
            // invites the same bulk action a second time.
            selection.clear();
            close();
            render();
          },
        }),
      );
      body.append(foot);
    });
  }

  // -------------------------------------------------------------- inspect --

  /** Delivery inspection: why a row is in the state it is in, not just that it is. */
  function openDetail(row) {
    const currency = accountCurrency(ctx.context);
    drawer.setTitle(rowName(row));
    drawer.show((body) => {
      if (!currency) body.append(currencyNote());
      const head = el("div", "ads-detail-head");
      head.append(statusBadge(stateOf(row)));
      head.append(el("span", "ads-detail-id", String(row.internalId || row.id)));
      body.append(head);

      const proofNote = el("p", "ads-screen-note");
      proofNote.append(
        document.createTextNode(
          DELIVERY_PROOF_STATES.includes(stateOf(row))
            ? "The provider reports this row as served. That is delivery, not a guess."
            : "This state is not proof of delivery. Only Delivering and Paused mean the provider actually served the ad; Submitted and In review are acknowledgements of a write.",
        ),
      );
      body.append(proofNote);

      if ((row.issues || []).length) {
        const issues = el("div", "ads-block");
        issues.append(el("h3", "ads-block-title", "Flags"));
        for (const issue of row.issues) {
          const item = el("div", "ads-issue");
          item.dataset.kind = issue.kind;
          item.append(el("strong", "", ISSUE_LABELS[issue.kind] || issue.kind));
          item.append(el("p", "", issue.detail));
          issues.append(item);
        }
        body.append(issues);
      }

      const facts = el("dl", "ads-defs");
      const fact = (term, value) => facts.append(definitionRow(term, value));
      fact("Level", ENTITY_LEVEL_LABELS[row.level] || row.level || "—");
      if (row.objective) fact("Objective", row.objective);
      if (row.optimisation) fact("Optimisation event", row.optimisation);
      if (row.audience) fact("Audience", row.audience);
      if (row.placements) fact("Placements", row.placements);
      if (row.schedule) fact("Schedule", row.schedule);
      if (row.creativeName) fact("Creative", row.creativeName);
      if (row.destination) fact("Destination", row.destination);
      // The parent's identity, so the record says where it sits in the
      // hierarchy rather than implying it sits nowhere.
      const parent = parentIdentity(row);
      if (row.level !== "campaign") fact(PARENT_FIELD[row.level === "ad" ? "ad" : "adset"].label, `${parent.id || "—"}${parent.name ? ` · ${parent.name}` : ""}`);
      if (row.budget !== null && row.budget !== undefined) fact("Budget", `${formatAccountMoney(row.budget, currency) ?? "—"} ${row.budgetKind || ""}`.trim());
      fact("Last edit", formatWhen(row.lastEdit));
      body.append(facts);

      if (row.tracking) {
        const tracking = el("div", "ads-block");
        tracking.append(el("h3", "ads-block-title", "Tracking"));
        const chain = el("dl", "ads-defs");
        for (const [key, value] of Object.entries(row.tracking)) {
          chain.append(definitionRow(key, value ? String(value) : "Not set"));
        }
        tracking.append(chain);
        const link = button("Open the tracking manager", { onClick: () => ctx.navigate("tracking") });
        tracking.append(link);
        body.append(tracking);
      }

      const evidence = evidenceFor(row);
      const evidenceBlock = el("div", "ads-block");
      evidenceBlock.append(el("h3", "ads-block-title", "Evidence"));
      const badgeRow = el("div", "ads-state-strip");
      badgeRow.append(evidenceBadge(evidence));
      evidenceBlock.append(badgeRow);
      evidenceBlock.append(el("p", "ads-block-note", evidence.reason));
      body.append(evidenceBlock);

      const series = row.series || [];
      if (series.length) {
        const daily = el("div", "ads-block");
        daily.append(el("h3", "ads-block-title", "Delivery by day"));
        daily.append(sparkline(series.map((p) => p.spend), { width: 320, height: 40 }));
        const table = el("table", "ads-map-table");
        const thead = el("thead");
        const hr = el("tr");
        for (const label of ["Day", "Spend", "Results", "CPR"]) hr.append(el("th", "", label));
        thead.append(hr);
        const tbody = el("tbody");
        for (const point of series.slice(-14).reverse()) {
          const tr = el("tr");
          tr.append(el("td", "ads-map-fixed", formatDay(point.date)));
          tr.append(el("td", "ads-num", formatAccountMoney(point.spend, currency) ?? "—"));
          tr.append(el("td", "ads-num", formatInt(point.results)));
          tr.append(el("td", "ads-num", formatAccountMoney(point.results ? point.spend / point.results : null, currency) ?? "—"));
          tbody.append(tr);
        }
        table.append(thead, tbody);
        daily.append(table);
        body.append(daily);
      }
    });
  }

  const ISSUE_LABELS = {
    learning_limited: "Learning limited",
    frequency: "Frequency is high",
    tracking: "Tracking defect",
    audience_overlap: "Audience overlap",
    rejected: "Rejected in review",
  };

  // --------------------------------------------------------------- render --

  function render() {
    clear(node);

    const levels = segmented(
      ENTITY_LEVELS.map((level) => ({ id: level, label: ENTITY_LEVEL_LABELS[level] })),
      state.level,
      (level) => {
        if (level === state.level) return;
        void switchLevel(level, {
          // Filters that only exist at the old level are dropped by
          // `switchLevel`, which says which ones and why.
          say: `Showing ${ENTITY_LEVEL_LABELS[level].toLowerCase()}. Same window, same attribution setting.`,
        });
      },
      { label: "Which level to manage" },
    );
    const toolbar = el("div", "ads-toolbar");
    toolbar.append(levels);

    const compareBtn = button(state.compareKeys.length >= 2 ? `Compare ${state.compareKeys.length}` : "Compare", {
      icon: ICONS.compare,
      title: "Select two or three rows, then compare them with a confidence interval.",
      disabled: state.compareKeys.length < 2,
      onClick: () => compareRows(),
    });
    toolbar.append(compareBtn);
    node.append(toolbar);

    if (state.loading) {
      node.append(skeleton(8, 6));
      return;
    }

    if (state.status === "not_connected") {
      node.append(
        notConnectedPanel({
          title: "Not connected",
          requirement: "saved daily rows for campaigns, ad sets and ads",
          action: button("Turn on Preview", { variant: "ink", onClick: () => ctx.say("Use the Preview switch in the header to rehearse against sample rows.") }),
        }),
      );
      return;
    }

    // A read that did not complete and left no rows on screen is reported as
    // that, not as an empty window: the table's empty state would otherwise
    // claim the sync returned no rows.
    if (isUnresolved(state.status) && !state.rows.length) {
      node.append(
        errorPanel({
          title: "That read did not complete",
          detail: state.detail || "The Frank read model did not answer, and no earlier rows are held for this window.",
          onRetry: () => void load({ force: true }),
        }),
      );
      return;
    }

    // Rows kept from an earlier read, with the reason they may be old and the
    // time they were observed.
    if (isUnresolved(state.status)) {
      node.append(
        staleBanner({
          status: state.readStatus,
          fetchedAt: state.fetchedAt,
          detail: state.detail,
          onRefresh: () => void load({ force: true }),
        }),
      );
    }
    node.append(rowsReadNote(state.fetchedAt, { suffix: "Filters, sorting and the level switch re-read the saved rows; nothing here calls the provider." }));

    const { fields } = applyView();
    const currency = accountCurrency(ctx.context);

    const bar = filterBar({
      fields,
      filters: ctx.store.state.filters,
      onChange: (filters) => {
        ctx.store.update({ filters });
        render();
      },
      search: state.search,
      onSearch: (value) => {
        state.search = value;
        render();
      },
      savedViews: ctx.store.saved(),
      builtInViews: ctx.store.builtIn(),
      activeView: ctx.store.activeView(),
      onSaveView: (name) => {
        ctx.store.save(name);
        render();
        ctx.say(`Saved the view "${name}". It is your own view, beside the built-in ones.`);
      },
      onApplyView: (view) => {
        ctx.store.apply(view, { fields });
        state.compareKeys = [];
        render();
        ctx.say(appliedViewSentence(ctx.store, view));
      },
      onUpdateView: (view) => {
        ctx.store.updateSaved(view.id);
        render();
        ctx.say(`Saved the columns, sort and filters on screen to your view "${view.name}".`);
      },
      onRenameView: (view, name) => {
        ctx.store.rename(view.id, name);
        render();
        ctx.say(`Renamed the saved view "${view.name}" to "${name}".`);
      },
      onRemoveView: (view) => {
        ctx.store.remove(view.id);
        render();
        ctx.say(`Deleted your saved view "${view.name}". The built-in views are unchanged.`);
      },
      resultCount: state.filtered.length,
      totalCount: state.rows.length,
      extra: [
        columnChooser({
          all: COLUMN_CATALOG[state.level],
          active: ctx.store.state.columns?.length ? ctx.store.state.columns : DEFAULT_COLUMNS[state.level],
          onChange: (columns) => {
            ctx.store.update({ columns });
            render();
          },
        }),
        sortControl(
          buildColumns(state.level, currency).map((c) => ({ id: c.id, label: c.label })),
          ctx.store.state.sort,
          (sort) => {
            ctx.store.update({ sort });
            render();
          },
        ),
        chip(state.level === "ad" ? "Show only flagged" : "Show only flagged", {
          active: ctx.store.state.filters.some((f) => f.field === "hasIssues"),
          title: "Rows the sync has raised a flag against.",
          onClick: () => {
            const existing = ctx.store.state.filters.filter((f) => f.field !== "hasIssues");
            const on = ctx.store.state.filters.some((f) => f.field === "hasIssues");
            ctx.store.update({ filters: on ? existing : [...existing, { field: "hasIssues", op: "is_true", value: true }] });
            render();
          },
        }),
        // No currency in the context read means no unit is invented anywhere on
        // this screen; the figures say so rather than borrowing sterling.
        ...(currency ? [] : [currencyNote()]),
      ],
    });
    node.append(bar);

    const hiddenCount = selection.keys().filter((key) => !state.filtered.some((row) => rowKey(row) === key)).length;
    if (hiddenCount) {
      const notice = hiddenSelectionNotice(hiddenCount, () => {
        selection.retain(state.filtered.map(rowKey));
        render();
      });
      if (notice) node.append(notice);
    }

    const columns = buildColumns(state.level, currency);
    const table = createTable({
      columns,
      rows: state.filtered,
      getKey: rowKey,
      state: ctx.store.state,
      selection,
      onSelectionChange: (current) => {
        render();
        // The count is announced as well as shown: the bulk bar is the last
        // thing on the screen, and a keyboard operator should not have to go
        // looking for it to know what they just selected.
        const count = current.size();
        ctx.say(count ? `${formatInt(count)} ${count === 1 ? "row" : "rows"} selected at the ${ENTITY_LEVEL_LABELS[state.level].toLowerCase()} level.` : "Selection cleared.");
      },
      onSort: (sort) => ctx.store.update({ sort }),
      onRowActivate: (row) => openDetail(row),
      rowTone: (row) => ((row.issues || []).some((i) => i.kind === "rejected") ? "bad" : (row.issues || []).length ? "warn" : null),
      renderRowMeta: (row) => {
        const group = el("div", "ads-row-actions");
        // The drill-down lives on the parent row, where the question is asked.
        // It switches level and filters by the record's id, so the table below is
        // exactly that record's children.
        const childLevel = row.level === "campaign" ? "adset" : row.level === "adset" ? "ad" : "";
        if (childLevel) {
          const drill = button(childLevel === "adset" ? "Show its ad sets" : "Show its ads", {
            variant: "quiet",
            title: `Switches to the ${ENTITY_LEVEL_LABELS[childLevel].toLowerCase()} level and filters to this record's id (${rowKey(row)}), never its name.`,
            onClick: (event) => {
              event.stopPropagation();
              drillDown(row);
            },
          });
          drill.classList.add("ads-row-action");
          group.append(drill);
        }
        const inCompare = state.compareKeys.includes(rowKey(row));
        const action = button(inCompare ? "In compare" : "Compare", {
          variant: "quiet",
          title: inCompare ? "Remove from the comparison" : "Add to the comparison",
          onClick: (event) => {
            event.stopPropagation();
            toggleCompare(row);
          },
        });
        // Revealed on hover, focus or selection on pointer devices; always
        // visible on touch, where there is no hover to discover it with.
        action.classList.add("ads-row-action");
        group.append(action);
        return group;
      },
      emptyNode: emptyPanel({
        title: state.rows.length ? "No row matches these filters" : "Nothing in this window",
        detail: state.rows.length
          ? "Clear a filter or widen the date range. The rows exist; the current filters exclude them."
          : "The sync returned no rows at this level for the selected window and attribution setting.",
      }),
    });
    node.append(table.node);

    if (selection.size()) {
      node.append(
        bulkBar({
          count: selection.size(),
          matchingCount: selection.matchingSize(),
          pageCount: selection.pageSize(),
          hiddenCount: selection.hiddenKeys().length,
          noun: state.level === "ad" ? "ad" : state.level === "adset" ? "ad set" : "campaign",
          note: "Nothing is sent from this screen. Bulk changes are staged for a before/after review.",
          onSelectMatching: () => {
            const total = selection.matchingSize();
            selection.selectMatching();
            ctx.say(`Selected all ${total} rows the current filters match. Nothing has been changed.`);
            render();
          },
          onSelectPage: () => {
            selection.retain(selection.pageKeys());
            ctx.say("Selection reduced to the rows on this page.");
            render();
          },
          actions: [
            button("Change budgets", { icon: ICONS.arrowUp, onClick: () => openBulkReview("budget") }),
            button("Pause", { icon: ICONS.minus, onClick: () => openBulkReview("pause") }),
            button("Export selection", { icon: ICONS.external, onClick: () => ctx.say(`Export of ${selection.size()} rows is not wired yet.`) }),
          ],
          onClear: () => {
            selection.clear();
            render();
          },
        }),
      );
    }
  }

  void load();
  return {
    node,
    dispose() {
      disposed = true;
      controller.abort();
      drawer.close({ restoreFocus: false });
    },
    settled: () => Promise.resolve(),
    reload: (options = {}) => load({ force: Boolean(options.force) }),
    focusRecord,
  };
}
