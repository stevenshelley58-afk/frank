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
  errorPanel,
  skeleton,
} from "./ads-ui.js";
import { DATE_PRESETS, COMPARISON_MODES, ATTRIBUTION_WINDOWS, isoDay, formatDay, SYNC_STATES } from "./ads-contracts.js";
import { createAdsReader, createAdsCache } from "./ads-source.js";
import { createAdsDrafts, DRAFT_STORAGE_KEY } from "./ads-drafts.js";
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
  Object.freeze({ id: "overview", label: "Overview", note: "What needs attention, where spend works, and what to test next." }),
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

/**
 * Preview is a rehearsal switch, and it has to be switchable *from the link*.
 *
 * A deep link is the one piece of context a fresh browser has, so `?preview=1`
 * wins over the stored preference: an approval link that opens the workspace
 * must open it in the labelled rehearsal the owner was invited to look at,
 * without anybody having to set something up first. Everything downstream still
 * labels those rows as synthetic.
 */
function readPreviewFlag(win) {
  try {
    const value = new URLSearchParams(win?.location?.search || "").get("preview");
    if (value === "1" || value === "true" || value === "0" || value === "false") {
      const on = value === "1" || value === "true";
      // An explicit instruction in the link is remembered, because the owner
      // reaches this workspace from a link, then moves between screens and
      // sections, and a reload has to land where the link intended. Without
      // this, `?preview=1` survives exactly until the first click.
      try {
        globalThis.localStorage?.setItem(PREVIEW_STORAGE_KEY, on ? "1" : "0");
      } catch {
        /* the preference is best effort; the link still decides this visit */
      }
      return on;
    }
  } catch {
    /* a browser without URLSearchParams keeps the stored preference */
  }
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
  preview.setEnabled(options.preview ?? readPreviewFlag(win));

  const reader = createAdsReader({ fetchImpl: win.fetch?.bind(win), cache, preview });

  const root = el("div", "ads-workspace");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Ads");

  // One draft store for the whole workspace, shared by the publishing flow, the
  // campaign screens and the publishing queue. Its origin follows the preview
  // switch, so a rehearsal draft can never appear in the live queue.
  const draftStorage = (() => {
    try {
      return win?.localStorage || null;
    } catch {
      return null;
    }
  })();
  const drafts = createAdsDrafts({ storage: draftStorage, origin: () => (preview.enabled() ? "preview" : "live") });

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
    // A record another screen asked for, waiting for that screen to load.
    pendingRecord: null,
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
    // While the context read is in flight the strip says so. A dash where a
    // currency belongs reads as "the currency is nothing", which is a claim
    // this screen is not entitled to make.
    const loading = state.contextStatus === "loading";
    const missing = state.contextStatus === "not_connected" ? "Not connected" : "Not available";
    const accountValue = el("div", "ads-context-value");
    accountValue.append(el("span", "", ctx?.account?.name || (loading ? "Loading…" : missing)));
    contextBar.append(contextItem("Account", accountValue));

    const currencyValue = el("div", "ads-context-value");
    currencyValue.append(el("span", "", ctx?.account?.currency || (loading ? "Loading…" : missing)));
    contextBar.append(contextItem("Currency", currencyValue));

    const timezoneValue = el("div", "ads-context-value");
    timezoneValue.append(el("span", "", ctx?.account?.timezone || (loading ? "Loading…" : missing)));
    const timezoneItem = contextItem("Time zone", timezoneValue);
    timezoneItem.title = "Reporting days are cut in the account's own time zone, not the reader's.";
    contextBar.append(timezoneItem);

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
    // The read that failed is what the owner needs to see, even while the kept
    // record still says the last sync succeeded.
    const syncState = ["throttled", "error", "stale"].includes(state.contextStatus)
      ? state.contextStatus
      : sync?.status || (state.contextStatus === "not_connected" ? "not_connected" : "error");
    dot.dataset.state = SYNC_STATES.includes(syncState) ? syncState : "error";
    syncValue.append(dot);
    syncValue.append(el("span", "", sync?.lastSuccessAt ? relativeAge(sync.lastSuccessAt) : "never"));
    const syncItem = contextItem("Last sync", syncValue);
    if (sync?.detail) syncItem.title = sync.detail;
    // The failed read is said out loud, not only in the dot: the kept record's
    // own detail would otherwise describe a sync that has since failed.
    if (state.contextDetail) syncItem.title = `${syncItem.title ? `${syncItem.title} ` : ""}${state.contextDetail}`.trim();
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
        title: "Re-read this screen's saved rows. Nothing is sent to the provider.",
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
    // The link keeps describing what is on screen, so it can be handed on
    // without the recipient seeing something different from the sender.
    try {
      const url = new URL(win.location.href);
      url.searchParams.set("preview", on ? "1" : "0");
      win.history?.replaceState?.(win.history.state, "", url.toString());
    } catch {
      /* a browser that refuses the rewrite still switches the view */
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
    // Refresh re-reads the saved rows for the screen that is actually open. It
    // does not claim to have queued a provider sync: there is no sync queue in
    // this build, and saying otherwise would be a promise Frank cannot keep.
    const current = state.screens.get(state.screen);
    await Promise.allSettled([loadContext({ force: true }), current?.reload?.({ force: true })]);
    state.syncing = false;
    renderHeadActions();
    renderContext();
    say("Re-read the saved rows for this screen. Last known good rows stay on screen if the read fails.");
  }

  // ---------------------------------------------------------------- routing --

  function setParams(patch) {
    state.params = Object.freeze({ ...state.params, ...patch });
    renderContext();
    renderScreen({ force: true });
  }

  /**
   * The address for one screen.
   *
   * Every existing parameter is kept, so moving between screens does not quietly
   * drop the one that said this is a rehearsal. A link that loses its own
   * instructions on the first click is a link nobody can rely on.
   */
  function screenHref(screenId) {
    try {
      const url = new URL(win.location.href);
      url.searchParams.set("screen", screenId);
      return `${url.pathname}${url.search}`;
    } catch {
      const path = win?.location?.pathname || "/project/blockwise/ads";
      return `${path}?screen=${encodeURIComponent(screenId)}`;
    }
  }

  function go(screenId, { focus = true } = {}) {
    if (!SCREEN_IDS.has(screenId) || screenId === state.screen) return;
    const leaving = state.screens.get(state.screen);
    leaving?.dispose?.();
    state.screens.delete(state.screen);
    state.screen = screenId;
    // One history entry per screen, so Back steps through the screens the owner
    // actually visited and Forward returns along the same path. Replacing the
    // entry instead would make Back leave the section entirely, which reads as
    // "Back is broken" to anyone who has used a browser before.
    try {
      win?.history?.pushState?.({ view: "blockwise-dashboard", projectId: "blockwise", ownerSection: "ads", adsScreen: screenId }, "", screenHref(screenId));
    } catch {
      /* history is best-effort */
    }
    renderNav();
    renderScreen({ focus });
  }

  /**
   * Follow the address bar.
   *
   * The shell already listens for popstate and re-mounts the section, which
   * covers Back and Forward on its own. This listener covers the case where the
   * workspace is mounted somewhere that does not: the screen named in the URL is
   * the screen shown, whatever brought the URL there.
   */
  function onPopState() {
    const wanted = readScreenFromUrl(win) || "overview";
    if (wanted === state.screen) return;
    const leaving = state.screens.get(state.screen);
    leaving?.dispose?.();
    state.screens.delete(state.screen);
    state.screen = wanted;
    renderNav();
    renderScreen({ focus: false });
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
      // The shared draft model. Every screen reads and writes the same records.
      drafts,
      openPublish: (seed) => openPublish(seed),
      openDraft: (id) => openDraft(id),
      openRecord: (request) => openRecord(request),
      /**
       * A record another screen asked this one to show. A screen calls this
       * once its rows exist; the request is consumed so a later render does not
       * reopen a drawer the operator has already closed.
       */
      takePendingRecord: () => {
        const request = state.pendingRecord && state.pendingRecord.screen === screenId ? state.pendingRecord : null;
        state.pendingRecord = null;
        return request;
      },
      /** A screen calls this when a record it was asked for is not in its rows,
       *  so a drill-down that cannot be honoured is said out loud rather than
       *  looking like a link that did nothing. */
      recordMiss: (request) => {
        const kind = String(request?.kind || "").trim();
        const id = String(request?.id || "").trim();
        say(`${kind ? `${kind[0].toUpperCase()}${kind.slice(1)} ` : "That record "}${id} is not in the rows this screen can read.`);
      },
    });
  }

  /**
   * Open one record in the screen that owns it.
   *
   * The request travels through the workspace rather than through a URL because
   * the record is what matters, not a link somebody could paste: a campaign id
   * means nothing outside this workspace, and the screen that owns it already
   * knows how to show it.
   */
  function openRecord({ kind = "", id = "", screen = "" } = {}) {
    const target = SCREEN_IDS.has(String(screen)) ? String(screen) : state.screen;
    const request = Object.freeze({ kind: String(kind || ""), id: String(id || ""), screen: target });
    const miss = () => say(`That record is in ${target}, but it is not in the rows on screen.`);
    if (target === state.screen) {
      const handled = state.screens.get(target)?.focusRecord?.(request);
      // A screen that has to change level or wait for a read answers with a
      // promise; a drill-down must not report success before it knows.
      if (handled && typeof handled.then === "function") {
        handled.then((opened) => {
          if (!opened) miss();
        }, miss);
        return true;
      }
      if (!handled) miss();
      return Boolean(handled);
    }
    // The other screen has to load before it can show anything, so the request
    // waits for it instead of being lost to the navigation.
    state.pendingRecord = request;
    go(target, { focus: false });
    return true;
  }

  /**
   * Render one screen, and never leave the owner looking at nothing.
   *
   * A screen that throws while it is being built used to take the whole mount
   * with it, which is indistinguishable from a dead page. The failure is named
   * on screen, the rest of the workspace keeps working, and the retry is the
   * same code path as any other re-render.
   */
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
      let instance = null;
      try {
        instance = factory(screenContext(screen.id), content);
      } catch (error) {
        instance = null;
        renderScreenFailure(content, screen, error);
        say(`${screen.label} could not be shown. The rest of the workspace still works.`);
        if (win?.console?.error) win.console.error(`ads: ${screen.id} failed to build`, error);
      }
      state.screens.set(screen.id, instance || { dispose: () => {} });
      if (focus) title.focus({ preventScroll: true });
    }
  }

  /** The named failure that replaces a blank screen. */
  function renderScreenFailure(content, screen, error) {
    clear(content);
    content.append(
      errorPanel({
        title: `${screen.label} could not be shown`,
        detail: `The screen failed while it was being built, so nothing here is a reading. The other screens are unaffected. ${String(error?.message || error || "unknown error")}`,
        onRetry: () => renderScreen({ force: true, focus: true }),
      }),
    );
  }

  // ------------------------------------------------------------ publish flow --

  let publishFlow = null;
  function openPublish(seed = null) {
    // One flow instance per workspace: reopening it keeps whatever the operator
    // had staged, rather than silently discarding a half-built plan.
    if (!publishFlow) publishFlow = createPublishFlow(screenContext("queue"), { host: root });
    if (seed?.draft) publishFlow.loadDraft(seed.draft);
    else if (seed) publishFlow.state.seed = seed;
    publishFlow.open();
  }

  /** Reopen a staged launch from the queue, exactly as it was saved. */
  function openDraft(id) {
    const draft = drafts.get(id);
    if (!draft) {
      say("That draft is no longer in this workspace.");
      renderScreen({ force: true });
      return;
    }
    if (draft.kind !== "launch") {
      say("That staged change is not a launch. Its rows are reviewed in the queue.");
      return;
    }
    openPublish({ draft });
  }

  // ------------------------------------------------------------- lifecycle --

  async function loadContext({ force = false } = {}) {
    const result = await reader.read("context", {}, { force, signal: state.controller.signal });
    if (state.disposed) return result;
    // The read that actually failed, when the record is one the reader kept.
    state.contextStatus = result.failedStatus || result.status;
    state.contextDetail = result.detail || "";
    // A failed re-read must not erase the last successful sync the header states.
    if (result.data?.meta) state.context = result.data.meta;
    renderContext();
    return result;
  }

  const onStorage = (event) => {
    if (event.key === PREVIEW_STORAGE_KEY && event.newValue !== null) {
      const next = event.newValue === "1";
      if (next !== preview.enabled()) setPreview(next);
    }
    // A draft written by another tab is somebody else's work. This tab's store
    // re-reads it so the queue shows it, while the publishing flow's open copy is
    // deliberately left where it is: a save built on the older revision is then
    // refused instead of quietly replacing the other edit.
    if (event.key === DRAFT_STORAGE_KEY) drafts.reload();
  };
  win?.addEventListener?.("storage", onStorage);
  win?.addEventListener?.("popstate", onPopState);

  /**
   * Leaving with unsaved work is the one silent loss this screen can prevent.
   * The browser asks; the wizard's own footer says which draft is unsaved.
   */
  const onBeforeUnload = (event) => {
    if (!publishFlow?.hasUnsavedWork?.()) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
  };
  win?.addEventListener?.("beforeunload", onBeforeUnload);

  /**
   * First paint. Everything here can fail on a browser this build has never seen,
   * and a blank panel is the one outcome the owner cannot interpret, so a
   * failure is drawn as a named panel with a retry rather than thrown away.
   *
   * The screen is built once, after the context read has settled, rather than
   * built and then replaced a moment later. The second build used to dispose the
   * first screen and cancel the reads it had started — including reads the
   * replacement then joined, which is how a cold load could end up reporting a
   * failure it had no reason to report. A skeleton holds the space meanwhile,
   * so the wait is still visible rather than blank.
   */
  function boot() {
    renderHeadActions();
    renderNav();
    renderContext();
    showScreenSkeleton();
    loadContext().then(
      () => {
        if (!state.disposed) renderScreen();
      },
      (error) => {
        if (state.disposed) return;
        state.contextStatus = "error";
        state.contextDetail = String(error?.message || error || "the context read failed");
        renderContext();
        say("The ads context could not be read. The screens below still work and say what they are missing.");
      },
    );
  }

  /** The shape of a screen, while the context read is in flight. */
  function showScreenSkeleton() {
    clear(screensHost);
    const body = el("div", "ads-screen");
    body.dataset.screen = "loading";
    const title = el("h2", "ads-screen-title", ADS_SCREENS.find((s) => s.id === state.screen)?.label || "Ads");
    body.append(title, el("p", "ads-screen-note", "Reading the account context…"), skeleton(5, 4));
    screensHost.append(body);
  }

  try {
    boot();
  } catch (error) {
    clear(host);
    host.append(
      errorPanel({
        title: "The ads workspace could not start",
        detail: `Nothing is wrong with your data. This browser refused something the workspace needs before it could draw anything. ${String(error?.message || error || "unknown error")}`,
      }),
    );
    if (win?.console?.error) win.console.error("ads: workspace failed to start", error);
  }

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.controller.abort();
    for (const screen of state.screens.values()) screen.dispose?.();
    state.screens.clear();
    win?.removeEventListener?.("storage", onStorage);
    win?.removeEventListener?.("popstate", onPopState);
    win?.removeEventListener?.("beforeunload", onBeforeUnload);
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

