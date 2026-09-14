// Filters, saved views and per-screen view configuration.
//
// A filter is data, not a closure: `{ field, op, value }`. That matters because
// a saved view has to survive a reload, be shareable in a URL, and be shown back
// to the operator in words they can edit. A tree of predicates would do none of
// those things.
//
// What is persisted here is configuration only — which columns, which filters,
// which sort, and the operator's own named views. Reporting rows are never
// written to browser storage; they are re-read from Frank every session.

import { el, button, chip, popover, menuItem, menuGroup, svg, ICONS } from "./ads-ui.js";
import { num } from "./ads-contracts.js";

const STORAGE_KEY = "frank.ads.views.v1";

export const OPERATORS = Object.freeze([
  Object.freeze({ id: "is", label: "is", kinds: ["text", "enum"], arity: 1 }),
  Object.freeze({ id: "is_not", label: "is not", kinds: ["text", "enum"], arity: 1 }),
  Object.freeze({ id: "contains", label: "contains", kinds: ["text"], arity: 1 }),
  Object.freeze({ id: "not_contains", label: "does not contain", kinds: ["text"], arity: 1 }),
  Object.freeze({ id: "in", label: "is any of", kinds: ["enum"], arity: "many" }),
  Object.freeze({ id: "gt", label: "is more than", kinds: ["number"], arity: 1 }),
  Object.freeze({ id: "lt", label: "is less than", kinds: ["number"], arity: 1 }),
  Object.freeze({ id: "between", label: "is between", kinds: ["number"], arity: 2 }),
  Object.freeze({ id: "is_true", label: "is true", kinds: ["boolean"], arity: 0 }),
  Object.freeze({ id: "is_false", label: "is false", kinds: ["boolean"], arity: 0 }),
]);

/**
 * A filterable field. `get` reads the row; `options` supplies the enum choices
 * from the data actually present, so a filter menu never offers a value that
 * does not exist.
 */
export function field({ id, label, kind = "text", get = null, options = null, hint = "", group = "" }) {
  return Object.freeze({ id, label, kind, get: get || ((row) => row?.[id]), options, hint, group });
}

function valueOf(filter, row) {
  const raw = filter.get ? filter.get(row) : row?.[filter.field];
  return raw;
}

function matchesFilter(row, filter, fields) {
  const def = fields.find((f) => f.id === filter.field);
  const raw = def ? def.get(row) : valueOf(filter, row);
  const op = filter.op;
  const target = filter.value;

  if (op === "is_true") return raw === true;
  if (op === "is_false") return raw === false;

  if (op === "gt" || op === "lt" || op === "between") {
    const left = num(raw);
    if (left === null) return false;
    if (op === "gt") return left > num(target);
    if (op === "lt") return left < num(target);
    const low = num(Array.isArray(target) ? target[0] : target);
    const high = num(Array.isArray(target) ? target[1] : target);
    if (low === null || high === null) return false;
    return left >= Math.min(low, high) && left <= Math.max(low, high);
  }

  const text = raw === null || raw === undefined ? "" : String(raw);
  const haystack = text.toLowerCase();
  const needle = String(target ?? "").toLowerCase();

  switch (op) {
    case "is":
      return haystack === needle;
    case "is_not":
      return haystack !== needle;
    case "contains":
      return haystack.includes(needle);
    case "not_contains":
      return !haystack.includes(needle);
    case "in": {
      const list = Array.isArray(target) ? target : [target];
      if (!list.length) return true;
      return list.map((v) => String(v).toLowerCase()).includes(haystack);
    }
    default:
      return true;
  }
}

export function applyFilters(rows, filters, fields) {
  if (!filters?.length) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f, fields)));
}

// ---------------------------------------------------------------------------
// View store
// ---------------------------------------------------------------------------

function readStore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A browser with storage disabled still gets a working, unsaved session.
  }
}

