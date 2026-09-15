// Publishing queue screen.
//
// Two rules shape everything below, and both come from the module guide.
//
// 1. A write acknowledgement is not delivery. `uploading`, `submitted` and
//    `in_review` mean the provider took a write; none of them means an ad is
//    being served. Only `delivering` — and `paused`, which was served before it
//    was stopped — prove delivery, and each batch carries its place in the flow
//    so the difference is visible rather than explained.
// 2. A failure stays attached to its row. A batch is a launch, not a unit of
//    retry: one rejected asset never drags the other ads back through the
//    provider, and an uncertain write is reconciled before it is retried so a
//    duplicate ad cannot be created.
//
// The screen is a reader. The queue endpoint is read-only in this build, so
// every mutating control either stages its change on this screen and says so,
// or states plainly that it is not wired. Nothing here claims to have reached
// Meta.

import {
  DELIVERY_STATES,
  DELIVERY_STATE_LABELS,
  DELIVERY_PROOF_STATES,
  QUEUE_ROW_STATES,
  DEFAULT_COLUMNS,
  COLUMN_CATALOG,
  isUncertainWrite,
  formatWhen,
  formatInt,
  num,
  rowName,
  rowKey,
} from "./ads-contracts.js";
import {
  el,
  clear,
  svg,
  ICONS,
  button,
  chip,
  segmented,
  statusBadge,
  statusLabel,
  block,
  skeleton,
  emptyPanel,
  errorPanel,
  notConnectedPanel,
  staleBanner,
  createDrawer,
  definitionRow,
  visuallyHidden,
} from "./ads-ui.js";
import { createTable, column, createSelection, columnChooser, sortControl } from "./ads-table.js";
import {
  field,
  filterBar,
  bulkBar,
  applyFilters,
  hiddenSelectionNotice,
  accountCurrency,
  formatAccountMoney,
  formatAccountMoneyDelta,
  summariseChangeEntries,
  appliedViewSentence,
  CURRENCY_UNKNOWN_NOTE,
} from "./ads-views.js";
import {
  PHASE_LABELS,
  LOCAL_PHASES,
  PROVIDER_PHASES,
  draftSummary,
} from "./ads-drafts.js";
import { planDigest } from "./ads-identity.js";
import { ADS_ENDPOINT_BASE, READER_PATHS, READER_REQUIREMENTS } from "./ads-source.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// The states the queue must distinguish, in one order: the delivery vocabulary
// first, then the operator states the queue adds. Both lists are frozen
// contracts, so the filter chips and the counts can never drift from them.
const STATE_ORDER = Object.freeze([...DELIVERY_STATES, ...QUEUE_ROW_STATES.filter((s) => !DELIVERY_STATES.includes(s))]);

// Write acknowledgements. Grouped because the summary has to count them as one
// fact: "we wrote and the ad may not exist yet".
const AWAITING_STATES = Object.freeze(["uploading", "submitted", "in_review"]);

// Terminal states where nothing is being served.
const STOPPED_STATES = Object.freeze(["rejected", "blocked", "failed"]);

const CAVEATS = Object.freeze({
  draft: "nothing has been sent",
  validated: "checked locally, not sent",
  queued: "waiting to be sent, not sent",
  uploading: "assets are being sent — not delivery",
  submitted: "write acknowledged — not serving",
  in_review: "under review — not serving",
  delivering: "the provider is serving it",
  paused: "served earlier, now stopped",
  rejected: "review rejected it — not serving",
  uncertain: "a write was accepted; delivery is unconfirmed",
  blocked: "blocked before it was sent",
  failed: "a step failed",
  archived: "kept for history",
});

const ACTIVITY_KINDS = Object.freeze({
  queue: "Queue",
  budget: "Budget change",
  sync: "Sync",
  throttle: "Provider throttle",
});

/** A missing state is a dash. `draft` would be a claim about the provider. */
function rawState(value) {
  return String(value || "").toLowerCase();
}

function isProof(state) {
  return DELIVERY_PROOF_STATES.includes(rawState(state));
}

function stateWord(state) {
  const key = rawState(state);
  if (!key) return "—";
  return DELIVERY_STATE_LABELS[key] || statusLabel(key);
}

function stateCaveat(state) {
  return CAVEATS[rawState(state)] || "state not in this read's vocabulary";
}

function stateSentence(state) {
  const key = rawState(state);
  if (!key) return "This read did not carry a state.";
  return `${stateWord(key)} — ${stateCaveat(key)}.`;
}

/** Every state is labelled with its word, never colour alone. */
function stateBadge(value, { title = "" } = {}) {
  const key = rawState(value);
  if (!key) {
    const dash = el("span", "", "—");
    dash.title = "This read did not carry a state, so none is claimed.";
    return dash;
  }
  return statusBadge(key, { label: stateWord(key), title: title || stateSentence(key) });
}

function stateCaveatNode(value) {
  const key = rawState(value);
  if (!key) return null;
  return el("span", "ads-cell-sub", stateCaveat(key));
}

function isNode(value) {
  return Boolean(value) && typeof value === "object" && typeof value.nodeType === "number";
}

