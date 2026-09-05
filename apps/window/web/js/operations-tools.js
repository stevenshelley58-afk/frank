export const OPERATIONS_TOOLS = Object.freeze([
  {
    id: "inbox",
    name: "Inbox",
    provider: "Chatwoot + Stalwart",
    description: "One queue for website enquiries, support conversations, and customer email.",
    primaryAction: "Compose email",
    metrics: [["6", "Unread"], ["2", "Need reply"], ["38 min", "Average reply"]],
    items: [
      { title: "Website pricing enquiry", meta: "Priya N. · 8 minutes ago", status: "Needs reply", detail: "Asked whether a three-person agency can start on the Team plan." },
      { title: "Trial setup question", meta: "Northline Property · 24 minutes ago", status: "Open", detail: "Needs help connecting the first Meta ad account." },
      { title: "Your campaign is ready", meta: "Blockwise system · 1 hour ago", status: "Sent", detail: "Transactional delivery receipt recorded for the launch confirmation." },
      { title: "Billing receipt", meta: "Willow & Co · Yesterday", status: "Closed", detail: "Customer confirmed the invoice address change." },
    ],
  },
  {
    id: "calendar",
    name: "Calendar",
    provider: "SnagTime native calendar",
    description: "SnagTime bookings, availability, reschedules, and cancellations in one calendar.",
    primaryAction: "New booking",
    metrics: [["3", "Today"], ["11", "This week"], ["10:30", "Next booking"]],
    items: [
      { title: "10:30 · Onboarding", meta: "Northline Property · 45 minutes", status: "Confirmed", detail: "Phone call · First workspace and ad account setup." },
      { title: "13:00 · Product demo", meta: "Amelia Stone · 30 minutes", status: "Confirmed", detail: "New website lead assigned to Steven." },
      { title: "15:30 · Account review", meta: "Willow & Co · 30 minutes", status: "Needs notes", detail: "Quarterly results and renewal discussion." },
      { title: "Tomorrow · 09:00", meta: "Open availability · 2 hours", status: "Available", detail: "Bookable through the Blockwise website." },
    ],
  },
  {
    id: "notifications",
    name: "Notifications",
    provider: "Frank events",
    description: "Important customer, delivery, billing, and system events—without inbox noise.",
    primaryAction: "Mark all reviewed",
    metrics: [["4", "New"], ["2", "Need action"], ["0", "System failures"]],
    items: [
      { title: "Payment needs attention", meta: "Harbour Realty · 12 minutes ago", status: "Action", detail: "The latest renewal payment failed. Customer access is still active." },
      { title: "New website enquiry", meta: "Assigned to Steven · 18 minutes ago", status: "New", detail: "A buyer's agent requested a Team plan demo." },
      { title: "Onboarding flow paused", meta: "Northline Property · 42 minutes ago", status: "Review", detail: "The customer replied, so automated follow-up paused." },
      { title: "Calendar connected", meta: "SnagTime · Today", status: "Healthy", detail: "Native booking availability and receipts are current." },
    ],
  },
  {
    id: "customers",
    name: "Customers",
    provider: "Blockwise + Mautic",
    description: "Accounts, access, lifecycle, consent, conversations, bookings, and billing.",
    primaryAction: "Add customer",
    metrics: [["128", "Customers"], ["7", "Trials"], ["2", "Need attention"]],
    items: [
      { title: "Northline Property", meta: "Trial · 5 days left", status: "Onboarding", detail: "3 members · first campaign draft ready · booking today at 10:30." },
      { title: "Willow & Co", meta: "Team plan · A$299/month", status: "Active", detail: "5 members · healthy billing · last active 16 minutes ago." },
      { title: "Harbour Realty", meta: "Team plan · payment retry", status: "Attention", detail: "Access remains active while the payment recovery flow runs." },
      { title: "Stone Buyers Agency", meta: "Trial · invited today", status: "Invited", detail: "Owner invite sent; no workspace activity recorded yet." },
    ],
  },
  {
    id: "email-flows",
    name: "Email flows",
    provider: "Mautic + Stalwart",
    description: "Transactional messages, lifecycle journeys, audiences, consent, and delivery health.",
    primaryAction: "Create flow",
    metrics: [["3", "Live flows"], ["62%", "Onboarding complete"], ["99.4%", "Delivered"]],
    items: [
      { title: "New customer onboarding", meta: "6 messages · 43 customers", status: "Live", detail: "Starts at signup and pauses automatically when a customer replies." },
      { title: "Trial ending", meta: "3 messages · 7 customers", status: "Live", detail: "Sends on days 10, 12, and 13 when consent and suppression checks pass." },
      { title: "Booking confirmations", meta: "Transactional · 11 this week", status: "Live", detail: "Confirmation, reminder, reschedule, and cancellation messages." },
      { title: "Product updates", meta: "Draft · audience not selected", status: "Draft", detail: "No messages can send until an audience and consent rule are approved." },
    ],
  },
  {
    id: "billing",
    name: "Billing",
    provider: "Stripe",
    description: "Subscriptions, trials, invoices, payment recovery, and billing portal access.",
    primaryAction: "Open billing report",
    metrics: [["A$18.4k", "Monthly revenue"], ["121", "Paying accounts"], ["2", "Payment issues"]],
    items: [
      { title: "Harbour Realty", meta: "A$299 · retry tomorrow", status: "Past due", detail: "One failed attempt. Customer access is unchanged." },
      { title: "Northline Property", meta: "Trial converts 10 Sep", status: "Trial", detail: "Team plan selected; payment method is present." },
      { title: "Willow & Co", meta: "A$299 · paid 1 Sep", status: "Active", detail: "Next invoice is scheduled for 1 October." },
      { title: "August revenue", meta: "A$17,860 collected", status: "Settled", detail: "No unresolved invoice reconciliation items." },
    ],
  },
  {
    id: "analytics",
    name: "Analytics",
    provider: "Umami",
    description: "Website traffic, signup conversion, activation, and customer growth in one report.",
    primaryAction: "Open full report",
    metrics: [["2,846", "Visitors"], ["4.6%", "Signup rate"], ["71%", "Activated"]],
    items: [
      { title: "Website → signup", meta: "131 signups from 2,846 visitors", status: "+12%", detail: "Conversion improved compared with the previous 30 days." },
      { title: "Signup → first campaign", meta: "93 activated customers", status: "71%", detail: "Median time to first campaign is 18 minutes." },
      { title: "Top acquisition source", meta: "Organic search · 38%", status: "Leading", detail: "Brand and real-estate ad template searches drive the most qualified visits." },
      { title: "Support load", meta: "0.18 enquiries per active account", status: "Healthy", detail: "Setup questions remain the most common first-week enquiry." },
    ],
  },
  {
    id: "connections",
    name: "Connections",
    provider: "Frank connection registry",
    description: "The single place for provider setup, capability checks, and connection health.",
    primaryAction: "Manage connections",
    metrics: [["7", "Connected"], ["7", "Verified"], ["0", "Need attention"]],
    items: [
      { title: "Stalwart", meta: "Transactional email", status: "Verified", detail: "Sending identity, delivery receipts, and suppression events are available." },
      { title: "Chatwoot", meta: "Inbox and enquiries", status: "Verified", detail: "Website conversations and support replies are available." },
      { title: "Mautic", meta: "CRM and email flows", status: "Verified", detail: "Contacts, segments, campaigns, and flow actions are available." },
      { title: "SnagTime", meta: "Booking calendar", status: "Verified", detail: "Availability, bookings, reschedules, and cancellations are available." },
    ],
  },
]);

