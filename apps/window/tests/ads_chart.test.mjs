// The one chart on the Ads overview.
//
// `DESIGN.md` allows the overview exactly one chart and forbids a chart wall,
// and the reviewed build shipped the CSS for that chart with no code behind it:
// `.ads-chart*` had thirteen rules in `web/ads.css` and zero references from
// `web/js/`. These tests exist because the interesting failures are all quiet
// ones:
//
//   * a chart per metric, which is the chart wall the design forbids;
//   * a reader that has not answered rendering a series anyway, which is a
//     fabricated claim about the owner's money;
//   * a day whose figure is missing being drawn as a day of zero delivery;
//   * two series of different units sharing one scale, so a reader compares a
//     bar against a line that was never on the same axis;
//   * colour carrying the meaning on its own, with no series named anywhere.
//
// Rule-level, and no browser: the workspace builds its nodes through
// `document.createElement`, so a minimal element shape is enough to mount the
// real Overview screen and count what it renders. The interactive journeys live
// in `acceptance/ads_journey.py`, which drives the same modules in Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ------------------------------------------------------------ fake DOM --- */

class FakeNode {
  constructor(tag, namespaceURI = "") {
    this.tagName = String(tag).toLowerCase();
    this.namespaceURI = namespaceURI;
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.parent = null;
    this.textContent = "";
    this.title = "";
    this.hidden = false;
    this.handlers = {};
    this.classList = {
      add: (...names) => {
        this.className = [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" ");
      },
      remove: (...names) => {
        this.className = this.className.split(" ").filter((name) => name && !names.includes(name)).join(" ");
      },
      contains: (name) => this.className.split(" ").includes(name),
    };
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get childElementCount() {
    return this.children.length;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  removeChild(node) {
    this.children = this.children.filter((child) => child !== node);
    node.parent = null;
    return node;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  addEventListener(type, handler) {
    (this.handlers[type] ||= []).push(handler);
  }
  removeEventListener(type, handler) {
    this.handlers[type] = (this.handlers[type] || []).filter((entry) => entry !== handler);
  }
  focus() {}
  blur() {}
}

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (namespaceURI, tag) => new FakeNode(tag, namespaceURI),
  createTextNode: (text) => Object.assign(new FakeNode("#text"), { textContent: text }),
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
};
globalThis.requestAnimationFrame = (callback) => callback();

const { createOverviewScreen } = await import("../web/js/ads/ads-overview.js");
const { chartReadiness, overviewDeliveryChart, plotPoints, MIN_PLOT_DAYS } = await import("../web/js/ads/ads-chart.js");

/* --------------------------------------------------------------- helpers --- */

const walk = (node, visit) => {
  visit(node);
  for (const child of node.children) walk(child, visit);
};

const collect = (root, predicate) => {
  const found = [];
  walk(root, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
};

const hasClass = (node, name) => String(node.className || "").split(/\s+/).includes(name);

/** Every string the subtree renders, in document order. */
const textOf = (root) => {
  let out = "";
  walk(root, (node) => {
    if (node.textContent) out += `${node.textContent} `;
  });
  return out;
};

const chartSlots = (root) => collect(root, (node) => node.dataset && node.dataset.adsChart);
const plotFigures = (root) => collect(root, (node) => node.tagName === "svg" && hasClass(node, "ads-chart"));

/* -------------------------------------------------------------- fixtures --- */

const envelope = (rows, { status = "ready", fetchedAt = 1_700_000_000_000, detail = "", failedStatus = "" } = {}) => ({
  status,
  data: { rows, meta: {} },
  detail,
  fetchedAt,
  failedStatus,
  origin: "live",
  cached: false,
});

const record = (payload, { status = "ready", fetchedAt = 1_700_000_000_000, detail = "" } = {}) => ({
  status,
  data: { rows: null, meta: payload },
  detail,
  fetchedAt,
  failedStatus: "",
  origin: "live",
  cached: false,
});

/** The exact answer `owner_ads.py` gives every reader in this build. */
const notConnected = (reader) => ({
  status: "not_connected",
  data: null,
  detail: `${reader} needs a completed reporting sync for the selected window`,
  fetchedAt: null,
  failedStatus: "",
  origin: "live",
  cached: false,
});

const emptyEntities = () => ({ campaign: envelope([]), adset: envelope([]), ad: envelope([]) });

const sources = (over = {}) => ({
  context: record({ account: { currency: "GBP" }, sync: { status: "ready", lastSuccessAt: "2026-09-14T07:00:00.000Z" } }),
  overview: record({ totals: { spend: 100, results: 40 }, series: [] }),
  entities: emptyEntities(),
  creatives: envelope([]),
  blogs: envelope([]),
  tracking: record({ templates: [], validation: [], history: [] }),
  queue: record({ batches: [], activity: [], changes: [] }),
  ...over,
});

const days = (spec) => spec.map(([date, spend, results]) => ({ date, spend, results }));

/** Mount the real Overview screen against controlled reader answers. */
async function mountOverview(sourcesUnderTest) {
  const host = new FakeNode("div");
  const ctx = {
    params: { from: "2026-09-01", to: "2026-09-14" },
    context: sourcesUnderTest.context,
    drafts: { list: () => [], save: () => ({ changes: { rows: [] } }) },
    isPreview: () => false,
    say: () => {},
    refresh: () => {},
    openDraft: () => {},
    openPublish: () => {},
    reader: {
      read: async (reader, params = {}) => (reader === "entities" ? sourcesUnderTest.entities[params.level] : sourcesUnderTest[reader]),
    },
  };
  const screen = createOverviewScreen(ctx, host);
  await screen.settled();
  return screen;
}

const plottedSources = () =>
  sources({
    overview: record({
      totals: { spend: 100, results: 40 },
      series: days([
        ["2026-09-01", 10, 4],
        ["2026-09-02", 20, 9],
        ["2026-09-03", 30, 12],
        ["2026-09-04", 40, 15],
      ]),
    }),
  });

/* ------------------------------------------------- exactly one chart --- */

test("the overview carries exactly one chart, whatever the rows are", async () => {
  const screen = await mountOverview(plottedSources());
  const slots = chartSlots(screen.node);
  assert.equal(slots.length, 1, "one chart slot on the overview, never one per metric");
  assert.equal(slots[0].dataset.state, "plotted");
  assert.equal(plotFigures(screen.node).length, 1, "one plotted figure inside that slot");

  // The wall the design forbids: no per-metric sparkline anywhere on this
  // screen. The stat-tile sparkline exists, and the overview must not use it.
  assert.equal(collect(screen.node, (node) => hasClass(node, "ads-spark")).length, 0, "no sparkline wall");
});

test("more rows do not buy more charts", async () => {
  const many = sources({
    overview: record({
      totals: { spend: 100, results: 40 },
      series: days([
        ["2026-09-01", 10, 4],
        ["2026-09-02", 20, 9],
      ]),
    }),
    entities: {
      campaign: envelope([
        { id: "cmp_1", internalId: "cmp_1", level: "campaign", name: "One", state: "delivering", spend: 50, results: 20, linkClicks: 400, impressions: 9000 },
        { id: "cmp_2", internalId: "cmp_2", level: "campaign", name: "Two", state: "delivering", spend: 50, results: 20, linkClicks: 400, impressions: 9000 },
        { id: "cmp_3", internalId: "cmp_3", level: "campaign", name: "Three", state: "delivering", spend: 50, results: 20, linkClicks: 400, impressions: 9000 },
      ]),
      adset: envelope([]),
      ad: envelope([]),
    },
  });
  const screen = await mountOverview(many);
  assert.equal(chartSlots(screen.node).length, 1);
  assert.equal(plotFigures(screen.node).length, 1);
});

/* ------------------------------------------------ the honest states --- */

test("an overview reader that is not connected is drawn as not connected, with no number in sight", async () => {
  const screen = await mountOverview(sources({ overview: notConnected("overview") }));
  const slots = chartSlots(screen.node);
  assert.equal(slots.length, 1, "the slot is still there: a screen with nothing to plot says so where the chart lives");
  assert.equal(slots[0].dataset.state, "not_connected");
  assert.equal(plotFigures(screen.node).length, 0, "no figure is drawn from a read that never answered");
  assert.equal(collect(screen.node, (node) => ["rect", "polyline", "circle"].includes(node.tagName)).length, 0, "not one plot mark");

  const text = textOf(slots[0]);
  assert.doesNotMatch(text, /\d/, `the not-connected chart prints no figure at all: ${text}`);
  assert.match(text, /reporting sync/, "it names what would connect it");
  assert.match(text, /[Nn]o sample numbers/, "it says outright that nothing was substituted");
});

test("the whole screen being unconnected never reaches for a fabricated series", async () => {
  const screen = await mountOverview(
    sources({
      context: notConnected("context"),
      overview: notConnected("overview"),
      entities: { campaign: notConnected("entities"), adset: notConnected("entities"), ad: notConnected("entities") },
      creatives: notConnected("creatives"),
      blogs: notConnected("blogs"),
      tracking: notConnected("tracking"),
      queue: notConnected("queue"),
    }),
  );
  assert.equal(chartSlots(screen.node).length, 0, "the screen's own not-connected panel stands in for the chart");
  assert.equal(plotFigures(screen.node).length, 0);
  assert.equal(collect(screen.node, (node) => ["rect", "polyline", "circle"].includes(node.tagName)).length, 0);
});

test("a read that answered without enough days says so instead of drawing a trend through one point", async () => {
  const screen = await mountOverview(sources({ overview: record({ totals: { spend: 10, results: 4 }, series: days([["2026-09-01", 10, 4]]) }) }));
  const slots = chartSlots(screen.node);
  assert.equal(slots[0].dataset.state, "insufficient");
  assert.equal(plotFigures(screen.node).length, 0);
  const text = textOf(slots[0]);
  assert.match(text, /Not enough days/, "it names the reason");
  assert.match(text, /1 dated day/, "it prints the real count it carried, not a stand-in");
  assert.doesNotMatch(text, /peak/, "no series is summarised that was never drawn");
});

test("a read with no daily rows at all is not read as a window with no delivery", async () => {
  const screen = await mountOverview(sources({ overview: record({ totals: { spend: 0, results: 0 }, series: [] }) }));
  const slots = chartSlots(screen.node);
  assert.equal(slots[0].dataset.state, "insufficient");
  assert.match(textOf(slots[0]), /no dated daily rows/, "it distinguishes an absent series from a flat one");
});

/* -------------------------------------------- what the figure draws --- */

test("a day whose figure is missing is a gap, not a day of zero delivery", () => {
  const readiness = chartReadiness({ series: days([["2026-09-01", 10, 4], ["2026-09-02", null, null], ["2026-09-03", 30, 12]]) });
  assert.equal(readiness.state, "plotted");
  assert.equal(readiness.spendDays, 2);
  assert.equal(readiness.resultDays, 2);

  const section = overviewDeliveryChart({ series: days([["2026-09-01", 10, 4], ["2026-09-02", null, null], ["2026-09-03", 30, 12]]) }, { currency: "GBP" });
  const bars = collect(section, (node) => hasClass(node, "ads-chart-bar"));
  assert.equal(bars.length, 2, "two bars for two days that carry a spend figure, not three");
  for (const bar of bars) assert.notEqual(bar.getAttribute("height"), "0.00", "a missing day is never drawn as a zero bar");
  assert.match(textOf(section), /1 of these days carry no spend figure/, "the gap is stated in words as well");
});

test("a gap in the results breaks the line instead of being bridged across it", () => {
  const section = overviewDeliveryChart(
    { series: days([["2026-09-01", 10, 4], ["2026-09-02", 10, 5], ["2026-09-03", 10, null], ["2026-09-04", 10, 7]]) },
    { currency: "GBP" },
  );
  assert.equal(collect(section, (node) => hasClass(node, "ads-chart-line")).length, 1, "only the run before the gap is a line");
  assert.equal(collect(section, (node) => hasClass(node, "ads-chart-point")).length, 3, "the days that carry a count keep their point");
  assert.match(textOf(section), /the line breaks there/, "and the break is explained");
});

test("the two series are drawn on their own scales and both are named", () => {
  const section = overviewDeliveryChart({ series: days([["2026-09-01", 10, 4], ["2026-09-02", 20, 9]]) }, { currency: "GBP" });
  const legend = collect(section, (node) => hasClass(node, "ads-chart-legend"))[0];
  const labels = collect(legend, (node) => hasClass(node, "ads-chart-legend-label")).map((node) => node.textContent);
  assert.deepEqual(labels, ["Spend", "Meta-attributed results"], "colour is never the only evidence: both series are named");

  // Each named series carries the source of its own number.
  assert.equal(collect(legend, (node) => hasClass(node, "ads-source")).length, 2);
  // The swatch shape matches the mark, so the legend survives greyscale.
  assert.equal(collect(legend, (node) => hasClass(node, "ads-chart-swatch-bar")).length, 1);
  assert.equal(collect(legend, (node) => hasClass(node, "ads-chart-swatch-line")).length, 1);
  assert.match(textOf(section), /not comparable with the height of the line/, "it refuses the comparison the panels would invite");
});

test("the figure is labelled for a reader who cannot see it", () => {
  const section = overviewDeliveryChart({ series: days([["2026-09-01", 10, 4], ["2026-09-02", 20, 9]]) }, { currency: "GBP" });
  const figure = collect(section, (node) => node.tagName === "svg")[0];
  assert.equal(figure.getAttribute("role"), "img");
  const label = figure.getAttribute("aria-label");
  assert.match(label, /Daily delivery across 2 days/);
  assert.match(label, /peaking at/, "the label carries the real peak, not a placeholder");
  assert.equal(collect(section, (node) => hasClass(node, "ads-sr")).length, 1, "the same summary is available as text");
});

test("the currency the account has not answered with is not borrowed", () => {
  const section = overviewDeliveryChart({ series: days([["2026-09-01", 10, 4], ["2026-09-02", 20, 9]]) }, { currency: "" });
  assert.match(textOf(section), /currency unknown/, "an unknown unit is said, not guessed");
});

/* --------------------------------------------------- the palette --- */

test("the chart is drawn in the semantic chart palette and adds no accent", () => {
  const css = readFileSync(new URL("../web/ads.css", import.meta.url), "utf8");
  const rule = (selector) => {
    const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `${selector} is styled`);
    return match[1];
  };
  assert.match(rule(".ads-chart-bar"), /fill:\s*var\(--chart-1\)/, "the bars take a chart-palette token");
  assert.match(rule(".ads-chart-line"), /stroke:\s*var\(--chart-2\)/, "the line takes a different chart-palette token");
  assert.match(rule(".ads-chart-swatch-bar"), /background:\s*var\(--chart-1\)/, "the swatch matches the bar");
  assert.match(rule(".ads-chart-swatch-line"), /background:\s*var\(--chart-2\)/, "the swatch matches the line");
  assert.doesNotMatch(rule(".ads-chart-bar"), /--mark/, "the brand red is not repurposed as a series colour");
  assert.doesNotMatch(rule(".ads-chart-line"), /--mark/);
  // The new rules are scoped, so no other Frank surface can pick them up.
  for (const selector of [".ads-workspace .ads-chart-point", ".ads-workspace .ads-chart-xaxis", ".ads-workspace .ads-chart-note"]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${selector} is scoped to the workspace`);
  }
});

/* ------------------------------------------------------ the read --- */

test("the chart reads its days from the reader's own series and invents none", () => {
  assert.deepEqual(plotPoints(null), []);
  assert.deepEqual(plotPoints({}), []);
  assert.deepEqual(plotPoints({ series: [{ spend: 10, results: 4 }] }), [], "a point without a date is not a day");
  assert.deepEqual(plotPoints({ series: [{ date: "not-a-day", spend: 10 }] }), []);
  assert.deepEqual(
    plotPoints({ series: [{ date: "2026-09-02", spend: 20 }, { date: "2026-09-01", spend: 10 }] }).map((point) => point.date),
    ["2026-09-01", "2026-09-02"],
    "days are ordered as the window runs, not as the wire happened to send them",
  );
  assert.equal(plotPoints({ series: [{ date: "2026-09-01", spend: "12.5" }] })[0].spend, 12.5);
  assert.equal(plotPoints({ series: [{ date: "2026-09-01" }] })[0].spend, null, "an absent figure stays absent");
  assert.equal(MIN_PLOT_DAYS, 2);
});
