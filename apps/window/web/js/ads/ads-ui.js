import { MEASUREMENT_SOURCE_LABELS, MEASUREMENT_SOURCE_NOTES } from "./ads-contracts.js";

// Shared UI primitives for the Ads workspace.
//
// Everything here is Frank's incumbent language, nothing new: white surfaces,
// hairlines, Inter, a 13px body step with 10-11px micro-labels for metadata,
// pill actions, tabular numerals for every number. No tinted panels, no
// gradients, no drop shadows, no colour carrying meaning on its own.
//
// Motion follows one rule from the animation pass: entering surfaces get a
// short custom ease-out (they explain a state change), and repeatedly-used
// controls get none, because a hover that animates tens of times a day is
// friction. Keyboard-initiated actions never animate.

/** Element factory. Deliberately tiny; the workspace builds thousands of nodes. */
export function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "" && text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function svg(path, { size = 14, stroke = "currentColor", width = 1.6, fill = "none" } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("width", String(size));
  node.setAttribute("height", String(size));
  node.setAttribute("fill", fill);
  node.setAttribute("stroke", stroke);
  node.setAttribute("stroke-width", String(width));
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  node.append(p);
  return node;
}

export const ICONS = Object.freeze({
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronUp: "M6 15l6-6 6 6",
  check: "M20 6L9 17l-5-5",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  close: "M18 6L6 18M6 6l12 12",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  filter: "M3 5h18M6 12h12M10 19h4",
  columns: "M4 5h16v14H4zM10 5v14M16 5v14",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  external: "M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16v-5M12 8h.01",
  refresh: "M21 12a9 9 0 11-3-6.7M21 4v5h-5",
  layers: "M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5",
  image: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  link: "M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1",
  upload: "M12 16V4M8 8l4-4 4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3",
  table: "M3 5h18v14H3zM3 10h18M9 10v9",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z",
  compare: "M4 6h7M4 12h7M4 18h7M17 4v16M14 8l3-4 3 4",
});

// ---------------------------------------------------------------------------
// Status and evidence
// ---------------------------------------------------------------------------

// Status is never colour alone: every badge carries its word, and the title
// attribute carries the sentence.
const STATUS_TONE = {
  delivering: "ok",
  ready: "ok",
  validated: "ok",
  paused: "mute",
  draft: "mute",
  archived: "mute",
  queued: "info",
  uploading: "info",
  submitted: "info",
  in_review: "info",
  uncertain: "warn",
  syncing: "info",
  stale: "warn",
  throttled: "warn",
  blocked: "warn",
  rejected: "bad",
  failed: "bad",
  error: "bad",
  not_connected: "mute",
  empty: "mute",
};

