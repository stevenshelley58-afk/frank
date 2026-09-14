// The Ads workspace shell.
//
// Mounted by the owner workspace as the `ads` section, beside Mail, CRM and the
// email flows. It owns the three things that must never scroll away from a
// buyer: which account, which window and comparison, which attribution setting,
// and how old the last successful sync is.
//
// The screens below it are independent modules. Each one receives the same
// context object and reads its own rows. None of them talk to each other, and
// none of them talk to Meta.

import {
  el,
  clear,
  button,
  popover,
  menuItem,
  menuGroup,
  svg,
  ICONS,
  previewBanner,
  relativeAge,
} from "./ads-ui.js";
import { DATE_PRESETS, COMPARISON_MODES, ATTRIBUTION_WINDOWS, isoDay, formatDay, SYNC_STATES } from "./ads-contracts.js";
import { createAdsReader, createAdsCache } from "./ads-source.js";
import { createAdsPreview } from "./ads-preview-data.js";
import { createViewStore } from "./ads-views.js";
import { createPublishFlow } from "./ads-publish.js";
import { createOverviewScreen } from "./ads-overview.js";
import { createCampaignsScreen } from "./ads-campaigns.js";
import { createCreativeScreen } from "./ads-creative.js";
import { createBlogsScreen } from "./ads-blogs.js";
import { createTrackingScreen } from "./ads-tracking.js";
import { createQueueScreen } from "./ads-queue.js";

const PREVIEW_STORAGE_KEY = "frank.ads.preview";

export const ADS_SCREENS = Object.freeze([
  Object.freeze({ id: "overview", label: "Overview", note: "Spend, results and what needs attention." }),
  Object.freeze({ id: "campaigns", label: "Campaigns", note: "Campaigns, ad sets and ads in one management table." }),
  Object.freeze({ id: "creative", label: "Creative intelligence", note: "Which concepts, hooks and formats are actually different from each other." }),
  Object.freeze({ id: "blogs", label: "Blogs & destinations", note: "Which articles attract traffic, convert, and work as ad destinations." }),
  Object.freeze({ id: "tracking", label: "Tracking", note: "UTM templates, URL validation and the link between ads, creatives and content." }),
  Object.freeze({ id: "queue", label: "Publishing queue", note: "Bulk launches, individual failures, pending changes and activity." }),
]);

const SCREEN_IDS = new Set(ADS_SCREENS.map((s) => s.id));

function daysAgoIso(days) {
  return isoDay(new Date(Date.now() - days * 86400000));
}

function defaultParams() {
  return Object.freeze({
    preset: "last_28d",
    from: daysAgoIso(28),
    to: daysAgoIso(0),
    comparison: "previous_period",
    attribution: "7d_click_1d_view",
  });
}

