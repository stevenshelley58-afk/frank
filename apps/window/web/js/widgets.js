import { define } from "./registry.js";

define({
  id: "overnight", title: "Overnight", surfaces: ["hub", "project-home"],
  mount(el) {
    el.innerHTML = `<ul class="rows">
      <li>Inbox job — Hermes cron comes next</li>
      <li>Nothing failed silently</li>
    </ul>`;
  },
});

define({
  id: "waiting", title: "Waiting on you", surfaces: ["hub", "project-home"],
  mount(el) { el.innerHTML = `<p class="quiet">Nothing waiting.</p>`; },
});

define({
  id: "running", title: "Running", surfaces: ["hub", "project-home"],
  mount(el) { el.innerHTML = `<p class="quiet">Nothing running.</p>`; },
});

define({
  id: "project-status", title: "Status", surfaces: ["project-home"],
  mount(el, ctx) {
    const p = ctx.project || {};
    el.innerHTML = `<p>${p.blurb || "No blurb."}</p>
      <p class="when">${p.live ? `<a href="${p.live}">Live app ↗</a>` : "No live app yet."}</p>
      <p class="when">Agent: ${p.id === "blockwise" ? "blockwise" : "not stood up"}</p>`;
  },
});

define({
  id: "account-manager", title: "Accounts", surfaces: ["tools"],
  mount(el) {
    el.innerHTML = `<p>Customer directory with recorded auth and billing state, plus project service identities.</p>
      <div class="tool-actions"><button type="button" class="tool-open">Open accounts</button><span class="tool-state">Loading…</span></div>`;
    el.querySelector(".tool-open")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("frank:view", { detail: "accounts" }));
    });
    fetch("/api/accounts")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("accounts unavailable")))
      .then((data) => {
        const count = data.accounts?.length || 0;
        const customers = (data.accounts || []).filter((account) => account.kind === "customer").length;
        el.querySelector(".tool-state").textContent = count ? `${customers} customer${customers === 1 ? "" : "s"} · ${count} total` : "No accounts yet";
      })
      .catch(() => { el.querySelector(".tool-state").textContent = "Unavailable"; });
  },
});

define({
  id: "campaigns", title: "Campaigns · Mautic", surfaces: ["tools"],
  mount(el) {
    el.innerHTML = `<p>Mautic owns campaigns and audiences. Resend is the selected delivery provider.</p>
      <div class="tool-actions"><span class="tool-state">Checking setup…</span></div>`;
    fetch("/api/email-tools")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("email tools unavailable")))
      .then((data) => {
        const actions = el.querySelector(".tool-actions");
        const mautic = data.mautic || {};
        const resend = data.resend || {};
        actions.innerHTML = "";
        if (mautic.status !== "unconfigured" && mautic.url) {
          const link = document.createElement("a");
          link.className = "tool-link";
          link.href = mautic.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Open Mautic";
          actions.append(link);
        }
        const state = document.createElement("span");
        state.className = "tool-state";
        const statusLabel = (status) => ({ ready: "ready", configured: "configured", error: "needs attention" })[status] || "setup needed";
        const parts = [`Mautic ${statusLabel(mautic.status)}`, `Resend ${statusLabel(resend.status)}`];
        state.textContent = parts.join(" · ");
        actions.append(state);
      })
      .catch(() => { el.querySelector(".tool-state").textContent = "Setup status unavailable"; });
  },
});

define({
  id: "factory-ad", title: "Ad templates", surfaces: ["tools"],
  mount(el) {
    el.innerHTML = `<p>The existing generator on this box. Trace wiring is next.</p>
      <p class="when">/frank/tools/ad-template-generator</p>`;
  },
});

define({
  id: "trace-view", title: "Last run", surfaces: ["trace"],
  mount(el) {
    el.innerHTML = `<p class="quiet">No factory run yet. The flow, artefact and coloured prompt land here.</p>`;
  },
});

define({
  id: "releases", title: "Releases", surfaces: ["releases"],
  mount(el) { el.innerHTML = `<p class="quiet">Nothing signed yet. minisign comes with the first pack.</p>`; },
});
