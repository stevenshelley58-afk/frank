// The shared front-end draft model for the Ads workspace.
//
// One staged change is one object here, whichever screen produced it: a bulk
// launch built in the publishing flow, a bulk budget change, or a bulk pause
// started from the campaigns table. The publishing flow, the campaign screens
// and the publishing queue all read and write this model, so "staged" means the
// same thing on every screen and a queue entry is never a screen-local rumour.
//
// What it deliberately is not:
//
//   * not a provider writer. A staged draft is a local record of intent. No
//     submission state is ever advanced here, and `submitted` is never set by
//     this module.
//   * not storage for reporting rows. Only the operator's own draft survives a
//     reload; provider data is re-read from Frank every session.
//   * not shared between preview and live. Every record carries its `origin`,
//     every read filters by it, and a preview draft can never surface in a live
//     queue.
//
// Draft identity is stable and generated once. A campaign keeps its
// `campaignId` when its name changes, because tracking identity built from a
// name splits the reporting history the first time somebody renames something.

export const DRAFT_KINDS = Object.freeze(["launch", "budget", "pause"]);

/** `editing` — still being built. `staged` — the operator committed it to the
 *  queue and it is waiting for a gated write that does not exist yet. */
export const DRAFT_APPROVAL = Object.freeze(["editing", "staged"]);

export const DRAFT_ORIGINS = Object.freeze(["live", "preview"]);

export const DRAFT_STORAGE_KEY = "frank.ads.drafts.v2";

/** Queue states this model may produce. Deliberately a subset: a draft cannot
 *  claim that Meta accepted, reviewed or delivered anything. */
export const LOCAL_QUEUE_STATES = Object.freeze(["draft", "queued"]);

let counter = 0;

/** A stable, unique, non-guessable-enough identity for a draft or a campaign.
 *  Date-free on purpose: two drafts created in the same millisecond are still
 *  distinct, and nothing downstream can mistake the id for a timestamp. */
export function newAdsId(prefix = "draft") {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value;
}

/** A slug that is stable for the same text and safe in a URL parameter. Used to
 *  give each variation of an ad its own tracking identity. */
export function slugForTracking(value, fallback = "default") {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** The stable key for one planned ad: the creative's own identifier plus one
 *  slug per copy axis. Renaming a campaign or reordering headlines cannot
 *  change it, so a tracking join survives both. */
export function variationKey({ creativeKey, headline = "", body = "", index = 0, total = 1 }) {
  const parts = [String(creativeKey || "creative")];
  if (total > 1) parts.push(`h-${slugForTracking(headline)}`);
  if (String(body || "").trim()) parts.push(`b-${slugForTracking(body)}`);
  if (total === 0) parts.push(`v${index + 1}`);
  return parts.join("-");
}

/**
 * Merge one mapping field for one creative into whatever is already stored.
 *
 * This is a rule, not a detail: each control in the mapping grid used to close
 * over the mapping object captured when its row was built, so editing a second
 * field wrote the first field's older value back over the operator's newer
 * edit. Reading the current record at merge time is what makes destination,
 * headline and utm_content independent of each other and of the edit order.
 */
export function mergeMapping(mapping, creativeId, patch) {
  const key = String(creativeId);
  const current = (mapping && mapping[key]) || {};
  return { ...(mapping || {}), [key]: { ...current, ...(patch || {}) } };
}

function normalizeCreatives(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    id: String(item?.id ?? ""),
    internalId: String(item?.internalId ?? item?.id ?? ""),
    name: String(item?.name ?? ""),
    format: item?.format ?? "",
    ratio: item?.preview?.ratio ?? item?.ratio ?? "",
    hasImage: item?.preview?.hasImage ?? item?.hasImage ?? null,
    hasVideo: item?.preview?.hasVideo ?? item?.hasVideo ?? null,
    // The operator's per-creative decisions. Kept as a plain object so a draft
    // reopened tomorrow maps variations exactly as it did today.
    mappings: { ...(item?.mappings || item?.mapping || {}) },
  }));
}

function normalizeRows(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row, index) => ({
    id: String(row?.id ?? `${index}`),
    name: String(row?.name ?? ""),
    creativeId: String(row?.creativeId ?? ""),
    creativeKey: String(row?.creativeKey ?? row?.creativeId ?? ""),
    headline: String(row?.headline ?? ""),
    body: String(row?.body ?? ""),
    trackingKey: String(row?.trackingKey ?? ""),
    utmContent: String(row?.utmContent ?? ""),
    destination: String(row?.destination ?? ""),
    problems: Array.isArray(row?.problems) ? row.problems.map(String) : [],
  }));
}

