// The table engine the Ads screens share.
//
// A pro management table has to survive 900 rows without becoming a spreadsheet
// and 7 rows without looking empty. This one does four things and refuses the
// rest: it sorts, it lets the reader choose the columns, it selects rows for
// bulk work, and it pages. Every number is right-aligned with tabular figures so
// columns can be compared by eye down the page.
//
// Keyboard contract: the header cells are real buttons inside the table, the
// rows are reachable with Tab, Space toggles selection, Enter opens the record,
// and the header announces its sort through aria-sort. Nothing here is
// mouse-only.

import { el, clear, svg, ICONS, button, popover, menuItem, menuGroup, segmented } from "./ads-ui.js";

export const PAGE_SIZES = Object.freeze([25, 50, 100, 200]);

/** A column is declarative: it knows how to render and how to sort. Nothing
 *  else in the app reaches into a row's shape.
 *
 *  `identity` marks the one cell that says which record the row *is* (its name
 *  and its immutable id). On a phone that cell is pinned to the leading edge
 *  while the rest of the table scrolls, because a row whose subject has
 *  scrolled away is a row of numbers with no referent. */
export function column({ id, label, align = "start", width = "", sortable = true, title = "", render, sortValue = null, metric = null, sticky = false, identity = false }) {
  return Object.freeze({ id, label, align, width, sortable, title, render, sortValue, metric, sticky, identity });
}

/**
 * Sort rows by a column. Missing values always sink to the bottom regardless of
 * direction: an operator scanning for the worst cost per result should not have
 * to page past blanks to find it, and blanks are not zero.
 */
