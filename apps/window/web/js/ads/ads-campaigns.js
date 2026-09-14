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
} from "./ads-ui.js";
import { createTable, column, createSelection, columnChooser, sortControl } from "./ads-table.js";
import { applyFilters, field, filterBar, bulkBar, hiddenSelectionNotice } from "./ads-views.js";
import {
  ENTITY_LEVELS,
  ENTITY_LEVEL_LABELS,
  DEFAULT_COLUMNS,
  COLUMN_CATALOG,
  METRICS,
  metricValue,
  evidenceFor,
  compareRates,
  formatDelta,
  formatInt,
  formatMoney,
  formatPercent,
  formatRatio,
  formatDay,
  formatWhen,
  rowName,
  rowKey,
  stateOf,
  DELIVERY_STATE_LABELS,
  DELIVERY_PROOF_STATES,
} from "./ads-contracts.js";

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
    detail: "",
    compareKeys: [],
  };

  const selection = createSelection({ getKey: rowKey });
  const drawer = createDrawer({ host: node, title: "Record" });

  // ------------------------------------------------------------- loading --

  async function load({ force = false } = {}) {
    state.loading = true;
    render();
    const result = await ctx.reader.read("entities", { ...ctx.params, level: state.level }, { signal: controller.signal, force });
    if (disposed) return;
    state.loading = false;
    state.status = result.status;
    state.detail = result.detail || "";
    // Metrics read from the row directly, so the level's totals are lifted to
    // the top level once here instead of in every column renderer.
    state.rows = (result.data?.rows || []).map((row) => ({ ...row, ...(row.totals || {}) }));
    selection.setVisible(state.rows);
    render();
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
        return row.budget === undefined || row.budget === null ? "—" : `${formatMoney(row.budget, currency)}${row.budgetKind === "daily" ? "/day" : row.budgetKind === "lifetime" ? " lifetime" : ""}`;
      case "budgetDelta":
        return row.budgetDelta === undefined || row.budgetDelta === null ? "—" : formatDelta(row.budgetDelta / 100, { kind: "currency", currency });
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
        ? formatMoney(value, currency)
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
    selection.setVisible(filtered);
    // A row hidden by a filter must not stay selected into a bulk action.
    selection.retain(filtered.map(rowKey));
    return { fields, filtered };
  }


  // ------------------------------------------------------------- compare --

  function compareRows() {
    const chosen = state.compareKeys.map((key) => state.rows.find((row) => rowKey(row) === key)).filter(Boolean);
    if (chosen.length < 2) return;
    const currency = ctx.context?.account?.currency || "GBP";
    drawer.setTitle(`Compare ${chosen.length} rows`);
    drawer.show((body) => {
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
              metric.kind === "currency" ? formatMoney(value, currency) : metric.kind === "percent" ? formatPercent(value) : formatInt(value),
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
        ["Budget", (r) => (r.budget === null || r.budget === undefined ? "—" : `${formatMoney(r.budget, currency)}${r.budgetKind === "daily" ? "/day" : ""}`)],
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
    const chosen = selection.keys().map((key) => state.rows.find((row) => rowKey(row) === key)).filter(Boolean);
    if (!chosen.length) return;
    const currency = ctx.context?.account?.currency || "GBP";
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

      let percent = 10;
      const preview = el("div", "ads-bulk-preview");
      const rowsHost = el("div", "ads-bulk-rows");

      const beforeAfter = () => {
        clear(rowsHost);
        let beforeTotal = 0;
        let afterTotal = 0;
        for (const row of chosen) {
          const before = Number(row.budget) || 0;
          const after = kind === "pause" ? before : Math.max(1, Math.round(before * (1 + percent / 100) * 100) / 100);
          beforeTotal += before;
          afterTotal += after;
          const line = el("div", "ads-ba-row");
          line.append(el("span", "ads-ba-name", rowName(row)));
          line.append(el("span", "ads-ba-state", DELIVERY_STATE_LABELS[stateOf(row)] || stateOf(row)));
          const ba = el("span", "ads-ba-values");
          ba.append(el("span", "ads-ba-before", kind === "pause" ? "Delivering" : formatMoney(before, currency)));
          ba.append(svg(ICONS.chevronRight, { size: 12, width: 2 }));
          ba.append(el("span", "ads-ba-after", kind === "pause" ? "Paused" : formatMoney(after, currency)));
          line.append(ba);
          rowsHost.append(line);
        }
        const total = el("div", "ads-ba-total");
        total.append(el("span", "", kind === "pause" ? `${chosen.length} rows stop delivering` : "Combined daily budget"));
        total.append(el("span", "ads-ba-values", kind === "pause" ? "" : `${formatMoney(beforeTotal, currency)} → ${formatMoney(afterTotal, currency)}`));
        rowsHost.append(total);
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
          `${chosen.length} row${chosen.length === 1 ? "" : "s"} will change. Rows hidden by the current filters were removed from this selection before it was counted.`,
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
            ctx.say(
              kind === "pause"
                ? `Staged a pause for ${chosen.length} rows. Nothing has been sent to the provider.`
                : `Staged a ${percent > 0 ? "+" : ""}${percent}% budget change for ${chosen.length} rows. Nothing has been sent to the provider.`,
            );
            close();
          },
        }),
      );
      body.append(foot);
    });
  }

  // -------------------------------------------------------------- inspect --

  /** Delivery inspection: why a row is in the state it is in, not just that it is. */
  function openDetail(row) {
    const currency = ctx.context?.account?.currency || "GBP";
    drawer.setTitle(rowName(row));
    drawer.show((body) => {
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
      if (row.budget !== null && row.budget !== undefined) fact("Budget", `${formatMoney(row.budget, currency)} ${row.budgetKind || ""}`.trim());
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
          tr.append(el("td", "ads-num", formatMoney(point.spend, currency)));
          tr.append(el("td", "ads-num", formatInt(point.results)));
          tr.append(el("td", "ads-num", formatMoney(point.results ? point.spend / point.results : null, currency)));
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
        state.level = level;
        state.compareKeys = [];
        selection.clear();
        ctx.store.update({ level });
        void load();
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
    if (state.status === "error") {
      node.append(errorPanel({ detail: state.detail, onRetry: () => void load({ force: true }) }));
      return;
    }

    const { fields } = applyView();
    const currency = ctx.context?.account?.currency || "GBP";

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
      onSaveView: (name) => {
        ctx.store.save(name);
        render();
        ctx.say(`Saved the view "${name}".`);
      },
      onApplyView: (view) => {
        ctx.store.apply(view);
        state.compareKeys = [];
        render();
        ctx.say(`Applied the view "${view.name}".`);
      },
      onRemoveView: (view) => {
        ctx.store.remove(view.id);
        render();
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
      onSelectionChange: () => render(),
      onSort: (sort) => ctx.store.update({ sort }),
      onRowActivate: (row) => openDetail(row),
      rowTone: (row) => ((row.issues || []).some((i) => i.kind === "rejected") ? "bad" : (row.issues || []).length ? "warn" : null),
      renderRowMeta: (row) => {
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
        return action;
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
          noun: state.level === "ad" ? "ad" : state.level === "adset" ? "ad set" : "campaign",
          note: "Nothing is sent from this screen. Bulk changes are staged for a before/after review.",
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
  };
}
