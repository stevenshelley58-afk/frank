import { define } from "./registry.js";

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function toolIntro(el, copy) {
  const paragraph = document.createElement("p");
  paragraph.textContent = copy;
  const actions = document.createElement("div");
  actions.className = "tool-actions";
  el.append(paragraph, actions);
  return actions;
}

function actionButton(actions, label, handler, className = "tool-open") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  actions.append(button);
  return button;
}

function actionLink(actions, label, url) {
  const link = document.createElement("a");
  link.className = "tool-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  actions.append(link);
}

function statusText(actions, text = "Loading…") {
  const state = document.createElement("span");
  state.className = "tool-state";
  state.textContent = text;
  actions.append(state);
  return state;
}

define({
  id: "overnight", title: "Overnight", surfaces: ["hub"],
  description: "Last-night activity reported by connected providers.",
  mount(el) {
    const list = document.createElement("ul");
    list.className = "rows";
    for (const text of ["No overnight provider connected", "Nothing failed silently"]) {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    }
    el.append(list);
  },
});

define({
  id: "waiting", title: "Waiting on you", surfaces: ["hub"],
  description: "Items awaiting an owner decision.",
  mount(el) {
    const text = document.createElement("p");
    text.className = "quiet";
    text.textContent = "Nothing waiting.";
    el.append(text);
  },
});

define({
  id: "running", title: "Running", surfaces: ["hub"],
  description: "Work currently executing through Hermes.",
  mount(el) {
    const text = document.createElement("p");
    text.className = "quiet";
    text.textContent = "Nothing running.";
    el.append(text);
  },
});

define({
  id: "account-manager", title: "Accounts", surfaces: ["tools"],
  description: "Customer and service-account directory.",
  mount(el) {
    const actions = toolIntro(el, "Customer directory with recorded auth and billing state. Provider actions connect through Hermes later.");
    actionButton(actions, "Open accounts", () => emit("frank:view", "accounts"));
    actionButton(actions, "Home", () => emit("frank:entity-home", { kind: "tool", id: "accounts", name: "Accounts" }), "tool-secondary");
    const state = statusText(actions);
    fetch("/api/accounts")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("accounts unavailable")))
      .then((data) => {
        const count = data.accounts?.length || 0;
        const customers = (data.accounts || []).filter((account) => account.kind === "customer").length;
        state.textContent = count ? `${customers} customer${customers === 1 ? "" : "s"} · ${count} total` : "No accounts yet";
      })
      .catch(() => { state.textContent = "Unavailable"; });
  },
});

define({
  id: "connections", title: "Connections", surfaces: ["tools"],
  description: "Provider catalog and non-secret connection metadata.",
  mount(el) {
    const actions = toolIntro(el, "One place to see provider setup, recorded health, capabilities, and secure connection references.");
    actionButton(actions, "Open home", () => emit("frank:entity-home", { kind: "tool", id: "connections", name: "Connections" }));
    actionButton(actions, "Manage", () => emit("frank:connections"), "tool-secondary");
    const state = statusText(actions);
    fetch("/api/connections")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("connections unavailable")))
      .then((data) => {
        const items = data.connections || [];
        const attention = items.filter((item) => item.status === "setup_needed" || item.status === "error").length;
        state.textContent = items.length ? `${items.length} recorded · ${attention} need attention` : "No connections yet";
      })
      .catch(() => { state.textContent = "Unavailable"; });
  },
});

