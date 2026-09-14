// Ads read model access.
//
// The dashboard is a reader. Opening a tab, changing a filter or switching a
// date range does not call Meta: it re-reads rows a scheduled sync already
// wrote, through one Frank endpoint per screen. That is the whole reason the
// UI can stay responsive while the provider is throttling us.
//
// Every reader resolves to the same envelope so a screen never has to guess
// what happened:
//
//   { status, data, detail, fetchedAt, origin, cached }
//
// `status` is one of the SYNC_STATES. `not_connected` is a first-class outcome,
// not an error: before the reporting sync is wired, every screen renders
// "Not connected" and says what would connect it. It never falls back to
// fixtures. Fixtures live in `ads-preview-data.js` and are reachable only when
// the operator explicitly turns preview on.

import { SYNC_STATES } from "./ads-contracts.js";

export const ADS_ENDPOINT_BASE = "/api/owner/ads";

export const READER_PATHS = Object.freeze({
  context: "/context",
  overview: "/overview",
  entities: "/entities",
  creatives: "/creatives",
  blogs: "/blogs",
  tracking: "/tracking",
  queue: "/queue",
});

// What each reader needs before it can answer at all. Shown verbatim in the
// not-connected state so the screen explains itself instead of just failing.
export const READER_REQUIREMENTS = Object.freeze({
  context: "the connected ad account, its currency, time zone and the reporting sync schedule",
  overview: "a completed reporting sync for the selected window",
  entities: "saved daily rows for campaigns, ad sets and ads",
  creatives: "saved creative rows joined to their ad and generation prompt",
  blogs: "the site's own analytics joined to this account's tracking parameters",
  tracking: "the account's UTM templates and the destination history",
  queue: "the publishing queue and its attempt history",
});

export function readerUrl(reader, params = {}) {
  const path = READER_PATHS[reader];
  if (!path) throw new Error(`Unknown ads reader: ${reader}`);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== null && item !== undefined && item !== "") query.append(key, String(item));
    } else {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return `${ADS_ENDPOINT_BASE}${path}${qs ? `?${qs}` : ""}`;
}

function envelope(status, { data = null, detail = "", fetchedAt = Date.now(), origin = "live", cached = null } = {}) {
  return Object.freeze({
    status: SYNC_STATES.includes(status) ? status : "error",
    data,
    detail,
    fetchedAt,
    origin,
    cached,
    connected: status !== "not_connected",
  });
}

/** Normalise whatever the endpoint returned into `{ rows, meta }`. A reader
 *  that returns a bare array is accepted; anything else malformed is an error
 *  rather than a silently empty screen. */
function unpack(payload) {
  if (Array.isArray(payload)) return { rows: payload, meta: {} };
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.rows)) return { rows: payload.rows, meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {} };
    if (Array.isArray(payload.items)) return { rows: payload.items, meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {} };
    if (payload.record && typeof payload.record === "object") return { rows: null, meta: payload.record };
  }
  return null;
}

/**
 * One reader call. Never throws: a caller gets a status it can render.
 *
 * `signal` lets a screen abandon a read when the operator moves on, which is
 * what keeps filter thrash from queueing work.
 */
