const tabs = [
  ["account", "Account"], ["email", "Email"], ["flows", "Flows"], ["mautic", "CRM"], ["enquiries", "Enquiries"],
  ["bookings", "Bookings"], ["billing", "Billing"], ["activity", "Activity"],
];

const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const label = (value) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const formatTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

function statusClass(value) {
  return `ops-status ops-status-${String(value || "unknown").replace(/[^a-z0-9_-]/gi, "-")}`;
}

function stateBadge(value) {
  return `<span class="${statusClass(value)}">${esc(label(value || "unknown"))}</span>`;
}

function emptyState(title, message, className = "") {
  return `<div class="ops-empty ${className}"><strong>${esc(title)}</strong><span>${esc(message)}</span></div>`;
}

function fields(row) {
  const skip = new Set(["id", "customer_id"]);
  return Object.entries(row || {}).filter(([key, value]) => !skip.has(key) && value !== null && value !== "" && typeof value !== "object")
    .slice(0, 8).map(([key, value]) => `<div><dt>${esc(label(key))}</dt><dd>${esc(value)}</dd></div>`).join("");
}

function sectionRows(rows, name, state = "ready") {
  if (state === "error") return emptyState(`${label(name)} is unavailable`, "Hermes published an invalid projection; Frank will not display it.", "ops-empty-error");
  if (state === "stale") return emptyState(`${label(name)} is stale`, "The last Hermes snapshot is outside its freshness window. Verify before acting.", "ops-empty-stale");
  if (state === "setup_needed") return emptyState(`${label(name)} needs setup`, "Hermes has not published this projection yet.", "ops-empty-setup");
  if (!Array.isArray(rows) || !rows.length) return emptyState(`No ${label(name)} recorded`, "Hermes has not published an item for this customer.");
  return `<div class="ops-record-list">${rows.slice(0, 30).map((row) => `<article class="ops-record"><div class="ops-record-head"><strong>${esc(row.title || row.name || row.subject || row.service || row.id || label(name))}</strong>${stateBadge(row.status || row.stage || "recorded")}</div><dl>${fields(row)}</dl></article>`).join("")}</div>`;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  let body = {};
  try { body = await response.json(); } catch { /* the shell renders an error state */ }
  if (!response.ok && !body.status) throw new Error(body.message || body.error || `Request failed (${response.status})`);
  return body;
}