export function operationsTool(id) {
  return OPERATIONS_TOOLS.find((tool) => tool.id === id) || null;
}

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function status(text) {
  return node("span", "operations-tool-status", text);
}

function previewNotice(host, message) {
  host.textContent = message;
  window.clearTimeout(host._clearTimer);
  host._clearTimer = window.setTimeout(() => {
    host.textContent = "Preview only · no action has been taken.";
  }, 4000);
}

function renderDetail(host, item) {
  host.replaceChildren();
  host.append(node("span", "operations-tool-detail-label", "Selected item"));
  host.append(node("h3", "", item.title));
  host.append(status(item.status));
  host.append(node("p", "operations-tool-detail-copy", item.detail));
  const facts = node("dl", "operations-tool-detail-facts");
  const time = node("div");
  time.append(node("dt", "", "Context"), node("dd", "", item.meta));
  const source = node("div");
  source.append(node("dt", "", "Source"), node("dd", "", "Shared Blockwise operations record"));
  facts.append(time, source);
  host.append(facts);
  const action = node("button", "operations-tool-secondary", "Open record");
  action.type = "button";
  action.addEventListener("click", () => {
    const notice = host.closest(".operations-tool-surface")?.querySelector("[data-operations-notice]");
    if (notice) previewNotice(notice, `Preview only · ${item.title} would open its connected record.`);
  });
  host.append(action);
}

