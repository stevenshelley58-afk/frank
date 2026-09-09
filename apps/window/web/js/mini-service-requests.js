const STATUS_OPTIONS = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["closed", "Closed"],
];

function element(documentRef, tag, className = "", text = "") {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function errorMessage(response, body) {
  if (response.status === 401) return "Operator authentication expired. Reload Frank and sign in again.";
  if (response.status === 503) return "Mini service requests are unavailable. Check the Mini connection.";
  return body?.description || body?.error || body?.message || `Could not load service requests (HTTP ${response.status}).`;
}

function displayKind(value) {
  const words = String(value || "Service request").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function createMiniServiceRequestsPanel(host, options = {}) {
  const documentRef = options.documentRef || document;
  const fetchImpl = options.fetchImpl || fetch;
  const pollMs = options.pollMs || 30000;
  let active = false;
  let timer = null;
  let controller = null;
  let sequence = 0;

  host.replaceChildren();
  const heading = element(documentRef, "div", "mini-operator-heading");
  const titleWrap = element(documentRef, "div");
  const title = element(documentRef, "h3", "", "Service requests");
  title.id = "mini-service-requests-title";
  titleWrap.append(
    element(documentRef, "span", "project-dashboard-kicker", "Customer follow-up"),
    title,
    element(documentRef, "p", "", "People who asked Steven for optional paid help through Mini.")
  );
  const refresh = element(documentRef, "button", "project-dashboard-open", "Refresh");
  refresh.type = "button";
  refresh.dataset.miniOperatorRefresh = "true";
  heading.append(titleWrap, refresh);
  const status = element(documentRef, "p", "mini-operator-status", "Open Mini Frank to load requests.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = element(documentRef, "div", "mini-operator-list");
  host.append(heading, status, list);

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (active && documentRef.visibilityState !== "hidden") {
      timer = setTimeout(() => void load(), pollMs);
    }
  }

  function renderItems(items) {
    list.replaceChildren();
    if (!items.length) {
      list.append(element(documentRef, "p", "mini-operator-empty", "No service requests need follow-up."));
      return;
    }
    for (const item of items) {
      const request = item?.request || {};
      const contact = item?.contact || request.contact || {};
      const card = element(documentRef, "article", "mini-operator-card");
      card.dataset.requestId = String(request.id || "");
      const top = element(documentRef, "div", "mini-operator-card-head");
      const summary = element(documentRef, "div");
      summary.append(
        element(documentRef, "h4", "", displayKind(request.kind)),
        element(documentRef, "p", "mini-operator-contact", `${contact.method || "Contact"}: ${contact.value || "Not supplied"}`)
      );
      const select = element(documentRef, "select", "mini-operator-select");
      select.setAttribute("aria-label", `Status for ${displayKind(request.kind)}`);
      for (const [value, label] of STATUS_OPTIONS) {
        const option = element(documentRef, "option", "", label);
        option.value = value;
        select.append(option);
      }
      select.value = String(item.operator_status || request.operator_status || "new");
      top.append(summary, select);
      card.append(top);
      if (request.note) card.append(element(documentRef, "p", "mini-operator-note", String(request.note)));
      const acknowledgement = element(documentRef, "p", "mini-operator-ack");
      acknowledgement.setAttribute("aria-live", "polite");
      card.append(acknowledgement);
      select.addEventListener("change", async () => {
        const previous = String(item.operator_status || request.operator_status || "new");
        select.disabled = true;
        acknowledgement.textContent = "Saving&";
        try {
          const response = await fetchImpl(`/api/operator/mini/service-requests/${encodeURIComponent(request.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: select.value }),
          });
          let body = {};
          try { body = await response.json(); } catch {}
          if (!response.ok) throw new Error(errorMessage(response, body));
          item.operator_status = select.value;
          acknowledgement.textContent = `Saved as ${select.options[select.selectedIndex].text}.`;
        } catch (error) {
          select.value = previous;
          acknowledgement.textContent = error?.message || "Could not confirm the update. Refresh before retrying.";
        } finally {
          select.disabled = false;
        }
      });
      list.append(card);
    }
  }

  async function load() {
    if (!active || documentRef.visibilityState === "hidden") return;
    if (controller) controller.abort();
    controller = new AbortController();
    const requestSequence = ++sequence;
    refresh.disabled = true;
    status.textContent = "Refreshing service requests&";
    try {
      const response = await fetchImpl("/api/operator/mini/service-requests", { signal: controller.signal });
      let body = {};
      try { body = await response.json(); } catch {}
      if (!response.ok) throw new Error(errorMessage(response, body));
      if (requestSequence !== sequence) return;
      const items = Array.isArray(body.requests) ? body.requests : [];
      renderItems(items);
      status.textContent = `${items.length} service request${items.length === 1 ? "" : "s"} | refreshes every 30 seconds while visible.`;
    } catch (error) {
      if (error?.name === "AbortError" || requestSequence !== sequence) return;
      list.replaceChildren(element(documentRef, "p", "mini-operator-error", error?.message || "Could not load service requests."));
      status.textContent = "Service request status is unavailable.";
    } finally {
      if (requestSequence === sequence) {
        refresh.disabled = false;
        controller = null;
        schedule();
      }
    }
  }

  function setActive(value) {
    active = Boolean(value);
    host.hidden = !active;
    if (!active) {
      sequence += 1;
      if (controller) controller.abort();
      if (timer) clearTimeout(timer);
      timer = null;
      return;
    }
    void load();
  }

  refresh.addEventListener("click", () => void load());
  documentRef.addEventListener?.("visibilitychange", () => {
    if (documentRef.visibilityState === "hidden") {
      if (timer) clearTimeout(timer);
      timer = null;
    } else if (active) {
      void load();
    }
  });

  return { setActive, refresh: load };
}
