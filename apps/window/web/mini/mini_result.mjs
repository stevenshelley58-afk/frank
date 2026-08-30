const MAX_TEXT = 1600;

function text(value, limit = MAX_TEXT) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, limit);
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeUrl(value) {
  const candidate = text(value, 2048);
  if (!candidate) return "";
  try {
    const origin = globalThis.location?.origin || "https://frank.fail";
    const url = new URL(candidate, origin);
    const sameOrigin = url.origin === origin;
    if (!sameOrigin) return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function version(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value == null ? "" : value), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function stringList(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => text(
    typeof item === "string" ? item : item && (item.label || item.summary || item.text || item.name),
    500,
  )).filter(Boolean);
}

function actions(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => {
    if (!item || typeof item !== "object") return null;
    const label = text(item.label || item.title || item.name, 120);
    const suppliedPrompt = text(item.prompt || item.message, 2000);
    const explicitUrl = suppliedPrompt.startsWith("/") || /^https:\/\//i.test(suppliedPrompt);
    const promptUrl = explicitUrl ? safeUrl(suppliedPrompt) : "";
    const url = safeUrl(item.url || item.href) || promptUrl;
    const prompt = promptUrl ? "" : suppliedPrompt;
    if (!label || (!prompt && !url)) return null;
    return { label, prompt, url, mode: text(item.mode || item.kind, 40) };
  }).filter(Boolean);
}

function section(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const title = text(value.title || value.label, 160);
  const summary = text(value.summary || value.description || value.text, 1200);
  const items = stringList(value.items || value.suggestions || value.steps);
  const sectionActions = actions(value.actions || value.options || value.projects);
  if (!title && !summary && !items.length && !sectionActions.length) return null;
  return { title, summary, items, actions: sectionActions };
}

function selfHost(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const base = section(value) || {};
  const steps = Array.isArray(value.steps) ? value.steps.slice(0, 30).map((item, index) => {
    if (typeof item === "string") return { title: `Step ${index + 1}`, detail: text(item, 1200), commands: [] };
    if (!item || typeof item !== "object") return null;
    const title = text(item.title || item.label || `Step ${index + 1}`, 180);
    const detail = text(item.detail || item.summary || item.description, 1600);
    const commands = stringList(item.commands, 12);
    return title || detail || commands.length ? { title, detail, commands } : null;
  }).filter(Boolean) : [];
  const requirements = stringList(value.requirements, 20);
  const checks = stringList(value.checks || value.verification, 20);
  const overview = text(value.overview, 1200);
  const operations = Array.isArray(value.operations) ? value.operations.slice(0, 20).map((item) => {
    if (typeof item === "string") return text(item, 700);
    const area = text(item && item.area, 100);
    const detail = text(item && item.detail, 600);
    return area && detail ? `${area}: ${detail}` : area || detail;
  }).filter(Boolean) : [];
  const maintenance = stringList(value.maintenance || value.ongoing, 20).concat(operations);
  // Applicability is the authority for whether hosting is required. `status`
  // describes whether the supplied guide is ready and must not overwrite it.
  const status = text(value.applicability || value.status, 80) || "not_supplied";
  if (!base.title && !base.summary && !overview && !steps.length && !requirements.length && !checks.length && !maintenance.length) return null;
  return {
    ...base,
    title: base.title || "Self-host this result",
    summary: base.summary || overview,
    status,
    steps,
    requirements,
    checks,
    maintenance,
    service: value.service && typeof value.service === "object" ? {
      available: value.service.available === true,
      reason: text(value.service.reason, 500),
      priceStatus: text(value.service.price_status, 80),
    } : null,
  };
}

function projectSection(title, value, fallbackSummary = "") {
  const items = Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : [];
  const normalized = items.slice(0, 8).map((item) => {
    if (!item || typeof item !== "object") return null;
    const itemTitle = text(item.title, 140);
    const why = text(item.why, 600);
    const prompt = text(item.prompt, 2000);
    if (!itemTitle || !why || !prompt) return null;
    const explicitUrl = prompt.startsWith("/") || /^https:\/\//i.test(prompt);
    const promptUrl = explicitUrl ? safeUrl(prompt) : "";
    return {
      description: `${itemTitle} — ${why}`,
      action: { label: itemTitle, prompt: promptUrl ? "" : prompt, url: promptUrl, mode: text(item.mode, 40) },
    };
  }).filter(Boolean);
  if (!normalized.length) return null;
  return {
    title,
    summary: text(fallbackSummary, 1200),
    items: normalized.map((item) => item.description),
    actions: normalized.map((item) => item.action),
  };
}

function largerProject(value) {
  if (!value || typeof value !== "object") return null;
  if (value.status === "ready") {
    const title = text(value.title, 160);
    const why = text(value.why, 900);
    const prompt = text(value.owner_prompt, 2000);
    if (!title || !why || !prompt) return null;
    return { title, summary: why, items: [], actions: [{ label: "Explore this optional project", prompt, url: "", mode: "service" }] };
  }
  const reason = text(value.reason, 900);
  return reason ? { title: "Larger optional project", summary: reason, items: [], actions: [] } : null;
}

/**
 * Accept only the typed guidance object returned for this job revision.
 * The browser does not infer commercial offers, hosting state, or project advice.
 */