function readPreviewFlag() {
  try {
    return globalThis.localStorage?.getItem(PREVIEW_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readScreenFromUrl(win) {
  try {
    const value = new URLSearchParams(win?.location?.search || "").get("screen");
    return SCREEN_IDS.has(String(value)) ? String(value) : "";
  } catch {
    return "";
  }
}

/**
 * Mount the Ads workspace into `host`.
 *
 * Returns a dispose function, matching the contract `mountOwnerDashboard` uses
 * for the workspace it hosts.
 */
export function mountAdsWorkspace(host, options = {}) {
  const doc = host.ownerDocument || document;
  const win = doc.defaultView || globalThis;
  const cache = createAdsCache();
  const preview = createAdsPreview({ size: "small" });
  preview.setEnabled(options.preview ?? readPreviewFlag());

  const reader = createAdsReader({ fetchImpl: win.fetch?.bind(win), cache, preview });

  const root = el("div", "ads-workspace");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Ads");

  const state = {
    disposed: false,
    screen: readScreenFromUrl(win) || "overview",
    params: defaultParams(),
    context: null,
    contextStatus: "loading",
    contextDetail: "",
    syncing: false,
    announce: "",
    screens: new Map(),
    controller: new AbortController(),
    restoredFromUrl: false,
  };

  // ---------------------------------------------------------------- chrome --

  const head = el("header", "ads-head");
  const headTop = el("div", "ads-head-top");
  const account = el("div", "ads-account");
  const accountName = el("span", "ads-account-name", "Ads");
  const accountMeta = el("span", "ads-account-meta", "");
  account.append(accountName, accountMeta);

  const headActions = el("div", "ads-head-actions");
  headTop.append(account, headActions);

  const contextBar = el("div", "ads-context");
  contextBar.setAttribute("role", "group");
  contextBar.setAttribute("aria-label", "Reporting context");
  head.append(headTop, contextBar);

  const nav = el("nav", "ads-nav");
  nav.setAttribute("aria-label", "Ads screens");

  const screensHost = el("div", "ads-screens");
  const liveRegion = el("p", "ads-visually-hidden");
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");

  root.append(head, nav, screensHost, liveRegion);
  clear(host);
  host.append(root);

  function say(message) {
    state.announce = message;
    clear(liveRegion);
    liveRegion.append(document.createTextNode(message));
  }

  // --------------------------------------------------------- context strip --

  function contextItem(label, valueNode) {
    const item = el("div", "ads-context-item");
    item.append(el("span", "ads-context-label", label), valueNode);
    return item;
  }

  function buttonValue(text, { title = "", onClick = null, className = "" } = {}) {
    const btn = el("button", `ads-context-button${className ? ` ${className}` : ""}`);
    btn.type = "button";
    btn.append(el("span", "", text));
    btn.append(svg(ICONS.chevronDown, { size: 12, width: 1.8 }));
    if (title) btn.title = title;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  function renderContext() {
    clear(contextBar);
    const ctx = state.context;
    const accountValue = el("div", "ads-context-value");
    accountValue.append(el("span", "", ctx?.account?.name || (state.contextStatus === "not_connected" ? "Not connected" : "—")));
    contextBar.append(contextItem("Account", accountValue));

    const rangeBtn = buttonValue(
      state.params.preset === "custom" ? `${formatDay(state.params.from)} – ${formatDay(state.params.to)}` : DATE_PRESETS.find((p) => p.id === state.params.preset)?.label || "Last 28 days",
      {
        title: "Reporting window. This re-reads saved rows; it does not call the provider.",
        onClick: () => {},
      },
    );
    rangeBtn.setAttribute("aria-expanded", "false");
    contextBar.append(
      contextItem(
        "Date range",
        popover({
          trigger: rangeBtn,
          label: "Date range",
          width: 250,
          render(panel, close) {
            const group = menuGroup("Window");
            for (const preset of DATE_PRESETS) {
              group.append(
                menuItem(preset.label, {
                  checked: state.params.preset === preset.id,
                  onClick: () => {
                    if (preset.days) {
                      setParams({ preset: preset.id, from: daysAgoIso(preset.days), to: daysAgoIso(0) });
                    } else if (preset.id === "mtd") {
                      const now = new Date();
                      setParams({ preset: preset.id, from: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: isoDay(now) });
                    } else {
                      setParams({ preset: "custom" });
                    }
                    close();
                  },
                }),
              );
            }
            panel.append(group);
            const custom = el("div", "ads-menu-save");
            const fromInput = el("input", "ads-input");
            fromInput.type = "date";
            fromInput.value = state.params.from;
            fromInput.setAttribute("aria-label", "From date");
            const toInput = el("input", "ads-input");
            toInput.type = "date";
            toInput.value = state.params.to;
            toInput.setAttribute("aria-label", "To date");
            custom.append(fromInput, toInput);
            panel.append(menuGroup("Custom"));
            panel.append(custom);
            const foot = el("div", "ads-menu-foot");
            foot.append(
              button("Apply", {
                variant: "ink",
                onClick: () => {
                  setParams({ preset: "custom", from: fromInput.value, to: toInput.value });
                  close();
                },
              }),
            );
            panel.append(foot);
          },
        }),
      ),
    );

    const compareLabel = COMPARISON_MODES.find((m) => m.id === state.params.comparison)?.label || "Previous period";
    const compareBtn = buttonValue(compareLabel, { title: "Every delta in this workspace is against this period." });
    contextBar.append(
      contextItem(
        "Compared to",
        popover({
          trigger: compareBtn,
          label: "Comparison period",
          width: 240,
          render(panel, close) {
            const group = menuGroup("Compare against");
            for (const mode of COMPARISON_MODES) {
              group.append(
                menuItem(mode.label, {
                  checked: state.params.comparison === mode.id,
                  onClick: () => {
                    setParams({ comparison: mode.id });
                    close();
                  },
                }),
              );
            }
            panel.append(group);
          },
        }),
      ),
    );

    const attr = ATTRIBUTION_WINDOWS.find((a) => a.id === state.params.attribution);
    const attrBtn = buttonValue(attr?.label || "—", {
      title: "Changing this re-reads the saved window. It is never applied by scaling a number in the browser.",
    });
    contextBar.append(
      contextItem(
        "Attribution",
        popover({
          trigger: attrBtn,
          label: "Attribution setting",
          align: "end",
          width: 300,
          render(panel, close) {
            const group = menuGroup("Attribution window");
            for (const option of ATTRIBUTION_WINDOWS) {
              group.append(
                menuItem(option.label, {
                  hint: option.note,
                  checked: state.params.attribution === option.id,
                  onClick: () => {
                    setParams({ attribution: option.id });
                    close();
                  },
                }),
              );
            }
            panel.append(group);
            panel.append(
              el(
                "p",
                "ads-menu-empty",
                "Meta-attributed results are one measurement, not the truth. Website- and CRM-observed outcomes are labelled separately everywhere they appear.",
              ),
            );
          },
        }),
      ),
    );

    const sync = ctx?.sync;
    const syncValue = el("div", "ads-context-value");
    const dot = el("span", "ads-sync-dot");
    const syncState = sync?.status || (state.contextStatus === "not_connected" ? "not_connected" : "error");
    dot.dataset.state = SYNC_STATES.includes(syncState) ? syncState : "error";
    syncValue.append(dot);
    syncValue.append(el("span", "", sync?.lastSuccessAt ? relativeAge(sync.lastSuccessAt) : "never"));
    const syncItem = contextItem("Last sync", syncValue);
    if (sync?.detail) syncItem.title = sync.detail;
    if (sync?.settleDays) {
      syncItem.title = `${syncItem.title || ""} Attribution continues to settle for about ${sync.settleDays} days, so a recent window is re-fetched rather than frozen.`.trim();
    }
    contextBar.append(syncItem);
  }

  // ------------------------------------------------------------ head actions --

  function renderHeadActions() {
    clear(headActions);
    const previewOn = Boolean(preview.enabled());
    headActions.append(
      button(previewOn ? "Preview on" : "Preview", {
        icon: ICONS.eye,
        variant: previewOn ? "ink" : "ghost",
        title: previewOn
          ? "Preview is on. Rows are synthetic. Turn it off to return to the real read model."
          : "Rehearse the workflow against clearly-labelled synthetic rows. Never mixed with live data.",
        onClick: () => setPreview(!previewOn),
      }),
    );
    headActions.append(
      button("Refresh", {
        icon: ICONS.refresh,
        title: "Queue a sync. Frank keeps showing the cached rows until it completes.",
        disabled: state.syncing,
        onClick: () => queueRefresh(),
      }),
    );
    headActions.append(
      button("Publish ads", {
        icon: ICONS.upload,
        variant: "ink",
        title: "Start a bulk launch: select creatives, configure, map, review, queue.",
        onClick: () => openPublish(),
      }),
    );
  }

  function setPreview(on) {
    preview.setEnabled(on);
    try {
      globalThis.localStorage?.setItem(PREVIEW_STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* preference is best-effort */
    }
    reader.clear();
    state.context = null;
    state.contextStatus = "loading";
    for (const screen of state.screens.values()) screen.dispose?.();
    state.screens.clear();
    renderHeadActions();
    renderContext();
    void loadContext().then(() => renderScreen({ force: true }));
    say(on ? "Preview on. Showing synthetic sample rows." : "Preview off. Showing saved reporting rows.");
  }

  async function queueRefresh() {
    state.syncing = true;
    renderHeadActions();
    say("Refresh queued. Frank keeps serving the saved rows until the sync completes.");
    // The read is deduplicated and queued server-side; the UI re-reads the same
    // rows and shows the sync state rather than pretending the numbers moved.
    await loadContext({ force: true });
    state.syncing = false;
    renderHeadActions();
    renderContext();
  }

  // ---------------------------------------------------------------- routing --

  function setParams(patch) {
    state.params = Object.freeze({ ...state.params, ...patch });
    renderContext();
    renderScreen({ force: true });
  }

  function screenHref(screenId) {
    const path = win?.location?.pathname || "/project/blockwise/ads";
    return `${path}?screen=${encodeURIComponent(screenId)}`;
  }

  function go(screenId, { focus = true } = {}) {
    if (!SCREEN_IDS.has(screenId) || screenId === state.screen) return;
    state.screens.get(state.screen)?.dispose?.();
    state.screens.delete(state.screen);
    state.screen = screenId;
    // replaceState rather than pushState: the owner workspace owns the back
    // stack for its sections, and adding entries here would make Back leave the
    // section instead of stepping within it.
    try {
      win?.history?.replaceState?.({ view: "blockwise-dashboard", projectId: "blockwise", ownerSection: "ads", adsScreen: screenId }, "", screenHref(screenId));
    } catch {
      /* history is best-effort */
    }
    renderNav();
    renderScreen({ focus });
  }

  function renderNav() {
    clear(nav);
    for (const screen of ADS_SCREENS) {
      const link = el("button", "ads-nav-link", screen.label);
      link.type = "button";
      if (screen.id === state.screen) link.setAttribute("aria-current", "page");
      link.title = screen.note;
      link.addEventListener("click", () => go(screen.id, { focus: true }));
      nav.append(link);
    }
  }

  function screenContext(screenId) {
    return Object.freeze({
      reader,
      win,
      doc,
      params: state.params,
      get context() {
        return state.context;
      },
      preview: preview.enabled(),
      isPreview: () => preview.enabled(),
      setParams,
      navigate: go,
      refresh: () => queueRefresh(),
      say,
      store: createViewStore(`screen.${screenId}`),
      openPublish: (seed) => openPublish(seed),
    });
  }

  function renderScreen({ focus = false, force = false } = {}) {
    const screen = ADS_SCREENS.find((s) => s.id === state.screen) || ADS_SCREENS[0];
    const existing = state.screens.get(screen.id);

    if (force || !existing) {
      existing?.dispose?.();
      state.screens.delete(screen.id);
      clear(screensHost);

      const body = el("div", "ads-screen");
      body.dataset.screen = screen.id;
      const title = el("h2", "ads-screen-title", screen.label);
      title.tabIndex = -1;
      const note = el("p", "ads-screen-note", screen.note);
      body.append(title, note);

      const content = el("div", "ads-screen-content");
      body.append(content);
      screensHost.append(body);
      screensHost.scrollTop = 0;

      if (preview.enabled()) {
        body.insertBefore(
          previewBanner({
            size: preview.size(),
            onSize: (size) => {
              preview.setSize(size);
              reader.clear();
              state.screens.get(screen.id)?.dispose?.();
              state.screens.delete(screen.id);
              renderScreen({ force: true });
            },
            onExit: () => setPreview(false),
          }),
          content,
        );
      }

      const factory = SCREEN_FACTORIES[screen.id];
      const instance = factory(screenContext(screen.id), content);
      state.screens.set(screen.id, instance);
      if (focus) title.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------ publish flow --

  let publishFlow = null;
  function openPublish(seed = null) {
    // One flow instance per workspace: reopening it keeps whatever the operator
    // had staged, rather than silently discarding a half-built plan.
    if (!publishFlow) publishFlow = createPublishFlow(screenContext("queue"), { host: root });
    if (seed) publishFlow.state.seed = seed;
    publishFlow.open();
  }

  // ------------------------------------------------------------- lifecycle --

  async function loadContext({ force = false } = {}) {
    const result = await reader.read("context", {}, { force, signal: state.controller.signal });
    if (state.disposed) return result;
    state.contextStatus = result.status;
    state.contextDetail = result.detail || "";
    state.context = result.status === "ready" ? result.data.meta : null;
    renderContext();
    return result;
  }

  const onStorage = (event) => {
    if (event.key === PREVIEW_STORAGE_KEY && event.newValue !== null) {
      const next = event.newValue === "1";
      if (next !== preview.enabled()) setPreview(next);
    }
  };
  win?.addEventListener?.("storage", onStorage);

  renderHeadActions();
  renderNav();
  renderContext();
  renderScreen();

  loadContext().then(() => {
    if (!state.disposed) renderScreen({ force: true });
  });

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.controller.abort();
    for (const screen of state.screens.values()) screen.dispose?.();
    state.screens.clear();
    win?.removeEventListener?.("storage", onStorage);
    root.remove();
  };
  dispose.whenSettled = async () => {
    await Promise.allSettled([...state.screens.values()].map((s) => s.settled?.()).filter(Boolean));
  };
  return dispose;
}

// Screen factories are registered here rather than imported into a switch, so
// the shell does not need to change when a screen does.
const SCREEN_FACTORIES = {
  overview: createOverviewScreen,
  campaigns: createCampaignsScreen,
  creative: createCreativeScreen,
  blogs: createBlogsScreen,
  tracking: createTrackingScreen,
  queue: createQueueScreen,
};

