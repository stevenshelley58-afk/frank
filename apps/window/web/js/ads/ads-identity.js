// Identity for the Ads workspace.
//
// One rule decides everything in this module: **an identity is allocated once,
// and is never derived from a name, a position, or a piece of copy.** Reporting
// history joins on identity, so anything derived from a human-readable label
// splits or merges the first time somebody renames a campaign, reorders a list,
// or reworks a headline.
//
// The workspace needs three identities, and they are not the same kind of thing:
//
//   * a **campaign** — `cmp_…`, allocated when Frank first plans it, or the
//     provider's own id when the campaign already exists in Meta. The campaign's
//     name is a label attached to that identity, never part of it, so renaming a
//     campaign cannot move its history or change `utm_campaign`.
//
//   * a **creative version** — `crvv_…`, one exact rendition of a creative: the
//     asset, its format and its crop. Versions are content-addressed (see
//     `resolveVersion`), so re-generating an asset mints a version while
//     correcting a classification, renaming, or reordering does not. An old
//     version is never mutated: if the asset changes, that is a new version and
//     the previous one remains exactly what it was when it ran.
//
//   * a **planned ad** — `ad_…`, allocated when the row is first planned and
//     carried through every later edit. Editing the headline of a planned ad
//     keeps its identity (the ad has not run yet); reordering the creative list
//     or the copy axes keeps it too, because reconciliation matches on content
//     and falls back to the creative it came from — never on the row's position.
//
// Everything here is pure: no DOM, no storage, no clock, no randomness beyond
// the allocator. That is what lets the rule tests drive it directly and what
// keeps the same input producing the same identities.

/** Identity prefixes. A kind is mapped to its prefix; an unknown kind is used
 *  as a literal prefix so a caller cannot invent a colliding name by accident. */
export const ID_KINDS = Object.freeze({
  campaign: "cmp",
  adset: "adset",
  ad: "ad",
  creative: "crv",
  version: "crvv",
  draft: "draft",
  view: "view",
});

let counter = 0;

/**
 * Allocate a new identity.
 *
 * Date-free in spirit: the timestamp only spreads allocations out, while the
 * monotonic counter and the random tail guarantee that two ids created in the
 * same millisecond are still different. 48 bits of randomness keeps the id
 * unguessable enough to be safe in a URL and long enough that a collision is
 * not a practical concern for a workspace of this size.
 */
