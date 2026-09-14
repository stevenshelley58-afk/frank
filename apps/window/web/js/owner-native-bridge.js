// Native-origin session proof. No cross-origin cookies, passwords or record data.
const parentOrigin = "https://frank.fail";
const query = new URLSearchParams(location.search);
const app = query.get("app");
const apps = {
  crm: { origin: "https://crm.frank.fail", check: "/api/method/frappe.auth.get_logged_user" },
  support: { origin: "https://crm.frank.fail", check: "/api/method/frappe.auth.get_logged_user" },
  campaigns: { origin: "https://marketing.frank.fail", check: "/s/frank/session" },
  mail: { origin: "https://mail.frank.fail", check: "/?_task=mail&_action=plugin.frank_session" },
};
const entry = apps[app];
const status = document.querySelector('[role="status"]');
function report(type) {
  if (window.parent !== window) {
    window.parent.postMessage({channel: "frank.owner-app", version: 1, app, type}, parentOrigin);
  } else if (type === "ready" && query.get("return") === "1") {
    location.replace(parentOrigin + "/project/blockwise/" + app);
  } else {
    status.textContent = "The application session could not be opened. Return to Frank and try again.";
  }
}
async function check() {
  if (!entry || location.origin !== entry.origin) return;
  try {
    if (location.pathname === "/frank/connect") {
      if (window.parent !== window || app !== "campaigns") return;
      // Native Symfony firewall records this protected target in its own
      // session. The subsequent supported SAML entry consumes that target.
      await fetch("/s/frank/return", {
        credentials: "same-origin", redirect: "manual", cache: "no-store",
        headers: {Accept: "text/html"}, signal: AbortSignal.timeout(10000),
      });
      location.replace("/saml/discovery");
      return;
    }
    const response = await fetch(entry.check, {
      credentials: "same-origin", cache: "no-store", redirect: "manual",
      headers: {Accept: "application/json"},
      signal: AbortSignal.timeout(10000),
    });
    let ready = response.status === 200 && response.type !== "opaqueredirect";
    if (ready && (app === "crm" || app === "support")) {
      ready = (await response.json()).message === "owner@blockwise.sale";
    } else if (ready) {
      ready = (await response.json()).authenticated === true;

    }
    report(ready ? "ready" : "session_required");
  } catch {
    report("session_required");
  }
}
void check();