let uid = 0;
function nextId(prefix) {
  uid += 1;
  return `ads-queue-${prefix}-${uid}`;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

// The pipeline a batch walks. It ends at `delivering`, deliberately: there is
// no step after it, because nothing after it would be delivery.
const FLOW_STEPS = Object.freeze([
  Object.freeze({ id: "draft", label: "Draft" }),
  Object.freeze({ id: "validated", label: "Validated" }),
  Object.freeze({ id: "queued", label: "Queued" }),
  Object.freeze({ id: "uploading", label: "Uploading" }),
  Object.freeze({ id: "submitted", label: "Submitted" }),
  Object.freeze({ id: "in_review", label: "In review" }),
  Object.freeze({ id: "delivering", label: "Delivering" }),
]);

const CHAIN = FLOW_STEPS.map((step) => step.id);

// Where each state sits in the chain, plus the states that are not chain
// positions at all. States outside the chain claim no completed steps: this read
// does not record how far a blocked or archived batch got, and guessing would be
// inventing history.
const FLOW_POSITION = Object.freeze({
  draft: { marks: { draft: "current" }, note: "Nothing has been queued yet." },
  validated: {
    marks: { draft: "done", validated: "current" },
    note: "Checked locally. Nothing has reached the provider.",
  },
  queued: {
    marks: { draft: "done", validated: "done", queued: "current" },
    note: "Waiting to be sent. Nothing has reached the provider.",
  },
  uploading: {
    marks: { draft: "done", validated: "done", queued: "done", uploading: "current" },
    note: "The assets are being sent. This is not delivery.",
  },
  submitted: {
    marks: { draft: "done", validated: "done", queued: "done", uploading: "done", submitted: "current" },
    note: "The provider accepted the write. That is an acknowledgement, not delivery: no ad is being served yet.",
  },
  in_review: {
    marks: { draft: "done", validated: "done", queued: "done", uploading: "done", submitted: "done", in_review: "current" },
    note: "Waiting on the provider's review. Not delivery.",
  },
  delivering: {
    marks: Object.freeze(Object.fromEntries(CHAIN.map((id) => [id, "done"]))),
    note: "The provider is serving the ad. This is the proof of delivery.",
  },
  paused: {
    marks: Object.freeze(Object.fromEntries(CHAIN.map((id) => [id, "done"]))),
    extra: { label: "Paused", mark: "current" },
    note: "The provider served this ad before it was paused, so delivery is proven — it is simply not running now.",
  },
  uncertain: {
    marks: { draft: "done", validated: "done", queued: "done", uploading: "done", submitted: "done" },
    extra: { label: "Delivery unconfirmed", mark: "current" },
    note: "A write was accepted and delivery was never confirmed. Reconcile before retrying so a duplicate ad is not created.",
  },
  rejected: {
    marks: { draft: "done", validated: "done", queued: "done", uploading: "done", submitted: "done", in_review: "failed" },
    note: "Review rejected it. Nothing is being served.",
  },
  blocked: { marks: {}, extra: { label: "Blocked", mark: "failed" }, note: "Blocked before it was sent." },
  failed: { marks: {}, extra: { label: "Failed", mark: "failed" }, note: "A step failed. The detail belongs to the row that failed." },
  archived: {
    marks: {},
    extra: { label: "Archived", mark: "current" },
    note: "Archived. This read does not record which steps it completed, so none are claimed.",
  },
});

const FLOW_MARK_WORD = Object.freeze({ done: "done", current: "current step", failed: "failed", todo: "not reached" });

/**
 * The drawn mark for a step. Icons come from `ICONS` like every other mark in
 * the workspace; the current step is a filled dot because "where it is now" has
 * no icon of its own.
 */
function flowMark(mark) {
  if (mark === "done") return svg(ICONS.check, { size: 10, width: 3 });
  if (mark === "failed") return svg(ICONS.close, { size: 10, width: 3 });
  if (mark === "current") return el("span", "ads-flow-dot");
  return null;
}

function flowStep(label, mark, { sr = true } = {}) {
  const node = el("span", "ads-flow-step");
  node.setAttribute("role", "listitem");
  const drawn = flowMark(mark);
  if (drawn) node.append(drawn);
  node.append(el("span", "", label));
  // The mark is drawn and worded, so it never depends on colour: done and failed
  // have to stay apart under every kind of colour vision. The legend above the
  // table reuses this function with `sr: false`, because there the label *is* the
  // word for the mark and repeating it would read as a stutter.
  if (sr) node.append(visuallyHidden(` — ${FLOW_MARK_WORD[mark] || FLOW_MARK_WORD.todo}`));
  if (mark !== "todo") node.dataset[mark] = "true";
  node.title = `${label}: ${FLOW_MARK_WORD[mark] || FLOW_MARK_WORD.todo}`;
  return node;
}

/** A batch's place in the pipeline. */
function flowNode(state) {
  const key = rawState(state);
  const spec = FLOW_POSITION[key] || {
    marks: {},
    extra: { label: key ? stateWord(key) : "State unknown", mark: "current" },
    note: "This state is not in the queue's flow vocabulary, so no step is claimed for it.",
  };
  const flow = el("div", "ads-flow");
  flow.setAttribute("role", "list");
  flow.setAttribute("aria-label", `Delivery flow, current state ${stateWord(key)}: ${spec.note}`);
  for (const step of FLOW_STEPS) flow.append(flowStep(step.label, spec.marks[step.id] || "todo"));
  if (spec.extra) flow.append(flowStep(spec.extra.label, spec.extra.mark));
  return flow;
}

function flowNote(state) {
  const key = rawState(state);
  return (FLOW_POSITION[key] || {}).note || "This state is not in the queue's flow vocabulary, so no step is claimed for it.";
}

// ---------------------------------------------------------------------------
// Draft lifecycle
// ---------------------------------------------------------------------------
//
// The queue lists staged work, and a staged change has a life of its own that
// has nothing to do with delivery. These three functions are the whole of that
// life: what phase a draft is in, what exactly was approved, and whether the
// approval still describes what is on screen. They are pure so they can be
// driven directly by the rule tests.

/**
 * The phase of a staged change, in words an operator can act on.
 *
 * `Draft (unsaved)` and `Saved draft` are the two halves of the model's
 * `editing`: a record that has never been written anywhere durable is not the
 * same thing as one this browser saved and can reopen. `Submitted to Meta` and
 * `Delivering` are reported exactly as the model records them and are marked
 * read-only, because nothing in this browser may set them: only an execution
 * service that heard from the provider can.
 */
export function queuePhaseLabel(draft) {
  const phase = String(draft?.phase || "");
  const origin = draft?.origin === "preview" ? "preview" : "live";
  const readOnly = PROVIDER_PHASES.includes(phase);
  let label;
  if (phase === "editing") label = draft?.savedAt ? "Saved draft" : "Draft (unsaved)";
  else label = PHASE_LABELS[phase] || (phase ? phase : "Phase unknown");
  if (origin === "preview") label = `Local rehearsal · ${label}`;
  return Object.freeze({
    phase,
    origin,
    label,
    readOnly,
    rehearsal: origin === "preview",
    // Writable here means "this browser may move the record into this phase".
    // A local phase is writable, but only through the draft model's own
    // transitions: the queue never writes storage itself. A rehearsal draft is
    // writable as a rehearsal and still can never be sent.
    settable: LOCAL_PHASES.includes(phase),
    reason: readOnly
      ? "Recorded by the execution service from a provider answer. This browser never sets it and nothing here can."
      : phase === "editing" && !draft?.savedAt
        ? "Being built in the publishing flow. It is not in the queue yet and it is not saved in this browser."
        : origin === "preview"
          ? "A rehearsal draft. It is stored apart from live work and can never be sent."
          : "A local phase. Nothing has been sent to Meta.",
  });
}

/**
 * The rows an approval covers.
 *
 * A launch is approved against its planned ads (`planDigest` of `plan.rows`).
 * A budget or pause change has no planned ads, so its digest covers the rows it
 * would change — keyed on the record's identity and its before/after values.
 * Approving a launch against an empty digest would make every approval of it
 * look valid forever, which is exactly what an approval must not do.
 */
export function draftDigestRows(draft) {
  if (!draft) return [];
  if (draft.kind === "launch") return (draft.plan?.rows || []).map((row) => ({ ...row }));
  return (draft.changes?.rows || []).map((row) => ({
    adId: String(row.key || ""),
    creativeVersionId: String(row.level || ""),
    // The row's *name* is deliberately absent: a rename is a label change, and an
    // approval that expired because somebody reworded a label would train people
    // to re-approve without reading.
    headline: "",
    // The before and after values are the substance of a budget or pause change,
    // so the digest has to move when either of them does. "unknown" is spelled
    // out so an absent value cannot collide with the string "null".
    body: `${row.before === null || row.before === undefined ? "unknown" : row.before}→${row.after === null || row.after === undefined ? "unknown" : row.after}`,
    destination: "",
    trackingKey: String(row.state || ""),
  }));
}

export function draftDigest(draft) {
  return planDigest(draftDigestRows(draft));
}

/**
 * Whether a recorded approval still describes the draft on screen.
 *
 * `stale` is the interesting answer: the plan changed after the sign-off, so
 * the approval is history rather than permission. An approval with no digest at
 * all is `undigested` and is also treated as not covering the plan, because
 * there is nothing it could be checked against.
 */
export function approvalStatus(draft) {
  const digest = draftDigest(draft);
  const approvedDigest = String(draft?.approvedDigest || "");
  const approvedAt = String(draft?.approvedAt || "");
  if (!approvedAt) return Object.freeze({ status: "none", digest, approvedDigest, approvedAt, reason: "Not approved. An approval is the owner's sign-off on one exact plan, recorded locally." });
  if (!approvedDigest) {
    return Object.freeze({
      status: "undigested",
      digest,
      approvedDigest,
      approvedAt,
      reason: "Approved before this build recorded a plan digest, so there is nothing to check the approval against. Approve again to pin it to the current plan.",
    });
  }
  if (approvedDigest !== digest) {
    return Object.freeze({
      status: "stale",
      digest,
      approvedDigest,
      approvedAt,
      reason: "The plan changed after it was approved, so this approval no longer describes what is on screen. Approve the current plan again.",
    });
  }
  return Object.freeze({ status: "approved", digest, approvedDigest, approvedAt, reason: "Approved against this exact plan. The digest still matches." });
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function createQueueScreen(ctx, host) {
  const root = el("div", "ads-block");
  host.append(root);

  const store = ctx.store && typeof ctx.store.update === "function" && typeof ctx.store.state === "object" ? ctx.store : null;
  const stored = store ? store.state : {};

  const KNOWN_COLUMNS = Array.isArray(COLUMN_CATALOG.queue) ? COLUMN_CATALOG.queue : [];
  const DEFAULT_COLUMNS_FOR_QUEUE = Array.isArray(DEFAULT_COLUMNS.queue) ? DEFAULT_COLUMNS.queue.slice() : ["name", "state"];

  /** A stored column list may name a column this build no longer has. Drop the
   *  strangers rather than rendering an empty cell under an old label. */
  function normalizeColumns(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter((id) => KNOWN_COLUMNS.includes(id));
    return list.length ? list : DEFAULT_COLUMNS_FOR_QUEUE.slice();
  }

  const state = {
    disposed: false,
    mode: "loading", // loading | rows | panel
    panelStatus: "error",
    loading: true,
    status: "loading",
    detail: "",
    fetchedAt: null,
    data: null, // { batches, activity, changes } from the record reader
    batches: [],
    readProblem: null, // a failed re-read while rows are on screen
    search: "",
    activeStates: [],
    selection: null,
    table: null,
    review: null, // the bulk change being reviewed locally
    decisions: new Map(), // pending change id -> the operator's local decision
    view: {
      columns: normalizeColumns(stored.columns),
      sort: stored.sort && typeof stored.sort === "object" ? stored.sort : { id: "updated", dir: "desc" },
      filters: Array.isArray(stored.filters) ? stored.filters.slice() : [],
      page: 0,
      pageSize: Number(stored.pageSize) || 50,
    },
  };

  const controller = new AbortController();
  let regions = {};

  const drawer = createDrawer({ host, title: "Batch detail" });

  const tableLabelId = nextId("batches-label");
  const tableLabel = el("h3", "ads-block-title", "Batches");
  tableLabel.id = tableLabelId;

  // ------------------------------------------------------------- utilities --

  // The account currency comes from the context read. Without it a money figure
  // would be a number with an invented unit, so the unit is withheld and said to
  // be missing rather than guessed — never GBP by default.
  function currency() {
    return accountCurrency(ctx.context);
  }

  function money(value) {
    return formatAccountMoney(value, currency());
  }

  function moneyDelta(value) {
    return formatAccountMoneyDelta(value, currency());
  }

  /** The sentence shown wherever a money figure appears with no currency read. */
  function currencyNote() {
    if (currency()) return null;
    const note = el("p", "ads-currency-note");
    note.append(svg(ICONS.info, { size: 12, width: 1.8 }), el("span", "", CURRENCY_UNKNOWN_NOTE));
    return note;
  }

  function numberCell(value) {
    const n = num(value);
    return n === null ? null : el("span", "ads-num", formatInt(n));
  }

  function moneyCell(value) {
    const text = moneyDelta(value);
    if (text === null) return null;
    const node = el("span", "ads-num", text);
    node.title = "The budget change recorded against this batch.";
    return node;
  }

  function whenCell(value) {
    const t = Date.parse(String(value || ""));
    if (!Number.isFinite(t)) return null;
    const node = el("span", "ads-num", formatWhen(t));
    node.title = new Date(t).toLocaleString("en-GB");
    return node;
  }

  function textCell(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const node = el("span", "", text);
    node.title = text;
    return node;
  }

  /** A two-column row. Reuses the `.ads-def-row` grid without the `dl`
   *  semantics, because these terms and values are nodes — badges, flows — and
   *  `definitionRow` only takes text. */
  function layoutRow(termNode, valueNode) {
    const row = el("div", "ads-def-row");
    const term = el("div");
    term.append(isNode(termNode) ? termNode : document.createTextNode(String(termNode)));
    const value = el("div");
    value.append(isNode(valueNode) ? valueNode : document.createTextNode(String(valueNode)));
    row.append(term, value);
    return row;
  }

  function defRow(term, value) {
    if (isNode(value)) return layoutRow(el("div", "", term), value);
    const text = value === null || value === undefined || value === "" ? "—" : String(value);
    return definitionRow(term, text);
  }

  function dashed(reason) {
    const dash = el("span", "", "—");
    dash.title = reason;
    return dash;
  }

  function persistView({ marksModified = true } = {}) {
    store?.update(
      {
        columns: state.view.columns,
        sort: state.view.sort,
        filters: state.view.filters,
        pageSize: state.view.pageSize,
      },
      { marksModified },
    );
  }

  /**
   * Apply a built-in or saved view: columns, sort and filters together.
   *
   * The store owns the view state (so `?view=` and "which view is showing" work
   * the same here as on every other screen) while this screen keeps `state.view`
   * for the table. They are written in one place, and `persistView` runs last so
   * the two agree instead of the store quietly holding the older half.
   */
  function applyScreenView(view) {
    store?.apply(view, { fields: FIELDS });
    const builtIn = view.kind === "built-in";
    if (Array.isArray(view.columns) && view.columns.length) state.view.columns = normalizeColumns(view.columns);
    else if (!builtIn) state.view.columns = normalizeColumns(null);
    if (view.sort) state.view.sort = { ...view.sort };
    else if (!builtIn) state.view.sort = { id: "updated", dir: "desc" };
    state.view.filters = (Array.isArray(view.filters) ? view.filters : [])
      .filter((filter) => FIELDS.some((def) => def.id === filter.field))
      .map((filter) => ({ ...filter }));
    state.view.page = 0;
    persistView({ marksModified: false });
    renderAll();
    ctx.say(appliedViewSentence(store || { skipped: null }, view));
  }

  /**
   * A control that would write to the provider, in a build where the queue
   * reader is read-only. It carries its boundary in the open: a quiet badge says
   * the action is not wired, and the disclosure says exactly what it would do
   * and what would not happen. Nothing here pretends a write occurred.
   *
   * `onAct` is for controls that do something locally — a recorded decision, a
   * staged change. Those say where the effect stops.
   */
  function localControl(label, { detail, badge = "Not wired", variant = "ghost", icon = null, onAct = null } = {}) {
    const noteId = nextId("note");
    const wrap = el("span", "ads-state-strip");
    const note = el("p", "ads-block-note", detail);
    note.id = noteId;
    note.hidden = true;
    const btn = button(label, {
      variant,
      icon,
      ariaLabel: `${label} — ${badge.toLowerCase()}`,
      title: `${badge}. ${detail}`,
      onClick: () => {
        onAct?.();
        const opening = note.hidden;
        note.hidden = !opening;
        btn.setAttribute("aria-expanded", opening ? "true" : "false");
        if (opening) ctx.say(`${label}: ${badge.toLowerCase()}. ${detail}`);
      },
    });
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", noteId);
    wrap.append(btn, el("span", "ads-badge ads-badge-quiet", badge), note);
    return wrap;
  }

  const RETRY_DETAIL =
    "Retry writes the ad again. This row's write may already have landed, so a retry can create a duplicate ad. Frank has no write endpoint for the queue yet: nothing is sent from here.";
  const RECONCILE_DETAIL =
    "Reconcile asks the provider what it already holds for this row, so a retry cannot create a duplicate ad. That read-back endpoint does not exist in this build either: nothing is sent from here.";

  // ---------------------------------------------------------------- reading --

  let loadPromise = null;
  const RETAINABLE = Object.freeze(["throttled", "error", "stale", "syncing"]);

  function applyResult(result) {
    const status = result?.status || "error";
    const detail = result?.detail || "";
    state.loading = false;
    state.status = status;
    state.detail = detail;
    state.fetchedAt = result?.fetchedAt || null;
    state.readProblem = null;

    if (status === "ready" || status === "empty") {
      const record = result?.data?.meta ?? null;
      if (!record || typeof record !== "object") {
        state.mode = "panel";
        state.panelStatus = "error";
        state.data = null;
        state.batches = [];
        state.detail = "The queue read answered without a record, so there is no queue to draw.";
        return;
      }
      if (!Array.isArray(record.batches)) {
        state.mode = "panel";
        state.panelStatus = "error";
        state.data = null;
        state.batches = [];
        state.detail = "The queue record did not carry a batch list, so no rows are shown.";
        return;
      }
      state.mode = "rows";
      state.data = record;
      state.batches = record.batches;
      // A new read replaces the row objects, so a selection or a review that
      // pointed at the old ones is dropped rather than silently carried over.
      state.selection = createSelection({ rows: state.batches, getKey: batchKey });
      state.review = null;
      return;
    }

    if (state.data && RETAINABLE.includes(status)) {
      // Cached rows stay on screen while the read is retried; the banner above
      // them says why they may be old.
      state.mode = "rows";
      state.readProblem = { status, detail };
      return;
    }

    state.mode = "panel";
    state.panelStatus = status;
    state.data = null;
    state.batches = [];
    state.selection = null;
    state.review = null;
  }

  async function load({ force = false } = {}) {
    if (state.disposed) return;
    try {
      const result = await ctx.reader.read("queue", ctx.params, { signal: controller.signal, force });
      if (state.disposed) return;
      applyResult(result);
    } catch (error) {
      if (state.disposed) return;
      state.mode = state.data ? "rows" : "panel";
      state.panelStatus = "error";
      state.detail = "The queue read failed before it answered.";
      state.readProblem = state.data ? { status: "error", detail: state.detail } : null;
      ctx.say("The queue read failed. Nothing was changed.");
      void error;
    }
    renderAll();
    return state.mode;
  }

  function reload() {
    loadPromise = load({ force: true });
    return loadPromise;
  }

  // ---------------------------------------------------------------- filtering --

  const FIELDS = Object.freeze([
    field({ id: "name", label: "Batch name", kind: "text", get: (batch) => rowName(batch), group: "Batch" }),
    field({ id: "owner", label: "Owner", kind: "text", get: (batch) => batch?.owner || "", group: "Batch", hint: "owner, coordinator or sync" }),
    field({ id: "level", label: "Level", kind: "text", get: (batch) => batch?.level || "", group: "Batch", hint: "campaign, adset or ad" }),
    field({ id: "objective", label: "Objective", kind: "text", get: (batch) => batch?.objective || "", group: "Batch" }),
    field({
      id: "state",
      label: "State",
      kind: "enum",
      get: (batch) => rawState(batch?.state),
      options: STATE_ORDER.map((id) => ({ value: id, label: stateWord(id) })),
      group: "State",
      hint: "The same filter as the state chips above the table",
    }),
    field({
      id: "awaiting",
      label: "Awaiting confirmation",
      kind: "boolean",
      get: (batch) => AWAITING_STATES.includes(rawState(batch?.state)),
      group: "State",
      hint: "A write was acknowledged; not delivery",
    }),
    field({
      id: "proven",
      label: "Proof of delivery",
      kind: "boolean",
      get: (batch) => isProof(batch?.state),
      group: "State",
      hint: "Only Delivering and Paused prove the provider served the ad",
    }),
    field({
      id: "needsReconcile",
      label: "Needs reconcile",
      kind: "boolean",
      get: (batch) => isUncertainWrite(batch?.state),
      group: "State",
      hint: "A write was accepted and delivery was never confirmed",
    }),
    field({
      id: "hasFailures",
      label: "Has failed rows",
      kind: "boolean",
      get: (batch) => (num(batch?.failures) || 0) > 0,
      group: "State",
    }),
  ]);

  function visibleBatches() {
    let rows = state.batches;
    if (state.activeStates.length) {
      rows = rows.filter((batch) => state.activeStates.includes(rawState(batch.state)));
    }
    rows = applyFilters(rows, state.view.filters, FIELDS);
    const needle = state.search.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((batch) => {
        const own = [rowName(batch), batch.internalId, batch.owner, batch.objective, batch.level]
          .some((value) => String(value ?? "").toLowerCase().includes(needle));
        if (own) return true;
        // The ads inside a batch are part of what an operator searches for:
        // "which batch holds this creative" is the common question.
        return (Array.isArray(batch.rows) ? batch.rows : []).some((row) => String(row?.name ?? "").toLowerCase().includes(needle));
      });
    }
    return rows;
  }

  function selectedBatches() {
    if (!state.selection) return [];
    const keys = new Set(state.selection.keys());
    return state.batches.filter((batch) => keys.has(batchKey(batch)));
  }

  function pendingChangesFor(batchId) {
    const list = Array.isArray(state.data?.changes) ? state.data.changes : null;
    if (!list) return null;
    return list.filter((change) => String(change?.batchId) === String(batchId) && String(change?.state || "pending") === "pending");
  }

  // ---------------------------------------------------------------- header --

  function publishButton(variant = "ink") {
    return button("Publish ads", {
      variant,
      icon: ICONS.upload,
      title: "Start a bulk launch: select creatives, configure, map, tracking, review, queue.",
      onClick: () => ctx.openPublish(),
    });
  }

  function proofBanner() {
    const banner = el("div", "ads-banner");
    banner.setAttribute("role", "note");
    banner.append(svg(ICONS.info, { size: 13, width: 1.8 }));
    const text = el("span");
    text.append(
      el("strong", "", "Submission is not proof of delivery."),
      el(
        "span",
        "",
        " Uploading, Submitted and In review are write acknowledgements; none of them means the ad is being served. Only Delivering — and Paused, which was served before it was stopped — prove the provider served it.",
      ),
    );
    banner.append(text);
    return banner;
  }

  function proofBlock() {
    const ads = totalAds();
    const batches = state.batches.length;
    const section = block("What each state means", {
      note: `${
        ads === null
          ? `${formatInt(batches)} batch${batches === 1 ? "" : "es"} in the queue. A batch did not carry its ad count, so the ads total is withheld rather than reported as a partial sum.`
          : `${formatInt(batches)} batch${batches === 1 ? "" : "es"} in the queue, carrying ${formatInt(ads)} ads as this read records them.`
      } Every badge in this screen uses these words.`,
    });
    const list = el("dl");
    list.append(
      meaningRow("Proof of delivery", ["delivering", "paused"], "The provider served the ad. Paused was served before it stopped."),
      meaningRow("Not proof", AWAITING_STATES, "A write was accepted. The ad may not be serving, or may not exist yet."),
      meaningRow("Not sent", ["draft", "validated", "queued"], "Nothing has reached the provider."),
      meaningRow("Needs reconcile", ["uncertain"], "A write was accepted and delivery was never confirmed. Reconcile before retrying."),
      meaningRow("Stopped", STOPPED_STATES, "The provider or review stopped this. The detail sits on the row that failed."),
      meaningRow("Archived", ["archived"], "Kept for reference. The queue does not run an archived batch again."),
      defRow("How to read the flow", flowLegend()),
    );
    section.append(list);
    return section;
  }

  /**
   * The legend draws the marks with the same `flowStep` the batches use, so a
   * reader is shown the marks they will actually see rather than a description
   * of them.
   */
  function flowLegend() {
    const wrap = el("div");
    const flow = el("div", "ads-flow");
    flow.setAttribute("role", "list");
    flow.setAttribute("aria-label", "Flow marks: a step already passed, the step the batch is on, a step that failed, and a step not reached");
    for (const mark of ["done", "current", "failed", "todo"]) flow.append(flowStep(FLOW_MARK_WORD[mark], mark, { sr: false }));
    wrap.append(flow, el("span", "ads-cell-sub", "Nothing after Submitted is delivery."));
    return wrap;
  }

  // The counts live beside the words that explain them: a state group is one
  // fact, so it is one row rather than a tile and a legend in two places.
  function meaningRow(term, states, sentence) {
    const count = state.batches.filter((batch) => states.includes(rawState(batch.state))).length;
    const wrap = el("div");
    const strip = el("div", "ads-state-strip");
    for (const id of states) strip.append(stateBadge(id));
    wrap.append(strip, el("span", "ads-cell-sub", `${formatInt(count)} batch${count === 1 ? "" : "es"} in this read. ${sentence}`));
    return defRow(term, wrap);
  }

  function renderHeader() {
    const box = region("header");
    clear(box);
    if (state.readProblem) {
      box.append(
        staleBanner({
          status: state.readProblem.status === "not_connected" ? "error" : state.readProblem.status,
          fetchedAt: state.fetchedAt,
          detail: state.readProblem.detail,
          onRefresh: reload,
        }),
      );
    }
    const bar = el("div", "ads-block-head");
    bar.append(publishButton());
    bar.append(
      el(
        "p",
        "ads-block-note",
        `Nothing on this screen reaches the provider. The queue reader is read-only in this build (${ADS_ENDPOINT_BASE}${READER_PATHS.queue}), so every change below is staged here and labelled as staged.`,
      ),
    );
    box.append(bar, proofBanner(), proofBlock());
  }

  // --------------------------------------------------------------- summary --

  function totalAds() {
    const values = state.batches.map((batch) => num(batch.ads));
    if (!values.length) return null;
    // A partial sum is not a total. If one batch did not carry its ad count the
    // figure is withheld and the reason is stated.
    if (values.some((value) => value === null)) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }

  function stateChips() {
    const wrap = el("div", "ads-state-strip");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Filter batches by state");
    wrap.append(
      chip("All states", {
        active: state.activeStates.length === 0,
        count: state.batches.length,
        title: "Show every batch, whatever its state.",
        onClick: () => {
          state.activeStates = [];
          state.view.page = 0;
          renderSummary();
          renderTable();
        },
      }),
    );
    for (const id of STATE_ORDER) {
      const count = state.batches.filter((batch) => rawState(batch.state) === id).length;
      wrap.append(
        chip(stateWord(id), {
          active: state.activeStates.includes(id),
          count,
          title: `${count} batch${count === 1 ? "" : "es"} in ${stateWord(id)}. ${stateCaveat(id)}.`,
          onClick: () => {
            state.activeStates = state.activeStates.includes(id)
              ? state.activeStates.filter((value) => value !== id)
              : [...state.activeStates, id];
            state.view.page = 0;
            renderSummary();
            renderTable();
          },
        }),
      );
    }
    return wrap;
  }

  function filterBarNode() {
    const visible = visibleBatches();
    return filterBar({
      fields: FIELDS,
      filters: state.view.filters,
      onChange: (filters) => {
        state.view.filters = filters;
        state.view.page = 0;
        persistView();
        renderSummary();
        renderTable();
        renderBulk();
      },
      savedViews: store ? store.saved() : [],
      builtInViews: store ? store.builtIn() : [],
      activeView: store ? store.activeView() : null,
      onSaveView: store
        ? (name) => {
            store.save(name);
            renderSummary();
            ctx.say(`View "${name}" saved for this screen. It sits beside the built-in views, which cannot be edited.`);
          }
        : null,
      onApplyView: (view) => applyScreenView(view),
      onUpdateView: store
        ? (view) => {
            store.updateSaved(view.id);
            renderSummary();
            ctx.say(`Saved the columns, sort and filters on screen to your view "${view.name}".`);
          }
        : null,
      onRenameView: store
        ? (view, name) => {
            store.rename(view.id, name);
            renderSummary();
            ctx.say(`Renamed the saved view "${view.name}" to "${name}".`);
          }
        : null,
      onRemoveView: store
        ? (view) => {
            store.remove(view.id);
            renderSummary();
            ctx.say(`Deleted your saved view "${view.name}". The built-in views are unchanged.`);
          }
        : null,
      search: state.search,
      // Only the table is rebuilt while typing: re-rendering the whole filter
      // bar would pull the input out from under the cursor.
      onSearch: (value) => {
        state.search = value;
        state.view.page = 0;
        renderTable();
      },
      extra: [
        columnChooser({
          all: KNOWN_COLUMNS,
          active: state.view.columns,
          onChange: (next) => {
            state.view.columns = normalizeColumns(next);
            persistView();
            renderSummary();
            renderTable();
          },
        }),
        sortControl(
          buildColumns(),
          state.view.sort,
          (sort) => {
            state.view.sort = sort;
            state.view.page = 0;
            persistView();
            renderTable();
          },
        ),
      ],
      resultCount: visible.length,
      totalCount: state.batches.length,
    });
  }

  function renderSummary() {
    const box = region("summary");
    clear(box);
    if (!state.batches.length) return; // nothing to count; the table says so instead
    box.append(stateChips(), filterBarNode());
  }

  // ----------------------------------------------------------------- table --

  const COLUMN_DEFS = Object.freeze({
    name: {
      id: "name",
      label: "Batch",
      title: "The launch batch. Press Enter on a row to open its ads.",
      // The one cell that says which batch the row is. Pinned on a phone, so the
      // subject of a row never scrolls out of sight.
      identity: true,
      sortValue: (batch) => rowName(batch).toLowerCase(),
    },
    state: { id: "state", label: "State", title: "Where the batch is. The word is the state; the title says what it proves." },
    level: { id: "level", label: "Level", title: "The entity level this batch publishes at." },
    ads: { id: "ads", label: "Ads", align: "end", title: "Ads in the batch, as the queue records them." },
    budgetDelta: { id: "budgetDelta", label: "Budget change", align: "end", title: "The budget change recorded against this batch." },
    changes: { id: "changes", label: "Pending changes", align: "end", title: "Changes awaiting a decision on this batch." },
    owner: { id: "owner", label: "Owner", title: "Who asked for the batch." },
    attempts: { id: "attempts", label: "Attempts", align: "end", title: "How many times this batch has been written. An uncertain write counts here." },
    lastError: { id: "lastError", label: "Last error", title: "The last error the queue recorded for this batch." },
    updated: { id: "updated", label: "Updated", align: "end", title: "When the batch last changed." },
  });

  function nameColumn(batch) {
    const cell = el("div", "ads-cell-name");
    const name = el("strong", "", rowName(batch));
    const failures = num(batch.failures);
    if (failures !== null && failures > 0) {
      const flags = el("span", "ads-cell-flags");
      const flag = el("span", "ads-flag");
      flag.title = `${formatInt(failures)} failed ad${failures === 1 ? "" : "s"} in this batch. Each one is retried on its own row.`;
      flag.append(svg(ICONS.alert, { size: 11, width: 2 }), visuallyHidden(`${formatInt(failures)} failed ads in this batch`));
      flags.append(flag);
      name.append(flags);
    }
    cell.append(name);
    const sub = [batch.internalId, batch.objective].filter(Boolean).join(" · ");
    if (sub) cell.append(el("span", "ads-cell-sub", sub));
    return cell;
  }

  function changesColumn(batch) {
    const pending = pendingChangesFor(batch.id);
    if (pending === null) return dashed("This read did not carry the pending changes, so none are claimed.");
    const node = el("span", "ads-num", formatInt(pending.length));
    node.title = pending.length
      ? `${pending.length} change${pending.length === 1 ? "" : "s"} awaiting a decision. Each one is shown before and after below.`
      : "No change is awaiting a decision on this batch.";
    return node;
  }

  function buildColumns() {
    const columns = [];
    for (const id of state.view.columns) {
      const def = COLUMN_DEFS[id];
      if (!def) continue;
      if (id === "name") {
        columns.push(column({ ...def, render: nameColumn }));
      } else if (id === "state") {
        columns.push(
          column({
            ...def,
            render: (batch) => stateBadge(batch.state),
            sortValue: (batch) => {
              const index = STATE_ORDER.indexOf(rawState(batch.state));
              return index === -1 ? null : index;
            },
          }),
        );
      } else if (id === "level") {
        columns.push(
          column({
            ...def,
            render: (batch) => (batch.level ? el("span", "", statusLabel(String(batch.level))) : null),
            sortValue: (batch) => (batch.level ? String(batch.level).toLowerCase() : null),
          }),
        );
      } else if (id === "ads") {
        columns.push(column({ ...def, render: (batch) => numberCell(batch.ads), sortValue: (batch) => num(batch.ads) }));
      } else if (id === "budgetDelta") {
        columns.push(column({ ...def, render: (batch) => moneyCell(batch.budgetDelta), sortValue: (batch) => num(batch.budgetDelta) }));
      } else if (id === "changes") {
        columns.push(
          column({
            ...def,
            render: changesColumn,
            sortValue: (batch) => {
              const pending = pendingChangesFor(batch.id);
              return pending === null ? null : pending.length;
            },
          }),
        );
      } else if (id === "owner") {
        columns.push(column({ ...def, render: (batch) => textCell(batch.owner), sortValue: (batch) => (batch.owner ? String(batch.owner).toLowerCase() : null) }));
      } else if (id === "attempts") {
        columns.push(column({ ...def, render: (batch) => numberCell(batch.attempts), sortValue: (batch) => num(batch.attempts) }));
      } else if (id === "lastError") {
        columns.push(column({ ...def, render: (batch) => textCell(batch.lastError), sortValue: (batch) => (batch.lastError ? String(batch.lastError).toLowerCase() : null) }));
      } else if (id === "updated") {
        columns.push(
          column({
            ...def,
            render: (batch) => whenCell(batch.updated),
            sortValue: (batch) => {
              const t = Date.parse(String(batch.updated || ""));
              return Number.isFinite(t) ? t : null;
            },
          }),
        );
      }
    }
    return columns;
  }

  function rowTone(batch) {
    const key = rawState(batch.state);
    if (isUncertainWrite(key)) return "warn";
    if (STOPPED_STATES.includes(key)) return "bad";
    return null;
  }

  function emptyNodeFor(filtered) {
    if (!filtered.length && !state.batches.length) {
      return emptyPanel({
        title: "No batches in the publishing queue",
        detail: "Nothing has been queued yet. A launch started from the publish flow appears here with its own state, attempts and per-ad failures.",
        action: publishButton("ink"),
      });
    }
    const wrap = el("div");
    wrap.append(
      el("p", "ads-empty-line", "No batch matches the current filters."),
      button("Clear filters", {
        variant: "quiet",
        onClick: () => {
          state.activeStates = [];
          state.view.filters = [];
          state.search = "";
          state.view.page = 0;
          persistView();
          renderAll();
        },
      }),
    );
    return wrap;
  }

  /**
   * Keep the selection honest across a filter change: selected batches that the
   * filters hide stay selected (the operator asked for them), the bulk bar says
   * how many are hidden, "select this page" means only the rows the table is
   * showing, and selecting every matching row is a separate named action.
   */
  function syncSelection(visible) {
    const kept = state.selection ? state.selection.keys() : [];
    state.selection = createSelection({ getKey: batchKey });
    state.selection.setMatching(visible);
    for (const key of kept) state.selection.toggle(key);
  }

  function renderTable() {
    const box = region("table");
    clear(box);
    if (state.loading) {
      box.append(skeleton(6, 5));
      return;
    }
    const visible = visibleBatches();
    syncSelection(visible);
    const head = el("div", "ads-block-head");
    head.append(tableLabel);
    head.append(
      el(
        "p",
        "ads-block-note",
        "One row per launch batch. Enter opens the batch's ads, where a failure stays on its own row. Sorting, filtering and the column choice re-render this snapshot; they never re-read the provider.",
      ),
    );
    box.append(head);

    const table = createTable({
      columns: buildColumns(),
      rows: visible,
      getKey: batchKey,
      state: state.view,
      onSort: (sort) => {
        state.view.sort = sort;
        state.view.page = 0;
        persistView();
      },
      onRowActivate: (batch) => openBatch(batch),
      selection: state.selection,
      onSelectionChange: () => renderBulk(),
      renderRowMeta: (batch) =>
        button("", {
          icon: ICONS.chevronRight,
          variant: "quiet",
          ariaLabel: `Open ${rowName(batch)}`,
          title: `Open ${rowName(batch)} and its ads`,
          onClick: () => openBatch(batch),
        }),
      emptyNode: emptyNodeFor(visible),
      labelledBy: tableLabelId,
      rowTone,
    });
    state.table = table;
    box.append(table.node);
  }

  // ------------------------------------------------------------ bulk review --

  function signedAmount(review) {
    const amount = num(review.amount);
    if (amount === null || amount <= 0) return null;
    return review.direction === "decrease" ? -amount : amount;
  }

  /**
   * The plan behind a bulk change: one entry per ad this read carries, with the
   * value before and the value after. Anything this read cannot compute is
   * listed as unknown instead of being dropped, and a row whose "after" cannot
   * be shown blocks the confirm.
   *
   * The arithmetic lives in `summariseChangeEntries`, shared with the campaigns
   * table, so "unknown is not zero" and "the total covers the known rows" cannot
   * drift between the two screens that stage a bulk change.
   */
  function reviewPlan(review, selected) {
    const entries = [];
    const gaps = [];
    const amount = signedAmount(review);
    for (const batch of selected) {
      const rows = Array.isArray(batch.rows) ? batch.rows : null;
      if (!rows) {
        gaps.push(`${rowName(batch)}: this read did not carry its ads`);
        continue;
      }
      const recorded = num(batch.ads);
      if (recorded !== null && recorded > rows.length) {
        gaps.push(`${rowName(batch)}: this read carries ${formatInt(rows.length)} of its ${formatInt(recorded)} ads`);
      }
      for (const row of rows) {
        const before = review.kind === "pause" ? rawState(row.state) : num(row.budget);
        entries.push({
          batch,
          row,
          // The ad's identity, not only its name: two batches can hold ads that
          // share a name, and a review has to be checkable against the rows it
          // would change.
          key: String(rowKey(row) || ""),
          name: rowName(row),
          before,
          after: review.kind === "pause" ? "paused" : before === null || amount === null ? null : before + amount,
        });
      }
    }
    return { ...summariseChangeEntries(review.kind, entries), gaps, amount };
  }

  function beforeAfter(beforeNode, afterNode) {
    const wrap = el("span", "ads-state-strip");
    wrap.append(el("span", "ads-cell-sub", "before"), beforeNode, el("span", "", "→"), el("span", "ads-cell-sub", "after"), afterNode);
    return wrap;
  }

  function reviewBlockers(review, plan) {
    const blockers = [];
    const amount = review.kind === "budget" ? signedAmount(review) : 1;
    if (amount === null) blockers.push("Enter the amount to change each ad's budget by.");
    if (!plan.entries.length) {
      blockers.push("None of the selected batches carries an ad in this read, so there is no before and after to review.");
    } else if (amount !== null && plan.unknown.length) {
      blockers.push(
        `${formatInt(plan.unknown.length)} of the ads shown carry no ${review.kind === "budget" ? "budget" : "state"} in this read, so their after value cannot be shown. The change is not staged until every affected ad has a before value.`,
      );
    }
    return blockers;
  }

  function reviewPanel() {
    const review = state.review;
    const selected = selectedBatches();
    const panel = el("div", "ads-block");
    const isPause = review.kind === "pause";
    const plan = reviewPlan(review, selected);

    const head = el("div", "ads-block-head");
    const title = el("h4", "ads-block-title", isPause ? "Review: pause these ads" : "Review: change these budgets");
    title.tabIndex = -1;
    title.dataset.reviewHead = "true";
    head.append(
      title,
      el(
        "p",
        "ads-block-note",
        "Before and after for every ad this read carries. The change is staged on this screen only — Frank has no write endpoint for the queue in this build, so confirming sends nothing.",
      ),
    );
    panel.append(head);

    if (!isPause) {
      const control = el("div", "ads-state-strip");
      const amountId = nextId("amount");
      const label = el("label", "ads-field-label", "Change each ad's budget by");
      label.setAttribute("for", amountId);
      const amount = el("input", "ads-input");
      amount.type = "number";
      amount.min = "0";
      amount.step = "1";
      amount.id = amountId;
      amount.value = review.amount === null || review.amount === undefined ? "" : String(review.amount);
      amount.addEventListener("change", () => {
        const parsed = num(amount.value);
        review.amount = parsed === null || parsed < 0 ? null : parsed;
        refresh();
      });
      const direction = segmented(
        [
          { id: "increase", label: "Increase" },
          { id: "decrease", label: "Decrease" },
        ],
        review.direction,
        (id) => {
          review.direction = id;
          refresh();
        },
        { label: "Direction of the budget change", size: "sm" },
      );
      control.append(label, amount, direction);
      panel.append(control);
      const note = currencyNote();
      if (note) panel.append(note);
    }

    const list = el("div", "ads-block-rows");
    const totalRow = el("div");
    const gate = el("div");
    panel.append(list, totalRow, gate);

    const ackId = nextId("ack");
    const ack = el("input", "ads-check");
    ack.type = "checkbox";
    ack.id = ackId;
    ack.checked = Boolean(review.acknowledged);
    const ackLabel = el("label", "ads-field-label");
    ackLabel.setAttribute("for", ackId);
    ackLabel.append(ack, el("span", "", " I have read the before and after for every ad above."));
    ack.addEventListener("change", () => {
      review.acknowledged = ack.checked;
      update();
    });

    const confirm = button("Confirm and stage", {
      variant: "ink",
      title: "Stages this change on this screen. Nothing is sent: the queue has no write endpoint in this build.",
      onClick: () => stageChange(review),
    });
    const actions = el("div", "ads-state-strip ads-stage-bar");
    actions.append(confirm, el("span", "ads-badge ads-badge-quiet", "Staged here only"), ackLabel, button("Cancel", { variant: "quiet", onClick: () => closeReview() }));
    panel.append(actions);

    function update() {
      clear(list);
      for (const entry of plan.entries) {
        const row = el("div", "ads-def-row");
        const term = el("div");
        term.append(el("span", "", entry.name));
        // The identity travels with the name: an approval is of specific ads,
        // and a name is not enough to tell two of them apart.
        term.append(el("span", "ads-cell-sub ads-ba-id", entry.key || "no identity in this read"));
        if (entry.batch) term.append(el("span", "ads-cell-sub", rowName(entry.batch)));
        const value = el("div");
        const beforeNode = isPause ? stateBadge(entry.before) : moneyNode(entry.before, !entry.known);
        const afterNode = isPause ? stateBadge(entry.after) : moneyNode(entry.after, !entry.known);
        value.append(beforeAfter(beforeNode, afterNode));
        if (!entry.known) value.append(el("span", "ads-cell-sub", isPause ? "state not in this read — not counted" : "no budget in this read — not counted"));
        else if (!entry.changed) value.append(el("span", "ads-cell-sub", isPause ? "already paused — no change" : "no change"));
        row.append(term, value);
        list.append(row);
      }
      if (!plan.entries.length) list.append(el("p", "ads-block-note", "No ad in this read is affected."));

      clear(totalRow);
      const known = plan.known.length;
      const excluded = plan.unknown.length;
      const excludedNote = excluded ? ` · ${formatInt(excluded)} excluded (no ${isPause ? "state" : "budget"} in this read)` : "";
      totalRow.append(
        defRow(
          isPause ? "Total" : "Total change",
          isPause
            ? known === 0
              ? // Every affected ad's state is unknown, so there is no count to
                // state: "0 of 4 ads move to Paused" would be a claim about ads
                // this read never measured.
                `— · nothing to count: all ${formatInt(plan.entries.length)} ads carry no state in this read`
              : `${formatInt(plan.changed)} of ${formatInt(plan.entries.length)} ads move to Paused${excludedNote}`
            : known === 0
              ? // An unknown value is not zero, so a change computed from no
                // known rows prints a dash and says why, never "0 per day".
                `— · nothing to total: all ${formatInt(plan.entries.length)} ads carry no budget in this read`
              : `${moneyDelta(plan.total)} per day across ${formatInt(known)} ads${excludedNote}`,
        ),
      );
      if (plan.gaps.length) totalRow.append(el("p", "ads-block-note", `Covered here: ${plan.gaps.join("; ")}. The change would apply to the whole batch; the ads not in this read cannot be shown before and after.`));

      clear(gate);
      const blockers = reviewBlockers(review, plan);
      for (const blocker of blockers) gate.append(el("p", "ads-block-note", blocker));
      if (!review.acknowledged) gate.append(el("p", "ads-block-note", "Confirm becomes available once you have read the before and after above."));
      confirm.disabled = blockers.length > 0 || !review.acknowledged;
    }

    function moneyNode(value, isUnknown) {
      const n = num(value);
      if (n === null) return dashed(isUnknown ? "This ad carries no budget in this read." : "No value to show.");
      return el("span", "ads-num", money(n));
    }

    // A fresh plan on every edit, but only this panel re-renders: pulling the
    // whole region down would take focus out of the amount field mid-edit.
    function refresh() {
      const next = reviewPlan(review, selected);
      plan.entries = next.entries;
      plan.known = next.known;
      plan.unknown = next.unknown;
      plan.gaps = next.gaps;
      plan.total = next.total;
      plan.changed = next.changed;
      update();
    }

    update();
    panel.refresh = refresh;
    return panel;
  }

  function openReview(kind) {
    const selected = selectedBatches();
    if (!selected.length) return;
    state.review = { kind, amount: null, direction: "increase", acknowledged: false };
    renderBulk();
    const heading = regions.bulk?.querySelector("[data-review-head]");
    heading?.focus?.({ preventScroll: true });
    heading?.scrollIntoView?.({ block: "nearest" });
    ctx.say(
      kind === "pause"
        ? "Pause review opened. Nothing is sent until you confirm, and confirming only stages the change here."
        : "Budget review opened. Nothing is sent until you confirm, and confirming only stages the change here.",
    );
  }

  function closeReview() {
    state.review = null;
    renderBulk();
  }

  /**
   * Stage a reviewed change into the shared draft model. It is the same record
   * the publishing flow writes, so the queue, the campaigns table and the launch
   * flow all agree on what is waiting and on how many rows it touches.
   */
  function stageChange(review) {
    const selected = selectedBatches();
    const plan = reviewPlan(review, selected);
    const isPause = review.kind === "pause";
    const currency = accountCurrency(ctx.context);
    const rows = plan.entries.map((entry) => ({
      key: String(rowKey(entry.row)),
      name: rowName(entry.row),
      level: "ad",
      state: String(entry.before ?? ""),
      before: num(entry.before),
      after: isPause ? null : num(entry.after),
    }));
    const saved = ctx.drafts.save({
      kind: isPause ? "pause" : "budget",
      approval: "staged",
      state: "queued",
      title: isPause ? `Pause ${formatInt(plan.changed)} ads` : `Budget change across ${formatInt(plan.entries.length)} ads`,
      campaign: { budget: null, currency, budgetKind: "daily" },
      changes: {
        kind: isPause ? "pause" : "budget",
        percent: 0,
        amount: isPause ? null : plan.amount,
        direction: review.direction,
        batches: selected.map((batch) => rowName(batch)),
        gaps: plan.gaps,
        rows,
      },
    });
    state.review = null;
    state.selection?.clear();
    renderTable();
    renderBulk();
    renderAll();
    ctx.say(
      isPause
        ? `Staged ${formatInt(saved.changes.rows.length)} rows for a pause. Nothing was sent to the provider.`
        : `Staged a budget change across ${formatInt(saved.changes.rows.length)} ads. Nothing was sent to the provider.`,
    );
  }

  function renderBulk() {
    const box = region("bulk");
    clear(box);
    const selected = selectedBatches();
    if (!selected.length) {
      state.review = null;
      return;
    }
    if (state.review) {
      box.append(reviewPanel());
    }
    const parts = [];
    const count = (predicate) => selected.filter(predicate).length;
    const awaiting = count((batch) => AWAITING_STATES.includes(rawState(batch.state)));
    const proven = count((batch) => isProof(batch.state));
    const reconcile = count((batch) => isUncertainWrite(batch.state));
    const stopped = count((batch) => STOPPED_STATES.includes(rawState(batch.state)));
    if (awaiting) parts.push(`${formatInt(awaiting)} awaiting confirmation`);
    if (proven) parts.push(`${formatInt(proven)} proving delivery`);
    if (reconcile) parts.push(`${formatInt(reconcile)} needing reconcile`);
    if (stopped) parts.push(`${formatInt(stopped)} stopped`);
    box.append(
      bulkBar({
        count: selected.length,
        matchingCount: state.selection ? state.selection.matchingSize() : 0,
        pageCount: state.selection ? state.selection.pageSize() : 0,
        hiddenCount: state.selection ? state.selection.hiddenKeys().length : 0,
        // The shared bar appends a bare "s" to the noun, so the noun is one that
        // pluralises that way: "2 batchs selected" would be a visible typo in a
        // screen that is otherwise careful about its words.
        noun: "queue item",
        note: parts.join(" · "),
        onSelectMatching: () => {
          if (!state.selection) return;
          const total = state.selection.matchingSize();
          state.selection.selectMatching();
          ctx.say(`Selected all ${formatInt(total)} queue items the current filters match.`);
          renderTable();
          renderBulk();
        },
        onSelectPage: () => {
          if (!state.selection) return;
          state.selection.retain(state.selection.pageKeys());
          renderTable();
          renderBulk();
        },
        actions: [
          button("Pause", { title: "Review a pause for every ad in the selected batches, before and after.", onClick: () => openReview("pause") }),
          button("Change budget", { title: "Review a budget change for every ad in the selected batches, before and after.", onClick: () => openReview("budget") }),
        ],
        onClear: () => {
          state.selection?.clear();
          state.review = null;
          renderTable();
          renderBulk();
        },
      }),
    );
    const visible = new Set(visibleBatches().map(batchKey));
    const hidden = selected.filter((batch) => !visible.has(batchKey(batch)));
    const notice = hiddenSelectionNotice(hidden.length, () => {
      for (const batch of hidden) if (state.selection?.has(batchKey(batch))) state.selection.toggle(batchKey(batch));
      renderTable();
      renderBulk();
    });
    if (notice) box.append(notice);
  }

  // -------------------------------------------------------------- attention --

  function changeKindWord(kind) {
    const key = String(kind || "").toLowerCase();
    if (key === "budget") return "Budget change";
    if (key === "pause") return "Pause";
    return key ? statusLabel(key) : "Change";
  }

  function changeValueNode(kind, value) {
    const text = String(value ?? "").trim();
    if (!text) return dashed("This read did not carry this side of the change.");
    if (String(kind).toLowerCase() === "pause" && STATE_ORDER.includes(text.toLowerCase())) return stateBadge(text);
    return el("span", "ads-num", text);
  }

  function changeCard(change) {
    const batch = state.batches.find((item) => batchKey(item) === String(change?.batchId)) || null;
    const card = el("div", "ads-block");
    const head = el("div", "ads-block-head");
    head.append(
      stateBadge(change?.state, {
        title: `${change?.state ? stateWord(change.state) : "State missing"} — awaiting a decision. Frank cannot send the decision yet.`,
      }),
    );
    head.append(el("h4", "ads-block-title", `${changeKindWord(change?.kind)} · ${batch ? rowName(batch) : "batch not in this read"}`));
    const requested = Date.parse(String(change?.at || ""));
    const when = Number.isFinite(requested) ? el("span", "ads-cell-sub", formatWhen(requested)) : dashed("This read did not carry when the change was requested.");
    if (Number.isFinite(requested)) when.title = new Date(requested).toLocaleString("en-GB");
    head.append(when);
    card.append(head);

    const list = el("dl");
    list.append(
      defRow(
        "Batch",
        batch
          ? `${rowName(batch)} · ${String(batch.internalId || "—")}`
          : `— · ${String(change?.batchId || "no batch id")} is not in this read`,
      ),
      defRow("What changes", changeKindWord(change?.kind)),
      defRow("Before", changeValueNode(change?.kind, change?.from)),
      defRow("After", changeValueNode(change?.kind, change?.to)),
      defRow("Requested by", change?.requestedBy ? String(change.requestedBy) : "—"),
    );
    card.append(list);

    const decision = state.decisions.get(change?.id) || null;
    const actions = el("div", "ads-state-strip");
    if (batch) {
      actions.append(button("Open batch", { variant: "quiet", icon: ICONS.chevronRight, ariaLabel: `Open ${rowName(batch)}`, onClick: () => openBatch(batch) }));
    }
    if (decision) {
      actions.append(
        el("span", "ads-badge ads-badge-quiet", decision === "approved" ? "Approved here — not sent" : "Declined here — not sent"),
        button("Undo", {
          variant: "quiet",
          title: "Remove the local decision. Nothing was sent, so there is nothing to undo at the provider.",
          onClick: () => {
            state.decisions.delete(change?.id);
            renderAttention();
            ctx.say("Local decision removed. Nothing was sent to the provider.");
          },
        }),
      );
    } else {
      for (const [label, value] of [
        ["Approve", "approved"],
        ["Decline", "declined"],
      ]) {
        actions.append(
          localControl(label, {
            badge: "Recorded here only",
            detail: `${label} records your decision on this screen so the before/after review is logged. It does not reach the provider: the queue has no write endpoint in this build.`,
            onAct: () => {
              state.decisions.set(change?.id, value);
              renderAttention();
            },
          }),
        );
      }
    }
    card.append(actions);
    return card;
  }

  function changesBlock() {
    const changes = Array.isArray(state.data?.changes) ? state.data.changes.slice() : null;
    if (!changes) {
      const section = block("Pending changes");
      section.append(el("p", "ads-block-note", "This read did not carry pending changes, so none are claimed."));
      return section;
    }
    if (!changes.length) return null;
    changes.sort((a, b) => Date.parse(String(b?.at || "")) - Date.parse(String(a?.at || "")) || 0);
    const section = block("Pending changes", {
      note: "Each change is shown before it is made: what it is, what it was, what it becomes, who asked and when. Approving or declining here is a local record — Frank cannot send it yet.",
    });
    for (const change of changes) section.append(changeCard(change));
    return section;
  }

  function uncertainBatches() {
    return state.batches.filter((batch) => isUncertainWrite(batch.state));
  }

  function uncertainBlock() {
    const batches = uncertainBatches();
    if (!batches.length) return null;
    const section = block("Reconcile before retry", {
      note: "These writes were accepted by the provider and delivery was never confirmed. Frank finds out what already exists before it writes again.",
    });
    section.append(
      el(
        "p",
        "",
        "Reconcile asks the provider what it already holds for a batch and confirms whether the ad exists. Retry writes again. For a write whose outcome is unknown, retrying blind is how a duplicate ad is created — so these rows are offered Reconcile and never Retry.",
      ),
    );
    for (const batch of batches) {
      const row = el("div", "ads-def-row");
      const term = el("div");
      term.append(el("span", "", rowName(batch)));
      term.append(el("span", "ads-cell-sub", String(batch.internalId || "—")));
      const value = el("div");
      value.append(flowNode(batch.state));
      value.append(el("p", "ads-block-note", flowNote(batch.state)));
      const rowStates = Array.isArray(batch.rows) ? batch.rows : [];
      const uncertainRows = rowStates.filter((item) => isUncertainWrite(item.state)).length;
      if (uncertainRows) value.append(el("p", "ads-block-note", `${formatInt(uncertainRows)} of the ${formatInt(rowStates.length)} ads this read carries are in an uncertain write state themselves.`));
      const actions = el("div", "ads-state-strip");
      actions.append(localControl("Reconcile", { detail: RECONCILE_DETAIL }), button("Open batch", { variant: "quiet", onClick: () => openBatch(batch) }));
      value.append(actions);
      row.append(term, value);
      section.append(row);
    }
    return section;
  }

  /**
   * The phase vocabulary, printed beside the records that use it.
   *
   * A staged change has a life of its own that has nothing to do with delivery,
   * and the two provider phases are listed here precisely because this browser
   * must never be able to set them: they are shown as read-only facts.
   */
  function phaseLegend() {
    const list = el("dl");
    const row = (term, phase, sentence) => {
      const label = queuePhaseLabel(phase);
      const strip = el("div", "ads-state-strip");
      strip.append(el("span", "ads-badge ads-badge-quiet", label.label));
      if (label.readOnly) strip.append(el("span", "ads-badge ads-badge-mute", "Read-only"));
      strip.append(el("span", "ads-cell-sub", sentence));
      list.append(defRow(term, strip));
    };
    row("Draft (unsaved)", { phase: "editing", origin: "live" }, "Being built in the publishing flow. Not staged, and not yet saved in this browser.");
    row("Saved draft", { phase: "editing", origin: "live", savedAt: "x" }, "Saved locally and reopenable. Still not staged, still not sent.");
    row("Staged in Frank", { phase: "staged", origin: "live" }, "Waiting for the owner's sign-off. Nothing has reached Meta.");
    row("Approved", { phase: "approved", origin: "live" }, "The owner signed off on one exact plan, recorded with its digest. Local, and not a submission.");
    row("Submitted to Meta", { phase: "submitted", origin: "live" }, "A write was acknowledged by the provider. Never set from this browser, and not proof of delivery.");
    row("Delivering", { phase: "delivering", origin: "live" }, "The provider is serving it. Recorded by the execution service from a provider answer.");
    return list;
  }

  /**
   * Recovery, said out loud.
   *
   * The draft store drops a record it cannot read, keeps a backup before every
   * write, and reports a storage failure instead of pretending. Every one of
   * those is a way work disappears, so every one of them is surfaced here rather
   * than left in the console.
   */
  function recoveryBlock() {
    const diagnostics = ctx.drafts.diagnostics || {};
    const unfinished = ctx.drafts.unfinished();
    const nodes = [];

    if (diagnostics.storageError) {
      const banner = el("div", "ads-banner");
      banner.dataset.tone = "warn";
      banner.setAttribute("role", "status");
      banner.append(svg(ICONS.alert, { size: 13, width: 1.8 }));
      banner.append(
        el(
          "span",
          "",
          `${diagnostics.storageError} Staged changes in this tab are held in memory only: closing the tab loses them.`,
        ),
      );
      nodes.push(banner);
    }
    if (diagnostics.discarded) {
      const banner = el("div", "ads-banner");
      banner.dataset.tone = "warn";
      banner.setAttribute("role", "status");
      banner.append(svg(ICONS.alert, { size: 13, width: 1.8 }));
      const n = diagnostics.discarded;
      banner.append(el("span", "", `${formatInt(n)} saved draft${n === 1 ? "" : "s"} could not be read and ${n === 1 ? "was" : "were"} dropped rather than shown as something ${n === 1 ? "it is" : "they are"} not.`));
      if (typeof ctx.drafts.restoreBackup === "function") {
        banner.append(
          button("Restore the previous copy", {
            title: "Puts back the payload written before the last save. Anything saved after that copy is not in it.",
            onClick: () => {
              const restored = ctx.drafts.restoreBackup();
              renderAll();
              ctx.say(restored ? "Restored the previous saved copy of the drafts." : "There was no backup copy to restore.");
            },
          }),
        );
      }
      nodes.push(banner);
    }
    if (diagnostics.restoredFromBackup) {
      const banner = el("div", "ads-banner");
      banner.dataset.tone = "mute";
      banner.setAttribute("role", "status");
      banner.append(svg(ICONS.info, { size: 13, width: 1.8 }));
      banner.append(el("span", "", "These drafts were restored from the backup copy Frank wrote before its last save, because the current record could not be read."));
      nodes.push(banner);
    }

    if (unfinished.length) {
      const section = block("You left these unfinished", {
        note: "Saved work that was never staged, so it is not in the queue and nothing has been sent. It was kept rather than dropped.",
      });
      for (const draft of unfinished) {
        const list = el("dl");
        list.append(
          defRow("Draft", draft.title || draftSummary(draft)),
          defRow("Phase", phaseBadge(draft)),
          defRow("Rows", formatInt(draft.kind === "launch" ? draft.plan.rows.length : draft.changes.rows.length)),
          defRow("Revision", revisionText(draft)),
          defRow("Last saved", savedText(draft)),
        );
        const actions = el("div", "ads-state-strip");
        if (draft.kind === "launch") {
          actions.append(
            button("Reopen draft", {
              variant: "ink",
              title: "Reopen this launch in the publishing flow, exactly as it was saved.",
              onClick: () => ctx.openDraft(draft.id),
            }),
          );
        } else {
          actions.append(
            button("Open the campaigns table", {
              variant: "ink",
              title: "A budget or pause change is staged from the table that shows its rows. Re-run it there; the saved rows here are what it covered.",
              onClick: () => {
                ctx.navigate("campaigns");
                ctx.say("Re-stage this change from the campaigns table. The unfinished record here is kept until you discard it.");
              },
            }),
          );
        }
        actions.append(
          button("Discard", {
            variant: "quiet",
            title: "Remove this unfinished draft. Nothing was sent, so there is nothing to undo at the provider.",
            onClick: () => {
              ctx.drafts.remove(draft.id);
              renderAll();
              ctx.say("Unfinished draft discarded. Nothing was sent to the provider.");
            },
          }),
        );
        section.append(list, actions);
      }
      nodes.push(section);
    }

    if (!nodes.length) return null;
    const wrap = el("div", "ads-recovery");
    for (const node of nodes) wrap.append(node);
    return wrap;
  }

  /** A draft's phase, stated with the word and what it does and does not mean. */
  function phaseBadge(draft) {
    const info = queuePhaseLabel(draft);
    const badge = el("span", "ads-badge ads-badge-quiet", info.label);
    badge.dataset.phase = info.phase;
    badge.dataset.origin = info.origin;
    badge.title = info.reason;
    return badge;
  }

  /** Revision and last-saved time, so two people can see they are looking at
   *  different revisions of the same record before either of them acts. */
  function revisionText(draft) {
    const revision = Number(draft?.revision) > 0 ? Number(draft.revision) : null;
    return revision === null ? "—" : `Revision ${formatInt(revision)}`;
  }

  function savedText(draft) {
    const at = Date.parse(String(draft?.savedAt || draft?.updatedAt || ""));
    if (!Number.isFinite(at)) return "This record does not say when it was last saved.";
    const node = el("span", "", formatWhen(at));
    node.title = new Date(at).toLocaleString("en-GB");
    return node;
  }

  /**
   * Approve one staged draft: the owner's sign-off on one exact plan, recorded
   * locally with the plan's digest.
   *
   * The revision is checked first. A list drawn a moment ago can be a revision
   * behind — another tab, or another person — and approving a plan that has
   * already changed would record a sign-off on something nobody read.
   */
  function approveDraft(draft) {
    const current = ctx.drafts.get(draft.id);
    if (!current) {
      ctx.say("That draft is no longer in Frank's records. Nothing was approved.");
      renderAll();
      return;
    }
    if (Number(current.revision) !== Number(draft.revision)) {
      ctx.say(
        `This draft changed since the list was drawn: revision ${formatInt(draft.revision)} is now revision ${formatInt(current.revision)}. Read the current revision before approving it.`,
      );
      renderAll();
      return;
    }
    const digest = draftDigest(current);
    const approved = ctx.drafts.approve(current.id, { digest });
    if (!approved) {
      ctx.say("That draft could not be approved. Nothing was changed.");
      return;
    }
    ctx.say(
      `Approved "${current.title || draftSummary(current)}" locally, against plan digest ${digest}. This is Frank's own record of your sign-off on revision ${formatInt(current.revision)}; nothing was sent to Meta.`,
    );
    renderAll();
  }

  /**
   * Everything staged in Frank, read from the shared draft model. This renders
   * in every mode, including Not connected: a staged draft is a fact about this
   * workspace, not about the provider reader.
   */
  function stagedBlock() {
    // Staged and approved records only. An unfinished draft is saved work that
    // never reached the queue, and it is listed once, under its own heading in
    // the recovery block, rather than twice with two sets of actions.
    const drafts = ctx.drafts.staged();
    const legend = block("What each phase means", {
      note: "The phase of a staged change, in the words this screen and the launch flow both use. Approval is a local sign-off, not a submission, and the last two phases are read-only here.",
    });
    legend.append(phaseLegend());

    if (!drafts.length) {
      const empty = block("Staged in Frank");
      empty.append(
        el(
          "p",
          "ads-block-note",
          "Nothing is staged. A change staged from the launch flow, the campaigns table or this queue appears here with its phase, its revision and its approval.",
        ),
      );
      const wrap = el("div", "ads-staged");
      wrap.append(empty, legend);
      return wrap;
    }

    const section = block("Staged in Frank", {
      note: "One shared record per staged change, written by the launch flow, the campaigns table and this queue alike. Frank has no write endpoint in this build, so none of them has been sent to Meta and none of them is claimed as delivered. The revision and time are shown so two people can see when they are looking at different revisions.",
    });
    const unsavedWarning = ctx.drafts.persistent === false;
    for (const draft of drafts) {
      const list = el("dl");
      if (draft.kind === "launch") {
        list.append(
          defRow("Launch", draft.title || "Untitled launch"),
          defRow("Ads in the plan", formatInt(draft.plan.total)),
          defRow("Planned rows stored", formatInt(draft.plan.rows.length)),
          defRow("Creatives", formatInt(draft.creatives.length)),
          defRow("Campaign identity", draft.campaign.campaignId),
        );
      } else {
        const changes = draft.changes || {};
        list.append(
          defRow("Change", draft.title || draftSummary(draft)),
          defRow("Rows covered", formatInt((changes.rows || []).length)),
          defRow("Batches", (changes.batches || []).join(", ") || "—"),
        );
        if ((changes.gaps || []).length) list.append(defRow("Not covered", changes.gaps.join("; ")));
      }
      // The lifecycle, stated honestly and never implying a provider write.
      list.append(defRow("Phase", phaseBadge(draft)));
      list.append(defRow("Revision", revisionText(draft)));
      list.append(defRow("Last saved", savedText(draft)));
      if (unsavedWarning) {
        list.append(
          defRow(
            "Saved?",
            "No — this browser is not saving drafts, so this record exists only in this tab.",
          ),
        );
      }
      const approval = approvalStatus(draft);
      list.append(defRow("Approval", approvalRow(draft, approval)));
      section.append(list);
      section.append(draftActions(draft, approval));
    }
    const wrap = el("div", "ads-staged");
    wrap.append(section, legend);
    return wrap;
  }

  /** The approval line: when, by whom, against which digest, and whether that
   *  approval still describes what is on screen. */
  function approvalRow(draft, approval) {
    const strip = el("div", "ads-state-strip");
    if (approval.status === "none") {
      strip.append(el("span", "ads-cell-sub", approval.reason));
      return strip;
    }
    const at = Date.parse(approval.approvedAt);
    const when = Number.isFinite(at) ? formatWhen(at) : "at an unknown time";
    const badge = el("span", `ads-badge ads-badge-${approval.status === "approved" ? "ok" : "warn"}`, approval.status === "approved" ? "Approved locally" : approval.status === "stale" ? "Approval is stale" : "Approval has no digest");
    badge.title = approval.reason;
    strip.append(badge, el("span", "ads-cell-sub", `${when}${draft.approvedBy ? ` by ${draft.approvedBy}` : ""} · digest ${approval.approvedDigest || "not recorded"}`));
    strip.append(el("span", "ads-cell-sub", approval.reason));
    return strip;
  }

  /**
   * The actions for one draft. Approve is offered on a staged draft — and on an
   * approved draft whose plan has moved on, because an approval that no longer
   * matches the plan is history, not permission. Nothing here is a submission.
   */
  function draftActions(draft, approval) {
    const bar = el("div", "ads-state-strip ads-draft-bar");
    if (draft.kind === "launch") {
      bar.append(
        button("Open draft", {
          variant: "ink",
          title: "Reopen this launch in the publishing flow, exactly as it was saved.",
          onClick: () => ctx.openDraft(draft.id),
        }),
      );
    }
    const canApprove = draft.phase === "staged" || approval.status === "stale" || approval.status === "undigested";
    if (canApprove) {
      bar.append(
        button(approval.status === "approved" ? "Approve again" : "Approve", {
          variant: approval.status === "none" || approval.status === "stale" ? "ink" : "ghost",
          icon: ICONS.check,
          title: `Records your approval of this exact plan (revision ${draft.revision}) against its digest. It is a local sign-off: nothing is sent to Meta.`,
          onClick: () => approveDraft(draft),
        }),
      );
      bar.append(el("span", "ads-badge ads-badge-quiet", "Local approval — not a submission"));
    } else if (draft.phase === "editing") {
      bar.append(el("span", "ads-cell-sub", "Not staged yet, so there is nothing to approve. Open it and stage it first."));
    }
    bar.append(
      button("Discard", {
        variant: "quiet",
        title: "Remove this staged draft. Nothing was sent, so there is nothing to undo at the provider.",
        onClick: () => {
          ctx.drafts.remove(draft.id);
          renderAll();
          ctx.say("Staged draft discarded. Nothing was sent to the provider.");
        },
      }),
    );
    return bar;
  }

  function renderAttention() {
    const box = region("attention");
    clear(box);
    // The staged drafts and the recovery notices are rendered by `renderStaged`
    // above the table — once each. Rendering the staged block here as well put
    // two Approve buttons for one draft on the screen.
    for (const node of [uncertainBlock(), changesBlock()]) if (node) box.append(node);
  }

  // --------------------------------------------------------------- activity --

  function activityItem(item) {
    const row = el("div", "ads-timeline-item");
    row.dataset.kind = String(item?.kind || "");
    const at = Date.parse(String(item?.at || ""));
    const time = el("span", "ads-timeline-time", Number.isFinite(at) ? formatWhen(at) : "—");
    if (Number.isFinite(at)) time.title = new Date(at).toLocaleString("en-GB");
    const rail = el("span", "ads-timeline-rail");
    rail.append(el("span", "ads-timeline-dot"));
    const body = el("div", "ads-timeline-body");
    body.append(el("span", "ads-timeline-text", item?.text ? String(item.text) : "—"));
    const kind = String(item?.kind || "");
    body.append(el("span", "ads-timeline-actor", `${item?.actor ? String(item.actor) : "—"} · ${ACTIVITY_KINDS[kind] || (kind ? statusLabel(kind) : "—")}`));
    row.append(time, rail, body);
    return row;
  }

  function renderActivity() {
    const box = region("activity");
    clear(box);
    const activity = Array.isArray(state.data?.activity) ? state.data.activity.slice() : null;
    const section = block("Activity", { note: "Who did what to this queue, most recent first." });
    if (!activity) {
      section.append(el("p", "ads-block-note", "This read did not carry an activity history, so none is shown."));
    } else if (!activity.length) {
      section.append(el("p", "ads-block-note", "Nothing has been recorded against this queue yet."));
    } else {
      activity.sort((a, b) => Date.parse(String(b?.at || "")) - Date.parse(String(a?.at || "")) || 0);
      const list = el("div", "ads-timeline");
      for (const item of activity) list.append(activityItem(item));
      section.append(list);
    }
    box.append(section);
  }

  // ----------------------------------------------------------- batch detail --

  function rowDetail(row, batch) {
    const wrap = el("div", "ads-def-row");
    const term = el("div");
    term.append(el("span", "", rowName(row)));
    term.append(el("span", "ads-cell-sub", String(row.creativeId || "—")));
    const value = el("div");

    const strip = el("div", "ads-state-strip");
    strip.append(stateBadge(row.state));
    const caveat = stateCaveatNode(row.state);
    if (caveat) strip.append(caveat);
    const attempts = num(row.attempts);
    strip.append(el("span", "ads-cell-sub", attempts === null ? "— attempts" : `${formatInt(attempts)} attempt${attempts === 1 ? "" : "s"}`));
    const budget = money(row.budget);
    if (budget !== null) strip.append(el("span", "ads-cell-sub ads-num", budget));
    const updated = Date.parse(String(row.updated || ""));
    if (Number.isFinite(updated)) {
      const when = el("span", "ads-cell-sub ads-num", formatWhen(updated));
      when.title = new Date(updated).toLocaleString("en-GB");
      strip.append(when);
    }
    value.append(strip);

    if (row.detail) value.append(el("p", "", String(row.detail)));
    if (row.destination) {
      const destination = el("p", "ads-cell-sub", String(row.destination));
      destination.title = String(row.destination);
      value.append(destination);
    }

    const actions = el("div", "ads-state-strip");
    const key = rawState(row.state);
    if (isUncertainWrite(key)) {
      // The whole point of the block above, applied per row: a row whose write
      // may already exist is reconciled, not retried.
      actions.append(localControl("Reconcile", { detail: RECONCILE_DETAIL }));
    } else if (STOPPED_STATES.includes(key)) {
      actions.append(
        localControl("Retry this ad", { detail: RETRY_DETAIL }),
        button("Open the creative", {
          variant: "quiet",
          title: "Opens Creative intelligence. Fixing the asset is what makes a retry work; retrying an unchanged rejected asset fails the same way.",
          onClick: () => ctx.navigate("creative"),
        }),
      );
    }
    if (actions.childElementCount) value.append(actions);

    wrap.append(term, value);
    return wrap;
  }

  function openBatch(batch) {
    drawer.setTitle(rowName(batch));
    drawer.show((body) => {
      const key = rawState(batch.state);
      const flow = block("Where this batch stands", { note: `Flow: ${flowNote(key)}` });
      flow.append(flowNode(key));
      flow.append(el("p", "ads-block-note", `The flow ends at Delivering on purpose: ${stateCaveat(key)}.`));
      if (isUncertainWrite(key)) {
        flow.append(localControl("Reconcile", { detail: RECONCILE_DETAIL }));
      }
      body.append(flow);

      const details = block("Batch", { note: "What this read records about the batch itself." });
      const list = el("dl");
      const rows = Array.isArray(batch.rows) ? batch.rows : null;
      const recorded = num(batch.ads);
      list.append(
        defRow("Internal id", batch.internalId ? String(batch.internalId) : ""),
        defRow("Level", batch.level ? statusLabel(String(batch.level)) : ""),
        defRow("Ads", recorded === null ? "" : formatInt(recorded)),
        defRow(
          "Ads in this read",
          rows === null ? "" : recorded !== null && recorded > rows.length ? `${formatInt(rows.length)} of ${formatInt(recorded)}` : formatInt(rows.length),
        ),
        defRow("Failed ads", num(batch.failures) === null ? "" : formatInt(num(batch.failures))),
        defRow("Attempts", num(batch.attempts) === null ? "" : formatInt(num(batch.attempts))),
        defRow("Budget change", moneyCell(batch.budgetDelta) || ""),
        defRow("Objective", batch.objective ? String(batch.objective) : ""),
        defRow("Optimisation", batch.optimisation ? String(batch.optimisation) : ""),
        defRow("Owner", batch.owner ? String(batch.owner) : ""),
        defRow("Tracking template", batch.trackingTemplate ? String(batch.trackingTemplate) : ""),
        defRow("Created", whenCell(batch.created) || ""),
        defRow("Updated", whenCell(batch.updated) || ""),
        defRow("Last error", batch.lastError ? String(batch.lastError) : ""),
      );
      details.append(list);
      body.append(details);

      const failed = num(batch.failures);
      const rowsBlock = block(rows === null ? "Ads" : `Ads (${formatInt(rows.length)} in this read)`, {
        note: "Each ad carries its own state, attempts and error. A failure is retried on its row alone: the batch is never re-run as a whole to recover one ad.",
      });
      if (failed !== null && failed > 0) {
        rowsBlock.append(
          el("p", "", `${formatInt(failed)} of the ads in this batch failed. Retry those ads only — the ads that delivered stay where they are.`),
        );
      }
      if (rows === null) {
        rowsBlock.append(el("p", "ads-block-note", "This read did not carry the individual ads for this batch, so no row detail is shown."));
      } else if (!rows.length) {
        rowsBlock.append(el("p", "ads-block-note", "This batch carries no ads yet."));
      } else {
        for (const row of rows) rowsBlock.append(rowDetail(row, batch));
      }
      const publish = batch.creativeIds?.length
        ? button("Re-publish these creatives", {
            variant: "quiet",
            title: "Opens the publish flow seeded with this batch's creatives. The flow is the only place a launch is configured.",
            // The publish flow takes a seed selection; only the creative ids are
            // passed, because the seed must not carry anything this read cannot
            // vouch for.
            onClick: () => ctx.openPublish({ creativeIds: batch.creativeIds.slice() }),
          })
        : null;
      if (publish) {
        const publishRow = el("div", "ads-state-strip");
        publishRow.append(publish);
        rowsBlock.append(publishRow);
      }
      body.append(rowsBlock);
    });
  }

  // ----------------------------------------------------------------- render --

  /** The shared staged drafts and the recovery notices, above whatever the
   *  provider reader answered. Rendered once, in every mode — a staged draft is
   *  a fact about this workspace, not about the reader. */
  function renderStaged() {
    const box = region("staged");
    clear(box);
    for (const node of [recoveryBlock(), stagedBlock()]) if (node) box.append(node);
  }

  function renderNotConnected() {
    const box = region("message");
    box.append(
      notConnectedPanel({
        requirement: state.detail || READER_REQUIREMENTS.queue,
        action: publishButton("ink"),
        secondary: button("Read the queue again", {
          variant: "quiet",
          title: "Ask the read model again. It answers Not connected until the publishing sync exists.",
          onClick: reload,
        }),
      }),
    );
  }

  function renderPanel() {
    const box = region("message");
    if (state.panelStatus === "not_connected") {
      renderNotConnected();
      return;
    }
    box.append(errorPanel({ detail: state.detail, onRetry: reload }));
  }

  function region(name) {
    if (!regions[name]) {
      const node = el("div", "ads-block");
      regions[name] = node;
      root.append(node);
    }
    return regions[name];
  }

  function renderAll() {
    if (state.disposed) return;
    clear(root);
    regions = {};
    renderHeader();
    renderStaged();
    // Before the first answer there is nothing to count and nothing to claim, so
    // the screen shows its own shape and a skeleton rather than empty blocks.
    if (state.mode === "loading") {
      renderTable();
      return;
    }
    if (state.mode === "panel") {
      renderPanel();
      return;
    }
    renderSummary();
    renderAttention();
    renderTable();
    renderActivity();
    // The bulk region is last so its bar is the last thing in the scroll
    // container, which is what keeps a bottom-sticky bar stuck to the bottom.
    renderBulk();
  }

  // -------------------------------------------------------------- lifecycle --

  renderAll();
  loadPromise = load();

  // A draft staged anywhere in the workspace appears here without a reload.
  const unsubscribeDrafts = ctx.drafts.subscribe(() => {
    if (!state.disposed) renderAll();
  });

  return {
    node: root,
    dispose() {
      state.disposed = true;
      unsubscribeDrafts?.();
      controller.abort();
      drawer.close({ restoreFocus: false });
    },
    reload: (options = {}) => load({ force: Boolean(options.force) }),
    // The shell waits on this before tearing the screen down. Returning the
    // in-flight promise rather than the loader keeps that wait from starting a
    // second read.
    settled: () => loadPromise,
  };
}

// ---------------------------------------------------------------------------
// Row identity
// ---------------------------------------------------------------------------

/** A batch keys on its internal id, never its name: a rename must not break a
 *  selection or a staged change. */
function batchKey(batch) {
  return String(batch?.internalId || batch?.id || batch?.key || "");
}
