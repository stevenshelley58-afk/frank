// The Tracking screen: UTM naming templates, URL validation, and the chain from
// an ad back to the post it points at.
//
// Three jobs, in the order an operator needs them:
//
// 1. Read the account's naming templates and say, per value, whether it
//    resolves to something that survives a rename. A campaign id does. A
//    campaign name does not, and reporting keyed on the old name cannot be
//    joined to the new one.
// 2. Build a real preview URL from the values as they are on screen — including
//    edits that have not been saved anywhere — and run the URL checks in this
//    file against it. The checks live here rather than in the reader because
//    they have to answer for a value that has never been written down.
// 3. Pair an ad with its creative, the prompt behind that creative, the address
//    the ad points at, the UTM set it carries and the post that address lands
//    on, so a result can be traced back to what produced it.
//
// This screen reads. There is no write endpoint for tracking templates, so an
// edit is kept as a local draft and the screen says so where the save happens.
// Claiming a Meta write we cannot perform would be worse than offering none;
// the honest write path is Frank's publishing flow, offered as a handoff.

import {
  el,
  clear,
  svg,
  ICONS,
  button,
  segmented,
  block,
  definitionRow,
  statusBadge,
  statusLabel,
  notConnectedPanel,
  emptyPanel,
  errorPanel,
  skeleton,
  staleBanner,
  rowsReadNote,
} from "./ads-ui.js";
import { column, createTable, columnChooser } from "./ads-table.js";
import { field, filterBar, applyFilters } from "./ads-views.js";
import { rowsOf, READER_REQUIREMENTS } from "./ads-source.js";
import { formatWhen, rowKey, rowName } from "./ads-contracts.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// The five standard parameters, in the order every address in this workspace
// writes them. `required` here is the account's rule, used only where a template
// row does not state its own.
const STANDARD_FIELDS = Object.freeze({
  utm_source: Object.freeze({ label: "Source", required: true, note: "Which platform sent the click. Lowercase." }),
  utm_medium: Object.freeze({ label: "Medium", required: true, note: "The channel, for example paid_social." }),
  utm_campaign: Object.freeze({ label: "Campaign", required: true, note: "The campaign. Its internal id survives a rename; its name does not." }),
  utm_content: Object.freeze({ label: "Content", required: true, note: "The creative or the ad. Its internal id survives a rename." }),
  utm_term: Object.freeze({ label: "Term", required: false, note: "Optional. The targeting term or audience, when there is one." }),
});

const PARAM_ORDER = Object.freeze(Object.keys(STANDARD_FIELDS));

// Placeholders a template may use. The split between these two tables is the
// point of the screen: an internal id is written once and never changes, a name
// changes the moment somebody edits the ad.
const STABLE_TOKENS = Object.freeze({
  "campaign.internal_id": "the campaign's internal id",
  "creative.internal_id": "the creative's internal id",
  "ad.internal_id": "the ad's internal id",
});

const UNSTABLE_TOKENS = Object.freeze({
  "campaign.name": "the campaign's name",
  "ad.name": "the ad's name",
});

// Known placeholders that are neither an identifier nor a name. They resolve
// from the account rather than from an ad, so this screen can only fill one in
// when the read happens to carry the value.
const CONTEXT_TOKENS = Object.freeze({
  platform: "the platform key",
  "audience.key": "the audience key",
});

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

// Every check this file can raise. Where a check overlaps a finding the reader
// reports, it uses the reader's own word for it (encoding, duplicate_parameter,
// pii, unstable_identifier, missing_term) so the two can be read side by side.
const CHECK_KINDS = Object.freeze({
  missing_required: Object.freeze({ label: "Missing required field", severity: "error" }),
  invalid_url: Object.freeze({ label: "Not a usable address", severity: "error" }),
  credentials: Object.freeze({ label: "Credentials in the address", severity: "error" }),
  pii: Object.freeze({ label: "Personal information", severity: "error" }),
  encoding: Object.freeze({ label: "Encoding", severity: "error" }),
  duplicate_parameter: Object.freeze({ label: "Duplicate parameter", severity: "error" }),
  missing_term: Object.freeze({ label: "Optional parameter absent", severity: "info" }),
  shared_identifier: Object.freeze({ label: "Shared tracking identity", severity: "warning" }),
  unstable_identifier: Object.freeze({ label: "Unstable identifier", severity: "warning" }),
  unresolved_placeholder: Object.freeze({ label: "Placeholder has no sample", severity: "warning" }),
  unknown_placeholder: Object.freeze({ label: "Unknown placeholder", severity: "warning" }),
});

const SEVERITY_ORDER = Object.freeze(["error", "warning", "info"]);
const SEVERITY_LABELS = Object.freeze({ error: "Error", warning: "Warning", info: "Info" });
const SEVERITY_TONES = Object.freeze({ error: "bad", warning: "warn", info: "info" });

const SCOPE_LABELS = Object.freeze({ account: "Account", project: "Project" });

const JOIN_LABELS = Object.freeze({
  ads: "the ads read",
  adsets: "the ad set read",
  campaigns: "the campaign read",
  creatives: "the creatives read",
  blogs: "the blogs read",
});

// Column labels double as the column chooser's ids, because `columnChooser`
// works in labels. The map keeps one id per column.
const TEMPLATE_COLUMN_IDS = Object.freeze({ Template: "name", Scope: "scope", Fields: "fields", State: "state", Updated: "updated" });
const TEMPLATE_LABELS = Object.freeze(Object.keys(TEMPLATE_COLUMN_IDS));

const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

// ---------------------------------------------------------------------------
// Text and URL checks
// ---------------------------------------------------------------------------

function tokensIn(value) {
  // matchAll clones the pattern, so the shared /g regex is not left mid-string.
  return [...String(value ?? "").matchAll(TOKEN_PATTERN)].map((match) => match[1]);
}

function resolveValue(value, sample) {
  return String(value ?? "").replace(TOKEN_PATTERN, (whole, token) => (sample.has(token) ? String(sample.get(token)) : whole));
}

