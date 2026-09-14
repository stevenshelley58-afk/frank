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

const PRESET_KEY = "frank.ads.presets.v1";
const DRAFT_KEY = "frank.ads.drafts.v1";

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
 * The combination maths, isolated so it can be reasoned about and stated
 * plainly in the UI.
 *
 * `cross_product` multiplies every axis. `per_creative` keeps one ad per
 * creative and attaches the text as alternatives, so the count is the number of
 * creatives regardless of how many headlines were written.
 */
export function planAds({ creatives = [], headlines = [], bodies = [], mode = "per_creative" }) {
  const c = creatives.length;
  const h = headlines.filter((x) => String(x || "").trim()).length;
  const b = bodies.filter((x) => String(x || "").trim()).length;
  const plural = (count, singular, pluralForm) => (count === 1 ? singular : pluralForm);
  const factors = [
    { id: "creatives", label: plural(c, "creative", "creatives"), count: c },
    { id: "headlines", label: plural(h || 1, "headline", "headlines"), count: h || 1, implied: h === 0 },
    { id: "bodies", label: plural(b || 1, "primary text", "primary texts"), count: b || 1, implied: b === 0 },
  ];
  if (mode === "cross_product") {
    return Object.freeze({
      mode,
      factors,
      total: c * (h || 1) * (b || 1),
      equation: `${c} × ${h || 1} × ${b || 1}`,
      multiplies: true,
      note:
        c * (h || 1) * (b || 1) === c
          ? "One ad per creative, because only one headline and one body text are in play."
          : `This creates ${formatInt(c * (h || 1) * (b || 1))} ads from ${c} creatives. Each one is a separate ad with its own delivery and its own reporting line.`,
    });
  }
  return Object.freeze({
    mode,
    factors,
    total: c,
    equation: `${c} × 1`,
    multiplies: false,
    note:
      h > 1 || b > 1
        ? `${formatInt(c)} ads, each carrying ${h || 0} headline${h === 1 ? "" : "s"} and ${b || 0} primary text${b === 1 ? "" : "s"} as alternatives. The axes are not multiplied.`
        : `${formatInt(c)} ads.`,
  });
}

/**
 * Validate the plan. Every finding names the row it belongs to, because a
 * validation list that only says "3 problems" makes the operator hunt.
 */
