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

import { el, clear, button, chip, popover, menuItem, menuGroup, svg, ICONS } from "./ads-ui.js";
import { EVIDENCE_FLOOR, formatInt, formatMoney, num } from "./ads-contracts.js";

const STORAGE_KEY = "frank.ads.views.v1";

export const OPERATORS = Object.freeze([
  Object.freeze({ id: "is", label: "is", kinds: ["text", "enum"], arity: 1 }),
  Object.freeze({ id: "is_not", label: "is not", kinds: ["text", "enum"], arity: 1 }),
  Object.freeze({ id: "contains", label: "contains", kinds: ["text"], arity: 1 }),
  Object.freeze({ id: "not_contains", label: "does not contain", kinds: ["text"], arity: 1 }),
  Object.freeze({ id: "in", label: "is any of", kinds: ["enum"], arity: "many" }),
  Object.freeze({ id: "gt", label: "is more than", kinds: ["number"], arity: 1 }),
  // "at least" and "at most" exist because a floor is an inclusive threshold:
  // "more than 24 results" is the same set as "at least 25" only for as long as
  // nobody changes the floor, and a built-in view has to say what it means.
  Object.freeze({ id: "gte", label: "is at least", kinds: ["number"], arity: 1 }),
  Object.freeze({ id: "lte", label: "is at most", kinds: ["number"], arity: 1 }),
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

  // A threshold comparison never matches an unknown value: a row whose figure
  // this read did not carry is not "at least", and it is not "below" either. It
  // is unknown, and it stays out of both sides of a floor.
  if (op === "gte" || op === "lte") {
    const left = num(raw);
    const right = num(target);
    if (left === null || right === null) return false;
    return op === "gte" ? left >= right : left <= right;
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
// Built-in views
// ---------------------------------------------------------------------------

/**
 * A built-in view is a named filter, sort and column set that is **defined in
 * this file** and always exists. It is not stored, so it cannot be renamed,
 * edited or deleted, and it is never confused with the operator's own views:
 * every one carries `kind: "built-in"` and an id under the `builtin.` prefix,
 * while a saved view's id is always allocated as `view_…`.
 *
 * Each one is a claim, so each one states its own condition in `hint` — the
 * menu shows that sentence under the name, and the name never claims more than
 * the filter does. A built-in that filtered on a field a screen does not have
 * is refused rather than applied half-way (see `apply` and `skipped`).
 *
 * Built-ins are keyed by the store's screen key, which the workspace allocates
 * as `screen.<id>`.
 */
function builtIn(id, name, { hint, filters, sort = null, columns = null }) {
  return Object.freeze({
    id: `builtin.${id}`,
    name,
    hint,
    kind: "built-in",
    filters: Object.freeze((filters || []).map((f) => Object.freeze({ ...f }))),
    sort: sort ? Object.freeze({ ...sort }) : null,
    columns: columns ? Object.freeze(columns.slice()) : null,
  });
}

const FLOOR = EVIDENCE_FLOOR.results;
// The columns a campaigns built-in may ask for exist at all three levels, so
// applying one at another level restores what it can instead of blanking a
// column that level has never had.
const CAMPAIGN_VIEW_COLUMNS = ["name", "status", "spend", "results", "costPerResult", "qualifiedLeads", "spendTrend", "issues"];

export const BUILT_IN_VIEWS = Object.freeze({
  "screen.campaigns": Object.freeze([
    builtIn("campaigns.needs-attention", "Needs attention", {
      hint: "Rows the sync has raised a flag against, most spend first.",
      filters: [{ field: "hasIssues", op: "is_true", value: true }],
      sort: { id: "spend", dir: "desc" },
      columns: CAMPAIGN_VIEW_COLUMNS,
    }),
    builtIn("campaigns.spending-no-outcome", "Spending with no observed outcome", {
      hint: `Spend above zero and this read records no CRM-qualified lead. A row whose leads are unknown is not in this view.`,
      filters: [
        { field: "spend", op: "gt", value: 0 },
        { field: "qualifiedLeads", op: "lt", value: 1 },
      ],
      sort: { id: "spend", dir: "desc" },
      columns: CAMPAIGN_VIEW_COLUMNS,
    }),
    builtIn("campaigns.below-evidence-floor", "Below the evidence floor", {
      hint: `Fewer than ${FLOOR} attributed results in this window: too little to rank.`,
      filters: [{ field: "insufficient", op: "is_true", value: true }],
      sort: { id: "spend", dir: "desc" },
      columns: CAMPAIGN_VIEW_COLUMNS,
    }),
  ]),
  "screen.creative": Object.freeze([
    builtIn("creative.winners", "Winners", {
      hint: `At or above the ${FLOOR}-result evidence floor, ordered by cost per result. Passing a floor is a bar for reading, not a verdict: two rows whose intervals overlap are still a tie.`,
      filters: [{ field: "results", op: "gte", value: FLOOR }],
      sort: { id: "costPerResult", dir: "asc" },
      columns: ["name", "spend", "results", "costPerResult", "qualifiedLeads", "costPerQualifiedLead", "ctr"],
    }),
    builtIn("creative.awaiting-evidence", "Awaiting evidence", {
      hint: `Fewer than ${FLOOR} attributed results in this window, most spend first. Nothing here can be ranked yet.`,
      filters: [{ field: "results", op: "lte", value: FLOOR - 1 }],
      sort: { id: "spend", dir: "desc" },
    }),
    builtIn("creative.near-duplicates", "Near-duplicates", {
      hint: "Creatives that share a concept, hook and format, or that somebody marked as a near-duplicate. A question to answer, not a verdict.",
      filters: [{ field: "nearDuplicate", op: "is_true", value: true }],
    }),
  ]),
  "screen.blogs": Object.freeze([
    builtIn("blogs.promoted", "Promoted", {
      hint: "Articles an ad in this account points at.",
      filters: [{ field: "promoted", op: "is_true", value: true }],
    }),
    builtIn("blogs.converting", "Converting", {
      hint: "This read records at least one CRM-qualified lead against the article. Observed, not Meta-attributed.",
      filters: [{ field: "qualifiedLeads", op: "gte", value: 1 }],
      sort: { id: "qualifiedLeads", dir: "desc" },
    }),
    builtIn("blogs.no-promotion", "No promotion", {
      hint: "Articles no ad in this account points at. Candidates for a launch, not a judgement on them.",
      filters: [{ field: "promoted", op: "is_false", value: true }],
    }),
  ]),
  "screen.queue": Object.freeze([
    builtIn("queue.awaiting-confirmation", "Awaiting confirmation", {
      hint: "A write was acknowledged and delivery is unconfirmed. Not proof the ad is serving.",
      filters: [{ field: "awaiting", op: "is_true", value: true }],
      sort: { id: "updated", dir: "desc" },
      columns: ["name", "state", "ads", "attempts", "updated"],
    }),
    builtIn("queue.needs-reconcile", "Needs reconcile", {
      hint: "A write was accepted and delivery was never confirmed. Reconcile before retrying, so a retry cannot create a duplicate ad.",
      filters: [{ field: "needsReconcile", op: "is_true", value: true }],
      sort: { id: "updated", dir: "desc" },
      columns: ["name", "state", "attempts", "lastError", "updated"],
    }),
    builtIn("queue.proof-of-delivery", "Proof of delivery", {
      hint: "Only Delivering — and Paused, which was served before it stopped — prove the provider served the ad.",
      filters: [{ field: "proven", op: "is_true", value: true }],
      sort: { id: "updated", dir: "desc" },
      columns: ["name", "state", "ads", "updated"],
    }),
    builtIn("queue.failed-rows", "Has failed rows", {
      hint: "Batches carrying at least one failed ad. A failure stays on its own row.",
      filters: [{ field: "hasFailures", op: "is_true", value: true }],
      sort: { id: "updated", dir: "desc" },
      columns: ["name", "state", "ads", "attempts", "lastError", "updated"],
    }),
  ]),
});

export const BUILT_IN_VIEW_PREFIX = "builtin.";

export function isBuiltInViewId(id) {
  return String(id || "").startsWith(BUILT_IN_VIEW_PREFIX);
}

export function builtInViewsFor(screenKey) {
  const list = BUILT_IN_VIEWS[String(screenKey || "")];
  return Array.isArray(list) ? list.slice() : [];
}

export function findBuiltInView(screenKey, id) {
  const wanted = String(id || "");
  if (!wanted) return null;
  return builtInViewsFor(screenKey).find((view) => view.id === wanted) || null;
}

// ---------------------------------------------------------------------------
// URL reflection
// ---------------------------------------------------------------------------

/**
 * The `?view=` parameter. A screen links to a view; the link is the view.
 *
 * Unknown ids are ignored rather than treated as an error: a link written
 * before a built-in was renamed, or a view belonging to another screen, should
 * open the screen with its stored configuration, not a failure page.
 */
export function readViewParam(win = globalThis) {
  try {
    return String(new URLSearchParams(win?.location?.search || "").get("view") || "");
  } catch {
    return "";
  }
}

/**
 * Write one view id into the URL, keeping every other parameter (`screen`,
 * `preview`) exactly as it was. `replaceState` rather than `pushState`: a view
 * change is not a navigation, and filling Back with forty view applications
 * would make Back leave the section.
 */
export function reflectViewParam(id, { win = globalThis } = {}) {
  try {
    const url = new URL(win.location.href);
    if (id) url.searchParams.set("view", String(id));
    else url.searchParams.delete("view");
    win.history?.replaceState?.(win.history.state, "", url.toString());
    return true;
  } catch {
    // A browser that refuses the rewrite still shows the applied view.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/**
 * The account currency, or `""` when the context has not answered.
 *
 * Deliberately not `|| "GBP"`: a figure with an invented unit is a wrong
 * number, and a screen that assumes sterling for a euro account is worse than
 * one that says it does not know. A value that is not an ISO 4217 code is
 * treated as unknown rather than passed to Intl.
 */
export function accountCurrency(context) {
  const code = String(context?.account?.currency || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

/** The sentence every screen uses when it has no currency to name. */
export const CURRENCY_UNKNOWN_NOTE = "The account currency is not connected in this read, so money figures carry their number and no unit.";

/**
 * A money figure with its unit, or a figure that admits the unit is unknown.
 * A missing value stays `null` so the caller can render its own dash — never 0.
 */
export function formatAccountMoney(value, currency, { minor = false } = {}) {
  const n = num(value);
  if (n === null) return null;
  const amount = minor ? n / 100 : n;
  const code = accountCurrency({ account: { currency } });
  if (code) return formatMoney(amount, code);
  return `${amount.toFixed(2)} (currency unknown)`;
}

/** A signed money delta with the same rule about its unit. */
export function formatAccountMoneyDelta(value, currency, { minor = false } = {}) {
  const n = num(value);
  if (n === null) return null;
  const amount = minor ? n / 100 : n;
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  const code = accountCurrency({ account: { currency } });
  return `${sign}${code ? formatMoney(Math.abs(amount), code) : `${Math.abs(amount).toFixed(2)} (currency unknown)`}`;
}

/**
 * The arithmetic of a before/after review, in one place.
 *
 * Three rules live here, and both screens that stage a bulk change read them
 * from the same function so they cannot drift apart:
 *
 *   1. a row whose value this read did not carry is **unknown**, and unknown is
 *      never counted as 0;
 *   2. the total covers the known rows only, and the caller states how many were
 *      excluded;
 *   3. a row whose value does not actually change is still listed, and says so.
 */
export function summariseChangeEntries(kind, entries = []) {
  const isPause = kind === "pause";
  const list = entries.map((entry) => {
    const before = isPause ? String(entry.before ?? "") : num(entry.before);
    const after = isPause ? String(entry.after ?? "paused") : num(entry.after);
    const known = isPause ? before !== "" : before !== null && after !== null;
    return { ...entry, before, after, known, changed: known && before !== after };
  });
  const known = list.filter((entry) => entry.known);
  const unknown = list.filter((entry) => !entry.known);
  const total = isPause
    ? known.filter((entry) => entry.changed).length
    : known.reduce((sum, entry) => sum + (entry.after - entry.before), 0);
  return Object.freeze({
    entries: list,
    known: Object.freeze(known),
    unknown: Object.freeze(unknown),
    total,
    changed: list.filter((entry) => entry.changed).length,
    beforeTotal: isPause || !known.length ? null : known.reduce((sum, entry) => sum + entry.before, 0),
    afterTotal: isPause || !known.length ? null : known.reduce((sum, entry) => sum + entry.after, 0),
  });
}

/**
 * What an applied view did, in the operator's words. A screen that silently
 * opens filtered — or silently ignores half a view — is a screen somebody will
 * misread, so the sentence names the view, its kind and anything that could not
 * be applied here.
 */
export function appliedViewSentence(store, view) {
  const kind = view?.kind === "built-in" ? "Built-in view" : "Saved view";
  const skipped = store?.skipped?.fields || [];
  if (skipped.length) {
    return `${kind} "${view.name}" applied, except ${skipped.length} condition${skipped.length === 1 ? "" : "s"} (${skipped.join(", ")}) this screen has no field for. Nothing was hidden by them.`;
  }
  return `${kind} "${view.name}" applied: its columns, sort and filters are the ones on screen now. The address bar carries ?view=${view.id}, so this screen can be linked to.`;
}

// ---------------------------------------------------------------------------
// View store
// ---------------------------------------------------------------------------

function readStore(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store, storage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A browser with storage disabled still gets a working, unsaved session.
  }
}

/** A saved view that survived storage. Anything without an id this module can
 *  apply is dropped rather than listed as a view that does nothing. */
function normalizeSaved(list) {
  return (Array.isArray(list) ? list : [])
    .filter((view) => view && typeof view === "object" && String(view.id || "") && String(view.name || ""))
    .map((view) => ({
      ...view,
      id: String(view.id),
      name: String(view.name).slice(0, 60),
      kind: "saved",
      filters: Array.isArray(view.filters) ? view.filters : [],
      columns: Array.isArray(view.columns) ? view.columns : null,
      sort: view.sort && typeof view.sort === "object" ? view.sort : null,
    }));
}

/**
 * Per-screen view configuration: columns, sort, filters and named saved views.
 * `screenKey` scopes everything, so the campaign table and the creative table
 * cannot leak settings into each other.
 *
 * Three things live here rather than in a screen, because every screen must
 * agree on them:
 *
 *   * a **built-in view** is code, not storage, and never appears in `saved()`;
 *   * applying a view **restores columns, sort and filters together** and says
 *     which view is showing, so a screen can never restore half a view;
 *   * the applied view is **reflected in `?view=<id>`**, and a link carrying one
 *     is applied when the screen opens.
 */
export function createViewStore(screenKey, { storage = globalThis.localStorage, win = globalThis } = {}) {
  const store = readStore(storage);
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
  let saved = normalizeSaved(scope.saved);
  // The view the current configuration came from, if any, and whether the
  // operator has changed something since. Both are needed: a chip that says
  // "Needs attention" after the filters were edited is a lie, and a chip that
  // disappears silently reads as a bug.
  let activeViewId = "";
  let viewModified = false;
  let skipped = Object.freeze({ field: "", fields: Object.freeze([]) });
  let urlView = Object.freeze({ id: readViewParam(win), applied: false });

  function persist() {
    const all = readStore(storage);
    all[screenKey] = { ...current, page: undefined, saved };
    writeStore(all, storage);
  }

  function resolve(id) {
    const wanted = String(id || "");
    if (!wanted) return null;
    return saved.find((view) => view.id === wanted) || findBuiltInView(screenKey, wanted) || null;
  }

  function restore(view, { fields = null } = {}) {
    const dropped = [];
    const kept = [];
    for (const filter of Array.isArray(view.filters) ? view.filters : []) {
      // A condition whose field this screen does not have would silently filter
      // everything out (an unknown field matches nothing), so it is dropped and
      // counted instead. Silence there would look like an empty result set.
      if (fields && !fields.some((def) => def.id === filter.field)) dropped.push(String(filter.field));
      else kept.push({ ...filter });
    }
    // A saved view records exactly what was on screen when it was saved, so a
    // missing column list or sort means "default" and is restored as such. A
    // built-in that does not name columns or a sort has not asked for one, so
    // the operator's own choice is left alone rather than silently reset.
    const builtIn = view.kind === "built-in";
    const columns = Array.isArray(view.columns) && view.columns.length ? view.columns.slice() : builtIn ? current.columns : null;
    const sort = view.sort ? { ...view.sort } : builtIn ? current.sort : null;
    current = {
      ...current,
      columns,
      sort,
      filters: kept,
      groupBy: view.groupBy || (builtIn ? current.groupBy : ""),
      page: 0,
    };
    activeViewId = view.id;
    viewModified = false;
    skipped = Object.freeze({ field: view.name, fields: Object.freeze(dropped) });
    return dropped;
  }

  // A link that carries a view is the operator asking for that view. An
  // unresolvable id is ignored: the screen opens with its stored configuration.
  if (urlView.id) {
    const found = resolve(urlView.id);
    if (found) {
      restore(found);
      urlView = Object.freeze({ id: urlView.id, applied: true, name: found.name, kind: found.kind });
    }
  }

  return Object.freeze({
    get state() {
      return current;
    },
    saved() {
      return saved.slice();
    },
    /** The built-in views this screen always has. Code, never storage. */
    builtIn() {
      return builtInViewsFor(screenKey);
    },
    /** The view the current configuration came from, for the bar's chip. */
    activeView() {
      const view = resolve(activeViewId);
      if (!view) return null;
      return Object.freeze({ id: view.id, name: view.name, kind: view.kind, modified: viewModified });
    },
    /** The `?view=` id this screen opened with, and whether it was applied. */
    get urlView() {
      return urlView;
    },
    /** Conditions a view asked for that this screen cannot evaluate. */
    get skipped() {
      return skipped;
    },
    /**
     * Patch the stored configuration.
     *
     * `marksModified: false` exists for the one caller that writes the applied
     * view's own configuration straight back — a screen that keeps its own copy
     * of the view state must be able to sync it without the bar claiming the
     * operator edited a view they only just applied.
     */
    update(patch, { persist: shouldPersist = true, marksModified = true } = {}) {
      current = { ...current, ...patch };
      // Editing the configuration by hand means the named view is no longer what
      // is on screen. The id is kept so the bar can say which one was modified.
      if (marksModified && ["filters", "columns", "sort", "groupBy"].some((key) => key in patch)) viewModified = true;
      if (shouldPersist) persist();
      return current;
    },
    /**
     * Create a view from the current configuration.
     *
     * Identities are allocated, never derived from the name: two views may
     * share a name (an operator's "Winners" beside the built-in one), and a
     * rename must never merge or split a view.
     */
    save(name, { pinned = false } = {}) {
      const view = {
        id: `view_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: String(name || "Untitled view").slice(0, 60),
        kind: "saved",
        pinned: Boolean(pinned),
        columns: current.columns,
        sort: current.sort,
        filters: current.filters,
        groupBy: current.groupBy,
        createdAt: new Date().toISOString(),
      };
      saved = [view, ...saved].slice(0, 40);
      activeViewId = view.id;
      viewModified = false;
      persist();
      reflectViewParam(view.id, { win });
      return view;
    },
    /** Save the current columns, sort and filters over an existing view. */
    updateSaved(viewId) {
      const existing = saved.find((view) => view.id === String(viewId));
      if (!existing) return null;
      const next = { ...existing, columns: current.columns, sort: current.sort, filters: current.filters, groupBy: current.groupBy, updatedAt: new Date().toISOString() };
      saved = saved.map((view) => (view.id === next.id ? next : view));
      activeViewId = next.id;
      viewModified = false;
      persist();
      reflectViewParam(next.id, { win });
      return next;
    },
    /** Apply a view object or its id, restoring columns, sort and filters. */
    apply(viewOrId, { fields = null, reflect = true } = {}) {
      const view = typeof viewOrId === "string" ? resolve(viewOrId) : viewOrId;
      if (!view) return null;
      restore(view, { fields });
      persist();
      if (reflect) reflectViewParam(view.id, { win });
      return current;
    },
    remove(viewId) {
      const wanted = String(viewId);
      saved = saved.filter((view) => view.id !== wanted);
      if (activeViewId === wanted) {
        activeViewId = "";
        viewModified = false;
        reflectViewParam("", { win });
      }
      persist();
    },
    rename(viewId, name) {
      const wanted = String(viewId);
      saved = saved.map((view) => (view.id === wanted ? { ...view, name: String(name).slice(0, 60) } : view));
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
  builtInViews = [],
  activeView = null,
  onSaveView = null,
  onApplyView = null,
  onUpdateView = null,
  onRenameView = null,
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

  // Which view the configuration on screen came from. Built-in and saved views
  // are named differently here precisely so the two are never confused: one is
  // shipped in the app, the other was made by this operator in this browser.
  if (activeView) {
    const marker = el("span", "ads-view-active");
    marker.dataset.kind = activeView.kind === "built-in" ? "builtin" : "saved";
    marker.append(
      el("span", "ads-view-tag", activeView.kind === "built-in" ? "Built-in" : "Saved"),
      el("span", "ads-view-active-name", activeView.name),
    );
    if (activeView.modified) {
      const edited = el("span", "ads-view-modified", "modified");
      edited.title = "The filters, columns or sort have been changed since this view was applied, so it is no longer exactly what the view describes.";
      marker.append(edited);
    }
    tail.append(marker);
  }

  const viewsBtn = button("Views", { icon: ICONS.layers, title: "Built-in views, saved views, filters and columns" });
  viewsBtn.setAttribute("aria-expanded", "false");
  tail.append(
    popover({
      trigger: viewsBtn,
      label: "Views",
      align: "end",
      width: 320,
      render(panel, close) {
        if (builtInViews.length) {
          const group = menuGroup("Built-in views");
          group.append(
            el("p", "ads-menu-empty", "Defined in the app, not saved in this browser. They always exist and cannot be edited or deleted; save one as your own view to change it."),
          );
          for (const view of builtInViews) {
            const item = menuItem(view.name, {
              hint: view.hint,
              checked: activeView?.id === view.id,
              onClick: () => {
                onApplyView?.(view);
                close();
              },
            });
            const row = el("div", "ads-view-row");
            row.append(item, el("span", "ads-view-tag", "Built-in"));
            group.append(row);
          }
          panel.append(group);
        }

        const group = menuGroup("Your saved views");
        if (savedViews.length) {
          for (const view of savedViews) {
            const item = menuItem(view.name, {
              hint: `${(view.filters || []).length} filter${(view.filters || []).length === 1 ? "" : "s"}${view.columns ? `, ${view.columns.length} columns` : ""}`,
              checked: activeView?.id === view.id,
              onClick: () => {
                onApplyView?.(view);
                close();
              },
            });
            const row = el("div", "ads-view-row");
            row.append(item);
            // Managing a view happens in this same popover — a name field and
            // three buttons, opened in place. A second modal system for four
            // controls would be a new thing to learn for no new capability.
            const manage = button("Manage", {
              variant: "quiet",
              ariaLabel: `Manage the view ${view.name}`,
              title: "Rename this view, save the current columns and filters over it, or delete it.",
            });
            const editorId = `view-editor-${String(view.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
            manage.setAttribute("aria-expanded", "false");
            manage.setAttribute("aria-controls", editorId);
            const editor = el("div", "ads-view-editor");
            editor.id = editorId;
            editor.hidden = true;
            manage.addEventListener("click", () => {
              const opening = editor.hidden;
              editor.hidden = !opening;
              manage.setAttribute("aria-expanded", opening ? "true" : "false");
              if (opening) {
                clear(editor);
                editor.append(viewEditor(view, close));
                editor.querySelector("input")?.focus();
                editor.querySelector("input")?.select?.();
              }
            });
            row.append(manage);
            group.append(row, editor);
          }
        } else {
          group.append(el("p", "ads-menu-empty", "No saved views yet. Set up the columns and filters you want, then save them here."));
        }
        panel.append(group);

        if (onSaveView) {
          const saveGroup = menuGroup("Save the current view as");
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
          saveGroup.append(row);
          panel.append(saveGroup);
        }
      },
    }),
  );
  bar.append(tail);

  /**
   * The inline editor for one saved view: rename it, save the current columns,
   * sort and filters over it, or delete it. Deleting asks a second time, in
   * place, because a saved view is work somebody did and a single click beside
   * a menu item is how work disappears by accident.
   */
  function viewEditor(view, close) {
    const box = el("div", "ads-view-editor-body");
    const inputId = `view-name-${String(view.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const label = el("label", "ads-field-label", "View name");
    label.setAttribute("for", inputId);
    const input = el("input", "ads-input");
    input.id = inputId;
    input.value = view.name;
    input.setAttribute("aria-label", `Name for the saved view ${view.name}`);
    box.append(label, input);

    const actions = el("div", "ads-view-editor-actions");
    if (onRenameView) {
      actions.append(
        button("Save name", {
          variant: "ink",
          onClick: () => {
            const name = input.value.trim();
            if (!name) {
              input.focus();
              return;
            }
            onRenameView(view, name);
            close();
          },
        }),
      );
    }
    if (onUpdateView) {
      actions.append(
        button("Save changes to this view", {
          title: "Replaces this view's columns, sort and filters with what is on screen now.",
          onClick: () => {
            onUpdateView(view);
            close();
          },
        }),
      );
    }
    box.append(actions);

    if (onRemoveView) {
      const confirm = el("div", "ads-view-confirm");
      const ask = button("Delete this view", {
        variant: "quiet",
        onClick: () => {
          confirm.hidden = false;
          ask.hidden = true;
          confirm.querySelector("button")?.focus();
        },
      });
      const row = el("div", "ads-view-confirm-actions");
      row.hidden = true;
      row.append(
        el("span", "", `Delete “${view.name}”?`),
        button("Delete", {
          variant: "ink",
          onClick: () => {
            onRemoveView(view);
            close();
          },
        }),
        button("Keep", {
          variant: "quiet",
          onClick: () => {
            row.hidden = true;
            ask.hidden = false;
            ask.focus();
          },
        }),
      );
      confirm.append(ask, row);
      box.append(confirm);
    }
    return box;
  }

  return bar;
}

/**
 * The bulk-action bar. Appears only when rows are selected, states the exact
 * count, and offers only actions that apply to the selection. It never hides
 * what is selected behind a count alone.
 */
export function bulkBar({
  count,
  noun = "row",
  actions = [],
  onClear = null,
  note = "",
  matchingCount = 0,
  pageCount = 0,
  hiddenCount = 0,
  onSelectMatching = null,
  onSelectPage = null,
}) {
  const bar = el("div", "ads-bulkbar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Bulk actions");
  const summary = el("div", "ads-bulk-summary");
  // "batch" must not become "batchs". Only append the bare s when the noun
  // actually pluralises that way.
  const plural = count === 1 || /(s|x|z|ch|sh)$/.test(noun) ? noun : `${noun}s`;
  const counted = el("strong", "ads-bulk-count", `${count.toLocaleString("en-GB")} ${plural} selected`);
  // The count is never abbreviated, and never the only thing that says what the
  // scope is: "1.2k selected" is how an operator approves a bulk change to rows
  // they never intended to touch.
  counted.title = `${count.toLocaleString("en-GB")} ${plural} in this selection. The next bulk action touches exactly these.`;
  summary.append(counted);
  if (matchingCount > count) {
    summary.append(el("span", "ads-bulk-note", `of ${formatInt(matchingCount)} the current filters match`));
  }
  // Say plainly how many of the selected rows are not on this page. A count
  // that silently includes off-screen rows is how a bulk edit surprises its
  // operator after the fact.
  if (hiddenCount > 0) {
    summary.append(el("span", "ads-bulk-note", `${formatInt(hiddenCount)} not on this page`));
  }
  if (note) summary.append(el("span", "ads-bulk-note", note));
  bar.append(summary);

  // Scope controls. These two are deliberately separate buttons with different
  // names, because "this page" and "every matching row" are different
  // decisions. Neither is the default: the operator has to choose one.
  const scope = el("div", "ads-bulk-scope");
  if (onSelectMatching && matchingCount > count) {
    scope.append(
      button(`Select all ${formatInt(matchingCount)} matching`, {
        title: `Selects every row the current filters match, including the ${formatInt(matchingCount - count)} not shown on this page.`,
        onClick: onSelectMatching,
      }),
    );
  }
  if (onSelectPage && hiddenCount > 0) {
    scope.append(
      button(`Keep only this page (${formatInt(pageCount)})`, {
        title: "Drops the selected rows that are not on this page, so the next bulk action touches only what you can see.",
        onClick: onSelectPage,
      }),
    );
  }

  const group = el("div", "ads-bulk-actions");
  for (const action of actions) group.append(action);
  group.append(button("Clear selection", { variant: "quiet", onClick: onClear }));
  bar.append(scope, group);
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

