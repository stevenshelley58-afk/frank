const API_ROOT = "/api/ad-db";
const RELATIONS = new Set(["office", "service_area", "property", "copy_mention", "meta_targeting"]);
const TAB_ENDPOINTS = { ads: "/ads", prospects: "/prospects", runs: "/runs" };
const state = {
  active: false,
  mounted: false,
  tab: "ads",
  request: null,
  filters: {},
  detail: null,
  detailRequest: null,
  scanRequest: null,
  pages: {
    ads: { items: [], nextCursor: null, loaded: false },
    prospects: { items: [], nextCursor: null, loaded: false },
    runs: { items: [], nextCursor: null, loaded: false },
  },
};

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

export function safeArchiveUrl(value) {
  const candidate = text(value);
  return /^\/api\/ad-db\/ads\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\/media\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(candidate) ? candidate : "";
}

export function buildAdDbQuery(filters = {}, cursor = null, limit = 20) {
  const params = new URLSearchParams();
  const mappings = [
    ["q", "q"],
    ["agent", "agentName"],
    ["agency", "agencyName"],
    ["state", "state"],
    ["suburb", "suburb"],
    ["postcode", "postcode"],
  ];
  for (const [source, target] of mappings) {
    const value = text(filters[source]);
    if (value) params.set(target, value);
  }
  const relation = text(filters.locationRelation);
  if (RELATIONS.has(relation)) params.set("locationRelation", relation);
  if (cursor) params.set("cursor", text(cursor));
  params.set("limit", String(Math.min(100, Math.max(1, Number(limit) || 20))));
  return params;
}

export function normaliseAdDbPage(payload) {
  if (!payload || !Array.isArray(payload.items) || !payload.page || typeof payload.page !== "object") {
    throw new Error("Frank returned an invalid Ad DB response.");
  }
  const next = payload.page.nextCursor;
  if (next !== null && next !== undefined && typeof next !== "string") {
    throw new Error("Frank returned an invalid Ad DB cursor.");
  }
  return { items: payload.items, nextCursor: next || null };
}

