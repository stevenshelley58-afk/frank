const C = Object.freeze([
  {
    id: "ava",
    name: "Ava Chen",
    kind: "lead",
    status: "New",
    stage: "Website enquiry",
    email: "ava.chen@example.test",
    source: "Website",
    updated: "18 min ago",
    detail: "Asked for a short Blockwise walkthrough.",
  },
  {
    id: "mila",
    name: "Mila Hart",
    kind: "trial",
    status: "Onboarding",
    stage: "Trial day 4",
    email: "mila.hart@example.test",
    source: "Organic search",
    updated: "42 min ago",
    detail: "Booked onboarding and has not completed first setup.",
  },
  {
    id: "jordan",
    name: "Jordan Lee",
    kind: "customer",
    status: "Active",
    stage: "Paying",
    email: "jordan.lee@example.test",
    source: "Referral",
    updated: "Yesterday",
    detail: "Monthly sample subscription is current.",
  },
  {
    id: "rory",
    name: "Rory Bennett",
    kind: "customer",
    status: "Payment issue",
    stage: "Recovery",
    email: "rory.bennett@example.test",
    source: "Google Ads",
    updated: "Yesterday",
    detail: "Sample payment retry is recorded. No change is available here.",
  },
]);
const R = Object.freeze({
  7: {
    mrr: "A$2,140",
    paying: 12,
    trials: 3,
    leads: 18,
    visitors: "384",
    signup: "4.7%",
    cash: "A$540",
    bookings: 2,
    g: [2, 3, 2, 3, 3, 2, 3],
  },
  30: {
    mrr: "A$2,140",
    paying: 12,
    trials: 3,
    leads: 54,
    visitors: "1,612",
    signup: "4.5%",
    cash: "A$2,020",
    bookings: 3,
    g: [4, 5, 4, 6, 5, 6, 4, 7, 6, 7],
  },
  90: {
    mrr: "A$2,140",
    paying: 12,
    trials: 3,
    leads: 143,
    visitors: "4,906",
    signup: "4.2%",
    cash: "A$6,180",
    bookings: 5,
    g: [8, 10, 9, 12, 11, 13, 10, 15, 12, 14, 16, 13],
  },
});
const N = [
  {
    id: "retry",
    severity: "Attention",
    category: "Billing",
    title: "Payment retry needs review",
    body: "Rory Bennett has a recorded sample retry. The source issue remains open.",
    time: "12 min ago",
    read: false,
  },
  {
    id: "lead",
    severity: "New",
    category: "Customer",
    title: "New website enquiry",
    body: "Ava Chen requested a product walkthrough through the sample queue.",
    time: "18 min ago",
    read: false,
  },
  {
    id: "follow",
    severity: "Review",
    category: "Operations",
    title: "Follow-up due today",
    body: "Mila Hart has an onboarding follow-up due at 13:30.",
    time: "42 min ago",
    read: false,
  },
  {
    id: "delivery",
    severity: "Info",
    category: "Delivery",
    title: "Delivery receipt recorded",
    body: "A sample transactional receipt was recorded.",
    time: "Yesterday",
    read: true,
  },
];
const GROWTH = Object.freeze({
  Website: {
    label: "Website leads", unit: "leads", totals: { 7: 18, 30: 54, 90: 143 },
    series: { 7: [2, 3, 2, 3, 3, 2, 3], 30: [4, 5, 4, 6, 5, 6, 4, 7, 6, 7], 90: [8, 10, 9, 12, 11, 13, 10, 15, 12, 14, 16, 13] },
  },
  "Google Analytics": {
    label: "Sessions", unit: "sessions", totals: { 7: 384, 30: 1612, 90: 4906 },
    series: { 7: [48, 52, 46, 61, 55, 58, 64], 30: [142, 151, 148, 160, 155, 169, 173, 162, 176, 176], 90: [365, 382, 391, 403, 398, 415, 421, 409, 432, 427, 438, 425] },
  },
  "Search Console": {
    label: "Search clicks", unit: "clicks", totals: { 7: 96, 30: 438, 90: 1280 },
    series: { 7: [11, 13, 12, 15, 14, 16, 15], 30: [38, 41, 39, 45, 44, 48, 42, 46, 47, 48], 90: [92, 98, 101, 105, 104, 109, 111, 108, 116, 112, 115, 109] },
  },
  "Meta Ads": {
    label: "Paid social leads", unit: "leads", totals: { 7: 4, 30: 13, 90: 35 }, spend: { 7: 84, 30: 296, 90: 812 },
    series: { 7: [0, 1, 0, 1, 1, 0, 1], 30: [1, 1, 1, 2, 1, 1, 2, 1, 1, 2], 90: [2, 3, 2, 4, 3, 3, 2, 4, 3, 3, 3, 3] },
  },
  "Google Ads": {
    label: "Paid search leads", unit: "leads", totals: { 7: 3, 30: 11, 90: 29 }, spend: { 7: 108, 30: 366, 90: 928 },
    series: { 7: [0, 1, 0, 1, 0, 0, 1], 30: [1, 1, 0, 2, 1, 1, 1, 2, 1, 1], 90: [2, 2, 3, 2, 3, 2, 2, 3, 2, 3, 2, 3] },
  },
  Clarity: {
    label: "High-intent sessions", unit: "sessions", totals: { 7: 41, 30: 178, 90: 520 },
    series: { 7: [5, 6, 4, 7, 6, 7, 6], 30: [15, 17, 16, 19, 18, 20, 17, 18, 19, 19], 90: [38, 41, 40, 44, 42, 45, 43, 46, 44, 47, 45, 45] },
  },
});
const V = [
    "Overview",
    "Customers",
    "Inbox",
    "Growth",
    "Revenue",
    "Email flows",
    "Operations",
    "Connections",
  ],
  G = [
    "Website",
    "Google Analytics",
    "Search Console",
    "Meta Ads",
    "Google Ads",
    "Clarity",
  ],
  P = [
    "Frappe CRM",
    "Helpdesk",
    "Purelymail",
    "Mautic",
    "Resend",
    "Stripe",
    "Blockwise analytics",
    "GA4",
    "Search Console",
    "Meta Ads",
    "Google Ads",
    "Clarity",
    "SnagTime",
    "ntfy",
  ];