/** Decoding is best-effort: a malformed escape must not throw inside a check. */
function safeDecode(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

/**
 * Raw parameter pairs, deliberately undecoded. The encoding check has to see a
 * value as it will be written, not as a parser would tidy it up.
 */
export function rawParams(url) {
  const query = String(url ?? "").split("#")[0].split("?")[1];
  if (!query) return [];
  const pairs = [];
  for (const part of query.split("&")) {
    if (!part) continue;
    const at = part.indexOf("=");
    pairs.push({ key: safeDecode(at === -1 ? part : part.slice(0, at)), raw: at === -1 ? "" : part.slice(at + 1) });
  }
  return pairs;
}

/** The same utm_ parameter twice is the classic silent data loss. */
export function duplicateParams(url) {
  const counts = new Map();
  for (const { key } of rawParams(url)) {
    if (!key.startsWith("utm_")) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

function makeFinding(kind, fieldKey, text, severity = null) {
  const def = CHECK_KINDS[kind] || { severity: "warning" };
  return Object.freeze({ kind, field: fieldKey || "", text, severity: severity || def.severity });
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// A phone number reaches a UTM value in two shapes: one long digit run, or
// digits broken up by the separators people type. Neither can be taken back
// once it is inside an analytics tool, so both are stopped.
const PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/;
const DIGIT_RUN_PATTERN = /\d{7,}/;
const STRUCTURAL_PATTERN = /[&=?#]/;
const UNSAFE_PATTERN = /[<>{}|\\^`"[\]]/;
const NON_ASCII_PATTERN = /[^\u0020-\u007e]/;
const STRAY_PERCENT_PATTERN = /%(?![0-9A-Fa-f]{2})/;

/** Percent-encode only the characters a pattern matches, so a value that
 *  already carries a valid escape is not encoded a second time. */
function percentEncodeMatches(text, pattern) {
  return String(text).replace(new RegExp(pattern.source, "g"), (character) => encodeURIComponent(character));
}

function encodingFindings(label, fieldKey, value, { structural = true } = {}) {
  const text = String(value ?? "");
  if (!text) return [];
  const findings = [];
  if (/\s/.test(text)) {
    findings.push(
      makeFinding(
        "encoding",
        fieldKey,
        `${label} contains a raw space. Some servers truncate a parameter at the space, so the value arrives half-written. Percent-encode it as ${percentEncodeMatches(text, /\s/)}.`,
      ),
    );
  }
  if (STRAY_PERCENT_PATTERN.test(text)) {
    findings.push(makeFinding("encoding", fieldKey, `${label} contains a percent sign that is not an escape sequence. It will be read as one and the value will come out mangled.`));
  }
  // `& = ? #` are query syntax, and inside an anchor they are legal address
  // syntax: an anchor is checked for the characters that are never legal.
  if (structural && STRUCTURAL_PATTERN.test(text)) {
    findings.push(makeFinding("encoding", fieldKey, `${label} contains a query character (& = ? #) inside the value, which ends the parameter early or starts a new one. Percent-encode it as ${percentEncodeMatches(text, STRUCTURAL_PATTERN)}.`));
  }
  if (UNSAFE_PATTERN.test(text) || NON_ASCII_PATTERN.test(text)) {
    findings.push(makeFinding("encoding", fieldKey, `${label} contains characters that must be percent-encoded before they go in a URL: ${percentEncodeMatches(text, /[<>{}|\\^`"[\]]|[^\u0020-\u007e]/)}.`, "warning"));
  }
  return findings;
}

function piiFindings(label, fieldKey, value) {
  const text = String(value ?? "");
  if (!text) return [];
  const findings = [];
  if (EMAIL_PATTERN.test(text)) {
    findings.push(
      makeFinding(
        "pii",
        fieldKey,
        `${label} looks like an email address. Personal information must never be placed in a UTM parameter: it is copied into analytics tools, ad previews and shared reports, and it cannot be un-shared afterwards.`,
      ),
    );
  }
  if (PHONE_PATTERN.test(text) || DIGIT_RUN_PATTERN.test(text)) {
    findings.push(
      makeFinding("pii", fieldKey, `${label} contains a long digit run, which is the shape of a phone number, an order id or a customer id. Personal information must never be placed in a UTM parameter.`),
    );
  }
  return findings;
}

/**
 * Everything that can be checked about one concrete address. Used for a
 * destination being edited and for the address a template's preview is built
 * onto, so the same rules answer for both.
 */
export function urlFindings(url, { label = "The destination", fieldKey = "url", duplicates = true } = {}) {
  const text = String(url ?? "").trim();
  if (!text) return [makeFinding("missing_required", fieldKey, `${label} is empty, and an ad cannot point at nothing.`)];
  const findings = [];
  if (!/^https?:\/\//i.test(text)) findings.push(makeFinding("invalid_url", fieldKey, `${label} is not an http or https address, so it cannot be used as a destination.`));
  if (/^https?:\/\/[^/?#@\s]*@/.test(text)) findings.push(makeFinding("credentials", fieldKey, `${label} carries credentials. Remove them before this is published in an ad.`));
  const path = text.split("#")[0].split("?")[0];
  findings.push(...encodingFindings(label, fieldKey, path));
  for (const { key, raw } of rawParams(text)) {
    findings.push(...encodingFindings(key, fieldKey, raw));
    // An escaped address is the same address: `lead%40example.invalid` is
    // `lead@example.invalid`, and personal information does not become
    // impersonal by being percent-encoded.
    findings.push(...piiFindings(key, fieldKey, safeDecode(raw)));
  }
  const hash = text.indexOf("#");
  if (hash !== -1 && text.slice(hash + 1)) {
    findings.push(...encodingFindings(`${label} (the anchor)`, fieldKey, text.slice(hash + 1), { structural: false }));
  }
  if (duplicates) {
    for (const dupe of duplicateParams(text)) {
      findings.push(makeFinding("duplicate_parameter", fieldKey, `${label} sets ${dupe.key} ${times(dupe.count)}. Most analytics tools keep the first value and silently ignore the rest.`));
    }
  }
  return findings;
}

/** Worst first, then de-duplicated: the same sentence twice is noise. */
function tidyFindings(findings) {
  const seen = new Set();
  const unique = [];
  for (const item of findings) {
    const key = `${item.severity}|${item.kind}|${item.field}|${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

// ---------------------------------------------------------------------------
// Value resolution and the address a template writes
// ---------------------------------------------------------------------------

/** A literal the ad's saved tracking already carries, for the one context
 *  token the read can supply. A value that still holds a placeholder is not
 *  a literal. */
export function literalTracking(ad, key) {
  const value = ad?.tracking && typeof ad.tracking === "object" ? ad.tracking[key] : null;
  if (typeof value !== "string" || !value.trim()) return "";
  return tokensIn(value).length ? "" : value.trim();
}

/**
 * The sample values a template's placeholders resolve against. Every id comes
 * from the shared row identity (`rowKey`), not from a name and not from a
 * provider id that happens to sit in `id`, so `{{…internal_id}}` resolves to
 * the value the rest of the workspace joins on.
 */
export function sampleMap(context) {
  const sample = new Map();
  const campaignId = rowKey(context.campaign);
  const creativeId = rowKey(context.creative);
  const adId = rowKey(context.ad);
  if (campaignId) sample.set("campaign.internal_id", campaignId);
  if (context.campaign?.name) sample.set("campaign.name", context.campaign.name);
  if (creativeId) sample.set("creative.internal_id", creativeId);
  if (adId) sample.set("ad.internal_id", adId);
  if (context.ad?.name) sample.set("ad.name", context.ad.name);
  // The platform key is whatever this ad's saved tracking already resolved
  // to. Assuming "meta" would be inventing a value the account may not use.
  const platform = literalTracking(context.ad, "utm_source");
  if (platform) sample.set("platform", platform);
  return sample;
}

/** A stable value two ads can still share: the creative's id, when several ads
 *  in the read run that creative. Stability is not the same as uniqueness. */
export function sharedIdentifier(value, sampledCreative, adsSharing) {
  if (!(Number(adsSharing) > 1)) return false;
  const text = String(value ?? "");
  if (tokensIn(text).includes("creative.internal_id")) return true;
  return Boolean(sampledCreative) && text.trim() === String(sampledCreative);
}

/**
 * The value an editor shows: an unsaved edit wins over a saved local draft,
 * which wins over the value the read returned. The order is the whole point —
 * the preview has to be built from what is in the box.
 */
export function editorValueFrom(draft, local, saved) {
  if (draft !== undefined) return String(draft);
  if (local !== undefined) return String(local);
  return String(saved ?? "");
}

/** One destination draft per ad, kept by the shared row identity, so tracing
 *  another ad does not drop the draft this one is holding. */
export function destinationDraftEntry(drafts, ad) {
  const id = rowKey(ad);
  let entry = drafts.get(id);
  if (!entry) {
    entry = { adId: id, value: String(ad?.destination ?? ""), acknowledged: false, saved: null };
    drafts.set(id, entry);
  }
  return entry;
}

/**
 * Build the preview address.
 *
 * The destination may already carry query parameters and a `#anchor`. The
 * tracking parameters belong in the query, before the fragment: an address
 * that appends them after the `#` sends the browser to the same page, but
 * every parameter lands in the fragment, which no server and no analytics
 * tool ever receives. Existing parameters and the anchor are both kept.
 */
export function buildPreviewUrl(values, sample, base) {
  const pairs = [];
  for (const entry of values) {
    const value = resolveValue(entry.value, sample).trim();
    // An empty parameter is not written: a trailing `utm_term=` helps nobody.
    if (!value) continue;
    pairs.push({ key: entry.key, value });
  }
  const query = pairs.map(({ key, value }) => `${key}=${value}`).join("&");
  const encodedQuery = pairs.map(({ key, value }) => `${key}=${encodeURIComponent(value)}`).join("&");
  const hash = base ? base.indexOf("#") : -1;
  const head = base ? (hash === -1 ? base : base.slice(0, hash)) : "";
  const fragment = hash === -1 ? "" : base.slice(hash);
  const glue = !head || /[?&]$/.test(head) ? "" : head.includes("?") ? "&" : "?";
  return { pairs, query, url: `${head}${glue}${query}${fragment}`, encoded: `${head}${glue}${encodedQuery}${fragment}` };
}

/** Build the preview address and every finding about the values behind it. */
export function evaluate(values, sample, base, { sharedCreative = 0 } = {}) {
  const findings = [];
  const prepared = values.map((entry) => ({ ...entry, resolved: resolveValue(entry.value, sample).trim() }));

  for (const entry of prepared) {
    const label = entry.label || entry.key;
    for (const token of tokensIn(entry.value)) {
      if (STABLE_TOKENS[token] || UNSTABLE_TOKENS[token]) {
        // A stable token with no sample is still unresolved in the address:
        // saying nothing would let `{{ad.internal_id}}` reach a URL unread.
        if (!sample.has(token)) {
          findings.push(makeFinding("unresolved_placeholder", entry.key, `${label} uses {{${token}}} and this read carries no value to fill it, so the placeholder stays in the URL unresolved.`));
        }
        continue;
      }
      if (!(token in CONTEXT_TOKENS)) findings.push(makeFinding("unknown_placeholder", entry.key, `${label} uses {{${token}}}, which is not a placeholder this workspace defines.`));
      else if (!sample.has(token)) {
        findings.push(makeFinding("unresolved_placeholder", entry.key, `${label} uses {{${token}}} and this read carries no ${CONTEXT_TOKENS[token]}, so the placeholder stays in the URL unresolved.`));
      }
    }
    const kind = identifierKind(entry.value);
    if (kind.level === "unstable") findings.push(makeFinding("unstable_identifier", entry.key, `${label}: ${kind.reason}`));
    if (entry.required === true && !entry.resolved) findings.push(makeFinding("missing_required", entry.key, `${label} is required and empty, so it will not appear in the URL at all.`));
    if (entry.required === false && entry.key === "utm_term" && !entry.resolved) {
      findings.push(makeFinding("missing_term", entry.key, `${label} is optional and empty. Without it, placement-level reporting falls back to the provider only.`));
    }
    // A stable id is stable, not unique: a creative several ads run writes one
    // value for all of them, and that is a reporting collision, not an id.
    if (sharedIdentifier(entry.value, sample.get("creative.internal_id"), sharedCreative)) {
      findings.push(
        makeFinding(
          "shared_identifier",
          entry.key,
          `${label} resolves to the creative's id, and ${sharedCreative} ads in this read run that creative, so they all write the same tracking value. Use {{ad.internal_id}} where the reporting has to tell the ads apart.`,
        ),
      );
    }
    // A value that still holds a placeholder is not a URL value yet; the
    // placeholder finding covers it, and flagging its braces as unencoded
    // would be noise about syntax that never reaches a server.
    if (!entry.resolved || tokensIn(entry.resolved).length) continue;
    findings.push(...encodingFindings(label, entry.key, entry.resolved));
    // The percent-encoded form of an address is the same address.
    findings.push(...piiFindings(label, entry.key, safeDecode(entry.resolved)));
  }

  const preview = buildPreviewUrl(prepared, sample, base);
  // The destination is scanned as the address it is; the built string's
  // parameters are the values already checked above, and the duplicate scan
  // below reads base and template together.
  if (base) findings.push(...urlFindings(base, { label: "The sample ad's destination", fieldKey: "url", duplicates: false }));
  for (const dupe of duplicateParams(preview.url)) {
    const fromBase = rawParams(base || "").some((pair) => pair.key === dupe.key);
    findings.push(
      makeFinding(
        "duplicate_parameter",
        dupe.key,
        `${dupe.key} appears ${times(dupe.count)} in the built URL${fromBase ? ", because the sample ad's destination already sets it" : ""}. Most analytics tools keep the first value and silently ignore the rest.`,
      ),
    );
  }

  return { values: prepared, preview, findings: tidyFindings(findings) };
}

/**
 * What a value resolves to.
 *
 * A literal counts as stable — a fixed value cannot drift — but it cannot
 * separate two ads either, so it is labelled apart from an internal id rather
 * than quietly merged with one.
 */
function identifierKind(value) {
  const text = String(value ?? "").trim();
  if (!text) return Object.freeze({ level: "empty", label: "No value", tone: "mute", short: "", reason: "" });
  const tokens = tokensIn(text);
  const unstable = tokens.filter((token) => UNSTABLE_TOKENS[token]);
  if (unstable.length) {
    return Object.freeze({
      level: "unstable",
      label: "Unstable name",
      tone: "warn",
      short: "Renaming breaks reporting.",
      reason: `Uses ${unstable.map((token) => `{{${token}}}`).join(", ")}. ${unstable
        .map((token) => UNSTABLE_TOKENS[token])
        .join(" and ")} changes when someone edits the ad or the campaign, and reporting keyed on the old value cannot be joined to the new one.`,
    });
  }
  const stable = tokens.filter((token) => STABLE_TOKENS[token]);
  if (stable.length) {
    return Object.freeze({
      level: "stable",
      label: "Stable internal id",
      tone: "ok",
      short: "Survives a rename.",
      reason: `Uses ${stable.map((token) => `{{${token}}}`).join(", ")} — ${stable
        .map((token) => STABLE_TOKENS[token])
        .join(" and ")}. Renaming the ad leaves this value untouched.`,
    });
  }
  // A context value is not an identifier and not a name: it resolves from the
  // account, so it is identical on every ad. Labelling it "unknown" would be
  // wrong about a placeholder the workspace defines. The length guard matters:
  // `[].every()` is true, and a value with no placeholder at all is a literal.
  if (tokens.length && tokens.every((token) => CONTEXT_TOKENS[token])) {
    return Object.freeze({
      level: "context",
      label: "Context value",
      tone: "mute",
      short: "Same on every ad.",
      reason: `Resolves from the account (${tokens.map((token) => CONTEXT_TOKENS[token]).join(" and ")}), not from an ad, so it is the same on every ad and cannot separate two of them in reporting.`,
    });
  }
  if (tokens.length) {
    return Object.freeze({
      level: "unknown",
      label: "Unknown placeholder",
      tone: "warn",
      short: "Nothing resolves this.",
      reason: `Uses ${tokens.map((token) => `{{${token}}}`).join(", ")}, which this workspace does not define. Nothing fills it in, so it reaches the URL exactly as written.`,
    });
  }
  return Object.freeze({
    level: "literal",
    label: "Literal value",
    tone: "ok",
    short: "Fixed for every ad.",
    reason: "A fixed value. It cannot drift, but it is identical on every ad, so it cannot separate them in reporting.",
  });
}

/** "twice", not "2 times": a finding is read by a person. */
function times(count) {
  const n = Number(count) || 0;
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n} times`;
}

function changeName(change) {
  const key = String(change || "");
  if (!key) return "A tracking value";
  if (key === "destination") return "Destination";
  if (STANDARD_FIELDS[key]) return STANDARD_FIELDS[key].label;
  return key;
}

function actorName(actor) {
  const key = String(actor || "").toLowerCase();
  if (key === "owner") return "Owner";
  if (key === "sync") return "Sync";
  if (key === "system") return "System";
  return key || "Actor not reported";
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function createTrackingScreen(ctx, host) {
  // The block stack is the screen. The shell's content slot has no layout of
  // its own, and `.ads-block` is the module's column-with-gaps container.
  const root = el("div", "ads-block");
  host.append(root);

  let disposed = false;
  const controller = new AbortController();
  // Focus requests are closures so they run once the new nodes are in the
  // document; focusing a detached node is a no-op.
  let pendingFocus = null;
  // A re-render has to close the popovers it created, because `popover()`
  // keeps document-level listeners while one is open.
  let popoverDisposers = [];
  let loadToken = 0;
  let inFlight = [];

  const store = ctx.store || null;
  const storedSort = store?.state?.sort;
  const storedColumns = store?.state?.columns;

  const state = {
    status: "loading",
    readStatus: "",
    detail: "",
    fetchedAt: null,
    templates: null,
    validation: [],
    history: [],
    joins: { ads: null, adsets: null, campaigns: null, creatives: null, blogs: null },
    scope: "all",
    openId: "",
    drafts: new Map(),
    // Values saved as a local draft, keyed by template id. In memory only: a
    // draft is not a write, and dressing it up as persistence would blur that.
    local: new Map(),
    filters: Array.isArray(store?.state?.filters) ? store.state.filters : [],
    search: "",
    focus: null,
    subject: { kind: "ad", id: "" },
    // One destination draft per ad, keyed by the shared row identity, so a
    // draft survives tracing another ad and coming back to this one.
    destination: new Map(),
    columns: Array.isArray(storedColumns) ? storedColumns.filter((label) => TEMPLATE_LABELS.includes(label)) : TEMPLATE_LABELS.slice(),
    table: {
      sort: storedSort && typeof storedSort.id === "string" ? { id: storedSort.id, dir: storedSort.dir === "desc" ? "desc" : "asc" } : { id: "name", dir: "asc" },
      page: 0,
      pageSize: Number(store?.state?.pageSize) || 50,
    },
  };
  if (!state.columns.length) state.columns = TEMPLATE_LABELS.slice();

  // The live refs of the open editor, so a keystroke can refresh the derived
  // half of the block without rebuilding the inputs and taking the caret.
  const editorRefs = new Map();

  // ---------------------------------------------------------------- pieces --

  const space = () => el("span", "", " ");

  /**
   * Inline monospace for ids and values. `ads-prompt` is the block form and
   * there is no inline class; this module may only add classes to `ads.css` in
   * a marked section, and one font stack is cheaper than a section for it.
   */
  function mono(value, { title = "" } = {}) {
    const text = value === null || value === undefined || value === "" ? "—" : String(value);
    const node = el("span", "", text);
    node.style.fontFamily = MONO_STACK;
    if (title) node.title = title;
    return node;
  }

  /** 10px uppercase micro-label: the workspace's caption for a group of facts. */
  function microLabel(text) {
    return el("p", "ads-context-label", text);
  }

  /**
   * A badge with an explicit tone. `statusBadge` maps delivery states to tones,
   * and a severity or a template state is a different vocabulary; borrowing a
   * delivery state for its colour would put a lie in `data-state`.
   */
  function toneBadge(word, tone, { title = "" } = {}) {
    const badge = el("span", `ads-badge ads-badge-${tone}`, word);
    if (title) badge.title = title;
    return badge;
  }

  function severityBadge(severity) {
    const key = String(severity || "").toLowerCase();
    const badge = toneBadge(key ? SEVERITY_LABELS[key] || statusLabel(key) : "Unclassified", SEVERITY_TONES[key] || "mute");
    badge.dataset.severity = key || "unclassified";
    return badge;
  }

  function stateBadge(value) {
    const key = String(value || "").toLowerCase();
    return key ? statusBadge(key) : toneBadge("State not reported", "mute");
  }

  /**
   * A rich definition row. `definitionRow` takes text, and most rows here carry
   * a monospace value, a badge or a table, so the same grid is built from
   * nodes. A `div` inside `dl` is valid HTML: it groups one term/description
   * pair, which is exactly what the class draws.
   */
  function defRow(term, ...values) {
    const row = el("div", "ads-def-row");
    const dt = el("dt");
    if (typeof term === "string") dt.append(el("span", "", term));
    else if (term) dt.append(term);
    const dd = el("dd");
    for (const value of values.flat()) if (value) dd.append(value);
    row.append(dt, dd);
    return row;
  }

  function defList(rows) {
    const list = el("dl");
    for (const row of rows) if (row) list.append(row);
    return list;
  }

  function actionRow(nodes) {
    const row = el("div", "ads-panel-note-actions");
    for (const node of nodes.flat()) if (node) row.append(node);
    return row;
  }

  function note(text) {
    return el("p", "ads-block-note", text);
  }

  function concat(...nodes) {
    const wrap = el("span");
    for (const node of nodes.flat()) if (node) wrap.append(node);
    return wrap;
  }

  function claimFocus(token, fn) {
    if (state.focus !== token) return false;
    state.focus = null;
    pendingFocus = fn;
    return true;
  }

  function closePopovers() {
    for (const disposePopover of popoverDisposers) disposePopover();
    popoverDisposers = [];
  }

  /**
   * Own the popovers a shared primitive built. `filterBar` and `columnChooser`
   * create their own, and `popover()` keeps document-level listeners while one
   * is open, so a re-render has to close them or every render leaks a pair.
   */
  function registerPopovers(...nodes) {
    for (const node of nodes.flat()) {
      if (!node) continue;
      if (node.classList?.contains("ads-pop-wrap")) popoverDisposers.push(() => node.dispose?.());
      for (const wrap of node.querySelectorAll?.(".ads-pop-wrap") || []) popoverDisposers.push(() => wrap.dispose?.());
    }
  }

  // ----------------------------------------------------------- reader rows --

  function rows(name) {
    const entry = state.joins[name];
    return entry && Array.isArray(entry.rows) ? entry.rows : [];
  }

  /** Why a hop in the trace cannot be joined, in the words of the read. */
  function joinGap(names) {
    const missing = names.filter((name) => state.joins[name] && !Array.isArray(state.joins[name].rows));
    if (!missing.length) return "";
    const labels = missing.map((name) => JOIN_LABELS[name] || name);
    return `${labels.join(" and ")} returned no rows in this read, so that hop cannot be joined.`;
  }

  function joinPending(names) {
    return names.some((name) => !state.joins[name]);
  }

  // ------------------------------------------------------ template values --

  function readValue(template, key) {
    const row = (Array.isArray(template.fields) ? template.fields : []).find((candidate) => String(candidate.key) === String(key));
    return row ? String(row.value ?? "") : "";
  }

  /** What a value is now: the unsaved edit first, then the saved local draft,
   *  then the read. Typing beats a draft that was saved before the keystroke. */
  function currentValue(template, key) {
    const draft = state.drafts.get(template.id);
    const local = state.local.get(template.id);
    return editorValueFrom(
      draft && key in draft ? draft[key] : undefined,
      local && key in local ? local[key] : undefined,
      readValue(template, key),
    );
  }

  function baselineValue(template, key) {
    const local = state.local.get(template.id);
    if (local && key in local) return String(local[key]);
    return readValue(template, key);
  }

  function dirtyKeys(template) {
    const draft = state.drafts.get(template.id) || {};
    return Object.keys(draft).filter((key) => draft[key] !== baselineValue(template, key));
  }

  /** The five standard fields in canonical order, then anything extra the account added. */
  function editorValues(template) {
    const fields = Array.isArray(template.fields) ? template.fields : [];
    const byKey = new Map(fields.map((row) => [String(row.key), row]));
    const keys = [...PARAM_ORDER, ...fields.map((row) => String(row.key)).filter((key) => !PARAM_ORDER.includes(key))];
    return keys.map((key) => {
      const row = byKey.get(key) || null;
      const standard = STANDARD_FIELDS[key] || null;
      return {
        key,
        label: standard ? standard.label : key,
        standard: Boolean(standard),
        value: currentValue(template, key),
        // A missing `required` is not a quiet "no": it stays unknown unless the
        // standard rule for that parameter covers it.
        required: typeof row?.required === "boolean" ? row.required : standard ? standard.required : null,
        note: row?.note || standard?.note || "",
        fromTemplate: Boolean(row),
      };
    });
  }

  function unstableFields(template) {
    return editorValues(template).filter((entry) => identifierKind(entry.value).level === "unstable");
  }

  // -------------------------------------------------------------- subjects --

  function adsetForAd(ad) {
    if (!ad) return null;
    return rows("adsets").find((row) => String(row.id) === String(ad.parentId)) || null;
  }

  function campaignForAd(ad) {
    const adset = adsetForAd(ad);
    if (!adset) return null;
    return rows("campaigns").find((row) => String(row.id) === String(adset.parentId)) || null;
  }

  /**
   * The ad or creative the trace and the destination editor are about. `ad` is
   * filled in creative mode too, because a destination belongs to the ad and
   * the trace has to say which ad it borrowed the address from.
   */
  function resolveSubject() {
    const ads = rows("ads");
    const creatives = rows("creatives");
    if (state.subject.kind === "creative") {
      const creative = creatives.find((row) => String(rowKey(row)) === String(state.subject.id)) || creatives[0] || null;
      const carrying = creative ? ads.filter((row) => String(row.creativeId) === String(creative.id)) : [];
      return { kind: "creative", creative, ad: carrying[0] || null, carries: carrying };
    }
    const ad = ads.find((row) => String(rowKey(row)) === String(state.subject.id)) || ads[0] || null;
    const creative = ad ? creatives.find((row) => String(row.id) === String(ad.creativeId)) || null : null;
    return { kind: "ad", ad, creative, carries: [] };
  }

  function sampleContext() {
    const subject = resolveSubject();
    return { ad: subject.ad, creative: subject.creative, campaign: campaignForAd(subject.ad), adset: adsetForAd(subject.ad) };
  }

  function blogFor(creative) {
    if (joinPending(["blogs"])) return { blog: null, basis: "", reason: "The blogs read has not answered yet." };
    if (!state.joins.blogs.rows) return { blog: null, basis: "", reason: "The blogs read returned no rows, so the post cannot be joined." };
    if (!creative) return { blog: null, basis: "", reason: "There is no creative row for this ad, so there is nothing to join a post to." };
    const blogs = rows("blogs");
    const linked = blogs.find((row) => Array.isArray(row.creativeIds) && row.creativeIds.map(String).includes(String(creative.id)));
    if (linked) return { blog: linked, basis: "linked by the post's creativeIds", reason: "" };
    const byTopic = blogs.find((row) => row.topic && creative.blog_topic && String(row.topic) === String(creative.blog_topic));
    if (byTopic) return { blog: byTopic, basis: "matched on the blog topic, which is a weaker join than an id", reason: "" };
    return { blog: null, basis: "", reason: "No post in this read links to this creative by id or by topic." };
  }

  // --------------------------------------------------------------- checks --

  /**
   * Re-run the reader's claim about one of its own rows against the URL that
   * row shows. A finding this screen cannot reproduce is worth saying out loud:
   * it means the claim and the address are not describing the same thing, and
   * the operator should look at the ad rather than trust the row.
   */
  function verifyFinding(entry) {
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) return { tone: "mute", badge: "No URL to check", text: "This row carries no URL, so there is nothing here to check the claim against." };
    const kind = String(entry.kind || "");
    if (kind === "duplicate_parameter") {
      const dupes = duplicateParams(url);
      return dupes.length
        ? { tone: "ok", badge: "Reproduced", text: `${dupes.map((dupe) => `${dupe.key} appears ${times(dupe.count)}`).join(", ")} in the URL shown.` }
        : { tone: "warn", badge: "Not reproduced", text: "The URL shown sets each utm_ parameter once, so the duplicate is somewhere other than the address in this row." };
    }
    if (kind === "encoding") {
      const hits = rawParams(url).flatMap((pair) => encodingFindings(pair.key, pair.key, pair.raw));
      const pathSpace = /\s/.test(url.split("#")[0].split("?")[0]);
      if (hits.length || pathSpace) return { tone: "ok", badge: "Reproduced", text: hits.length ? hits[0].text : "The part of the address before the query carries a raw space." };
      return { tone: "warn", badge: "Not reproduced", text: "Nothing in the URL shown needs percent-encoding." };
    }
    if (kind === "pii") {
      const hits = rawParams(url).flatMap((pair) => piiFindings(pair.key, pair.key, safeDecode(pair.raw)));
      if (hits.length) return { tone: "ok", badge: "Reproduced", text: hits[0].text };
      return { tone: "warn", badge: "Not reproduced", text: "Nothing in the URL shown looks like an email address or a phone number." };
    }
    if (kind === "unstable_identifier") {
      // A name looks like a word with a separator in it; an internal id is one
      // unbroken token. That is a shape, not a proof, so it is reported as
      // consistency rather than as a reproduction.
      const named = rawParams(url).filter((pair) => pair.key.startsWith("utm_") && (/(%20|\+|\s)/.test(pair.raw) || !/^[A-Za-z0-9_.:-]+$/.test(pair.raw)));
      if (named.length) return { tone: "ok", badge: "Consistent", text: `${named.map((pair) => pair.key).join(", ")} carries a name-shaped value rather than an unbroken id.` };
      return { tone: "warn", badge: "Not reproduced", text: "Every utm_ value in the URL shown is shaped like an id or a fixed key, not like a name." };
    }
    if (kind === "missing_term") {
      const present = rawParams(url).some((pair) => pair.key === "utm_term");
      if (!present) return { tone: "ok", badge: "Reproduced", text: "The URL shown sets no utm_term, which is what this row reports." };
      return { tone: "warn", badge: "Not reproduced", text: "The URL shown does set utm_term." };
    }
    return { tone: "mute", badge: "Not checked here", text: `This screen has no client check for a "${kind || "unknown"}" finding, so the row stands as the reader reported it.` };
  }

  // --------------------------------------------------------------- reading --

  function start({ force = false } = {}) {
    // A retry can overtake a read still in flight; the token makes the slower
    // answer harmless instead of letting it overwrite newer state.
    const token = ++loadToken;
    inFlight = [loadTracking(token, force), loadJoins(token)];
    return inFlight;
  }

  async function loadTracking(token, force) {
    const result = await ctx.reader.read("tracking", ctx.params, { signal: controller.signal, force });
    if (disposed || token !== loadToken) return;
    state.fetchedAt = result.fetchedAt || null;
    // Which read actually failed, when the record on screen came from an earlier
    // one the reader kept.
    state.readStatus = result.failedStatus || result.status;
    state.detail = result.detail || "";
    const meta = result.data?.meta ?? null;
    const renderable = ["ready", "stale", "throttled", "syncing"].includes(result.status) && Boolean(meta) && Array.isArray(meta.templates);
    if (!renderable) {
      state.status = result.status === "not_connected" ? "not_connected" : "error";
      if (state.status === "error" && !state.detail) {
        state.detail = meta ? "The tracking reader answered without a templates array, so there are no templates to draw." : "The tracking reader returned no tracking record.";
      }
      render();
      return;
    }
    state.status = result.status;
    state.templates = meta.templates;
    state.validation = Array.isArray(meta.validation) ? meta.validation : [];
    state.history = Array.isArray(meta.history) ? meta.history : [];
    const stillOpen = meta.templates.find((template) => String(template.id) === String(state.openId));
    if (!stillOpen) state.openId = meta.templates.find((template) => template.active === true)?.id || meta.templates[0]?.id || "";
    render();
  }

  async function readRows(reader, params) {
    const result = await ctx.reader.read(reader, params, { signal: controller.signal });
    return { status: result.status, detail: result.detail || "", rows: rowsOf(result) };
  }

  async function loadJoins(token) {
    // The campaign hop needs the ad set rows: an ad carries its ad set's id,
    // not its campaign's, and guessing the campaign from an id string would be
    // inventing a join rather than reading one.
    const [ads, adsets, campaigns, creatives, blogs] = await Promise.all([
      readRows("entities", { ...ctx.params, level: "ad" }),
      readRows("entities", { ...ctx.params, level: "adset" }),
      readRows("entities", { ...ctx.params, level: "campaign" }),
      readRows("creatives", ctx.params),
      readRows("blogs", ctx.params),
    ]);
    if (disposed || token !== loadToken) return;
    state.joins = { ads, adsets, campaigns, creatives, blogs };
    render();
  }

  function reload() {
    state.status = "loading";
    state.detail = "";
    render();
    start({ force: true });
  }

  // -------------------------------------------------------------- painting --

  function render() {
    if (disposed) return;
    closePopovers();
    clear(root);
    editorRefs.clear();
    paint();
    const focus = pendingFocus;
    pendingFocus = null;
    focus?.();
  }

  function paint() {
    root.append(rulesBlock());

    if (state.status === "loading") {
      const section = block("Tracking", { note: "Reading the UTM templates, the destination history and the joins behind them." });
      section.append(skeleton(6, 4));
      root.append(section);
      return;
    }
    if (state.status === "not_connected") {
      root.append(
        notConnectedPanel({
          requirement: READER_REQUIREMENTS.tracking,
          action: button("Check again", { onClick: reload, title: "Read the tracking endpoint again." }),
        }),
      );
      return;
    }
    if (state.status === "error") {
      root.append(errorPanel({ title: "The tracking read failed", detail: state.detail, onRetry: reload }));
      return;
    }
    if (state.status !== "ready") {
      root.append(
        staleBanner({
          // The read that actually failed: a kept record is `stale`, but the
          // reason it is stale is the throttle or error behind it.
          status: state.readStatus || state.status,
          fetchedAt: state.fetchedAt,
          detail: state.detail,
          onRefresh: () => {
            void ctx.refresh();
            void reload();
          },
        }),
      );
    }

    root.append(templatesBlock());
    const editor = editorBlock();
    if (editor) root.append(editor);
    root.append(validationBlock());
    root.append(traceBlock());
    root.append(destinationBlock());
    root.append(historyBlock());
    // When the rows were observed, on every read, so the age is stated in the
    // good state as well as under the banner.
    root.append(rowsReadNote(state.fetchedAt, { suffix: "Nothing on this screen calls the provider." }));
  }

  /**
   * The rules, stated as rules. They are here rather than only inside the
   * checks because a UTM value outlives the campaign it was written for: it is
   * copied into analytics tools, shared reports and exported spreadsheets.
   */
  function rulesBlock() {
    const section = block("Rules for tracking values", {
      note: "The checks on this screen enforce these three. They are written out because two of them are expensive to learn from a report.",
    });
    section.append(
      defList([
        definitionRow(
          "No personal information in UTMs",
          "An email address, a name, a phone number or a customer id must never be placed in a utm_ parameter. It ends up in analytics tools, in shared reports and in the address itself, and it cannot be un-shared afterwards.",
        ),
        definitionRow(
          "Stable internal ids, not names",
          "{{campaign.internal_id}}, {{creative.internal_id}} and {{ad.internal_id}} are stable: renaming an ad or a campaign does not change them, so the reporting join survives the rename. {{campaign.name}} and {{ad.name}} are not stable, and they are flagged wherever they appear.",
        ),
        definitionRow(
          "A local draft is not a write",
          "This screen reads. Frank has no write endpoint for UTM templates yet, so saving a value here keeps a draft in this screen only. Nothing reaches Meta until a change is queued through Publish ads.",
        ),
      ]),
    );
    return section;
  }

  // ----------------------------------------------------------- templates ---

  function filteredTemplates() {
    if (!state.templates) return [];
    if (state.scope === "all") return state.templates;
    return state.templates.filter((template) => String(template.scope) === state.scope);
  }

  /** The catalog is rebuilt per render so its cells can read the live values. */
  function templateColumns() {
    return {
      Template: column({
        id: "name",
        label: "Template",
        render(template) {
          const cell = el("div", "ads-cell-name");
          cell.append(el("strong", "", rowName(template)), el("span", "ads-cell-sub", SCOPE_LABELS[template.scope] || "Scope not reported"));
          return cell;
        },
        sortValue: (template) => String(rowName(template)).toLowerCase(),
      }),
      Scope: column({ id: "scope", label: "Scope", render: (template) => SCOPE_LABELS[template.scope] || "—", sortValue: (template) => String(template.scope || "") }),
      Fields: column({
        id: "fields",
        label: "Fields",
        render(template) {
          const fields = Array.isArray(template.fields) ? template.fields : null;
          const wrap = el("div", "ads-cell-flags");
          wrap.append(el("span", "", fields ? `${fields.length} field${fields.length === 1 ? "" : "s"}` : "—"));
          const unstable = unstableFields(template);
          if (unstable.length) {
            const flag = el("span", "ads-badge ads-badge-warn", `${unstable.length} unstable`);
            flag.title = `Uses a name rather than an internal id: ${unstable.map((entry) => entry.key).join(", ")}.`;
            wrap.append(flag);
          }
          return wrap;
        },
        sortValue: (template) => (Array.isArray(template.fields) ? template.fields.length : null),
      }),
      State: column({
        id: "state",
        label: "State",
        render(template) {
          const wrap = el("div", "ads-cell-flags");
          const label = template.active === true ? "Active" : template.active === false ? "Inactive" : "—";
          wrap.append(el("span", `ads-badge ads-badge-${template.active === true ? "ok" : "mute"}`, label));
          return wrap;
        },
        sortValue: (template) => (template.active === true ? 0 : 1),
      }),
      Updated: column({
        id: "updated",
        label: "Updated",
        title: "When the template last changed on the account.",
        render: (template) => formatWhen(template.updatedAt),
        sortValue: (template) => Date.parse(String(template.updatedAt || "")) || null,
      }),
    };
  }

  function chosenColumns(catalog) {
    // The name is the referent of every other column, so it stays and stays
    // first; the chooser does not offer it and cannot remove it.
    const rest = state.columns.filter((label) => label !== "Template" && label in catalog);
    return ["Template", ...rest].map((label) => catalog[label]).filter(Boolean);
  }

  function templatesBlock() {
    const templates = state.templates || [];
    const catalog = templateColumns();

    const scopeControl = segmented(
      [
        { id: "all", label: "All", count: templates.length },
        { id: "account", label: "Account", count: templates.filter((template) => template.scope === "account").length },
        { id: "project", label: "Project", count: templates.filter((template) => template.scope === "project").length },
      ],
      state.scope,
      (id) => {
        state.scope = id;
        state.focus = "templates";
        render();
      },
      { label: "Filter templates by scope", size: "sm" },
    );
    const chooser = columnChooser({
      all: TEMPLATE_LABELS,
      active: state.columns,
      onChange: (next) => {
        state.columns = next.filter((label) => label in catalog);
        if (!state.columns.length) state.columns = ["Template"];
        store?.update?.({ columns: state.columns });
        state.focus = "templates";
        render();
      },
    });
    registerPopovers(chooser);
    // Both controls belong in the block head: they act on the whole list, and
    // as block children they would stack above the table instead of reading as
    // part of its heading.
    const section = block("Naming templates", {
      note: "The UTM sets this account writes into ad addresses. Open a template to read its values, check its identifiers and edit them as a local draft.",
      actions: [scopeControl, chooser],
    });
    const titleNode = section.querySelector(".ads-block-title");
    const titleId = "ads-tracking-templates-title";
    if (titleNode) titleNode.id = titleId;

    if (!templates.length) {
      section.append(
        emptyPanel({
          title: "No UTM templates",
          detail: "The tracking reader answered with no naming templates for this account. Nothing is shown in their place.",
        }),
      );
      return section;
    }

    const table = createTable({
      columns: chosenColumns(catalog),
      rows: filteredTemplates(),
      getKey: (template) => String(template.id || ""),
      state: state.table,
      onSort: (sort) => store?.update?.({ sort }),
      onRowActivate: (template) => openTemplate(template.id),
      renderRowMeta: (template) =>
        String(template.id) === String(state.openId)
          ? el("span", "ads-block-note", "Editing")
          : button("Edit", { variant: "quiet", ariaLabel: `Edit template ${rowName(template)}`, onClick: () => openTemplate(template.id) }),
      emptyNode: el("p", "ads-empty-line", `No ${String(SCOPE_LABELS[state.scope] || state.scope).toLowerCase()} templates in this read.`),
      labelledBy: titleId,
    });
    section.append(table.node);
    claimFocus("templates", () => section.querySelector(".ads-segment.is-on")?.focus());
    return section;
  }

  function openTemplate(id) {
    state.openId = String(id || "");
    state.focus = "editor";
    render();
  }

  // -------------------------------------------------------------- editor ---

  function editorBlock() {
    const template = (state.templates || []).find((entry) => String(entry.id) === String(state.openId)) || null;
    if (!template) return null;

    const values = editorValues(template);
    const context = sampleContext();
    const sample = sampleMap(context);
    const base = typeof context.ad?.destination === "string" ? context.ad.destination.trim() : "";
    // How many ads in this read run the creative the sample resolves from. One
    // ad cannot collide with itself; two can.
    const sharedCreative = context.creative ? rows("ads").filter((row) => String(row.creativeId) === String(context.creative.id)).length : 0;
    const local = state.local.get(template.id);
    const hasLocal = Boolean(local && Object.keys(local).length);

    const dirtyHost = el("span", "ads-cell-flags");
    const saveBtn = button("Save draft", {
      variant: "ink",
      onClick: () => saveDraft(template),
      title: "Keep these values as a local draft on this screen. It does not write to Meta.",
    });
    const discardBtn = button("Discard", {
      onClick: () => discardEdits(template),
      title: "Put back the values this template was read with, or the saved local draft.",
    });
    const revertBtn = hasLocal
      ? button("Revert local draft", {
          variant: "quiet",
          onClick: () => revertLocal(template),
          title: "Drop the local draft and show the values the reader returned. The account was never changed either way.",
        })
      : null;

    const section = block(`Edit template — ${rowName(template)}`, {
      actions: [dirtyHost, revertBtn, discardBtn, saveBtn].filter(Boolean),
      note: "Saving records the change as a local draft in this screen: Frank has no write endpoint for UTM templates, so the provider value on Meta is unchanged and nothing is sent anywhere. Use Publish ads to queue a change that does write.",
    });

    const meta = el("p", "ads-block-note");
    meta.append(
      el("span", "", `${SCOPE_LABELS[template.scope] || "Scope not reported"} template`),
      space(),
      el("span", "", "·"),
      space(),
      el("span", "", template.active === true ? "Active" : template.active === false ? "Inactive" : "Active state not reported"),
      space(),
      el("span", "", "·"),
      space(),
      el("span", "", template.updatedAt ? `last changed ${formatWhen(template.updatedAt)}` : "change time not reported"),
      space(),
      el("span", "", "·"),
      space(),
      mono(template.id, { title: "Template id, as the reader returned it." }),
    );
    if (template.updatedAt) meta.title = `Last changed ${template.updatedAt}`;
    section.append(meta);

    // ---- the five standard fields -----------------------------------------
    section.append(microLabel("Standard fields"));
    const grid = el("div", "ads-map-grid");
    const table = el("table", "ads-map-table");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Field", "Requirement", "Value", "Identifier", "Note"]) {
      const th = el("th", "", label);
      th.scope = "col";
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = el("tbody");
    const inputs = [];
    const identifierCells = [];

    for (const entry of values) {
      const tr = el("tr");
      const fieldCell = el("div", "ads-cell-name");
      fieldCell.append(el("span", "", entry.label));
      if (entry.standard) fieldCell.append(el("span", "ads-cell-sub", entry.key));
      const fieldTd = el("td");
      fieldTd.append(fieldCell);

      const requirementTd = el("td");
      requirementTd.append(el("span", "", entry.required === true ? "Required" : entry.required === false ? "Optional" : "—"));
      if (!entry.fromTemplate) requirementTd.append(el("span", "ads-cell-sub", "Not set in this template"));

      const valueTd = el("td");
      const input = el("input");
      input.type = "text";
      input.spellcheck = false;
      input.value = entry.value;
      input.setAttribute("aria-label", `${entry.label} (${entry.key}) value for template ${rowName(template)}`);
      input.addEventListener("input", () => onValueInput(template, entry.key, input.value));
      inputs.push(input);
      valueTd.append(input);

      // The identifier verdict is derived from the value, so the cell is
      // refilled on every edit rather than written once.
      const identifierTd = el("td");
      identifierCells.push({ key: entry.key, host: identifierTd });

      const noteTd = el("td", "", entry.note || "—");
      tr.append(fieldTd, requirementTd, valueTd, identifierTd, noteTd);
      tbody.append(tr);
    }
    table.append(tbody);
    grid.append(table);
    section.append(grid);
    section.append(note("Source, medium, campaign and content are required; term (utm_term) is optional. An empty parameter is left out of the address rather than written blank."));

    // ---- what the identifiers resolve to ----------------------------------
    section.append(microLabel("Stable identifiers"));
    section.append(
      defList([
        definitionRow(
          "Stable",
          "{{campaign.internal_id}}, {{creative.internal_id}} and {{ad.internal_id}} resolve to ids written once and never changed, and a fixed literal cannot drift either. Renaming an ad therefore leaves its reporting intact.",
        ),
        definitionRow(
          "Unstable",
          "{{campaign.name}} and {{ad.name}} resolve to whatever the ad is called today. Renaming the ad changes the value, and reporting keyed on the old name cannot be joined to the new one — the history splits without anybody deleting anything.",
        ),
      ]),
    );

    // ---- preview URL, then the live checks --------------------------------
    const derived = el("div", "ads-block");
    section.append(derived);

    const refs = { template, values, sample, base, context, sharedCreative, saveBtn, discardBtn, dirtyHost, derived, identifierCells, inputs };
    editorRefs.set(String(template.id), refs);
    refreshEditor(refs);
    claimFocus("editor", () => inputs[0]?.focus());
    return section;
  }

  /**
   * Re-run everything that depends on the values. Only the derived nodes are
   * replaced: rebuilding the inputs on every keystroke would take the caret
   * with it, which is the difference between an editor and a toy.
   */
  function refreshEditor(refs) {
    const values = refs.values.map((entry) => ({ ...entry, value: currentValue(refs.template, entry.key) }));
    const evaluation = evaluate(values, refs.sample, refs.base, { sharedCreative: refs.sharedCreative });
    const dirty = dirtyKeys(refs.template);
    const local = state.local.get(refs.template.id);
    const hasLocal = Boolean(local && Object.keys(local).length);

    for (const cell of refs.identifierCells) {
      const entry = values.find((candidate) => candidate.key === cell.key);
      const kind = identifierKind(entry?.value);
      const shared = sharedIdentifier(entry?.value, refs.sample.get("creative.internal_id"), refs.sharedCreative);
      clear(cell.host);
      const stack = el("div", "ads-cell-name");
      stack.append(
        shared
          ? toneBadge(`Shared with ${refs.sharedCreative} ads`, "warn", {
              title: `This value is the id of a creative that ${refs.sharedCreative} ads in this read run, so all of them write the same tracking value and reporting cannot tell them apart. {{ad.internal_id}} separates them.`,
            })
          : toneBadge(kind.label, kind.tone, { title: kind.reason }),
      );
      if (shared) stack.append(el("span", "ads-cell-sub", "Same on every ad that runs it."));
      else if (kind.short) stack.append(el("span", "ads-cell-sub", kind.short));
      cell.host.append(stack);
    }

    clear(refs.dirtyHost);
    if (dirty.length) refs.dirtyHost.append(toneBadge(`${dirty.length} unsaved ${dirty.length === 1 ? "change" : "changes"}`, "warn"));
    else if (hasLocal) refs.dirtyHost.append(toneBadge("Local draft", "info", { title: "Saved in this screen only. The account value is unchanged." }));
    refs.saveBtn.disabled = dirty.length === 0;
    refs.discardBtn.disabled = dirty.length === 0;

    clear(refs.derived);
    refs.derived.append(urlSection(evaluation, refs, values));
    refs.derived.append(checksSection(evaluation));
  }

  function urlSection(evaluation, refs, values) {
    const wrap = el("div", "ads-block");
    wrap.append(microLabel("Preview URL"));
    wrap.append(el("div", "ads-prompt", evaluation.preview.url || "—"));

    const context = refs.context;
    wrap.append(
      note(
        context.ad
          ? `Resolved with sample values from ${rowName(context.ad)} (${context.ad.id || "id not reported"})${context.creative ? ` and its creative ${context.creative.id}` : ""}. This is a rehearsal of the address this template would write, not a link that exists.`
          : "No ad rows are in this read, so there is nothing to resolve the placeholders against. The query string above is shown as the template writes it, placeholders and all.",
      ),
    );

    const used = [...new Set(values.flatMap((entry) => tokensIn(entry.value)))];
    if (used.length) {
      const filled = used.filter((token) => refs.sample.has(token)).length;
      wrap.append(microLabel(`Sample values (${filled} of ${used.length} placeholders filled)`));
      wrap.append(
        defList(
          used.map((token) => {
            const known = STABLE_TOKENS[token] || UNSTABLE_TOKENS[token] || CONTEXT_TOKENS[token] || "";
            const marked = STABLE_TOKENS[token] ? "stable internal id" : UNSTABLE_TOKENS[token] ? "unstable name" : known ? "context value" : "not defined here";
            return defRow(`{{${token}}}`, refs.sample.has(token) ? mono(refs.sample.get(token)) : mono(""), space(), el("span", "ads-block-note", `${marked}${known ? ` · ${known}` : ""}`));
          }),
        ),
      );
    }

    if (evaluation.preview.url && evaluation.preview.encoded !== evaluation.preview.url) {
      wrap.append(microLabel("Percent-encoded form"));
      wrap.append(el("div", "ads-prompt", evaluation.preview.encoded));
      wrap.append(note("The same values once each one is percent-encoded. This is the form to write when an encoding finding below applies."));
    }
    return wrap;
  }

  function findingList(findings) {
    return defList(
      findings.map((item) => {
        const term = el("dt");
        term.append(severityBadge(item.severity), space(), el("span", "ads-cell-sub", CHECK_KINDS[item.kind]?.label || item.kind));
        const line = el("div");
        if (item.field && item.field !== "url" && item.field !== "destination") line.append(mono(item.field), el("span", "", " · "));
        line.append(el("span", "", item.text));
        return defRow(term, line);
      }),
    );
  }

  function checksSection(evaluation) {
    const wrap = el("div", "ads-block");
    const counts = SEVERITY_ORDER.map((severity) => ({ severity, count: evaluation.findings.filter((item) => item.severity === severity).length })).filter((entry) => entry.count);
    wrap.append(
      microLabel(
        counts.length
          ? `Checks on these values — ${counts.map((entry) => `${entry.count} ${SEVERITY_LABELS[entry.severity].toLowerCase()}${entry.count === 1 ? "" : "s"}`).join(", ")}`
          : "Checks on these values",
      ),
    );
    if (!evaluation.findings.length) {
      wrap.append(note("No problems found in the values shown: the required fields are filled, the parameters are unique, nothing needs percent-encoding and nothing looks like personal information."));
    } else {
      wrap.append(findingList(evaluation.findings));
    }
    wrap.append(note("These checks run in this screen on the values above, including edits that have not been saved, so the address and the findings always describe what is on screen."));
    return wrap;
  }

  function onValueInput(template, key, value) {
    const draft = { ...(state.drafts.get(template.id) || {}), [key]: value };
    // Typing a value back to where it started is not a change.
    if (value === baselineValue(template, key)) delete draft[key];
    if (Object.keys(draft).length) state.drafts.set(template.id, draft);
    else state.drafts.delete(template.id);
    const refs = editorRefs.get(String(template.id));
    if (refs) refreshEditor(refs);
  }

  function saveDraft(template) {
    const draft = state.drafts.get(template.id) || {};
    const local = { ...(state.local.get(template.id) || {}) };
    for (const [key, value] of Object.entries(draft)) {
      if (value === readValue(template, key)) delete local[key];
      else local[key] = value;
    }
    if (Object.keys(local).length) state.local.set(template.id, local);
    else state.local.delete(template.id);
    state.drafts.delete(template.id);
    ctx.say("Saved as a local draft on this screen. Frank has no write endpoint for UTM templates, so nothing was sent to Meta and the account value is unchanged.");
    render();
  }

  function discardEdits(template) {
    state.drafts.delete(template.id);
    ctx.say("Unsaved edits discarded. The values shown are the ones the reader returned, plus any saved local draft.");
    render();
  }

  function revertLocal(template) {
    state.local.delete(template.id);
    ctx.say("Local draft dropped. The account value never changed, so there is nothing to undo on Meta.");
    render();
  }

  // ---------------------------------------------------------- validation ---

  /** Filter options come from the rows actually present, never a fixed list. */
  function validationFields() {
    return [
      field({
        id: "severity",
        label: "Severity",
        kind: "enum",
        get: (entry) => entry.severity,
        options: () => SEVERITY_ORDER.filter((severity) => state.validation.some((entry) => String(entry.severity) === severity)).map((severity) => ({ value: severity, label: SEVERITY_LABELS[severity] })),
      }),
      field({
        id: "kind",
        label: "Kind",
        kind: "enum",
        get: (entry) => entry.kind,
        options: () =>
          [...new Set(state.validation.map((entry) => String(entry.kind || "")))].filter(Boolean).map((kind) => ({ value: kind, label: CHECK_KINDS[kind]?.label || statusLabel(kind) })),
      }),
      field({ id: "ad", label: "Ad", kind: "text", hint: "Matches the ad name or its id.", get: (entry) => `${entry.adName || ""} ${entry.adId || ""}`.trim() }),
    ];
  }

  function visibleValidation(fields) {
    const needle = state.search.trim().toLowerCase();
    return applyFilters(state.validation, state.filters, fields).filter((entry) => {
      if (!needle) return true;
      return [entry.adName, entry.adId, entry.detail, entry.url, entry.kind, entry.severity].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }

  function findingRow(entry) {
    const term = el("dt");
    term.append(severityBadge(entry.severity), space(), el("span", "ads-cell-sub", CHECK_KINDS[entry.kind]?.label || entry.kind || "Finding"));
    const stack = el("div", "ads-block");

    const who = el("div");
    who.append(el("span", "", entry.adName ? String(entry.adName) : "Ad name not reported"), space(), mono(entry.adId || ""));
    stack.append(who);
    stack.append(el("p", "", entry.detail || "—"));
    if (typeof entry.url === "string" && entry.url.trim()) stack.append(el("div", "ads-prompt", entry.url.trim()));
    else stack.append(note("URL: —"));

    const check = verifyFinding(entry);
    const checkLine = el("div");
    checkLine.append(el("span", "ads-block-note", "Client check: "), toneBadge(check.badge, check.tone), space(), el("span", "ads-block-note", check.text));
    stack.append(checkLine);

    const action = el("div");
    action.append(
      button("Open the ad", {
        icon: ICONS.chevronRight,
        onClick: () => {
          // Nothing but the screen id: the reader has no per-ad route yet, and
          // pretending to deep-link into a record would be a promise this
          // screen cannot keep. The hint beside the button says what opens.
          ctx.navigate("campaigns");
          ctx.say(`Opening Campaigns. ${entry.adName || "The ad"} sits in that table with its ad set.`);
        },
        title: "Open the Campaigns screen.",
      }),
      space(),
      el("span", "ads-block-note", `Opens the Campaigns table, where ${entry.adName || "this ad"} sits in its ad set. It does not open the ad on its own.`),
    );
    stack.append(action);

    return defRow(term, stack);
  }

  function validationBlock() {
    const entries = state.validation;
    const fields = validationFields();
    const counts = SEVERITY_ORDER.map((severity) => ({ severity, count: entries.filter((entry) => String(entry.severity) === severity).length }));
    const unclassified = entries.filter((entry) => !SEVERITY_ORDER.includes(String(entry.severity))).length;
    const summary = [
      ...counts.filter((entry) => entry.count).map((entry) => `${entry.count} ${SEVERITY_LABELS[entry.severity].toLowerCase()}${entry.count === 1 ? "" : "s"}`),
      unclassified ? `${unclassified} unclassified` : "",
    ]
      .filter(Boolean)
      .join(", ");

    const section = block("URL validation", {
      note: entries.length
        ? `Reported by the tracking reader for the ads in this window: ${summary}. Each row is checked again in this screen against the URL it shows.`
        : "What the reader reports about ad destinations and the parameters in them.",
    });

    if (!entries.length) {
      section.append(
        emptyPanel({
          title: "No URL problems reported",
          detail: "The tracking reader reported no destination or parameter findings for the ads in this window.",
        }),
      );
      return section;
    }

    const listHost = el("div", "ads-block");
    const refs = { listHost, fields };
    const bar = filterBar({
      fields,
      filters: state.filters,
      onChange: (next) => {
        state.filters = next;
        store?.update?.({ filters: next });
        state.focus = "validation";
        render();
      },
      savedViews: store?.saved?.() || [],
      onSaveView: (name) => {
        store?.save?.(name);
        render();
      },
      onApplyView: (view) => {
        state.filters = Array.isArray(view.filters) ? view.filters : [];
        store?.update?.({ filters: state.filters });
        render();
      },
      onRemoveView: (view) => {
        store?.remove?.(view.id);
        render();
      },
      search: state.search,
      onSearch: (value) => {
        state.search = value;
        // Only the list is rebuilt: re-rendering the bar would take the caret
        // out of the box the operator is typing in.
        refreshValidation(refs);
      },
    });
    registerPopovers(bar);
    section.append(bar, listHost);
    refreshValidation(refs);
    claimFocus("validation", () => {
      const node = section.querySelector(".ads-filterbar");
      if (!node) return;
      node.tabIndex = -1;
      node.focus();
    });
    return section;
  }

  function refreshValidation(refs) {
    const visible = visibleValidation(refs.fields);
    clear(refs.listHost);
    if (!visible.length) {
      refs.listHost.append(
        emptyPanel({
          title: "No findings match these filters",
          detail: `${state.validation.length} finding${state.validation.length === 1 ? "" : "s"} reported in total. Remove a filter or clear the search to see the rest.`,
        }),
      );
      return;
    }
    refs.listHost.append(note(`${visible.length} of ${state.validation.length} findings shown.`));
    const list = el("dl");
    for (const entry of visible) list.append(findingRow(entry));
    refs.listHost.append(list);
  }

  // --------------------------------------------------------------- trace ---

  function traceBlock() {
    const subject = resolveSubject();
    const options = subject.kind === "creative" ? rows("creatives") : rows("ads");
    const chosen = subject.kind === "creative" ? subject.creative : subject.ad;

    const select = el("select", "ads-select");
    select.setAttribute("aria-label", subject.kind === "creative" ? "Creative to trace" : "Ad to trace");
    if (!options.length) {
      select.disabled = true;
      select.append(el("option", "", subject.kind === "creative" ? "No creative rows" : "No ad rows"));
    } else {
      for (const row of options) {
        const option = el("option", "", `${rowName(row)} · ${rowKey(row) || "id not reported"}`);
        option.value = String(rowKey(row));
        if (chosen && String(rowKey(row)) === String(rowKey(chosen))) option.selected = true;
        select.append(option);
      }
      select.addEventListener("change", () => {
        state.subject = { kind: subject.kind, id: select.value };
        state.focus = "trace";
        render();
      });
    }

    const kindControl = segmented(
      [
        { id: "ad", label: "By ad" },
        { id: "creative", label: "By creative" },
      ],
      subject.kind,
      (id) => {
        state.subject = { kind: id, id: "" };
        state.focus = "trace";
        render();
      },
      { label: "What to trace", size: "sm" },
    );

    const section = block("Trace a result back to its ad, prompt and destination", {
      note: "One hop at a time: the ad, the creative it runs, the prompt that produced that creative, the address the ad points at, the UTM set saved on it, and the post that address lands on.",
      actions: [kindControl, select],
    });

    if (joinPending(["ads", "creatives"])) {
      section.append(note("The ad and creative reads have not answered yet."));
      return section;
    }

    const ad = subject.ad;
    const creative = subject.creative;
    const adset = adsetForAd(ad);
    const campaign = campaignForAd(ad);
    const join = blogFor(creative);
    const destination = typeof ad?.destination === "string" && ad.destination.trim() ? ad.destination.trim() : "";
    const tracking = ad?.tracking && typeof ad.tracking === "object" ? ad.tracking : null;

    const flow = el("div", "ads-flow");
    const hop = (label, done) => {
      const step = el("span", "ads-flow-step", label);
      if (done) step.dataset.done = "true";
      return step;
    };
    flow.append(
      hop("Ad", Boolean(ad)),
      el("span", "", "→"),
      hop("Creative", Boolean(creative)),
      el("span", "", "→"),
      hop("Destination", Boolean(destination)),
      el("span", "", "→"),
      hop("UTM set", Boolean(tracking)),
      el("span", "", "→"),
      hop("Blog post", Boolean(join.blog)),
    );
    section.append(flow);

    if (subject.kind === "creative" && creative) {
      section.append(
        note(
          subject.carries.length
            ? `This creative runs in ${subject.carries.length} ad${subject.carries.length === 1 ? "" : "s"} in this read. The destination and the UTM set below belong to ${rowName(subject.carries[0])}, which is the ad the trace follows.`
            : "No ad in this read carries this creative, so there is no destination or UTM set to follow.",
        ),
      );
    }

    const rowsOut = [];

    if (subject.kind === "ad") {
      const adLine = el("div");
      adLine.append(el("span", "", ad ? rowName(ad) : "—"), space(), mono(ad?.id || ""), ad ? space() : null, ad ? stateBadge(ad.state) : null);
      rowsOut.push(
        defRow(
          "Ad",
          adLine,
          adset ? el("div", "ads-block-note", `Ad set ${adset.name || "—"} (${adset.id || "—"})`) : null,
          !adset && !joinPending(["adsets"]) ? el("div", "ads-block-note", joinGap(["adsets"]) || "No ad set row in this read matches the ad's parent id.") : null,
        ),
      );
    } else {
      const creativeLine = el("div");
      creativeLine.append(el("span", "", creative ? rowName(creative) : "—"), space(), mono(creative?.id || ""));
      rowsOut.push(defRow("Creative", creativeLine));
      rowsOut.push(defRow("Ads carrying it", el("div", "", subject.carries.length ? subject.carries.map((row) => `${rowName(row)} (${row.id || "—"})`).join(", ") : "—")));
    }

    if (subject.kind === "ad") {
      const creativeLine = el("div");
      creativeLine.append(el("span", "", creative ? rowName(creative) : "—"), space(), mono(creative?.id || ""));
      if (creative) {
        creativeLine.append(
          space(),
          button("Open", {
            variant: "quiet",
            icon: ICONS.chevronRight,
            ariaLabel: `Open the creative ${rowName(creative)} in Creative intelligence`,
            onClick: () => {
              ctx.navigate("creative");
              ctx.say("Opening Creative intelligence. This creative is in that list.");
            },
          }),
        );
      }
      rowsOut.push(defRow("Creative", creativeLine, creative ? null : el("div", "ads-block-note", joinGap(["creatives"]) || "No creative row in this read has the id this ad points at.")));
    }

    rowsOut.push(defRow("Campaign", campaign ? concat(el("span", "", rowName(campaign)), space(), mono(campaign.id)) : mono("")));

    const prompt = creative?.prompt && typeof creative.prompt === "object" ? creative.prompt : null;
    const promptBlock = prompt && typeof prompt.text === "string" && prompt.text.trim() ? el("div", "ads-prompt", prompt.text.trim()) : mono("");
    const promptMeta = prompt ? [prompt.model, prompt.version, prompt.capturedAt ? `captured ${prompt.capturedAt}` : ""].filter(Boolean).join(" · ") || "—" : "—";
    rowsOut.push(defRow("Prompt", promptBlock, el("div", "ads-block-note", promptMeta)));

    rowsOut.push(defRow("Destination", destination ? el("div", "ads-prompt", destination) : mono("")));
    rowsOut.push(
      defRow(
        "UTM set",
        tracking ? trackingTable(tracking) : mono(""),
        el("div", "ads-block-note", tracking ? "Saved on the ad itself. The template preview above shows what a template would write for this ad." : "This ad row carries no saved tracking set, so every parameter is unknown here."),
      ),
    );

    const blogLine = el("div");
    if (join.blog) {
      blogLine.append(el("span", "", rowName(join.blog)), space(), mono(join.blog.id || ""));
      blogLine.append(
        space(),
        button("Open", {
          variant: "quiet",
          icon: ICONS.chevronRight,
          ariaLabel: "Open the blog post in Blogs & destinations",
          onClick: () => {
            ctx.navigate("blogs");
            ctx.say("Opening Blogs & destinations. This post is in that list.");
          },
        }),
      );
    } else {
      blogLine.append(mono(""));
    }
    const blogNote = join.blog ? `${join.basis}${join.blog.topic ? ` · topic ${join.blog.topic}` : ""}` : join.reason || joinGap(["blogs", "creatives"]);
    rowsOut.push(defRow("Blog post", blogLine, el("div", "ads-block-note", blogNote)));

    section.append(defList(rowsOut));
    claimFocus("trace", () => select.focus());
    return section;
  }

  /** Two-column read-only table for the parameters saved on one ad. */
  function trackingTable(tracking) {
    const table = el("table", "ads-map-table");
    const tbody = el("tbody");
    for (const key of PARAM_ORDER) {
      const tr = el("tr");
      const keyCell = el("td");
      keyCell.append(mono(key));
      const valueCell = el("td");
      const value = tracking[key];
      valueCell.append(typeof value === "string" && value.trim() ? mono(value.trim()) : mono(""));
      tr.append(keyCell, valueCell);
      tbody.append(tr);
    }
    if (typeof tracking.internalId === "string" && tracking.internalId.trim()) {
      const tr = el("tr");
      const keyCell = el("td");
      keyCell.append(mono("tracking set id"));
      const valueCell = el("td");
      valueCell.append(mono(tracking.internalId.trim()));
      tr.append(keyCell, valueCell);
      tbody.append(tr);
    }
    table.append(tbody);
    return table;
  }

  // --------------------------------------------------------- destination ---

  function destinationDraft(ad) {
    return destinationDraftEntry(state.destination, ad);
  }

  /**
   * The one warning that has to be impossible to miss. It sits above the
   * affordance, not below it, and it says what is kept as well as what is lost.
   */
  function destinationWarning() {
    const banner = el("div", "ads-banner");
    banner.dataset.tone = "warn";
    banner.setAttribute("role", "note");
    banner.append(svg(ICONS.alert, { size: 13, width: 1.8 }));
    banner.append(
      el(
        "span",
        "",
        "Changing the destination of an ad that is delivering resets that ad's learning phase and splits its reporting history: sessions before the edit carry the old address and the old values, and the two halves are not comparable.",
      ),
    );
    banner.append(el("span", "ads-banner-detail", "The previous value is retained for the reporting join, so the split stays visible instead of disappearing."));
    return banner;
  }

  function destinationBlock() {
    const section = block("Change an ad's destination", {
      note: "The rule comes first here, because this is the only part of tracking that can move an ad's reporting off a cliff in one edit.",
    });
    section.append(destinationWarning());

    const subject = resolveSubject();
    if (!subject.ad) {
      section.append(
        note(
          subject.kind === "creative"
            ? "A creative has no destination of its own — the ad it runs in carries the address. Choose an ad in the trace above to change one."
            : joinPending(["ads"])
              ? "The ads read has not answered yet."
              : "The ads read returned no rows, so there is no destination to show or change.",
        ),
      );
      if (subject.kind === "creative" && rows("ads").length) {
        section.append(
          actionRow([
            button("Trace an ad instead", {
              onClick: () => {
                state.subject = { kind: "ad", id: "" };
                state.focus = "trace";
                render();
              },
            }),
          ]),
        );
      }
      return section;
    }

    const ad = subject.ad;
    const active = String(ad.state) === "delivering";
    const draft = destinationDraft(ad);
    const providerValue = String(ad.destination ?? "").trim();

    const adLine = el("div");
    adLine.append(el("span", "", rowName(ad)), space(), mono(ad.id || ""), space(), stateBadge(ad.state));
    section.append(defList([defRow("Ad", adLine), defRow("Destination now", providerValue ? el("div", "ads-prompt", providerValue) : mono(""))]));

    section.append(microLabel("New destination"));
    const input = el("input", "ads-input");
    input.type = "text";
    input.spellcheck = false;
    input.value = draft.value;
    input.setAttribute("aria-label", `New destination for ${rowName(ad)}`);
    input.addEventListener("input", () => {
      draft.value = input.value;
      refreshDestination(refs);
    });
    section.append(input);

    if (active) {
      const ackBox = el("input", "ads-check");
      ackBox.type = "checkbox";
      ackBox.checked = draft.acknowledged;
      ackBox.addEventListener("change", () => {
        draft.acknowledged = ackBox.checked;
        refreshDestination(refs);
      });
      const ackLabel = el("label");
      ackLabel.append(ackBox, el("span", "", " This ad is delivering. I understand that changing its destination resets its learning and splits its reporting history."));
      section.append(ackLabel);
    }

    const dirtyHost = el("span", "ads-cell-flags");
    const findingsHost = el("div", "ads-block");
    const saveBtn = button("Save as local draft", {
      variant: "ink",
      onClick: () => saveDestination(ad),
      title: "Keep this address as a local draft in this screen. It is not sent to Meta.",
    });
    const resetBtn = button("Reset", {
      onClick: () => {
        draft.value = providerValue;
        input.value = providerValue;
        refreshDestination(refs);
      },
      title: "Put the ad's current address back in the box.",
    });
    section.append(
      actionRow([
        saveBtn,
        resetBtn,
        button("Queue a change through Publish", {
          onClick: () => {
            ctx.openPublish();
            ctx.say("Opening the publishing flow. Frank writes to Meta only from there, and only after review.");
          },
          title: "Open Frank's publishing flow, which is the only path that writes to Meta.",
        }),
      ]),
    );
    section.append(dirtyHost, findingsHost);

    if (draft.saved) {
      section.append(
        defList([
          defRow("Local draft", el("div", "ads-prompt", draft.saved.url || "—")),
          defRow("Provider value (unchanged)", providerValue ? el("div", "ads-prompt", providerValue) : mono("")),
        ]),
      );
      section.append(
        note(
          "Nothing was sent to Meta: the ad still points at its current address, and the draft above lives in this screen only until it is queued through Publish. The previous value is kept for the reporting join, so the split is visible rather than lost.",
        ),
      );
      section.append(
        actionRow([
          button("Discard local draft", {
            variant: "quiet",
            onClick: () => {
              draft.saved = null;
              ctx.say("Destination draft discarded. Nothing was ever sent to Meta.");
              render();
            },
          }),
        ]),
      );
    }

    const refs = { ad, input, active, saveBtn, resetBtn, dirtyHost, findingsHost, draft };
    refreshDestination(refs);
    claimFocus("destination", () => input.focus());
    return section;
  }

  function refreshDestination(refs) {
    const current = String(refs.input.value || "").trim();
    const providerValue = String(refs.ad.destination ?? "").trim();
    const changed = current !== providerValue;
    const findings = urlFindings(current, { label: "The new destination", fieldKey: "destination" });
    const blocked = refs.active && !refs.draft.acknowledged;
    // A saved local draft and the box can differ: the rows below the actions
    // describe the last save, so the badge has to say when the box has moved on
    // from it rather than repeat "saved".
    const savedStale = Boolean(refs.draft.saved) && refs.draft.saved.url !== current;

    clear(refs.dirtyHost);
    if (changed) {
      const word = blocked ? "Waiting for the acknowledgement" : savedStale ? "Changed since the draft was saved" : "Not saved anywhere yet";
      refs.dirtyHost.append(
        toneBadge(word, "warn", {
          title: blocked
            ? "An ad that is delivering needs the acknowledgement before a destination edit can be kept."
            : savedStale
              ? "The local draft below holds an earlier address; this box has been edited since."
              : "This is not the ad's current address, and it has not been sent anywhere.",
        }),
      );
    } else {
      refs.dirtyHost.append(toneBadge("Unchanged", "mute"));
    }
    refs.saveBtn.disabled = !changed || blocked;
    refs.resetBtn.disabled = !changed;

    clear(refs.findingsHost);
    if (findings.length) refs.findingsHost.append(findingList(findings));
    else {
      refs.findingsHost.append(
        note("The address in the box passes the checks that apply here: it is an http address, its values are encoded, it carries each parameter once and nothing in it looks like personal information."),
      );
    }
  }

  function saveDestination(ad) {
    const draft = destinationDraft(ad);
    draft.saved = { url: String(draft.value || "").trim() };
    ctx.say("Destination draft saved in this screen only. Nothing was sent to Meta; the ad still points at its current address.");
    render();
  }

  // ------------------------------------------------------------- history ---

  function historyItem(entry) {
    const item = el("div", "ads-timeline-item");
    const actor = String(entry.actor || "").toLowerCase();
    // The timeline's dot colours are keyed to kinds in the queue's activity
    // feed. Only `sync` means the same thing here — a machine write rather than
    // a human one — so nothing else borrows one.
    if (actor === "sync") item.dataset.kind = "sync";

    const time = el("time", "ads-timeline-time", formatWhen(entry.at));
    if (entry.at) {
      time.setAttribute("datetime", String(entry.at));
      time.title = String(entry.at);
    }
    const rail = el("div", "ads-timeline-rail");
    rail.append(el("span", "ads-timeline-dot"));

    const body = el("div", "ads-timeline-body");
    const line = el("div", "ads-timeline-text");
    line.append(el("span", "", `${changeName(entry.change)} changed from `), mono(entry.before), el("span", "", " to "), mono(entry.after), el("span", "", "."));
    body.append(line);
    const who = el("div", "ads-timeline-actor");
    who.append(el("span", "", actorName(entry.actor)), el("span", "", " · "), el("span", "", entry.adName ? String(entry.adName) : "Ad name not reported"), el("span", "", " · "), mono(entry.adId || ""));
    body.append(who);
    if (entry.note) body.append(note(entry.note));

    item.append(time, rail, body);
    return item;
  }

  function historyBlock() {
    const entries = [...state.history].sort((a, b) => (Date.parse(String(b.at || "")) || 0) - (Date.parse(String(a.at || "")) || 0));
    const section = block("Tracking history", { note: "Who changed a destination or a UTM value, what it was before, and when. Newest first." });
    if (!entries.length) {
      section.append(
        emptyPanel({
          title: "No tracking changes recorded",
          detail: "The tracking reader reported no destination or parameter changes for this account.",
        }),
      );
      return section;
    }
    const list = el("div", "ads-timeline");
    for (const entry of entries) list.append(historyItem(entry));
    section.append(list);
    return section;
  }

  // ----------------------------------------------------------- lifecycle ---

  start();

  return {
    node: root,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      closePopovers();
      root.remove();
    },
    settled: () => Promise.allSettled(inFlight),
    reload: (options = {}) => start({ force: Boolean(options.force) }),
  };
}