export function adDbDateLabel(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function ownershipLabels(ownership) {
  if (!ownership || typeof ownership !== "object") return [];
  return ["agent", "agency"].flatMap((kind) => {
    const owner = ownership[kind];
    if (!owner || typeof owner !== "object" || !text(owner.name)) return [];
    const relationship = text(owner.relationship).replaceAll("_", " ");
    return [{ kind, name: text(owner.name), relationship }];
  });
}

export function archivedMedia(media) {
  if (!Array.isArray(media)) return [];
  return media.flatMap((asset) => {
    const archiveUrl = safeArchiveUrl(asset?.archiveUrl);
    const mimeType = text(asset?.mimeType).toLowerCase();
    const kind = text(asset?.kind).toLowerCase();
    const displayKind = mimeType.startsWith("image/") || kind === "image"
      ? "image"
      : mimeType.startsWith("video/") || kind === "video"
        ? "video"
        : "";
    return archiveUrl && displayKind ? [{ ...asset, archiveUrl, displayKind }] : [];
  });
}

export function runReadiness(run) {
  if (run?.coverage_complete === true && run?.pagination_exhausted === true) return "Coverage complete";
  if (run?.status === "running") return "Collection running";
  if (run?.status === "failed") return "Collection failed";
  return "Coverage not confirmed";
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = text(content);
  return node;
}

function appendMeta(host, label, value) {
  const clean = text(value);
  if (!clean) return;
  const item = element("span", "ad-db-meta-item");
  item.append(element("strong", "", label), document.createTextNode(clean));
  host.append(item);
}

function formatRelationship(value) {
  return text(value).replaceAll("_", " ");
}

function locationLabel(location) {
  return [location?.suburb, location?.state, location?.postcode].map((part) => text(part)).filter(Boolean).join(" ");
}

function renderMedia(ad) {
  const frame = element("div", "ad-db-media");
  const assets = archivedMedia(ad?.media);
  if (!assets.length) {
    frame.classList.add("is-missing");
    frame.append(element("span", "", "No verified archive media"));
    return frame;
  }
  const asset = assets[0];
  if (asset.displayKind === "image") {
    const image = document.createElement("img");
    image.src = asset.archiveUrl;
    image.alt = text(ad?.headline || ad?.primary_text, "Archived ad creative");
    image.loading = "lazy";
    frame.append(image);
  } else {
    const video = document.createElement("video");
    video.src = asset.archiveUrl;
    video.controls = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", text(ad?.headline, "Archived ad video"));
    frame.append(video);
  }
  if (assets.length > 1) frame.append(element("span", "ad-db-media-count", String(assets.length) + " archived assets"));
  return frame;
}

export function adDetailRoute(id) {
  const clean = text(id);
  return clean ? API_ROOT + "/ads/" + encodeURIComponent(clean) : "";
}

function renderAdDetail() {
  const panel = root()?.querySelector("[data-ad-db-detail]");
  if (!panel) return;
  panel.replaceChildren();
  if (!state.detail) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const close = element("button", "ad-db-detail-close", "Close detail");
  close.type = "button";
  close.addEventListener("click", () => {
    state.detail = null;
    renderCurrent();
  });
  const heading = element("h3", "", text(state.detail?.headline || state.detail?.page_name, "Observed ad"));
  const header = element("div", "ad-db-detail-heading");
  header.append(heading, close);
  panel.append(header, renderMedia(state.detail));
  const copy = text(state.detail?.primary_text || state.detail?.body);
  if (copy) panel.append(element("p", "ad-db-detail-copy", copy));
  const owners = ownershipLabels(state.detail?.ownership);
  if (owners.length) {
    const ownerRow = element("div", "ad-db-owner-row");
    owners.forEach((owner) => ownerRow.append(element("span", "ad-db-tag", [owner.kind, owner.name, formatRelationship(owner.relationship)].filter(Boolean).join(" · "))));
    panel.append(ownerRow);
  }
  const locations = Array.isArray(state.detail?.locations) ? state.detail.locations : [];
  if (locations.length) {
    const locationRow = element("div", "ad-db-owner-row");
    locations.forEach((location) => locationRow.append(element("span", "ad-db-tag", [locationLabel(location), formatRelationship(location?.relation)].filter(Boolean).join(" · "))));
    panel.append(locationRow);
  }
  const meta = element("div", "ad-db-meta");
  appendMeta(meta, "First seen", adDbDateLabel(state.detail?.first_seen_at));
  appendMeta(meta, "Last seen", adDbDateLabel(state.detail?.last_seen_at));
  appendMeta(meta, "Creative", state.detail?.ad_creative_id);
  panel.append(meta);
}

async function openAdDetail(ad) {
  const id = text(ad?.id);
  if (!id || state.detailRequest) return;
  state.detail = ad;
  renderCurrent();
  setStatus("Loading ad detail…");
  const controller = new AbortController();
  state.detailRequest = controller;
  try {
    const response = await fetch(adDetailRoute(id), { credentials: "same-origin", signal: controller.signal, headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(payload?.error || payload?.detail, "Frank could not load this ad."));
    state.detail = payload?.item || payload;
    renderCurrent();
    setStatus("Ad detail loaded");
  } catch (error) {
    if (error.name === "AbortError") return;
    const panel = root()?.querySelector("[data-ad-db-detail]");
    if (panel) {
      panel.hidden = false;
      panel.replaceChildren(element("h3", "", "Could not load ad detail"), element("p", "", error.message));
    }
    setStatus(error.message, "error");
  } finally {
    if (state.detailRequest === controller) state.detailRequest = null;
  }
}

function renderAds(items, host) {
  for (const ad of items) {
    const article = element("article", "ad-db-ad");
    article.append(renderMedia(ad));
    const body = element("div", "ad-db-record-body");
    const heading = element("button", "ad-db-record-link", text(ad?.headline || ad?.page_name, "Untitled observed ad"));
    heading.type = "button";
    heading.addEventListener("click", () => openAdDetail(ad));
    body.append(heading);
    const primary = text(ad?.primary_text || ad?.body);
    if (primary) body.append(element("p", "ad-db-copy", primary));
    const owners = ownershipLabels(ad?.ownership);
    if (owners.length) {
      const ownerRow = element("div", "ad-db-owner-row");
      for (const owner of owners) {
        const ownerText = owner.relationship
          ? owner.kind + " · " + owner.name + " · " + formatRelationship(owner.relationship)
          : owner.kind + " · " + owner.name;
        ownerRow.append(element("span", "ad-db-tag", ownerText));
      }
      body.append(ownerRow);
    }
    const locations = Array.isArray(ad?.locations) ? ad.locations : [];
    if (locations.length) {
      const locationRow = element("div", "ad-db-owner-row");
      for (const location of locations) {
        const label = [locationLabel(location), formatRelationship(location?.relation)].filter(Boolean).join(" · ");
        if (label) locationRow.append(element("span", "ad-db-tag", label));
      }
      body.append(locationRow);
    }
    const meta = element("div", "ad-db-meta");
    appendMeta(meta, "First seen", adDbDateLabel(ad?.first_seen_at));
    appendMeta(meta, "Last seen", adDbDateLabel(ad?.last_seen_at));
    appendMeta(meta, "Library ID", ad?.library_id || ad?.ad_library_id);
    appendMeta(meta, "Platform", ad?.platform);
    body.append(meta);
    article.append(body);
    host.append(article);
  }
}

function renderProspects(items, host) {
  for (const prospect of items) {
    const article = element("article", "ad-db-prospect");
    const identity = element("div", "ad-db-prospect-identity");
    const isAgency = prospect?.prospect_type === "agency";
    const isAgent = prospect?.prospect_type === "agent";
    const kind = isAgency ? "agency" : isAgent ? "agent" : "advertiser page";
    const displayName = prospect?.page_name || prospect?.name;
    identity.append(element("span", "ad-db-eyebrow", kind), element("h3", "", text(displayName, "Unnamed prospect")));
    const pageId = text(prospect?.page_id);
    if (pageId) identity.append(element("p", "", "Meta Page ID · " + pageId));
    article.append(identity);
    const facts = element("div", "ad-db-prospect-facts");
    appendMeta(facts, "Agent", isAgent ? prospect?.name : null);
    appendMeta(facts, "Agency", isAgency ? prospect?.name : prospect?.agency?.name);
    appendMeta(facts, "Observed ads", prospect?.observed_ad_count);
    appendMeta(facts, "Scan state", formatRelationship(prospect?.scan_state));
    appendMeta(facts, "Last scan", prospect?.last_scan_completed_at ? adDbDateLabel(prospect.last_scan_completed_at) : "Not recorded");
    article.append(facts);
    host.append(article);
  }
}

function costLabel(run) {
  const raw = run?.cost_usd ?? run?.cost;
  if (raw === null || raw === undefined || raw === "") return "Not reported";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? "$" + numeric.toFixed(2) : text(raw, "Not reported");
}

function renderRuns(items, host) {
  for (const run of items) {
    const article = element("article", "ad-db-run");
    const lead = element("div", "ad-db-run-lead");
    lead.append(element("span", "ad-db-eyebrow", text(run?.scan_mode, "scan")), element("h3", "", text(run?.status, "Status not recorded")));
    lead.append(element("p", "", runReadiness(run)));
    article.append(lead);
    const facts = element("div", "ad-db-run-facts");
    appendMeta(facts, "Started", adDbDateLabel(run?.started_at));
    appendMeta(facts, "Completed", run?.completed_at ? adDbDateLabel(run.completed_at) : "Not recorded");
    appendMeta(facts, "Ads seen", run?.ads_seen);
    appendMeta(facts, "Media captured", run?.media_captured);
    appendMeta(facts, "Cost", costLabel(run));
    appendMeta(facts, "Stop reason", formatRelationship(run?.stop_reason));
    article.append(facts);
    host.append(article);
  }
}

function root() {
  return document.querySelector("#ad-db");
}

function pageState() {
  return state.pages[state.tab];
}

function renderCurrent() {
  const host = root()?.querySelector("[data-ad-db-results]");
  if (!host) return;
  host.replaceChildren();
  const page = pageState();
  if (!page.items.length) {
    const empty = element("div", "ad-db-empty");
    empty.append(
      element("h3", "", state.tab === "runs" ? "No collection runs recorded" : "No matching records"),
      element("p", "", state.tab === "runs"
        ? "Frank will show verified run history when the collection service records it."
        : "Try widening the filters. Frank does not substitute sample data."),
    );
    host.append(empty);
  } else if (state.tab === "ads") renderAds(page.items, host);
  else if (state.tab === "prospects") renderProspects(page.items, host);
  else renderRuns(page.items, host);
  const more = root().querySelector("[data-ad-db-more]");
  more.hidden = !page.nextCursor;
  more.disabled = false;
}

function setStatus(message, kind = "") {
  const status = root()?.querySelector("[data-ad-db-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

async function fetchPage({ append = false } = {}) {
  if (!state.active || state.request) return;
  const page = pageState();
  const cursor = append ? page.nextCursor : null;
  const params = buildAdDbQuery(state.tab === "runs" ? {} : state.filters, cursor);
  const controller = new AbortController();
  state.request = controller;
  const host = root().querySelector("[data-ad-db-results]");
  const more = root().querySelector("[data-ad-db-more]");
  more.disabled = true;
  if (!append) {
    host.replaceChildren(element("div", "ad-db-loading", "Loading verified " + state.tab + "…"));
  }
  setStatus("Loading " + state.tab + "…");
  try {
    const response = await fetch(API_ROOT + TAB_ENDPOINTS[state.tab] + "?" + params.toString(), {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(payload?.error || payload?.detail, "Frank could not load this view."));
    const incoming = normaliseAdDbPage(payload);
    page.items = append ? page.items.concat(incoming.items) : incoming.items;
    page.nextCursor = incoming.nextCursor;
    page.loaded = true;
    renderCurrent();
    setStatus(page.items.length + " " + state.tab + " loaded");
  } catch (error) {
    if (error.name === "AbortError") return;
    if (!append) host.replaceChildren();
    const failure = element("div", "ad-db-error");
    failure.append(element("h3", "", "Could not load " + state.tab), element("p", "", error.message));
    const retry = element("button", "ad-db-button", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => fetchPage({ append: false }));
    failure.append(retry);
    host.append(failure);
    setStatus(error.message, "error");
  } finally {
    if (state.request === controller) state.request = null;
    more.disabled = false;
  }
}

function newIdempotencyKey() {
  const suffix = globalThis.crypto?.randomUUID?.() || String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  return "frank-scan-" + suffix;
}

function scanFormMessage(message, kind = "") {
  const node = root()?.querySelector("[data-ad-db-scan-status]");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

async function fetchScanReadiness() {
  const node = root()?.querySelector("[data-ad-db-scan-readiness]");
  if (!node) return;
  try {
    const response = await fetch(API_ROOT + "/runs/readiness", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(payload?.error || payload?.detail, "Readiness unavailable"));
    const blocked = payload?.status === "blocked" || payload?.providerStatus === "blocked";
    node.textContent = blocked
      ? "Blocked · " + text(payload?.reason, "collection provider is not ready")
      : "Ready · explicit page scans use Hermes’ durable queue";
    node.dataset.kind = blocked ? "error" : "ready";
    const submit = root()?.querySelector("[data-ad-db-scan-form] button[type=submit]");
    if (submit) submit.disabled = blocked;
  } catch (error) {
    node.textContent = "Readiness unavailable · " + error.message;
    node.dataset.kind = "error";
    const submit = root()?.querySelector("[data-ad-db-scan-form] button[type=submit]");
    if (submit) submit.disabled = true;
  }
}

async function submitScan(event) {
  event.preventDefault();
  if (state.scanRequest) return;
  const form = event.currentTarget;
  const raw = text(new FormData(form).get("pageIds"));
  const pageIds = raw.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  const maxCredits = Number(new FormData(form).get("maxCredits") || 25);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!pageIds.length || pageIds.length > 50 || pageIds.some((value) => !uuid.test(value)) || new Set(pageIds).size !== pageIds.length) {
    scanFormMessage("Enter 1–50 distinct advertiser page UUIDs.", "error");
    return;
  }
  if (!Number.isFinite(maxCredits) || maxCredits <= 0 || maxCredits > 25) {
    scanFormMessage("Max credits must be between 0 and 25.", "error");
    return;
  }
  const controller = new AbortController();
  state.scanRequest = controller;
  scanFormMessage("Submitting explicit pages…");
  try {
    const response = await fetch(API_ROOT + "/runs/scan", {
      method: "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds, maxCredits, idempotencyKey: newIdempotencyKey() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(payload?.error || payload?.detail?.reason, "Hermes could not queue this scan."));
    scanFormMessage(pageIds.length + " page" + (pageIds.length === 1 ? "" : "s") + " queued. Run history will update as the worker progresses.", "ready");
    state.pages.runs = { items: [], nextCursor: null, loaded: false };
    if (state.tab === "runs") fetchPage();
  } catch (error) {
    if (error.name !== "AbortError") scanFormMessage(error.message, "error");
  } finally {
    if (state.scanRequest === controller) state.scanRequest = null;
  }
}

function selectTab(tab, { focus = false } = {}) {
  if (!TAB_ENDPOINTS[tab]) return;
  state.tab = tab;
  const host = root();
  for (const button of host.querySelectorAll("[role=tab]")) {
    const selected = button.dataset.adDbTab === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  host.querySelector("[data-ad-db-filters]").hidden = tab === "runs";
  host.querySelector("[data-ad-db-runs-note]").hidden = tab !== "runs";
  const page = pageState();
  if (page.loaded) {
    renderCurrent();
    setStatus(page.items.length + " " + tab + " loaded");
  } else {
    fetchPage();
  }
}

function readFilters(form) {
  const data = new FormData(form);
  return Object.fromEntries(["q", "agent", "agency", "state", "suburb", "postcode", "locationRelation"].map((key) => [key, text(data.get(key))]));
}

function scaffold(host) {
  host.innerHTML = [
    '<div class="ad-db-heading">',
      '<div><span class="ad-db-eyebrow">Verified archive</span><h2>Ad database</h2>',
      '<p>Observed ads, contact-safe prospects and collection evidence from Hermes.</p></div>',
      '<span class="ad-db-readonly">Read only</span>',
    '</div>',
    '<div class="ad-db-tabs" role="tablist" aria-label="Ad database views">',
      '<button type="button" role="tab" data-ad-db-tab="ads" aria-controls="ad-db-results" aria-selected="true">Ads</button>',
      '<button type="button" role="tab" data-ad-db-tab="prospects" aria-controls="ad-db-results" aria-selected="false" tabindex="-1">Prospects</button>',
      '<button type="button" role="tab" data-ad-db-tab="runs" aria-controls="ad-db-results" aria-selected="false" tabindex="-1">Runs</button>',
    '</div>',
    '<form class="ad-db-filters" data-ad-db-filters>',
      '<label class="ad-db-search"><span>Search</span><input name="q" type="search" maxlength="120" placeholder="Ad copy or page"></label>',
      '<label><span>Agent</span><input name="agent" maxlength="120"></label>',
      '<label><span>Agency</span><input name="agency" maxlength="120"></label>',
      '<label><span>State</span><input name="state" maxlength="120" placeholder="WA"></label>',
      '<label><span>Suburb</span><input name="suburb" maxlength="120"></label>',
      '<label><span>Postcode</span><input name="postcode" maxlength="120" inputmode="numeric"></label>',
      '<label><span>Location evidence</span><select name="locationRelation"><option value="">Any evidence</option><option value="office">Office</option><option value="service_area">Service area</option><option value="property">Property</option><option value="copy_mention">Copy mention</option><option value="meta_targeting">Meta targeting</option></select></label>',
      '<div class="ad-db-filter-actions"><button type="reset">Clear</button><button type="submit" class="ad-db-button">Apply filters</button></div>',
    '</form>',
    '<div class="ad-db-runs-note" data-ad-db-runs-note hidden><strong>Bounded page scan</strong><span data-ad-db-scan-readiness>Checking collection readiness…</span>',
      '<form class="ad-db-scan-form" data-ad-db-scan-form>',
        '<label><span>Advertiser Page IDs</span><textarea name="pageIds" rows="2" maxlength="5000" placeholder="One UUID per line"></textarea></label>',
        '<label><span>Max credits per page</span><input name="maxCredits" type="number" min="1" max="25" step="1" value="25"></label>',
        '<button type="submit" class="ad-db-button" disabled>Queue pages</button>',
        '<span data-ad-db-scan-status aria-live="polite"></span>',
      '</form>',
    '</div>',
    '<p class="ad-db-location-help">Location evidence stays explicit: office, service area, property, copy mention, or Meta targeting. A property location is not ad targeting.</p>',
    '<p class="sr-only" data-ad-db-status aria-live="polite"></p>',
    '<div class="ad-db-detail" data-ad-db-detail hidden></div>',
    '<div class="ad-db-results" id="ad-db-results" role="tabpanel" data-ad-db-results></div>',
    '<div class="ad-db-more-row"><button type="button" class="ad-db-button" data-ad-db-more hidden>Load more</button></div>',
  ].join("");
}

export function mountAdDb() {
  const host = root();
  if (!host || state.mounted) return;
  scaffold(host);
  state.mounted = true;
  host.querySelector("[data-ad-db-scan-form]").addEventListener("submit", submitScan);
  fetchScanReadiness();
  host.querySelector("[data-ad-db-filters]").addEventListener("submit", (event) => {
    event.preventDefault();
    state.filters = readFilters(event.currentTarget);
    state.pages.ads = { items: [], nextCursor: null, loaded: false };
    state.pages.prospects = { items: [], nextCursor: null, loaded: false };
    fetchPage();
  });
  host.querySelector("[data-ad-db-filters]").addEventListener("reset", () => {
    queueMicrotask(() => {
      state.filters = {};
      state.detail = null;
      state.pages.ads = { items: [], nextCursor: null, loaded: false };
      state.pages.prospects = { items: [], nextCursor: null, loaded: false };
      fetchPage();
    });
  });
  host.querySelector("[data-ad-db-more]").addEventListener("click", () => fetchPage({ append: true }));
  const tabs = Array.from(host.querySelectorAll("[role=tab]"));
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => selectTab(button.dataset.adDbTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
      selectTab(tabs[next].dataset.adDbTab, { focus: true });
    });
  });
}

export function setAdDbActive(active) {
  state.active = Boolean(active);
  if (!state.active) {
    state.request?.abort();
    state.request = null;
    return;
  }
  mountAdDb();
  if (!pageState().loaded) fetchPage();
}