/** Coerce anything into one canonical draft record. A draft read back from
 *  storage goes through here, so a hand-edited or older record cannot smuggle a
 *  missing field into the queue. */
export function normalizeDraft(raw, { id = null, origin = "live", kind = "launch" } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const now = new Date().toISOString();
  const state = LOCAL_QUEUE_STATES.includes(source.state) ? source.state : "draft";
  return Object.freeze({
    id: String(source.id || id || newAdsId("draft")),
    kind: DRAFT_KINDS.includes(source.kind) ? source.kind : kind,
    origin: DRAFT_ORIGINS.includes(source.origin) ? source.origin : origin,
    approval: DRAFT_APPROVAL.includes(source.approval) ? source.approval : "editing",
    state,
    title: String(source.title || ""),
    createdAt: String(source.createdAt || now),
    updatedAt: String(source.updatedAt || now),
    campaign: Object.freeze({
      campaignId: String(source.campaign?.campaignId || newAdsId("cmp")),
      name: String(source.campaign?.name || ""),
      objective: String(source.campaign?.objective || ""),
      optimisation: String(source.campaign?.optimisation || ""),
      destination: String(source.campaign?.destination || ""),
      placements: Array.isArray(source.campaign?.placements) ? source.campaign.placements.map(String) : [],
      budget: Number.isFinite(Number(source.campaign?.budget)) ? Number(source.campaign.budget) : null,
      budgetKind: String(source.campaign?.budgetKind || "daily"),
      currency: String(source.campaign?.currency || "GBP"),
      adsetCount: Number(source.campaign?.adsetCount) > 0 ? Number(source.campaign.adsetCount) : 1,
    }),
    creatives: Object.freeze(normalizeCreatives(source.creatives)),
    headlines: Object.freeze(Array.isArray(source.headlines) ? source.headlines.map((h) => String(h ?? "")) : []),
    bodies: Object.freeze(Array.isArray(source.bodies) ? source.bodies.map((b) => String(b ?? "")) : []),
    mode: source.mode === "cross_product" ? "cross_product" : "per_creative",
    tracking: Object.freeze({
      templateId: String(source.tracking?.templateId || ""),
      fields: Object.freeze(
        Array.isArray(source.tracking?.fields)
          ? source.tracking.fields.map((field) => ({
              key: String(field?.key ?? ""),
              value: String(field?.value ?? ""),
              required: Boolean(field?.required),
            }))
          : [],
      ),
    }),
    plan: Object.freeze({
      mode: source.plan?.mode === "cross_product" ? "cross_product" : "per_creative",
      total: Number.isFinite(Number(source.plan?.total)) ? Number(source.plan.total) : 0,
      equation: String(source.plan?.equation || ""),
      rows: Object.freeze(normalizeRows(source.plan?.rows)),
    }),
    validation: Object.freeze({
      ok: Boolean(source.validation?.ok),
      errors: Number(source.validation?.errors) || 0,
      warnings: Number(source.validation?.warnings) || 0,
      problems: Object.freeze(Array.isArray(source.validation?.problems) ? source.validation.problems.map((p) => ({ ...p })) : []),
    }),
    changes: Object.freeze({
      kind: source.changes?.kind === "pause" ? "pause" : source.changes?.kind === "budget" ? "budget" : null,
      percent: Number.isFinite(Number(source.changes?.percent)) ? Number(source.changes.percent) : 0,
      rows: Object.freeze(
        Array.isArray(source.changes?.rows)
          ? source.changes.rows.map((row) => ({
              key: String(row?.key ?? ""),
              name: String(row?.name ?? ""),
              level: String(row?.level ?? ""),
              state: String(row?.state ?? ""),
              before: Number.isFinite(Number(row?.before)) ? Number(row.before) : null,
              after: Number.isFinite(Number(row?.after)) ? Number(row.after) : null,
            }))
          : [],
      ),
    }),
    submission: null,
  });
}