export async function readAds(reader, params = {}, { fetchImpl = globalThis.fetch, signal = null } = {}) {
  const url = readerUrl(reader, params);
  if (typeof fetchImpl !== "function") {
    return envelope("error", { detail: "This browser cannot reach the Frank read model.", origin: "live" });
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: signal || undefined,
    });
  } catch (error) {
    if (error && error.name === "AbortError") return envelope("error", { detail: "superseded", origin: "live" });
    return envelope("error", {
      detail: navigatorOnLine() ? "The Frank read model did not answer." : "This device is offline; cached rows stay visible.",
      origin: "live",
    });
  }

  // 404 and 501 are the honest "this has not been built yet" answers. Treating
  // them as an empty result would be the single most misleading thing this
  // module could do.
  if (response.status === 404 || response.status === 501) {
    return envelope("not_connected", {
      detail: READER_REQUIREMENTS[reader] || "the reporting sync",
      origin: "live",
    });
  }
  if (response.status === 429) {
    return envelope("throttled", {
      detail: "The provider is rate limiting the sync. Cached rows stay visible and the next refresh is queued.",
      origin: "live",
    });
  }
  if (!response.ok) {
    return envelope("error", { detail: `The read model answered ${response.status}.`, origin: "live" });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return envelope("error", { detail: "The read model answered with something that is not JSON.", origin: "live" });
  }

  const unpacked = unpack(payload);
  if (!unpacked) {
    return envelope("error", { detail: "The read model answered in an unexpected shape.", origin: "live" });
  }

  const meta = unpacked.meta || {};
  const declared = String(meta.status || "").toLowerCase();
  const fetchedAt = Date.parse(meta.syncedAt || meta.fetchedAt || "") || Date.now();
  const status = SYNC_STATES.includes(declared) ? declared : unpacked.rows && unpacked.rows.length ? "ready" : "empty";

  return envelope(status, {
    data: { rows: unpacked.rows, meta },
    detail: typeof meta.detail === "string" ? meta.detail : "",
    fetchedAt,
    origin: "live",
  });
}

function navigatorOnLine() {
  try {
    return globalThis.navigator?.onLine !== false;
  } catch {
    return true;
  }
}

/**
 * A tiny per-reader cache so re-entering a screen does not re-request, and a
 * throttled account keeps showing the rows it already has with their age.
 * Deliberately in-memory only: provider rows are never written to browser
 * storage.
 */
export function createAdsCache({ ttlMs = 60_000 } = {}) {
  const entries = new Map();
  return {
    key(reader, params) {
      return `${reader}?${JSON.stringify(params || {}, Object.keys(params || {}).sort())}`;
    },
    get(reader, params, now = Date.now()) {
      const hit = entries.get(this.key(reader, params));
      if (!hit) return null;
      return Object.freeze({ ...hit, cached: true, expired: now - hit.fetchedAt > ttlMs });
    },
    set(reader, params, result) {
      if (result?.status === "ready" || result?.status === "empty") entries.set(this.key(reader, params), result);
      return result;
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

/**
 * The reader façade a screen talks to. Composes cache + fetcher + the preview
 * switch, so a screen never branches on where its rows came from.
 *
 * In preview the envelope carries `origin: "preview"` and the caller is
 * required to label it. The two origins are never merged: `read` returns one or
 * the other.
 */
export function createAdsReader({ fetchImpl = globalThis.fetch, cache = createAdsCache(), preview = null } = {}) {
  const inflight = new Map();

  async function read(reader, params = {}, { signal = null, force = false } = {}) {
    if (preview?.enabled?.()) {
      return preview.read(reader, params);
    }
    if (!force) {
      const hit = cache.get(reader, params);
      if (hit && !hit.expired) return hit;
    }
    // Deduplicate identical concurrent reads: a filter change that returns to
    // the same parameters rejoins the request already in flight.
    const key = cache.key(reader, params);
    if (inflight.has(key)) return inflight.get(key);
    const promise = readAds(reader, params, { fetchImpl, signal })
      .then((result) => {
        cache.set(reader, params, result);
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return Object.freeze({
    read,
    /** Last known good rows for a reader, for the stale-during-throttle case. */
    cached(reader, params) {
      return cache.get(reader, params, Number.POSITIVE_INFINITY);
    },
    clear() {
      cache.clear();
      inflight.clear();
    },
    preview,
  });
}

/** True when a screen has nothing truthful to show yet. */
export function isUnavailable(result) {
  return !result || result.status === "not_connected" || result.status === "error";
}

export function rowsOf(result) {
  return Array.isArray(result?.data?.rows) ? result.data.rows : null;
}