export function validatePlan({ creatives, config, mapping, tracking, mode, currency = "GBP" }) {
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
  };

  const selection = createSelection({ getKey: (row) => String(row.id) });
  let presets = readJson(PRESET_KEY, []);
  let lastFocus = null;

  // ------------------------------------------------------------------ open --

  function open() {
    lastFocus = doc.activeElement;
    state.open = true;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
    doc.addEventListener("keydown", onKey, true);
    render();
    title.focus({ preventScroll: true });
    if (!state.creatives.length) void loadCreatives();
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
      state.creatives = [];
      state.loadError = result.status === "not_connected" ? "not_connected" : result.detail;
      render();
      return;
    }
    state.creatives = (result.data?.rows || []).map((row) => ({ ...row, ...(row.totals || {}) }));
    selection.setVisible(state.creatives);
    if (seed?.creativeIds?.length) {
      for (const id of seed.creativeIds) selection.toggle(id);
    }
    render();
  }

  // --------------------------------------------------------------- derived --

  function chosenCreatives() {
    const keys = new Set(selection.keys());
    return state.creatives.filter((c) => keys.has(String(c.id)));
  }

  function currentPlan() {
    return planAds({ creatives: chosenCreatives(), headlines: state.headlines, bodies: state.bodies, mode: state.mode });
  }

  function currentValidation() {
    return validatePlan({
      creatives: chosenCreatives(),
      config: state.config,
      mapping: state.mapping,
      tracking: state.tracking,
      mode: state.mode,
      currency: ctx.context?.account?.currency || "GBP",
    });
  }

  // ---------------------------------------------------------------- render --

  function render() {
    renderHead();
    renderSteps();
    clear(body);
    const renderer = [renderSelect, renderConfigure, renderMap, renderTracking, renderReview, renderQueue][state.step];
    renderer(body);
    renderFoot();
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
                hint: `${preset.config.objective} · ${formatMoney(preset.config.budget, ctx.context?.account?.currency || "GBP")}/day · ${(preset.config.placements || []).join(", ")}`,
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
        title: "Keep this setup without staging anything.",
        onClick: () => {
          const drafts = readJson(DRAFT_KEY, []);
          const draft = { id: `draft_${Date.now().toString(36)}`, at: new Date().toISOString(), state: { ...state, open: undefined, creatives: undefined } };
          writeJson(DRAFT_KEY, [draft, ...drafts].slice(0, 20));
          ctx.say("Draft saved locally. Nothing was staged or sent.");
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
    const currency = ctx.context?.account?.currency || "GBP";
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
        state.mapping = { ...state.mapping, [creative.id]: { ...mapping, headlineIndex: headlineSelect.value === "" ? null : Number(headlineSelect.value) } };
        renderSteps();
      });
      headlineCell.append(headlineSelect);
      tr.append(headlineCell);

      const destCell = el("td");
      const dest = el("input");
      dest.value = mapping.destination ?? state.config.destination;
      dest.placeholder = state.config.destination || "https://…";
      dest.setAttribute("aria-label", `Destination for ${creative.name}`);
      dest.addEventListener("change", () => {
        state.mapping = { ...state.mapping, [creative.id]: { ...mapping, destination: dest.value } };
        renderSteps();
      });
      destCell.append(dest);
      tr.append(destCell);

      const contentCell = el("td");
      const content = el("input");
      content.value = mapping.utmContent ?? creative.internalId ?? creative.id;
      content.setAttribute("aria-label", `utm_content for ${creative.name}`);
      content.addEventListener("change", () => {
        state.mapping = { ...state.mapping, [creative.id]: { ...mapping, utmContent: content.value } };
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
    resolved.append(el("p", "ads-block-note", "The first three ads in the plan, with their parameters resolved."));
    const list = el("div", "ads-flow-strip ads-flow-strip-column");
    // Three examples is enough to catch a broken placeholder; more is noise.
    for (const ad of chosenCreatives().slice(0, 3)) {
      const url = buildUrl(ad);
      const line = el("div", "ads-url-line");
      line.append(el("span", "ads-cell-sub", ad.name));
      line.append(el("code", "ads-prompt", url));
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

  function buildUrl(creative) {
    const mapping = state.mapping[creative.id] || {};
    const base = mapping.destination || state.config.destination || "https://example.invalid/";
    let url;
    try {
      url = new URL(base);
    } catch {
      return `${base}?utm_source=…`;
    }
    for (const f of state.tracking.fields) {
      if (!String(f.value || "").trim()) continue;
      url.searchParams.set(f.key, resolvePlaceholder(f.value, creative, mapping));
    }
    return url.toString();
  }

  function resolvePlaceholder(value, creative, mapping) {
    return String(value)
      .replace(/\{\{creative\.internal_id\}\}/g, String(mapping.utmContent || creative.internalId || creative.id))
      .replace(/\{\{ad\.internal_id\}\}/g, `ad_${String(creative.internalId || creative.id)}`)
      .replace(/\{\{campaign\.internal_id\}\}/g, state.config.campaignName ? `cmp_${state.config.campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "cmp_draft")
      .replace(/\{\{(campaign|ad)\.name\}\}/g, state.config.campaignName || "unstable_name")
      .replace(/\{\{platform\}\}/g, "meta")
      .replace(/\{\{audience\.key\}\}/g, String(state.config.audience || "").toLowerCase().replace(/[^a-z0-9]+/g, "_"));
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
    const currency = ctx.context?.account?.currency || "GBP";
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

  function stage() {
    const plan = currentPlan();
    const validation = currentValidation();
    if (!validation.ok) return;
    const chosen = chosenCreatives();
    const problemsByCreative = new Map();
    for (const p of validation.problems) {
      if (p.scope !== "creative") continue;
      if (!problemsByCreative.has(p.scopeName)) problemsByCreative.set(p.scopeName, []);
      problemsByCreative.get(p.scopeName).push(p.detail);
    }
    const rows = [];
    if (state.mode === "cross_product") {
      for (const creative of chosen) {
        for (const headline of state.headlines.filter(Boolean)) {
          for (const body of state.bodies.filter(Boolean)) {
            const detail = [...(problemsByCreative.get(creative.name) || [])];
            if (!headline) detail.push("No headline.");
            rows.push({ name: `${creative.name} — ${headline || "(no headline)"}${body ? ` — ${body.slice(0, 24)}` : ""}`, problems: detail.length > 0, detail: detail.join(" ") });
          }
        }
      }
    } else {
      for (const creative of chosen) {
        const detail = problemsByCreative.get(creative.name) || [];
        rows.push({ name: creative.name, problems: detail.length > 0, detail: detail.join(" ") });
      }
    }
    state.queued = {
      id: `draft_${Date.now().toString(36)}`,
      at: Date.now(),
      total: plan.total,
      problemRows: rows.filter((r) => r.problems).length,
      rows,
    };
    state.step = STEPS.length - 1;
    ctx.say(`Staged ${plan.total} ads as a draft in the publishing queue. Nothing was sent to the provider.`);
    render();
  }

  return Object.freeze({ open, close, root, state });
}