/** A one-line, screen-independent description of what a staged draft would do. */
export function draftSummary(draft) {
  if (!draft) return "";
  if (draft.kind === "launch") {
    return `${draft.plan.total} ad${draft.plan.total === 1 ? "" : "s"} from ${draft.creatives.length} creative${draft.creatives.length === 1 ? "" : "s"}`;
  }
  const count = draft.changes.rows.length;
  if (draft.kind === "pause") return `Pause ${count} row${count === 1 ? "" : "s"}`;
  return `${draft.changes.percent > 0 ? "+" : ""}${draft.changes.percent}% budget across ${count} row${count === 1 ? "" : "s"}`;
}

/** The exact number of planned ads a draft would create. Stated once so the
 *  queue, the review step and the flow can never disagree. */
export function draftAdCount(draft) {
  if (!draft) return 0;
  if (draft.kind !== "launch") return draft.changes.rows.length;
  return draft.plan.total;
}

/**
 * The store. In-memory truth with an optional persistence adapter, so a test can
 * drive it without a browser and the app can survive a reload.
 */
export function createAdsDrafts({ storage = null, key = DRAFT_STORAGE_KEY, origin = "live", now = () => new Date().toISOString() } = {}) {
  const listeners = new Set();
  // `origin` may be a function, because the workspace switches between live and
  // preview without rebuilding its modules. Resolved on every call so a draft
  // can never be written to the wrong side of that line.
  const currentOrigin = () => {
    const value = typeof origin === "function" ? origin() : origin;
    return DRAFT_ORIGINS.includes(value) ? value : "live";
  };
  let records = load();

  function load() {
    if (!storage) return [];
    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // A record written by an older build is normalised rather than trusted.
      return parsed.map((item) => normalizeDraft(item)).filter((draft) => DRAFT_KINDS.includes(draft.kind));
    } catch {
      return [];
    }
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(records));
    } catch {
      /* storage is best effort; the in-memory copy stays authoritative */
    }
    for (const listener of listeners) {
      try {
        listener(records.slice());
      } catch {
        /* a listener must not break a write */
      }
    }
  }

  const store = {
    /** Every draft for one origin. Preview drafts are never returned to a live
     *  screen, and vice versa. */
    list({ kind = null, scope = null } = {}) {
      const wanted = scope || currentOrigin();
      return records
        .filter((draft) => draft.origin === wanted)
        .filter((draft) => (kind ? draft.kind === kind : true))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    get(id, { scope = null } = {}) {
      const found = records.find((draft) => draft.id === String(id));
      if (!found) return null;
      if (found.origin !== (scope || currentOrigin())) return null;
      return found;
    },
    /** Insert or replace. `updatedAt` is always refreshed here and never by the
     *  caller, so the queue order is the store's own fact. */
    save(raw, { id = null } = {}) {
      const draft = normalizeDraft(raw, { id, origin: currentOrigin(), kind: raw?.kind || "launch" });
      const stamped = Object.freeze({ ...draft, updatedAt: now() });
      const index = records.findIndex((item) => item.id === stamped.id);
      if (index === -1) records = [stamped, ...records];
      else records = records.map((item) => (item.id === stamped.id ? stamped : item));
      persist();
      return stamped;
    },
    update(id, patch) {
      const existing = store.get(id);
      if (!existing) return null;
      return store.save({ ...existing, ...patch, id: existing.id }, { id: existing.id });
    },
    /** Mark a draft as committed to the queue. This is the only transition that
     *  produces a queue entry, and it stays local: nothing is sent. */
    stage(id) {
      return store.update(id, { approval: "staged", state: "queued" });
    },
    /** Put a staged draft back into editing. */
    unstage(id) {
      return store.update(id, { approval: "editing", state: "draft" });
    },
    remove(id) {
      const before = records.length;
      records = records.filter((draft) => draft.id !== String(id));
      if (records.length !== before) persist();
      return before !== records.length;
    },
    clear({ scope = null } = {}) {
      const wanted = scope || currentOrigin();
      records = records.filter((draft) => draft.origin !== wanted);
      persist();
    },
    /** Drafts that are waiting for a write, newest first. */
    staged(options = {}) {
      return store.list(options).filter((draft) => draft.approval === "staged");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** A storage adapter is optional; tests and the preview harness rely on
     *  this staying honest about whether anything is persisted at all. */
    get persistent() {
      return Boolean(storage);
    },
  };
  return Object.freeze(store);
}

export const __internals = Object.freeze({ clean, normalizeCreatives, normalizeRows });
