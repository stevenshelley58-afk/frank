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
//   * not a provider writer. A staged draft is a local record of intent. The
//     phases this module may set are the local ones (see LOCAL_PHASES); the
//     provider-owned phases are reserved, and only a real writer that has an
//     answer from Meta may set them through `applyProviderState`.
//   * not storage for reporting rows. Only the operator's own draft survives a
//     reload; provider data is re-read from Frank every session.
//   * not shared between preview and live. Every record carries its `origin`,
//     every read filters by it, and a rehearsal draft can never surface in a
//     live queue.
//
// Draft identity is stable and generated once. A campaign keeps its
// `campaignId` when its name changes, because tracking identity built from a
// name splits the reporting history the first time somebody renames something.
//
// Two operators, or one operator on two devices, can hold the same draft open.
// Every save therefore carries the revision it was editing from, and a save
// built on a stale revision is refused rather than allowed to overwrite the
// other person's work (see `saveGuarded`).

import { newIdentity, plannedAdFingerprint, reconcilePlanRows, trackingIdentityFor } from "./ads-identity.js";

export const DRAFT_KINDS = Object.freeze(["launch", "budget", "pause"]);

/**
 * The life of a staged change, in the order it can move.
 *
 * `editing`   — being built. Local only.
 * `staged`    — committed to Frank's queue, waiting for the owner. Local only.
 * `approved`  — the owner approved this exact plan. Local only, and the last
 *               phase this browser may reach on its own.
 * `submitted` — a real writer sent it and Meta acknowledged it. Reserved: this
 *               module never sets it, because nothing here can know.
 * `delivering`— reporting shows it running. Reserved for the reader.
 */
export const DRAFT_PHASES = Object.freeze(["editing", "staged", "approved", "submitted", "delivering"]);

export const LOCAL_PHASES = Object.freeze(["editing", "staged", "approved"]);
export const PROVIDER_PHASES = Object.freeze(["submitted", "delivering"]);

export const PHASE_LABELS = Object.freeze({
  editing: "Draft",
  staged: "Staged in Frank",
  approved: "Approved",
  submitted: "Submitted to Meta",
  delivering: "Delivering",
});

/** The stored approval flag, kept because a view may only need the boolean. */
export const DRAFT_APPROVAL = Object.freeze(["editing", "staged"]);

export const DRAFT_ORIGINS = Object.freeze(["live", "preview"]);

/** Where a queue entry lives. `rehearsal` is a preview-origin draft: it is a
 *  full rehearsal of the flow and it can never be sent. */
export const DRAFT_SCOPES = Object.freeze(["live", "rehearsal"]);

export const DRAFT_STORAGE_KEY = "frank.ads.drafts.v3";
export const LEGACY_DRAFT_STORAGE_KEYS = Object.freeze(["frank.ads.drafts.v2"]);

/** Queue states this model may produce. Deliberately a subset: a draft cannot
 *  claim that Meta accepted, reviewed or delivered anything. */
export const LOCAL_QUEUE_STATES = Object.freeze(["draft", "queued", "approved"]);

export function phaseIsLocal(phase) {
  return LOCAL_PHASES.includes(phase);
}

export function phaseIsProvider(phase) {
  return PROVIDER_PHASES.includes(phase);
}

/** `local rehearsal`, `saved draft`, `approved`, … — one label, one meaning,
 *  used by the queue, the wizard footer and the queue chips. */
export function phaseLabel(draft) {
  if (!draft) return "";
  if (draft.origin === "preview") return draft.phase === "editing" ? "Local rehearsal" : `Rehearsal · ${PHASE_LABELS[draft.phase] || draft.phase}`;
  return PHASE_LABELS[draft.phase] || draft.phase;
}

/** A stable, unique identity for a draft. Delegates to the identity module so
 *  there is exactly one allocator in the workspace. */
export function newAdsId(prefix = "draft") {
  return newIdentity(prefix);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value;
}

/** A slug that is stable for the same text and safe in a URL parameter. Kept
 *  for labels and file names; identity never uses it (see ads-identity.js). */
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

/** The stable key for one planned ad: its identity, and nothing derived from
 *  its copy. Kept as a named function because older callers ask for it. */
