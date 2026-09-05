import { define } from "./registry.js";
import { isBlockwiseOperationsPreview } from "./blockwise-operations-preview.js";
import { OPERATIONS_TOOLS } from "./operations-tools.js";

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
  id: "account-manager", title: "Accounts & access", surfaces: ["tools"],
  description: "Authentication, roles, and service-account records.",
  mount(el) {
    const actions = toolIntro(el, "Manage access, workspace roles, authentication state, and service identities without duplicating the customer CRM.");
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
  id: "campaigns", title: "Email flows", surfaces: ["tools"],
  description: "Lifecycle messages, audiences, consent, and delivery health.",
  mount(el) {
    const actions = toolIntro(el, "Mautic owns campaigns and audiences. Stalwart is the open-source sending path.");
    actionButton(actions, "Open email flows", () => emit("frank:operations-tool", { id: "email-flows", name: "Email flows" }));
    const state = statusText(actions, "Checking setup…");
    if (isBlockwiseOperationsPreview()) {
      state.textContent = "Preview data · Mautic + Stalwart";
      return;
    }
    Promise.all([
      fetch("/api/email-tools").then((response) => response.ok ? response.json() : Promise.reject(new Error("email tools unavailable"))),
      fetch("/api/connections").then((response) => response.ok ? response.json() : Promise.reject(new Error("connections unavailable"))),
    ])
      .then(([data, connectionData]) => {
        const mautic = data.mautic || {};
        const stalwart = (connectionData.connections || []).find((item) => item.provider === "stalwart") || {};
        if (mautic.status !== "unconfigured" && String(mautic.url || "").startsWith("https://")) actionLink(actions, "Open Mautic", mautic.url);
        const statusLabel = (value) => ({ ready: "ready", verified: "verified", configured: "configured", error: "needs attention" })[value] || "setup needed";
        state.textContent = `Mautic ${statusLabel(mautic.status)} · Stalwart ${statusLabel(stalwart.status)}`;
      })
      .catch(() => { state.textContent = "Setup status unavailable"; });
  },
});

for (const tool of OPERATIONS_TOOLS.filter((item) => !["email-flows", "connections"].includes(item.id))) {
  define({
    id: `operations-${tool.id}`,
    title: tool.name,
    surfaces: ["tools"],
    description: tool.description,
    mount(el) {
      const actions = toolIntro(el, tool.description);
      actionButton(actions, `Open ${tool.name.toLowerCase()}`, () => emit("frank:operations-tool", { id: tool.id, name: tool.name }));
      statusText(actions, isBlockwiseOperationsPreview() ? `Preview data · ${tool.provider}` : `Ready to connect · ${tool.provider}`);
    },
  });
}

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
