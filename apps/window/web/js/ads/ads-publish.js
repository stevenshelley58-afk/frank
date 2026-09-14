// The bulk publishing flow.
//
// Select creatives → configure campaign → map variations → tracking → review →
// queue.
//
// The single most important behaviour in this file is the combination counter.
// An operator who picks 20 creatives and 5 headlines must never discover
// afterwards that they created 100 ads. The product of the axes is computed
// before anything is staged, shown as an explicit equation, and the mode that
// multiplies them has to be chosen deliberately and confirmed.
//
// The second most important behaviour is honesty about the write boundary. This
// flow stages a draft and produces a reviewable queue entry. It does not claim
// to have created anything at the provider, because it cannot: publishing is a
// gated write that is not wired yet.

import {
  el,
  clear,
  button,
  chip,
  segmented,
  popover,
  menuItem,
  menuGroup,
  svg,
  ICONS,
  statusBadge,
  emptyPanel,
  skeleton,
  definitionRow,
} from "./ads-ui.js";
import { formatMoney, formatInt } from "./ads-contracts.js";
import { createSelection } from "./ads-table.js";
import { newAdsId, draftAdCount, draftScope, mergeMapping } from "./ads-drafts.js";
import { accountCurrency } from "./ads-views.js";
import { planDigest, reconcilePlanRows, versionIdFor } from "./ads-identity.js";

const PRESET_KEY = "frank.ads.presets.v1";

export const STEPS = Object.freeze([
  Object.freeze({ id: "select", label: "Select creatives" }),
  Object.freeze({ id: "configure", label: "Configure campaign" }),
  Object.freeze({ id: "map", label: "Map variations" }),
  Object.freeze({ id: "tracking", label: "Tracking" }),
  Object.freeze({ id: "review", label: "Review" }),
  Object.freeze({ id: "queue", label: "Queue" }),
]);

export const COMBINATION_MODES = Object.freeze([
  Object.freeze({
    id: "per_creative",
    label: "One ad per creative",
    note: "Each creative becomes one ad. The headlines and body text you chose travel with it as alternative text options inside that ad.",
  }),
  Object.freeze({
    id: "cross_product",
    label: "One ad per combination",
    note: "Every creative is paired with every headline and every body text. This multiplies, and the exact number is shown before anything is staged.",
  }),
]);

const PLACEMENT_SPECS = Object.freeze([
  Object.freeze({ id: "feed", label: "Feed", ratios: ["1:1", "4:5"], needsVideo: false }),
  Object.freeze({ id: "story", label: "Stories", ratios: ["9:16"], needsVideo: false }),
  Object.freeze({ id: "reels", label: "Reels", ratios: ["9:16"], needsVideo: true }),
  Object.freeze({ id: "right_column", label: "Right column", ratios: ["1:1"], needsVideo: false }),
]);

function readJson(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* best effort */
  }
}

/**
 * One copy axis, with the two rules that keep an advertised count honest:
 *
 *   * a blank or whitespace-only entry is not a variation. It is not copy, and
 *     multiplying by it invented ads that would have been created empty.
 *   * an axis with nothing in it contributes exactly one empty value, so a plan
 *     with no primary text still produces the ads the counter promises, each
 *     carrying no primary text, instead of collapsing to zero rows.
 */
export function axisValues(list = []) {
  const values = (Array.isArray(list) ? list : [])
    .map((value) => String(value ?? ""))
    .filter((value) => value.trim().length > 0);
  return values.length ? values : [""];
}

/**
 * Every ad a plan would create, in order. This is the single source of truth for
 * the plan: the number the flow advertises is `planAdRows(...).length`, and the
 * rows the queue stages are exactly these objects. When the counter and the
 * staging loop count independently, "20 ads" quietly becomes a different number
 * of queued rows — which is the one thing this flow exists to prevent.
 *
 * Each row carries identity, not description: the creative's own identity plus
 * one immutable planned-ad identity per variation, allocated once and carried
 * through every later edit (see ads-identity.js). A name, a position or a slug of
 * the copy is never part of it, so renaming a campaign, reordering the creatives
 * or rewording a headline cannot change what an ad is called in tracking.
 */
export function planAdRows({
  creatives = [],
  headlines = [],
  bodies = [],
  mode = "per_creative",
  mapping = {},
  problemsByCreative = null,
} = {}) {
  const rows = [];
  const headlinesAxis = axisValues(headlines);
  const bodiesAxis = axisValues(bodies);
  for (const creative of creatives) {
    const creativeKey = String(creative?.internalId || creative?.id || "");
    // The mapping's utm_content is the operator's readable *label* for this
    // creative. It is not an identity: every row gets its own immutable ad
    // identity, and the label is only ever reachable through `{{ad.label}}`.
    const label = String(mapping?.[creative?.id]?.utmContent || creativeKey).trim();
    const detail = (problemsByCreative?.get?.(creative?.name) || []).slice();
    const variations =
      mode === "cross_product" ? headlinesAxis.flatMap((headline) => bodiesAxis.map((body) => ({ headline, body }))) : [{ headline: "", body: "" }];
    for (const { headline, body } of variations) {
      rows.push(
        Object.freeze({
          // Identity arrives from `reconcilePlanRows`, which carries the
          // previous plan's identities forward instead of minting new ones.
          adId: "",
          id: "",
          key: "",
          trackingKey: "",
          label,
          creativeId: String(creative?.id ?? ""),
          creativeKey,
          // The rendition the ad would show, addressed by its own content so
          // the same asset names the same version everywhere it is planned.
          creativeVersionId: String(creative?.versionId || versionIdFor(creative)),
          creativeName: String(creative?.name ?? ""),
          headline,
          body,
          destination: String(mapping?.[creative?.id]?.destination || ""),
          utmContent: "",
          name:
            mode === "cross_product" && (headline || body)
              ? `${creative?.name ?? ""} — ${headline || "(no headline)"}${body ? ` — ${body.slice(0, 24)}` : ""}`
              : String(creative?.name ?? ""),
          problems: detail,
          detail: detail.join(" "),
        }),
      );
    }
  }
  return rows;
}

/**
 * The combination maths, isolated so it can be reasoned about and stated
 * plainly in the UI.
 *
 * `cross_product` multiplies every axis. `per_creative` keeps one ad per
 * creative and attaches the text as alternatives, so the count is the number of
 * creatives regardless of how many headlines were written.
 *
 * `total` is always `planAdRows(...).length`: the count and the rows cannot
 * disagree, because there is only one function that produces either.
 */
export function planAds({ creatives = [], headlines = [], bodies = [], mode = "per_creative", mapping = {}, previousRows = [] }) {
  const c = creatives.length;
  const headlinesAxis = axisValues(headlines);
  const bodiesAxis = axisValues(bodies);
  const h = headlinesAxis.filter(Boolean).length;
  const b = bodiesAxis.filter(Boolean).length;
  // Identities come from the previous plan wherever the row is recognisably the
  // same ad, so reopening the wizard, reordering the creatives or editing a
  // headline updates the plan instead of replacing every ad in it.
  const rows = reconcilePlanRows(previousRows, planAdRows({ creatives, headlines, bodies, mode, mapping }));
  const total = rows.length;
  const plural = (count, singular, pluralForm) => (count === 1 ? singular : pluralForm);
  const factors = [
    { id: "creatives", label: plural(c, "creative", "creatives"), count: c },
    { id: "headlines", label: plural(h || 1, "headline", "headlines"), count: h || 1, implied: h === 0 },
    { id: "bodies", label: plural(b || 1, "primary text", "primary texts"), count: b || 1, implied: b === 0 },
  ];
  const missing = [];
  if (h === 0) missing.push("headline");
  if (b === 0) missing.push("primary text");
  const missingNote = missing.length
    ? ` No ${missing.join(" or ")} copy is set yet, so each of those ads would carry none.`
    : "";
  if (mode === "cross_product") {
    return Object.freeze({
      mode,
      factors,
      rows,
      total,
      equation: `${c} × ${headlinesAxis.length} × ${bodiesAxis.length}`,
      multiplies: h > 1 || b > 1,
      // "One ad per creative" describes the per-creative mode. In cross-product
      // mode the axes are still axes, so the sentence states the real product
      // and names any copy that would be empty.
      note:
        total === c && !missing.length
          ? "One ad per creative, because only one headline and one body text are in play."
          : `This creates ${formatInt(total)} ads from ${c} creatives. Each one is a separate ad with its own delivery and its own reporting line.${missingNote}`,
    });
  }
  return Object.freeze({
    mode,
    factors,
    rows,
    total,
    equation: `${c} × 1`,
    multiplies: false,
    note:
      h > 1 || b > 1
        ? `${formatInt(c)} ads, each carrying ${h || 0} headline${h === 1 ? "" : "s"} and ${b || 0} primary text${b === 1 ? "" : "s"} as alternatives. The axes are not multiplied.`
        : `${formatInt(c)} ads.`,
  });
}