export function sortRows(rows, columns, sort) {
  if (!sort || !sort.id) return rows;
  const col = columns.find((c) => c.id === sort.id);
  if (!col) return rows;
  const dir = sort.dir === "desc" ? -1 : 1;
  const value = (row) => {
    if (col.sortValue) return col.sortValue(row);
    const raw = row?.[col.id];
    return typeof raw === "number" ? raw : raw === null || raw === undefined ? null : String(raw).toLowerCase();
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = value(a.row);
      const bv = value(b.row);
      const aMissing = av === null || av === undefined || av === "";
      const bMissing = bv === null || bv === undefined || bv === "";
      if (aMissing && bMissing) return a.index - b.index;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}
/**
 * Selection model with shift-range support, because an operator who wants rows
 * 3 to 40 should click twice, not thirty-eight times.
 *
 * Two different sets are tracked deliberately, because "select this page" and
 * "select every matching row" are different decisions with different blast
 * radii, and an interface that blurs them is how someone pauses 900 campaigns
 * while looking at 50:
 *
 *   page     — the rows actually rendered on the current page
 *   matching — every row the current filters leave in the result set
 *
 * The header checkbox and Select this page act on `page`. Selecting the whole
 * matching set is a separate, named action that states the count first.
 */
export function createSelection({ rows = [], getKey = (row) => String(row?.id ?? "") } = {}) {
  const selected = new Set();
  let anchor = null;
  let page = [];
  let matching = Array.isArray(rows) ? rows : [];

  function keysOf(list) {
    return list.map((row) => getKey(row)).filter(Boolean);
  }

  return {
    has(key) {
      return selected.has(String(key));
    },
    /** The rows the current filters leave in the result set. Selecting all of
     *  them is always a separate, explicit action. */
    setMatching(list) {
      matching = Array.isArray(list) ? list : [];
    },
    /** The rows rendered on the current page, reported by the table itself on
     *  every render so a page change can never leave this stale. */
    setPage(list) {
      page = Array.isArray(list) ? list : [];
    },
    matchingKeys() {
      return keysOf(matching);
    },
    pageKeys() {
      return keysOf(page);
    },
    matchingSize() {
      return keysOf(matching).length;
    },
    pageSize() {
      return keysOf(page).length;
    },
    keys() {
      return Array.from(selected);
    },
    size() {
      return selected.size;
    },
    count() {
      return selected.size;
    },
    /** True when every row on this page is selected. */
    isAllPageSelected() {
      const keys = keysOf(page);
      return keys.length > 0 && keys.every((k) => selected.has(k));
    },
    isSomePageSelected() {
      const keys = keysOf(page);
      return keys.some((k) => selected.has(k)) && !keys.every((k) => selected.has(k));
    },
    /** True when every row the filters leave selected is selected too. */
    isAllMatchingSelected() {
      const keys = keysOf(matching);
      return keys.length > 0 && keys.every((k) => selected.has(k));
    },
    /** Selected rows that the table is not currently showing, so a bulk action
     *  can say how many rows it would touch that the operator cannot see. */
    hiddenKeys() {
      const onPage = new Set(keysOf(page));
      return Array.from(selected).filter((key) => !onPage.has(key));
    },
    toggle(key, { shift = false } = {}) {
      const k = String(key);
      if (shift && anchor && anchor !== k) {
        // Ranges are computed against the rendered page, so a shift-click can
        // never sweep in a row that is not on screen.
        const keys = keysOf(page);
        const from = keys.indexOf(anchor);
        const to = keys.indexOf(k);
        if (from !== -1 && to !== -1) {
          const [low, high] = from < to ? [from, to] : [to, from];
          const turningOn = !selected.has(k);
          for (let i = low; i <= high; i += 1) {
            if (turningOn) selected.add(keys[i]);
            else selected.delete(keys[i]);
          }
          return;
        }
      }
      if (selected.has(k)) selected.delete(k);
      else selected.add(k);
      anchor = k;
    },
    /** Select or clear exactly the rows on this page. */
    selectPage(on) {
      for (const key of keysOf(page)) {
        if (on) selected.add(key);
        else selected.delete(key);
      }
    },
    /** Select every row the current filters match, including rows on other
     *  pages. Only ever called from a named action that stated the count. */
    selectMatching() {
      for (const key of keysOf(matching)) selected.add(key);
    },
    clear() {
      selected.clear();
      anchor = null;
    },
    /** Keep only keys still present, so a filter change cannot silently carry a
     *  hidden row into a bulk action. */
    retain(availableKeys) {
      const allowed = new Set(availableKeys.map(String));
      for (const key of Array.from(selected)) if (!allowed.has(key)) selected.delete(key);
    },
  };
}

/**
 * Build the table.
 *
 * `state` is mutated in place by the caller's handlers and re-read on render,
 * which keeps this function free of its own copy of the truth.
 */
export function createTable({
  columns,
  rows,
  getKey = (row) => String(row?.id ?? ""),
  state = {},
  onSort = null,
  onColumnsChange = null,
  onRowActivate = null,
  selection = null,
  onSelectionChange = null,
  renderRowMeta = null,
  emptyNode = null,
  labelledBy = "",
  rowTone = null,
  footerExtra = null,
} = {}) {
  const wrap = el("div", "ads-table-wrap");
  const scroller = el("div", "ads-table-scroll");
  const table = el("table", "ads-table");
  if (labelledBy) table.setAttribute("aria-labelledby", labelledBy);
  const thead = el("thead");
  const headRow = el("tr");
  const tbody = el("tbody");
  // The header row has to be attached to the table; without it every column
  // heading renders into a detached node and the table loses its sort controls,
  // its column labels and its aria-sort entirely.
  thead.append(headRow);
  table.append(thead, tbody);
  scroller.append(table);
  wrap.append(scroller);

  const footer = el("div", "ads-table-foot");
  wrap.append(footer);

  // Read paging from `state` on every render. Capturing it once meant the pager
  // wrote state that the render path never saw, so the page never changed.
  const currentPageSize = () => (PAGE_SIZES.includes(state.pageSize) ? state.pageSize : 50);
  const currentPage = () => Math.max(0, Number(state.page) || 0);

  function renderHead() {
    clear(headRow);
    if (selection) {
      const th = el("th", "ads-th ads-th-select");
      th.scope = "col";
      th.dataset.role = "select";
      const box = el("input", "ads-check");
      box.type = "checkbox";
      box.setAttribute("aria-label", "Select every row on this page");
      box.checked = selection.isAllPageSelected();
      box.indeterminate = selection.isSomePageSelected();
      box.addEventListener("change", () => {
        selection.selectPage(box.checked);
        onSelectionChange?.(selection);
      });
      th.append(box);
      headRow.append(th);
    }
    for (const col of columns) {
      const th = el("th", `ads-th ads-th-${col.align}${col.sticky ? " is-sticky" : ""}`);
      th.scope = "col";
      if (col.identity) th.dataset.role = "identity";
      if (col.width) th.style.width = typeof col.width === "number" ? `${col.width}px` : col.width;
      const active = state.sort?.id === col.id;
      th.setAttribute("aria-sort", active ? (state.sort.dir === "desc" ? "descending" : "ascending") : "none");
      if (col.sortable) {
        const btn = el("button", `ads-th-btn${active ? " is-on" : ""}`);
        btn.type = "button";
        btn.append(el("span", "", col.label));
        btn.append(svg(active && state.sort.dir === "desc" ? ICONS.arrowDown : active ? ICONS.arrowUp : ICONS.arrowUp, { size: 11, width: 2 }));
        btn.querySelector("svg").classList.add(active ? "ads-th-arrow-on" : "ads-th-arrow");
        btn.title = col.title || `Sort by ${col.label}`;
        btn.addEventListener("click", () => {
          const dir = active && state.sort.dir === "desc" ? "asc" : "desc";
          state.sort = { id: col.id, dir };
          state.page = 0;
          onSort?.(state.sort);
          render();
        });
        th.append(btn);
      } else {
        th.append(el("span", "ads-th-label", col.label));
      }
      headRow.append(th);
    }
    if (renderRowMeta) {
      const th = el("th", "ads-th ads-th-end");
      th.scope = "col";
      th.dataset.role = "action";
      th.append(el("span", "ads-visually-hidden", "Actions"));
      headRow.append(th);
    }
  }

  function renderBody(sorted) {
    clear(tbody);
    // Clamp so that shrinking the result set (a filter, or a page-size change
    // while deep in the list) cannot leave the reader on an empty page.
    const pageSize = currentPageSize();
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(currentPage(), pages - 1);
    state.page = page;
    const start = page * pageSize;
    const pageRows = sorted.slice(start, start + pageSize);
    // The table is the only thing that knows which rows it actually rendered,
    // so it tells the selection on every render. "Select this page" and the
    // header checkbox then mean exactly what they say.
    selection?.setPage(pageRows);
    if (!pageRows.length) {
      const tr = el("tr");
      const td = el("td", "ads-td ads-td-empty");
      td.colSpan = columns.length + (selection ? 1 : 0) + (renderRowMeta ? 1 : 0);
      td.append(emptyNode || el("p", "ads-empty-line", "No rows match the current filters."));
      tr.append(td);
      tbody.append(tr);
      return;
    }
    for (const row of pageRows) {
      const key = getKey(row);
      const tr = el("tr", "ads-tr");
      tr.dataset.key = key;
      const tone = rowTone?.(row);
      if (tone) tr.dataset.tone = tone;
      if (selection?.has(key)) tr.dataset.selected = "true";

      if (selection) {
        const td = el("td", "ads-td ads-td-select");
        td.dataset.role = "select";
        const box = el("input", "ads-check");
        box.type = "checkbox";
        box.checked = selection.has(key);
        box.setAttribute("aria-label", `Select ${row?.name || key}`);
        box.addEventListener("click", (event) => event.stopPropagation());
        box.addEventListener("change", (event) => {
          selection.toggle(key, { shift: event.shiftKey });
          onSelectionChange?.(selection);
          render();
        });
        td.append(box);
        tr.append(td);
      }

      for (const col of columns) {
        const td = el("td", `ads-td ads-td-${col.align}${col.sticky ? " is-sticky" : ""}`);
        if (col.metric) td.dataset.metric = col.metric;
        // The role is data, not styling: the phone layout pins the identity cell
        // and the decision cell without this module knowing the stylesheet.
        if (col.identity) td.dataset.role = "identity";
        const content = col.render ? col.render(row) : row?.[col.id];
        if (content instanceof Node) td.append(content);
        else td.append(document.createTextNode(content === null || content === undefined ? "—" : String(content)));
        tr.append(td);
      }

      if (renderRowMeta) {
        const td = el("td", "ads-td ads-td-end");
        td.dataset.role = "action";
        td.append(renderRowMeta(row));
        tr.append(td);
      }

      if (onRowActivate) {
        tr.tabIndex = 0;
        tr.addEventListener("click", (event) => {
          if (event.target.closest("input, button, a, select")) return;
          onRowActivate(row, { event });
        });
        tr.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onRowActivate(row, { event });
          }
          if (event.key === " " && selection) {
            event.preventDefault();
            selection.toggle(key, { shift: event.shiftKey });
            onSelectionChange?.(selection);
            render();
          }
        });
      } else if (selection) {
        tr.tabIndex = 0;
        tr.addEventListener("keydown", (event) => {
          if (event.key === " ") {
            event.preventDefault();
            selection.toggle(key, { shift: event.shiftKey });
            onSelectionChange?.(selection);
            render();
          }
        });
      }
      tbody.append(tr);
    }
  }

  function renderFooter(total, sorted) {
    clear(footer);
    const pageSize = currentPageSize();
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(currentPage(), pages - 1);
    const start = sorted.length ? page * pageSize + 1 : 0;
    const end = Math.min(sorted.length, (page + 1) * pageSize);
    const range = el("span", "ads-foot-range", sorted.length ? `${start.toLocaleString("en-GB")}–${end.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}` : "No rows");
    footer.append(range);
    if (footerExtra) footer.append(footerExtra(sorted));
    const controls = el("div", "ads-foot-controls");
    controls.append(
      segmented(
        PAGE_SIZES.map((size) => ({ id: String(size), label: String(size) })),
        String(pageSize),
        (id) => {
          state.pageSize = Number(id);
          state.page = 0;
          render();
        },
        { label: "Rows per page", size: "sm" },
      ),
    );
    if (pages > 1) {
      const pager = el("div", "ads-pager");
      const prev = button("", { icon: ICONS.chevronRight, variant: "quiet", ariaLabel: "Previous page", onClick: () => { state.page = Math.max(0, currentPage() - 1); render(); } });
      prev.querySelector("svg")?.setAttribute("style", "transform:rotate(180deg)");
      prev.disabled = page === 0;
      const next = button("", { icon: ICONS.chevronRight, variant: "quiet", ariaLabel: "Next page", onClick: () => { state.page = Math.min(pages - 1, currentPage() + 1); render(); } });
      next.disabled = page >= pages - 1;
      pager.append(prev, el("span", "ads-page-count", `${page + 1} / ${pages}`), next);
      controls.append(pager);
    }
    footer.append(controls);
  }

  function render() {
    renderHead();
    const sorted = sortRows(rows, columns, state.sort);
    renderBody(sorted);
    renderFooter(rows.length, sorted);
    return wrap;
  }

  render();
  return Object.freeze({
    node: wrap,
    render,
    scrollToTop() {
      scroller.scrollTop = 0;
    },
  });
}