export function newIdentity(kindOrPrefix = "ad") {
  counter += 1;
  const prefix = ID_KINDS[kindOrPrefix] || String(kindOrPrefix || "id");
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** The prefix of an identity, e.g. `ad` for `ad_12ab…`. */
export function identityKind(id) {
  const value = String(id ?? "");
  const index = value.indexOf("_");
  return index === -1 ? "" : value.slice(0, index);
}

/**
 * A display form for dense cells.
 *
 * Truncation is safe **here and only here**, because the full value is what is
 * stored, compared and sent; this is a label. The tail is kept rather than the
 * head so two ids of the same kind stay distinguishable at a glance.
 */
export function shortIdentity(id, keep = 6) {
  const value = String(id ?? "");
  const index = value.indexOf("_");
  if (index === -1) return value;
  const prefix = value.slice(0, index);
  const tail = value.slice(index + 1);
  return tail.length <= keep ? value : `${prefix}…${tail.slice(-keep)}`;
}

/** True when a value is an identity this module allocated or accepted. */
export function isIdentity(value) {
  return typeof value === "string" && /^[a-z]+_[0-9a-z]{6,}$/.test(value);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/**
 * One campaign. `providerId` is the only field that ties Frank's record to
 * Meta's; it is empty until a campaign is submitted, and filling it in later
 * never changes `campaignId`.
 */
export function createCampaign({ name = "", campaignId = null, providerId = "", objective = "", status = "", source = "planned" } = {}) {
  return Object.freeze({
    campaignId: String(campaignId || newIdentity("campaign")),
    providerId: String(providerId || ""),
    name: String(name || ""),
    objective: String(objective || ""),
    status: String(status || ""),
    source: source === "provider" ? "provider" : "planned",
  });
}

/** Renaming a campaign returns the same identity with a new label. */
export function renameCampaign(campaign, name) {
  return Object.freeze({ ...campaign, name: String(name ?? "") });
}

/**
 * The identity a campaign is joined on: Frank's own id when it has one,
 * otherwise the provider's. A name is never a join key, so a campaign renamed in
 * Ads Manager cannot silently become a second campaign in Frank's reporting.
 */
export function campaignKey(campaign) {
  if (!campaign) return "";
  if (campaign.campaignId) return String(campaign.campaignId);
  if (campaign.providerId) return String(campaign.providerId);
  if (campaign.id) return String(campaign.id);
  return "";
}

// ---------------------------------------------------------------------------
// Creative versions
// ---------------------------------------------------------------------------

/**
 * When a changed creative becomes a new version, stated once so the screen, the
 * tests and the future writer all read the same rule.
 */
export const VERSION_POLICY = Object.freeze({
  schema: "frank.ads.creative-version-policy.v1",
  summary: "A creative version is one exact rendition of an asset. It is immutable once it has been used in a plan.",
  createsNewVersion: Object.freeze([
    "A different asset is used (a re-generation, a different file, a different provider asset id).",
    "The rendered format changes (for example a static image becomes a short video).",
    "The crop changes (the ratio the asset is delivered in).",
  ]),
  keepsSameVersion: Object.freeze([
    "Renaming the creative or its version label.",
    "Correcting or adding a classification, tag, note or lesson.",
    "Reordering creatives, or reordering the copy axes they are multiplied by.",
    "Changing an ad's headline, body, destination or tracking parameters: those belong to the planned ad, not to the asset.",
    "Changing spend, status, or any performance figure.",
  ]),
  identityIs: "the asset rendition: asset key, format and ratio, compared exactly and in full",
});

function clean(value) {
  return String(value ?? "").trim();
}

function cleanList(value) {
  return (Array.isArray(value) ? value : []).map(clean);
}

/**
 * The exact, untruncated descriptor of a rendition.
 *
 * Deliberately a canonical string rather than a hash: two renditions compare
 * equal only when their descriptor is identical, so there is no collision that
 * could merge two different assets into one version. The string is returned for
 * comparison and storage, and `fingerprintDigest` gives a short form to show.
 */
export function creativeFingerprint({ assetKey = "", format = "", ratio = "" } = {}) {
  return JSON.stringify({
    asset: clean(assetKey),
    format: clean(format).toLowerCase(),
    ratio: clean(ratio),
  });
}

/** A short, stable digest of a fingerprint, for display only. */
export function fingerprintDigest(value) {
  const text = String(value ?? "");
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b + code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** The rendition descriptor of a reader's creative record or of a plan row. */
export function sourceFingerprint(source) {
  return creativeFingerprint({
    assetKey: source?.assetKey ?? source?.asset?.key ?? source?.internalId ?? source?.id ?? "",
    format: source?.format ?? source?.asset?.format ?? "",
    ratio: source?.ratio ?? source?.preview?.ratio ?? source?.asset?.ratio ?? "",
  });
}

function freezeVersion(version) {
  return Object.freeze({
    versionId: String(version.versionId),
    creativeId: String(version.creativeId || ""),
    assetKey: clean(version.assetKey),
    format: clean(version.format),
    ratio: clean(version.ratio),
    label: clean(version.label),
    fingerprint: String(version.fingerprint),
    createdAt: String(version.createdAt || ""),
  });
}

/**
 * Resolve the version a rendition belongs to, creating one when the rendition is
 * new to this creative.
 *
 * Content-addressed on purpose: the same asset at the same crop finds the same
 * version again (so reverting a re-generation does not fork history), and a
 * different asset can never reuse an existing version id.
 *
 * Returns the updated creative, the version, and whether it was created. The
 * caller stores the creative; nothing is written here.
 */
export function resolveVersion(creative, source = {}, { now = null } = {}) {
  const base = creative && typeof creative === "object" ? creative : {};
  const creativeId = String(base.creativeId || base.id || newIdentity("creative"));
  const fingerprint = sourceFingerprint(source);
  const versions = Array.isArray(base.versions) ? base.versions.map(freezeVersion) : [];
  const existing = versions.find((version) => version.fingerprint === fingerprint);
  if (existing) {
    return { creative: Object.freeze({ ...base, creativeId, versions: Object.freeze(versions) }), version: existing, created: false };
  }
  const version = freezeVersion({
    versionId: newIdentity("version"),
    creativeId,
    assetKey: source?.assetKey ?? source?.asset?.key ?? source?.internalId ?? source?.id ?? "",
    format: source?.format ?? source?.asset?.format ?? "",
    ratio: source?.ratio ?? source?.preview?.ratio ?? source?.asset?.ratio ?? "",
    label: source?.versionLabel ?? source?.label ?? "",
    fingerprint,
    createdAt: now || "",
  });
  return {
    creative: Object.freeze({ ...base, creativeId, versions: Object.freeze([...versions, version]) }),
    version,
    created: true,
  };
}

// ---------------------------------------------------------------------------
// Planned ads
// ---------------------------------------------------------------------------

/**
 * The full copy of one planned ad. Nothing is truncated: two headlines that
 * agree for their first twenty-four characters are different ads, and a
 * truncated key would fuse them into one row of reporting history.
 */
export function plannedAdFingerprint(row) {
  return JSON.stringify([
    clean(row?.creativeVersionId ?? row?.creativeKey ?? row?.creativeId),
    clean(row?.headline),
    clean(row?.body),
  ]);
}

/** The content key used to reconcile a rebuilt plan with the previous one. */
export function slotKey(row) {
  return plannedAdFingerprint(row);
}

/**
 * Carry identities from one plan into the next.
 *
 * Two passes, in this order, because they answer different questions:
 *
 *   1. the same creative with the same copy is the same planned ad, wherever it
 *      now sits in the list;
 *   2. anything left over is matched to the creative it came from, in the order
 *      both lists present that creative — so editing a headline in place, or
 *      reordering creatives, updates an ad instead of replacing it.
 *
 * Only rows that match nothing get a fresh identity, which is the honest answer:
 * they are new ads. Nothing is ever matched on the row's index in the whole
 * plan, because that changes the moment somebody reorders a column.
 */
export function reconcilePlanRows(previousRows = [], nextRows = [], { keyOf = slotKey } = {}) {
  const previous = (Array.isArray(previousRows) ? previousRows : []).filter(Boolean);
  const takenIds = new Set();

  // Grouped once, so reconciling a 960-row plan is linear rather than a scan of
  // the whole previous plan per row.
  const bySlot = new Map();
  for (const entry of previous) {
    const key = keyOf(entry);
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(entry);
  }

  const claimed = new Array(nextRows.length).fill(null);
  const slotCursor = new Map();
  for (let index = 0; index < nextRows.length; index += 1) {
    const key = keyOf(nextRows[index]);
    const queue = bySlot.get(key);
    if (!queue) continue;
    const at = slotCursor.get(key) || 0;
    const candidate = queue[at];
    if (!candidate) continue;
    const id = String(candidate.adId || "");
    if (!id || takenIds.has(id)) continue;
    slotCursor.set(key, at + 1);
    takenIds.add(id);
    claimed[index] = id;
  }

  // Pass 2: the same creative, in the order both lists present that creative's
  // remaining rows — so editing a headline in place, or reordering creatives,
  // updates an ad instead of replacing it.
  const byCreative = new Map();
  for (let index = 0; index < previous.length; index += 1) {
    const row = previous[index];
    const id = String(row?.adId || "");
    if (!id || takenIds.has(id)) continue;
    const key = clean(row?.creativeVersionId ?? row?.creativeKey ?? row?.creativeId);
    if (!byCreative.has(key)) byCreative.set(key, []);
    byCreative.get(key).push(row);
  }
  const creativeCursor = new Map();
  for (let index = 0; index < nextRows.length; index += 1) {
    if (claimed[index]) continue;
    const key = clean(nextRows[index]?.creativeVersionId ?? nextRows[index]?.creativeKey ?? nextRows[index]?.creativeId);
    const queue = byCreative.get(key) || [];
    const at = creativeCursor.get(key) || 0;
    const candidate = queue[at];
    if (!candidate) continue;
    const id = String(candidate.adId || "");
    if (!id || takenIds.has(id)) continue;
    creativeCursor.set(key, at + 1);
    takenIds.add(id);
    claimed[index] = id;
  }

  return nextRows.map((row, index) => {
    const adId = claimed[index] || String(row?.adId || "") || newIdentity("ad");
    return Object.freeze({
      ...row,
      adId,
      trackingKey: trackingIdentityFor(adId),
      utmContent: String(row?.utmContent || "") || trackingIdentityFor(adId),
    });
  });
}

/**
 * The tracking identity of one planned ad.
 *
 * It is the ad's own immutable identity and nothing else. A readable slug would
 * be nicer to read in an analytics tool right up until the first reworded
 * headline, at which point the same ad becomes a second ad in every report.
 * The readable name is shown beside this value wherever an operator needs it.
 */
export function trackingIdentityFor(adId) {
  const value = clean(adId);
  return value || newIdentity("ad");
}

/**
 * A stable digest of an approved plan.
 *
 * Sorted by identity, so the same set of ads approved in a different order is
 * the same snapshot. This is what an approval is an approval *of*: if anything
 * in the plan changes afterwards, the digest changes and the approval no longer
 * describes what would be sent.
 */
export function planSnapshot(rows = []) {
  const entries = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((row) => [
      String(row.adId || ""),
      clean(row.creativeVersionId ?? row.creativeKey ?? row.creativeId),
      clean(row.headline),
      clean(row.body),
      clean(row.destination),
      clean(row.trackingKey || row.utmContent),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries;
}

export function planDigest(rows = []) {
  return fingerprintDigest(JSON.stringify(planSnapshot(rows)));
}

export const __internals = Object.freeze({ clean, cleanList, freezeVersion });