export function variationKey({ adId = "", creativeKey }) {
  return trackingIdentityFor(adId || creativeKey || "");
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
    creativeId: String(item?.creativeId ?? item?.id ?? ""),
    versionId: String(item?.versionId ?? item?.creativeVersionId ?? ""),
    assetKey: String(item?.assetKey ?? item?.internalId ?? item?.id ?? ""),
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
    adId: String(row?.adId ?? ""),
    id: String(row?.id ?? row?.adId ?? `${index}`),
    name: String(row?.name ?? ""),
    creativeId: String(row?.creativeId ?? ""),
    creativeKey: String(row?.creativeKey ?? row?.creativeId ?? ""),
    creativeVersionId: String(row?.creativeVersionId ?? row?.creativeKey ?? row?.creativeId ?? ""),
    headline: String(row?.headline ?? ""),
    body: String(row?.body ?? ""),
    trackingKey: String(row?.trackingKey ?? ""),
    utmContent: String(row?.utmContent ?? ""),
    destination: String(row?.destination ?? ""),
    problems: Array.isArray(row?.problems) ? row.problems.map(String) : [],
  }));
}

/** Old records stored `approval`/`state`; the phase vocabulary replaces both but
 *  an upgraded browser must not lose a staged draft. */
function phaseFromSource(source) {
  if (DRAFT_PHASES.includes(source.phase)) return source.phase;
  if (source.approval === "staged" || source.state === "queued") return "staged";
  if (source.state === "approved") return "approved";
  return "editing";
}

function stateForPhase(phase) {
  if (phase === "editing") return "draft";
  if (phase === "approved") return "approved";
  return "queued";
}

function normalizeHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => ({
      revision: Number(entry?.revision) || 0,
      at: String(entry?.at || ""),
      phase: DRAFT_PHASES.includes(entry?.phase) ? entry.phase : "editing",
      summary: String(entry?.summary || ""),
      actor: String(entry?.actor || ""),
    }))
    .filter((entry) => entry.revision > 0);
}

/** Coerce anything into one canonical draft record. A draft read back from
 *  storage goes through here, so a hand-edited or older record cannot smuggle a
 *  missing field into the queue. */