/**
 * Per-screen view configuration: columns, sort, filters and named saved views.
 * `screenKey` scopes everything, so the campaign table and the creative table
 * cannot leak settings into each other.
 */
export function createViewStore(screenKey) {
  const store = readStore();
  const scope = store[screenKey] && typeof store[screenKey] === "object" ? store[screenKey] : {};
  let current = {
    columns: Array.isArray(scope.columns) ? scope.columns : null,
    sort: scope.sort && typeof scope.sort === "object" ? scope.sort : null,
    filters: Array.isArray(scope.filters) ? scope.filters : [],
    pageSize: Number(scope.pageSize) || 50,
    page: 0,
    groupBy: scope.groupBy || "",
    view: scope.view || "",
    density: scope.density === "compact" ? "compact" : "comfortable",
  };
  let saved = Array.isArray(scope.saved) ? scope.saved.slice() : [];

  function persist() {
    const all = readStore();
    all[screenKey] = { ...current, page: undefined, saved };
    writeStore(all);
  }

  return Object.freeze({
    get state() {
      return current;
    },
    saved() {
      return saved.slice();
    },
    update(patch, { persist: shouldPersist = true } = {}) {
      current = { ...current, ...patch };
      if (shouldPersist) persist();
      return current;
    },
    save(name, { pinned = false } = {}) {
      const view = {
        id: `view_${Date.now().toString(36)}`,
        name: String(name || "Untitled view").slice(0, 60),
        pinned: Boolean(pinned),
        columns: current.columns,
        sort: current.sort,
        filters: current.filters,
        groupBy: current.groupBy,
        createdAt: new Date().toISOString(),
      };
      saved = [view, ...saved.filter((v) => v.name !== view.name)].slice(0, 40);
      persist();
      return view;
    },
    apply(view) {
      current = {
        ...current,
        columns: view.columns || null,
        sort: view.sort || null,
        filters: Array.isArray(view.filters) ? view.filters : [],
        groupBy: view.groupBy || "",
        page: 0,
      };
      persist();
      return current;
    },
    remove(viewId) {
      saved = saved.filter((v) => v.id !== viewId);
      persist();
    },
    rename(viewId, name) {
      saved = saved.map((v) => (v.id === viewId ? { ...v, name: String(name).slice(0, 60) } : v));
      persist();
    },
  });
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

/**
 * The filter bar: a quick search, one chip per active filter, an add button,
 * and the saved-view control. The chip is the interface — a reader can always
 * see exactly why the table is showing what it is showing, and remove one
 * condition without opening a dialog.
 */
export function filterBar({
  fields,
  filters,
  onChange,
  savedViews = [],
  onSaveView = null,
  onApplyView = null,
  onRemoveView = null,
  search = "",
  onSearch = null,
  extra = [],
  resultCount = null,
  totalCount = null,
}) {
  const bar = el("div", "ads-filterbar");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Table filters");

  if (onSearch) {
    const searchWrap = el("label", "ads-search");
    searchWrap.append(svg(ICONS.search, { size: 13, width: 1.8 }));
    const input = el("input", "ads-search-input");
    input.type = "search";
    input.placeholder = "Search names, ids";
    input.value = search;
    input.setAttribute("aria-label", "Search this table");
    let timer = null;
    input.addEventListener("input", () => {
      // Debounced because the table re-renders; 120ms is below the threshold
      // where a typist notices, and above the rate of a fast keyboard.
      clearTimeout(timer);
      timer = setTimeout(() => onSearch(input.value), 120);
    });
    searchWrap.append(input);
    bar.append(searchWrap);
  }

  const chipRow = el("div", "ads-filter-chips");

  function filterValueControl(def, op, value, commit) {
    const operator = OPERATORS.find((o) => o.id === op);
    if (operator?.arity === 0) return null;
    if (def.options) {
      const options = typeof def.options === "function" ? def.options() : def.options;
      if (operator?.arity === "many") {
        const list = Array.isArray(value) ? value : [];
        const menu = popover({
          trigger: button(list.length ? `${list.length} selected` : "Choose values", { variant: "quiet" }),
          label: `Values for ${def.label}`,
          width: 240,
          render(panel) {
            const group = menuGroup(def.label);
            for (const option of options) {
              group.append(
                menuItem(option.label ?? String(option), {
                  checked: list.map(String).includes(String(option.value ?? option)),
                  onClick: () => {
                    const v = String(option.value ?? option);
                    const next = list.map(String).includes(v) ? list.filter((x) => x !== v) : [...list, v];
                    commit(next);
                  },
                }),
              );
            }
            panel.append(group);
          },
        });
        return menu;
      }
      const select = el("select", "ads-select");
      select.setAttribute("aria-label", `${def.label} value`);
      select.append(el("option", "", "Choose…"));
      for (const option of options) {
        const opt = el("option", "", option.label ?? String(option));
        opt.value = String(option.value ?? option);
        if (String(option.value ?? option) === String(value ?? "")) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener("change", () => commit(select.value));
      return select;
    }
    const input = el("input", "ads-input");
    input.type = def.kind === "number" ? "number" : "text";
    input.value = value ?? "";
    input.setAttribute("aria-label", `${def.label} value`);
    input.placeholder = def.kind === "number" ? "0" : "Value";
    input.addEventListener("change", () => commit(def.kind === "number" ? num(input.value) : input.value));
    return input;
  }

  function addFilterEditor(panel, close) {
    const grouped = new Map();
    for (const def of fields) {
      const key = def.group || "";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(def);
    }
    for (const [groupName, defs] of grouped) {
      const group = menuGroup(groupName);
      for (const def of defs) {
        group.append(
          menuItem(def.label, {
            hint: def.hint,
            onClick: () => {
              const operator = OPERATORS.find((o) => o.kinds.includes(def.kind) && o.arity !== "many") || OPERATORS[0];
              onChange([...filters, { field: def.id, op: operator.id, value: "" }]);
              close();
            },
          }),
        );
      }
      panel.append(group);
    }
  }

  for (const f of filters) {
    const def = fields.find((x) => x.id === f.field);
    if (!def) continue;
    const operator = OPERATORS.find((o) => o.id === f.op);
    const node = el("div", "ads-filter-chip");
    node.append(el("span", "ads-filter-field", def.label));
    const opSelect = el("select", "ads-filter-op");
    opSelect.setAttribute("aria-label", `${def.label} operator`);
    for (const o of OPERATORS.filter((x) => x.kinds.includes(def.kind))) {
      const opt = el("option", "", o.label);
      opt.value = o.id;
      if (o.id === f.op) opt.selected = true;
      opSelect.append(opt);
    }
    opSelect.addEventListener("change", () => {
      const next = OPERATORS.find((o) => o.id === opSelect.value);
      onChange(filters.map((x) => (x === f ? { ...x, op: next.id, value: next.arity === "many" ? [] : next.arity === 0 ? true : "" } : x)));
    });
    node.append(opSelect);
    const control = filterValueControl(def, f.op, f.value, (value) => onChange(filters.map((x) => (x === f ? { ...x, value } : x))));
    if (control) node.append(control);
    const remove = button("", { icon: ICONS.close, variant: "quiet", ariaLabel: `Remove ${def.label} filter`, onClick: () => onChange(filters.filter((x) => x !== f)) });
    node.append(remove);
    chipRow.append(node);
  }

  const addBtn = button(filters.length ? "Add filter" : "Filter", { icon: ICONS.filter, variant: filters.length ? "ghost" : "ghost" });
  addBtn.setAttribute("aria-expanded", "false");
  chipRow.append(
    popover({
      trigger: addBtn,
      label: "Add a filter",
      width: 280,
      render: addFilterEditor,
    }),
  );

  if (filters.length) {
    chipRow.append(button("Clear", { variant: "quiet", onClick: () => onChange([]), title: "Remove every filter" }));
  }
  bar.append(chipRow);

  const tail = el("div", "ads-filter-tail");
  if (resultCount !== null && totalCount !== null && (filters.length || search)) {
    tail.append(el("span", "ads-filter-count", `${resultCount.toLocaleString("en-GB")} of ${totalCount.toLocaleString("en-GB")}`));
  }
  for (const node of extra) tail.append(node);

  const viewsBtn = button("Views", { icon: ICONS.layers, title: "Saved filters and columns" });
  viewsBtn.setAttribute("aria-expanded", "false");
  tail.append(
    popover({
      trigger: viewsBtn,
      label: "Saved views",
      align: "end",
      width: 280,
      render(panel, close) {
        if (savedViews.length) {
          const group = menuGroup("Saved");
          for (const view of savedViews) {
            const item = menuItem(view.name, {
              hint: `${(view.filters || []).length} filter${(view.filters || []).length === 1 ? "" : "s"}${view.columns ? `, ${view.columns.length} columns` : ""}`,
              onClick: () => {
                onApplyView?.(view);
                close();
              },
            });
            const row = el("div", "ads-menu-row");
            row.append(item);
            row.append(
              button("", {
                icon: ICONS.close,
                variant: "quiet",
                ariaLabel: `Delete view ${view.name}`,
                onClick: (event) => {
                  event.stopPropagation();
                  onRemoveView?.(view);
                },
              }),
            );
            group.append(row);
          }
          panel.append(group);
        } else {
          panel.append(el("p", "ads-menu-empty", "No saved views yet. Set up the columns and filters you want, then save them here."));
        }
        if (onSaveView) {
          const group = menuGroup("Save the current view");
          const input = el("input", "ads-input");
          input.placeholder = "Name this view";
          input.setAttribute("aria-label", "Name for the saved view");
          const save = button("Save view", {
            variant: "ink",
            onClick: () => {
              const name = input.value.trim();
              if (!name) {
                input.focus();
                return;
              }
              onSaveView(name);
              close();
            },
          });
          const row = el("div", "ads-menu-save");
          row.append(input, save);
          group.append(row);
          panel.append(group);
        }
      },
    }),
  );
  bar.append(tail);
  return bar;
}

/**
 * The bulk-action bar. Appears only when rows are selected, states the exact
 * count, and offers only actions that apply to the selection. It never hides
 * what is selected behind a count alone.
 */
export function bulkBar({ count, noun = "row", actions = [], onClear = null, note = "" }) {
  const bar = el("div", "ads-bulkbar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Bulk actions");
  const summary = el("div", "ads-bulk-summary");
  // "batch" must not become "batchs". Only append the bare s when the noun
  // actually pluralises that way.
  const plural = count === 1 || /(s|x|z|ch|sh)$/.test(noun) ? noun : `${noun}s`;
  summary.append(el("strong", "", `${count.toLocaleString("en-GB")} ${plural} selected`));
  if (note) summary.append(el("span", "ads-bulk-note", note));
  bar.append(summary);
  const group = el("div", "ads-bulk-actions");
  for (const action of actions) group.append(action);
  group.append(button("Clear selection", { variant: "quiet", onClick: onClear }));
  bar.append(group);
  return bar;
}

/** The "selection exceeds what is visible" warning. Bulk edits that silently
 *  apply to filtered-out rows are how people lose money. */
export function hiddenSelectionNotice(hiddenCount, onKeepVisible) {
  if (!hiddenCount) return null;
  const note = el("div", "ads-banner");
  note.dataset.tone = "warn";
  note.setAttribute("role", "status");
  note.append(svg(ICONS.alert, { size: 13, width: 1.8 }));
  note.append(el("span", "", `${hiddenCount} selected row${hiddenCount === 1 ? " is" : "s are"} hidden by the current filters.`));
  note.append(button("Keep only visible", { onClick: onKeepVisible }));
  return note;
}