export function normalizeResultGuidance(raw, expectedVersion = null, rawSelfHost = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!source) return { status: "not_supplied", revision: null };
  const expected = version(expectedVersion);
  const suppliedRevision = version(source.base_version ?? source.revision ?? source.version);
  if (expected !== null && suppliedRevision !== null && suppliedRevision !== expected) {
    return { status: "stale", revision: suppliedRevision, expected };
  }
  const revision = suppliedRevision ?? expected;
  const normalized = {
    status: text(source.status, 80) || "ready",
    revision,
    useNow: projectSection("Use it now", source.use_now),
    freeRefinements: source.free_revisions && source.free_revisions.available === true
      ? projectSection("Free refinements for this result", source.free_revisions)
      : null,
    selfHost: selfHost(rawSelfHost || source.self_host),
    relatedFreeProject: source.related_free_projects && source.related_free_projects.status === "ready"
      ? projectSection("A related free project", source.related_free_projects)
      : null,
    liveImplementation: largerProject(source.larger_project),
    done: section(source.done),
  };
  if (![normalized.useNow, normalized.freeRefinements, normalized.selfHost, normalized.relatedFreeProject, normalized.liveImplementation, normalized.done].some(Boolean)) {
    return { status: "not_supplied", revision };
  }
  return normalized;
}

function sectionCopy(item) {
  if (!item) return "";
  const list = item.items?.length ? `<ul>${item.items.map((entry) => `<li>${esc(entry)}</li>`).join("")}</ul>` : "";
  return `${item.title ? `<h4>${esc(item.title)}</h4>` : ""}${item.summary ? `<p>${esc(item.summary)}</p>` : ""}${list}`;
}

function promptActions(item, fallbackMode = "change") {
  if (!item?.actions?.length) return "";
  return `<div class="guidance-actions">${item.actions.map((action) => action.prompt
    ? `<button class="secondary-button" type="button" data-guidance-prompt="${esc(action.prompt)}" data-guidance-mode="${esc(action.mode || fallbackMode)}">${esc(action.label)}</button>`
    : `<a class="artifact-link" href="${esc(action.url)}" target="_blank" rel="noopener noreferrer">${esc(action.label)}</a>`).join("")}</div>`;
}

export function resultGuidanceMarkup(guidance) {
  if (!guidance || guidance.status === "not_supplied") {
    return `<section class="result-guidance guidance-pending" aria-labelledby="result-guidance-title"><div class="guidance-heading"><span>Next</span><h3 id="result-guidance-title">Put this result to work</h3></div><p>Project-specific guidance has not been supplied for this revision yet. You can still open, change, share or download the result above.</p></section>`;
  }
  if (guidance.status === "stale") {
    return `<section class="result-guidance guidance-pending" aria-labelledby="result-guidance-title"><div class="guidance-heading"><span>Updating</span><h3 id="result-guidance-title">Put this result to work</h3></div><p>The guidance belongs to an earlier revision, so Mini Frank is not showing it as current.</p></section>`;
  }
  const blocks = [];
  if (guidance.useNow) blocks.push(`<article class="guidance-block guidance-use"><span class="guidance-index">01</span><div>${sectionCopy(guidance.useNow)}${promptActions(guidance.useNow, "change")}</div></article>`);
  if (guidance.freeRefinements) blocks.push(`<article class="guidance-block"><span class="guidance-index">02</span><div>${sectionCopy(guidance.freeRefinements)}${promptActions(guidance.freeRefinements, "change")}</div></article>`);
  if (guidance.selfHost) blocks.push(`<article class="guidance-block"><span class="guidance-index">03</span><div>${sectionCopy(guidance.selfHost)}<div class="guidance-actions"><button class="secondary-button" type="button" data-action="open-self-host">Open the free self-hosting guide</button></div></div></article>`);
  if (guidance.relatedFreeProject) blocks.push(`<article class="guidance-block"><span class="guidance-index">04</span><div>${sectionCopy(guidance.relatedFreeProject)}${promptActions(guidance.relatedFreeProject, "new")}</div></article>`);
  if (guidance.liveImplementation) blocks.push(`<article class="guidance-block"><span class="guidance-index">05</span><div>${sectionCopy(guidance.liveImplementation)}<div class="guidance-actions"><button class="quiet-button" type="button" data-action="open-self-host">See the guide before choosing help</button></div>${promptActions(guidance.liveImplementation, "service")}</div></article>`);
  if (guidance.done) blocks.push(`<article class="guidance-block guidance-done"><span class="guidance-index">✓</span><div>${sectionCopy(guidance.done)}${promptActions(guidance.done, "done")}</div></article>`);
  return `<section class="result-guidance" aria-labelledby="result-guidance-title"><div class="guidance-heading"><span>For this revision${guidance.revision === null ? "" : ` · ${esc(guidance.revision)}`}</span><h3 id="result-guidance-title">Put this result to work</h3></div><div class="guidance-grid">${blocks.join("")}</div></section>`;
}

function guideList(title, items) {
  return items?.length ? `<section><h3>${esc(title)}</h3><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : "";
}

export function selfHostGuideMarkup(guide) {
  if (!guide) return `<div class="guide-unavailable"><h3>No guide was supplied</h3><p>This result does not currently include self-hosting instructions. Nothing has been hidden or guessed.</p></div>`;
  const steps = guide.steps?.length ? `<ol class="host-steps">${guide.steps.map((step) => `<li><h3>${esc(step.title)}</h3>${step.detail ? `<p>${esc(step.detail)}</p>` : ""}${step.commands?.length ? `<div class="command-list">${step.commands.map((command) => `<code>${esc(command)}</code>`).join("")}</div>` : ""}</li>`).join("")}</ol>` : "";
  return `<div class="self-host-guide-copy">${guide.title ? `<h2>${esc(guide.title)}</h2>` : ""}${guide.summary ? `<p class="dialog-lead">${esc(guide.summary)}</p>` : ""}${guideList("What you need", guide.requirements)}${steps}${guideList("Check it works", guide.checks)}${guideList("Keep it healthy", guide.maintenance)}</div>`;
}