export function normalizeDraft(raw, { id = null, origin = "live", kind = "launch" } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const now = new Date().toISOString();
  const phase = phaseFromSource(source);
  const rows = normalizeRows(source.plan?.rows);
  return Object.freeze({
    id: String(source.id || id || newAdsId("draft")),
    kind: DRAFT_KINDS.includes(source.kind) ? source.kind : kind,
    origin: DRAFT_ORIGINS.includes(source.origin) ? source.origin : origin,
    phase,
    approval: phase === "editing" ? "editing" : "staged",
    state: LOCAL_QUEUE_STATES.includes(source.state) && source.state === stateForPhase(phase) ? source.state : stateForPhase(phase),
    revision: Number(source.revision) > 0 ? Number(source.revision) : 1,
    title: String(source.title || ""),
    createdAt: String(source.createdAt || now),
    updatedAt: String(source.updatedAt || now),
    savedAt: String(source.savedAt || ""),
    approvedAt: String(source.approvedAt || ""),
    approvedDigest: String(source.approvedDigest || ""),
    submittedAt: String(source.submittedAt || ""),
    providerId: String(source.providerId || ""),
    providerState: String(source.providerState || ""),
    history: Object.freeze(normalizeHistory(source.history)),
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
      rows: Object.freeze(
        // A record stored before identities existed gets its rows reconciled
        // against themselves: identities are allocated once, here, and then
        // they are part of the record.
        reconcilePlanRows([], rows),
      ),
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
              // A budget or pause row points at a real campaign, ad set or ad,
              // so its key is the record's identity, never its position.
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
    submission: source.submission && typeof source.submission === "object" ? Object.freeze({ ...source.submission }) : null,
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

/** The identity a queue row is keyed on. A launch keeps its ads' identities in
 *  the summary so two launches of the same creative are still two rows. */
export function draftScope(draft) {
  return draft?.origin === "preview" ? "rehearsal" : "live";
}

function summaryOf(draft) {
  return `${draftSummary(draft)}${draft.title ? ` · ${draft.title}` : ""}`;
}

/**
 * The store. In-memory truth with an optional persistence adapter, so a test can
 * drive it without a browser and the app can survive a reload.
 *
 * Recovery is part of the contract, not an afterthought:
 *
 *   * a record that cannot be parsed is dropped and *counted*, so the queue can
 *     say "one saved draft could not be read" instead of silently losing it;
 *   * the previous stored payload is kept as a backup before every write, so a
 *     half-written value can be restored;
 *   * a storage failure (private mode, quota) sets `storageError`, and the UI
 *     says the draft is not being saved instead of pretending it is.
 */
export function createAdsDrafts({
  storage = null,
  key = DRAFT_STORAGE_KEY,
  legacyKeys = LEGACY_DRAFT_STORAGE_KEYS,
  origin = "live",
  now = () => new Date().toISOString(),
  actor = "",
} = {}) {
  const listeners = new Set();
  // `origin` may be a function, because the workspace switches between live and
  // preview without rebuilding its modules. Resolved on every call so a draft
  // can never be written to the wrong side of that line.
  const currentOrigin = () => {
    const value = typeof origin === "function" ? origin() : origin;
    return DRAFT_ORIGINS.includes(value) ? value : "live";
  };

  let discarded = 0;
  let storageError = "";
  let restoredFromBackup = false;
  // `load` runs before `records` is assigned, so it returns its result (and
  // whether an older key was migrated) instead of assigning during its own
  // initialisation.
  const loaded = load();
  let records = loaded.records;
  if (loaded.migrated) persist();

  function parse(raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept = [];
    for (const item of parsed) {
      try {
        // The kind is checked *before* normalising, because normalising would
        // make any object look like a launch draft. A record of an unknown kind
        // is somebody else's data or a corrupt write, and it is counted as such
        // rather than promoted into the queue. A missing kind is an older launch
        // record and is accepted.
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          discarded += 1;
          continue;
        }
        const kind = item.kind === undefined ? "launch" : String(item.kind || "");
        if (!DRAFT_KINDS.includes(kind)) {
          discarded += 1;
          continue;
        }
        kept.push(normalizeDraft(item));
      } catch {
        discarded += 1;
      }
    }
    return kept;
  }

  function load() {
    if (!storage) return { records: [], migrated: false };
    for (const candidate of [key, ...(legacyKeys || [])]) {
      try {
        const raw = storage.getItem(candidate);
        if (!raw) continue;
        const parsed = parse(raw);
        // A record written by an older build is normalised, then written
        // forward, so a browser upgrade keeps a staged draft.
        if (parsed.length) return { records: parsed, migrated: candidate !== key };
        if (Array.isArray(JSON.parse(raw))) continue;
      } catch {
        discarded += 1;
        try {
          const backup = storage.getItem(`${candidate}.bak`);
          if (backup) {
            const restored = parse(backup);
            if (restored.length) {
              restoredFromBackup = true;
              return { records: restored, migrated: false };
            }
          }
        } catch {
          /* nothing else to try */
        }
      }
    }
    return { records: [], migrated: false };
  }

  function persist() {
    if (!storage) return;
    try {
      const payload = JSON.stringify(records);
      try {
        const previous = storage.getItem(key);
        if (previous) storage.setItem(`${key}.bak`, previous);
      } catch {
        /* the backup is best effort */
      }
      storage.setItem(key, payload);
      storageError = "";
    } catch (error) {
      // The in-memory copy stays authoritative; the operator is told that it is
      // no longer durable rather than being told nothing.
      storageError = error?.name === "QuotaExceededError" ? "Browser storage is full, so this draft is not being saved." : "This browser is not saving drafts.";
    }
    for (const listener of listeners) {
      try {
        listener(records.slice());
      } catch {
        /* a listener must not break a write */
      }
    }
  }

  function withRevision(existing, raw, patch = {}) {
    const at = now();
    const base = normalizeDraft({ ...existing, ...raw, ...patch }, { id: existing?.id || raw?.id || null, origin: existing?.origin || currentOrigin() });
    const revision = existing ? Number(existing.revision || 1) + 1 : 1;
    const history = existing ? [...existing.history] : [];
    const entry = { revision, at, phase: base.phase, summary: summaryOf(base), actor: String(actor || "") };
    const trimmed = [...history, entry].slice(-50);
    return Object.freeze({ ...base, revision, history: Object.freeze(trimmed), updatedAt: at, savedAt: at });
  }

  const store = {
    /** Every draft for one origin. Rehearsal drafts are never returned to a live
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
      const existing = id ? records.find((item) => item.id === String(id)) : null;
      const draft = withRevision(existing, raw, { id: existing?.id || id || raw?.id || undefined });
      const index = records.findIndex((item) => item.id === draft.id);
      if (index === -1) records = [draft, ...records];
      else records = records.map((item) => (item.id === draft.id ? draft : item));
      persist();
      return draft;
    },
    /**
     * Save only if the revision the caller was editing from is still current.
     *
     * Two operators holding the same draft open is the normal case once drafts
     * live on the server, and it is already possible across two tabs. The second
     * save is refused with the winner's record attached, so the screen can show
     * the conflict instead of silently discarding somebody's work.
     */
    saveGuarded(raw, { id = null, baseRevision = null } = {}) {
      const existing = id ? records.find((item) => item.id === String(id)) : null;
      if (existing && baseRevision !== null && Number(baseRevision) !== Number(existing.revision)) {
        return {
          ok: false,
          conflict: {
            expectedRevision: Number(baseRevision),
            actualRevision: Number(existing.revision),
            updatedAt: existing.updatedAt,
            draft: existing,
          },
          draft: existing,
        };
      }
      return { ok: true, draft: store.save(raw, { id }) };
    },
    update(id, patch, options = {}) {
      const existing = store.get(id);
      if (!existing) return null;
      if (options.baseRevision !== undefined && options.baseRevision !== null && Number(options.baseRevision) !== Number(existing.revision)) {
        return null;
      }
      return store.save({ ...existing, ...patch, id: existing.id }, { id: existing.id });
    },
    /** Move within the local phases. A provider phase is refused here by
     *  construction: only `applyProviderState` may set one. */
    phase(id, phase) {
      if (!LOCAL_PHASES.includes(phase)) return null;
      const existing = store.get(id);
      if (!existing) return null;
      return store.update(id, { phase, approval: phase === "editing" ? "editing" : "staged", state: stateForPhase(phase) });
    },
    /** Mark a draft as committed to the queue. This is the only transition that
     *  produces a queue entry, and it stays local: nothing is sent. */
    stage(id) {
      return store.phase(id, "staged");
    },
    /** Put a staged draft back into editing. */
    unstage(id) {
      return store.phase(id, "editing");
    },
    /** The owner's sign-off on one exact plan. Recording the digest is what
     *  makes the approval meaningful: if the plan changes afterwards, the digest
     *  no longer matches and the screen says so. */
    approve(id, { digest = "", by = "" } = {}) {
      const existing = store.get(id);
      if (!existing) return null;
      // A rehearsal draft can be approved as a rehearsal; it is still never
      // sent, because nothing in this browser has a write path.
      const approved = store.update(id, { phase: "approved", state: "approved", approvedAt: now(), approvedDigest: String(digest || ""), approvedBy: String(by || actor || "") });
      return approved;
    },
    /**
     * Record what a real writer heard back from the provider.
     *
     * Reserved for the execution service. Nothing in this browser calls it
     * today, and nothing may call it with a guess: a draft only reaches
     * `submitted` when something outside this browser says Meta accepted it.
     */
    applyProviderState(id, { phase, providerId = "", providerState = "", submission = null } = {}) {
      if (!PROVIDER_PHASES.includes(phase)) return null;
      const existing = store.get(id);
      if (!existing) return null;
      return store.save(
        { ...existing, phase, state: "queued", providerId: String(providerId || existing.providerId), providerState: String(providerState || existing.providerState), submittedAt: existing.submittedAt || now(), submission: submission || existing.submission },
        { id },
      );
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
      return store.list(options).filter((draft) => draft.phase !== "editing");
    },
    /** Saved work from a previous session that has not been staged. */
    unfinished(options = {}) {
      return store.list(options).filter((draft) => draft.phase === "editing");
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
    /** Diagnostics the queue shows rather than hiding. */
    get diagnostics() {
      return Object.freeze({ discarded, storageError, restoredFromBackup });
    },
    /** Put the previous payload back, for a record that cannot be read. */
    restoreBackup() {
      if (!storage) return false;
      try {
        const raw = storage.getItem(`${key}.bak`);
        if (!raw) return false;
        records = parse(raw);
        restoredFromBackup = true;
        persist();
        return true;
      } catch {
        return false;
      }
    },
  };
  return Object.freeze(store);
}

export const __internals = Object.freeze({ clean, normalizeCreatives, normalizeRows, phaseFromSource, stateForPhase, plannedAdFingerprint });