export const PREVIEW_TRANSPORT_POLICY = Object.freeze({
  previewOnly: true,
  persistence: "none",
  providerTransport: "prohibited",
});
export const rangeMetrics = (days = 30) => R[days] || R[30];
export const growthReport = (source = "Website", days = 30) => {
  const selectedSource = GROWTH[source] ? source : "Website";
  const selectedDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const fixture = GROWTH[selectedSource];
  const total = fixture.totals[selectedDays];
  return {
    source: selectedSource,
    days: selectedDays,
    label: fixture.label,
    unit: fixture.unit,
    total,
    series: [...fixture.series[selectedDays]],
    spend: fixture.spend?.[selectedDays] ?? null,
    costPerLead: fixture.spend ? Number((fixture.spend[selectedDays] / total).toFixed(2)) : null,
  };
};
export const growthRows = (report) => {
  return {
        Website: () => [["Top page", "/real-estate-lead-generation"], ["Top referrer", "Organic search"], ["Form completions", String(report.total)]],
        "Google Analytics": () => [["Organic search", "46% of sessions"], ["Direct", "24% of sessions"], ["Mobile", "61% of sessions"]],
        "Search Console": () => [["Top query", "real estate lead generation"], ["Top page", "/real-estate-lead-generation"], ["Average position", "12.4"]],
        "Meta Ads": () => [["Campaign", "Agent lead guide"], ["Spend", "A$" + report.spend.toLocaleString("en-AU")], ["Cost per lead", "A$" + report.costPerLead.toFixed(2)]],
        "Google Ads": () => [["Campaign", "Lead generation search"], ["Spend", "A$" + report.spend.toLocaleString("en-AU")], ["Cost per lead", "A$" + report.costPerLead.toFixed(2)]],
        Clarity: () => [["Rage clicks", "4 sessions"], ["Dead clicks", "7 sessions"], ["Scroll depth", "63% median"]],
      }[report.source]();
};
export const filterCustomers = (
  records,
  q = "",
  status = "All",
  kind = "All",
) => {
  q = String(q).trim().toLowerCase();
  return records.filter(
    (x) =>
      (kind === "All" || x.kind === kind) &&
      (status === "All" || x.status === status) &&
      (!q ||
        [x.name, x.email, x.stage, x.source]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
};
export const filterNotifications = (
  records,
  severity = "All",
  category = "All",
) =>
  records.filter(
    (x) =>
      (severity === "All" || x.severity === severity) &&
      (category === "All" || x.category === category),
  );
export const filterRevenueRecords = (records, category = "All") =>
  records.filter(
    (record) =>
      category === "All" ||
      (category === "Issues"
        ? record.issueFlag
        : category === "Subscriptions"
          ? record.recordKind === "subscription"
          : category === "Payments" && record.recordKind === "payment"),
  );
const e = (tag, cls = "", txt) => {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (txt !== undefined) x.textContent = txt;
  return x;
};
const b = (txt, cls = "", fn) => {
  const x = e("button", cls, txt);
  x.type = "button";
  if (
    cls.includes("owner-dashboard-tab") ||
    cls.includes("owner-dashboard-range-button")
  ) {
    x.setAttribute(
      "aria-pressed",
      cls.includes("is-active") ? "true" : "false",
    );
  }
  if (cls.includes("owner-dashboard-nav-button") && cls.includes("is-active")) {
    x.setAttribute("aria-current", "page");
  }
  if (fn) x.addEventListener("click", fn);
  return x;
};
const chip = (txt) => e("span", "owner-dashboard-chip", txt);
const row = (a, d, c = "") => {
  const x = e("div", "owner-dashboard-row"),
    z = e("div", "owner-dashboard-row-copy");
  z.append(e("strong", "", a), e("span", "", d));
  x.append(z);
  if (c) x.append(chip(c));
  return x;
};
const note = (
  txt = "Sample data only. This screen has no live provider connection.",
) => e("p", "owner-dashboard-source-note", txt);
const card = (title, desc = "") => {
  const x = e("section", "owner-dashboard-card"),
    h = e("div", "owner-dashboard-card-heading");
  h.append(e("h2", "", title));
  if (desc) h.append(e("p", "", desc));
  x.append(h);
  return x;
};
const stat = (label, value, detail = "") => {
  const x = e("div", "owner-dashboard-stat");
  x.append(
    e("span", "owner-dashboard-stat-label", label),
    e("strong", "owner-dashboard-stat-value", value),
  );
  if (detail) x.append(e("small", "owner-dashboard-stat-note", detail));
  return x;
};
const bars = (values, label) => {
  const f = e("figure", "owner-dashboard-chart"),
    l = e("div", "owner-dashboard-bars"),
    max = Math.max(0, ...values);
  f.setAttribute("aria-label", label);
  values.forEach((v, i) => {
    const x = e("span", "owner-dashboard-bar");
    x.style.setProperty(
      "--bar-height",
      String(v === 0 || max === 0 ? 0 : Math.max(10, Math.round((v / max) * 100))) + "%",
    );
    x.setAttribute("aria-label", "Period " + (i + 1) + ": " + v);
    l.append(x);
  });
  f.append(l, e("figcaption", "", label));
  return f;
};
function dialog(root, title, build) {
  const d = document.createElement("dialog"),
    was = document.activeElement;
  d.className = "owner-dashboard-dialog";
  d.setAttribute("aria-label", title);
  d.addEventListener("close", () => {
    was?.focus?.();
    d.remove();
  });
  d.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab") return;
    const f = [
        ...d.querySelectorAll(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),[href]",
        ),
      ],
      a = f[0],
      z = f.at(-1);
    if (!f.length) return;
    if (ev.shiftKey && document.activeElement === a) {
      ev.preventDefault();
      z.focus();
    }
    if (!ev.shiftKey && document.activeElement === z) {
      ev.preventDefault();
      a.focus();
    }
  });
  const s = e("div", "owner-dashboard-dialog-shell"),
    close = () => d.close(),
    head = e("header", "owner-dashboard-dialog-head");
  head.append(e("h2", "", title), b("Close", "owner-dashboard-button", close));
  s.append(head);
  build(s, close);
  d.append(s);
  root.append(d);
  d.showModal();
  d.querySelector("button")?.focus();
}
export function mountOwnerDashboard(host) {
  if (!host) return () => {};
  const S = {
      view: "Overview",
      range: 30,
      mode: "sample",
      kind: "All",
      status: "All",
      query: "",
      inbox: "Ordinary mail",
      inboxQuery: "",
      growth: "Website",
      revenue: "All",
      flow: null,
      ops: "Bookings",
      notices: N.map((x) => ({ ...x })),
    },
    root = e("section", "owner-dashboard");
  root.setAttribute("aria-label", "Blockwise owner dashboard preview");
  root.dataset.testid = "owner-dashboard";
  const live = e("p", "owner-dashboard-live", "");
  live.setAttribute("aria-live", "polite");
  const say = (x) => (live.textContent = x),
    again = () => render(),
    preview = (x) => say("Preview only. " + x);
  function header(main) {
    const h = e("header", "owner-dashboard-header"),
      title = e("div", "owner-dashboard-title"),
      ctl = e("div", "owner-dashboard-header-controls"),
      mode = document.createElement("select");
    title.append(e("h1", "", "Blockwise"), e("p", "", "Owner dashboard"));
    mode.className = "owner-dashboard-select";
    mode.setAttribute("aria-label", "Preview state");
    ["sample", "disconnected", "loading", "error", "stale"].forEach((x) =>
      mode.add(
        new Option(x[0].toUpperCase() + x.slice(1), x, false, S.mode === x),
      ),
    );
    mode.addEventListener("change", () => {
      S.mode = mode.value;
      again();
    });
    ctl.append(
      mode,
      b(
        "Notifications " + S.notices.filter((x) => !x.read).length,
        "owner-dashboard-button",
        notifications,
      ),
    );
    ctl
      .querySelector("button")
      ?.setAttribute("data-testid", "owner-dashboard-notifications");
    h.append(title, ctl);
    main.append(
      h,
      e(
        "p",
        "owner-dashboard-preview-banner",
        "Frontend preview · Sample data · No live actions",
      ),
    );
  }
  function unavailable(main) {
    if (S.mode === "sample" || S.mode === "stale") return false;
    const m = {
        disconnected: [
          "No live sources are connected",
          "This preview never reads Blockwise, provider, or customer data.",
        ],
        loading: [
          "Loading state",
          "A live source would load here. This preview does not wait for a provider.",
        ],
        error: [
          "Sample source unavailable",
          "This is an honest recovery state. No provider has been contacted.",
        ],
      }[S.mode],
      x = e("section", "owner-dashboard-state");
    x.append(
      e("h2", "", m[0]),
      e("p", "", m[1]),
      b("Show sample data", "owner-dashboard-primary", () => {
        S.mode = "sample";
        again();
      }),
    );
    main.append(x);
    return true;
  }
  function overview(main) {
    const d = rangeMetrics(S.range),
      top = e("div", "owner-dashboard-overview-top"),
      a = card("Needs attention", "Three items worth opening first."),
      g = card(
        "Growth",
        "Website leads in the selected " + S.range + "-day sample range.",
      );
    a.classList.add("owner-dashboard-attention");
    [
      ["Payment retry needs review", "Rory Bennett · Billing", "Attention"],
      ["Onboarding follow-up due", "Mila Hart · 13:30 today", "Due"],
      ["Reply to website enquiry", "Ava Chen · 18 min ago", "New"],
    ].forEach((x, index) => {
      const target =
        index === 0 ? "Revenue" : index === 1 ? "Customers" : "Inbox";
      const item = b("", "owner-dashboard-list-button", () => {
        S.view = target;
        again();
      });
      item.append(row(...x));
      a.append(item);
    });
    g.append(
      bars(
        d.g,
        "Sample website leads over " +
          S.range +
          " days. Values range from " +
          Math.min(...d.g) +
          " to " +
          Math.max(...d.g) +
          " per period.",
      ),
      note(
        "Evidence label: sample website lead counts. Stages below are not joined attribution.",
      ),
    );
    top.append(a, g);
    main.append(top);
    const st = e("div", "owner-dashboard-stats");
    [
      ["MRR", d.mrr, "Recurring value"],
      ["Paying", String(d.paying), "Current snapshot"],
      ["Trials", String(d.trials), "Current snapshot"],
      ["Leads", String(d.leads), String(S.range) + "-day sample"],
    ].forEach((x) => st.append(stat(...x)));
    main.append(st);
    const low = e("div", "owner-dashboard-overview-bottom"),
      stages = card("Acquisition stages", "Separate acquisition observations."),
      today = card("Today", "Sample bookings and follow-ups."),
      events = card("Recent events", "Recorded sample events."),
      stageList = e("div", "owner-dashboard-stages");
    [
      [d.visitors, "Website visitors"],
      [d.signup, "Signup rate"],
      [String(d.trials), "Trials"],
      [String(d.paying), "Paying customers"],
    ].forEach((x) => stageList.append(stat(x[1], x[0])));
    stages.append(stageList, note());
    [
      ["10:30 · Onboarding call", "Mila Hart · 30 minutes", "Booking"],
      ["13:30 · Follow up", "Mila Hart · Email draft", "Due"],
      ["15:00 · Product walkthrough", "Ava Chen · 30 minutes", "Booking"],
    ].forEach((x) => today.append(row(...x)));
    [
      [
        "Booking confirmation recorded",
        "Resend delivery sample · 18 min ago",
        "Delivery",
      ],
      [
        "Website enquiry created",
        "Website sample queue · 18 min ago",
        "Customer",
      ],
      ["Payment retry recorded", "Stripe sample event · Yesterday", "Billing"],
    ].forEach((x) => events.append(row(...x)));
    low.append(stages, today, events);
    main.append(low);
  }
  function customers(main) {
    const ctl = e("div", "owner-dashboard-toolbar"),
      search = document.createElement("input"),
      tabs = e("div", "owner-dashboard-tabs"),
      status = document.createElement("select"),
      list = card("Customer records", ""),
      count = e("p", "owner-dashboard-result-count"),
      body = e("div", "owner-dashboard-list");
    search.type = "search";
    search.placeholder = "Search sample customers";
    search.value = S.query;
    search.setAttribute("aria-label", "Search customers");
    const paint = () => {
      const found = filterCustomers(C, S.query, S.status, S.kind);
      count.textContent = found.length + " sample record" + (found.length === 1 ? "" : "s") +
        " shown. Current-state records are not date filtered.";
      body.replaceChildren();
      if (!found.length) {
        const empty = e("div", "owner-dashboard-empty");
        empty.append(
          e("strong", "", "No sample records match"),
          e("span", "", "Clear the search or filters to see the full fixture."),
          b("Clear filters", "owner-dashboard-button", () => {
            S.query = "";
            S.kind = "All";
            S.status = "All";
            search.value = "";
            status.value = "All";
            tabs.querySelectorAll("button").forEach((button, index) => {
              const active = index === 0;
              button.classList.toggle("is-active", active);
              button.setAttribute("aria-pressed", String(active));
            });
            paint();
            search.focus();
          }),
        );
        body.append(empty);
      } else {
        found.forEach((record) => {
          const item = b("", "owner-dashboard-list-button", () => customer(record));
          item.append(row(record.name, record.stage + " · " + record.updated, record.status));
          body.append(item);
        });
      }
    };
    search.addEventListener("input", () => {
      S.query = search.value;
      paint();
    });
    [["All", "All records"], ["lead", "Leads"], ["trial", "Trials"], ["customer", "Customers"]].forEach(([key, label]) =>
      tabs.append(b(label, "owner-dashboard-tab" + (S.kind === key ? " is-active" : ""), () => {
        S.kind = key;
        again();
      })),
    );
    status.className = "owner-dashboard-select";
    status.setAttribute("aria-label", "Customer status");
    ["All", "New", "Onboarding", "Active", "Payment issue"].forEach((value) =>
      status.add(new Option(value, value, false, S.status === value)),
    );
    status.addEventListener("change", () => {
      S.status = status.value;
      again();
    });
    ctl.append(search, tabs, status);
    list.querySelector(".owner-dashboard-card-heading").append(count);
    list.append(body, note("All names, emails and events in this customer list are fictional sample records."));
    main.append(ctl, list);
    paint();
  }
  function customer(c) {
    dialog(root, c.name, (s, close) => {
      s.append(
        e(
          "p",
          "owner-dashboard-dialog-note",
          "Fictional sample record. Native records are not connected in this preview.",
        ),
      );
      const f = e("dl", "owner-dashboard-facts");
      [
        ["Lifecycle", c.kind + " · " + c.stage],
        [
          "Billing",
          c.status === "Payment issue"
            ? "Sample retry recorded"
            : "No live billing record",
        ],
        ["Activity", c.detail],
        ["Contact", c.email],
      ].forEach(([a, z]) => {
        const x = e("div");
        x.append(e("dt", "", a), e("dd", "", z));
        f.append(x);
      });
      const unavailable = b(
        "Native record unavailable",
        "owner-dashboard-button",
      );
      unavailable.disabled = true;
      unavailable.title =
        "No CRM record is connected to this frontend preview.";
      s.append(f, unavailable, b("Close", "owner-dashboard-primary", close));
    });
  }
  function inbox(main) {
    const tabs = e("div", "owner-dashboard-tabs"),
      search = document.createElement("input"),
      box = card("Inbox", "Read-only sample messages. Sending remains unavailable until a real inbox is connected."),
      messages = S.inbox === "Support"
        ? [
            { subject: "Setup question", sender: "Mila Hart", time: "42 min ago", body: "The customer asked what to do next." },
            { subject: "Billing question", sender: "Rory Bennett", time: "Yesterday", body: "The customer asked about the sample payment retry." },
          ]
        : [
            { subject: "Website enquiry", sender: "Ava Chen", time: "18 min ago", body: "Can I see how Blockwise handles lead follow-up?" },
            { subject: "Booking confirmation", sender: "Blockwise mail", time: "Today", body: "Sample transactional message receipt recorded." },
          ],
      layout = e("div", "owner-dashboard-split"),
      list = e("div", "owner-dashboard-list"),
      detail = e("aside", "owner-dashboard-detail");
    ["Ordinary mail", "Support"].forEach((name) =>
      tabs.append(b(name, "owner-dashboard-tab" + (S.inbox === name ? " is-active" : ""), () => {
        S.inbox = name;
        again();
      })),
    );
    search.type = "search";
    search.placeholder = "Search sample messages";
    search.value = S.inboxQuery;
    search.setAttribute("aria-label", "Search messages");
    const show = (message) => {
      if (!message) {
        detail.replaceChildren(e("h2", "", "No message selected"), e("p", "", "Clear the search to show sample messages."));
        return;
      }
      detail.replaceChildren(
        e("h2", "", message.subject), e("p", "", message.body),
        note("Sample read detail. This does not open or send an email."),
      );
      const unavailable = b("Reply unavailable", "owner-dashboard-button");
      unavailable.disabled = true;
      unavailable.title = "Connect an inbox outside this preview to reply.";
      detail.append(unavailable, e("p", "owner-dashboard-disabled-note", "Compose and send are disabled because this preview has no sender or mailbox."));
    };
    const paint = () => {
      const query = S.inboxQuery.trim().toLowerCase();
      const found = messages.filter((message) =>
        !query || [message.subject, message.sender, message.body].join(" ").toLowerCase().includes(query),
      );
      list.replaceChildren();
      if (!found.length) {
        const empty = e("div", "owner-dashboard-empty");
        empty.append(
          e("strong", "", "No sample messages match"),
          e("span", "", "Search checks subject, sender and message text."),
          b("Clear search", "owner-dashboard-button", () => {
            S.inboxQuery = "";
            search.value = "";
            paint();
            search.focus();
          }),
        );
        list.append(empty);
        show(null);
        return;
      }
      found.forEach((message, index) => {
        const item = b("", "owner-dashboard-list-button", () => show(message));
        item.append(row(message.subject, message.sender + " · " + message.time, index ? "Read" : "New"));
        list.append(item);
      });
      show(found[0]);
    };
    search.addEventListener("input", () => {
      S.inboxQuery = search.value;
      paint();
    });
    layout.append(list, detail);
    box.append(layout);
    main.append(tabs, search, box);
    paint();
  }
  function growth(main) {
    const report = growthReport(S.growth, S.range),
      tabs = e("div", "owner-dashboard-tabs owner-dashboard-growth-tabs"),
      stats = e("div", "owner-dashboard-stats"),
      panel = card(S.growth, "Blockwise acquisition evidence for the selected range."),
      table = e("div", "owner-dashboard-table"),
      rows = growthRows(report);
    G.forEach((name) =>
      tabs.append(b(name, "owner-dashboard-tab" + (S.growth === name ? " is-active" : ""), () => {
        S.growth = name;
        again();
      })),
    );
    [
      [report.label, report.total.toLocaleString("en-AU"), String(report.days) + " days"],
      ["Unit", report.unit, "Chart values"],
      ["Connection", "Not connected", "Preview"],
      ["Source", report.source, "Sample"],
    ].forEach((item) => stats.append(stat(...item)));
    panel.append(bars(report.series, "Sample " + report.unit + " over " + report.days + " days, totalling " + report.total.toLocaleString("en-AU") + "."));
    rows.forEach((item) => table.append(row(item[0], item[1])));
    panel.append(table, note("Source: " + report.source + " sample fixture. No provider account is connected."));
    main.append(tabs, stats, panel);
  }
  function revenue(main) {
    const d = rangeMetrics(S.range),
      tabs = e("div", "owner-dashboard-tabs"),
      stats = e("div", "owner-dashboard-stats"),
      table = card("Subscription and payment records", "A recent sample subset is shown below. MRR is the wider sample snapshot."),
      records = [
        { name: "Mila Hart", recordKind: "subscription", issueFlag: false, status: "Trial", summary: "Trial subscription · no live billing record" },
        { name: "Jordan Lee", recordKind: "subscription", issueFlag: false, status: "Current", summary: "Subscription · sample MRR A$179" },
        { name: "Rory Bennett", recordKind: "payment", issueFlag: true, status: "Issue", summary: "Sample payment retry recorded" },
      ];
    ["All", "Subscriptions", "Payments", "Issues"].forEach((name) =>
      tabs.append(b(name, "owner-dashboard-tab" + (S.revenue === name ? " is-active" : ""), () => {
        S.revenue = name;
        again();
      })),
    );
    [["MRR", d.mrr, "Wider sample snapshot"], ["Cash collected", d.cash, String(S.range) + " days"], ["Paying", String(d.paying), "Current snapshot"], ["Issues", "1", "Recent sample subset"]]
      .forEach((item) => stats.append(stat(...item)));
    const shown = filterRevenueRecords(records, S.revenue);
    shown.forEach((record) => {
      const entry = b("", "owner-dashboard-list-button", () =>
        dialog(root, record.name, (shell, close) => shell.append(
          e("p", "owner-dashboard-dialog-note", "Read-only fictional sample record from the recent subset."),
          row("Record type", record.recordKind === "subscription" ? "Subscription" : "Payment"),
          row("Status", record.status),
          row("Summary", record.summary),
          row("Issue flag", record.issueFlag ? "Needs review" : "No issue in this sample"),
          e("p", "owner-dashboard-disabled-note", "Charges, refunds and recovery actions are unavailable in this preview."),
          b("Close", "owner-dashboard-primary", close),
        )),
      );
      entry.append(row(record.name, record.summary, record.status));
      table.append(entry);
    });
    if (!shown.length) table.append(e("p", "owner-dashboard-empty", "No sample records match this category."));
    table.append(note("No charge, refund, or payment-recovery action is available from this preview."));
    main.append(tabs, stats, table);
  }
  function flows(main) {
    const flows = [
        ["New customer onboarding", "Draft", "Mautic lifecycle flow"],
        ["Trial reminder", "Paused", "Mautic lifecycle flow"],
        ["Booking confirmation", "Sample", "Resend transactional delivery"],
        ["Ordinary mail", "Sample", "Purelymail mailbox"],
      ],
      list = card(
        "Email flows",
        "Flow states and timing are illustrative, not approved customer terms.",
      );
    flows.forEach((flow) => {
      const item = b("", "owner-dashboard-list-button", () => {
        S.flow = flow;
        again();
      });
      item.append(row(...flow));
      list.append(item);
    });
    list.append(
      note(
        "Resend handles transactional delivery. Mautic represents lifecycle flows. Purelymail is ordinary mail.",
      ),
    );
    main.append(list);
    if (!S.flow) return;
    const detail = card(
      S.flow[0],
      S.flow[0] === "Ordinary mail"
        ? "Mailbox access is not a lifecycle sequence."
        : S.flow[0] === "Booking confirmation"
          ? "Transactional confirmation detail."
          : "Illustrative lifecycle timing.",
    );
    const steps =
      S.flow[0] === "Ordinary mail"
        ? [
            ["Mailbox", "Purelymail ordinary mail", "Sample"],
            ["Sending", "Unavailable in this preview", "Read-only"],
          ]
        : S.flow[0] === "Booking confirmation"
          ? [
              ["Trigger", "Booking recorded", "Sample"],
              ["Delivery", "Confirmation receipt", "Resend"],
              ["Timing", "At booking time", "Transactional"],
            ]
          : [
              ["Immediately", "Entry check", "Sample"],
              ["Day 1", "Helpful setup note", "Sample"],
              ["Day 4", "Follow-up if no reply", "Sample"],
            ];
    steps.forEach((step) => detail.append(row(...step)));
    const disabled = b("Activate unavailable", "owner-dashboard-button");
    disabled.disabled = true;
    disabled.title = "This preview has no email-flow connection.";
    detail.append(disabled);
    main.append(detail);
  }
  function operations(main) {
    const tabs = e("div", "owner-dashboard-tabs");
    ["Bookings", "Follow-ups", "Service status"].forEach((name) =>
      tabs.append(
        b(
          name,
          "owner-dashboard-tab" + (S.ops === name ? " is-active" : ""),
          () => {
            S.ops = name;
            again();
          },
        ),
      ),
    );
    const data = {
        Bookings: [
          ["10:30 · Onboarding", "Mila Hart · SnagTime sample", "Upcoming"],
          ["15:00 · Walkthrough", "Ava Chen · Booking sample", "Upcoming"],
        ],
        "Follow-ups": [
          ["13:30 · Email draft", "Mila Hart", "Due"],
          ["Tomorrow · Payment review", "Rory Bennett", "Scheduled"],
        ],
        "Service status": [
          ["Email delivery", "Resend receipt sample", "Sample"],
          ["Backups", "No live backup probe", "Sample"],
          ["Bookings", "No live SnagTime check", "Sample"],
        ],
      }[S.ops],
      box = card(S.ops, "Operational records shown in this frontend preview.");
    data.forEach((item) => box.append(row(...item)));
    const disabled = b("Native tool unavailable", "owner-dashboard-button");
    disabled.disabled = true;
    disabled.title =
      "Connected native tools are intentionally unavailable in this preview.";
    box.append(disabled, note());
    main.append(tabs, box);
  }
  function connections(main) {
    const box = card("Connections", "Provider names are shown for future setup only. None is connected to this preview."),
      list = e("div", "owner-dashboard-connection-grid");
    P.forEach((name) => {
      const entry = e("div", "owner-dashboard-connection"),
        copy = e("div", "owner-dashboard-connection-copy"),
        connect = b("Connect", "owner-dashboard-button");
      copy.append(e("strong", "", name), e("span", "", name + " setup is unavailable because this frontend preview has no live provider connection."));
      connect.disabled = true;
      connect.title = name + " cannot be connected from this frontend preview.";
      entry.append(copy, connect);
      list.append(entry);
    });
    box.append(list, note("Every Connect control is disabled. No OAuth or provider request can start from this preview."));
    main.append(box);
  }
  function notifications() {
    dialog(root, "Notifications", (shell, close) => {
      const filters = e("div", "owner-dashboard-dialog-filters"),
        severity = document.createElement("select"),
        category = document.createElement("select"),
        list = e("div", "owner-dashboard-list"),
        body = e(
          "p",
          "owner-dashboard-dialog-note",
          "Select a notification to read it.",
        ),
        clear = b("Clear filters", "owner-dashboard-button", () => {
          severity.value = "All";
          category.value = "All";
          paint();
        });
      ["All", "Attention", "New", "Review", "Info"].forEach((x) =>
        severity.add(new Option(x)),
      );
      ["All", "Billing", "Customer", "Operations", "Delivery"].forEach((x) =>
        category.add(new Option(x)),
      );
      severity.setAttribute("aria-label", "Notification severity");
      category.setAttribute("aria-label", "Notification category");
      const paint = () => {
        list.replaceChildren();
        const shown = filterNotifications(
          S.notices,
          severity.value,
          category.value,
        );
        if (!shown.length)
          list.append(
            e(
              "p",
              "owner-dashboard-empty",
              "No notifications match these filters.",
            ),
          );
        shown.forEach((item) => {
          const entry = b(
            "",
            "owner-dashboard-list-button" + (item.read ? " is-read" : ""),
            () => {
              item.read = true;
              body.textContent =
                item.body +
                " Marking this read does not resolve the source issue.";
              const counter = root.querySelector(
                '[data-testid="owner-dashboard-notifications"]',
              );
              if (counter)
                counter.textContent =
                  "Notifications " +
                  S.notices.filter((note) => !note.read).length;
              say("Notification marked read. The source issue remains open.");
              paint();
            },
          );
          entry.append(
            row(item.title, item.category + " · " + item.time, item.severity),
          );
          list.append(entry);
        });
      };
      severity.addEventListener("change", paint);
      category.addEventListener("change", paint);
      paint();
      filters.append(severity, category, clear);
      shell.append(
        body,
        filters,
        list,
        b("Close", "owner-dashboard-primary", close),
      );
    });
  }
  function render() {
    root.replaceChildren(live);
    const shell = e("div", "owner-dashboard-shell"),
      nav = e("nav", "owner-dashboard-nav"),
      main = e("div", "owner-dashboard-main");
    nav.setAttribute("aria-label", "Dashboard sections");
    nav.dataset.testid = "owner-dashboard-nav";
    V.forEach((x) =>
      nav.append(
        b(
          x,
          "owner-dashboard-nav-button" + (S.view === x ? " is-active" : ""),
          () => {
            S.view = x;
            again();
          },
        ),
      ),
    );
    header(main);
    const range = e("div", "owner-dashboard-range");
    [7, 30, 90].forEach((x) =>
      range.append(
        b(
          String(x) + " days",
          "owner-dashboard-range-button" + (S.range === x ? " is-active" : ""),
          () => {
            S.range = x;
            again();
          },
        ),
      ),
    );
    main.append(range);
    if (!unavailable(main)) {
      if (S.mode === "stale")
        main.append(
          e(
            "p",
            "owner-dashboard-stale",
            "Older sample snapshot shown. No fresh provider data has been requested.",
          ),
        );
      ({
        Overview: overview,
        Customers: customers,
        Inbox: inbox,
        Growth: growth,
        Revenue: revenue,
        "Email flows": flows,
        Operations: operations,
        Connections: connections,
      })[S.view](main);
    }
    shell.append(nav, main);
    root.append(shell);
  }
  host.replaceChildren(root);
  render();
  return () => {
    root.querySelectorAll("dialog").forEach((x) => x.close());
    root.remove();
  };
}