/**
 * The column chooser. A checkbox list plus a reset, in a popover anchored to
 * its button so it reads as part of the table header rather than a modal.
 */
export function columnChooser({ all, active, onChange, label = "Columns" }) {
  const trigger = button(label, { icon: ICONS.columns, title: "Choose which columns this table shows" });
  trigger.setAttribute("aria-expanded", "false");
  return popover({
    trigger,
    label: "Choose columns",
    align: "end",
    width: 260,
    render(panel, close) {
      const group = menuGroup("Show columns");
      // The first column is the row's name and stays; a table without it is a
      // list of numbers with no referent.
      for (const col of all) {
        if (col === all[0]) continue;
        group.append(
          menuItem(col, {
            checked: active.includes(col),
            onClick: () => {
              const next = active.includes(col) ? active.filter((c) => c !== col) : [...active, col];
              if (!next.length) return;
              onChange(next);
            },
          }),
        );
      }
      panel.append(group);
      const foot = el("div", "ads-menu-foot");
      foot.append(
        button("Reset to default", {
          variant: "quiet",
          onClick: () => {
            onChange(null);
            close();
          },
        }),
      );
      panel.append(foot);
    },
  });
}

/**
 * The sort control shown on narrow viewports, where the header row is not
 * visible. A table whose sort is only reachable by clicking a header is
 * unusable on a phone.
 */
export function sortControl(columnOptions, sort, onChange) {
  const trigger = button("Sort", { icon: ICONS.arrowUp, title: "Sort this table" });
  return popover({
    trigger,
    label: "Sort",
    align: "end",
    width: 240,
    render(panel, close) {
      const group = menuGroup("Sort by");
      for (const col of columnOptions) {
        const active = sort?.id === col.id;
        group.append(
          menuItem(col.label, {
            checked: active,
            hint: active ? (sort.dir === "desc" ? "Descending" : "Ascending") : "",
            onClick: () => {
              const dir = active && sort.dir === "desc" ? "asc" : "desc";
              onChange({ id: col.id, dir });
              if (active) close();
            },
          }),
        );
      }
      panel.append(group);
    },
  });
}
