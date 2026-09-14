import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NATIVE_OWNER_APPS } from "../web/js/owner-dashboard.js";

const allApps = NATIVE_OWNER_APPS.flatMap((group) => group.items);

test("native owner launch names the known application destinations", () => {
  const hrefFor = (label) => allApps.find((app) => app.label === label)?.href;
  assert.equal(hrefFor("Open CRM"), "https://srv1625369.tail3084c0.ts.net:8445/crm/dashboard");
  assert.equal(hrefFor("Leads"), "https://srv1625369.tail3084c0.ts.net:8445/crm/leads");
  assert.equal(hrefFor("Open Helpdesk"), "https://srv1625369.tail3084c0.ts.net:8445/helpdesk/dashboard");
  assert.equal(hrefFor("Tickets"), "https://srv1625369.tail3084c0.ts.net:8445/helpdesk/tickets");
  assert.equal(hrefFor("Open mail"), "https://inbox.purelymail.com/");
  assert.equal(hrefFor("Open Mautic"), "https://srv1625369.tail3084c0.ts.net:8447/s/dashboard");
  assert.equal(hrefFor("Campaigns"), "https://srv1625369.tail3084c0.ts.net:8447/s/campaigns");
  assert.equal(hrefFor("Emails"), "https://srv1625369.tail3084c0.ts.net:8447/s/emails");
  assert.equal(hrefFor("Open ntfy"), "https://srv1625369.tail3084c0.ts.net:8446/");
  assert.equal(allApps.find((app) => app.label === "Scheduling")?.unavailable, true);
});

test("private native destinations are marked as requiring Tailscale", () => {
  const privateApps = allApps.filter((app) => app.private);
  assert.ok(privateApps.length >= 7);
  assert.ok(privateApps.every((app) => app.href.includes("tail3084c0.ts.net")));
});

test("launch source opens real apps safely and never embeds them", () => {
  const source = readFileSync(new URL("../web/js/owner-dashboard.js", import.meta.url), "utf8");
  assert.match(source, /link\.target = "_blank"/);
  assert.match(source, /link\.rel = "noopener noreferrer"/);
  assert.match(source, /link\.referrerPolicy = "no-referrer"/);
  assert.doesNotMatch(source, /<iframe|createElement\("iframe"|sample|fictional|rangeMetrics|growthReport|filterCustomers/iu);
});

test("legacy operations shortcuts contain no ordinary-app demo records", () => {
  const legacy = readFileSync(new URL("../web/js/operations-tools.js", import.meta.url), "utf8");
  assert.match(legacy, /return mountOwnerDashboard\(root\)/);
  assert.doesNotMatch(legacy, /metrics:|items:|Chatwoot|Stalwart|Northline/);
});