/**
 * Resolve one tracking value for one planned ad.
 *
 * `{{ad.internal_id}}` and `{{creative.internal_id}}` resolve to the ad's
 * immutable identity: the same value the queue, the draft and the approval
 * snapshot use, and the only value that is guaranteed distinct per variation.
 * `{{ad.label}}` resolves to the operator's readable label for the creative,
 * which is a label and not an identity — two variations can share one, so
 * validation flags a template that makes it the whole of `utm_content`.
 * `{{campaign.name}}` and `{{ad.name}}` stay available for the operator who
 * explicitly wants a display name, and validation warns about them.
 */
export function resolveTrackingValue(value, { row = null, campaignId = "", campaignName = "", audience = "" } = {}) {
  const rowKey = String(row?.trackingKey || row?.adId || row?.key || row?.creativeKey || "");
  const label = String(row?.label || row?.creativeKey || "");
  const creativeId = String(row?.creativeKey || row?.creativeId || "");
  const versionId = String(row?.creativeVersionId || creativeId);
  return String(value ?? "")
    .replace(/\{\{creative\.internal_id\}\}/g, rowKey)
    .replace(/\{\{ad\.internal_id\}\}/g, rowKey)
    .replace(/\{\{ad\.id\}\}/g, rowKey)
    .replace(/\{\{ad\.label\}\}/g, label)
    .replace(/\{\{creative\.version_id\}\}/g, versionId)
    .replace(/\{\{campaign\.internal_id\}\}/g, String(campaignId || "cmp_draft"))
    .replace(/\{\{(campaign|ad)\.name\}\}/g, String(campaignName || "unstable_name"))
    .replace(/\{\{platform\}\}/g, "meta")
    .replace(/\{\{audience\.key\}\}/g, String(audience || "").toLowerCase().replace(/[^a-z0-9]+/g, "_"));
}

/**
 * The tracking URL for one planned ad.
 *
 * The destination may already carry query parameters and a `#anchor`; both are
 * preserved, existing parameters are kept, and a parameter the template also
 * sets is replaced rather than appended a second time. An unparseable
 * destination returns an empty string, which validation turns into a blocking
 * problem instead of a URL that merely looks plausible.
 *
 * This is the only place a tracking URL is built, so the string that is
 * validated is exactly the string that is shown.
 */
export function buildTrackingUrl({ base = "", fields = [], row = null, campaignId = "", campaignName = "", audience = "" } = {}) {
  let url;
  try {
    url = new URL(String(base));
  } catch {
    return "";
  }
  for (const field of fields) {
    const key = String(field?.key || "").trim();
    if (!key) continue;
    const raw = String(field?.value ?? "");
    // An empty value is not written: an empty parameter is noise, not data.
    if (!raw.trim()) continue;
    url.searchParams.set(key, resolveTrackingValue(raw, { row, campaignId, campaignName, audience }));
  }
  return url.toString();
}

/**
 * Check the URLs that would actually ship, one per planned ad. Person-level
 * information has no business in a UTM, and two ads that resolve to the same
 * tracking identity are a reporting collision rather than two rows.
 */
