export const NATIVE_OWNER_APPS = Object.freeze([
  { group: "Customer records", items: [
    { label: "Open CRM", detail: "Frappe CRM dashboard", href: "https://srv1625369.tail3084c0.ts.net:8445/crm/dashboard", primary: true, private: true },
    { label: "Leads", detail: "Frappe CRM lead records", href: "https://srv1625369.tail3084c0.ts.net:8445/crm/leads", private: true },
  ] },
  { group: "Support and mail", items: [
    { label: "Open Helpdesk", detail: "Frappe Helpdesk dashboard", href: "https://srv1625369.tail3084c0.ts.net:8445/helpdesk/dashboard", private: true },
    { label: "Tickets", detail: "Frappe Helpdesk tickets", href: "https://srv1625369.tail3084c0.ts.net:8445/helpdesk/tickets", private: true },
    { label: "Open mail", detail: "Purelymail inbox", href: "https://inbox.purelymail.com/" },
  ] },
  { group: "Marketing and revenue", items: [
    { label: "Open Mautic", detail: "Mautic dashboard", href: "https://srv1625369.tail3084c0.ts.net:8447/s/dashboard", private: true },
    { label: "Campaigns", detail: "Mautic campaigns", href: "https://srv1625369.tail3084c0.ts.net:8447/s/campaigns", private: true },
    { label: "Emails", detail: "Mautic emails", href: "https://srv1625369.tail3084c0.ts.net:8447/s/emails", private: true },
    { label: "Open Stripe", detail: "Stripe billing dashboard", href: "https://dashboard.stripe.com/" },
  ] },
  { group: "Reports", items: [
    { label: "GA4", detail: "Google Analytics", href: "https://analytics.google.com/analytics/web/" },
    { label: "Search Console", detail: "Google Search Console", href: "https://search.google.com/search-console/" },
    { label: "Meta Ads", detail: "Meta Ads Manager", href: "https://adsmanager.facebook.com/" },
    { label: "Google Ads", detail: "Google Ads", href: "https://ads.google.com/aw/overview" },
    { label: "Clarity", detail: "Microsoft Clarity", href: "https://clarity.microsoft.com/" },
  ] },
  { group: "Operations", items: [
    { label: "Open ntfy", detail: "Private notifications", href: "https://srv1625369.tail3084c0.ts.net:8446/", private: true },
    { label: "Scheduling", detail: "No native scheduling interface is deployed.", unavailable: true },
  ] },
]);
function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function appLink(app) {
  const link = element("a", app.primary ? "owner-launch-primary" : "owner-launch-link");
  link.href = app.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.append(element("strong", "", app.label), element("span", "", app.detail));
  if (app.private) link.append(element("small", "", "Requires Tailscale"));
  return link;
}
function appRow(app) {
  const row = element("li", "owner-launch-row");
  if (app.unavailable) {
    row.classList.add("is-unavailable");
    row.append(element("strong", "", app.label), element("span", "", app.detail));
    return row;
  }
  row.append(appLink(app));
  return row;
}
export function mountOwnerDashboard(host) {
  if (!host) return () => {};
  const root = element("section", "owner-launch");
  root.dataset.testid = "owner-native-app-launch";
  root.setAttribute("aria-labelledby", "owner-launch-heading");
  const header = element("header", "owner-launch-header");
  header.append(element("h1", "", "Blockwise"), element("p", "", "Open the native app that owns the work."));
  const primary = NATIVE_OWNER_APPS[0].items[0];
  header.append(appLink(primary), element("p", "owner-launch-access", "Private apps require Tailscale. Each app uses its own sign-in."));
  header.querySelector("h1").id = "owner-launch-heading";
  const groups = element("div", "owner-launch-groups");
  NATIVE_OWNER_APPS.forEach((group) => {
    const section = element("section", "owner-launch-group");
    section.append(element("h2", "", group.group));
    const list = element("ul", "owner-launch-list");
    group.items.filter((item) => !item.primary).forEach((item) => list.append(appRow(item)));
    if (list.childElementCount) section.append(list);
    groups.append(section);
  });
  root.append(header, groups);
  host.replaceChildren(root);
  return () => root.remove();
}