export function statusLabel(state) {
  return String(state || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusBadge(state, { label = "", title = "" } = {}) {
  const key = String(state || "").toLowerCase();
  const badge = el("span", `ads-badge ads-badge-${STATUS_TONE[key] || "mute"}`, label || statusLabel(key));
  badge.dataset.state = key;
  if (title) badge.title = title;
  return badge;
}

/** The evidence pill. Low volume must never look like a winner. */
export function evidenceBadge(evidence, { title = "" } = {}) {
  const level = evidence?.level || "insufficient";
  const map = { insufficient: "mute", directional: "warn", comparable: "ok" };
  const badge = el("span", `ads-badge ads-badge-${map[level] || "mute"} ads-badge-quiet`, evidence?.label || "Insufficient evidence");
  badge.title = title || evidence?.reason || "";
  badge.dataset.evidence = level;
  return badge;
}

/**
 * Source note. Displays the provenance of a number inline, because the whole
 * measurement contract depends on a reader never confusing these.
 */
export function sourceNote(measurement) {
  const label = MEASUREMENT_SOURCE_LABELS[measurement];
  if (!label) return null;
  const node = el("span", `ads-source ads-source-${measurement}`, label);
  node.title = MEASUREMENT_SOURCE_NOTES[measurement] || "";
  return node;
}

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

/**
 * A comparison delta. Direction is conveyed by an arrow and a sign as well as
 * tone, so it survives greyscale and colour blindness. `polarity` says whether
 * up is good for this metric; when it is unknown we show the raw movement and
 * claim nothing.
 */
export function deltaNode(value, { kind = "percent", currency = "GBP", polarity = null, label = "" } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    const node = el("span", "ads-delta ads-delta-none", "—");
    node.title = "No comparable value for this period.";
    return node;
  }
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const good = polarity === null ? null : flat ? null : up === (polarity === "up");
  const tone = good === null ? "mute" : good ? "ok" : "bad";
  const text =
    kind === "currency"
      ? `${up ? "+" : "−"}${new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0 }).format(Math.abs(value))}`
      : kind === "count"
        ? `${up ? "+" : "−"}${Math.abs(Math.round(value)).toLocaleString("en-GB")}`
        : `${up ? "+" : "−"}${(Math.abs(value) * 100).toFixed(1)}%`;
  const node = el("span", `ads-delta ads-delta-${tone}`);
  node.append(svg(flat ? ICONS.minus : up ? ICONS.arrowUp : ICONS.arrowDown, { size: 11, width: 2 }), el("span", "", text));
  node.title = label || (flat ? "No material change against the comparison period." : `${text} against the comparison period.`);
  return node;
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * A trend cell. Inline SVG, no library, no axes: it answers "which way and how
 * steadily" beside the number that answers "how much". A flat or empty series
 * renders a rule, not a fake line.
 */
export function sparkline(values, { width = 76, height = 22, positive = null, title = "" } = {}) {
  const wrap = el("span", "ads-spark");
  const numbers = (Array.isArray(values) ? values : []).map((v) => (Number.isFinite(v) ? v : null));
  const present = numbers.filter((v) => v !== null);
  if (present.length < 2) {
    wrap.append(el("span", "ads-spark-flat"));
    wrap.title = "Not enough days in this window to draw a trend.";
    return wrap;
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  const range = max - min || 1;
  const stepX = width / (numbers.length - 1);
  const points = [];
  numbers.forEach((value, index) => {
    if (value === null) return;
    const x = index * stepX;
    const y = height - 2 - ((value - min) / range) * (height - 4);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  node.setAttribute("viewBox", `0 0 ${width} ${height}`);
  node.setAttribute("width", String(width));
  node.setAttribute("height", String(height));
  node.setAttribute("aria-hidden", "true");
  node.classList.add("ads-spark-svg");
  if (positive !== null) node.dataset.tone = positive ? "ok" : "bad";

  // A faint baseline gives the eye something to judge the slope against.
  const base = document.createElementNS(ns, "line");
  base.setAttribute("x1", "0");
  base.setAttribute("x2", String(width));
  base.setAttribute("y1", String(height - 1));
  base.setAttribute("y2", String(height - 1));
  base.setAttribute("class", "ads-spark-base");
  node.append(base);

  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points.join(" "));
  line.setAttribute("class", "ads-spark-line");
  node.append(line);

  const last = points[points.length - 1]?.split(",") || null;
  if (last) {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "1.8");
    dot.setAttribute("class", "ads-spark-dot");
    node.append(dot);
  }
  wrap.append(node);
  const first = present[0];
  const lastValue = present[present.length - 1];
  const change = first === 0 ? null : (lastValue - first) / Math.abs(first);
  wrap.title =
    title ||
    `Day-by-day spend. ${change === null ? "Change not computable." : `${change > 0 ? "Up" : change < 0 ? "Down" : "Flat"} ${Math.abs(change * 100).toFixed(0)}% from the first day shown.`}`;
  return wrap;
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

/**
 * One headline number. Carries its own definition on hover and its measurement
 * source in the open, because a spend-to-qualified-lead figure joins a provider
 * cost to an observed outcome and must say so.
 */
export function statTile({ label, value, definition = "", delta = null, deltaOptions = {}, measurement = "", series = null, tone = "" }) {
  const tile = el("div", `ads-stat${tone ? ` ads-stat-${tone}` : ""}`);
  const head = el("div", "ads-stat-head");
  const labelNode = el("span", "ads-stat-label", label);
  head.append(labelNode);
  const source = sourceNote(measurement);
  if (source) head.append(source);
  const valueRow = el("div", "ads-stat-value");
  const number = el("span", "ads-stat-number", value);
  valueRow.append(number);
  if (delta !== null) valueRow.append(deltaNode(delta, deltaOptions));
  tile.append(head, valueRow);
  if (series && series.length) {
    tile.append(sparkline(series, { width: 132, height: 26 }));
  }
  if (definition) {
    // The definition stays reachable on hover and to a screen reader, and every
    // screen that shows stat tiles also prints its definitions in prose. Printing
    // the sentence under each tile as well is the same text seven times over.
    // It goes in a visually-hidden node rather than an aria-label on the tile,
    // because an aria-label there would also hide the delta, the source badge and
    // the sparkline from assistive technology.
    tile.title = definition;
    tile.append(visuallyHidden(definition));
  }
  return tile;
}

// ---------------------------------------------------------------------------
// Buttons, chips, segmented control
// ---------------------------------------------------------------------------

export function button(label, { variant = "ghost", onClick = null, title = "", icon = null, disabled = false, type = "button", ariaLabel = "" } = {}) {
  const node = el("button", `ads-btn ads-btn-${variant}`);
  node.type = type;
  if (icon) node.append(typeof icon === "string" ? svg(icon, { size: 13, width: 1.8 }) : icon);
  if (label) node.append(el("span", "", label));
  if (title) node.title = title;
  if (ariaLabel) node.setAttribute("aria-label", ariaLabel);
  node.disabled = Boolean(disabled);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

export function chip(label, { active = false, onClick = null, title = "", count = null, removable = false, onRemove = null } = {}) {
  const node = el("button", `ads-chip${active ? " is-on" : ""}`);
  node.type = "button";
  node.setAttribute("aria-pressed", active ? "true" : "false");
  node.append(el("span", "", label));
  if (count !== null && count !== undefined) node.append(el("span", "ads-chip-count", String(count)));
  if (title) node.title = title;
  if (removable) {
    const remove = el("span", "ads-chip-x");
    remove.append(svg(ICONS.close, { size: 10, width: 2 }));
    remove.title = `Remove ${label}`;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      onRemove?.();
    });
    node.append(remove);
  }
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

/**
 * Segmented control. Rendered as a radiogroup so arrow keys move between
 * options, which is what a keyboard user expects from a level switch.
 */
export function segmented(options, activeId, onSelect, { label = "View", size = "md" } = {}) {
  const group = el("div", `ads-segmented ads-segmented-${size}`);
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  const buttons = [];
  for (const option of options) {
    const node = el("button", `ads-segment${option.id === activeId ? " is-on" : ""}`);
    node.type = "button";
    node.setAttribute("role", "radio");
    node.setAttribute("aria-checked", option.id === activeId ? "true" : "false");
    node.tabIndex = option.id === activeId ? 0 : -1;
    if (option.count !== undefined && option.count !== null) {
      node.append(el("span", "", option.label), el("span", "ads-segment-count", String(option.count)));
    } else {
      node.append(el("span", "", option.label));
    }
    if (option.title) node.title = option.title;
    node.addEventListener("click", () => onSelect?.(option.id));
    node.addEventListener("keydown", (event) => {
      const index = options.indexOf(option);
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = options[(index + 1) % options.length];
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = options[(index - 1 + options.length) % options.length];
      if (event.key === "Home") next = options[0];
      if (event.key === "End") next = options[options.length - 1];
      if (!next) return;
      event.preventDefault();
      onSelect?.(next.id);
      group.querySelectorAll(".ads-segment")[options.indexOf(next)]?.focus();
    });
    buttons.push(node);
    group.append(node);
  }
  return group;
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

/**
 * A trigger-anchored popover. Scales from its trigger rather than its centre,
 * which is the difference between a menu that feels attached to its button and
 * one that appears from nowhere. Escape closes it, focus returns to the
 * trigger, and a click outside dismisses it.
 */
export function popover({ trigger, render, align = "start", label = "Menu", width = null }) {
  const wrap = el("div", "ads-pop-wrap");
  const panel = el("div", "ads-pop");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", label);
  panel.hidden = true;
  if (width) panel.style.setProperty("--pop-w", `${width}px`);
  panel.dataset.align = align;
  let open = false;
  let disposeInside = null;

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    panel.classList.remove("is-open");
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    disposeInside?.();
    disposeInside = null;
    if (restoreFocus) trigger.focus();
  }

  function onOutside(event) {
    if (wrap.contains(event.target)) return;
    close();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close({ restoreFocus: true });
    }
  }

  function show() {
    if (open) return;
    open = true;
    clear(panel);
    disposeInside = render?.(panel, close) || null;
    panel.hidden = false;
    // One frame between unhide and the class so the transition runs; without
    // it the popover snaps in and the origin is lost.
    requestAnimationFrame(() => panel.classList.add("is-open"));
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  }

  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    open ? close() : show();
  });
  wrap.append(trigger, panel);
  wrap.dispose = close;
  return wrap;
}

/** A labelled menu row, used by the column and filter popovers. */
export function menuItem(label, { onClick = null, checked = null, hint = "", icon = null, disabled = false } = {}) {
  const node = el("button", "ads-menu-item");
  node.type = "button";
  node.disabled = Boolean(disabled);
  if (checked !== null) {
    node.setAttribute("role", "menuitemcheckbox");
    node.setAttribute("aria-checked", checked ? "true" : "false");
    const box = el("span", `ads-menu-check${checked ? " is-on" : ""}`);
    box.append(svg(ICONS.check, { size: 11, width: 2.4 }));
    node.append(box);
  } else if (icon) {
    node.append(svg(icon, { size: 13, width: 1.7 }));
  }
  const body = el("span", "ads-menu-body");
  body.append(el("span", "ads-menu-label", label));
  if (hint) body.append(el("span", "ads-menu-hint", hint));
  node.append(body);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export function menuGroup(title) {
  const group = el("div", "ads-menu-group");
  if (title) group.append(el("p", "ads-menu-title", title));
  return group;
}

// ---------------------------------------------------------------------------
// Read-state surfaces
// ---------------------------------------------------------------------------

/**
 * The "Not connected" surface.
 *
 * Before the reporting sync exists, this is what every screen must render. It
 * is not an error and not an empty state: it names the reader that has no
 * implementation and what would connect it, and it offers no fabricated rows.
 */
export function notConnectedPanel({ title = "Not connected", requirement = "", action = null, secondary = null } = {}) {
  const panel = el("div", "ads-panel-note");
  panel.dataset.state = "not_connected";
  const head = el("div", "ads-panel-note-head");
  head.append(svg(ICONS.link, { size: 15, width: 1.7 }), el("h3", "", title));
  panel.append(head);
  panel.append(
    el(
      "p",
      "",
      requirement
        ? `Frank has no reporting sync for this screen yet, so there is nothing truthful to draw. It needs ${requirement}.`
        : "Frank has no reporting sync for this screen yet, so there is nothing truthful to draw.",
    ),
  );
  panel.append(
    el(
      "p",
      "ads-panel-note-quiet",
      "No sample numbers are shown here. Turn on Preview from the header to rehearse the workflow against clearly-labelled synthetic rows.",
    ),
  );
  const actions = el("div", "ads-panel-note-actions");
  if (action) actions.append(action);
  if (secondary) actions.append(secondary);
  if (actions.childElementCount) panel.append(actions);
  return panel;
}

export function emptyPanel({ title = "Nothing in this window", detail = "", action = null } = {}) {
  const panel = el("div", "ads-panel-note");
  panel.dataset.state = "empty";
  const head = el("div", "ads-panel-note-head");
  head.append(svg(ICONS.table, { size: 15, width: 1.7 }), el("h3", "", title));
  panel.append(head);
  if (detail) panel.append(el("p", "", detail));
  if (action) {
    const actions = el("div", "ads-panel-note-actions");
    actions.append(action);
    panel.append(actions);
  }
  return panel;
}

export function errorPanel({ title = "That read failed", detail = "", onRetry = null } = {}) {
  const panel = el("div", "ads-panel-note");
  panel.dataset.state = "error";
  const head = el("div", "ads-panel-note-head");
  head.append(svg(ICONS.alert, { size: 15, width: 1.7 }), el("h3", "", title));
  panel.append(head);
  panel.append(el("p", "", detail || "The Frank read model did not answer. Nothing is sent to the provider from this screen."));
  if (onRetry) {
    const actions = el("div", "ads-panel-note-actions");
    actions.append(button("Retry", { variant: "ink", onClick: onRetry }));
    panel.append(actions);
  }
  return panel;
}

/** Skeleton rows. The shape of the table it stands in for, so the layout does
 *  not jump when rows arrive. */
export function skeleton(rows = 6, columns = 5) {
  const wrap = el("div", "ads-skeleton");
  wrap.setAttribute("aria-hidden", "true");
  for (let r = 0; r < rows; r += 1) {
    const row = el("div", "ads-skeleton-row");
    for (let c = 0; c < columns; c += 1) {
      const cell = el("span", `ads-skeleton-cell${c === 0 ? " is-wide" : ""}`);
      row.append(cell);
    }
    wrap.append(row);
  }
  return wrap;
}

/**
 * The stale banner. Keeps cached rows on screen through throttling, and says
 * how old they are rather than letting a reader assume they are current.
 */
export function staleBanner({ status, fetchedAt, detail = "", onRefresh = null }) {
  const banner = el("div", "ads-banner");
  banner.dataset.tone = status === "throttled" ? "warn" : status === "error" ? "bad" : "mute";
  banner.setAttribute("role", "status");
  const icon = svg(status === "error" ? ICONS.alert : ICONS.clock, { size: 13, width: 1.8 });
  banner.append(icon);
  const age = fetchedAt ? new Date(fetchedAt) : null;
  const text =
    status === "throttled"
      ? "The provider is rate limiting the sync."
      : status === "error"
        ? "The last sync failed."
        : status === "syncing"
          ? "A sync is running."
          : "These rows are from an earlier sync.";
  const when = age && !Number.isNaN(age.getTime()) ? ` Showing results read ${relativeAge(age)}.` : " Read time unknown.";
  banner.append(el("span", "", `${text}${when}`));
  if (detail) banner.append(el("span", "ads-banner-detail", detail));
  if (onRefresh) banner.append(button("Refresh now", { onClick: onRefresh, title: "Re-read the saved rows for this screen. Nothing is sent to the provider." }));
  return banner;
}

/**
 * When the rows on screen were observed, in the one wording every screen uses.
 *
 * `fetchedAt` is the sync time the reader reported. When the reader reported
 * none, the age is said to be unknown rather than dated from the browser clock,
 * which would make an undated answer look fresh.
 */
export function rowsReadNote(fetchedAt, { suffix = "" } = {}) {
  const sentence = fetchedAt
    ? `Rows read ${relativeAge(fetchedAt)}.`
    : "The read model did not report when these rows were read, so their age is unknown.";
  return el("p", "ads-screen-note", suffix ? `${sentence} ${suffix}` : sentence);
}

export function relativeAge(date, now = Date.now()) {
  // Timestamps arrive three ways here: an ISO string from the context record, a
  // Date built by a banner, and the epoch milliseconds the reader envelope
  // carries. All three have to mean the same thing.
  const t = date instanceof Date ? date.getTime() : typeof date === "number" ? date : Date.parse(String(date || ""));
  if (!Number.isFinite(t)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 90) return "less than a minute ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The preview banner. Unmissable, and impossible for a screen to forget,
 *  because the workspace renders it above every preview screen. */
export function previewBanner({ onExit = null, size = "small", onSize = null } = {}) {
  const banner = el("div", "ads-banner ads-banner-preview");
  banner.dataset.tone = "preview";
  banner.setAttribute("role", "status");
  banner.append(svg(ICONS.eye, { size: 13, width: 1.8 }));
  const text = el("span", "");
  text.append(
    el("strong", "", "Preview"),
    document.createTextNode(" — synthetic sample rows for rehearsal. Not live business data, not connected to any ad account."),
  );
  banner.append(text);
  if (onSize) {
    banner.append(
      segmented(
        [
          { id: "small", label: "Small set" },
          { id: "large", label: "Large set" },
        ],
        size,
        (id) => onSize(id),
        { label: "Preview dataset size", size: "sm" },
      ),
    );
  }
  if (onExit) banner.append(button("Exit preview", { onClick: onExit, title: "Return to the real read model. Unconnected screens will show Not connected." }));
  return banner;
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

/**
 * The record panel. Slides from the trailing edge, keeps the list behind it so
 * an operator never loses their place, closes on Escape, and traps Tab inside
 * itself while open.
 */
export function createDrawer({ host, title = "Details", onClose = null }) {
  const scrim = el("div", "ads-drawer-scrim");
  scrim.hidden = true;
  const panel = el("aside", "ads-drawer");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", title);
  const head = el("header", "ads-drawer-head");
  const heading = el("h3", "ads-drawer-title", title);
  heading.tabIndex = -1;
  const closeBtn = button("", { icon: ICONS.close, onClick: () => close(), ariaLabel: "Close details", variant: "quiet" });
  head.append(heading, closeBtn);
  const body = el("div", "ads-drawer-body");
  panel.append(head, body);
  host.append(scrim, panel);
  let open = false;

  function onKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }

  function close({ restoreFocus = true } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    scrim.hidden = true;
    panel.classList.remove("is-open");
    document.removeEventListener("keydown", onKey, true);
    if (restoreFocus) lastFocus?.focus?.();
    onClose?.();
  }

  let lastFocus = null;

  function show(render, { focus = true } = {}) {
    lastFocus = document.activeElement;
    clear(body);
    render(body, close);
    open = true;
    scrim.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-open"));
    document.addEventListener("keydown", onKey, true);
    if (focus) heading.focus({ preventScroll: true });
  }

  scrim.addEventListener("click", () => close());

  return Object.freeze({ show, close, panel, body, setTitle: (text) => { heading.textContent = text; }, isOpen: () => open });
}

// ---------------------------------------------------------------------------
// Small layout helpers
// ---------------------------------------------------------------------------

export function block(title, { actions = [], note = "" } = {}) {
  const section = el("section", "ads-block");
  const head = el("div", "ads-block-head");
  head.append(el("h3", "ads-block-title", title));
  if (note) head.append(el("p", "ads-block-note", note));
  if (actions.length) {
    const bar = el("div", "ads-block-actions");
    for (const action of actions) bar.append(action);
    head.append(bar);
  }
  section.append(head);
  return section;
}

export function definitionRow(term, description) {
  const row = el("div", "ads-def-row");
  row.append(el("dt", "", term), el("dd", "", description));
  return row;
}

/** Accessible name for a control that only shows an icon. */
export function visuallyHidden(text) {
  return el("span", "ads-sr", text);
}
