const GUIDE_SCHEMA = "mini-guide-v1";
const GUIDE_KINDS = new Set(["question", "preview", "confirm"]);
const GUIDE_INTENTS = new Set(["choice", "other", "change", "choose_for_me"]);
const PREVIEW_KINDS = new Set(["ad", "form", "board", "flow", "page", "document"]);
const UNDERSTANDING_KEYS = new Set(["problem", "outcome", "people", "current_way", "success", "assumption", "direction"]);
const TOP_LEVEL_KEYS = new Set(["schema", "message", "understanding", "next"]);
const UNDERSTANDING_FIELDS = new Set(["key", "label", "value", "assumed"]);
const NEXT_FIELDS = new Set(["kind", "id", "question", "why", "options", "allow_other", "allow_choose_for_me"]);
const OPTION_FIELDS = new Set(["id", "label", "detail", "recommended"]);
const PREVIEW_FIELDS = new Set(["kind", "title", "subtitle", "items", "action"]);
const FREE_CTA = "Click Solve this for me — free.";
const FORBIDDEN_ID_RE = /(?:^|_)(?:api|agent|backend|code|docker|endpoint|hermes|host|ip|localhost|model|pipeline|port|prompt|repo|repository|root|server|session|skill|system|token|tool|uri|url|workspace)(?:_|$)/i;
const URL_RE = /(?:\b[a-z][a-z0-9+.-]{1,31}:(?:\/\/|[^\s])|(?<!:)\/{2}[a-z0-9]|\blocalhost(?::\d{1,5})?\b|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b|\[[0-9a-f:]+\](?::\d{1,5})?|(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?::\d{1,5})?|\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}(?::\d{1,5})?\b|\b[a-z0-9][a-z0-9.-]{0,252}:\d{1,5}\b)/i;
const MARKUP_RE = /<[^>]*>|&(?:lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;
const MARKDOWN_RE = /(?:^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)|[•◦▪▫‣⁃]/;

function plainText(value, limit) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeId(value) {
  if (typeof value !== "string" || value.length > 64) return "";
  const candidate = value;
  return /^[a-z][a-z0-9_-]{0,63}$/.test(candidate) && !FORBIDDEN_ID_RE.test(candidate) ? candidate : "";
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function wordCount(value) {
  return (value.match(/\b[\w'’.-]+\b/g) || []).length;
}

function visibleText(value, limit, required = true, wordLimit = Infinity) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if ((required && !cleaned) || cleaned.length > limit || wordCount(cleaned) > wordLimit) return null;
  if (/[<>]/.test(cleaned) || MARKUP_RE.test(cleaned) || URL_RE.test(cleaned) || MARKDOWN_RE.test(value)) return null;
  return cleaned;
}

function normalizeUnderstanding(value) {
  // Hermes supplies at most six facts per turn. The server can merge the
  // seventh durable fact into the public/restored card, so the thin client
  // must preserve all seven allowlisted business facts.
  if (!Array.isArray(value) || value.length > 7) return null;
  const seen = new Set();
  const cleaned = [];
  for (const item of value) {
    if (!exactKeys(item, UNDERSTANDING_FIELDS) || typeof item.assumed !== "boolean") return null;
    const key = String(item.key || "");
    const label = visibleText(item.label, 80, true, 5);
    const factValue = visibleText(item.value, 500, true, 20);
    if (!UNDERSTANDING_KEYS.has(key) || !label || !factValue || seen.has(key)) return null;
    seen.add(key);
    cleaned.push({ key, label, value: factValue, assumed: item.assumed });
  }
  return cleaned;
}

function normalizePreview(value) {
  if (!exactKeys(value, PREVIEW_FIELDS)) return null;
  const kind = String(value.kind || "");
  const title = visibleText(value.title, 80, true, 8);
  const subtitle = visibleText(value.subtitle, 160, true, 15);
  const action = visibleText(value.action, 80, true, 5);
  if (!Array.isArray(value.items) || value.items.length < 2 || value.items.length > 4) return null;
  const items = value.items.map((item) => visibleText(item, 100, true, 12));
  if (!PREVIEW_KINDS.has(kind) || !title || !subtitle || !action || items.some((item) => !item)) return null;
  return { kind, title, subtitle, items, action };
}

function normalizeOptions(value, kind) {
  const minimum = 2;
  const maximum = kind === "preview" ? 3 : 4;
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const seen = new Set();
  const cleaned = [];
  let recommendedCount = 0;
  const expectedFields = kind === "preview" ? new Set([...OPTION_FIELDS, "preview"]) : OPTION_FIELDS;
  for (const item of value) {
    if (!exactKeys(item, expectedFields) || typeof item.recommended !== "boolean") return null;
    const id = safeId(item.id);
    const label = visibleText(item.label, 80, true, 7);
    const detail = visibleText(item.detail, 200, true, 16);
    if (!id || !label || !detail || seen.has(id)) return null;
    const preview = kind === "preview" ? normalizePreview(item.preview) : null;
    if (kind === "preview" && !preview) return null;
    seen.add(id);
    recommendedCount += Number(item.recommended);
    cleaned.push({
      id,
      label,
      detail,
      recommended: item.recommended,
      ...(preview ? { preview } : {}),
    });
  }
  return recommendedCount === 1 ? cleaned : null;
}

export function normalizeGuideCard(value) {
  if (!exactKeys(value, TOP_LEVEL_KEYS)) return null;
  if (value.schema !== GUIDE_SCHEMA) return null;
  const message = visibleText(value.message, 600, true, 45);
  const nextValue = value.next;
  const understanding = normalizeUnderstanding(value.understanding);
  if (!message || understanding === null || !exactKeys(nextValue, NEXT_FIELDS)) return null;
  const kind = String(nextValue.kind || "");
  const id = safeId(nextValue.id);
  const question = visibleText(nextValue.question, 220, false, 12);
  const why = visibleText(nextValue.why, 240, false, 18);
  if (!GUIDE_KINDS.has(kind) || !id || question === null || why === null || typeof nextValue.allow_other !== "boolean" || typeof nextValue.allow_choose_for_me !== "boolean" || !Array.isArray(nextValue.options)) return null;

  let options;
  if (kind === "confirm") {
    if (question || nextValue.options.length || nextValue.allow_other !== true || nextValue.allow_choose_for_me !== false || !message.endsWith(FREE_CTA)) return null;
    options = [];
  } else {
    if (!question || !question.endsWith("?") || nextValue.allow_other !== true || nextValue.allow_choose_for_me !== true || message.endsWith(FREE_CTA)) return null;
    options = normalizeOptions(nextValue.options, kind);
    if (!options) return null;
  }

  const card = {
    schema: GUIDE_SCHEMA,
    message,
    understanding,
    next: {
      kind,
      id,
      question,
      why,
      options,
      allow_other: nextValue.allow_other,
      allow_choose_for_me: nextValue.allow_choose_for_me,
    },
  };
  const questionMarks = JSON.stringify(card).split("?").length - 1;
  if (questionMarks !== (kind === "confirm" ? 0 : 1)) return null;
  return card;
}

export function normalizeGuideIntent(value, fallback = "choice") {
  return GUIDE_INTENTS.has(value) ? value : GUIDE_INTENTS.has(fallback) ? fallback : "choice";
}

function answerSubject(card) {
  return plainText(card && card.next && card.next.question, 180).replace(/[.?!]+$/, "");
}

export function guideChoiceAnswer(cardValue, choiceId) {
  const card = normalizeGuideCard(cardValue);
  const id = safeId(choiceId);
  if (!card || card.next.kind === "confirm" || !id) return null;
  const option = card.next.options.find((item) => item.id === id);
  if (!option) return null;
  const subject = answerSubject(card);
  return {
    label: option.label,
    text: `${subject}: ${option.label}.`,
  };
}

export function guideChooseForMeAnswer(cardValue) {
  const card = normalizeGuideCard(cardValue);
  if (!card || card.next.kind === "confirm" || !card.next.allow_choose_for_me) return null;
  return {
    label: "Frank will choose",
    text: `Please choose the best answer for me: ${answerSubject(card)}.`,
  };
}

export function guideOtherPrompt(cardValue) {
  const card = normalizeGuideCard(cardValue);
  if (!card || card.next.kind === "confirm" || !card.next.allow_other) return "";
  return `My answer to “${answerSubject(card)}” is…`;
}
