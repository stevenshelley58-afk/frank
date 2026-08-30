const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;"}[char]));
const categories = ["systems", "capabilities", "cleanup", "changes"];
const states = (axes) => Object.entries(axes || {}).map(([key, value]) => `<span class="state-chip"><b>${esc(key)}</b>${esc(value)}</span>`).join("") || `<span class="state-chip">Unknown</span>`;

function recordRow(record) {
  return `<button type="button" class="control-row" data-record-id="${esc(record.id)}"><span class="control-row-title"><strong>${esc(record.title || record.id)}</strong><small>${esc(record.id)}</small></span><span>${esc(record.kind || "unknown")}</span><span>${esc(record.status || "unknown")}</span><span class="state-chips">${states(record.state_axes)}</span></button>`;
}

export async function mountControl(root) {
  if (!root) return;
  root.innerHTML = `<div class="operate-surface control-surface"><header class="operate-heading"><div><span class="operate-kicker">Control · read only</span><h2>Estate records</h2><p>List, inspect, and follow evidence-backed identities. Hermes owns every operation.</p></div><span class="truth-pill" id="control-state">Checking source…</span></header><nav class="control-categories" aria-label="Control categories">${categories.map((category, index) => `<button type="button" class="control-category${index === 0 ? " is-selected" : ""}" data-category="${category}">${category[0].toUpperCase() + category.slice(1)}</button>`).join("")}</nav><div class="control-toolbar"><label class="control-search"><span class="sr-only">Search control records</span><input id="control-search" type="search" placeholder="Search identities, source paths, aliases…"></label><button type="button" class="control-source-filter" id="control-source-filter" hidden>Sources</button><a id="control-export" class="control-export" href="/api/control/export?format=csv">Export CSV</a><label class="control-import">Preview import<input id="control-import-input" type="file" accept="application/json" hidden></label></div><div class="control-layout"><section class="control-table" aria-label="Control records"><div class="control-header"><span>Identity</span><span>Kind</span><span>Status</span><span>Separate state axes</span></div><div id="control-records" class="control-records"></div></section><aside id="control-inspector" class="control-inspector" aria-live="polite"><div class="operate-empty"><strong>Select a record</strong><span>Inspect its provenance and evidence here.</span></div></aside></div></div>`;
  const state = root.querySelector("#control-state");
  const records = root.querySelector("#control-records");
  const inspector = root.querySelector("#control-inspector");
  const search = root.querySelector("#control-search");
  const exportLink = root.querySelector("#control-export");
  const sourceFilter = root.querySelector("#control-source-filter");
  let category = "systems";
  let current = [];
  const load = async () => {
    const params = new URLSearchParams({ category });
    if (search.value.trim()) params.set("q", search.value.trim());
    const response = await fetch(`/api/control/records?${params}`, { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Control is disabled");
    current = Array.isArray(data.records) ? data.records : [];
    records.innerHTML = current.length ? current.map(recordRow).join("") : `<div class="operate-empty"><strong>No records match.</strong><span>The control plane does not invent missing identities.</span></div>`;
    exportLink.href = `/api/control/export?format=csv&category=${encodeURIComponent(category)}${search.value.trim() ? `&q=${encodeURIComponent(search.value.trim())}` : ""}`;
    records.querySelectorAll(".control-row").forEach((row) => row.addEventListener("click", () => inspect(row.dataset.recordId)));
    const selected = new URLSearchParams(window.location.search).get("id");
    if (selected) inspect(selected, { updateUrl: false });
  };
  const inspect = async (id, { updateUrl = true } = {}) => {
    const item = current.find((record) => record.id === id);
    if (!item) return;
    if (updateUrl) window.history.pushState({ view: "control", stableId: id }, "", `/control?id=${encodeURIComponent(id)}`);
    records.querySelectorAll(".control-row").forEach((row) => row.classList.toggle("is-selected", row.dataset.recordId === id));
    const sourceHref = item.source_url || (item.source_locator && /^https?:/.test(item.source_locator) ? item.source_locator : "");
    inspector.innerHTML = `<div class="inspector-head"><span class="operate-kicker">${esc(item.kind || "record")}</span><h3>${esc(item.title || item.id)}</h3><code>${esc(item.id)}</code></div><dl class="inspector-facts"><div><dt>What it is</dt><dd>${esc(item.eli5 || "A declared identity with linked evidence.")}</dd></div><div><dt>Why it exists</dt><dd>${esc(item.why_it_exists || "To keep one canonical source of truth.")}</dd></div><div><dt>Benefits / trade-offs</dt><dd>${esc([...(item.benefits || []), ...(item.tradeoffs || [])].join(" · ") || "Unknown")}</dd></div><div><dt>Canonical source</dt><dd>${esc(item.source_locator || "Unknown")}</dd></div><div><dt>Source revision</dt><dd>${esc(item.source_revision || "Unknown")}</dd></div><div><dt>Separate state axes</dt><dd class="state-chips">${states(item.state_axes)}</dd></div><div><dt>Evidence</dt><dd>${esc((item.evidence_receipt_ids || []).join(" · ") || "Unknown")}</dd></div></dl><div class="inspector-actions"><a href="${esc(sourceHref || "#")}" ${sourceHref ? "target=\"_blank\" rel=\"noreferrer\"" : "aria-disabled=\"true\""}>Open canonical source ↗</a></div>`;
    const runtimeTarget = item.id === "service:frank-window" ? "frank" : item.id === "service:blockwise-app" ? "blockwise" : "";
    if (runtimeTarget) {
      try {
        const response = await fetch(`/api/control/runtime/${runtimeTarget}`);
        const data = await response.json();
        const summary = data.summary;
        const runtime = summary ? `<div class="runtime-fact"><dt>Runtime evidence</dt><dd><b>${esc(summary.health || "unknown")}</b> · ${esc(summary.freshness || "unknown")} · ${esc(summary.deployed_revision || "revision unknown")}${summary.evidence_url ? ` · <a href="${esc(summary.evidence_url)}" target="_blank" rel="noreferrer">Open full evidence ↗</a>` : ""}</dd></div>` : `<div class="runtime-fact"><dt>Runtime evidence</dt><dd>Unknown · monitoring is not available.</dd></div>`;
        inspector.querySelector(".inspector-facts")?.insertAdjacentHTML("beforeend", runtime);
      } catch {
        inspector.querySelector(".inspector-facts")?.insertAdjacentHTML("beforeend", `<div class="runtime-fact"><dt>Runtime evidence</dt><dd>Unknown · monitoring is not promoted.</dd></div>`);
      }
    }
  };
  root.querySelectorAll(".control-category").forEach((button) => button.addEventListener("click", () => { category = button.dataset.category; sourceFilter.hidden = category !== "capabilities"; root.querySelectorAll(".control-category").forEach((item) => item.classList.toggle("is-selected", item === button)); void load().catch(() => {}); }));
  sourceFilter.addEventListener("click", () => { category = "sources"; sourceFilter.hidden = false; void load().catch(() => {}); });
  search.addEventListener("input", () => { clearTimeout(search._timer); search._timer = setTimeout(() => void load().catch(() => {}), 180); });
  root.querySelector("#control-import-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { const value = JSON.parse(await file.text()); const response = await fetch("/api/control/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); const data = await response.json(); inspector.innerHTML = `<div class="operate-empty"><strong>Import preview</strong><span>${esc(data.message || "Preview only; no changes applied.")}</span></div>`; } catch { inspector.innerHTML = `<div class="operate-empty"><strong>Import preview failed</strong><span>Provide one valid JSON object with provenance.</span></div>`; }
  });
  try { const response = await fetch("/api/control/overview"); const data = await response.json(); if (!response.ok || !data.control || data.control.status === "disabled") throw new Error(); state.textContent = data.control.status === "ready" ? "Evidence-backed" : "Attention"; await load(); } catch { state.textContent = "Disabled by release flag"; records.innerHTML = `<div class="operate-empty"><strong>Control is not promoted in this release.</strong><span>Enable <code>control_read</code> only in the isolated Step 5 preview.</span></div>`; }
}