export function mountOperationsTool(root, toolId, { preview = false } = {}) {
  if (!root) return;
  const tool = operationsTool(toolId);
  root.replaceChildren();
  if (!tool) {
    root.append(node("p", "home-error", "This operations tool is not registered."));
    return;
  }

  const surface = node("div", "operations-tool-surface");
  const heading = node("header", "operations-tool-heading");
  const title = node("div", "operations-tool-title");
  title.append(node("h2", "", tool.name), node("p", "", tool.description));
  const headingActions = node("div", "operations-tool-heading-actions");
  if (preview) headingActions.append(node("span", "operations-preview-badge", "Preview data"));
  const back = node("button", "operations-tool-secondary", "Back to Blockwise");
  back.type = "button";
  back.addEventListener("click", () => window.dispatchEvent(new CustomEvent("frank:project-home", { detail: "blockwise" })));
  headingActions.append(back);
  heading.append(title, headingActions);
  surface.append(heading);

  const notice = node("p", "operations-tool-notice", preview
    ? "Preview only · no action has been taken."
    : `${tool.name} is ready for its live data adapter.`);
  notice.dataset.operationsNotice = "";
  notice.setAttribute("aria-live", "polite");
  surface.append(notice);

  if (!preview) {
    const setup = node("section", "operations-tool-setup");
    setup.append(node("h3", "", `${tool.name} is not connected yet`));
    setup.append(node("p", "", `Connect ${tool.provider} through the shared Connections tool. This screen will then use that provider state without creating another record store.`));
    const connect = node("button", "operations-tool-primary", "Open connections");
    connect.type = "button";
    connect.addEventListener("click", () => window.dispatchEvent(new CustomEvent("frank:connections")));
    setup.append(connect);
    surface.append(setup);
    root.append(surface);
    return;
  }

  const metrics = node("section", "operations-tool-metrics");
  metrics.setAttribute("aria-label", `${tool.name} summary`);
  tool.metrics.forEach(([value, label]) => {
    const metric = node("div");
    metric.append(node("strong", "", value), node("span", "", label));
    metrics.append(metric);
  });
  const primary = node("button", "operations-tool-primary", tool.primaryAction);
  primary.type = "button";
  primary.addEventListener("click", () => previewNotice(notice, `Preview only · ${tool.primaryAction} will use the connected ${tool.name.toLowerCase()} workflow.`));
  metrics.append(primary);
  surface.append(metrics);

  const layout = node("div", "operations-tool-layout");
  const listPanel = node("section", "operations-tool-list-panel");
  const listHeading = node("div", "operations-tool-list-heading");
  listHeading.append(node("h3", "", toolId === "calendar" ? "Schedule" : "Recent"), node("span", "", `${tool.items.length} shown`));
  const searchLabel = node("label", "operations-tool-search");
  searchLabel.append(node("span", "sr-only", `Search ${tool.name.toLowerCase()}`));
  const search = node("input");
  search.type = "search";
  search.placeholder = `Search ${tool.name.toLowerCase()}`;
  searchLabel.append(search);
  const list = node("div", "operations-tool-list");
  listPanel.append(listHeading, searchLabel, list);
  const detail = node("aside", "operations-tool-detail");
  detail.setAttribute("aria-live", "polite");
  layout.append(listPanel, detail);
  surface.append(layout);
  root.append(surface);

  let selected = tool.items[0];
  const renderList = () => {
    const query = search.value.trim().toLowerCase();
    const items = tool.items.filter((item) => !query || `${item.title} ${item.meta} ${item.status}`.toLowerCase().includes(query));
    list.replaceChildren();
    items.forEach((item) => {
      const row = node("button", `operations-tool-row${item === selected ? " is-selected" : ""}`);
      row.type = "button";
      row.setAttribute("aria-pressed", String(item === selected));
      const copy = node("span", "operations-tool-row-copy");
      copy.append(node("strong", "", item.title), node("small", "", item.meta));
      row.append(copy, status(item.status));
      row.addEventListener("click", () => {
        selected = item;
        renderList();
        renderDetail(detail, item);
      });
      list.append(row);
    });
    if (!items.length) {
      const empty = node("div", "operations-tool-empty");
      empty.append(node("strong", "", "No matching records"), node("span", "", "Clear the search to return to the full preview."));
      list.append(empty);
    }
  };
  search.addEventListener("input", renderList);
  renderList();
  renderDetail(detail, selected);
}
