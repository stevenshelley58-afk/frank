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
  id: "account-manager", title: "Accounts & access", surfaces: ["tool-catalog"],
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
  id: "connections", title: "Connections", surfaces: ["tool-catalog"],
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
  id: "campaigns", title: "Email flows", surfaces: ["tool-catalog"],
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
    surfaces: ["tool-catalog"],
    description: tool.description,
    mount(el) {
      const actions = toolIntro(el, tool.description);
      actionButton(actions, `Open ${tool.name.toLowerCase()}`, () => emit("frank:operations-tool", { id: tool.id, name: tool.name }));
      statusText(actions, isBlockwiseOperationsPreview() ? `Preview data · ${tool.provider}` : `Ready to connect · ${tool.provider}`);
    },
  });
}

define({
  id: "factory-ad", title: "Ad Template Generator", surfaces: ["tool-catalog"],
  description: "Run source images through the ad-template pipeline and inspect each job.",
  mount(el) {
    const actions = toolIntro(el, "Run one image or a batch, inspect the work, and request pipeline changes through Hermes.");
    actionButton(actions, "Open generator", () => emit("frank:ad-template-generator"));
    actionButton(actions, "Tool home", () => emit("frank:entity-home", { kind: "tool", id: "ad-template-generator", name: "Ad Template Generator" }), "tool-secondary");
    statusText(actions, "/frank/tools/ad-template-generator");
  },
});

