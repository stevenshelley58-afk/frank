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