export function validateTrackingUrls({ rows = [], fields = [], campaignId = "", campaignName = "", audience = "" } = {}) {
  const problems = [];
  const identities = new Map();
  // An address can arrive already percent-encoded, and a URL parameter is
  // decoded once when it is read back. Decoding before the check is what makes
  // `lead%40example.invalid` fail the same test as `lead@example.invalid`,
  // instead of passing as a harmless string with no "@" in it.
  const readable = (value) => {
    const text = String(value ?? "");
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  for (const row of rows) {
    const base = row.destination;
    if (!base) continue; // the plan-level missing-destination error already covers this
    const url = buildTrackingUrl({ base, fields, row, campaignId, campaignName, audience });
    if (!url) {
      problems.push({
        severity: "error",
        kind: "invalid_url",
        scope: "creative",
        scopeName: row.name,
        detail: `The destination "${base}" is not a URL a browser can open, so the tracking parameters cannot be applied to it.`,
      });
      continue;
    }
    const parsed = new URL(url);
    for (const [key, value] of parsed.searchParams) {
      const decoded = readable(value);
      if (/@/.test(decoded) || /\b\d{7,}\b/.test(decoded)) {
        problems.push({
          severity: "error",
          kind: "pii",
          scope: "creative",
          scopeName: row.name,
          detail: `${key} would carry something that looks like personal information (${decoded}). A UTM identifies traffic; it must never identify a person.`,
        });
      }
    }
    const identity = parsed.searchParams.get("utm_content") || "";
    if (identity) {
      if (identities.has(identity)) {
        problems.push({
          severity: "warning",
          kind: "duplicate_tracking",
          scope: "creative",
          scopeName: row.name,
          detail: `utm_content is "${identity}", which another ad in this plan also uses. Two variations with one identity cannot be told apart in reporting.`,
        });
      } else {
        identities.set(identity, row);
      }
    }
  }
  return problems;
}

/**
 * Validate the plan. Every finding names the row it belongs to, because a
 * validation list that only says "3 problems" makes the operator hunt.
 */
export function validatePlan({ creatives, config, mapping, tracking, mode, currency = "" }) {
  const problems = [];
  const add = (severity, kind, scope, scopeName, detail) => problems.push({ severity, kind, scope, scopeName, detail });

  if (!creatives.length) add("error", "no_creatives", "plan", "Plan", "Select at least one creative. Nothing can be staged without one.");

  for (const creative of creatives) {
    const image = creative.preview || {};
    if (image.hasImage === false) {
      add("error", "missing_asset", "creative", creative.name, "No final asset is attached to this creative. The prompt exists but the image does not.");
    }
    const ratio = image.ratio || "";
    for (const placement of config.placements || []) {
      const spec = PLACEMENT_SPECS.find((p) => p.id === placement);
      if (!spec) continue;
      if (ratio && !spec.ratios.includes(ratio)) {
        add(
          "warning",
          "ratio_mismatch",
          "creative",
          creative.name,
          `${ratio} is not a native ratio for ${spec.label} (${spec.ratios.join(", ")}). It will be cropped or letterboxed.`,
        );
      }
      if (spec.needsVideo && !image.hasVideo) {
        add("error", "missing_video", "creative", creative.name, `${spec.label} needs a video asset. This creative is a still image.`);
      }
    }
  }

  if (!config.objective) add("error", "no_objective", "config", "Campaign", "Choose an objective. Without it there is no optimisation signal.");
  if (!config.optimisation) add("error", "no_optimisation", "config", "Campaign", "Choose the optimisation event the campaign should buy.");
  if (!config.destination) add("error", "no_destination", "config", "Campaign", "Choose where the traffic should land.");
  if (!(config.placements || []).length) add("error", "no_placements", "config", "Placements", "Choose at least one placement.");
  if (!config.budget || Number(config.budget) <= 0) add("error", "no_budget", "config", "Budget", "A daily budget above zero is required.");

  const dailyTotal = Number(config.budget || 0) * Math.max(1, Number(config.adsetCount || 1));
  if (dailyTotal > 0 && config.budgetChange && Math.abs(config.budgetChange) > 0) {
    add(
      "info",
      "budget_change",
      "config",
      "Budget",
      `This changes the daily budget by ${config.budgetChange > 0 ? "+" : ""}${config.budgetChange}% across ${config.adsetCount || 1} ad set(s), a combined ${formatMoney(dailyTotal, currency)} per day.`,
    );
  }

  const requiredFields = (tracking.fields || []).filter((f) => f.required);
  for (const f of requiredFields) {
    if (!String(f.value || "").trim()) add("error", "tracking_missing", "tracking", f.key, `${f.key} is required by this template and is empty.`);
  }
  for (const f of tracking.fields || []) {
    if (/@/.test(String(f.value || ""))) {
      add("error", "pii", "tracking", f.key, "This value looks like an email address. Personal information must never be placed in a UTM parameter.");
    }
    if (/\s/.test(String(f.value || "").trim())) {
      add("warning", "encoding", "tracking", f.key, "A raw space will be encoded differently by different tools. Use %20 or a dash.");
    }
  }
  if ((tracking.fields || []).some((f) => /\{\{(campaign|ad)\.name\}\}/.test(String(f.value || "")))) {
    add("warning", "unstable_identifier", "tracking", "Stable ids", "A parameter uses the ad or campaign name. Renaming later will split the reporting history.");
  }

  const seen = new Set();
  for (const creative of creatives) {
    for (const headline of mode === "cross_product" ? mapping[creative.id]?.headlines || [] : ["*"]) {
      const key = `${creative.id}::${headline}`;
      if (seen.has(key)) add("warning", "duplicate", "creative", creative.name, "This creative and headline pair appears more than once in the plan.");
      seen.add(key);
    }
  }

  return Object.freeze({
    problems: Object.freeze(problems),
    errors: problems.filter((p) => p.severity === "error").length,
    warnings: problems.filter((p) => p.severity === "warning").length,
    infos: problems.filter((p) => p.severity === "info").length,
    ok: problems.filter((p) => p.severity === "error").length === 0,
  });
}

export function createPublishFlow(ctx, { seed = null, host = null } = {}) {
  const doc = ctx.doc || document;
  const root = el("div", "ads-flow-overlay");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Bulk publish");

  const head = el("header", "ads-flow-head");
  const title = el("h2", "ads-flow-title", "Publish ads");
  title.tabIndex = -1;
  const headMeta = el("span", "ads-flow-meta", "");
  const headActions = el("div", "ads-flow-head-actions");
  head.append(title, headMeta, headActions);

  const stepStrip = el("div", "ads-steps");
  stepStrip.setAttribute("role", "list");
  const body = el("div", "ads-flow-body");
  const foot = el("footer", "ads-flow-foot");
  root.append(head, stepStrip, body, foot);
  (host || doc.body).append(root);

  const state = {
    step: 0,
    creatives: [],
    packChoice: "existing",
    config: {
      objective: "Leads",
      optimisation: "Lead",
      destination: "",
      budget: 25,
      budgetKind: "daily",
      budgetChange: 0,
      audience: "Broad",
      placements: ["feed"],
      scheduleStart: "",
      scheduleEnd: "",
      adsetCount: 1,
      campaignName: "",
    },
    mode: "per_creative",
    headlines: ["", "", ""],
    bodies: [""],
    mapping: {},
    tracking: {
      templateId: "tpl_standard",
      fields: [
        { key: "utm_source", value: "meta", required: true },
        { key: "utm_medium", value: "paid_social", required: true },
        { key: "utm_campaign", value: "{{campaign.internal_id}}", required: true },
        { key: "utm_content", value: "{{creative.internal_id}}", required: true },
        { key: "utm_term", value: "", required: false },
      ],
    },
    layout: "cards",
    queued: null,
    open: false,
    // Stable identity for this campaign, generated once and persisted with the
    // draft. Tracking that used the campaign name split in two on the first
    // rename; this cannot.
    campaignId: newAdsId("cmp"),
    // The draft this flow is editing, once it has been saved or reopened.
    draftId: null,
    // The revision of that draft this screen was editing from, so a save built
    // on a stale copy is refused instead of overwriting the other edit.
    revision: null,
    // The plan this wizard last produced. Identities are reconciled against it,
    // so a rebuild updates ads rather than replacing them.
    plannedRows: [],
    // The last state known to have been saved, for the unsaved-work warning.
    savedSnapshot: "",
    // Set when a save was refused because the draft moved on elsewhere.
    conflict: null,
    // The side of the preview line this plan was built on, fixed when the flow
    // opened so a rehearsal cannot be saved into the live queue.
    origin: "live",
    // Set when a save was refused because the preview switch moved under it.
    originChanged: false,
    seed: null,
    loadError: null,
  };

  const selection = createSelection({ getKey: (row) => String(row.id) });
  // Creative ids a draft or a seed wants selected once the library has loaded.
  let pendingSelection = null;
  // The mapping grid's headline controls, so a newly typed headline appears in
  // them without rebuilding the step under the operator's cursor.
  let headlineControls = [];
  let presets = readJson(PRESET_KEY, []);
  let lastFocus = null;

  // ------------------------------------------------------------------ open --

  function open() {
    lastFocus = doc.activeElement;
    state.open = true;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
    doc.addEventListener("keydown", onKey, true);
    // Which side of the preview line this plan belongs to is decided once, when
    // the flow opens. Rehearsal rows must not become a live draft because the
    // preview switch moved between choosing the creatives and saving them.
    if (!state.draftId) state.origin = originNow();
    render();
    title.focus({ preventScroll: true });
    if (!state.creatives.length) void loadCreatives();
  }

  /** Which side of the preview line this screen is on right now. */
  function originNow() {
    return ctx.isPreview?.() ? "preview" : "live";
  }

  function close() {
    state.open = false;
    root.classList.remove("is-open");
    doc.removeEventListener("keydown", onKey, true);
    setTimeout(() => {
      if (!state.open) root.hidden = true;
    }, 200);
    lastFocus?.focus?.();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }

  async function loadCreatives() {
    render();
    const result = await ctx.reader.read("creatives", ctx.params, {});
    if (result.status === "not_connected" || result.status === "error") {
      state.loadError = result.status === "not_connected" ? "not_connected" : result.detail;
      // A reopened draft keeps its own creatives. They are the operator's saved
      // intent, and dropping them because the asset reader is unavailable would
      // silently change the plan the draft already promised.
      selection.setMatching(state.creatives);
      applyPendingSelection();
      render();
      return;
    }
    const loaded = (result.data?.rows || []).map((row) => ({ ...row, ...(row.totals || {}) }));
    const seen = new Set(loaded.map((row) => String(row.id)));
    state.creatives = [...loaded, ...state.creatives.filter((row) => !seen.has(String(row.id)))];
    selection.setMatching(state.creatives);
    applyPendingSelection();
    render();
  }

  /** Select the creatives a seed or a reopened draft asks for, ignoring any id
   *  the library no longer has instead of silently selecting nothing. */
  function applyPendingSelection() {
    const wanted = pendingSelection || state.seed?.creativeIds || seed?.creativeIds || null;
    if (!wanted?.length) return;
    selection.clear();
    for (const id of wanted) {
      if (state.creatives.some((row) => String(row.id) === String(id))) selection.toggle(String(id));
    }
    pendingSelection = null;
  }

  // --------------------------------------------------------------- derived --

  function chosenCreatives() {
    const keys = new Set(selection.keys());
    return state.creatives.filter((c) => keys.has(String(c.id)));
  }

  function currentPlan() {
    // `previousRows` is whatever this wizard last planned. Passing it is what
    // makes a rebuild carry identities forward instead of minting new ones, so
    // deselecting a creative and selecting it again does not orphan its ads.
    const plan = planAds({
      creatives: chosenCreatives(),
      headlines: state.headlines,
      bodies: state.bodies,
      mode: state.mode,
      mapping: state.mapping,
      previousRows: state.plannedRows || [],
    });
    state.plannedRows = plan.rows;
    return plan;
  }

  /** The plan's rows with each row's destination resolved, which is what both
   *  the URL preview and the URL validation work from. */
  function currentRows() {
    return currentPlan().rows.map((row) => ({ ...row, destination: row.destination || state.config.destination || "" }));
  }

  function currentValidation() {
    const base = validatePlan({
      creatives: chosenCreatives(),
      config: state.config,
      mapping: state.mapping,
      tracking: state.tracking,
      mode: state.mode,
      currency: accountCurrency(ctx.context),
    });
    // The URLs are validated after they are built for the exact planned rows, so
    // the problem list describes the links that would really ship.
    const extra = validateTrackingUrls({
      rows: currentRows(),
      fields: state.tracking.fields,
      campaignId: state.campaignId,
      campaignName: state.config.campaignName,
      audience: state.config.audience,
    });
    if (!extra.length) return base;
    const problems = [...base.problems, ...extra];
    return Object.freeze({
      problems: Object.freeze(problems),
      errors: problems.filter((p) => p.severity === "error").length,
      warnings: problems.filter((p) => p.severity === "warning").length,
      infos: problems.filter((p) => p.severity === "info").length,
      ok: problems.filter((p) => p.severity === "error").length === 0,
    });
  }

  // ---------------------------------------------------------------- render --

  function render() {
    renderHead();
    renderSteps();
    clear(body);
    const conflict = conflictBanner();
    if (conflict) body.append(conflict);
    const renderer = [renderSelect, renderConfigure, renderMap, renderTracking, renderReview, renderQueue][state.step];
    renderer(body);
    renderFoot();
  }

  /**
   * The conflict, said plainly and with both ways out.
   *
   * A refused save is not an error to retry: another copy of this draft is
   * newer, and the honest choices are to look at it or to leave this screen
   * alone. Silently retrying would overwrite somebody's work.
   */
  function conflictBanner() {
    const conflict = state.conflict;
    if (!conflict) return null;
    const banner = el("div", "ads-banner");
    banner.dataset.tone = "warn";
    banner.setAttribute("role", "alert");
    banner.append(svg(ICONS.alert, { size: 14, width: 1.8 }));
    banner.append(
      el(
        "span",
        "",
        `This draft changed somewhere else while you were editing it (you were on revision ${conflict.expectedRevision}, the saved copy is revision ${conflict.actualRevision}). Nothing was overwritten.`,
      ),
    );
    banner.append(
      button("Load the saved revision", {
        onClick: () => {
          const latest = ctx.drafts.get(state.draftId);
          state.conflict = null;
          if (latest) loadDraft(latest);
          render();
          ctx.say("Loaded the saved revision. The changes on this screen were discarded.");
        },
      }),
    );
    banner.append(
      button("Keep editing mine", {
        variant: "quiet",
        onClick: () => {
          state.conflict = null;
          // Adopt the newer revision as the base, and say so: the next save
          // then replaces it deliberately rather than by accident.
          const latest = ctx.drafts.get(state.draftId);
          if (latest) {
            state.revision = latest.revision;
            ctx.say("Keeping your version. The next save replaces the other revision.");
          }
          render();
        },
      }),
    );
    return banner;
  }

  function renderHead() {
    headMeta.textContent = state.config.campaignName || "Unsaved draft";
    clear(headActions);
    // Build the popover around its trigger and append the wrapper once. Appending
    // the bare button first and then swapping it out cannot work: constructing
    // the popover moves the button inside the wrapper, so it is no longer a child
    // of the bar to replace.
    const presetPop = popover({
      trigger: button("Presets", {
        icon: ICONS.layers,
        title: "Reusable campaign setups",
      }),
      label: "Setup presets",
      align: "end",
      width: 300,
      render(panel, closePop) {
        if (presets.length) {
          const group = menuGroup("Apply a preset");
          for (const preset of presets) {
            group.append(
              menuItem(preset.name, {
                hint: `${preset.config.objective} · ${formatMoney(preset.config.budget, accountCurrency(ctx.context))}/day · ${(preset.config.placements || []).join(", ")}`,
                onClick: () => {
                  state.config = { ...state.config, ...preset.config };
                  state.tracking = { ...state.tracking, ...preset.tracking };
                  state.mode = preset.mode || state.mode;
                  render();
                  ctx.say(`Applied the preset "${preset.name}".`);
                  closePop();
                },
              }),
            );
          }
          panel.append(group);
        } else {
          panel.append(el("p", "ads-menu-empty", "No presets saved yet. Configure a campaign, then save it here to reuse the setup."));
        }
        const group = menuGroup("Save the current setup");
        const input = el("input", "ads-input");
        input.placeholder = "Preset name";
        input.setAttribute("aria-label", "Preset name");
        const row = el("div", "ads-menu-save");
        row.append(
          input,
          button("Save", {
            variant: "ink",
            onClick: () => {
              const name = input.value.trim();
              if (!name) return input.focus();
              presets = [{ id: `preset_${Date.now().toString(36)}`, name, config: state.config, tracking: state.tracking, mode: state.mode }, ...presets].slice(0, 20);
              writeJson(PRESET_KEY, presets);
              ctx.say(`Saved the preset "${name}".`);
              closePop();
            },
          }),
        );
        group.append(row);
        panel.append(group);
      },
    });
    headActions.append(presetPop);
    headActions.append(
      button("Save draft", {
        title: "Keep this setup, including the creatives and their mappings, without staging anything.",
        onClick: () => {
          const saved = saveDraft({ phase: "editing" });
          if (!saved) {
            ctx.say(
              state.originChanged
                ? "This plan was built from rehearsal rows and the preview switch has moved since. Nothing was saved into the live queue. Save it with preview back on, or turn preview off and rebuild the plan from real creatives."
                : "This draft changed somewhere else since you opened it, so nothing was overwritten. Reload the draft to see the other change.",
            );
            render();
            return;
          }
          ctx.say(
            `Draft saved with ${formatInt(saved.creatives.length)} creative${saved.creatives.length === 1 ? "" : "s"} and ${formatInt(draftAdCount(saved))} planned ads. Nothing was staged or sent.`,
          );
        },
      }),
    );
    headActions.append(button("", { icon: ICONS.close, variant: "quiet", ariaLabel: "Close the publish flow", onClick: close }));
  }

  function renderSteps() {
    clear(stepStrip);
    const validation = currentValidation();
    STEPS.forEach((step, index) => {
      const node = el("button", "ads-step");
      node.type = "button";
      node.setAttribute("role", "listitem");
      if (index === state.step) node.setAttribute("aria-current", "step");
      else if (index < state.step) node.dataset.complete = "true";
      const num = el("span", "ads-step-index");
      num.append(index < state.step ? svg(ICONS.check, { size: 10, width: 3 }) : document.createTextNode(String(index + 1)));
      node.append(num, el("span", "", step.label));
      if (step.id === "review" && !validation.ok) node.append(el("span", "ads-step-blocked", String(validation.errors)));
      node.addEventListener("click", () => {
        state.step = index;
        render();
      });
      stepStrip.append(node);
    });
  }

  function renderFoot() {
    clear(foot);
    const plan = currentPlan();
    const validation = currentValidation();
    const summary = el("span", "ads-flow-summary");
    // Where this plan currently stands, in the same words the queue uses. The
    // distinction that matters is local-only: a draft this browser is holding,
    // a draft Frank has saved, and a plan the queue is holding are three
    // different states, and none of them is "sent".
    const unsaved = hasUnsavedWork();
    summary.append(
      statusBadge(state.queued ? "queued" : unsaved ? "uncertain" : "ready", {
        label: state.queued ? "Staged in Frank" : unsaved ? "Unsaved changes" : state.draftId ? "Saved draft" : "New draft",
        title: state.queued
          ? "This plan is in the Frank queue. Nothing has been sent to the provider."
          : unsaved
            ? "This plan has changes that are not saved. Closing the flow would lose them."
            : state.draftId
              ? `Saved revision ${state.revision ?? 1} in this browser.`
              : "Not saved yet.",
      }),
    );
    if (state.step > 0) {
      summary.append(el("span", "", `${plan.total} ad${plan.total === 1 ? "" : "s"} planned`));
      if (validation.errors) summary.append(statusBadge("failed", { label: `${validation.errors} blocking` }));
      if (validation.warnings) summary.append(statusBadge("blocked", { label: `${validation.warnings} warning${validation.warnings === 1 ? "" : "s"}` }));
    }
    foot.append(summary);

    const spacer = el("span", "ads-wizard-spacer");
    foot.append(spacer);
    if (state.step > 0) {
      foot.append(
        button("Back", {
          onClick: () => {
            state.step -= 1;
            render();
          },
        }),
      );
    }
    const reviewStep = STEPS.length - 2;
    const queueStep = STEPS.length - 1;
    const goNext = () =>
      button("Continue", {
        variant: "ink",
        onClick: () => {
          state.step += 1;
          render();
        },
      });

    if (state.step < reviewStep) {
      foot.append(goNext());
    } else if (state.step === reviewStep) {
      // Approval happens here, on the plan the operator is actually looking at.
      // The queue step that follows reports what was staged.
      if (state.queued) {
        foot.append(goNext());
      } else {
        foot.append(
          button("Stage in the queue", {
            variant: "ink",
            disabled: !validation.ok || !plan.total || (plan.multiplies && !state.crossConfirmed),
            title: validation.ok
              ? "Add this plan to the publishing queue as a draft."
              : "Fix the blocking problems first.",
            onClick: () => stage(),
          }),
        );
      }
    }
    if (state.step === queueStep) {
      // Nothing to approve here; the step is a receipt.
    }
    const cancel = button("Cancel", { onClick: close });
    foot.append(cancel);
  }

  // ------------------------------------------------------------ 1. select --

  function renderSelect(container) {
    const intro = el("p", "ads-screen-note");
    intro.append(
      document.createTextNode(
        "Choose the finished creatives to publish, or take a generated pack. Only creatives with a final asset attached can be published — a prompt is not an asset.",
      ),
    );
    container.append(intro);

    container.append(
      segmented(
        [
          { id: "existing", label: "Existing creatives" },
          { id: "pack", label: "A generated pack" },
        ],
        state.packChoice,
        (id) => {
          state.packChoice = id;
          render();
        },
        { label: "Where the creatives come from" },
      ),
    );

    if (state.packChoice === "pack") {
      const packs = new Map();
      for (const creative of state.creatives) {
        const packId = creative.lineage?.packId;
        if (!packId) continue;
        if (!packs.has(packId)) packs.set(packId, []);
        packs.get(packId).push(creative);
      }
      const section = el("div", "ads-block");
      section.append(el("h3", "ads-block-title", "Generated packs"));
      if (!packs.size) {
        section.append(emptyPanel({ title: "No packs in this window", detail: "No creative in the current window carries a pack id in its lineage." }));
      }
      for (const [packId, members] of packs) {
        const row = el("div", "ads-pack-row");
        const info = el("div", "ads-pack-info");
        info.append(el("strong", "", packId));
        info.append(el("span", "ads-cell-sub", `${members.length} creatives · generated ${members[0]?.prompt?.model || "unknown model"}`));
        row.append(info);
        row.append(
          button("Select all", {
            onClick: () => {
              for (const m of members) if (!selection.has(String(m.id))) selection.toggle(String(m.id));
              render();
            },
          }),
        );
        row.append(
          button("Add to selection", {
            onClick: () => {
              for (const m of members) if (!selection.has(String(m.id))) selection.toggle(String(m.id));
              state.packChoice = "existing";
              render();
            },
          }),
        );
        section.append(row);
      }
      container.append(section);
    }

    if (state.loadError === "not_connected") {
      container.append(
        emptyPanel({
          title: "Not connected",
          detail: "The creative reader has no reporting sync, so there is nothing to select. Turn on Preview to rehearse this flow against labelled sample creatives.",
        }),
      );
      return;
    }
    if (!state.creatives.length) {
      container.append(emptyPanel({ title: "No creatives", detail: "The creative reader returned nothing for this window." }));
      return;
    }

    const chosen = chosenCreatives();
    const strip = el("div", "ads-flow-strip");
    strip.append(el("strong", "", `${chosen.length} of ${state.creatives.length} selected`));
    strip.append(
      button("Select all with an asset", {
        onClick: () => {
          for (const c of state.creatives) if (c.preview?.hasImage !== false && !selection.has(String(c.id))) selection.toggle(String(c.id));
          render();
        },
      }),
    );
    strip.append(
      button("Clear", {
        onClick: () => {
          selection.clear();
          render();
        },
      }),
    );
    container.append(strip);

    const grid = el("div", "ads-pick-grid");
    for (const creative of state.creatives) {
      const key = String(creative.id);
      const on = selection.has(key);
      const card = el("button", `ads-pick${on ? " is-on" : ""}`);
      card.type = "button";
      card.setAttribute("aria-pressed", on ? "true" : "false");
      const thumb = el("span", "ads-creative-thumb");
      thumb.append(svg(creative.preview?.hasVideo ? ICONS.eye : ICONS.image, { size: 15, width: 1.6 }));
      const info = el("span", "ads-pick-info");
      info.append(el("strong", "", creative.name));
      info.append(
        el(
          "span",
          "ads-cell-sub",
          `${creative.format} · ${creative.preview?.ratio || "ratio unknown"}${creative.preview?.hasImage === false ? " · no asset" : ""}`,
        ),
      );
      card.append(thumb, info);
      if (creative.preview?.hasImage === false) card.append(statusBadge("failed", { label: "No asset" }));
      card.addEventListener("click", () => {
        selection.toggle(key);
        render();
      });
      grid.append(card);
    }
    container.append(grid);
  }

  // --------------------------------------------------------- 2. configure --

  function renderConfigure(container) {
    const currency = accountCurrency(ctx.context);
    const form = el("div", "ads-grid-form");

    const text = (label, key, { hint = "", placeholder = "" } = {}) => {
      const wrap = el("label", "ads-field");
      wrap.append(el("span", "ads-field-label", label));
      const input = el("input", "ads-input");
      input.value = state.config[key] || "";
      input.placeholder = placeholder;
      input.addEventListener("input", () => {
        state.config = { ...state.config, [key]: input.value };
      });
      wrap.append(input);
      if (hint) wrap.append(el("span", "ads-field-hint", hint));
      return wrap;
    };

    const select = (label, key, options, hint = "") => {
      const wrap = el("label", "ads-field");
      wrap.append(el("span", "ads-field-label", label));
      const node = el("select", "ads-select");
      node.append(el("option", "", "Choose…"));
      for (const option of options) {
        const opt = el("option", "", option);
        opt.value = option;
        if (state.config[key] === option) opt.selected = true;
        node.append(opt);
      }
      node.addEventListener("change", () => {
        state.config = { ...state.config, [key]: node.value };
        renderFoot();
        renderSteps();
      });
      wrap.append(node);
      if (hint) wrap.append(el("span", "ads-field-hint", hint));
      return wrap;
    };

    form.append(text("Campaign name", "campaignName", { placeholder: "e.g. Leads — always on — September" }));
    form.append(
      select("Objective", "objective", ["Leads", "Sales", "Traffic", "Engagement", "Awareness"], "What the campaign is optimised to buy."),
      select("Optimisation event", "optimisation", ["Lead", "Purchase", "Landing page view", "Link click", "Complete registration"], "The event the delivery system is asked to find."),
    );
    form.append(text("Conversion destination", "destination", { placeholder: "https://example.com/guides/survey", hint: "Where the traffic lands. A blog article is a valid destination." }));

    const budgetWrap = el("label", "ads-field");
    budgetWrap.append(el("span", "ads-field-label", `Budget (${currency})`));
    const budget = el("input", "ads-input");
    budget.type = "number";
    budget.min = "1";
    budget.value = String(state.config.budget);
    budget.addEventListener("input", () => {
      state.config = { ...state.config, budget: Number(budget.value) };
      renderFoot();
    });
    budgetWrap.append(budget);
    budgetWrap.append(el("span", "ads-field-hint", `${formatMoney(Number(state.config.budget || 0) * Math.max(1, state.config.adsetCount), currency)} per day across ${state.config.adsetCount} ad set(s).`));
    form.append(budgetWrap);

    form.append(select("Audience", "audience", ["Broad", "Lookalike 1%", "Retarget 30d", "Interest stack", "Local radius"]));

    const placementsWrap = el("div", "ads-field ads-grid-form-wide");
    placementsWrap.append(el("span", "ads-field-label", "Placements"));
    const chips = el("div", "ads-flow-strip");
    for (const spec of PLACEMENT_SPECS) {
      const on = (state.config.placements || []).includes(spec.id);
      chips.append(
        chip(spec.label, {
          active: on,
          title: `Native ratios: ${spec.ratios.join(", ")}${spec.needsVideo ? ". Video only." : ""}`,
          onClick: () => {
            const list = state.config.placements || [];
            state.config = { ...state.config, placements: on ? list.filter((p) => p !== spec.id) : [...list, spec.id] };
            render();
          },
        }),
      );
    }
    placementsWrap.append(chips);
    placementsWrap.append(el("span", "ads-field-hint", "Each placement has native ratios. Assets that do not match are flagged in the review, not silently cropped."));
    form.append(placementsWrap);

    const schedule = el("div", "ads-field");
    schedule.append(el("span", "ads-field-label", "Schedule"));
    const start = el("input", "ads-input");
    start.type = "date";
    start.value = state.config.scheduleStart;
    start.setAttribute("aria-label", "Schedule start");
    const end = el("input", "ads-input");
    end.type = "date";
    end.value = state.config.scheduleEnd;
    end.setAttribute("aria-label", "Schedule end");
    start.addEventListener("change", () => {
      state.config = { ...state.config, scheduleStart: start.value };
    });
    end.addEventListener("change", () => {
      state.config = { ...state.config, scheduleEnd: end.value };
    });
    const schedRow = el("div", "ads-flow-strip");
    schedRow.append(start, el("span", "ads-ba-values", "→"), end);
    schedule.append(schedRow);
    schedule.append(el("span", "ads-field-hint", "Leave both blank for continuous delivery."));
    form.append(schedule);

    container.append(form);
  }

  // --------------------------------------------------------------- 3. map --

  function renderMap(container) {
    const chosen = chosenCreatives();
    if (!chosen.length) {
      container.append(emptyPanel({ title: "No creatives selected", detail: "Go back to step 1 and select at least one creative." }));
      return;
    }

    // The counter has a stable host so a keystroke in an axis input can repaint
    // just this block. Re-rendering the whole step would rebuild the input the
    // operator is typing into and take their caret with it.
    const comboHost = el("div", "ads-combo-host");
    comboHost.append(combinationBlock());
    state.comboHost = comboHost;
    container.append(comboHost);

    const modeRow = el("div", "ads-block");
    modeRow.append(el("h3", "ads-block-title", "How the axes combine"));
    modeRow.append(
      segmented(
        COMBINATION_MODES.map((m) => ({ id: m.id, label: m.label, title: m.note })),
        state.mode,
        (id) => {
          state.mode = id;
          if (id === "cross_product") state.crossConfirmed = false;
          render();
        },
        { label: "Combination mode" },
      ),
    );
    modeRow.append(el("p", "ads-block-note", COMBINATION_MODES.find((m) => m.id === state.mode)?.note || ""));
    if (state.mode === "cross_product" && currentPlan().multiplies) {
      const confirm = el("label", "ads-confirm");
      const box = el("input", "ads-check");
      box.type = "checkbox";
      box.checked = Boolean(state.crossConfirmed);
      box.addEventListener("change", () => {
        state.crossConfirmed = box.checked;
        renderFoot();
      });
      confirm.append(box, el("span", "", `I understand this creates ${currentPlan().total} separate ads, each with its own delivery and reporting.`));
      modeRow.append(confirm);
    }
    container.append(modeRow);

    // The text axes.
    const axes = el("div", "ads-cols-2");
    axes.append(textAxis("Headlines", "headlines", "Each headline is a separate line of text. In one-ad-per-creative mode they travel as alternatives; in cross-product mode each becomes its own ad."));
    axes.append(textAxis("Primary text", "bodies", "The body copy. Same rule as headlines."));
    container.append(axes);

    // The editable mapping grid.
    const mapBlock = el("div", "ads-block");
    mapBlock.append(el("h3", "ads-block-title", "Map each creative"));
    mapBlock.append(
      el("p", "ads-block-note", "Every row is one creative. The destination and the UTM content value default to the creative's own stable identifier, so a later rename does not break the reporting join."),
    );
    const wrap = el("div", "ads-map-grid");
    const table = el("table", "ads-map-table");
    const thead = el("thead");
    const hr = el("tr");
    for (const label of ["Creative", "Asset", "Headline", "Destination", "utm_content"]) hr.append(el("th", "", label));
    thead.append(hr);
    const tbody = el("tbody");
    headlineControls = [];
    for (const creative of chosen) {
      const mapping = state.mapping[creative.id] || {};
      const tr = el("tr");
      const nameCell = el("td", "ads-map-fixed", creative.name);
      tr.append(nameCell);
      tr.append(el("td", "ads-map-fixed", creative.preview?.hasImage === false ? "Missing" : `${creative.format} · ${creative.preview?.ratio || "?"}`));
      if (creative.preview?.hasImage === false) tr.dataset.invalid = "true";

      const headlineCell = el("td");
      const headlineSelect = el("select");
      headlineSelect.setAttribute("aria-label", `Headline for ${creative.name}`);
      headlineSelect.append(el("option", "", "Use all headlines"));
      state.headlines.filter(Boolean).forEach((h, i) => {
        const opt = el("option", "", h);
        opt.value = String(i);
        if (String(mapping.headlineIndex ?? "") === String(i)) opt.selected = true;
        headlineSelect.append(opt);
      });
      headlineSelect.addEventListener("change", () => {
        setMapping(creative.id, { headlineIndex: headlineSelect.value === "" ? null : Number(headlineSelect.value) });
        renderSteps();
      });
      headlineControls.push({ select: headlineSelect, creativeId: String(creative.id) });
      headlineCell.append(headlineSelect);
      tr.append(headlineCell);

      const destCell = el("td");
      const dest = el("input");
      dest.value = mapping.destination ?? state.config.destination;
      dest.placeholder = state.config.destination || "https://…";
      dest.setAttribute("aria-label", `Destination for ${creative.name}`);
      dest.addEventListener("change", () => {
        setMapping(creative.id, { destination: dest.value });
        renderSteps();
      });
      destCell.append(dest);
      tr.append(destCell);

      const contentCell = el("td");
      const content = el("input");
      content.value = mapping.utmContent ?? creative.internalId ?? creative.id;
      content.setAttribute("aria-label", `utm_content for ${creative.name}`);
      content.addEventListener("change", () => {
        setMapping(creative.id, { utmContent: content.value });
        renderSteps();
      });
      contentCell.append(content);
      tr.append(contentCell);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    mapBlock.append(wrap);
    container.append(mapBlock);

    // Placement previews.
    container.append(placementPreview(chosen));
  }

  /** Merge one mapping field, reading the current record at merge time. The rule
   *  lives in the shared draft model so it can be tested without a browser. */
  function setMapping(creativeId, patch) {
    state.mapping = mergeMapping(state.mapping, creativeId, patch);
  }

  /** Rebuild the headline option lists in place, keeping a selection that still
   *  exists and falling back to "use all headlines" when it does not. */
  function refreshHeadlineOptions() {
    const available = state.headlines
      .map((headline, index) => ({ headline: String(headline ?? ""), index }))
      .filter((entry) => entry.headline.trim().length > 0);
    for (const control of headlineControls) {
      const previous = control.select.value;
      clear(control.select);
      control.select.append(el("option", "", "Use all headlines"));
      for (const entry of available) {
        const option = el("option", "", entry.headline);
        option.value = String(entry.index);
        control.select.append(option);
      }
      control.select.value = available.some((entry) => String(entry.index) === String(previous)) ? previous : "";
    }
  }

  function repaintCombo() {
    if (!state.comboHost) return;
    clear(state.comboHost);
    state.comboHost.append(combinationBlock());
  }

  function textAxis(label, key, note) {
    const section = el("div", "ads-field");
    section.append(el("span", "ads-field-label", label));
    const list = el("div", "ads-axis");
    state[key].forEach((value, index) => {
      const row = el("div", "ads-axis-row");
      const input = el("input", "ads-input");
      input.value = value;
      input.placeholder = `${label} ${index + 1}`;
      input.setAttribute("aria-label", `${label} ${index + 1}`);
      input.addEventListener("input", () => {
        const next = state[key].slice();
        next[index] = input.value;
        state[key] = next;
        repaintCombo();
        renderFoot();
        renderSteps();
        // The mapping grid lists the headlines, so it has to learn about a new
        // one. Re-rendering the whole step here would take the cursor out of the
        // box being typed in, so only the option lists are refreshed.
        if (key === "headlines") refreshHeadlineOptions();
      });
      row.append(input);
      row.append(
        button("", {
          icon: ICONS.close,
          variant: "quiet",
          ariaLabel: `Remove ${label} ${index + 1}`,
          disabled: state[key].length <= 1,
          onClick: () => {
            state[key] = state[key].filter((unused, i) => i !== index);
            render();
          },
        }),
      );
      list.append(row);
    });
    section.append(list);
    section.append(
      button(`Add ${label.toLowerCase()}`, {
        icon: ICONS.plus,
        onClick: () => {
          state[key] = [...state[key], ""];
          render();
        },
      }),
    );
    section.append(el("span", "ads-field-hint", note));
    return section;
  }

  /**
   * The combination block. This is the sentence the whole screen exists to say:
   * twenty creatives and five headlines is one hundred ads, and only if you ask
   * for it.
   */
  function combinationBlock() {
    const plan = currentPlan();
    const block = el("div", "ads-combo");
    const head = el("div", "ads-combo-head");
    head.append(svg(ICONS.layers, { size: 14, width: 1.7 }));
    head.append(el("span", "ads-combo-title", "What this will create"));
    if (plan.multiplies) head.append(statusBadge("blocked", { label: "Multiplies" }));
    block.append(head);

    const eq = el("div", "ads-combo-eq");
    plan.factors.forEach((factor, index) => {
      if (index > 0) eq.append(el("span", "ads-combo-op", "×"));
      const chipNode = el("span", "ads-combo-factor");
      chipNode.append(el("strong", "", String(factor.count)));
      chipNode.append(el("span", "", factor.label));
      if (factor.implied) chipNode.title = "None written, so this axis counts as one.";
      eq.append(chipNode);
    });
    eq.append(el("span", "ads-combo-op", "="));
    const total = el("span", "ads-combo-total");
    total.append(el("strong", "", formatInt(plan.total)));
    total.append(el("span", "", plan.total === 1 ? "ad" : "ads"));
    eq.append(total);
    block.append(eq);
    block.append(el("p", "ads-combo-note", plan.note));
    if (!plan.multiplies) {
      block.append(
        el(
          "p",
          "ads-combo-note",
          "Choosing “one ad per combination” instead would create the product above. Nothing is created until you reach the review step and stage it.",
        ),
      );
    }
    return block;
  }

  function placementPreview(chosen) {
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Placement preview"));
    section.append(el("p", "ads-block-note", "What each selected placement would receive, and which assets are missing for it."));
    const grid = el("div", "ads-compare-grid");
    for (const placementId of state.config.placements || []) {
      const spec = PLACEMENT_SPECS.find((p) => p.id === placementId);
      if (!spec) continue;
      const cell = el("div", "ads-compare-cell");
      cell.append(el("span", "ads-compare-label", spec.label));
      const matching = chosen.filter((c) => spec.ratios.includes(c.preview?.ratio) && (!spec.needsVideo || c.preview?.hasVideo));
      const missing = chosen.length - matching.length;
      cell.append(el("span", "ads-compare-value", `${matching.length} of ${chosen.length} assets fit natively`));
      cell.append(el("span", "ads-field-hint", `Native ratios: ${spec.ratios.join(", ")}${spec.needsVideo ? " · video only" : ""}`));
      if (missing) cell.append(statusBadge("blocked", { label: `${missing} need work`, title: "These assets would be cropped, letterboxed or rejected by this placement." }));
      grid.append(cell);
    }
    section.append(grid);
    return section;
  }

  // ---------------------------------------------------------- 4. tracking --

  function renderTracking(container) {
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Tracking template"));
    section.append(
      el(
        "p",
        "ads-block-note",
        "These parameters are attached to every ad in the plan. Internal identifiers are used rather than names, so renaming an ad later does not split its reporting history. Personal information must never be placed in a UTM parameter.",
      ),
    );

    const table = el("table", "ads-map-table");
    const thead = el("thead");
    const hr = el("tr");
    for (const label of ["Parameter", "Value", "Required", "Note"]) hr.append(el("th", "", label));
    thead.append(hr);
    const tbody = el("tbody");
    for (const f of state.tracking.fields) {
      const tr = el("tr");
      tr.append(el("td", "ads-map-fixed", f.key));
      const valueCell = el("td");
      const input = el("input");
      input.value = f.value;
      input.setAttribute("aria-label", f.key);
      input.addEventListener("change", () => {
        state.tracking = { ...state.tracking, fields: state.tracking.fields.map((x) => (x.key === f.key ? { ...x, value: input.value } : x)) };
        render();
      });
      valueCell.append(input);
      tr.append(valueCell);
      tr.append(el("td", "ads-map-fixed", f.required ? "Required" : "Optional"));
      tr.append(el("td", "ads-map-fixed", f.key === "utm_term" ? "Optional. Without it, placement reporting falls back to the API only." : ""));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    section.append(table);

    const resolved = el("div", "ads-block");
    resolved.append(el("h3", "ads-block-title", "Resolved URL preview"));
    resolved.append(
      el(
        "p",
        "ads-block-note",
        "The first three planned ads, with their parameters resolved. These are the exact strings that validation checks, so a URL that appears here is the URL that was tested.",
      ),
    );
    const list = el("div", "ads-flow-strip ads-flow-strip-column");
    // Three examples is enough to catch a broken placeholder; more is noise.
    for (const row of currentRows().slice(0, 3)) {
      const url = buildUrl(row);
      const line = el("div", "ads-url-line");
      line.append(el("span", "ads-cell-sub", row.name));
      line.append(el("code", "ads-prompt", url || "This destination is not a URL, so no tracking link can be built."));
      list.append(line);
    }
    resolved.append(list);
    section.append(resolved);

    const problems = currentValidation().problems.filter((p) => p.scope === "tracking");
    if (problems.length) {
      const issues = el("div", "ads-block");
      issues.append(el("h3", "ads-block-title", "Tracking problems"));
      for (const p of problems) issues.append(problemRow(p));
      section.append(issues);
    }
    container.append(section);
  }

  /** The exact string shown to the operator and handed to validation. One
   *  builder, so a preview can never disagree with what is checked. */
  function buildUrl(row) {
    return buildTrackingUrl({
      base: row.destination || state.config.destination || "https://example.invalid/",
      fields: state.tracking.fields,
      row,
      campaignId: state.campaignId,
      campaignName: state.config.campaignName,
      audience: state.config.audience,
    });
  }

  function problemRow(p) {
    const row = el("div", "ads-issue");
    row.dataset.kind = p.kind;
    row.dataset.severity = p.severity;
    row.append(statusBadge(p.severity === "error" ? "failed" : p.severity === "warning" ? "blocked" : "draft", { label: p.severity === "error" ? "Blocking" : p.severity === "warning" ? "Warning" : "Note" }));
    const bodyWrap = el("div", "ads-issue-body");
    bodyWrap.append(el("strong", "", p.scopeName));
    bodyWrap.append(el("p", "", p.detail));
    row.append(bodyWrap);
    return row;
  }

  // ------------------------------------------------------------ 5. review --

  function renderReview(container) {
    const plan = currentPlan();
    const validation = currentValidation();
    const currency = accountCurrency(ctx.context);
    const chosen = chosenCreatives();

    const summary = el("div", "ads-review-summary");
    summary.append(reviewStat("Ads to create", formatInt(plan.total), plan.multiplies ? `${plan.equation} — the axes multiply` : "One per creative"));
    summary.append(reviewStat("Creatives", formatInt(chosen.length), `${chosen.filter((c) => c.preview?.hasImage !== false).length} with a final asset`));
    summary.append(
      reviewStat(
        "Daily budget",
        formatMoney(Number(state.config.budget || 0) * Math.max(1, state.config.adsetCount), currency),
        state.config.budgetChange ? `${state.config.budgetChange > 0 ? "+" : ""}${state.config.budgetChange}% change` : "No change to an existing budget",
      ),
    );
    summary.append(reviewStat("Validation problems", formatInt(validation.problems.length), `${validation.errors} blocking, ${validation.warnings} warning`));
    container.append(summary);

    // The exact records this would create, with the tracking identity each one
    // would carry. The count above and the rows below come from one plan, so
    // they cannot disagree, and the operator can see what "20 ads" means.
    const planned = currentRows();
    const plannedBlock = el("div", "ads-block");
    plannedBlock.append(el("h3", "ads-block-title", `Planned ads (${formatInt(planned.length)})`));
    plannedBlock.append(
      el(
        "p",
        "ads-block-note",
        planned.length > 25
          ? `Showing the first 25 of ${formatInt(planned.length)}. Every row carries its own stable tracking identity; none is derived from a name.`
          : "Every row carries its own stable tracking identity; none is derived from a name.",
      ),
    );
    const plannedGrid = el("div", "ads-map-grid");
    const plannedTable = el("table", "ads-map-table");
    const plannedHead = el("thead");
    const plannedHeadRow = el("tr");
    for (const label of ["Ad", "Tracking identity", "Destination"]) plannedHeadRow.append(el("th", "", label));
    plannedHead.append(plannedHeadRow);
    const plannedBody = el("tbody");
    for (const row of planned.slice(0, 25)) {
      const tr = el("tr");
      if (row.problems.length) tr.dataset.invalid = "true";
      tr.append(el("td", "ads-map-fixed", row.name));
      tr.append(el("td", "", row.trackingKey));
      const url = buildUrl(row);
      tr.append(el("td", "", url || "Not a valid URL"));
      plannedBody.append(tr);
    }
    plannedTable.append(plannedHead, plannedBody);
    plannedGrid.append(plannedTable);
    plannedBlock.append(plannedGrid);
    container.append(plannedBlock);

    if (plan.multiplies && !state.crossConfirmed) {
      const guard = el("div", "ads-banner");
      guard.dataset.tone = "bad";
      guard.append(svg(ICONS.alert, { size: 13, width: 1.8 }));
      guard.append(el("span", "", `This plan multiplies to ${plan.total} ads. Confirm the combination mode on the mapping step before staging.`));
      container.append(guard);
    }

    const problemBlock = el("div", "ads-block");
    problemBlock.append(el("h3", "ads-block-title", "Validation"));
    if (!validation.problems.length) {
      problemBlock.append(el("p", "ads-block-note", "No problems found. Every asset has a native fit for the selected placements and every required parameter is set."));
    } else {
      const errors = validation.problems.filter((p) => p.severity === "error");
      const warnings = validation.problems.filter((p) => p.severity === "warning");
      const infos = validation.problems.filter((p) => p.severity === "info");
      for (const group of [errors, warnings, infos]) {
        for (const p of group) problemBlock.append(problemRow(p));
      }
    }
    container.append(problemBlock);

    const configBlock = el("div", "ads-block");
    configBlock.append(el("h3", "ads-block-title", "What gets configured"));
    const dl = el("dl", "ads-defs");
    dl.append(
      definitionRow("Campaign", state.config.campaignName || "Unnamed draft"),
      definitionRow("Campaign identity", state.campaignId),
      definitionRow("Objective", state.config.objective || "—"),
      definitionRow("Optimisation event", state.config.optimisation || "—"),
      definitionRow("Destination", state.config.destination || "—"),
      definitionRow("Audience", state.config.audience || "—"),
      definitionRow("Placements", (state.config.placements || []).join(", ") || "—"),
      definitionRow("Budget", `${formatMoney(state.config.budget, currency)} ${state.config.budgetKind} per ad set`),
      definitionRow("Schedule", state.config.scheduleStart || state.config.scheduleEnd ? `${state.config.scheduleStart || "now"} → ${state.config.scheduleEnd || "open"}` : "Continuous"),
      definitionRow("Tracking", `${state.tracking.fields.filter((f) => f.value).length} parameters, ${state.tracking.fields.some((f) => /\{\{(campaign|ad)\.name\}\}/.test(f.value)) ? "one uses a name" : "all use stable ids"}`),
    );
    configBlock.append(dl);
    container.append(configBlock);

    const boundary = el("div", "ads-banner");
    boundary.dataset.tone = "warn";
    boundary.append(svg(ICONS.info, { size: 13, width: 1.8 }));
    boundary.append(
      el(
        "span",
        "",
        "Staging adds this plan to the publishing queue as a draft. It does not create anything at the provider: publishing is a gated write and is not wired yet. Submission would still not be proof of delivery.",
      ),
    );
    container.append(boundary);
  }

  function reviewStat(label, value, hint) {
    const cell = el("div", "ads-review-stat");
    cell.append(el("span", "ads-compare-label", label));
    cell.append(el("strong", "ads-review-value", value));
    cell.append(el("span", "ads-field-hint", hint));
    return cell;
  }

  // ------------------------------------------------------------- 6. queue --

  function renderQueue(container) {
    if (!state.queued) {
      container.append(
        emptyPanel({
          title: "Not staged yet",
          detail: "Go back to the review step and stage this plan. It will appear in the publishing queue as a draft, attached to every row that failed validation.",
        }),
      );
      return;
    }
    const q = state.queued;
    const section = el("div", "ads-block");
    section.append(el("h3", "ads-block-title", "Staged"));
    const dl = el("dl", "ads-defs");
    dl.append(
      definitionRow("Queue entry", q.id),
      definitionRow("State", "Draft — staged locally, not sent"),
      definitionRow("Ads in the plan", formatInt(q.total)),
      definitionRow("Rows with a problem", formatInt(q.problemRows)),
      definitionRow("Staged at", new Date(q.at).toLocaleString("en-GB")),
    );
    section.append(dl);
    section.append(
      el(
        "p",
        "ads-block-note",
        "Partial failures stay attached to their individual rows. A batch that fails on three rows does not have to be run again from the start.",
      ),
    );
    const actions = el("div", "ads-wizard-foot");
    actions.append(
      button("Open the publishing queue", {
        variant: "ink",
        onClick: () => {
          close();
          ctx.navigate("queue");
        },
      }),
    );
    actions.append(
      button("Start another", {
        onClick: () => {
          state.queued = null;
          state.draftId = null;
          state.campaignId = newAdsId("cmp");
          state.step = 0;
          selection.clear();
          render();
        },
      }),
    );
    section.append(actions);
    container.append(section);

    const rows = q.rows || [];
    if (rows.length) {
      const table = el("div", "ads-block");
      table.append(el("h3", "ads-block-title", "Rows"));
      const grid = el("div", "ads-map-grid");
      const t = el("table", "ads-map-table");
      const thead = el("thead");
      const hr = el("tr");
      for (const label of ["Ad", "State", "Detail"]) hr.append(el("th", "", label));
      thead.append(hr);
      const tbody = el("tbody");
      for (const row of rows) {
        const tr = el("tr");
        if (row.problems) tr.dataset.invalid = "true";
        tr.append(el("td", "ads-map-fixed", row.name));
        tr.append(el("td", "", row.problems ? "Problem" : "Ready"));
        tr.append(el("td", "", row.detail || ""));
        tbody.append(tr);
      }
      t.append(thead, tbody);
      grid.append(t);
      table.append(grid);
      container.append(table);
    }
  }

  // ---------------------------------------------------------------- stage --

  /**
   * Everything this flow would stage, as one draft record. The rows come from
   * the same `plan.rows` the counter displays, so the number on screen and the
   * number of rows in the queue are the same fact.
   */
  function draftFromState({ phase = "editing" } = {}) {
    const plan = currentPlan();
    const validation = currentValidation();
    return {
      id: state.draftId || undefined,
      kind: "launch",
      phase,
      title: state.config.campaignName || "Untitled launch",
      // A rehearsal is a full rehearsal of the flow, and it is labelled as one
      // everywhere it appears. It can never be sent.
      origin: state.origin,
      campaign: {
        campaignId: state.campaignId,
        name: state.config.campaignName,
        objective: state.config.objective,
        optimisation: state.config.optimisation,
        destination: state.config.destination,
        placements: state.config.placements,
        budget: state.config.budget,
        budgetKind: state.config.budgetKind,
        adsetCount: state.config.adsetCount,
        currency: accountCurrency(ctx.context),
      },
      creatives: chosenCreatives().map((creative) => ({
        id: String(creative.id),
        internalId: String(creative.internalId || creative.id),
        name: creative.name,
        format: creative.format,
        ratio: creative.preview?.ratio || "",
        hasImage: creative.preview?.hasImage ?? null,
        hasVideo: creative.preview?.hasVideo ?? null,
        assetKey: String(creative.assetKey || creative.internalId || creative.id),
        versionId: String(creative.versionId || versionIdFor(creative)),
        mappings: { ...(state.mapping[creative.id] || {}) },
      })),
      headlines: state.headlines.map((headline) => String(headline ?? "")),
      bodies: state.bodies.map((body) => String(body ?? "")),
      mode: state.mode,
      tracking: { templateId: state.tracking.templateId, fields: state.tracking.fields.map((field) => ({ ...field })) },
      plan: { mode: state.mode, total: plan.total, equation: plan.equation, rows: plan.rows },
      validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, problems: validation.problems },
    };
  }

  /**
   * Save the draft being edited.
   *
   * The revision this screen was editing from goes with the save: if another
   * tab, the queue, or another device changed the same draft, the save is
   * refused and the screen reports the conflict rather than overwriting it.
   */
  function saveDraft({ phase = "editing" } = {}) {
    // The preview switch can move while this flow is open. A plan built from
    // rehearsal rows is never written into the live queue, and a live plan is
    // never quietly re-labelled as a rehearsal.
    if (originNow() !== state.origin) {
      state.originChanged = true;
      return null;
    }
    state.originChanged = false;
    const result = ctx.drafts.saveGuarded(draftFromState({ phase }), { id: state.draftId, baseRevision: state.revision });
    if (!result.ok) {
      state.conflict = result.conflict;
      return null;
    }
    state.conflict = null;
    state.draftId = result.draft.id;
    state.revision = result.draft.revision;
    state.savedSnapshot = stateSnapshot();
    return result.draft;
  }

  /** A cheap fingerprint of everything the operator can still change, so an
   *  unsaved change can be recognised without comparing a whole object graph. */
  function stateSnapshot() {
    return JSON.stringify([
      state.config,
      state.mode,
      state.headlines,
      state.bodies,
      state.mapping,
      state.tracking,
      state.creatives.map((creative) => creative.id),
      selection.keys(),
    ]);
  }

  /** True when the screen holds changes that were never saved or staged. */
  function hasUnsavedWork() {
    if (state.conflict) return true;
    return stateSnapshot() !== state.savedSnapshot;
  }

  /** The queue's view of a staged draft, kept in the shape the queue step and
   *  the review already render. */
  function queuedView(draft) {
    const rows = draft.plan.rows.map((row) => ({
      name: row.name,
      problems: row.problems.length > 0,
      detail: row.detail || "",
      trackingKey: row.trackingKey,
    }));
    return {
      id: draft.id,
      at: Date.parse(draft.updatedAt) || Date.now(),
      total: draft.plan.total,
      problemRows: rows.filter((row) => row.problems).length,
      rows,
    };
  }

  function stage() {
    const validation = currentValidation();
    if (!validation.ok) return;
    const saved = saveDraft({ phase: "staged" });
    if (!saved) {
      ctx.say(
        state.originChanged
          ? "This plan was built from rehearsal rows and the preview switch has moved since, so nothing was staged. A rehearsal is never queued into the live queue."
          : "This draft changed somewhere else since you opened it, so nothing was staged. Reload the draft to see the other change.",
      );
      render();
      return;
    }
    state.queued = queuedView(saved);
    state.step = STEPS.length - 1;
    ctx.say(`Staged ${formatInt(draftAdCount(saved))} ads in the publishing queue as a draft. Nothing was sent to the provider.`);
    render();
  }

  /**
   * Reopen a saved launch: creatives, their mappings, the campaign
   * configuration, tracking, the planned rows and the approval state all come
   * back exactly as they were saved.
   */
  function loadDraft(draft) {
    if (!draft) return;
    state.draftId = draft.id;
    state.campaignId = draft.campaign.campaignId;
    state.config = {
      ...state.config,
      campaignName: draft.campaign.name,
      objective: draft.campaign.objective || state.config.objective,
      optimisation: draft.campaign.optimisation || state.config.optimisation,
      destination: draft.campaign.destination,
      placements: draft.campaign.placements.length ? [...draft.campaign.placements] : state.config.placements,
      budget: draft.campaign.budget ?? state.config.budget,
      budgetKind: draft.campaign.budgetKind || state.config.budgetKind,
      adsetCount: draft.campaign.adsetCount || state.config.adsetCount,
    };
    state.mode = draft.mode;
    // Empty axes are restored as the empty rows the operator left behind, not
    // as a fresh default: the plan count must come back identical.
    state.headlines = draft.headlines.length ? [...draft.headlines] : state.headlines;
    state.bodies = draft.bodies.length ? [...draft.bodies] : state.bodies;
    state.tracking = {
      templateId: draft.tracking.templateId || state.tracking.templateId,
      fields: draft.tracking.fields.length ? draft.tracking.fields.map((field) => ({ ...field })) : state.tracking.fields,
    };
    state.mapping = Object.fromEntries(draft.creatives.map((creative) => [creative.id, { ...creative.mappings }]));
    // The reopened plan is the draft's plan, identities included. Rebuilding
    // from the axes would allocate new ad identities and silently detach the
    // ads from anything already recorded about them.
    state.plannedRows = draft.plan.rows.map((row) => ({ ...row }));
    state.revision = draft.revision;
    state.origin = draft.origin;
    // The draft's own creatives seed the picker before the library answers, so
    // the restored plan never briefly reads as an empty selection.
    state.creatives = draft.creatives.map((creative) => ({
      id: creative.id,
      internalId: creative.internalId || creative.id,
      name: creative.name,
      format: creative.format,
      preview: { ratio: creative.ratio, hasImage: creative.hasImage, hasVideo: creative.hasVideo },
    }));
    selection.setMatching(state.creatives);
    // Select them now rather than waiting for the asset reader: the plan is the
    // draft's, and a reopened plan must not read as empty while a read is in
    // flight or unavailable.
    selection.clear();
    for (const creative of draft.creatives) selection.toggle(String(creative.id));
    pendingSelection = draft.creatives.map((creative) => creative.id);
    state.queued = draft.phase === "editing" ? null : queuedView(draft);
    // A staged draft opens on its receipt; a draft still being edited opens on
    // the mapping step, where the variation decisions live.
    state.step = draft.phase === "editing" ? 2 : STEPS.length - 1;
    state.savedSnapshot = stateSnapshot();
  }

  return Object.freeze({ open, close, root, state, loadDraft, hasUnsavedWork });
}