export async function mountOps(root) {
  if (!root) return;
  root.innerHTML = `<div class="ops-surface"><header class="ops-heading"><div><span class="ops-kicker">Blockwise · customer operations</span><h2>Customer signal</h2><p>Read-only projections from Hermes. Provider credentials and direct mutations stay outside Frank.</p></div><div class="ops-heading-actions"><span id="ops-overall" class="${statusClass("setup_needed")}">Checking source…</span><button id="ops-refresh" class="ops-button ops-button-primary" type="button" disabled title="No reviewed Hermes ops-refresh action is configured">Refresh unavailable</button></div></header><div id="ops-notice" class="ops-notice" aria-live="polite"></div><section class="ops-unassigned" aria-labelledby="ops-unassigned-title"><div class="ops-list-heading"><h3 id="ops-unassigned-title">Unassigned enquiries</h3><span id="ops-unassigned-count"></span></div><div id="ops-unassigned-list">${emptyState("Checking queue", "Reading the Hermes-published enquiry queue…")}</div></section><div class="ops-layout"><aside class="ops-customers"><div class="ops-list-heading"><strong>Customers</strong><span id="ops-count"></span></div><label class="ops-search"><span class="sr-only">Search customers</span><input id="ops-search" type="search" placeholder="Search name or email"></label><div id="ops-customer-list"></div></aside><main class="ops-detail" id="ops-detail" aria-live="polite">${emptyState("Select a customer", "Customer details, provider status, and receipts appear here.")}</main></div></div>`;
  const overall = root.querySelector("#ops-overall");
  const notice = root.querySelector("#ops-notice");
  const list = root.querySelector("#ops-customer-list");
  const detail = root.querySelector("#ops-detail");
  const count = root.querySelector("#ops-count");
  const unassignedList = root.querySelector("#ops-unassigned-list");
  const unassignedCount = root.querySelector("#ops-unassigned-count");
  const search = root.querySelector("#ops-search");
  let customers = [];
  let selectedId = "";

  function renderUnassigned(body) {
    const state = body?.status || "setup_needed";
    const rows = Array.isArray(body?.enquiries) ? body.enquiries : [];
    unassignedCount.textContent = state === "ready" || state === "stale" ? `${rows.length} queue` : "";
    unassignedList.innerHTML = sectionRows(rows, "unassigned enquiries", state);
  }

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const shown = customers.filter((row) => !query || [row.display_name, row.name, row.email, row.company, row.id].some((value) => String(value || "").toLowerCase().includes(query)));
    count.textContent = `${shown.length} of ${customers.length}`;
    if (!shown.length) { list.innerHTML = customers.length ? emptyState("No matches", "Try a different customer name or email.") : emptyState("Customer data is not connected", "Hermes has not published the customer summary projection yet.", "ops-empty-setup"); return; }
    list.innerHTML = shown.map((row) => `<button type="button" class="ops-customer ${row.id === selectedId ? "is-selected" : ""}" data-id="${esc(row.id)}"><span class="ops-avatar">${esc(String(row.display_name || row.name || "?").trim().slice(0, 1).toUpperCase())}</span><span class="ops-customer-copy"><strong>${esc(row.display_name || row.name || row.id)}</strong><small>${esc(row.email_masked || row.email || row.company || "Customer")}</small></span>${stateBadge(row.status || row.lifecycle || "recorded")}</button>`).join("");
    list.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => select(button.dataset.id)));
  }

  function renderDetail(body) {
    const customer = body.customer;
    const sections = body.sections || {};
    const projectionState = body.projections || {};
    const retainedReceipts = [...(Array.isArray(body.action_receipts) ? body.action_receipts : [])]
      .filter((receipt, index, values) => receipt && values.findIndex((candidate) => candidate?.receipt_id === receipt.receipt_id) === index);
    detail.innerHTML = `<div class="ops-detail-heading"><div><span class="ops-kicker">Customer account</span><h2>${esc(customer.display_name || customer.name || customer.id)}</h2><p>${esc(customer.email_masked || customer.email || customer.company || "Safe customer summary")}</p></div><div>${stateBadge(customer.status || customer.lifecycle || "recorded")}</div></div><nav class="ops-tabs" role="tablist" aria-label="Customer operations sections">${tabs.map(([id, text], index) => `<button id="ops-tab-${id}" type="button" role="tab" tabindex="${index === 0 ? "0" : "-1"}" aria-selected="${index === 0}" aria-controls="ops-panel-${id}" class="ops-tab ${index === 0 ? "is-selected" : ""}" data-tab="${id}">${text}</button>`).join("")}</nav><div class="ops-tab-panels"><section id="ops-panel-account" class="ops-panel is-selected" role="tabpanel" tabindex="0" aria-labelledby="ops-tab-account" data-panel="account"><div class="ops-facts"><dl>${fields(customer)}</dl></div>${sectionRows(sections.members, "members", projectionState.members?.status || "setup_needed")}<div class="ops-receipt-note">Identity and access are directory metadata only. No password, token, card, or provider credential is displayed.</div></section>${tabs.slice(1).map(([id]) => `<section id="ops-panel-${id}" class="ops-panel" role="tabpanel" tabindex="0" aria-labelledby="ops-tab-${id}" data-panel="${id}">${sectionRows(sections[id], id, projectionState[id]?.status || "setup_needed")}${id === "activity" && retainedReceipts.length ? `<div class="ops-action-receipts"><strong>Frank action receipts</strong>${retainedReceipts.map((receipt) => `<div><code>${esc(receipt.receipt_id || "preview")}</code><span>${esc(receipt.status || "accepted")}</span></div>`).join("")}</div>` : ""}</section>`).join("")}</div>`;
    const activate = (button, focus = false) => {
      detail.querySelectorAll(".ops-tab").forEach((item) => item.classList.toggle("is-selected", item === button));
      detail.querySelectorAll(".ops-panel").forEach((panel) => panel.classList.toggle("is-selected", panel.dataset.panel === button.dataset.tab));
      detail.querySelectorAll(".ops-tab").forEach((item) => { const selected = item === button; item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1; });
      if (focus) button.focus();
    };
    detail.querySelectorAll(".ops-tab").forEach((button, index, buttons) => {
      button.addEventListener("click", () => activate(button));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        activate(buttons[next], true);
      });
    });
  }

  async function select(id) {
    selectedId = id;
    renderList();
    detail.innerHTML = emptyState("Loading customer", "Reading Hermes projections…");
    try { renderDetail(await getJson(`/api/ops/customers/${encodeURIComponent(id)}`)); }
    catch (error) { detail.innerHTML = emptyState("Customer detail unavailable", error.message || "Try again shortly.", "ops-empty-error"); }
  }

  async function load() {
    overall.textContent = "Checking source…";
    overall.className = statusClass("setup_needed");
    try {
      const [body, queue] = await Promise.all([getJson("/api/ops/overview"), getJson("/api/ops/enquiries/unassigned")]);
      renderUnassigned(queue);
      customers = Array.isArray(body.customers) ? body.customers : [];
      overall.textContent = label(body.status || "setup_needed");
      overall.className = statusClass(body.status || "setup_needed");
      notice.textContent = body.status === "ready" ? "Last published state is available." : (body.status === "stale" ? "Projection is stale; verify before acting." : "Setup is needed: Hermes has not published every projection yet.");
      renderList();
      if (selectedId && customers.some((row) => row.id === selectedId)) await select(selectedId);
    } catch (error) {
      customers = [];
      renderUnassigned({ status: "error", enquiries: [], message: error.message || "The enquiry queue is unavailable." });
      overall.textContent = "Error";
      overall.className = statusClass("error");
      notice.textContent = error.message || "The projection source is unavailable.";
      renderList();
      detail.innerHTML = emptyState("Ops source unavailable", "Frank will not invent customer state when Hermes cannot be reached.", "ops-empty-error");
    }
  }

  search.addEventListener("input", renderList);
  notice.textContent = "Ops refresh is unavailable until a reviewed Hermes action is configured.";
  await load();
}