define({
  id: "campaigns", title: "Campaigns · Mautic", surfaces: ["tools"],
  description: "Campaign and audience control surface.",
  mount(el) {
    const actions = toolIntro(el, "Mautic owns campaigns and audiences. Resend is the selected delivery provider.");
    actionButton(actions, "Home", () => emit("frank:entity-home", { kind: "tool", id: "campaigns", name: "Campaigns" }));
    const state = statusText(actions, "Checking setup…");
    fetch("/api/email-tools")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("email tools unavailable")))
      .then((data) => {
        const mautic = data.mautic || {};
        const resend = data.resend || {};
        if (mautic.status !== "unconfigured" && String(mautic.url || "").startsWith("https://")) actionLink(actions, "Open Mautic", mautic.url);
        const statusLabel = (status) => ({ ready: "ready", configured: "configured", error: "needs attention" })[status] || "setup needed";
        state.textContent = `Mautic ${statusLabel(mautic.status)} · Resend ${statusLabel(resend.status)}`;
      })
      .catch(() => { state.textContent = "Setup status unavailable"; });
  },
});

define({
  id: "factory-ad", title: "Ad Studio", surfaces: ["tools"],
  description: "Run source images through the ad-template pipeline and inspect each job.",
  mount(el) {
    const actions = toolIntro(el, "Run one image or a batch, inspect the work, and request pipeline changes through Hermes.");
    actionButton(actions, "Open studio", () => emit("frank:ad-studio"));
    actionButton(actions, "Tool home", () => emit("frank:entity-home", { kind: "tool", id: "ad-template-generator", name: "Ad Studio" }), "tool-secondary");
    statusText(actions, "/frank/tools/ad-template-generator");
  },
});

define({
  id: "ad-radar", title: "Ad Radar", surfaces: ["tools"],
  description: "Observe public creative changes, verify evidence, compare patterns, and control durable research runs.",
  mount(el) {
    const actions = toolIntro(el, "Timeline, creative library, media QA, quarantine recovery, and immutable releases. Hermes owns every run.");
    actionButton(actions, "Open Ad Radar", () => emit("frank:ad-radar"));
    actionButton(actions, "Tool home", () => emit("frank:entity-home", { kind: "tool", id: "ad-intelligence", name: "Ad Radar" }), "tool-secondary");
    statusText(actions, "/frank/tools/ad-intelligence");
  },
});

define({
  id: "hermes-tool", title: "Hermes", surfaces: ["tools"],
  description: "Home for the sole Frank brain.",
  mount(el) {
    const actions = toolIntro(el, "Hermes owns reasoning, tools, skills, memory, model choice, and execution.");
    actionButton(actions, "Open home", () => emit("frank:entity-home", { kind: "agent", id: "hermes", name: "Hermes" }));
    const state = statusText(actions, "Checking…");
    fetch("/api/health")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("health unavailable")))
      .then((data) => { state.textContent = data.hermes?.ok ? "Reachable" : "Unavailable"; })
      .catch(() => { state.textContent = "Unavailable"; });
  },
});

define({
  id: "widget-builder", title: "Widget Builder", surfaces: ["tools"],
  description: "Create and manage safe reusable display widgets.",
  mount(el) {
    const actions = toolIntro(el, "Create reusable note and link widgets, then place them on any appropriate home.");
    actionButton(actions, "Open builder", () => emit("frank:widget-builder"));
    actionButton(actions, "Home", () => emit("frank:entity-home", { kind: "tool", id: "widget-builder", name: "Widget Builder" }), "tool-secondary");
    const state = statusText(actions);
    fetch("/api/widgets")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("catalog unavailable")))
      .then((data) => {
        const custom = (data.widgets || []).filter((widget) => widget.custom).length;
        state.textContent = `${data.widgets?.length || 0} registered · ${custom} custom`;
      })
      .catch(() => { state.textContent = "Unavailable"; });
  },
});

define({
  id: "trace-view", title: "Last run", surfaces: ["trace"],
  mount(el) {
    const text = document.createElement("p");
    text.className = "quiet";
    text.textContent = "No factory run yet. The flow, artefact and coloured prompt land here.";
    el.append(text);
  },
});

define({
  id: "releases", title: "Releases", surfaces: ["releases"],
  mount(el) {
    const text = document.createElement("p");
    text.className = "quiet";
    text.textContent = "Nothing signed yet. Signed provider releases will appear here.";
    el.append(text);
  },
});