define({
  id: "hermes-tool", title: "Hermes", surfaces: ["tool-catalog"],
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
  id: "widget-builder", title: "Widget Builder", surfaces: ["tool-catalog"],
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
const LAUNCH_PROVIDER_NAMES = Object.freeze({
  stalwart: "Stalwart inbound mail",
  mautic: "Mautic CRM",
  chatwoot: "Chatwoot inbox",
  ga4: "Google Analytics 4",
  clarity: "Microsoft Clarity",
});

function launchElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function launchStyles() {
  if (document.getElementById("launch-desk-styles")) return;
  const style = document.createElement("style");
  style.id = "launch-desk-styles";
  style.textContent = `
    .launch-tools-grid { grid-template-columns: minmax(0, 1080px); justify-content: center; padding: 24px; }
    .launch-tools-grid .w-card { padding: 0; overflow: auto; }
    .launch-tools-grid .w-card > h3 { display: none; }
    .launch-desk { padding: 28px; }
    .launch-desk-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
    .launch-desk-kicker { color: var(--mute); font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
    .launch-desk h2 { margin-top: 6px; color: var(--ink); font-size: 30px; font-weight: 500; letter-spacing: -.04em; }
    .launch-desk-head p { max-width: 590px; margin-top: 8px; color: var(--mute); font-size: 13px; line-height: 1.55; }
    .launch-desk-summary { flex: 0 0 auto; border: 1px solid var(--line); border-radius: var(--r-pill); padding: 8px 11px; color: var(--mute); font-size: 11px; white-space: nowrap; }
    .launch-desk-summary[data-tone="ready"], .launch-desk-status[data-tone="ready"] { color: var(--ok); }
    .launch-desk-summary[data-tone="blocked"], .launch-desk-status[data-tone="blocked"] { color: #87631e; }
    .launch-desk-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    .launch-desk-card { min-width: 0; min-height: 206px; padding: 17px; border: 1px solid var(--line); border-radius: var(--r); background: var(--card); }
    .launch-desk-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .launch-desk-card h3 { margin-top: 4px; color: var(--ink); font-size: 16px; font-weight: 500; letter-spacing: -.02em; }
    .launch-desk-card p { margin-top: 10px; color: var(--mute); font-size: 12px; line-height: 1.55; }
    .launch-desk-status { flex: 0 0 auto; border-radius: var(--r-pill); background: var(--chip); padding: 4px 7px; color: var(--mute); font-size: 10px; white-space: nowrap; }
    .launch-desk-provider-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
    .launch-desk-provider { border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px 7px; color: var(--mute); font-size: 10px; }
    .launch-desk-provider[data-state="ready"] { color: var(--ok); border-color: #dfece4; }
    .launch-desk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .launch-desk-actions .tool-link, .launch-desk-actions .tool-secondary { margin: 0; }
    .launch-desk-note { grid-column: 1 / -1; padding: 14px 17px; border-left: 2px solid var(--ink); color: var(--mute); font-size: 12px; line-height: 1.55; }
    @media (max-width: 760px) {
      .launch-tools-grid { padding: 14px; }
      .launch-desk { padding: 20px; }
      .launch-desk-head { align-items: flex-start; flex-direction: column; gap: 12px; }
      .launch-desk-grid { grid-template-columns: 1fr; }
      .launch-desk-note { grid-column: auto; }
    }`;
  document.head.append(style);
}

function launchProvider(readiness, id) {
  return (readiness.providers || []).find((item) => item.provider === id) || {
    provider: id, status: "unconfigured", verified: false, base_url: "",
  };
}

function launchProviderChip(provider) {
  const chip = launchElement("span", "launch-desk-provider", LAUNCH_PROVIDER_NAMES[provider.provider] || provider.provider);
  chip.dataset.state = provider.verified ? "ready" : provider.status || "unconfigured";
  chip.title = provider.verified ? "Verified" : provider.status === "configured" ? "Configured; verification is still required" : "Not configured";
  return chip;
}

function launchExternal(actions, label, url) {
  if (!url) return;
  const link = launchElement("a", "tool-link", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  actions.append(link);
}

function launchSetupAction(actions, label) {
  const button = launchElement("button", "tool-secondary", label);
  button.type = "button";
  button.addEventListener("click", () => emit("frank:connections"));
  actions.append(button);
}

function launchCard({ eyebrow, title, copy, providers, ready, blocker, links = [], setupLabel }) {
  const card = launchElement("section", "launch-desk-card");
  const top = launchElement("div", "launch-desk-card-top");
  const heading = launchElement("div");
  heading.append(launchElement("span", "launch-desk-kicker", eyebrow), launchElement("h3", "", title));
  const status = launchElement("span", "launch-desk-status", ready ? "Live" : "Blocked");
  status.dataset.tone = ready ? "ready" : "blocked";
  top.append(heading, status);
  card.append(top, launchElement("p", "", ready ? copy : blocker));
  const providerList = launchElement("div", "launch-desk-provider-list");
  providers.forEach((provider) => providerList.append(launchProviderChip(provider)));
  card.append(providerList);
  const actions = launchElement("div", "launch-desk-actions");
  links.forEach(([label, url]) => launchExternal(actions, label, url));
  if (!ready && setupLabel) launchSetupAction(actions, setupLabel);
  card.append(actions);
  return card;
}

function mountLaunchDesk(el) {
  launchStyles();
  el.closest(".grid")?.classList.add("launch-tools-grid");
  el.replaceChildren();

  const desk = launchElement("div", "launch-desk");
  const heading = launchElement("header", "launch-desk-head");
  const copy = launchElement("div");
  copy.append(
    launchElement("span", "launch-desk-kicker", "Blockwise - launch control"),
    launchElement("h2", "", "Launch the customer loop"),
    launchElement("p", "", "Use the native systems for customer records, conversations and campaigns. Frank shows only the setup state and the next safe move.")
  );
  const summary = launchElement("span", "launch-desk-summary", "Checking launch setup...");
  heading.append(copy, summary);
  const grid = launchElement("div", "launch-desk-grid");
  desk.append(heading, grid);
  el.append(desk);

  Promise.all([
    fetch("/api/providers/readiness").then((response) => response.ok ? response.json() : Promise.reject(new Error("provider readiness unavailable"))),
    fetch("/api/email-tools").then((response) => response.ok ? response.json() : Promise.reject(new Error("email tools unavailable"))),
  ]).then(([readiness, emailTools]) => {
    const chatwoot = launchProvider(readiness, "chatwoot");
    const stalwart = launchProvider(readiness, "stalwart");
    const mautic = launchProvider(readiness, "mautic");
    const ga4 = launchProvider(readiness, "ga4");
    const clarity = launchProvider(readiness, "clarity");
    const inboundReady = chatwoot.verified && stalwart.verified;
    const lifecycleReady = mautic.verified && stalwart.verified;
    const analyticsReady = ga4.verified && clarity.verified;
    const blockers = [inboundReady, lifecycleReady, analyticsReady].filter((ready) => !ready).length + 1;
    summary.textContent = `${blockers} launch blocker${blockers === 1 ? "" : "s"}`;
    summary.dataset.tone = "blocked";

    grid.replaceChildren(
      launchCard({
        eyebrow: "01 - captured email",
        title: "Inbox",
        copy: "New enquiries and replies are handled in the native inbox; Frank does not store a parallel conversation queue.",
        blocker: "Customer email is not live until both the Chatwoot inbox and Stalwart mail path are verified.",
        providers: [chatwoot, stalwart],
        ready: inboundReady,
        links: chatwoot.verified ? [["Open Chatwoot", chatwoot.base_url]] : [],
        setupLabel: "Record inbound setup",
      }),
      launchCard({
        eyebrow: "02 - CRM and follow-up",
        title: "Contacts & signup emails",
        copy: "Mautic owns contacts, consent-aware segments and lifecycle follow-up. Open the configured Mautic dashboard to work there.",
        blocker: "Captured-email follow-up is blocked until Mautic and the mail path are verified. A configured URL alone is not treated as live.",
        providers: [mautic, stalwart],
        ready: lifecycleReady,
        links: mautic.verified ? [["Open Mautic", emailTools.mautic?.url || mautic.base_url]] : [],
        setupLabel: "Record CRM setup",
      }),
      launchCard({
        eyebrow: "03 - cold outreach",
        title: "Draft first, approve before sending",
        copy: "Cold outreach has no active sending route here. Resend is excluded: its acceptable-use policy prohibits this use.",
        blocker: "A draft needs documented legal basis, approval, project and global suppression checks, quiet-hours and a suitable verified sender before any delivery request.",
        providers: [],
        ready: false,
      }),
      launchCard({
        eyebrow: "04 - measurement",
        title: "Website analytics",
        copy: "Use the native analytics dashboards for traffic, signup and behaviour evidence.",
        blocker: "Analytics is blocked until both GA4 and Microsoft Clarity are verified. Installed tags or dashboard URLs are not proof of collection.",
        providers: [ga4, clarity],
        ready: analyticsReady,
        links: [
          ...(ga4.verified ? [["Open GA4", "https://analytics.google.com/analytics/web/"]] : []),
          ...(clarity.verified ? [["Open Microsoft Clarity", "https://clarity.microsoft.com/"]] : []),
        ],
        setupLabel: "Record analytics setup",
      }),
      launchElement("p", "launch-desk-note", "Safety boundary: lifecycle messages and customer replies are distinct from cold outreach. No campaign is sent from Frank, and no legal-basis or suppression control is bypassed.")
    );
  }).catch(() => {
    summary.textContent = "Launch status unavailable";
    summary.dataset.tone = "blocked";
    grid.replaceChildren(launchElement("p", "launch-desk-note", "Provider readiness could not be read. No provider is assumed ready; refresh once the launch source is available."));
  });
}

define({
  id: "blockwise-launch-desk", title: "Blockwise launch", surfaces: ["tools"],
  description: "A factual launch checklist for Blockwise customer operations.",
  mount: mountLaunchDesk,
});
